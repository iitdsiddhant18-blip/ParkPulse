import { Router } from 'express';
import { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { z } from 'zod';
import { pool } from '../db';
import { AppError, asyncHandler } from '../errors';
import { requireAuth } from '../middleware/auth';
import { normalizeDateTimeParam } from './lots.routes';

export const waitlistRouter = Router();

const createWaitlistSchema = z.object({
  vehicle_id: z.number().int().positive(),
  lot_id: z.number().int().positive(),
  desired_start: z.string().min(10),
  desired_end: z.string().min(10),
});

waitlistRouter.use(requireAuth);

// 1. GET /api/waitlist — List current user's waitlist entries
waitlistRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT
         w.waitlist_id,
         w.vehicle_id,
         w.lot_id,
         w.desired_start,
         w.desired_end,
         w.status,
         w.created_at,
         v.plate_number,
         v.vehicle_type,
         pl.name AS lot_name,
         pl.city AS lot_city
       FROM waitlist w
       JOIN vehicles v      ON v.vehicle_id = w.vehicle_id
       JOIN parking_lots pl ON pl.lot_id    = w.lot_id
      WHERE v.user_id = ?
      ORDER BY w.created_at DESC, w.waitlist_id DESC`,
      [req.user!.userId]
    );

    res.status(200).json({ waitlist: rows });
  })
);

// 2. POST /api/waitlist — Join waitlist for a parking lot and desired time window
waitlistRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = createWaitlistSchema.parse(req.body);
    const desiredStart = normalizeDateTimeParam(body.desired_start);
    const desiredEnd = normalizeDateTimeParam(body.desired_end);

    if (desiredEnd <= desiredStart) {
      throw new AppError(400, 'INVALID_TIME_WINDOW', 'desired_end must be after desired_start');
    }

    const [vehRows] = await pool.execute<RowDataPacket[]>(
      `SELECT vehicle_id, user_id, vehicle_type FROM vehicles WHERE vehicle_id = ?`,
      [body.vehicle_id]
    );
    if (vehRows.length === 0) {
      throw new AppError(404, 'VEHICLE_NOT_FOUND', 'Vehicle not found');
    }
    if (Number(vehRows[0].user_id) !== req.user!.userId && req.user!.role !== 'ADMIN') {
      throw new AppError(403, 'FORBIDDEN', 'You can only waitlist your own vehicles');
    }

    const [lotRows] = await pool.execute<RowDataPacket[]>(
      `SELECT lot_id FROM parking_lots WHERE lot_id = ?`,
      [body.lot_id]
    );
    if (lotRows.length === 0) {
      throw new AppError(404, 'LOT_NOT_FOUND', 'Parking lot not found');
    }

    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO waitlist (vehicle_id, lot_id, desired_start, desired_end)
       VALUES (?, ?, ?, ?)`,
      [body.vehicle_id, body.lot_id, desiredStart, desiredEnd]
    );

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT
         w.waitlist_id,
         w.vehicle_id,
         w.lot_id,
         w.desired_start,
         w.desired_end,
         w.status,
         w.created_at,
         v.plate_number,
         v.vehicle_type,
         pl.name AS lot_name
       FROM waitlist w
       JOIN vehicles v      ON v.vehicle_id = w.vehicle_id
       JOIN parking_lots pl ON pl.lot_id    = w.lot_id
      WHERE w.waitlist_id = ?`,
      [result.insertId]
    );

    res.status(201).json({ waitlist_entry: rows[0] });
  })
);

// 3. DELETE /api/waitlist/:waitlistId — Cancel a waitlist entry
waitlistRouter.delete(
  '/:waitlistId',
  asyncHandler(async (req, res) => {
    const waitlistId = Number(req.params.waitlistId);
    if (!Number.isInteger(waitlistId) || waitlistId <= 0) {
      throw new AppError(400, 'INVALID_ID', 'Invalid waitlistId');
    }

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT w.waitlist_id, w.status, v.user_id
         FROM waitlist w
         JOIN vehicles v ON v.vehicle_id = w.vehicle_id
        WHERE w.waitlist_id = ?`,
      [waitlistId]
    );

    if (rows.length === 0) {
      throw new AppError(404, 'WAITLIST_NOT_FOUND', 'Waitlist entry not found');
    }

    if (Number(rows[0].user_id) !== req.user!.userId && req.user!.role !== 'ADMIN') {
      throw new AppError(403, 'FORBIDDEN', 'Not authorized to cancel this waitlist entry');
    }

    await pool.execute(
      `UPDATE waitlist SET status = 'CANCELLED' WHERE waitlist_id = ?`,
      [waitlistId]
    );

    res.status(200).json({
      message: 'Waitlist entry cancelled',
      waitlist_id: waitlistId,
    });
  })
);
