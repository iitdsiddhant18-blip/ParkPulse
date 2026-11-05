import { Router } from 'express';
import { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { z } from 'zod';
import { pool } from '../db';
import { AppError, asyncHandler } from '../errors';
import { requireAuth } from '../middleware/auth';

export const reviewsRouter = Router();

const createReviewSchema = z.object({
  reservation_id: z.number().int().positive(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(500).optional().nullable(),
});

reviewsRouter.use(requireAuth);

reviewsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = createReviewSchema.parse(req.body);

    const [resvRows] = await pool.execute<RowDataPacket[]>(
      `SELECT r.reservation_id, r.status, v.user_id, ps.lot_id
         FROM reservations r
         JOIN vehicles v       ON v.vehicle_id = r.vehicle_id
         JOIN parking_slots ps ON ps.slot_id   = r.slot_id
        WHERE r.reservation_id = ?`,
      [body.reservation_id]
    );

    if (resvRows.length === 0) {
      throw new AppError(404, 'RESERVATION_NOT_FOUND', 'Reservation not found');
    }

    const resv = resvRows[0];
    if (Number(resv.user_id) !== req.user!.userId) {
      throw new AppError(403, 'FORBIDDEN', 'You can only review your own reservations');
    }

    if (resv.status !== 'COMPLETED') {
      throw new AppError(
        400,
        'RESERVATION_NOT_COMPLETED',
        'Only COMPLETED reservations can be reviewed'
      );
    }

    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO reviews (reservation_id, rating, comment)
       VALUES (?, ?, ?)`,
      [body.reservation_id, body.rating, body.comment ?? null]
    );

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT review_id, reservation_id, rating, comment, created_at
         FROM reviews
        WHERE review_id = ?`,
      [result.insertId]
    );

    res.status(201).json({ review: rows[0] });
  })
);

reviewsRouter.delete(
  '/:reviewId',
  asyncHandler(async (req, res) => {
    const reviewId = Number(req.params.reviewId);
    if (!Number.isInteger(reviewId) || reviewId <= 0) {
      throw new AppError(400, 'INVALID_ID', 'Invalid reviewId');
    }

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT rv.review_id, v.user_id
         FROM reviews rv
         JOIN reservations r ON r.reservation_id = rv.reservation_id
         JOIN vehicles v     ON v.vehicle_id     = r.vehicle_id
        WHERE rv.review_id = ?`,
      [reviewId]
    );

    if (rows.length === 0) {
      throw new AppError(404, 'REVIEW_NOT_FOUND', 'Review not found');
    }

    if (Number(rows[0].user_id) !== req.user!.userId && req.user!.role !== 'ADMIN') {
      throw new AppError(403, 'FORBIDDEN', 'Not authorized to delete this review');
    }

    await pool.execute(`DELETE FROM reviews WHERE review_id = ?`, [reviewId]);
    res.status(200).json({ message: 'Review deleted', review_id: reviewId });
  })
);

