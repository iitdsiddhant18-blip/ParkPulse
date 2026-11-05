import { Router } from 'express';
import { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { z } from 'zod';
import { pool, withAuditUser } from '../db';
import { AppError, asyncHandler } from '../errors';
import { requireAuth } from '../middleware/auth';
import { dispatchPendingEmails } from '../services/mailer';
import { broadcastLotUpdate } from '../services/sse';

export const seriesRouter = Router();

const createSeriesSchema = z.object({
  vehicle_id: z.number().int().positive(),
  slot_id: z.number().int().positive(),
  day_of_week: z.number().int().min(0).max(6),
  start_clock: z
    .string()
    .trim()
    .regex(/^\d{2}:\d{2}(:\d{2})?$/)
    .transform((v) => (v.length === 5 ? `${v}:00` : v)),
  duration_minutes: z.number().int().min(15).max(1440),
  valid_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  valid_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatUtcAsWallClock(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(
    d.getUTCHours()
  )}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
}

function computeMatchingWindows(
  validFrom: string,
  validTo: string,
  dayOfWeek: number,
  startClock: string,
  durationMinutes: number
): Array<{ start_time: string; end_time: string }> {
  const [fy, fm, fd] = validFrom.split('-').map(Number);
  const [ty, tm, td] = validTo.split('-').map(Number);
  const [hh, mm, ss] = startClock.split(':').map(Number);

  const startCursor = Date.UTC(fy, fm - 1, fd);
  const endLimit = Date.UTC(ty, tm - 1, td);
  const windows: Array<{ start_time: string; end_time: string }> = [];

  for (let cur = startCursor; cur <= endLimit; cur += 86_400_000) {
    const dt = new Date(cur);
    const mysqlWeekday = (dt.getUTCDay() + 6) % 7; // 0 = Monday ... 6 = Sunday
    if (mysqlWeekday === dayOfWeek) {
      const occStartMs = Date.UTC(
        dt.getUTCFullYear(),
        dt.getUTCMonth(),
        dt.getUTCDate(),
        hh,
        mm,
        ss
      );
      const occEndMs = occStartMs + durationMinutes * 60_000;
      windows.push({
        start_time: formatUtcAsWallClock(occStartMs),
        end_time: formatUtcAsWallClock(occEndMs),
      });
    }
  }

  return windows;
}

seriesRouter.use(requireAuth);

// 1. GET /api/series — List current user's recurring reservation series
seriesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT
         rs.series_id,
         rs.vehicle_id,
         rs.slot_id,
         rs.day_of_week,
         rs.start_clock,
         rs.duration_minutes,
         rs.valid_from,
         rs.valid_to,
         rs.is_active,
         rs.created_at,
         v.plate_number,
         v.vehicle_type,
         ps.slot_number,
         ps.lot_id,
         pl.name AS lot_name,
         COUNT(r.reservation_id) AS occurrence_count,
         COALESCE(SUM(r.status = 'CONFIRMED'), 0) AS active_occurrences
       FROM reservation_series rs
       JOIN vehicles v       ON v.vehicle_id = rs.vehicle_id
       JOIN parking_slots ps ON ps.slot_id   = rs.slot_id
       JOIN parking_lots pl  ON pl.lot_id    = ps.lot_id
       LEFT JOIN reservations r ON r.series_id = rs.series_id
      WHERE v.user_id = ?
      GROUP BY
        rs.series_id, rs.vehicle_id, rs.slot_id, rs.day_of_week,
        rs.start_clock, rs.duration_minutes, rs.valid_from, rs.valid_to,
        rs.is_active, rs.created_at, v.plate_number, v.vehicle_type,
        ps.slot_number, ps.lot_id, pl.name
      ORDER BY rs.series_id DESC`,
      [req.user!.userId]
    );

    const series = rows.map((s) => ({
      ...s,
      is_active: Boolean(s.is_active),
      occurrence_count: Number(s.occurrence_count),
      active_occurrences: Number(s.active_occurrences),
    }));

    res.status(200).json({ series });
  })
);

// 2. POST /api/series — Create a recurring series and book all occurrences in [valid_from, valid_to]
seriesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = createSeriesSchema.parse(req.body);
    if (body.valid_to < body.valid_from) {
      throw new AppError(400, 'INVALID_DATE_RANGE', 'valid_to must be on or after valid_from');
    }

    const [vehRows] = await pool.execute<RowDataPacket[]>(
      `SELECT vehicle_id, user_id, vehicle_type FROM vehicles WHERE vehicle_id = ?`,
      [body.vehicle_id]
    );
    if (vehRows.length === 0) {
      throw new AppError(404, 'VEHICLE_NOT_FOUND', 'Vehicle not found');
    }
    if (Number(vehRows[0].user_id) !== req.user!.userId && req.user!.role !== 'ADMIN') {
      throw new AppError(403, 'FORBIDDEN', 'You can only create a series for your own vehicle');
    }

    const [slotRows] = await pool.execute<RowDataPacket[]>(
      `SELECT slot_id, lot_id, slot_type FROM parking_slots WHERE slot_id = ?`,
      [body.slot_id]
    );
    if (slotRows.length === 0) {
      throw new AppError(404, 'SLOT_NOT_FOUND', 'Parking slot not found');
    }
    const lotId = Number(slotRows[0].lot_id);

    const windows = computeMatchingWindows(
      body.valid_from,
      body.valid_to,
      body.day_of_week,
      body.start_clock,
      body.duration_minutes
    );
    if (windows.length === 0) {
      throw new AppError(
        400,
        'NO_MATCHING_DATES',
        'No dates matching day_of_week found between valid_from and valid_to'
      );
    }

    let seriesId = 0;
    const createdReservationIds: number[] = [];

    try {
      await withAuditUser(`user:${req.user!.userId}`, async (conn) => {
        const [ins] = await conn.execute<ResultSetHeader>(
          `INSERT INTO reservation_series
             (vehicle_id, slot_id, day_of_week, start_clock, duration_minutes, valid_from, valid_to, is_active)
           VALUES (?, ?, ?, ?, ?, ?, ?, TRUE)`,
          [
            body.vehicle_id,
            body.slot_id,
            body.day_of_week,
            body.start_clock,
            body.duration_minutes,
            body.valid_from,
            body.valid_to,
          ]
        );
        seriesId = ins.insertId;

        for (const w of windows) {
          await conn.execute(
            `CALL book_slot(?, ?, ?, ?, ?, @p_s_res_id, @p_s_quote, @p_s_qr)`,
            [body.vehicle_id, body.slot_id, w.start_time, w.end_time, seriesId]
          );
          const [outRows] = await conn.execute<RowDataPacket[]>(
            `SELECT @p_s_res_id AS reservation_id`
          );
          createdReservationIds.push(Number(outRows[0].reservation_id));
        }
      });
    } catch (err) {
      // Clean up any partial occurrences and the series template if a later occurrence failed
      for (const rId of createdReservationIds) {
        await pool.execute(`DELETE FROM notifications WHERE reservation_id = ?`, [rId]);
        await pool.execute(`DELETE FROM reservations WHERE reservation_id = ?`, [rId]);
      }
      if (seriesId > 0) {
        await pool.execute(`DELETE FROM reservation_series WHERE series_id = ?`, [seriesId]);
      }
      // Re-sync slot status after cleanup
      await pool.execute(
        `UPDATE parking_slots ps
            SET ps.status = CASE
              WHEN ps.status = 'MAINTENANCE' THEN 'MAINTENANCE'
              WHEN EXISTS (SELECT 1 FROM reservations r WHERE r.slot_id = ps.slot_id AND r.status = 'CHECKED_IN') THEN 'OCCUPIED'
              WHEN EXISTS (SELECT 1 FROM reservations r WHERE r.slot_id = ps.slot_id AND r.status = 'CONFIRMED') THEN 'RESERVED'
              ELSE 'AVAILABLE'
            END
          WHERE ps.slot_id = ?`,
        [body.slot_id]
      );
      throw err;
    }

    const [seriesRows] = await pool.execute<RowDataPacket[]>(
      `SELECT * FROM reservation_series WHERE series_id = ?`,
      [seriesId]
    );
    const [resvRows] = await pool.execute<RowDataPacket[]>(
      `SELECT reservation_id, vehicle_id, slot_id, series_id, start_time, end_time, status, quoted_amount, qr_token
         FROM reservations
        WHERE series_id = ?
        ORDER BY start_time ASC`,
      [seriesId]
    );

    await dispatchPendingEmails(Number(vehRows[0].user_id));
    await broadcastLotUpdate(lotId, 'series_created');

    res.status(201).json({
      series: {
        ...seriesRows[0],
        is_active: Boolean(seriesRows[0].is_active),
      },
      reservations: resvRows,
    });
  })
);

// 3. DELETE /api/series/:seriesId — Deactivate series and cancel all CONFIRMED occurrences
seriesRouter.delete(
  '/:seriesId',
  asyncHandler(async (req, res) => {
    const seriesId = Number(req.params.seriesId);
    if (!Number.isInteger(seriesId) || seriesId <= 0) {
      throw new AppError(400, 'INVALID_ID', 'Invalid seriesId');
    }

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT rs.series_id, rs.slot_id, v.user_id, ps.lot_id
         FROM reservation_series rs
         JOIN vehicles v       ON v.vehicle_id = rs.vehicle_id
         JOIN parking_slots ps ON ps.slot_id   = rs.slot_id
        WHERE rs.series_id = ?`,
      [seriesId]
    );

    if (rows.length === 0) {
      throw new AppError(404, 'SERIES_NOT_FOUND', 'Reservation series not found');
    }

    const series = rows[0];
    if (Number(series.user_id) !== req.user!.userId && req.user!.role !== 'ADMIN') {
      throw new AppError(403, 'FORBIDDEN', 'Not authorized to cancel this reservation series');
    }

    const [activeResvs] = await pool.execute<RowDataPacket[]>(
      `SELECT reservation_id
         FROM reservations
        WHERE series_id = ?
          AND status = 'CONFIRMED'
        ORDER BY reservation_id ASC`,
      [seriesId]
    );

    await withAuditUser(`user:${req.user!.userId}`, async (conn) => {
      await conn.execute(
        `UPDATE reservation_series SET is_active = FALSE WHERE series_id = ?`,
        [seriesId]
      );

      for (const r of activeResvs) {
        await conn.execute(`CALL cancel_booking(?, ?, ?)`, [
          Number(r.reservation_id),
          req.user!.userId,
          req.user!.role === 'ADMIN',
        ]);
      }
    });

    await dispatchPendingEmails();
    await broadcastLotUpdate(Number(series.lot_id), 'series_cancelled');

    res.status(200).json({
      message: 'Reservation series deactivated and active occurrences cancelled',
      series_id: seriesId,
      cancelled_occurrences: activeResvs.length,
    });
  })
);
