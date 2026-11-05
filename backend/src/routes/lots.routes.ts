import { Router } from 'express';
import { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { z } from 'zod';
import { pool, withAuditUser } from '../db';
import { AppError, asyncHandler } from '../errors';
import { requireAdmin, requireAuth } from '../middleware/auth';
import {
  addLotStreamClient,
  broadcastLotUpdate,
  buildLotStreamPayload,
  removeLotStreamClient,
  writeSseEvent,
} from '../services/sse';

export const lotsRouter = Router();

const vehicleTypeEnum = z.enum(['BIKE', 'CAR', 'SUV', 'EV']);
const slotStatusEnum = z.enum(['AVAILABLE', 'RESERVED', 'OCCUPIED', 'MAINTENANCE']);

const createLotSchema = z.object({
  name: z.string().trim().min(2).max(120),
  address: z.string().trim().min(2).max(255),
  city: z.string().trim().min(2).max(80),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  open_time: z.string().regex(/^\d{2}:\d{2}:\d{2}$/).default('00:00:00'),
  close_time: z.string().regex(/^\d{2}:\d{2}:\d{2}$/).default('23:59:59'),
  grace_period_minutes: z.number().int().min(0).max(120).default(15),
  is_active: z.boolean().default(true),
});

const updateLotSchema = createLotSchema.partial();

const createSlotSchema = z.object({
  slot_number: z.string().trim().min(1).max(10),
  slot_type: vehicleTypeEnum,
  status: slotStatusEnum.default('AVAILABLE'),
});

const updateSlotSchema = z
  .object({
    slot_number: z.string().trim().min(1).max(10).optional(),
    slot_type: vehicleTypeEnum.optional(),
    status: slotStatusEnum.optional(),
  })
  .refine(
    (d) => d.slot_number !== undefined || d.slot_type !== undefined || d.status !== undefined,
    { message: 'At least one slot field must be provided' }
  );

const upsertPricingSchema = z.object({
  vehicle_type: vehicleTypeEnum,
  base_rate_per_hour: z.number().positive(),
  overstay_penalty_per_hour: z.number().min(0).default(0),
});

const upsertMultiplierSchema = z.object({
  day_of_week: z.number().int().min(0).max(6),
  hour_of_day: z.number().int().min(0).max(23),
  multiplier: z.number().min(1.0).max(3.0),
});

export function normalizeDateTimeParam(raw: string): string {
  const trimmed = raw.trim().replace('T', ' ');
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(trimmed)) {
    return `${trimmed}:00`;
  }
  throw new AppError(
    400,
    'INVALID_DATETIME',
    `Invalid datetime format '${raw}'. Expected 'YYYY-MM-DD HH:mm:ss'`
  );
}

const DAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function parseWallClockToUtcMs(dtStr: string): number {
  const [datePart, timePart] = dtStr.split(' ');
  const [y, m, d] = datePart.split('-').map(Number);
  const [hh, mm, ss] = timePart.split(':').map(Number);
  return Date.UTC(y, m - 1, d, hh, mm, ss || 0);
}

function formatUtcMsAsWallClock(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(
    d.getUTCHours()
  )}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
}

// 1. GET /api/lots — Search & list parking lots with live occupancy, starting rate, and ratings
lotsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const city = typeof req.query.city === 'string' ? req.query.city.trim() : '';
    const vehicleType =
      typeof req.query.vehicle_type === 'string' && req.query.vehicle_type.trim() !== ''
        ? vehicleTypeEnum.parse(req.query.vehicle_type.trim().toUpperCase())
        : null;

    const conditions: string[] = ['pl.is_active = TRUE'];
    const params: Array<string | number> = [];

    if (q) {
      conditions.push('(pl.name LIKE ? OR pl.address LIKE ? OR pl.city LIKE ?)');
      const like = `%${q}%`;
      params.push(like, like, like);
    }

    if (city) {
      conditions.push('LOWER(pl.city) = LOWER(?)');
      params.push(city);
    }

    if (vehicleType) {
      conditions.push(
        `EXISTS (
           SELECT 1 FROM parking_slots ps_f
            WHERE ps_f.lot_id = pl.lot_id
              AND ps_f.slot_type = ?
         )`
      );
      params.push(vehicleType);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT
         pl.lot_id,
         pl.name,
         pl.address,
         pl.city,
         pl.latitude,
         pl.longitude,
         pl.open_time,
         pl.close_time,
         pl.grace_period_minutes,
         pl.is_active,
         COALESCE(vlo.total_slots, 0)       AS total_slots,
         COALESCE(vlo.available_slots, 0)   AS available_slots,
         COALESCE(vlo.reserved_slots, 0)    AS reserved_slots,
         COALESCE(vlo.occupied_slots, 0)    AS occupied_slots,
         COALESCE(vlo.maintenance_slots, 0) AS maintenance_slots,
         COALESCE(vlo.occupancy_pct, 0)     AS occupancy_pct,
         (SELECT MIN(pr.base_rate_per_hour)
            FROM pricing_rules pr
           WHERE pr.lot_id = pl.lot_id) AS min_hourly_rate,
         (SELECT ROUND(AVG(rv.rating), 2)
            FROM reviews rv
            JOIN reservations r ON r.reservation_id = rv.reservation_id
            JOIN parking_slots ps_r ON ps_r.slot_id = r.slot_id
           WHERE ps_r.lot_id = pl.lot_id) AS avg_rating,
         (SELECT COUNT(rv.review_id)
            FROM reviews rv
            JOIN reservations r ON r.reservation_id = rv.reservation_id
            JOIN parking_slots ps_r ON ps_r.slot_id = r.slot_id
           WHERE ps_r.lot_id = pl.lot_id) AS review_count
       FROM parking_lots pl
       LEFT JOIN v_lot_occupancy vlo ON vlo.lot_id = pl.lot_id
       ${whereClause}
       ORDER BY pl.lot_id ASC`,
      params
    );

    res.status(200).json({ lots: rows });
  })
);

// 2. GET /api/lots/:lotId/stream — Real-time Server-Sent Events (SSE) stream for live slot grid
lotsRouter.get(
  '/:lotId/stream',
  asyncHandler(async (req, res) => {
    const lotId = Number(req.params.lotId);
    if (!Number.isInteger(lotId) || lotId <= 0) {
      throw new AppError(400, 'INVALID_ID', 'Invalid lotId');
    }

    const initialPayload = await buildLotStreamPayload(lotId, 'initial_snapshot');
    if (!initialPayload) {
      throw new AppError(404, 'LOT_NOT_FOUND', 'Parking lot not found');
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();

    addLotStreamClient(lotId, res);
    writeSseEvent(res, 'snapshot', initialPayload);

    const heartbeat = setInterval(() => {
      try {
        res.write(': heartbeat\n\n');
      } catch {
        clearInterval(heartbeat);
        removeLotStreamClient(lotId, res);
      }
    }, 25000);

    req.on('close', () => {
      clearInterval(heartbeat);
      removeLotStreamClient(lotId, res);
    });
  })
);

// 3. GET /api/lots/:lotId — Lot detail with slots, pricing_rules, occupancy, and rating summary
lotsRouter.get(
  '/:lotId',
  asyncHandler(async (req, res) => {
    const lotId = Number(req.params.lotId);
    if (!Number.isInteger(lotId) || lotId <= 0) {
      throw new AppError(400, 'INVALID_ID', 'Invalid lotId');
    }

    const [lotRows] = await pool.execute<RowDataPacket[]>(
      `SELECT
         pl.*,
         COALESCE(vlo.total_slots, 0)       AS total_slots,
         COALESCE(vlo.available_slots, 0)   AS available_slots,
         COALESCE(vlo.reserved_slots, 0)    AS reserved_slots,
         COALESCE(vlo.occupied_slots, 0)    AS occupied_slots,
         COALESCE(vlo.maintenance_slots, 0) AS maintenance_slots,
         COALESCE(vlo.occupancy_pct, 0)     AS occupancy_pct,
         (SELECT ROUND(AVG(rv.rating), 2)
            FROM reviews rv
            JOIN reservations r ON r.reservation_id = rv.reservation_id
            JOIN parking_slots ps_r ON ps_r.slot_id = r.slot_id
           WHERE ps_r.lot_id = pl.lot_id) AS avg_rating,
         (SELECT COUNT(rv.review_id)
            FROM reviews rv
            JOIN reservations r ON r.reservation_id = rv.reservation_id
            JOIN parking_slots ps_r ON ps_r.slot_id = r.slot_id
           WHERE ps_r.lot_id = pl.lot_id) AS review_count
       FROM parking_lots pl
       LEFT JOIN v_lot_occupancy vlo ON vlo.lot_id = pl.lot_id
       WHERE pl.lot_id = ?`,
      [lotId]
    );

    if (lotRows.length === 0) {
      throw new AppError(404, 'LOT_NOT_FOUND', 'Parking lot not found');
    }

    const [slots] = await pool.execute<RowDataPacket[]>(
      `SELECT slot_id, lot_id, slot_number, slot_type, status
         FROM parking_slots
        WHERE lot_id = ?
        ORDER BY slot_number ASC, slot_id ASC`,
      [lotId]
    );

    const [pricingRules] = await pool.execute<RowDataPacket[]>(
      `SELECT rule_id, lot_id, vehicle_type, base_rate_per_hour, overstay_penalty_per_hour
         FROM pricing_rules
        WHERE lot_id = ?
        ORDER BY FIELD(vehicle_type, 'BIKE', 'CAR', 'SUV', 'EV')`,
      [lotId]
    );

    res.status(200).json({
      lot: {
        ...lotRows[0],
        is_active: Boolean(lotRows[0].is_active),
        slots,
        pricing_rules: pricingRules,
      },
    });
  })
);

// 4. GET /api/lots/:lotId/availability — Window-based slot availability + dynamic price quote
lotsRouter.get(
  '/:lotId/availability',
  asyncHandler(async (req, res) => {
    const lotId = Number(req.params.lotId);
    if (!Number.isInteger(lotId) || lotId <= 0) {
      throw new AppError(400, 'INVALID_ID', 'Invalid lotId');
    }

    const startRaw = typeof req.query.start_time === 'string' ? req.query.start_time : '';
    const endRaw = typeof req.query.end_time === 'string' ? req.query.end_time : '';
    if (!startRaw || !endRaw) {
      throw new AppError(
        400,
        'MISSING_TIME_WINDOW',
        'Both start_time and end_time query parameters are required'
      );
    }

    const startTime = normalizeDateTimeParam(startRaw);
    const endTime = normalizeDateTimeParam(endRaw);
    if (endTime <= startTime) {
      throw new AppError(400, 'INVALID_TIME_WINDOW', 'end_time must be after start_time');
    }

    const vehicleType =
      typeof req.query.vehicle_type === 'string' && req.query.vehicle_type.trim() !== ''
        ? vehicleTypeEnum.parse(req.query.vehicle_type.trim().toUpperCase())
        : null;

    const [lotCheck] = await pool.execute<RowDataPacket[]>(
      `SELECT lot_id, name, city FROM parking_lots WHERE lot_id = ?`,
      [lotId]
    );
    if (lotCheck.length === 0) {
      throw new AppError(404, 'LOT_NOT_FOUND', 'Parking lot not found');
    }

    const params: Array<string | number> = [startTime, endTime, startTime, endTime, lotId];
    let typeFilterSql = '';
    if (vehicleType) {
      typeFilterSql = 'AND ps.slot_type = ?';
      params.push(vehicleType);
    }

    const [slots] = await pool.execute<RowDataPacket[]>(
      `SELECT
         ps.slot_id,
         ps.lot_id,
         ps.slot_number,
         ps.slot_type,
         ps.status AS current_status,
         CASE
           WHEN ps.status = 'MAINTENANCE' THEN 0
           WHEN EXISTS (
             SELECT 1
               FROM reservations r
              WHERE r.slot_id = ps.slot_id
                AND r.status IN ('CONFIRMED', 'CHECKED_IN')
                AND ? < r.end_time
                AND ? > r.start_time
           ) THEN 0
           ELSE 1
         END AS is_available_for_window,
         CASE
           WHEN EXISTS (
             SELECT 1
               FROM pricing_rules pr
              WHERE pr.lot_id = ps.lot_id
                AND pr.vehicle_type = ps.slot_type
           ) THEN get_dynamic_price(ps.lot_id, ps.slot_type, ?, ?)
           ELSE NULL
         END AS quoted_amount
       FROM parking_slots ps
       WHERE ps.lot_id = ?
         ${typeFilterSql}
       ORDER BY ps.slot_number ASC, ps.slot_id ASC`,
      params
    );

    const formattedSlots = slots.map((s) => ({
      slot_id: Number(s.slot_id),
      lot_id: Number(s.lot_id),
      slot_number: s.slot_number,
      slot_type: s.slot_type,
      current_status: s.current_status,
      is_available_for_window: Boolean(s.is_available_for_window),
      quoted_amount: s.quoted_amount,
    }));

    res.status(200).json({
      lot_id: lotId,
      start_time: startTime,
      end_time: endTime,
      vehicle_type: vehicleType,
      available_count: formattedSlots.filter((s) => s.is_available_for_window).length,
      slots: formattedSlots,
    });
  })
);

// 5. GET /api/lots/:lotId/quote-breakdown — Hour-by-hour dynamic price breakdown & SQL get_dynamic_price total
lotsRouter.get(
  '/:lotId/quote-breakdown',
  asyncHandler(async (req, res) => {
    const lotId = Number(req.params.lotId);
    if (!Number.isInteger(lotId) || lotId <= 0) {
      throw new AppError(400, 'INVALID_ID', 'Invalid lotId');
    }

    const startRaw = typeof req.query.start_time === 'string' ? req.query.start_time : '';
    const endRaw = typeof req.query.end_time === 'string' ? req.query.end_time : '';
    const vehicleTypeRaw =
      typeof req.query.vehicle_type === 'string' ? req.query.vehicle_type.trim().toUpperCase() : 'CAR';
    const vehicleType = vehicleTypeEnum.parse(vehicleTypeRaw);

    if (!startRaw || !endRaw) {
      throw new AppError(
        400,
        'MISSING_TIME_WINDOW',
        'Both start_time and end_time query parameters are required'
      );
    }

    const startTime = normalizeDateTimeParam(startRaw);
    const endTime = normalizeDateTimeParam(endRaw);
    if (endTime <= startTime) {
      throw new AppError(400, 'INVALID_TIME_WINDOW', 'end_time must be after start_time');
    }

    const [ruleRows] = await pool.execute<RowDataPacket[]>(
      `SELECT base_rate_per_hour, overstay_penalty_per_hour
         FROM pricing_rules
        WHERE lot_id = ? AND vehicle_type = ?
        LIMIT 1`,
      [lotId, vehicleType]
    );
    if (ruleRows.length === 0) {
      throw new AppError(404, 'PRICING_RULE_NOT_FOUND', 'Pricing rule not found for lot and vehicle type');
    }

    const baseRate = Number(ruleRows[0].base_rate_per_hour);
    const penaltyRate = Number(ruleRows[0].overstay_penalty_per_hour);

    const [multRows] = await pool.execute<RowDataPacket[]>(
      `SELECT day_of_week, hour_of_day, multiplier
         FROM peak_multipliers
        WHERE lot_id = ?`,
      [lotId]
    );
    const multMap = new Map<string, number>();
    for (const m of multRows) {
      multMap.set(`${m.day_of_week}-${m.hour_of_day}`, Number(m.multiplier));
    }

    const [quoteRows] = await pool.execute<RowDataPacket[]>(
      `SELECT get_dynamic_price(?, ?, ?, ?) AS total_quote`,
      [lotId, vehicleType, startTime, endTime]
    );
    const totalQuote = Number(quoteRows[0].total_quote);

    const startMs = parseWallClockToUtcMs(startTime);
    const endMs = parseWallClockToUtcMs(endTime);
    let cursorMs = startMs;

    const slices: Array<{
      slice_start: string;
      slice_end: string;
      day_of_week: number;
      day_name: string;
      hour_of_day: number;
      minutes: number;
      base_rate_per_hour: number;
      multiplier: number;
      is_peak: boolean;
      slice_amount: number;
    }> = [];

    while (cursorMs < endMs) {
      const dt = new Date(cursorMs);
      const nextHourMs = Date.UTC(
        dt.getUTCFullYear(),
        dt.getUTCMonth(),
        dt.getUTCDate(),
        dt.getUTCHours() + 1,
        0,
        0
      );
      const sliceEndMs = Math.min(endMs, nextHourMs);
      const minutes = (sliceEndMs - cursorMs) / 60_000;
      const mysqlWeekday = (dt.getUTCDay() + 6) % 7;
      const hourOfDay = dt.getUTCHours();
      const mult = multMap.get(`${mysqlWeekday}-${hourOfDay}`) ?? 1.0;
      const sliceAmount = Number((baseRate * mult * (minutes / 60.0)).toFixed(2));

      slices.push({
        slice_start: formatUtcMsAsWallClock(cursorMs),
        slice_end: formatUtcMsAsWallClock(sliceEndMs),
        day_of_week: mysqlWeekday,
        day_name: DAY_NAMES[mysqlWeekday],
        hour_of_day: hourOfDay,
        minutes: Number(minutes.toFixed(2)),
        base_rate_per_hour: baseRate,
        multiplier: mult,
        is_peak: mult > 1.0,
        slice_amount: sliceAmount,
      });

      cursorMs = sliceEndMs;
    }

    res.status(200).json({
      lot_id: lotId,
      vehicle_type: vehicleType,
      start_time: startTime,
      end_time: endTime,
      base_rate_per_hour: baseRate,
      overstay_penalty_per_hour: penaltyRate,
      total_quote: totalQuote,
      slices,
    });
  })
);

// 6. GET /api/lots/:lotId/reviews — Public list of reviews for a parking lot
lotsRouter.get(
  '/:lotId/reviews',
  asyncHandler(async (req, res) => {
    const lotId = Number(req.params.lotId);
    if (!Number.isInteger(lotId) || lotId <= 0) {
      throw new AppError(400, 'INVALID_ID', 'Invalid lotId');
    }

    const [reviews] = await pool.execute<RowDataPacket[]>(
      `SELECT
         rv.review_id,
         rv.reservation_id,
         rv.rating,
         rv.comment,
         rv.created_at,
         u.user_id,
         u.full_name AS reviewer_name,
         v.vehicle_type,
         ps.slot_number,
         ps.lot_id
       FROM reviews rv
       JOIN reservations r   ON r.reservation_id = rv.reservation_id
       JOIN vehicles v       ON v.vehicle_id     = r.vehicle_id
       JOIN users u          ON u.user_id        = v.user_id
       JOIN parking_slots ps ON ps.slot_id       = r.slot_id
      WHERE ps.lot_id = ?
      ORDER BY rv.created_at DESC, rv.review_id DESC`,
      [lotId]
    );

    res.status(200).json({ reviews });
  })
);

// 7. POST /api/lots — Admin: Create a new parking lot
lotsRouter.post(
  '/',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const body = createLotSchema.parse(req.body);

    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO parking_lots
         (name, address, city, latitude, longitude, open_time, close_time, grace_period_minutes, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        body.name,
        body.address,
        body.city,
        body.latitude,
        body.longitude,
        body.open_time,
        body.close_time,
        body.grace_period_minutes,
        body.is_active,
      ]
    );

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT * FROM parking_lots WHERE lot_id = ?`,
      [result.insertId]
    );

    res.status(201).json({
      lot: {
        ...rows[0],
        is_active: Boolean(rows[0].is_active),
      },
    });
  })
);

// 8. PUT /api/lots/:lotId — Admin: Update parking lot details
lotsRouter.put(
  '/:lotId',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const lotId = Number(req.params.lotId);
    if (!Number.isInteger(lotId) || lotId <= 0) {
      throw new AppError(400, 'INVALID_ID', 'Invalid lotId');
    }

    const body = updateLotSchema.parse(req.body);

    const [existing] = await pool.execute<RowDataPacket[]>(
      `SELECT * FROM parking_lots WHERE lot_id = ?`,
      [lotId]
    );
    if (existing.length === 0) {
      throw new AppError(404, 'LOT_NOT_FOUND', 'Parking lot not found');
    }

    const cur = existing[0];
    await pool.execute(
      `UPDATE parking_lots
          SET name = ?,
              address = ?,
              city = ?,
              latitude = ?,
              longitude = ?,
              open_time = ?,
              close_time = ?,
              grace_period_minutes = ?,
              is_active = ?
        WHERE lot_id = ?`,
      [
        body.name ?? cur.name,
        body.address ?? cur.address,
        body.city ?? cur.city,
        body.latitude ?? cur.latitude,
        body.longitude ?? cur.longitude,
        body.open_time ?? cur.open_time,
        body.close_time ?? cur.close_time,
        body.grace_period_minutes ?? cur.grace_period_minutes,
        body.is_active !== undefined ? body.is_active : Boolean(cur.is_active),
        lotId,
      ]
    );

    const [updated] = await pool.execute<RowDataPacket[]>(
      `SELECT * FROM parking_lots WHERE lot_id = ?`,
      [lotId]
    );

    res.status(200).json({
      lot: {
        ...updated[0],
        is_active: Boolean(updated[0].is_active),
      },
    });
  })
);

// 9. DELETE /api/lots/:lotId — Admin: Delete a parking lot
lotsRouter.delete(
  '/:lotId',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const lotId = Number(req.params.lotId);
    if (!Number.isInteger(lotId) || lotId <= 0) {
      throw new AppError(400, 'INVALID_ID', 'Invalid lotId');
    }

    const [existing] = await pool.execute<RowDataPacket[]>(
      `SELECT lot_id FROM parking_lots WHERE lot_id = ?`,
      [lotId]
    );
    if (existing.length === 0) {
      throw new AppError(404, 'LOT_NOT_FOUND', 'Parking lot not found');
    }

    await pool.execute(`DELETE FROM parking_lots WHERE lot_id = ?`, [lotId]);
    res.status(200).json({ message: 'Parking lot deleted', lot_id: lotId });
  })
);

// 10. POST /api/lots/:lotId/slots — Admin: Add a slot to a parking lot
lotsRouter.post(
  '/:lotId/slots',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const lotId = Number(req.params.lotId);
    if (!Number.isInteger(lotId) || lotId <= 0) {
      throw new AppError(400, 'INVALID_ID', 'Invalid lotId');
    }

    const body = createSlotSchema.parse(req.body);

    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO parking_slots (lot_id, slot_number, slot_type, status)
       VALUES (?, ?, ?, ?)`,
      [lotId, body.slot_number, body.slot_type, body.status]
    );

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT slot_id, lot_id, slot_number, slot_type, status
         FROM parking_slots
        WHERE slot_id = ?`,
      [result.insertId]
    );

    await broadcastLotUpdate(lotId, 'slot_created');
    res.status(201).json({ slot: rows[0] });
  })
);

// 11. PUT /api/lots/:lotId/slots/:slotId — Admin: Update slot number, type, or status
lotsRouter.put(
  '/:lotId/slots/:slotId',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const lotId = Number(req.params.lotId);
    const slotId = Number(req.params.slotId);
    if (!Number.isInteger(lotId) || lotId <= 0 || !Number.isInteger(slotId) || slotId <= 0) {
      throw new AppError(400, 'INVALID_ID', 'Invalid lotId or slotId');
    }

    const body = updateSlotSchema.parse(req.body);

    const [existing] = await pool.execute<RowDataPacket[]>(
      `SELECT slot_id, lot_id, slot_number, slot_type, status
         FROM parking_slots
        WHERE slot_id = ? AND lot_id = ?`,
      [slotId, lotId]
    );
    if (existing.length === 0) {
      throw new AppError(404, 'SLOT_NOT_FOUND', 'Parking slot not found in this lot');
    }

    const cur = existing[0];
    await pool.execute(
      `UPDATE parking_slots
          SET slot_number = ?, slot_type = ?, status = ?
        WHERE slot_id = ? AND lot_id = ?`,
      [
        body.slot_number ?? cur.slot_number,
        body.slot_type ?? cur.slot_type,
        body.status ?? cur.status,
        slotId,
        lotId,
      ]
    );

    const [updated] = await pool.execute<RowDataPacket[]>(
      `SELECT slot_id, lot_id, slot_number, slot_type, status
         FROM parking_slots
        WHERE slot_id = ?`,
      [slotId]
    );

    await broadcastLotUpdate(lotId, 'slot_updated');
    res.status(200).json({ slot: updated[0] });
  })
);

// 12. DELETE /api/lots/:lotId/slots/:slotId — Admin: Delete a slot
lotsRouter.delete(
  '/:lotId/slots/:slotId',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const lotId = Number(req.params.lotId);
    const slotId = Number(req.params.slotId);
    if (!Number.isInteger(lotId) || lotId <= 0 || !Number.isInteger(slotId) || slotId <= 0) {
      throw new AppError(400, 'INVALID_ID', 'Invalid lotId or slotId');
    }

    const [existing] = await pool.execute<RowDataPacket[]>(
      `SELECT slot_id FROM parking_slots WHERE slot_id = ? AND lot_id = ?`,
      [slotId, lotId]
    );
    if (existing.length === 0) {
      throw new AppError(404, 'SLOT_NOT_FOUND', 'Parking slot not found in this lot');
    }

    await pool.execute(`DELETE FROM parking_slots WHERE slot_id = ? AND lot_id = ?`, [
      slotId,
      lotId,
    ]);
    await broadcastLotUpdate(lotId, 'slot_deleted');
    res.status(200).json({ message: 'Parking slot deleted', slot_id: slotId });
  })
);

// 13. PUT /api/lots/:lotId/pricing — Admin: Upsert pricing rule per vehicle type (audited via @app_user)
lotsRouter.put(
  '/:lotId/pricing',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const lotId = Number(req.params.lotId);
    if (!Number.isInteger(lotId) || lotId <= 0) {
      throw new AppError(400, 'INVALID_ID', 'Invalid lotId');
    }

    const body = upsertPricingSchema.parse(req.body);

    const pricingRule = await withAuditUser(`user:${req.user!.userId}`, async (conn) => {
      await conn.execute(
        `INSERT INTO pricing_rules (lot_id, vehicle_type, base_rate_per_hour, overstay_penalty_per_hour)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           base_rate_per_hour = VALUES(base_rate_per_hour),
           overstay_penalty_per_hour = VALUES(overstay_penalty_per_hour)`,
        [lotId, body.vehicle_type, body.base_rate_per_hour, body.overstay_penalty_per_hour]
      );

      const [rows] = await conn.execute<RowDataPacket[]>(
        `SELECT rule_id, lot_id, vehicle_type, base_rate_per_hour, overstay_penalty_per_hour
           FROM pricing_rules
          WHERE lot_id = ? AND vehicle_type = ?`,
        [lotId, body.vehicle_type]
      );
      return rows[0];
    });

    res.status(200).json({ pricing_rule: pricingRule });
  })
);

// 14. PUT /api/lots/:lotId/peak-multipliers — Admin: Upsert peak multiplier for day_of_week and hour_of_day
lotsRouter.put(
  '/:lotId/peak-multipliers',
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const lotId = Number(req.params.lotId);
    if (!Number.isInteger(lotId) || lotId <= 0) {
      throw new AppError(400, 'INVALID_ID', 'Invalid lotId');
    }

    const body = upsertMultiplierSchema.parse(req.body);

    await pool.execute(
      `INSERT INTO peak_multipliers (lot_id, day_of_week, hour_of_day, multiplier)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE multiplier = VALUES(multiplier)`,
      [lotId, body.day_of_week, body.hour_of_day, body.multiplier]
    );

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT multiplier_id, lot_id, day_of_week, hour_of_day, multiplier
         FROM peak_multipliers
        WHERE lot_id = ? AND day_of_week = ? AND hour_of_day = ?`,
      [lotId, body.day_of_week, body.hour_of_day]
    );

    res.status(200).json({ peak_multiplier: rows[0] });
  })
);
