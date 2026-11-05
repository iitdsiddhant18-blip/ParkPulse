import path from 'path';
import dotenv from 'dotenv';

// Load root .env (one level above backend/) if present
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config();

export const config = {
  port: Number(process.env.PORT ?? process.env.BACKEND_PORT ?? 4000),
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? '*',
  db: {
    host: process.env.DB_HOST ?? process.env.MYSQLHOST ?? '127.0.0.1',
    port: Number(
      process.env.DB_PORT ?? process.env.MYSQLPORT ?? process.env.MYSQL_PORT ?? 3307
    ),
    database:
      process.env.DB_NAME ??
      process.env.MYSQLDATABASE ??
      process.env.MYSQL_DATABASE ??
      'parkpulse',
    user: process.env.DB_USER ?? process.env.MYSQLUSER ?? 'parkpulse_app',
    password:
      process.env.DB_PASSWORD ?? process.env.MYSQLPASSWORD ?? 'parkpulse_app_dev',
  },
  jwt: {
    secret: process.env.JWT_SECRET ?? 'parkpulse_dev_jwt_secret_key_2026',
    expiresIn: process.env.JWT_EXPIRES_IN ?? '24h',
  },
  mail: {
    from: process.env.MAIL_FROM ?? 'no-reply@parkpulse.dev',
    smtpHost: process.env.SMTP_HOST ?? '',
    smtpPort: Number(process.env.SMTP_PORT ?? 587),
    smtpUser: process.env.SMTP_USER ?? '',
    smtpPass: process.env.SMTP_PASS ?? '',
  },
};
