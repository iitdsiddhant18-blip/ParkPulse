import fs from 'fs';
import path from 'path';
import { Router } from 'express';
import PDFDocument from 'pdfkit';
import { RowDataPacket } from 'mysql2/promise';
import { z } from 'zod';
import { pool, withAuditUser } from '../db';
import { AppError, asyncHandler } from '../errors';
import { requireAdmin, requireAuth } from '../middleware/auth';
import { normalizeDateTimeParam } from './lots.routes';
import { dispatchPendingEmails } from '../services/mailer';
import { broadcastAllLotsUpdate } from '../services/sse';

export const adminRouter = Router();

const updateUserStatusSchema = z.object({
  is_active: z.boolean(),
});

const expireStaleSchema = z.object({
  reference_time: z.string().optional(),
});

adminRouter.use(requireAuth, requireAdmin);

// 1. GET /api/admin/users — List all users with vehicle and reservation counts
adminRouter.get(
  '/users',
  asyncHandler(async (_req, res) => {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT
         u.user_id,
         u.full_name,
         u.email,
         u.phone,
         u.role,
         u.is_active,
         u.created_at,
         COUNT(DISTINCT v.vehicle_id) AS vehicle_count,
         COUNT(DISTINCT r.reservation_id) AS reservation_count
       FROM users u
       LEFT JOIN vehicles v     ON v.user_id    = u.user_id
       LEFT JOIN reservations r ON r.vehicle_id = v.vehicle_id
       GROUP BY u.user_id, u.full_name, u.email, u.phone, u.role, u.is_active, u.created_at
       ORDER BY u.user_id ASC`
    );

    const users = rows.map((u) => ({
      ...u,
      is_active: Boolean(u.is_active),
    }));

    res.status(200).json({ users });
  })
);

// 2. PATCH /api/admin/users/:userId/status — Activate or deactivate a user account
adminRouter.patch(
  '/users/:userId/status',
  asyncHandler(async (req, res) => {
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId) || userId <= 0) {
      throw new AppError(400, 'INVALID_ID', 'Invalid userId');
    }

    if (userId === req.user!.userId) {
      throw new AppError(400, 'SELF_STATUS_CHANGE', 'Admins cannot deactivate their own account');
    }

    const body = updateUserStatusSchema.parse(req.body);

    const [existing] = await pool.execute<RowDataPacket[]>(
      `SELECT user_id FROM users WHERE user_id = ?`,
      [userId]
    );
    if (existing.length === 0) {
      throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
    }

    await pool.execute(`UPDATE users SET is_active = ? WHERE user_id = ?`, [
      body.is_active,
      userId,
    ]);

    const [updated] = await pool.execute<RowDataPacket[]>(
      `SELECT user_id, full_name, email, phone, role, is_active, created_at
         FROM users
        WHERE user_id = ?`,
      [userId]
    );

    res.status(200).json({
      user: {
        ...updated[0],
        is_active: Boolean(updated[0].is_active),
      },
    });
  })
);

// 3. GET /api/admin/reservations — View all reservations across all lots/users with filters
adminRouter.get(
  '/reservations',
  asyncHandler(async (req, res) => {
    const statusFilter =
      typeof req.query.status === 'string' && req.query.status.trim() !== ''
        ? req.query.status.trim().toUpperCase()
        : null;
    const lotIdFilter =
      typeof req.query.lot_id === 'string' && req.query.lot_id.trim() !== ''
        ? Number(req.query.lot_id)
        : null;
    const userIdFilter =
      typeof req.query.user_id === 'string' && req.query.user_id.trim() !== ''
        ? Number(req.query.user_id)
        : null;

    const conditions: string[] = [];
    const params: Array<string | number> = [];

    if (statusFilter) {
      conditions.push('r.status = ?');
      params.push(statusFilter);
    }
    if (lotIdFilter && Number.isInteger(lotIdFilter)) {
      conditions.push('pl.lot_id = ?');
      params.push(lotIdFilter);
    }
    if (userIdFilter && Number.isInteger(userIdFilter)) {
      conditions.push('u.user_id = ?');
      params.push(userIdFilter);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT
         r.reservation_id,
         r.vehicle_id,
         r.slot_id,
         r.series_id,
         r.start_time,
         r.end_time,
         r.status,
         r.quoted_amount,
         r.qr_token,
         r.checked_in_at,
         r.checked_out_at,
         r.created_at,
         u.user_id,
         u.full_name AS user_name,
         u.email AS user_email,
         v.plate_number,
         v.vehicle_type,
         ps.slot_number,
         ps.slot_type,
         pl.lot_id,
         pl.name AS lot_name,
         pl.city AS lot_city
       FROM reservations r
       JOIN vehicles v       ON v.vehicle_id = r.vehicle_id
       JOIN users u          ON u.user_id    = v.user_id
       JOIN parking_slots ps ON ps.slot_id   = r.slot_id
       JOIN parking_lots pl  ON pl.lot_id    = ps.lot_id
       ${whereClause}
       ORDER BY r.reservation_id DESC`,
      params
    );

    res.status(200).json({ reservations: rows });
  })
);

// 4. POST /api/admin/reservations/expire-stale — Trigger `expire_stale_reservations` procedure
adminRouter.post(
  '/reservations/expire-stale',
  asyncHandler(async (req, res) => {
    const body = expireStaleSchema.parse(req.body ?? {});
    const refTime = body.reference_time ? normalizeDateTimeParam(body.reference_time) : null;

    const expiredCount = await withAuditUser(`user:${req.user!.userId}`, async (conn) => {
      await conn.execute(`CALL expire_stale_reservations(?, @p_exp_cnt)`, [refTime]);
      const [outRows] = await conn.execute<RowDataPacket[]>(
        `SELECT @p_exp_cnt AS expired_count`
      );
      return Number(outRows[0].expired_count ?? 0);
    });

    await dispatchPendingEmails();
    await broadcastAllLotsUpdate('stale_reservations_expired');

    res.status(200).json({ expired_count: expiredCount });
  })
);

// 5. POST /api/admin/analytics/seed-demo — Load deterministic historical dataset from db/analytics_seed.sql
adminRouter.post(
  '/analytics/seed-demo',
  asyncHandler(async (req, res) => {
    const candidatePaths = [
      path.resolve(__dirname, '../../../db/analytics_seed.sql'),
      path.resolve(__dirname, '../../db/analytics_seed.sql'),
      path.resolve(process.cwd(), 'db/analytics_seed.sql'),
      path.resolve(process.cwd(), '../db/analytics_seed.sql'),
    ];
    const sqlPath = candidatePaths.find((p) => fs.existsSync(p)) ?? candidatePaths[0];
    const rawSql = fs.readFileSync(sqlPath, 'utf8');

    const statements = rawSql
      .split(/;\s*\r?\n/)
      .map((s) =>
        s
          .split('\n')
          .filter((line) => !line.trim().startsWith('--'))
          .join('\n')
          .trim()
      )
      .filter((s) => s.length > 0 && !/^USE\s+/i.test(s));

    await withAuditUser(`user:${req.user!.userId}`, async (conn) => {
      for (const stmt of statements) {
        await conn.query(stmt);
      }
    });

    const [counts] = await pool.execute<RowDataPacket[]>(
      `SELECT
         (SELECT COUNT(*) FROM reservations WHERE reservation_id BETWEEN 5001 AND 5020) AS seeded_reservations,
         (SELECT COUNT(*) FROM payments WHERE reservation_id BETWEEN 5001 AND 5020) AS seeded_payments,
         (SELECT COUNT(*) FROM reviews WHERE reservation_id BETWEEN 5001 AND 5020) AS seeded_reviews`
    );

    res.status(200).json({
      message: 'Historical analytics dataset loaded',
      seeded_reservations: Number(counts[0].seeded_reservations),
      seeded_payments: Number(counts[0].seeded_payments),
      seeded_reviews: Number(counts[0].seeded_reviews),
    });
  })
);

// 6. POST /api/admin/analytics/reset-demo — Remove historical demo dataset and restore seed multipliers
adminRouter.post(
  '/analytics/reset-demo',
  asyncHandler(async (_req, res) => {
    await pool.execute(`DELETE FROM reviews WHERE reservation_id BETWEEN 5001 AND 5020`);
    await pool.execute(`DELETE FROM payments WHERE reservation_id BETWEEN 5001 AND 5020`);
    await pool.execute(`DELETE FROM notifications WHERE reservation_id BETWEEN 5001 AND 5020`);
    await pool.execute(`DELETE FROM reservations WHERE reservation_id BETWEEN 5001 AND 5020`);
    await pool.execute(
      `DELETE FROM audit_log WHERE table_name = 'reservations' AND record_id BETWEEN 5001 AND 5020`
    );

    // Restore seed peak multipliers (weekday 8-9 -> 1.25, weekday 17-19 -> 1.50, weekend 11-20 -> 1.25)
    await pool.execute(
      `UPDATE peak_multipliers
          SET multiplier = 1.25
        WHERE day_of_week BETWEEN 0 AND 4
          AND hour_of_day IN (8, 9)`
    );
    await pool.execute(
      `UPDATE peak_multipliers
          SET multiplier = 1.50
        WHERE day_of_week BETWEEN 0 AND 4
          AND hour_of_day IN (17, 18, 19)`
    );
    await pool.execute(
      `UPDATE peak_multipliers
          SET multiplier = 1.25
        WHERE day_of_week IN (5, 6)
          AND hour_of_day BETWEEN 11 AND 20`
    );
    await pool.execute(
      `DELETE FROM peak_multipliers
        WHERE (day_of_week BETWEEN 0 AND 4 AND hour_of_day NOT IN (8, 9, 17, 18, 19))
           OR (day_of_week IN (5, 6) AND (hour_of_day < 11 OR hour_of_day > 20))`
    );

    res.status(200).json({ message: 'Historical analytics dataset reset cleanly' });
  })
);

// 7. GET /api/admin/analytics/overview — All 8 mandatory Section 4 SQL analytics queries
adminRouter.get(
  '/analytics/overview',
  asyncHandler(async (_req, res) => {
    // 7.1 Cancellation, No-Show, Expired & Completion Rates + Average Parking Duration
    const [kpiRows] = await pool.execute<RowDataPacket[]>(
      `WITH status_summary AS (
         SELECT
           COUNT(*) AS total_reservations,
           COALESCE(SUM(status = 'COMPLETED'), 0)  AS completed_count,
           COALESCE(SUM(status = 'CONFIRMED'), 0)  AS confirmed_count,
           COALESCE(SUM(status = 'CHECKED_IN'), 0) AS checked_in_count,
           COALESCE(SUM(status = 'CANCELLED'), 0)  AS cancelled_count,
           COALESCE(SUM(status = 'EXPIRED'), 0)    AS expired_count,
           COALESCE(SUM(status = 'NO_SHOW'), 0)    AS no_show_count,
           ROUND(
             AVG(
               CASE
                 WHEN status = 'COMPLETED'
                  AND checked_in_at IS NOT NULL
                  AND checked_out_at IS NOT NULL
                 THEN TIMESTAMPDIFF(MINUTE, checked_in_at, checked_out_at)
                 ELSE NULL
               END
             ),
             2
           ) AS avg_duration_minutes
         FROM reservations
       ),
       rev_summary AS (
         SELECT
           COALESCE(SUM(net_revenue), 0.00)      AS total_net_revenue,
           COALESCE(SUM(booking_revenue), 0.00)  AS total_booking_revenue,
           COALESCE(SUM(checkout_revenue), 0.00) AS total_checkout_revenue,
           COALESCE(SUM(penalty_revenue), 0.00)  AS total_penalty_revenue,
           COALESCE(SUM(refunded_amount), 0.00)  AS total_refunded_amount
         FROM v_daily_revenue
       )
       SELECT
         s.*,
         COALESCE(ROUND(s.completed_count * 100.0 / NULLIF(s.total_reservations, 0), 2), 0.00) AS completion_rate_pct,
         COALESCE(ROUND(s.cancelled_count * 100.0 / NULLIF(s.total_reservations, 0), 2), 0.00) AS cancellation_rate_pct,
         COALESCE(ROUND((s.no_show_count + s.expired_count) * 100.0 / NULLIF(s.total_reservations, 0), 2), 0.00) AS no_show_expired_rate_pct,
         COALESCE(ROUND((s.cancelled_count + s.no_show_count + s.expired_count) * 100.0 / NULLIF(s.total_reservations, 0), 2), 0.00) AS unfulfilled_rate_pct,
         r.total_net_revenue,
         r.total_booking_revenue,
         r.total_checkout_revenue,
         r.total_penalty_revenue,
         r.total_refunded_amount
       FROM status_summary s
       CROSS JOIN rev_summary r`
    );

    // 7.2 Utilization Rate, Revenue & Average Duration per Lot
    const [lotUtilization] = await pool.execute<RowDataPacket[]>(
      `WITH lot_bookings AS (
         SELECT
           ps.lot_id,
           COUNT(r.reservation_id) AS total_bookings,
           COALESCE(SUM(r.status = 'COMPLETED'), 0) AS completed_bookings,
           COALESCE(SUM(r.status = 'CANCELLED'), 0) AS cancelled_bookings,
           COALESCE(SUM(r.status IN ('EXPIRED', 'NO_SHOW')), 0) AS missed_bookings,
           COALESCE(
             ROUND(
               SUM(
                 CASE
                   WHEN r.status IN ('CONFIRMED', 'CHECKED_IN', 'COMPLETED')
                   THEN TIMESTAMPDIFF(MINUTE, r.start_time, r.end_time) / 60.0
                   ELSE 0
                 END
               ),
               2
             ),
             0.00
           ) AS booked_slot_hours,
           COALESCE(
             ROUND(
               AVG(
                 CASE
                   WHEN r.status = 'COMPLETED'
                    AND r.checked_in_at IS NOT NULL
                    AND r.checked_out_at IS NOT NULL
                   THEN TIMESTAMPDIFF(MINUTE, r.checked_in_at, r.checked_out_at)
                   ELSE NULL
                 END
               ),
               2
             ),
             0.00
           ) AS avg_duration_minutes
         FROM parking_slots ps
         LEFT JOIN reservations r ON r.slot_id = ps.slot_id
         GROUP BY ps.lot_id
       ),
       lot_rev AS (
         SELECT
           lot_id,
           COALESCE(SUM(net_revenue), 0.00) AS net_revenue
         FROM v_daily_revenue
         GROUP BY lot_id
       )
       SELECT
         vlo.lot_id,
         vlo.lot_name,
         vlo.city,
         vlo.total_slots,
         vlo.available_slots,
         vlo.reserved_slots,
         vlo.occupied_slots,
         vlo.occupancy_pct AS live_occupancy_pct,
         COALESCE(lb.total_bookings, 0)      AS total_bookings,
         COALESCE(lb.completed_bookings, 0)  AS completed_bookings,
         COALESCE(lb.cancelled_bookings, 0)  AS cancelled_bookings,
         COALESCE(lb.missed_bookings, 0)     AS missed_bookings,
         COALESCE(lb.booked_slot_hours, 0.00) AS booked_slot_hours,
         COALESCE(lb.avg_duration_minutes, 0.00) AS avg_duration_minutes,
         COALESCE(
           ROUND(
             (SELECT COUNT(DISTINCT ps2.slot_id)
                FROM parking_slots ps2
                JOIN reservations r2 ON r2.slot_id = ps2.slot_id
               WHERE ps2.lot_id = vlo.lot_id
                 AND r2.status IN ('CONFIRMED', 'CHECKED_IN', 'COMPLETED')) * 100.0
             / NULLIF(vlo.total_slots, 0),
             2
           ),
           0.00
         ) AS slot_utilization_rate_pct,
         COALESCE(lr.net_revenue, 0.00) AS net_revenue
       FROM v_lot_occupancy vlo
       LEFT JOIN lot_bookings lb ON lb.lot_id = vlo.lot_id
       LEFT JOIN lot_rev lr      ON lr.lot_id = vlo.lot_id
       ORDER BY vlo.lot_id ASC`
    );

    // 7.3 Revenue by Day (with running cumulative revenue window function), Week, and Month
    const [revenueByDay] = await pool.execute<RowDataPacket[]>(
      `WITH daily_totals AS (
         SELECT
           revenue_date,
           SUM(booking_revenue)  AS booking_revenue,
           SUM(checkout_revenue) AS checkout_revenue,
           SUM(penalty_revenue)  AS penalty_revenue,
           SUM(refunded_amount)  AS refunded_amount,
           SUM(net_revenue)      AS net_revenue,
           SUM(payment_count)    AS payment_count
         FROM v_daily_revenue
         GROUP BY revenue_date
       )
       SELECT
         revenue_date,
         booking_revenue,
         checkout_revenue,
         penalty_revenue,
         refunded_amount,
         net_revenue,
         payment_count,
         SUM(net_revenue) OVER (ORDER BY revenue_date ASC) AS cumulative_revenue
       FROM daily_totals
       ORDER BY revenue_date ASC`
    );

    const [revenueByWeek] = await pool.execute<RowDataPacket[]>(
      `SELECT
         YEARWEEK(revenue_date, 1) AS year_week,
         MIN(revenue_date)         AS week_start,
         MAX(revenue_date)         AS week_end,
         SUM(booking_revenue)      AS booking_revenue,
         SUM(checkout_revenue)     AS checkout_revenue,
         SUM(penalty_revenue)      AS penalty_revenue,
         SUM(net_revenue)          AS net_revenue
       FROM v_daily_revenue
       GROUP BY YEARWEEK(revenue_date, 1)
       ORDER BY year_week ASC`
    );

    const [revenueByMonth] = await pool.execute<RowDataPacket[]>(
      `SELECT
         DATE_FORMAT(revenue_date, '%Y-%m') AS \`year_month\`,
         SUM(booking_revenue)  AS booking_revenue,
         SUM(checkout_revenue) AS checkout_revenue,
         SUM(penalty_revenue)  AS penalty_revenue,
         SUM(refunded_amount)  AS refunded_amount,
         SUM(net_revenue)      AS net_revenue,
         SUM(payment_count)    AS payment_count
       FROM v_daily_revenue
       GROUP BY DATE_FORMAT(revenue_date, '%Y-%m')
       ORDER BY \`year_month\` ASC`
    );

    // 7.4 Peak Hours (from v_peak_hours + global hourly ranking using RANK() OVER)
    const [peakHoursByLot] = await pool.execute<RowDataPacket[]>(
      `SELECT lot_id, lot_name, hour_of_day, booking_count, hour_rank
         FROM v_peak_hours
        ORDER BY lot_id ASC, hour_rank ASC, hour_of_day ASC`
    );

    const [peakHoursGlobal] = await pool.execute<RowDataPacket[]>(
      `WITH global_hourly AS (
         SELECT
           HOUR(r.start_time) AS hour_of_day,
           COUNT(r.reservation_id) AS booking_count,
           ROUND(SUM(r.quoted_amount), 2) AS quoted_revenue
         FROM reservations r
         WHERE r.status IN ('CONFIRMED', 'CHECKED_IN', 'COMPLETED')
         GROUP BY HOUR(r.start_time)
       )
       SELECT
         hour_of_day,
         booking_count,
         quoted_revenue,
         RANK() OVER (ORDER BY booking_count DESC, hour_of_day ASC) AS demand_rank
       FROM global_hourly
       ORDER BY demand_rank ASC, hour_of_day ASC`
    );

    // 7.5 Busiest Days of the Week (0 = Monday ... 6 = Sunday) with RANK() OVER
    const [busiestDays] = await pool.execute<RowDataPacket[]>(
      `WITH weekday_stats AS (
         SELECT
           WEEKDAY(r.start_time) AS day_of_week,
           ANY_VALUE(ELT(WEEKDAY(r.start_time) + 1, 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')) AS day_name,
           COUNT(r.reservation_id) AS booking_count,
           ROUND(SUM(r.quoted_amount), 2) AS quoted_revenue
         FROM reservations r
         WHERE r.status IN ('CONFIRMED', 'CHECKED_IN', 'COMPLETED')
         GROUP BY WEEKDAY(r.start_time)
       )
       SELECT
         day_of_week,
         day_name,
         booking_count,
         quoted_revenue,
         RANK() OVER (ORDER BY booking_count DESC, day_of_week ASC) AS day_rank
       FROM weekday_stats
       ORDER BY day_rank ASC, day_of_week ASC`
    );

    // 7.6 Most and Least Used Slots (ranked with DENSE_RANK() OVER)
    const [slotUsage] = await pool.execute<RowDataPacket[]>(
      `WITH slot_stats AS (
         SELECT
           ps.slot_id,
           ps.slot_number,
           ps.slot_type,
           pl.lot_id,
           pl.name AS lot_name,
           COUNT(CASE WHEN r.status IN ('CONFIRMED', 'CHECKED_IN', 'COMPLETED') THEN 1 END) AS usage_count,
           COALESCE(
             ROUND(
               SUM(
                 CASE
                   WHEN r.status IN ('CONFIRMED', 'CHECKED_IN', 'COMPLETED')
                   THEN TIMESTAMPDIFF(MINUTE, r.start_time, r.end_time) / 60.0
                   ELSE 0
                 END
               ),
               2
             ),
             0.00
           ) AS total_booked_hours
         FROM parking_slots ps
         JOIN parking_lots pl ON pl.lot_id = ps.lot_id
         LEFT JOIN reservations r ON r.slot_id = ps.slot_id
         GROUP BY ps.slot_id, ps.slot_number, ps.slot_type, pl.lot_id, pl.name
       )
       SELECT
         slot_id,
         slot_number,
         slot_type,
         lot_id,
         lot_name,
         usage_count,
         total_booked_hours,
         DENSE_RANK() OVER (ORDER BY usage_count DESC, total_booked_hours DESC) AS most_used_rank,
         DENSE_RANK() OVER (ORDER BY usage_count ASC, total_booked_hours ASC)   AS least_used_rank
       FROM slot_stats
       ORDER BY usage_count DESC, total_booked_hours DESC, slot_id ASC`
    );

    // 7.7 Occupancy Heatmap (Day of Week 0..6 vs Hour of Day 0..23)
    const [heatmapRows] = await pool.execute<RowDataPacket[]>(
      `SELECT
         WEEKDAY(r.start_time) AS day_of_week,
         ANY_VALUE(ELT(WEEKDAY(r.start_time) + 1, 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')) AS day_name,
         HOUR(r.start_time) AS hour_of_day,
         COUNT(r.reservation_id) AS booking_count
       FROM reservations r
       WHERE r.status IN ('CONFIRMED', 'CHECKED_IN', 'COMPLETED')
       GROUP BY WEEKDAY(r.start_time), HOUR(r.start_time)
       ORDER BY day_of_week ASC, hour_of_day ASC`
    );

    res.status(200).json({
      kpis: kpiRows[0],
      lot_utilization: lotUtilization,
      revenue: {
        by_day: revenueByDay,
        by_week: revenueByWeek,
        by_month: revenueByMonth,
      },
      peak_hours: {
        by_lot: peakHoursByLot,
        global: peakHoursGlobal,
      },
      busiest_days: busiestDays,
      slot_usage: {
        most_used: slotUsage.slice(0, 10),
        least_used: [...slotUsage]
          .sort((a, b) => Number(a.usage_count) - Number(b.usage_count) || Number(a.slot_id) - Number(b.slot_id))
          .slice(0, 10),
        all_slots: slotUsage,
      },
      occupancy_heatmap: heatmapRows,
    });
  })
);

// 8. POST /api/admin/analytics/apply-dynamic-pricing — Adjust `peak_multipliers` from peak-hour analytics
adminRouter.post(
  '/analytics/apply-dynamic-pricing',
  asyncHandler(async (_req, res) => {
    const [demandBuckets] = await pool.execute<RowDataPacket[]>(
      `WITH bucket_demand AS (
         SELECT
           ps.lot_id,
           WEEKDAY(r.start_time) AS day_of_week,
           HOUR(r.start_time)    AS hour_of_day,
           COUNT(r.reservation_id) AS booking_count
         FROM reservations r
         JOIN parking_slots ps ON ps.slot_id = r.slot_id
         WHERE r.status IN ('CONFIRMED', 'CHECKED_IN', 'COMPLETED')
         GROUP BY ps.lot_id, WEEKDAY(r.start_time), HOUR(r.start_time)
         HAVING COUNT(r.reservation_id) >= 2
       )
       SELECT
         lot_id,
         day_of_week,
         hour_of_day,
         booking_count,
         CASE
           WHEN booking_count >= 4 THEN 1.75
           ELSE 1.50
         END AS recommended_multiplier
       FROM bucket_demand
       ORDER BY booking_count DESC, lot_id ASC`
    );

    const adjustments: Array<{
      lot_id: number;
      day_of_week: number;
      hour_of_day: number;
      booking_count: number;
      new_multiplier: number;
    }> = [];

    for (const row of demandBuckets) {
      const lotId = Number(row.lot_id);
      const dow = Number(row.day_of_week);
      const hr = Number(row.hour_of_day);
      const mult = Number(row.recommended_multiplier);

      await pool.execute(
        `INSERT INTO peak_multipliers (lot_id, day_of_week, hour_of_day, multiplier)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE multiplier = VALUES(multiplier)`,
        [lotId, dow, hr, mult]
      );

      adjustments.push({
        lot_id: lotId,
        day_of_week: dow,
        hour_of_day: hr,
        booking_count: Number(row.booking_count),
        new_multiplier: mult,
      });
    }

    res.status(200).json({
      updated_buckets: adjustments.length,
      adjustments,
    });
  })
);

// 9. GET /api/admin/reports/export — Export analytics & revenue report as CSV or PDF
adminRouter.get(
  '/reports/export',
  asyncHandler(async (req, res) => {
    const format =
      typeof req.query.format === 'string' ? req.query.format.trim().toLowerCase() : 'csv';

    if (format !== 'csv' && format !== 'pdf') {
      throw new AppError(400, 'INVALID_FORMAT', "Report format must be 'csv' or 'pdf'");
    }

    const [lotRows] = await pool.execute<RowDataPacket[]>(
      `SELECT
         vlo.lot_id,
         vlo.lot_name,
         vlo.city,
         vlo.total_slots,
         vlo.available_slots,
         vlo.occupancy_pct,
         COALESCE((SELECT SUM(net_revenue) FROM v_daily_revenue vdr WHERE vdr.lot_id = vlo.lot_id), 0.00) AS net_revenue
       FROM v_lot_occupancy vlo
       ORDER BY vlo.lot_id ASC`
    );

    const [dailyRows] = await pool.execute<RowDataPacket[]>(
      `SELECT revenue_date, lot_id, lot_name, booking_revenue, checkout_revenue, penalty_revenue, refunded_amount, net_revenue, payment_count
         FROM v_daily_revenue
        ORDER BY revenue_date ASC, lot_id ASC`
    );

    if (format === 'csv') {
      const lines: string[] = [
        'section,date_or_id,lot_name,metric_1,metric_2,metric_3,net_revenue',
      ];

      for (const l of lotRows) {
        lines.push(
          `LOT_SUMMARY,${l.lot_id},"${String(l.lot_name).replace(/"/g, '""')}",total_slots:${l.total_slots},available:${l.available_slots},occupancy_pct:${l.occupancy_pct},${Number(l.net_revenue).toFixed(2)}`
        );
      }

      for (const d of dailyRows) {
        lines.push(
          `DAILY_REVENUE,${d.revenue_date},"${String(d.lot_name).replace(/"/g, '""')}",booking:${d.booking_revenue},penalty:${d.penalty_revenue},refunded:${d.refunded_amount},${Number(d.net_revenue).toFixed(2)}`
        );
      }

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="parkpulse-analytics-report.csv"'
      );
      res.status(200).send(lines.join('\n') + '\n');
      return;
    }

    // PDF Export via pdfkit
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="parkpulse-analytics-report.pdf"'
    );

    const doc = new PDFDocument({ margin: 50 });
    doc.pipe(res);

    doc.fontSize(20).text('ParkPulse — Smart Parking Analytics Report', { align: 'left' });
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor('#555555').text(`Generated: ${new Date().toISOString()}`);
    doc.moveDown(1.5);

    doc.fillColor('#000000').fontSize(14).text('1. Parking Lot Utilization & Net Revenue');
    doc.moveDown(0.5);
    for (const l of lotRows) {
      doc
        .fontSize(10)
        .text(
          `Lot #${l.lot_id}: ${l.lot_name} (${l.city}) — Slots: ${l.available_slots}/${l.total_slots} free (${l.occupancy_pct}% occupied) — Net Revenue: INR ${Number(
            l.net_revenue
          ).toFixed(2)}`
        );
    }

    doc.moveDown(1.5);
    doc.fontSize(14).text('2. Daily Revenue Breakdown');
    doc.moveDown(0.5);
    if (dailyRows.length === 0) {
      doc.fontSize(10).text('No daily revenue rows recorded yet.');
    } else {
      for (const d of dailyRows) {
        doc
          .fontSize(10)
          .text(
            `${d.revenue_date} | ${d.lot_name} | Booking: INR ${Number(d.booking_revenue).toFixed(
              2
            )} | Penalty: INR ${Number(d.penalty_revenue).toFixed(2)} | Net: INR ${Number(
              d.net_revenue
            ).toFixed(2)}`
          );
      }
    }

    doc.end();
  })
);
