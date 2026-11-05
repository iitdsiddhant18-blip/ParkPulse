-- ParkPulse - Phase 3b deterministic historical seed data for Analytics & Reporting
-- Inserts 20 historical reservations (5001..5020), 16 payments (6001..6016), and 2 reviews (7001..7002).
-- Safe to run multiple times (idempotent cleanup of 5001..5020 first).

USE parkpulse;

DELETE FROM reviews WHERE reservation_id BETWEEN 5001 AND 5020;
DELETE FROM payments WHERE reservation_id BETWEEN 5001 AND 5020;
DELETE FROM notifications WHERE reservation_id BETWEEN 5001 AND 5020;
DELETE FROM reservations WHERE reservation_id BETWEEN 5001 AND 5020;
DELETE FROM audit_log WHERE table_name = 'reservations' AND record_id BETWEEN 5001 AND 5020;

-- 1. COMPLETED reservations (14 rows: 5001..5014)
INSERT INTO reservations (
  reservation_id, vehicle_id, slot_id, series_id,
  start_time, end_time, status, quoted_amount, qr_token,
  checked_in_at, checked_out_at
) VALUES
-- Lot 1: 4 Monday morning peak bookings on Slot 3 (A03, CAR) at 09:00
(5001, 1, 3,  NULL, '2026-01-05 09:00:00', '2026-01-05 11:00:00', 'COMPLETED',  90.00, 'cccccccc-0000-0000-0000-000000005001', '2026-01-05 09:00:00', '2026-01-05 11:00:00'),
(5002, 5, 3,  NULL, '2026-01-12 09:00:00', '2026-01-12 11:00:00', 'COMPLETED',  90.00, 'cccccccc-0000-0000-0000-000000005002', '2026-01-12 09:00:00', '2026-01-12 11:00:00'),
(5003, 1, 3,  NULL, '2026-01-19 09:00:00', '2026-01-19 11:00:00', 'COMPLETED',  90.00, 'cccccccc-0000-0000-0000-000000005003', '2026-01-19 09:00:00', '2026-01-19 12:00:00'),
(5004, 5, 3,  NULL, '2026-02-02 09:00:00', '2026-02-02 11:00:00', 'COMPLETED',  90.00, 'cccccccc-0000-0000-0000-000000005004', '2026-02-02 09:00:00', '2026-02-02 11:00:00'),

-- Lot 1: 3 Friday evening peak bookings at 18:00 (Slots 9 SUV, 11 EV, 4 CAR)
(5005, 3, 9,  NULL, '2026-02-06 18:00:00', '2026-02-06 20:00:00', 'COMPLETED', 180.00, 'cccccccc-0000-0000-0000-000000005005', '2026-02-06 18:00:00', '2026-02-06 20:00:00'),
(5006, 4, 11, NULL, '2026-02-13 18:00:00', '2026-02-13 20:00:00', 'COMPLETED', 150.00, 'cccccccc-0000-0000-0000-000000005006', '2026-02-13 18:00:00', '2026-02-13 20:00:00'),
(5007, 1, 4,  NULL, '2026-02-20 18:00:00', '2026-02-20 20:00:00', 'COMPLETED', 120.00, 'cccccccc-0000-0000-0000-000000005007', '2026-02-20 18:00:00', '2026-02-20 20:00:00'),

-- Lot 1: 2 Wednesday afternoon off-peak bookings at 14:00 (Slots 1 BIKE, 5 CAR)
(5008, 2, 1,  NULL, '2026-02-11 14:00:00', '2026-02-11 15:00:00', 'COMPLETED',  10.00, 'cccccccc-0000-0000-0000-000000005008', '2026-02-11 14:00:00', '2026-02-11 15:00:00'),
(5009, 5, 5,  NULL, '2026-02-18 14:00:00', '2026-02-18 16:00:00', 'COMPLETED',  80.00, 'cccccccc-0000-0000-0000-000000005009', '2026-02-18 14:00:00', '2026-02-18 16:00:00'),

-- Lot 2: 2 Monday morning bookings on Slot 15 (B03, CAR) at 09:00 + 1 Tuesday evening on Slot 21 (B09, EV)
(5010, 1, 15, NULL, '2026-01-26 09:00:00', '2026-01-26 11:00:00', 'COMPLETED',  67.50, 'cccccccc-0000-0000-0000-000000005010', '2026-01-26 09:00:00', '2026-01-26 11:00:00'),
(5011, 5, 15, NULL, '2026-02-09 09:00:00', '2026-02-09 11:00:00', 'COMPLETED',  67.50, 'cccccccc-0000-0000-0000-000000005011', '2026-02-09 09:00:00', '2026-02-09 11:00:00'),
(5012, 4, 21, NULL, '2026-02-10 18:00:00', '2026-02-10 20:00:00', 'COMPLETED', 105.00, 'cccccccc-0000-0000-0000-000000005012', '2026-02-10 18:00:00', '2026-02-10 20:00:00'),

-- Lot 3: 2 Saturday evening bookings at 19:00 (Slots 24 CAR, 28 SUV)
(5013, 1, 24, NULL, '2026-02-14 19:00:00', '2026-02-14 21:00:00', 'COMPLETED', 125.00, 'cccccccc-0000-0000-0000-000000005013', '2026-02-14 19:00:00', '2026-02-14 21:00:00'),
(5014, 3, 28, NULL, '2026-02-21 19:00:00', '2026-02-21 21:00:00', 'COMPLETED', 175.00, 'cccccccc-0000-0000-0000-000000005014', '2026-02-21 19:00:00', '2026-02-21 21:00:00'),

-- 2. CANCELLED, EXPIRED, and NO_SHOW reservations (6 rows: 5015..5020)
(5015, 1, 6,  NULL, '2026-02-09 09:00:00', '2026-02-09 11:00:00', 'CANCELLED',  90.00, 'cccccccc-0000-0000-0000-000000005015', NULL, NULL),
(5016, 5, 16, NULL, '2026-02-11 10:00:00', '2026-02-11 12:00:00', 'CANCELLED',  60.00, 'cccccccc-0000-0000-0000-000000005016', NULL, NULL),
(5017, 1, 25, NULL, '2026-02-15 11:00:00', '2026-02-15 13:00:00', 'CANCELLED', 125.00, 'cccccccc-0000-0000-0000-000000005017', NULL, NULL),
(5018, 5, 7,  NULL, '2026-02-12 09:00:00', '2026-02-12 11:00:00', 'EXPIRED',    90.00, 'cccccccc-0000-0000-0000-000000005018', NULL, NULL),
(5019, 1, 17, NULL, '2026-02-19 09:00:00', '2026-02-19 11:00:00', 'EXPIRED',    67.50, 'cccccccc-0000-0000-0000-000000005019', NULL, NULL),
(5020, 5, 26, NULL, '2026-02-22 19:00:00', '2026-02-22 21:00:00', 'NO_SHOW',   125.00, 'cccccccc-0000-0000-0000-000000005020', NULL, NULL);

-- 3. Payments for historical reservations (16 rows: 6001..6016)
INSERT INTO payments (
  payment_id, reservation_id, amount, payment_type, method, status, transaction_ref, paid_at
) VALUES
(6001, 5001,  90.00, 'BOOKING',  'UPI',    'PAID',     'TXN-HIST-6001', '2026-01-05 09:00:00'),
(6002, 5002,  90.00, 'BOOKING',  'CARD',   'PAID',     'TXN-HIST-6002', '2026-01-12 09:00:00'),
(6003, 5003,  90.00, 'BOOKING',  'UPI',    'PAID',     'TXN-HIST-6003', '2026-01-19 09:00:00'),
(6004, 5003,  80.00, 'PENALTY',  'UPI',    'PAID',     'TXN-HIST-6004', '2026-01-19 12:00:00'),
(6005, 5004,  90.00, 'BOOKING',  'WALLET', 'PAID',     'TXN-HIST-6005', '2026-02-02 09:00:00'),
(6006, 5005, 180.00, 'BOOKING',  'CARD',   'PAID',     'TXN-HIST-6006', '2026-02-06 18:00:00'),
(6007, 5006, 150.00, 'BOOKING',  'UPI',    'PAID',     'TXN-HIST-6007', '2026-02-13 18:00:00'),
(6008, 5007, 120.00, 'BOOKING',  'UPI',    'PAID',     'TXN-HIST-6008', '2026-02-20 18:00:00'),
(6009, 5008,  10.00, 'CHECKOUT', 'CASH',   'PAID',     'TXN-HIST-6009', '2026-02-11 15:00:00'),
(6010, 5009,  80.00, 'BOOKING',  'UPI',    'PAID',     'TXN-HIST-6010', '2026-02-18 14:00:00'),
(6011, 5010,  67.50, 'BOOKING',  'UPI',    'PAID',     'TXN-HIST-6011', '2026-01-26 09:00:00'),
(6012, 5011,  67.50, 'BOOKING',  'CARD',   'PAID',     'TXN-HIST-6012', '2026-02-09 09:00:00'),
(6013, 5012, 105.00, 'BOOKING',  'WALLET', 'PAID',     'TXN-HIST-6013', '2026-02-10 18:00:00'),
(6014, 5013, 125.00, 'BOOKING',  'UPI',    'PAID',     'TXN-HIST-6014', '2026-02-14 19:00:00'),
(6015, 5014, 175.00, 'BOOKING',  'CARD',   'PAID',     'TXN-HIST-6015', '2026-02-21 19:00:00'),
(6016, 5015,  90.00, 'BOOKING',  'UPI',    'REFUNDED', 'TXN-HIST-6016', '2026-02-09 08:30:00');

-- 4. Reviews on completed historical reservations (2 rows: 7001..7002)
INSERT INTO reviews (review_id, reservation_id, rating, comment) VALUES
(7001, 5001, 5, 'Well-lit basement parking near the mall entrance.'),
(7002, 5010, 4, 'Convenient metro commuter parking at Majestic.');
