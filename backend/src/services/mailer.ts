import nodemailer from 'nodemailer';
import { RowDataPacket } from 'mysql2/promise';
import { config } from '../config';
import { pool } from '../db';

const transporter = config.mail.smtpHost
  ? nodemailer.createTransport({
      host: config.mail.smtpHost,
      port: config.mail.smtpPort,
      secure: config.mail.smtpPort === 465,
      auth: config.mail.smtpUser
        ? { user: config.mail.smtpUser, pass: config.mail.smtpPass }
        : undefined,
    })
  : nodemailer.createTransport({
      jsonTransport: true,
    });

export interface DispatchedEmailInfo {
  notification_id: number;
  user_id: number;
  to: string;
  type: string;
  subject: string;
}

/**
 * Finds all rows in `notifications` where `email_sent = FALSE` (optionally filtered by userId),
 * dispatches an email for each via Nodemailer, and sets `email_sent = TRUE`.
 */
export async function dispatchPendingEmails(userId?: number): Promise<DispatchedEmailInfo[]> {
  const params: Array<number> = [];
  let userFilter = '';
  if (typeof userId === 'number') {
    userFilter = 'AND n.user_id = ?';
    params.push(userId);
  }

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT
       n.notification_id,
       n.user_id,
       n.reservation_id,
       n.type,
       n.message,
       u.email,
       u.full_name
     FROM notifications n
     JOIN users u ON u.user_id = n.user_id
     WHERE n.email_sent = FALSE
       ${userFilter}
     ORDER BY n.notification_id ASC`,
    params
  );

  const dispatched: DispatchedEmailInfo[] = [];

  for (const row of rows) {
    const subject = `[ParkPulse] ${String(row.type).replace(/_/g, ' ')}`;
    await transporter.sendMail({
      from: config.mail.from,
      to: String(row.email),
      subject,
      text: `Hello ${row.full_name},\n\n${row.message}\n\n— ParkPulse`,
    });

    await pool.execute(
      `UPDATE notifications SET email_sent = TRUE WHERE notification_id = ?`,
      [row.notification_id]
    );

    dispatched.push({
      notification_id: Number(row.notification_id),
      user_id: Number(row.user_id),
      to: String(row.email),
      type: String(row.type),
      subject,
    });
  }

  return dispatched;
}
