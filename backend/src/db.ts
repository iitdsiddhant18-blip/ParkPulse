import mysql, { PoolConnection } from 'mysql2/promise';
import { config } from './config';

export const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  database: config.db.database,
  user: config.db.user,
  password: config.db.password,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  timezone: '+05:30',
  decimalNumbers: true,
  dateStrings: true,
});

/**
 * Runs a callback on a dedicated connection with `@app_user` set so Phase 1b
 * triggers (`trg_resv_after_insert`, `trg_resv_after_update`, `trg_pricing_after_update`)
 * record the authenticated actor in `audit_log.changed_by`.
 */
export async function withAuditUser<T>(
  userTag: string,
  fn: (conn: PoolConnection) => Promise<T>
): Promise<T> {
  const conn = await pool.getConnection();
  try {
    await conn.execute('SET @app_user = ?', [userTag]);
    return await fn(conn);
  } finally {
    try {
      await conn.execute('SET @app_user = NULL');
    } catch {
      // Ignore cleanup error if connection was closed
    }
    conn.release();
  }
}

