import { Router } from 'express';
import { RowDataPacket } from 'mysql2/promise';
import { z } from 'zod';
import { pool } from '../db';
import { AppError, asyncHandler } from '../errors';
import { requireAdmin, requireAuth } from '../middleware/auth';
import { normalizeDateTimeParam } from './lots.routes';
import { dispatchPendingEmails } from '../services/mailer';

export const notificationsRouter = Router();

const sendRemindersSchema = z.object({
  reference_time: z.string().optional(),
  window_minutes: z.number().int().min(5).max(1440).optional().default(60),
});

notificationsRouter.use(requireAuth);

// 1. GET /api/notifications — List current user's notifications + unread_count
notificationsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT
         notification_id,
         user_id,
         reservation_id,
         type,
         message,
         is_read,
         email_sent,
         created_at
       FROM notifications
      WHERE user_id = ?
      ORDER BY notification_id DESC`,
      [req.user!.userId]
    );

    const notifications = rows.map((n) => ({
      ...n,
      is_read: Boolean(n.is_read),
      email_sent: Boolean(n.email_sent),
    }));

    const unreadCount = notifications.filter((n) => !n.is_read).length;

    res.status(200).json({
      unread_count: unreadCount,
      notifications,
    });
  })
);

// 2. PATCH /api/notifications/:notificationId/read — Mark a single notification as read
notificationsRouter.patch(
  '/:notificationId/read',
  asyncHandler(async (req, res) => {
    const notificationId = Number(req.params.notificationId);
    if (!Number.isInteger(notificationId) || notificationId <= 0) {
      throw new AppError(400, 'INVALID_ID', 'Invalid notificationId');
    }

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT notification_id, user_id FROM notifications WHERE notification_id = ?`,
      [notificationId]
    );

    if (rows.length === 0) {
      throw new AppError(404, 'NOTIFICATION_NOT_FOUND', 'Notification not found');
    }

    if (Number(rows[0].user_id) !== req.user!.userId) {
      throw new AppError(403, 'FORBIDDEN', 'Not authorized to modify this notification');
    }

    await pool.execute(
      `UPDATE notifications SET is_read = TRUE WHERE notification_id = ?`,
      [notificationId]
    );

    const [updated] = await pool.execute<RowDataPacket[]>(
      `SELECT * FROM notifications WHERE notification_id = ?`,
      [notificationId]
    );

    res.status(200).json({
      notification: {
        ...updated[0],
        is_read: Boolean(updated[0].is_read),
        email_sent: Boolean(updated[0].email_sent),
      },
    });
  })
);

// 3. POST /api/notifications/read-all — Mark all current user's notifications as read
notificationsRouter.post(
  '/read-all',
  asyncHandler(async (req, res) => {
    await pool.execute(
      `UPDATE notifications SET is_read = TRUE WHERE user_id = ? AND is_read = FALSE`,
      [req.user!.userId]
    );

    res.status(200).json({ message: 'All notifications marked as read' });
  })
);

// 4. POST /api/notifications/send-reminders — Admin: Create & email reminders for upcoming bookings
notificationsRouter.post(
  '/send-reminders',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = sendRemindersSchema.parse(req.body ?? {});
    const refTime = body.reference_time ? normalizeDateTimeParam(body.reference_time) : null;

    const [upcoming] = await pool.execute<RowDataPacket[]>(
      `SELECT
         r.reservation_id,
         r.start_time,
         v.user_id,
         ps.slot_number,
         pl.name AS lot_name
       FROM reservations r
       JOIN vehicles v       ON v.vehicle_id = r.vehicle_id
       JOIN parking_slots ps ON ps.slot_id   = r.slot_id
       JOIN parking_lots pl  ON pl.lot_id    = ps.lot_id
      WHERE r.status = 'CONFIRMED'
        AND r.start_time >= COALESCE(?, NOW())
        AND r.start_time <= DATE_ADD(COALESCE(?, NOW()), INTERVAL ? MINUTE)
        AND NOT EXISTS (
          SELECT 1
            FROM notifications n
           WHERE n.reservation_id = r.reservation_id
             AND n.type = 'REMINDER'
        )
      ORDER BY r.reservation_id ASC`,
      [refTime, refTime, body.window_minutes]
    );

    for (const row of upcoming) {
      await pool.execute(
        `INSERT INTO notifications (user_id, reservation_id, type, message)
         VALUES (?, ?, 'REMINDER', ?)`,
        [
          row.user_id,
          row.reservation_id,
          `Reminder: Your reservation #${row.reservation_id} at ${row.lot_name} (Slot ${row.slot_number}) starts at ${row.start_time}.`,
        ]
      );
    }

    const emailed = await dispatchPendingEmails();

    res.status(200).json({
      reminders_created: upcoming.length,
      emails_dispatched: emailed.length,
    });
  })
);
