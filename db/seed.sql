-- ParkPulse - Phase 1a seed data. Deterministic: explicit IDs, no NOW().
-- Logins:  admin@parkpulse.dev / Admin@123   |   all other users / Password@123
USE parkpulse;

INSERT INTO users (user_id, full_name, email, phone, password_hash, role) VALUES
(1, 'Admin ParkPulse', 'admin@parkpulse.dev', '9000000001', '$2b$10$zsosHLQHNdsr5rPUgZCdaOyYI8zxFkcOL0x5binx0e5L6SpXun0Zu', 'ADMIN'),
(2, 'Rohan Mehta',     'rohan@example.com',   '9000000002', '$2b$10$iIvmHjetl.2L2I/fDXFbk.QVcOG07aZIfK8DTIqGOpACtwNKX7nie', 'USER'),
(3, 'Ananya Rao',      'ananya@example.com',  '9000000003', '$2b$10$iIvmHjetl.2L2I/fDXFbk.QVcOG07aZIfK8DTIqGOpACtwNKX7nie', 'USER'),
(4, 'Karthik Nair',    'karthik@example.com', '9000000004', '$2b$10$iIvmHjetl.2L2I/fDXFbk.QVcOG07aZIfK8DTIqGOpACtwNKX7nie', 'USER');

INSERT INTO vehicles (vehicle_id, user_id, plate_number, vehicle_type) VALUES
(1, 2, 'KA01AB1234', 'CAR'),
(2, 2, 'KA01CD5678', 'BIKE'),
(3, 3, 'KA05EF9012', 'SUV'),
(4, 3, 'KA05GH3456', 'EV'),
(5, 4, 'KA03JK7890', 'CAR');

INSERT INTO parking_lots (lot_id, name, address, city, latitude, longitude, open_time, close_time, grace_period_minutes) VALUES
(1, 'Orion Mall Parking',        'Brigade Gateway, Rajajinagar',  'Bengaluru', 13.010700, 77.554700, '08:00:00', '23:59:59', 15),
(2, 'Majestic Metro Parking',    'Kempegowda Bus Station Road',   'Bengaluru', 12.976700, 77.571300, '00:00:00', '23:59:59', 10),
(3, 'Indiranagar 100ft Parking', '100 Feet Road, Indiranagar',    'Bengaluru', 12.978400, 77.640800, '06:00:00', '23:59:59', 20);

-- Lot 1: 12 slots (2 BIKE, 6 CAR, 2 SUV, 2 EV)
INSERT INTO parking_slots (slot_id, lot_id, slot_number, slot_type) VALUES
(1, 1, 'A01', 'BIKE'), (2, 1, 'A02', 'BIKE'),
(3, 1, 'A03', 'CAR'),  (4, 1, 'A04', 'CAR'),  (5, 1, 'A05', 'CAR'),
(6, 1, 'A06', 'CAR'),  (7, 1, 'A07', 'CAR'),  (8, 1, 'A08', 'CAR'),
(9, 1, 'A09', 'SUV'),  (10, 1, 'A10', 'SUV'),
(11, 1, 'A11', 'EV'),  (12, 1, 'A12', 'EV');

-- Lot 2: 10 slots (2 BIKE, 5 CAR, 1 SUV, 2 EV)
INSERT INTO parking_slots (slot_id, lot_id, slot_number, slot_type) VALUES
(13, 2, 'B01', 'BIKE'), (14, 2, 'B02', 'BIKE'),
(15, 2, 'B03', 'CAR'),  (16, 2, 'B04', 'CAR'),  (17, 2, 'B05', 'CAR'),
(18, 2, 'B06', 'CAR'),  (19, 2, 'B07', 'CAR'),
(20, 2, 'B08', 'SUV'),
(21, 2, 'B09', 'EV'),   (22, 2, 'B10', 'EV');

-- Lot 3: 8 slots (1 BIKE, 4 CAR, 1 SUV, 2 EV)
INSERT INTO parking_slots (slot_id, lot_id, slot_number, slot_type) VALUES
(23, 3, 'C01', 'BIKE'),
(24, 3, 'C02', 'CAR'),  (25, 3, 'C03', 'CAR'),  (26, 3, 'C04', 'CAR'),  (27, 3, 'C05', 'CAR'),
(28, 3, 'C06', 'SUV'),
(29, 3, 'C07', 'EV'),   (30, 3, 'C08', 'EV');

-- Base prices (INR per hour) and overstay penalties (INR per extra hour)
INSERT INTO pricing_rules (lot_id, vehicle_type, base_rate_per_hour, overstay_penalty_per_hour) VALUES
(1, 'BIKE', 10.00, 20.00), (1, 'CAR', 40.00, 80.00), (1, 'SUV', 60.00, 120.00), (1, 'EV', 50.00, 100.00),
(2, 'BIKE',  8.00, 16.00), (2, 'CAR', 30.00, 60.00), (2, 'SUV', 45.00,  90.00), (2, 'EV', 35.00,  70.00),
(3, 'BIKE', 12.00, 24.00), (3, 'CAR', 50.00, 100.00),(3, 'SUV', 70.00, 140.00), (3, 'EV', 60.00, 120.00);

-- Peak multipliers for every lot (day_of_week 0 = Monday ... 6 = Sunday)
-- Weekday morning peak (08:00-09:59) x1.25, weekday evening peak (17:00-19:59) x1.50
INSERT INTO peak_multipliers (lot_id, day_of_week, hour_of_day, multiplier)
SELECT l.lot_id, d.dow, h.hr, 1.25
FROM parking_lots l
CROSS JOIN (SELECT 0 AS dow UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4) d
CROSS JOIN (SELECT 8 AS hr UNION ALL SELECT 9) h;

INSERT INTO peak_multipliers (lot_id, day_of_week, hour_of_day, multiplier)
SELECT l.lot_id, d.dow, h.hr, 1.50
FROM parking_lots l
CROSS JOIN (SELECT 0 AS dow UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4) d
CROSS JOIN (SELECT 17 AS hr UNION ALL SELECT 18 UNION ALL SELECT 19) h;

-- Weekend leisure peak (11:00-20:59) x1.25 on Saturday and Sunday
INSERT INTO peak_multipliers (lot_id, day_of_week, hour_of_day, multiplier)
SELECT l.lot_id, d.dow, h.hr, 1.25
FROM parking_lots l
CROSS JOIN (SELECT 5 AS dow UNION ALL SELECT 6) d
CROSS JOIN (SELECT 11 AS hr UNION ALL SELECT 12 UNION ALL SELECT 13 UNION ALL SELECT 14 UNION ALL SELECT 15
            UNION ALL SELECT 16 UNION ALL SELECT 17 UNION ALL SELECT 18 UNION ALL SELECT 19 UNION ALL SELECT 20) h;

-- Favorites (so the favorites feature has data from day one)
INSERT INTO favorite_lots (user_id, lot_id) VALUES (2, 1), (2, 2), (3, 3);

