import { Router } from 'express';
import { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { z } from 'zod';
import { pool } from '../db';
import { AppError, asyncHandler } from '../errors';
import { requireAuth } from '../middleware/auth';

export const vehiclesRouter = Router();

const vehicleBodySchema = z.object({
  plate_number: z
    .string()
    .trim()
    .min(4)
    .max(20)
    .transform((v) => v.toUpperCase().replace(/\s+/g, '')),
  vehicle_type: z.enum(['BIKE', 'CAR', 'SUV', 'EV']),
});

const vehicleUpdateSchema = z
  .object({
    plate_number: z
      .string()
      .trim()
      .min(4)
      .max(20)
      .transform((v) => v.toUpperCase().replace(/\s+/g, ''))
      .optional(),
    vehicle_type: z.enum(['BIKE', 'CAR', 'SUV', 'EV']).optional(),
  })
  .refine((d) => d.plate_number !== undefined || d.vehicle_type !== undefined, {
    message: 'At least one of plate_number or vehicle_type must be provided',
  });

vehiclesRouter.use(requireAuth);

vehiclesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT vehicle_id, user_id, plate_number, vehicle_type, created_at
         FROM vehicles
        WHERE user_id = ?
        ORDER BY vehicle_id ASC`,
      [req.user!.userId]
    );
    res.status(200).json({ vehicles: rows });
  })
);

vehiclesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = vehicleBodySchema.parse(req.body);

    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO vehicles (user_id, plate_number, vehicle_type)
       VALUES (?, ?, ?)`,
      [req.user!.userId, body.plate_number, body.vehicle_type]
    );

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT vehicle_id, user_id, plate_number, vehicle_type, created_at
         FROM vehicles
        WHERE vehicle_id = ?`,
      [result.insertId]
    );

    res.status(201).json({ vehicle: rows[0] });
  })
);

vehiclesRouter.put(
  '/:vehicleId',
  asyncHandler(async (req, res) => {
    const vehicleId = Number(req.params.vehicleId);
    if (!Number.isInteger(vehicleId) || vehicleId <= 0) {
      throw new AppError(400, 'INVALID_ID', 'Invalid vehicleId');
    }

    const body = vehicleUpdateSchema.parse(req.body);

    const [existing] = await pool.execute<RowDataPacket[]>(
      `SELECT vehicle_id, user_id, plate_number, vehicle_type
         FROM vehicles
        WHERE vehicle_id = ?`,
      [vehicleId]
    );

    if (existing.length === 0) {
      throw new AppError(404, 'VEHICLE_NOT_FOUND', 'Vehicle not found');
    }

    const vehicle = existing[0];
    if (Number(vehicle.user_id) !== req.user!.userId && req.user!.role !== 'ADMIN') {
      throw new AppError(403, 'FORBIDDEN', 'You do not own this vehicle');
    }

    const newPlate = body.plate_number ?? vehicle.plate_number;
    const newType = body.vehicle_type ?? vehicle.vehicle_type;

    await pool.execute(
      `UPDATE vehicles
          SET plate_number = ?, vehicle_type = ?
        WHERE vehicle_id = ?`,
      [newPlate, newType, vehicleId]
    );

    const [updated] = await pool.execute<RowDataPacket[]>(
      `SELECT vehicle_id, user_id, plate_number, vehicle_type, created_at
         FROM vehicles
        WHERE vehicle_id = ?`,
      [vehicleId]
    );

    res.status(200).json({ vehicle: updated[0] });
  })
);

vehiclesRouter.delete(
  '/:vehicleId',
  asyncHandler(async (req, res) => {
    const vehicleId = Number(req.params.vehicleId);
    if (!Number.isInteger(vehicleId) || vehicleId <= 0) {
      throw new AppError(400, 'INVALID_ID', 'Invalid vehicleId');
    }

    const [existing] = await pool.execute<RowDataPacket[]>(
      `SELECT vehicle_id, user_id
         FROM vehicles
        WHERE vehicle_id = ?`,
      [vehicleId]
    );

    if (existing.length === 0) {
      throw new AppError(404, 'VEHICLE_NOT_FOUND', 'Vehicle not found');
    }

    if (Number(existing[0].user_id) !== req.user!.userId && req.user!.role !== 'ADMIN') {
      throw new AppError(403, 'FORBIDDEN', 'You do not own this vehicle');
    }

    await pool.execute(`DELETE FROM vehicles WHERE vehicle_id = ?`, [vehicleId]);
    res.status(200).json({ message: 'Vehicle deleted', vehicle_id: vehicleId });
  })
);

