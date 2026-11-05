import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config();

/**
 * Splits a MySQL script into individual executable statements while honoring
 * `DELIMITER $$` and `DELIMITER ;` directives for triggers, procedures, functions, and events.
 */
function parseSqlStatements(rawSql: string, targetDbName: string): string[] {
  const lines = rawSql.replace(/\r\n/g, '\n').split('\n');
  let delimiter = ';';
  let buffer: string[] = [];
  const statements: string[] = [];

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();

    if (trimmed.startsWith('--')) {
      continue;
    }

    const delimMatch = trimmed.match(/^DELIMITER\s+(\S+)$/i);
    if (delimMatch) {
      const pending = buffer.join('\n').trim();
      if (pending) {
        statements.push(pending);
      }
      buffer = [];
      delimiter = delimMatch[1];
      continue;
    }

    // Rewrite hardcoded schema name if cloud provider uses a custom database name
    const rewrittenLine =
      targetDbName !== 'parkpulse'
        ? rawLine
            .replace(
              /\bCREATE DATABASE IF NOT EXISTS parkpulse\b/gi,
              `CREATE DATABASE IF NOT EXISTS \`${targetDbName}\``
            )
            .replace(/\bUSE parkpulse\b/gi, `USE \`${targetDbName}\``)
        : rawLine;

    buffer.push(rewrittenLine);

    const joined = buffer.join('\n').trim();
    if (joined.endsWith(delimiter)) {
      const stmt = joined.slice(0, joined.length - delimiter.length).trim();
      if (stmt.length > 0) {
        statements.push(stmt);
      }
      buffer = [];
    }
  }

  const tail = buffer.join('\n').trim();
  if (tail.length > 0) {
    statements.push(tail);
  }

  return statements;
}

function resolveDbFolder(): string {
  const candidates = [
    path.resolve(__dirname, '../../db'),
    path.resolve(process.cwd(), '../db'),
    path.resolve(process.cwd(), 'db'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'schema.sql'))) {
      return dir;
    }
  }
  throw new Error('Could not locate db/ folder containing schema.sql');
}

async function main(): Promise<void> {
  const withAnalytics = process.argv.includes('--with-analytics');

  const host = process.env.DB_HOST ?? process.env.MYSQLHOST ?? '127.0.0.1';
  const port = Number(
    process.env.DB_PORT ?? process.env.MYSQLPORT ?? process.env.MYSQL_PORT ?? 3307
  );
  const user =
    process.env.DB_ADMIN_USER ??
    process.env.MYSQLUSER ??
    (process.env.MYSQL_ROOT_PASSWORD ? 'root' : process.env.DB_USER) ??
    'root';
  const password =
    process.env.DB_ADMIN_PASSWORD ??
    process.env.MYSQLPASSWORD ??
    process.env.MYSQL_ROOT_PASSWORD ??
    process.env.DB_PASSWORD ??
    'parkpulse_dev';
  const database =
    process.env.DB_NAME ??
    process.env.MYSQLDATABASE ??
    process.env.MYSQL_DATABASE ??
    'parkpulse';

  const dbDir = resolveDbFolder();
  console.log(
    `Connecting to MySQL at ${host}:${port} as '${user}' (target schema: '${database}')...`
  );

  const conn = await mysql.createConnection({
    host,
    port,
    user,
    password,
    timezone: '+05:30',
  });

  try {
    // Attempt to enable function creators and event scheduler if user has SUPER/SYSTEM_VARIABLES_ADMIN
    try {
      await conn.query('SET GLOBAL log_bin_trust_function_creators = 1');
      await conn.query('SET GLOBAL event_scheduler = ON');
    } catch {
      // Non-fatal on managed cloud MySQL instances where these are pre-configured
    }

    const filesToRun = ['schema.sql', 'seed.sql', 'logic.sql'];
    if (withAnalytics) {
      filesToRun.push('analytics_seed.sql');
    }

    for (const fileName of filesToRun) {
      const fullPath = path.join(dbDir, fileName);
      const rawSql = fs.readFileSync(fullPath, 'utf8');
      const statements = parseSqlStatements(rawSql, database);

      console.log(`Executing ${fileName} (${statements.length} statements)...`);
      for (const stmt of statements) {
        try {
          if (/^INSERT INTO /i.test(stmt)) {
            const idempotentStmt = stmt.replace(/^INSERT INTO/i, 'INSERT IGNORE INTO');
            await conn.query(idempotentStmt);
          } else if (/^CREATE TABLE\s+(?!IF NOT EXISTS)/i.test(stmt)) {
            const idempotentStmt = stmt.replace(
              /^CREATE TABLE\s+(?!IF NOT EXISTS)/i,
              'CREATE TABLE IF NOT EXISTS '
            );
            await conn.query(idempotentStmt);
          } else if (/^CREATE VIEW\s+/i.test(stmt)) {
            const idempotentStmt = stmt.replace(/^CREATE VIEW\s+/i, 'CREATE OR REPLACE VIEW ');
            await conn.query(idempotentStmt);
          } else if (/^CREATE PROCEDURE\s+([`\w]+)/i.test(stmt)) {
            const name = stmt.match(/^CREATE PROCEDURE\s+([`\w]+)/i)![1];
            await conn.query(`DROP PROCEDURE IF EXISTS ${name}`);
            await conn.query(stmt);
          } else if (/^CREATE FUNCTION\s+([`\w]+)/i.test(stmt)) {
            const name = stmt.match(/^CREATE FUNCTION\s+([`\w]+)/i)![1];
            await conn.query(`DROP FUNCTION IF EXISTS ${name}`);
            await conn.query(stmt);
          } else if (/^CREATE TRIGGER\s+([`\w]+)/i.test(stmt)) {
            const name = stmt.match(/^CREATE TRIGGER\s+([`\w]+)/i)![1];
            await conn.query(`DROP TRIGGER IF EXISTS ${name}`);
            await conn.query(stmt);
          } else if (/^CREATE EVENT\s+([`\w]+)/i.test(stmt)) {
            const name = stmt.match(/^CREATE EVENT\s+([`\w]+)/i)![1];
            await conn.query(`DROP EVENT IF EXISTS ${name}`);
            await conn.query(stmt);
          } else {
            await conn.query(stmt);
          }
        } catch (err: any) {
          if (
            err.code === 'ER_TABLE_EXISTS_ERROR' ||
            err.code === 'ER_SP_ALREADY_EXISTS' ||
            err.code === 'ER_TRG_ALREADY_EXISTS' ||
            err.code === 'ER_EVENT_ALREADY_EXISTS' ||
            err.code === 'ER_NON_UNIQ_ERROR' ||
            err.code === 'ER_DUP_ENTRY'
          ) {
            continue;
          }
          throw err;
        }
      }
    }

    console.log('Database initialization completed successfully.');
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('Database initialization failed:', err);
  process.exit(1);
});
