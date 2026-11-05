-- ParkPulse - Phase 1a verification. Run against a FRESH database (see prompt).
-- Prints one row per check: PASS or FAIL. Writes nothing permanent (data part is rolled back).
USE parkpulse;

DROP TEMPORARY TABLE IF EXISTS _t_results;
CREATE TEMPORARY TABLE _t_results (
  seq INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  check_name VARCHAR(120) NOT NULL,
  result VARCHAR(4) NOT NULL
) ENGINE=MEMORY;  -- MEMORY on purpose: not transactional, so the ROLLBACK below cannot erase results

DROP PROCEDURE IF EXISTS _t_expect_equal;
DROP PROCEDURE IF EXISTS _t_expect_fail;

DELIMITER $$
CREATE PROCEDURE _t_expect_equal(IN p_name VARCHAR(120), IN p_actual BIGINT, IN p_expected BIGINT)
BEGIN
  INSERT INTO _t_results (check_name, result)
  VALUES (p_name, IF(p_actual = p_expected, 'PASS', 'FAIL'));
END$$

-- Runs p_sql and PASSES only if it fails with MySQL error number p_errno.
CREATE PROCEDURE _t_expect_fail(IN p_name VARCHAR(120), IN p_sql TEXT, IN p_errno INT)
BEGIN
  DECLARE v_errno INT DEFAULT 0;
  DECLARE CONTINUE HANDLER FOR SQLEXCEPTION, SQLWARNING
    BEGIN
      GET DIAGNOSTICS CONDITION 1 v_errno = MYSQL_ERRNO;
    END;
  SET @_t_sql = p_sql;
  PREPARE _t_stmt FROM @_t_sql;
  EXECUTE _t_stmt;
  DEALLOCATE PREPARE _t_stmt;
  INSERT INTO _t_results (check_name, result)
  VALUES (p_name, IF(v_errno = p_errno, 'PASS', 'FAIL'));
END$$
DELIMITER ;

-- ===== A. Structure =====
CALL _t_expect_equal('A01 table count is 14',
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='parkpulse' AND table_type='BASE TABLE'), 14);
CALL _t_expect_equal('A02 all tables are InnoDB',
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='parkpulse' AND engine='InnoDB'), 14);
CALL _t_expect_equal('A03 all 14 tables have a primary key',
  (SELECT COUNT(*) FROM information_schema.table_constraints WHERE constraint_schema='parkpulse' AND constraint_type='PRIMARY KEY'), 14);
CALL _t_expect_equal('A04 foreign key count is 17',
  (SELECT COUNT(*) FROM information_schema.table_constraints WHERE constraint_schema='parkpulse' AND constraint_type='FOREIGN KEY'), 17);
CALL _t_expect_equal('A05 check constraint count is 17',
  (SELECT COUNT(*) FROM information_schema.table_constraints WHERE constraint_schema='parkpulse' AND constraint_type='CHECK'), 17);
CALL _t_expect_equal('A06 unique constraint count is 9',
  (SELECT COUNT(*) FROM information_schema.table_constraints WHERE constraint_schema='parkpulse' AND constraint_type='UNIQUE'), 9);
CALL _t_expect_equal('A07 secondary index count is 28',
  (SELECT COUNT(DISTINCT table_name, index_name) FROM information_schema.statistics WHERE table_schema='parkpulse' AND index_name <> 'PRIMARY'), 28);
CALL _t_expect_equal('A08 no triggers yet (Phase 1b)',
  (SELECT COUNT(*) FROM information_schema.triggers WHERE trigger_schema='parkpulse'), 0);
CALL _t_expect_equal('A09 no stored routines yet (Phase 1b)',
  (SELECT COUNT(*) FROM information_schema.routines WHERE routine_schema='parkpulse' AND routine_name NOT LIKE '\_t\_%'), 0);
CALL _t_expect_equal('A10 no views yet (Phase 1b)',
  (SELECT COUNT(*) FROM information_schema.views WHERE table_schema='parkpulse'), 0);
CALL _t_expect_equal('A11 server time zone is +05:30',
  (SELECT @@global.time_zone = '+05:30'), 1);
CALL _t_expect_equal('A12 every table is utf8mb4',
  (SELECT COUNT(*) FROM information_schema.tables t JOIN information_schema.collations c ON c.collation_name = t.table_collation
    WHERE t.table_schema='parkpulse' AND c.character_set_name = 'utf8mb4'), 14);

-- ===== B. Seed data =====
CALL _t_expect_equal('B01 users = 4',            (SELECT COUNT(*) FROM users), 4);
CALL _t_expect_equal('B02 admins = 1',           (SELECT COUNT(*) FROM users WHERE role='ADMIN'), 1);
CALL _t_expect_equal('B03 vehicles = 5',         (SELECT COUNT(*) FROM vehicles), 5);
CALL _t_expect_equal('B04 parking_lots = 3',     (SELECT COUNT(*) FROM parking_lots), 3);
CALL _t_expect_equal('B05 parking_slots = 30',   (SELECT COUNT(*) FROM parking_slots), 30);
CALL _t_expect_equal('B06 all slots AVAILABLE',  (SELECT COUNT(*) FROM parking_slots WHERE status='AVAILABLE'), 30);
CALL _t_expect_equal('B07 pricing_rules = 12',   (SELECT COUNT(*) FROM pricing_rules), 12);
CALL _t_expect_equal('B08 peak_multipliers = 135', (SELECT COUNT(*) FROM peak_multipliers), 135);
CALL _t_expect_equal('B09 favorite_lots = 3',    (SELECT COUNT(*) FROM favorite_lots), 3);
CALL _t_expect_equal('B10 reservations empty',   (SELECT COUNT(*) FROM reservations), 0);
CALL _t_expect_equal('B11 lot 1 has 12 slots',   (SELECT COUNT(*) FROM parking_slots WHERE lot_id=1), 12);
CALL _t_expect_equal('B12 every lot has a price for all 4 vehicle types',
  (SELECT COUNT(*) FROM (SELECT lot_id FROM pricing_rules GROUP BY lot_id HAVING COUNT(*) = 4) x), 3);

-- ===== C. Rules that must reject bad data (negative tests) =====
-- Error numbers: 1062 duplicate, 1265 bad ENUM, 1451 parent delete blocked, 1452 missing parent, 3819 CHECK failed.
START TRANSACTION;

CALL _t_expect_fail('C01 duplicate email rejected',
  "INSERT INTO users (full_name, email, password_hash) VALUES ('Dup', 'rohan@example.com', 'x')", 1062);
CALL _t_expect_fail('C02 invalid role rejected',
  "INSERT INTO users (full_name, email, password_hash, role) VALUES ('Bad', 'bad@example.com', 'x', 'SUPERUSER')", 1265);
CALL _t_expect_fail('C03 duplicate plate rejected',
  "INSERT INTO vehicles (user_id, plate_number, vehicle_type) VALUES (2, 'KA01AB1234', 'CAR')", 1062);
CALL _t_expect_fail('C04 vehicle with unknown user rejected',
  "INSERT INTO vehicles (user_id, plate_number, vehicle_type) VALUES (999, 'KA99ZZ0001', 'CAR')", 1452);
CALL _t_expect_fail('C05 latitude above 90 rejected',
  "INSERT INTO parking_lots (name, address, city, latitude, longitude) VALUES ('Bad', 'Addr', 'City', 95.000000, 77.000000)", 3819);
CALL _t_expect_fail('C06 grace period above 120 rejected',
  "INSERT INTO parking_lots (name, address, city, latitude, longitude, grace_period_minutes) VALUES ('Bad2', 'Addr', 'City', 12.000000, 77.000000, 200)", 3819);
CALL _t_expect_fail('C07 duplicate slot number in same lot rejected',
  "INSERT INTO parking_slots (lot_id, slot_number, slot_type) VALUES (1, 'A01', 'CAR')", 1062);
CALL _t_expect_fail('C08 slot with unknown lot rejected',
  "INSERT INTO parking_slots (lot_id, slot_number, slot_type) VALUES (999, 'Z01', 'CAR')", 1452);
CALL _t_expect_fail('C09 zero base rate rejected',
  "INSERT INTO pricing_rules (lot_id, vehicle_type, base_rate_per_hour) VALUES (1, 'BIKE', 0)", 3819);
CALL _t_expect_fail('C10 duplicate pricing rule per lot and type rejected',
  "INSERT INTO pricing_rules (lot_id, vehicle_type, base_rate_per_hour) VALUES (1, 'CAR', 99)", 1062);
CALL _t_expect_fail('C11 multiplier above 3.00 rejected',
  "INSERT INTO peak_multipliers (lot_id, day_of_week, hour_of_day, multiplier) VALUES (1, 0, 3, 5.00)", 3819);
CALL _t_expect_fail('C12 hour_of_day 24 rejected',
  "INSERT INTO peak_multipliers (lot_id, day_of_week, hour_of_day, multiplier) VALUES (1, 0, 24, 1.50)", 3819);
CALL _t_expect_fail('C13 duplicate peak row rejected',
  "INSERT INTO peak_multipliers (lot_id, day_of_week, hour_of_day, multiplier) VALUES (1, 0, 8, 1.10)", 1062);
CALL _t_expect_fail('C14 reservation end equal to start rejected',
  "INSERT INTO reservations (vehicle_id, slot_id, start_time, end_time, qr_token) VALUES (1, 3, '2030-01-01 10:00:00', '2030-01-01 10:00:00', 'aaaaaaaa-0000-0000-0000-000000000001')", 3819);
CALL _t_expect_fail('C15 reservation with unknown slot rejected',
  "INSERT INTO reservations (vehicle_id, slot_id, start_time, end_time, qr_token) VALUES (1, 999, '2030-01-01 10:00:00', '2030-01-01 11:00:00', 'aaaaaaaa-0000-0000-0000-000000000002')", 1452);
CALL _t_expect_fail('C16 negative quoted amount rejected',
  "INSERT INTO reservations (vehicle_id, slot_id, start_time, end_time, quoted_amount, qr_token) VALUES (1, 3, '2030-01-01 10:00:00', '2030-01-01 11:00:00', -5, 'aaaaaaaa-0000-0000-0000-000000000003')", 3819);
CALL _t_expect_fail('C17 check-out before check-in rejected',
  "INSERT INTO reservations (vehicle_id, slot_id, start_time, end_time, checked_in_at, checked_out_at, qr_token) VALUES (1, 3, '2030-01-01 10:00:00', '2030-01-01 11:00:00', '2030-01-01 10:30:00', '2030-01-01 10:10:00', 'aaaaaaaa-0000-0000-0000-000000000004')", 3819);
CALL _t_expect_fail('C18 waitlist end before start rejected',
  "INSERT INTO waitlist (vehicle_id, lot_id, desired_start, desired_end) VALUES (1, 1, '2030-01-01 12:00:00', '2030-01-01 11:00:00')", 3819);
CALL _t_expect_fail('C19 deleting a user who still has vehicles rejected',
  "DELETE FROM users WHERE user_id = 2", 1451);

-- ===== D. Positive path and relationship rules (rolled back at the end) =====
INSERT INTO reservations (reservation_id, vehicle_id, slot_id, start_time, end_time, quoted_amount, qr_token)
VALUES (9001, 1, 3, '2030-01-01 10:00:00', '2030-01-01 12:00:00', 80.00, 'bbbbbbbb-0000-0000-0000-000000009001');
CALL _t_expect_equal('D01 valid reservation inserted', (SELECT COUNT(*) FROM reservations WHERE reservation_id = 9001), 1);
CALL _t_expect_equal('D02 reservation defaults to CONFIRMED',
  (SELECT COUNT(*) FROM reservations WHERE reservation_id = 9001 AND status = 'CONFIRMED'), 1);

INSERT INTO payments (reservation_id, amount, payment_type, method, status, transaction_ref, paid_at)
VALUES (9001, 80.00, 'BOOKING', 'UPI', 'PAID', 'TXN-TEST-0001', '2030-01-01 09:00:00');
CALL _t_expect_equal('D03 valid payment inserted', (SELECT COUNT(*) FROM payments WHERE reservation_id = 9001), 1);

CALL _t_expect_fail('D04 negative payment rejected',
  "INSERT INTO payments (reservation_id, amount, payment_type, method) VALUES (9001, -1.00, 'BOOKING', 'UPI')", 3819);
CALL _t_expect_fail('D05 duplicate transaction ref rejected',
  "INSERT INTO payments (reservation_id, amount, payment_type, method, transaction_ref) VALUES (9001, 5.00, 'PENALTY', 'UPI', 'TXN-TEST-0001')", 1062);
CALL _t_expect_fail('D06 duplicate qr_token rejected',
  "INSERT INTO reservations (vehicle_id, slot_id, start_time, end_time, qr_token) VALUES (1, 4, '2030-02-01 10:00:00', '2030-02-01 11:00:00', 'bbbbbbbb-0000-0000-0000-000000009001')", 1062);

INSERT INTO reviews (reservation_id, rating, comment) VALUES (9001, 5, 'Smooth experience');
CALL _t_expect_equal('D07 valid review inserted', (SELECT COUNT(*) FROM reviews WHERE reservation_id = 9001), 1);
CALL _t_expect_fail('D08 rating 6 rejected',
  "INSERT INTO reviews (reservation_id, rating) VALUES (9001, 6)", 3819);
CALL _t_expect_fail('D09 second review for same reservation rejected',
  "INSERT INTO reviews (reservation_id, rating) VALUES (9001, 4)", 1062);

CALL _t_expect_fail('D10 deleting a slot that has a reservation rejected',
  "DELETE FROM parking_slots WHERE slot_id = 3", 1451);
CALL _t_expect_fail('D11 deleting a lot whose slots have reservations rejected',
  "DELETE FROM parking_lots WHERE lot_id = 1", 1451);
CALL _t_expect_fail('D12 deleting a vehicle that has a reservation rejected',
  "DELETE FROM vehicles WHERE vehicle_id = 1", 1451);

-- Owner of a reservation is reachable through the vehicle (no user_id column on reservations)
CALL _t_expect_equal('D13 reservation owner resolves to user 2 through vehicles',
  (SELECT v.user_id FROM reservations r JOIN vehicles v ON v.vehicle_id = r.vehicle_id WHERE r.reservation_id = 9001), 2);

-- Cascade: deleting a lot with NO reservations removes its slots, prices and peak rows
INSERT INTO parking_lots (lot_id, name, address, city, latitude, longitude) VALUES (900, 'Temp Lot', 'Temp Addr', 'Temp City', 12.000000, 77.000000);
INSERT INTO parking_slots (lot_id, slot_number, slot_type) VALUES (900, 'T01', 'CAR');
INSERT INTO pricing_rules (lot_id, vehicle_type, base_rate_per_hour) VALUES (900, 'CAR', 10.00);
INSERT INTO peak_multipliers (lot_id, day_of_week, hour_of_day, multiplier) VALUES (900, 0, 8, 1.25);
DELETE FROM parking_lots WHERE lot_id = 900;
CALL _t_expect_equal('D14 deleting an empty lot cascades to its slots',
  (SELECT COUNT(*) FROM parking_slots WHERE lot_id = 900), 0);
CALL _t_expect_equal('D15 deleting an empty lot cascades to its pricing rules',
  (SELECT COUNT(*) FROM pricing_rules WHERE lot_id = 900), 0);
CALL _t_expect_equal('D16 deleting an empty lot cascades to its peak multipliers',
  (SELECT COUNT(*) FROM peak_multipliers WHERE lot_id = 900), 0);

-- Deleting a reservation removes its review (CASCADE) but payments block it (RESTRICT)
CALL _t_expect_fail('D17 deleting a reservation that has a payment rejected',
  "DELETE FROM reservations WHERE reservation_id = 9001", 1451);

ROLLBACK;

CALL _t_expect_equal('D18 rollback left no test reservation behind', (SELECT COUNT(*) FROM reservations), 0);
CALL _t_expect_equal('D19 rollback left seed users unchanged', (SELECT COUNT(*) FROM users), 4);

-- ===== Report =====
SELECT check_name, result FROM _t_results ORDER BY seq;
SELECT SUM(result = 'PASS') AS passed, SUM(result = 'FAIL') AS failed, COUNT(*) AS total FROM _t_results;

DROP PROCEDURE IF EXISTS _t_expect_equal;
DROP PROCEDURE IF EXISTS _t_expect_fail;
DROP TEMPORARY TABLE IF EXISTS _t_results;

