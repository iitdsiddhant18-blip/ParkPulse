import { Router } from 'express';
import { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import QRCode from 'qrcode';
import { z } from 'zod';
import { pool, withAuditUser } from '../db';
import { AppError, asyncHandler } from '../errors';
import { requireAuth } from '../middleware/auth';
import { normalizeDateTimeParam } from './lots.routes';
import { dispatchPendingEmails } from '../services/mailer';
import { broadcastLotUpdate } from '../services/sse';

export const reservationsRouter = Router();

const paymentMethodEnum = z.enum(['CARD', 'UPI', 'CASH', 'WALLET']);

const createReservationSchema = z.object({
  vehicle_id: z.number().int().positive(),
  slot_id: z.number().int().positive(),
  start_time: z.string().min(10),
  end_time: z.string().min(10),
  pay_now: z.boolean().optional().default(false),
  payment_method: paymentMethodEnum.optional().default('UPI'),
});

const modifyReservationSchema = z
  .object({
    slot_id: z.number().int().positive().optional(),
    start_time: z.string().min(10).optional(),
    end_time: z.string().min(10).optional(),
  })
  .refine(
    (d) => d.slot_id !== undefined || d.start_time !== undefined || d.end_time !== undefined,
    { message: 'At least one of slot_id, start_time, or end_time must be provided' }
  );

const payReservationSchema = z.object({
  method: paymentMethodEnum.default('UPI'),
});

const checkInSchema = z.object({
  qr_token: z.string().trim().length(36),
  checkin_time: z.string().optional(),
});

const checkOutSchema = z.object({
  payment_method: paymentMethodEnum.default('UPI'),
  checkout_time: z.string().optional(),
});

const qrScanSchema = z.object({
  qr_token: z.string().trim().length(36),
  action: z.enum(['AUTO', 'CHECK_IN', 'CHECK_OUT']).optional().default('AUTO'),
  scan_time: z.string().optional(),
  payment_method: paymentMethodEnum.optional().default('UPI'),
});

async function fetchReservationDetail(reservationId: number): Promise<RowDataPacket | null> {
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
       v.user_id,
       v.plate_number,
       v.vehicle_type,
       u.full_name AS user_name,
       u.email AS user_email,
       ps.slot_number,
       ps.slot_type,
       ps.status AS slot_status,
       pl.lot_id,
       pl.name AS lot_name,
       pl.address AS lot_address,
       pl.city AS lot_city
     FROM reservations r
     JOIN vehicles v       ON v.vehicle_id = r.vehicle_id
     JOIN users u          ON u.user_id    = v.user_id
     JOIN parking_slots ps ON ps.slot_id   = r.slot_id
     JOIN parking_lots pl  ON pl.lot_id    = ps.lot_id
     WHERE r.reservation_id = ?
     LIMIT 1`,
    [reservationId]
  );
  return rows[0] ?? null;
}

async function generateQrDataUrl(reservationId: number, qrToken: string): Promise<string> {
  return QRCode.toDataURL(
    JSON.stringify({
      reservation_id: reservationId,
      qr_token: qrToken,
    })
  );
}

reservationsRouter.use(requireAuth);

// 1. POST /api/reservations — Book a slot via Phase 1b `book_slot` stored procedure
reservationsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = createReservationSchema.parse(req.body);
    const startTime = normalizeDateTimeParam(body.start_time);
    const endTime = normalizeDateTimeParam(body.end_time);

    const [vehRows] = await pool.execute<RowDataPacket[]>(
      `SELECT vehicle_id, user_id, vehicle_type FROM vehicles WHERE vehicle_id = ?`,
      [body.vehicle_id]
    );
    if (vehRows.length === 0) {
      throw new AppError(404, 'VEHICLE_NOT_FOUND', 'Vehicle not found');
    }
    if (Number(vehRows[0].user_id) !== req.user!.userId && req.user!.role !== 'ADMIN') {
      throw new AppError(403, 'FORBIDDEN', 'You can only book with your own vehicles');
    }

    const reservationId = await withAuditUser(`user:${req.user!.userId}`, async (conn) => {
      await conn.execute(
        `CALL book_slot(?, ?, ?, ?, NULL, @p_res_id, @p_quote, @p_qr)`,
        [body.vehicle_id, body.slot_id, startTime, endTime]
      );

      const [outRows] = await conn.execute<RowDataPacket[]>(
        `SELECT @p_res_id AS reservation_id, @p_quote AS quoted_amount, @p_qr AS qr_token`
      );
      const resId = Number(outRows[0].reservation_id);
      const quotedAmount = Number(outRows[0].quoted_amount);

      if (body.pay_now && quotedAmount > 0) {
        await conn.execute(
          `INSERT INTO payments
             (reservation_id, amount, payment_type, method, status, transaction_ref, paid_at)
           VALUES (?, ?, 'BOOKING', ?, 'PAID', ?, ?)`,
          [
            resId,
            quotedAmount,
            body.payment_method,
            `TXN-BKG-${resId}-${Date.now()}`,
            startTime,
          ]
        );
      }

      return resId;
    });

    const detail = await fetchReservationDetail(reservationId);
    const qrCodeDataUrl = await generateQrDataUrl(reservationId, String(detail!.qr_token));

    await dispatchPendingEmails(Number(detail!.user_id));
    await broadcastLotUpdate(Number(detail!.lot_id), 'reservation_created');

    res.status(201).json({
      reservation: {
        ...detail,
        qr_code_data_url: qrCodeDataUrl,
      },
    });
  })
);

// 2. GET /api/reservations — List current user's reservations (booking history)
reservationsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const statusFilter =
      typeof req.query.status === 'string' && req.query.status.trim() !== ''
        ? req.query.status.trim().toUpperCase()
        : null;

    const params: Array<string | number> = [req.user!.userId];
    let statusSql = '';
    if (statusFilter) {
      statusSql = 'AND r.status = ?';
      params.push(statusFilter);
    }

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
         v.plate_number,
         v.vehicle_type,
         ps.slot_number,
         ps.slot_type,
         pl.lot_id,
         pl.name AS lot_name,
         pl.address AS lot_address,
         pl.city AS lot_city,
         COALESCE(
           (SELECT SUM(p.amount)
              FROM payments p
             WHERE p.reservation_id = r.reservation_id
               AND p.status = 'PAID'),
           0.00
         ) AS total_paid,
         EXISTS (
           SELECT 1 FROM reviews rv WHERE rv.reservation_id = r.reservation_id
         ) AS has_review
       FROM reservations r
       JOIN vehicles v       ON v.vehicle_id = r.vehicle_id
       JOIN parking_slots ps ON ps.slot_id   = r.slot_id
       JOIN parking_lots pl  ON pl.lot_id    = ps.lot_id
      WHERE v.user_id = ?
        ${statusSql}
      ORDER BY r.start_time DESC, r.reservation_id DESC`,
      params
    );

    const reservations = rows.map((r) => ({
      ...r,
      has_review: Boolean(r.has_review),
    }));

    res.status(200).json({ reservations });
  })
);

// 3. POST /api/reservations/qr/scan — Unified QR scanner endpoint for check-in and check-out
reservationsRouter.post(
  '/qr/scan',
  asyncHandler(async (req, res) => {
    const body = qrScanSchema.parse(req.body);
    const scanTime = body.scan_time ? normalizeDateTimeParam(body.scan_time) : null;

    const [rows] = await pool.execute<RowDataPacket[]>(
      `SELECT r.reservation_id, r.status, r.qr_token, v.user_id, ps.lot_id
         FROM reservations r
         JOIN vehicles v       ON v.vehicle_id = r.vehicle_id
         JOIN parking_slots ps ON ps.slot_id   = r.slot_id
        WHERE r.qr_token = ?
        LIMIT 1`,
      [body.qr_token]
    );

    if (rows.length === 0) {
      throw new AppError(404, 'QR_NOT_FOUND', 'No reservation found for this QR token');
    }

    const resv = rows[0];
    const reservationId = Number(resv.reservation_id);
    if (Number(resv.user_id) !== req.user!.userId && req.user!.role !== 'ADMIN') {
      throw new AppError(403, 'FORBIDDEN', 'Not authorized to scan this reservation QR code');
    }

    const effectiveAction =
      body.action === 'AUTO'
        ? resv.status === 'CONFIRMED'
          ? 'CHECK_IN'
          : resv.status === 'CHECKED_IN'
            ? 'CHECK_OUT'
            : 'INVALID'
        : body.action;

    if (effectiveAction === 'CHECK_IN') {
      await withAuditUser(`user:${req.user!.userId}`, async (conn) => {
        await conn.execute(`CALL check_in(?, ?, ?)`, [
          reservationId,
          body.qr_token,
          scanTime,
        ]);
      });

      const updated = await fetchReservationDetail(reservationId);
      await broadcastLotUpdate(Number(resv.lot_id), 'qr_checked_in');

      res.status(200).json({
        action_performed: 'CHECK_IN',
        reservation: updated,
      });
      return;
    }

    if (effectiveAction === 'CHECK_OUT') {
      const billing = await withAuditUser(`user:${req.user!.userId}`, async (conn) => {
        await conn.execute(
          `CALL checkout_and_bill(?, ?, ?, @p_base, @p_pen, @p_tot)`,
          [reservationId, scanTime, body.payment_method]
        );
        const [outRows] = await conn.execute<RowDataPacket[]>(
          `SELECT @p_base AS base_amount, @p_pen AS penalty_amount, @p_tot AS total_amount`
        );
        return {
          base_amount: Number(outRows[0].base_amount),
          penalty_amount: Number(outRows[0].penalty_amount),
          total_amount: Number(outRows[0].total_amount),
        };
      });

      const updated = await fetchReservationDetail(reservationId);
      await dispatchPendingEmails(Number(resv.user_id));
      await broadcastLotUpdate(Number(resv.lot_id), 'qr_checked_out');

      res.status(200).json({
        action_performed: 'CHECK_OUT',
        reservation: updated,
        billing,
      });
      return;
    }

    throw new AppError(
      400,
      'INVALID_QR_STATE',
      `Reservation is in status '${resv.status}' and cannot be checked in or checked out`
    );
  })
);

// 4. GET /api/reservations/:reservationId — Single reservation detail with QR code, payments, and review
reservationsRouter.get(
  '/:reservationId',
  asyncHandler(async (req, res) => {
    const reservationId = Number(req.params.reservationId);
    if (!Number.isInteger(reservationId) || reservationId <= 0) {
      throw new AppError(400, 'INVALID_ID', 'Invalid reservationId');
    }

    const detail = await fetchReservationDetail(reservationId);
    if (!detail) {
      throw new AppError(404, 'RESERVATION_NOT_FOUND', 'Reservation not found');
    }

    if (Number(detail.user_id) !== req.user!.userId && req.user!.role !== 'ADMIN') {
      throw new AppError(403, 'FORBIDDEN', 'Not authorized to view this reservation');
    }

    const [payments] = await pool.execute<RowDataPacket[]>(
      `SELECT payment_id, reservation_id, amount, payment_type, method, status, transaction_ref, paid_at, created_at
         FROM payments
        WHERE reservation_id = ?
        ORDER BY payment_id ASC`,
      [reservationId]
    );

    const [reviews] = await pool.execute<RowDataPacket[]>(
      `SELECT review_id, reservation_id, rating, comment, created_at
         FROM reviews
        WHERE reservation_id = ?
        LIMIT 1`,
      [reservationId]
    );

    const qrCodeDataUrl = await generateQrDataUrl(reservationId, String(detail.qr_token));

    res.status(200).json({
      reservation: {
        ...detail,
        qr_code_data_url: qrCodeDataUrl,
        payments,
        review: reviews[0] ?? null,
      },
    });
  })
);

// 5. GET /api/reservations/:reservationId/receipt — Itemized receipt for a reservation
reservationsRouter.get(
  '/:reservationId/receipt',
  asyncHandler(async (req, res) => {
    const reservationId = Number(req.params.reservationId);
    if (!Number.isInteger(reservationId) || reservationId <= 0) {
      throw new AppError(400, 'INVALID_ID', 'Invalid reservationId');
    }

    const detail = await fetchReservationDetail(reservationId);
    if (!detail) {
      throw new AppError(404, 'RESERVATION_NOT_FOUND', 'Reservation not found');
    }

    if (Number(detail.user_id) !== req.user!.userId && req.user!.role !== 'ADMIN') {
      throw new AppError(403, 'FORBIDDEN', 'Not authorized to view this receipt');
    }

    const [payments] = await pool.execute<RowDataPacket[]>(
      `SELECT payment_id, amount, payment_type, method, status, transaction_ref, paid_at, created_at
         FROM payments
        WHERE reservation_id = ?
        ORDER BY payment_id ASC`,
      [reservationId]
    );

    const totalPaid = payments
      .filter((p) => p.status === 'PAID' && p.payment_type !== 'REFUND')
      .reduce((acc, p) => acc + Number(p.amount), 0);

    const penaltyPaid = payments
      .filter((p) => p.status === 'PAID' && p.payment_type === 'PENALTY')
      .reduce((acc, p) => acc + Number(p.amount), 0);

    const refundedAmount = payments
      .filter((p) => p.status === 'REFUNDED' || p.payment_type === 'REFUND')
      .reduce((acc, p) => acc + Number(p.amount), 0);

    res.status(200).json({
      receipt: {
        receipt_number: `PP-RCPT-${String(reservationId).padStart(5, '0')}`,
        reservation_id: Number(detail.reservation_id),
        status: detail.status,
        customer: {
          user_id: Number(detail.user_id),
          full_name: detail.user_name,
          email: detail.user_email,
        },
        vehicle: {
          vehicle_id: Number(detail.vehicle_id),
          plate_number: detail.plate_number,
          vehicle_type: detail.vehicle_type,
        },
        lot: {
          lot_id: Number(detail.lot_id),
          name: detail.lot_name,
          address: detail.lot_address,
          city: detail.lot_city,
          slot_id: Number(detail.slot_id),
          slot_number: detail.slot_number,
        },
        schedule: {
          start_time: detail.start_time,
          end_time: detail.end_time,
          checked_in_at: detail.checked_in_at,
          checked_out_at: detail.checked_out_at,
        },
        billing: {
          quoted_amount: Number(detail.quoted_amount),
          penalty_paid: Number(penaltyPaid.toFixed(2)),
          total_paid: Number(totalPaid.toFixed(2)),
          refunded_amount: Number(refundedAmount.toFixed(2)),
        },
        payments,
      },
    });
  })
);

// 6. PUT /api/reservations/:reservationId — Modify a CONFIRMED reservation (recalculates dynamic price)
reservationsRouter.put(
  '/:reservationId',
  asyncHandler(async (req, res) => {
    const reservationId = Number(req.params.reservationId);
    if (!Number.isInteger(reservationId) || reservationId <= 0) {
      throw new AppError(400, 'INVALID_ID', 'Invalid reservationId');
    }

    const body = modifyReservationSchema.parse(req.body);
    const existing = await fetchReservationDetail(reservationId);
    if (!existing) {
      throw new AppError(404, 'RESERVATION_NOT_FOUND', 'Reservation not found');
    }

    if (Number(existing.user_id) !== req.user!.userId && req.user!.role !== 'ADMIN') {
      throw new AppError(403, 'FORBIDDEN', 'Not authorized to modify this reservation');
    }

    if (existing.status !== 'CONFIRMED') {
      throw new AppError(
        400,
        'RESERVATION_NOT_MODIFIABLE',
        'Only CONFIRMED reservations can be modified'
      );
    }

    const newSlotId = body.slot_id ?? Number(existing.slot_id);
    const newStartTime = body.start_time
      ? normalizeDateTimeParam(body.start_time)
      : String(existing.start_time);
    const newEndTime = body.end_time
      ? normalizeDateTimeParam(body.end_time)
      : String(existing.end_time);

    if (newEndTime <= newStartTime) {
      throw new AppError(400, 'INVALID_TIME_WINDOW', 'end_time must be after start_time');
    }

    const [slotRows] = await pool.execute<RowDataPacket[]>(
      `SELECT slot_id, lot_id FROM parking_slots WHERE slot_id = ?`,
      [newSlotId]
    );
    if (slotRows.length === 0) {
      throw new AppError(404, 'SLOT_NOT_FOUND', 'Target parking slot not found');
    }
    const targetLotId = Number(slotRows[0].lot_id);

    await withAuditUser(`user:${req.user!.userId}`, async (conn) => {
      const [priceRows] = await conn.execute<RowDataPacket[]>(
        `SELECT get_dynamic_price(?, ?, ?, ?) AS new_quote`,
        [targetLotId, existing.vehicle_type, newStartTime, newEndTime]
      );
      const newQuote = Number(priceRows[0].new_quote);

      await conn.execute(
        `UPDATE reservations
            SET slot_id = ?,
                start_time = ?,
                end_time = ?,
                quoted_amount = ?
          WHERE reservation_id = ?`,
        [newSlotId, newStartTime, newEndTime, newQuote, reservationId]
      );
    });

    const updated = await fetchReservationDetail(reservationId);
    await broadcastLotUpdate(Number(existing.lot_id), 'reservation_modified');
    if (targetLotId !== Number(existing.lot_id)) {
      await broadcastLotUpdate(targetLotId, 'reservation_modified');
    }

    res.status(200).json({ reservation: updated });
  })
);

// 7. POST /api/reservations/:reservationId/cancel — Cancel via Phase 1b `cancel_booking` procedure
reservationsRouter.post(
  '/:reservationId/cancel',
  asyncHandler(async (req, res) => {
    const reservationId = Number(req.params.reservationId);
    if (!Number.isInteger(reservationId) || reservationId <= 0) {
      throw new AppError(400, 'INVALID_ID', 'Invalid reservationId');
    }

    const existing = await fetchReservationDetail(reservationId);
    if (!existing) {
      throw new AppError(404, 'RESERVATION_NOT_FOUND', 'Reservation not found');
    }

    await withAuditUser(`user:${req.user!.userId}`, async (conn) => {
      await conn.execute(`CALL cancel_booking(?, ?, ?)`, [
        reservationId,
        req.user!.userId,
        req.user!.role === 'ADMIN',
      ]);
    });

    const updated = await fetchReservationDetail(reservationId);
    await dispatchPendingEmails();
    await broadcastLotUpdate(Number(existing.lot_id), 'reservation_cancelled');

    res.status(200).json({ reservation: updated });
  })
);

// 8. POST /api/reservations/:reservationId/pay — Mock booking payment for a reservation
reservationsRouter.post(
  '/:reservationId/pay',
  asyncHandler(async (req, res) => {
    const reservationId = Number(req.params.reservationId);
    if (!Number.isInteger(reservationId) || reservationId <= 0) {
      throw new AppError(400, 'INVALID_ID', 'Invalid reservationId');
    }

    const body = payReservationSchema.parse(req.body);
    const existing = await fetchReservationDetail(reservationId);
    if (!existing) {
      throw new AppError(404, 'RESERVATION_NOT_FOUND', 'Reservation not found');
    }

    if (Number(existing.user_id) !== req.user!.userId && req.user!.role !== 'ADMIN') {
      throw new AppError(403, 'FORBIDDEN', 'Not authorized to pay for this reservation');
    }

    if (existing.status !== 'CONFIRMED' && existing.status !== 'CHECKED_IN') {
      throw new AppError(
        400,
        'INVALID_RESERVATION_STATUS',
        `Cannot make booking payment for reservation in status '${existing.status}'`
      );
    }

    const [paidCheck] = await pool.execute<RowDataPacket[]>(
      `SELECT payment_id
         FROM payments
        WHERE reservation_id = ?
          AND payment_type = 'BOOKING'
          AND status = 'PAID'
        LIMIT 1`,
      [reservationId]
    );
    if (paidCheck.length > 0) {
      throw new AppError(409, 'ALREADY_PAID', 'Booking fee has already been paid for this reservation');
    }

    const paidAt = String(existing.start_time);
    const txnRef = `TXN-BKG-${reservationId}-${Date.now()}`;

    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO payments
         (reservation_id, amount, payment_type, method, status, transaction_ref, paid_at)
       VALUES (?, ?, 'BOOKING', ?, 'PAID', ?, ?)`,
      [reservationId, existing.quoted_amount, body.method, txnRef, paidAt]
    );

    await pool.execute(
      `INSERT INTO notifications (user_id, reservation_id, type, message)
       VALUES (?, ?, 'PAYMENT', ?)`,
      [
        existing.user_id,
        reservationId,
        `Payment of ₹${existing.quoted_amount} received via ${body.method} for reservation #${reservationId}.`,
      ]
    );

    await dispatchPendingEmails(Number(existing.user_id));

    const [payRows] = await pool.execute<RowDataPacket[]>(
      `SELECT * FROM payments WHERE payment_id = ?`,
      [result.insertId]
    );

    res.status(201).json({ payment: payRows[0] });
  })
);

// 9. POST /api/reservations/:reservationId/check-in — Check in via Phase 1b `check_in` procedure
reservationsRouter.post(
  '/:reservationId/check-in',
  asyncHandler(async (req, res) => {
    const reservationId = Number(req.params.reservationId);
    if (!Number.isInteger(reservationId) || reservationId <= 0) {
      throw new AppError(400, 'INVALID_ID', 'Invalid reservationId');
    }

    const body = checkInSchema.parse(req.body);
    const checkinTime = body.checkin_time ? normalizeDateTimeParam(body.checkin_time) : null;

    const existing = await fetchReservationDetail(reservationId);
    if (!existing) {
      throw new AppError(404, 'RESERVATION_NOT_FOUND', 'Reservation not found');
    }

    if (Number(existing.user_id) !== req.user!.userId && req.user!.role !== 'ADMIN') {
      throw new AppError(403, 'FORBIDDEN', 'Not authorized to check in this reservation');
    }

    await withAuditUser(`user:${req.user!.userId}`, async (conn) => {
      await conn.execute(`CALL check_in(?, ?, ?)`, [
        reservationId,
        body.qr_token,
        checkinTime,
      ]);
    });

    const updated = await fetchReservationDetail(reservationId);
    await broadcastLotUpdate(Number(existing.lot_id), 'reservation_checked_in');

    res.status(200).json({ reservation: updated });
  })
);

// 10. POST /api/reservations/:reservationId/check-out — Check out & bill via `checkout_and_bill`
reservationsRouter.post(
  '/:reservationId/check-out',
  asyncHandler(async (req, res) => {
    const reservationId = Number(req.params.reservationId);
    if (!Number.isInteger(reservationId) || reservationId <= 0) {
      throw new AppError(400, 'INVALID_ID', 'Invalid reservationId');
    }

    const body = checkOutSchema.parse(req.body);
    const checkoutTime = body.checkout_time ? normalizeDateTimeParam(body.checkout_time) : null;

    const existing = await fetchReservationDetail(reservationId);
    if (!existing) {
      throw new AppError(404, 'RESERVATION_NOT_FOUND', 'Reservation not found');
    }

    if (Number(existing.user_id) !== req.user!.userId && req.user!.role !== 'ADMIN') {
      throw new AppError(403, 'FORBIDDEN', 'Not authorized to check out this reservation');
    }

    const billing = await withAuditUser(`user:${req.user!.userId}`, async (conn) => {
      await conn.execute(
        `CALL checkout_and_bill(?, ?, ?, @p_base, @p_pen, @p_tot)`,
        [reservationId, checkoutTime, body.payment_method]
      );
      const [outRows] = await conn.execute<RowDataPacket[]>(
        `SELECT @p_base AS base_amount, @p_pen AS penalty_amount, @p_tot AS total_amount`
      );
      return {
        base_amount: Number(outRows[0].base_amount),
        penalty_amount: Number(outRows[0].penalty_amount),
        total_amount: Number(outRows[0].total_amount),
      };
    });

    const updated = await fetchReservationDetail(reservationId);
    const [payments] = await pool.execute<RowDataPacket[]>(
      `SELECT * FROM payments WHERE reservation_id = ? ORDER BY payment_id ASC`,
      [reservationId]
    );

    await dispatchPendingEmails(Number(existing.user_id));
    await broadcastLotUpdate(Number(existing.lot_id), 'reservation_checked_out');

    res.status(200).json({
      reservation: updated,
      billing,
      payments,
    });
  })
);
