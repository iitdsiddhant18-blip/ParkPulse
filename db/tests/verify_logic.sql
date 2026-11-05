-- ParkPulse - Phase 1b verification suite.
-- Verifies structure, security grants, dynamic pricing, triggers, stored procedures, views,
-- waitlist auto-notification, expiry, and audit logging, then restores a clean seed state.
USE parkpulse;

SET @OLD_EVENT_SCHEDULER = @@global.event_scheduler;
SET GLOBAL event_scheduler = OFF;

DROP TEMPORARY TABLE IF EXISTS _t1b_results;
CREATE TEMPORARY TABLE _t1b_results (
  seq INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  check_name VARCHAR(120) NOT NULL,
  result VARCHAR(4) NOT NULL
) ENGINE=MEMORY;

DROP PROCEDURE IF EXISTS _t1b_expect_equal;
DROP PROCEDURE IF EXISTS _t1b_expect_fail;

DELIMITER $$
CREATE PROCEDURE _t1b_expect_equal(IN p_name VARCHAR(120), IN p_actual VARCHAR(120), IN p_expected VARCHAR(120))
BEGIN
  INSERT INTO _t1b_results (check_name, result)
  VALUES (p_name, IF(COALESCE(p_actual, 'NULL') = COALESCE(p_expected, 'NULL'), 'PASS', 'FAIL'));
END$$

CREATE PROCEDURE _t1b_expect_fail(IN p_name VARCHAR(120), IN p_sql TEXT, IN p_errno INT)
BEGIN
  DECLARE v_errno INT DEFAULT 0;
  DECLARE CONTINUE HANDLER FOR SQLEXCEPTION, SQLWARNING
    BEGIN
      GET DIAGNOSTICS CONDITION 1 v_errno = MYSQL_ERRNO;
    END;
  SET @_t1b_sql = p_sql;
  PREPARE _t1b_stmt FROM @_t1b_sql;
  EXECUTE _t1b_stmt;
  DEALLOCATE PREPARE _t1b_stmt;
  INSERT INTO _t1b_results (check_name, result)
  VALUES (p_name, IF(v_errno = p_errno, 'PASS', 'FAIL'));
END$$
DELIMITER ;

-- ===== E. Phase 1b Structure & Security (12 checks) =====
CALL _t1b_expect_equal('E01 trigger count is 5',
  (SELECT COUNT(*) FROM information_schema.triggers WHERE trigger_schema = 'parkpulse'), '5');
CALL _t1b_expect_equal('E02 stored procedure count is 5',
  (SELECT COUNT(*) FROM information_schema.routines
    WHERE routine_schema = 'parkpulse' AND routine_type = 'PROCEDURE' AND routine_name NOT LIKE '\_t%'), '5');
CALL _t1b_expect_equal('E03 stored function count is 1',
  (SELECT COUNT(*) FROM information_schema.routines
    WHERE routine_schema = 'parkpulse' AND routine_type = 'FUNCTION'), '1');
CALL _t1b_expect_equal('E04 view count is 4',
  (SELECT COUNT(*) FROM information_schema.views WHERE table_schema = 'parkpulse'), '4');
CALL _t1b_expect_equal('E05 scheduled event count is 1',
  (SELECT COUNT(*) FROM information_schema.events WHERE event_schema = 'parkpulse'), '1');
CALL _t1b_expect_equal('E06 event_scheduler was ON at boot',
  @OLD_EVENT_SCHEDULER, 'ON');
CALL _t1b_expect_equal('E07 mysql user parkpulse_admin exists',
  (SELECT COUNT(*) > 0 FROM mysql.user WHERE user = 'parkpulse_admin'), '1');
CALL _t1b_expect_equal('E08 mysql user parkpulse_app exists',
  (SELECT COUNT(*) > 0 FROM mysql.user WHERE user = 'parkpulse_app'), '1');
CALL _t1b_expect_equal('E09 parkpulse_app has no DROP privilege on parkpulse',
  (SELECT COUNT(*) FROM mysql.db WHERE user = 'parkpulse_app' AND db = 'parkpulse' AND Drop_priv = 'Y'), '0');
CALL _t1b_expect_equal('E10 v_lot_occupancy returns 3 lots on seed data',
  (SELECT COUNT(*) FROM v_lot_occupancy), '3');
CALL _t1b_expect_equal('E11 v_lot_occupancy shows 0 occupied slots initially',
  (SELECT SUM(occupied_slots) FROM v_lot_occupancy), '0');
CALL _t1b_expect_equal('E12 v_active_reservations is empty initially',
  (SELECT COUNT(*) FROM v_active_reservations), '0');

-- ===== F. Dynamic Pricing Function get_dynamic_price (6 checks) =====
CALL _t1b_expect_equal('F01 off-peak weekday 2h CAR at lot 1 = 80.00',
  CAST(get_dynamic_price(1, 'CAR', '2030-01-07 10:00:00', '2030-01-07 12:00:00') AS CHAR), '80.00');
CALL _t1b_expect_equal('F02 morning peak weekday 2h CAR at lot 1 = 100.00',
  CAST(get_dynamic_price(1, 'CAR', '2030-01-07 08:00:00', '2030-01-07 10:00:00') AS CHAR), '100.00');
CALL _t1b_expect_equal('F03 evening cross-boundary 2h CAR at lot 1 = 100.00',
  CAST(get_dynamic_price(1, 'CAR', '2030-01-07 16:00:00', '2030-01-07 18:00:00') AS CHAR), '100.00');
CALL _t1b_expect_equal('F04 weekend peak 2h SUV at lot 1 = 150.00',
  CAST(get_dynamic_price(1, 'SUV', '2030-01-12 12:00:00', '2030-01-12 14:00:00') AS CHAR), '150.00');
CALL _t1b_expect_equal('F05 cross-boundary 90m CAR at lot 1 = 80.00',
  CAST(get_dynamic_price(1, 'CAR', '2030-01-07 16:30:00', '2030-01-07 18:00:00') AS CHAR), '80.00');
CALL _t1b_expect_equal('F06 invalid time range (end <= start) returns 0.00',
  CAST(get_dynamic_price(1, 'CAR', '2030-01-07 12:00:00', '2030-01-07 10:00:00') AS CHAR), '0.00');

-- ===== G. Triggers: Type Match, Overlap Block, Slot Sync, Audit Log (12 checks) =====
-- Error 1644 is MySQL's error code for unhandled user SIGNAL SQLSTATE '45000'
CALL _t1b_expect_fail('G01 mismatched vehicle type (BIKE in CAR slot) rejected',
  "CALL book_slot(2, 3, '2030-01-07 08:00:00', '2030-01-07 10:00:00', NULL, @r_bad, @q_bad, @qr_bad)", 1644);

UPDATE parking_slots SET status = 'MAINTENANCE' WHERE slot_id = 4;
CALL _t1b_expect_fail('G02 booking in MAINTENANCE slot rejected',
  "CALL book_slot(1, 4, '2030-01-07 08:00:00', '2030-01-07 10:00:00', NULL, @r_bad, @q_bad, @qr_bad)", 1644);
UPDATE parking_slots SET status = 'AVAILABLE' WHERE slot_id = 4;

SET @app_user = 'user:2';
CALL book_slot(1, 3, '2030-01-07 08:00:00', '2030-01-07 10:00:00', NULL, @res1_id, @res1_quote, @res1_qr);
CALL _t1b_expect_equal('G03 valid reservation via book_slot succeeds',
  (SELECT COUNT(*) FROM reservations WHERE reservation_id = @res1_id AND status = 'CONFIRMED'), '1');
CALL _t1b_expect_equal('G04 book_slot sets quoted_amount to 100.00 for morning peak',
  CAST(@res1_quote AS CHAR), '100.00');
CALL _t1b_expect_equal('G05 slot status auto-updated to RESERVED on insert',
  (SELECT status FROM parking_slots WHERE slot_id = 3), 'RESERVED');

CALL _t1b_expect_fail('G06 exact same window overlap on same slot rejected',
  "CALL book_slot(5, 3, '2030-01-07 08:00:00', '2030-01-07 10:00:00', NULL, @r_ov1, @q_ov1, @qr_ov1)", 1644);
CALL _t1b_expect_fail('G07 partial overlap (starts inside existing window) rejected',
  "CALL book_slot(5, 3, '2030-01-07 09:00:00', '2030-01-07 11:00:00', NULL, @r_ov2, @q_ov2, @qr_ov2)", 1644);

-- Adjacent window (starts at 10:00:00 right when first booking ends) must be allowed
SET @app_user = 'user:4';
CALL book_slot(5, 3, '2030-01-07 10:00:00', '2030-01-07 12:00:00', NULL, @res2_id, @res2_quote, @res2_qr);
CALL _t1b_expect_equal('G08 adjacent window (starts at existing end_time) allowed',
  (SELECT COUNT(*) FROM reservations WHERE reservation_id = @res2_id AND status = 'CONFIRMED'), '1');

CALL _t1b_expect_fail('G09 updating adjacent reservation to overlap existing rejected',
  CONCAT("UPDATE reservations SET start_time = '2030-01-07 09:30:00' WHERE reservation_id = ", @res2_id), 1644);

CALL _t1b_expect_equal('G10 audit_log recorded INSERT for both reservations',
  (SELECT COUNT(*) FROM audit_log WHERE table_name = 'reservations' AND action = 'INSERT'), '2');
CALL _t1b_expect_equal('G11 BOOKING_CONFIRMED notifications created for both bookings',
  (SELECT COUNT(*) FROM notifications WHERE type = 'BOOKING_CONFIRMED'), '2');
CALL _t1b_expect_equal('G12 v_active_reservations shows 2 active bookings',
  (SELECT COUNT(*) FROM v_active_reservations), '2');

-- ===== H. Lifecycle Procedures: Check-in, Checkout+Overstay, Cancel, Waitlist, Expiry, Views (18 checks) =====
CALL _t1b_expect_fail('H01 check_in with wrong qr_token rejected',
  CONCAT("CALL check_in(", @res1_id, ", '00000000-0000-0000-0000-000000000000', '2030-01-07 08:05:00')"), 1644);
CALL _t1b_expect_fail('H02 check_in too early (more than 15m before start) rejected',
  CONCAT("CALL check_in(", @res1_id, ", '", @res1_qr, "', '2030-01-07 07:30:00')"), 1644);

CALL check_in(@res1_id, @res1_qr, '2030-01-07 08:05:00');
CALL _t1b_expect_equal('H03 valid check_in transitions status to CHECKED_IN',
  (SELECT status FROM reservations WHERE reservation_id = @res1_id), 'CHECKED_IN');
CALL _t1b_expect_equal('H04 slot status auto-updated to OCCUPIED on check_in',
  (SELECT status FROM parking_slots WHERE slot_id = 3), 'OCCUPIED');
CALL _t1b_expect_equal('H05 v_lot_occupancy shows 1 occupied slot in lot 1',
  (SELECT CAST(occupied_slots AS CHAR) FROM v_lot_occupancy WHERE lot_id = 1), '1');

-- Check out 45 minutes after 10:00:00 end_time -> 1 ceiling hour of overstay -> 80.00 penalty for Lot 1 CAR
CALL checkout_and_bill(@res1_id, '2030-01-07 10:45:00', 'UPI', @b_amt, @p_amt, @t_amt);
CALL _t1b_expect_equal('H06 checkout_and_bill with 45m overstay calculates 80.00 penalty',
  CAST(@p_amt AS CHAR), '80.00');
CALL _t1b_expect_equal('H07 checkout_and_bill transitions status to COMPLETED',
  (SELECT status FROM reservations WHERE reservation_id = @res1_id), 'COMPLETED');
CALL _t1b_expect_equal('H08 checkout_and_bill creates CHECKOUT and PENALTY payment rows',
  (SELECT COUNT(*) FROM payments WHERE reservation_id = @res1_id AND status = 'PAID'), '2');
CALL _t1b_expect_equal('H09 v_daily_revenue shows 180.00 net revenue for lot 1',
  (SELECT CAST(net_revenue AS CHAR) FROM v_daily_revenue WHERE lot_id = 1 AND revenue_date = '2030-01-07'), '180.00');

-- Insert a waitlist entry for user 2 (vehicle 1, CAR) at lot 1 overlapping res2's 10:00-12:00 window
INSERT INTO waitlist (vehicle_id, lot_id, desired_start, desired_end)
VALUES (1, 1, '2030-01-07 10:30:00', '2030-01-07 11:30:00');
SET @wait_id = LAST_INSERT_ID();
CALL _t1b_expect_equal('H10 waitlist entry inserted as WAITING for busy window',
  (SELECT status FROM waitlist WHERE waitlist_id = @wait_id), 'WAITING');

-- User 2 (not owner of res2 and not admin) cannot cancel user 4's reservation
CALL _t1b_expect_fail('H11 cancel_booking by wrong non-admin user rejected',
  CONCAT("CALL cancel_booking(", @res2_id, ", 2, FALSE)"), 1644);

-- Owner (user 4) cancels res2 -> frees slot 3 and auto-notifies waitlist entry
CALL cancel_booking(@res2_id, 4, FALSE);
CALL _t1b_expect_equal('H12 cancel_booking by owner transitions status to CANCELLED',
  (SELECT status FROM reservations WHERE reservation_id = @res2_id), 'CANCELLED');
CALL _t1b_expect_equal('H13 slot status returns to AVAILABLE after second booking cancelled',
  (SELECT status FROM parking_slots WHERE slot_id = 3), 'AVAILABLE');
CALL _t1b_expect_equal('H14 cancelling reservation auto-notifies matching waitlist row',
  (SELECT status FROM waitlist WHERE waitlist_id = @wait_id), 'NOTIFIED');
CALL _t1b_expect_equal('H15 WAITLIST_AVAILABLE notification created for waitlisted user',
  (SELECT COUNT(*) FROM notifications WHERE user_id = 2 AND type = 'WAITLIST_AVAILABLE'), '1');

-- Create a third booking on slot 5 (08:00 to 10:00, lot 1 grace period = 15m) and expire it at 08:20
CALL book_slot(1, 5, '2030-01-08 08:00:00', '2030-01-08 10:00:00', NULL, @res3_id, @res3_quote, @res3_qr);
CALL expire_stale_reservations('2030-01-08 08:20:00', @exp_cnt);
CALL _t1b_expect_equal('H16 expire_stale_reservations marks past-grace booking EXPIRED',
  (SELECT status FROM reservations WHERE reservation_id = @res3_id), 'EXPIRED');
CALL _t1b_expect_equal('H17 expired booking frees slot 5 back to AVAILABLE',
  (SELECT status FROM parking_slots WHERE slot_id = 5), 'AVAILABLE');

-- Update pricing_rules and verify trg_pricing_after_update writes to audit_log, then restore rate
UPDATE pricing_rules SET base_rate_per_hour = 45.00 WHERE lot_id = 1 AND vehicle_type = 'CAR';
CALL _t1b_expect_equal('H18 pricing_rules update writes old and new rates to audit_log',
  (SELECT COUNT(*) FROM audit_log WHERE table_name = 'pricing_rules' AND action = 'UPDATE'), '1');
UPDATE pricing_rules SET base_rate_per_hour = 40.00 WHERE lot_id = 1 AND vehicle_type = 'CAR';

-- ===== I. Cleanup & Clean State Verification (4 checks) =====
DELETE FROM payments;
DELETE FROM notifications;
DELETE FROM waitlist;
DELETE FROM reservations;
DELETE FROM audit_log;
ALTER TABLE payments AUTO_INCREMENT = 1;
ALTER TABLE notifications AUTO_INCREMENT = 1;
ALTER TABLE waitlist AUTO_INCREMENT = 1;
ALTER TABLE reservations AUTO_INCREMENT = 1;
ALTER TABLE audit_log AUTO_INCREMENT = 1;
UPDATE parking_slots SET status = 'AVAILABLE';
SET @app_user = NULL;
SET GLOBAL event_scheduler = @OLD_EVENT_SCHEDULER;

CALL _t1b_expect_equal('I01 cleanup leaves 0 reservations',
  (SELECT COUNT(*) FROM reservations), '0');
CALL _t1b_expect_equal('I02 cleanup leaves all 30 slots AVAILABLE',
  (SELECT COUNT(*) FROM parking_slots WHERE status = 'AVAILABLE'), '30');
CALL _t1b_expect_equal('I03 cleanup leaves seed users = 4 and vehicles = 5',
  (SELECT CONCAT(COUNT(DISTINCT u.user_id), '-', COUNT(DISTINCT v.vehicle_id)) FROM users u CROSS JOIN vehicles v), '4-5');
CALL _t1b_expect_equal('I04 cleanup leaves audit_log empty',
  (SELECT COUNT(*) FROM audit_log), '0');

-- ===== Report =====
SELECT check_name, result FROM _t1b_results ORDER BY seq;
SELECT SUM(result = 'PASS') AS passed, SUM(result = 'FAIL') AS failed, COUNT(*) AS total FROM _t1b_results;

DROP PROCEDURE IF EXISTS _t1b_expect_equal;
DROP PROCEDURE IF EXISTS _t1b_expect_fail;
DROP TEMPORARY TABLE IF EXISTS _t1b_results;

