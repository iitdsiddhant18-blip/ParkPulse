import { Router } from 'express';
import { RowDataPacket } from 'mysql2/promise';
import { pool } from '../db';
import { AppError, asyncHandler } from '../errors';
import { requireAuth } from '../middleware/auth';

export const favoritesRouter = Router();

favoritesRouter.use(requireAuth);

favoritesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT
         fl.user_id,
         fl.lot_id,
         fl.created_at AS favorited_at,
         pl.name,
         pl.address,
         pl.city,
         pl.latitude,
         pl.longitude,
         COALESCE(vlo.total_slots, 0)     AS total_slots,
         COALESCE(vlo.available_slots, 0) AS available_slots,
         COALESCE(vlo.occupancy_pct, 0)   AS occupancy_pct
       FROM favorite_lots fl
       JOIN parking_lots pl ON pl.lot_id = fl.lot_id
       LEFT JOIN v_lot_occupancy vlo ON vlo.lot_id = pl.lot_id
      WHERE fl.user_id = ?
      ORDER BY fl.lot_id ASC`,
      [req.user!.userId]
    );

    res.status(200).json({ favorites: rows });
  })
);

favoritesRouter.post(
  '/:lotId',
  asyncHandler(async (req, res) => {
    const lotId = Number(req.params.lotId);
    if (!Number.isInteger(lotId) || lotId <= 0) {
      throw new AppError(400, 'INVALID_ID', 'Invalid lotId');
    }

    const [lotRows] = await pool.execute<RowDataPacket[]>(
      `SELECT lot_id FROM parking_lots WHERE lot_id = ?`,
      [lotId]
    );
    if (lotRows.length === 0) {
      throw new AppError(404, 'LOT_NOT_FOUND', 'Parking lot not found');
    }

    await pool.execute(
      `INSERT IGNORE INTO favorite_lots (user_id, lot_id) VALUES (?, ?)`,
      [req.user!.userId, lotId]
    );

    res.status(201).json({
      message: 'Added to favorite lots',
      user_id: req.user!.userId,
      lot_id: lotId,
    });
  })
);

favoritesRouter.delete(
  '/:lotId',
  asyncHandler(async (req, res) => {
    const lotId = Number(req.params.lotId);
    if (!Number.isInteger(lotId) || lotId <= 0) {
      throw new AppError(400, 'INVALID_ID', 'Invalid lotId');
    }

    await pool.execute(
      `DELETE FROM favorite_lots WHERE user_id = ? AND lot_id = ?`,
      [req.user!.userId, lotId]
    );

    res.status(200).json({
      message: 'Removed from favorite lots',
      user_id: req.user!.userId,
      lot_id: lotId,
    });
  })
);

