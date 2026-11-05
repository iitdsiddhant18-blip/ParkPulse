-- ParkPulse - Phase 1b database business logic (MySQL 8.4)
-- Creates 1 function, 5 triggers, 5 stored procedures, 4 views, and 1 scheduled event.

USE parkpulse;

DROP EVENT IF EXISTS ev_expire_stale_reservations;

DROP VIEW IF EXISTS v_peak_hours;
DROP VIEW IF EXISTS v_active_reservations;
DROP VIEW IF EXISTS v_lot_occupancy;
DROP VIEW IF EXISTS v_daily_revenue;

DROP PROCEDURE IF EXISTS expire_stale_reservations;
DROP PROCEDURE IF EXISTS checkout_and_bill;
DROP PROCEDURE IF EXISTS check_in;
DROP PROCEDURE IF EXISTS cancel_booking;
DROP PROCEDURE IF EXISTS book_slot;

DROP TRIGGER IF EXISTS trg_pricing_after_update;
DROP TRIGGER IF EXISTS trg_resv_after_update;
DROP TRIGGER IF EXISTS trg_resv_after_insert;
DROP TRIGGER IF EXISTS trg_resv_before_update;
DROP TRIGGER IF EXISTS trg_resv_before_insert;

DROP FUNCTION IF EXISTS get_dynamic_price;

DELIMITER $$

-- ============================================================================
-- 1. STORED FUNCTION: get_dynamic_price
-- ============================================================================
CREATE FUNCTION get_dynamic_price(
  p_lot_id       INT UNSIGNED,
  p_vehicle_type VARCHAR(10),
  p_start        DATETIME,
  p_end          DATETIME
) RETURNS DECIMAL(10,2)
READS SQL DATA
DETERMINISTIC
BEGIN
  DECLARE v_base_rate  DECIMAL(8,2) DEFAULT NULL;
  DECLARE v_cursor     DATETIME;
  DECLARE v_next_hour  DATETIME;
  DECLARE v_slice_end  DATETIME;
  DECLARE v_minutes    DECIMAL(10,4);
  DECLARE v_mult       DECIMAL(4,2);
  DECLARE v_total      DECIMAL(12,4) DEFAULT 0.0000;

  IF p_start IS NULL OR p_end IS NULL OR p_end <= p_start THEN
    RETURN 0.00;
  END IF;

  SELECT pr.base_rate_per_hour
    INTO v_base_rate
    FROM pricing_rules pr
   WHERE pr.lot_id = p_lot_id
     AND pr.vehicle_type = p_vehicle_type
   LIMIT 1;

  IF v_base_rate IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Pricing rule not found for lot and vehicle type';
  END IF;

  SET v_cursor = p_start;
  WHILE v_cursor < p_end DO
    SET v_next_hour = DATE_ADD(DATE_FORMAT(v_cursor, '%Y-%m-%d %H:00:00'), INTERVAL 1 HOUR);
    SET v_slice_end = IF(v_next_hour < p_end, v_next_hour, p_end);
    SET v_minutes   = TIMESTAMPDIFF(SECOND, v_cursor, v_slice_end) / 60.0;

    SET v_mult = NULL;
    SELECT pm.multiplier
      INTO v_mult
      FROM peak_multipliers pm
     WHERE pm.lot_id = p_lot_id
       AND pm.day_of_week = WEEKDAY(v_cursor)
       AND pm.hour_of_day = HOUR(v_cursor)
     LIMIT 1;

    SET v_mult   = COALESCE(v_mult, 1.00);
    SET v_total  = v_total + (v_base_rate * v_mult * (v_minutes / 60.0));
    SET v_cursor = v_slice_end;
  END WHILE;

  RETURN ROUND(v_total, 2);
END$$

-- ============================================================================
-- 2. TRIGGERS (5)
-- ============================================================================

-- 2.1 Validate slot status, vehicle/slot type match, and overlap before INSERT
CREATE TRIGGER trg_resv_before_insert
BEFORE INSERT ON reservations
FOR EACH ROW
BEGIN
  DECLARE v_slot_type    VARCHAR(10) DEFAULT NULL;
  DECLARE v_slot_status  VARCHAR(20) DEFAULT NULL;
  DECLARE v_vehicle_type VARCHAR(10) DEFAULT NULL;
  DECLARE v_overlaps     INT DEFAULT 0;

  SELECT ps.slot_type, ps.status
    INTO v_slot_type, v_slot_status
    FROM parking_slots ps
   WHERE ps.slot_id = NEW.slot_id;

  SELECT v.vehicle_type
    INTO v_vehicle_type
    FROM vehicles v
   WHERE v.vehicle_id = NEW.vehicle_id;

  IF NEW.status IN ('CONFIRMED', 'CHECKED_IN') THEN
    IF v_slot_status = 'MAINTENANCE' THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Cannot book a slot under maintenance';
    END IF;

    IF v_vehicle_type <> v_slot_type THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Vehicle type does not match slot type';
    END IF;

    SELECT COUNT(*)
      INTO v_overlaps
      FROM reservations r
     WHERE r.slot_id = NEW.slot_id
       AND r.status IN ('CONFIRMED', 'CHECKED_IN')
       AND NEW.start_time < r.end_time
       AND NEW.end_time > r.start_time;

    IF v_overlaps > 0 THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Overlapping reservation for this slot';
    END IF;
  END IF;
END$$

-- 2.2 Validate slot status, vehicle/slot type match, and overlap before UPDATE
CREATE TRIGGER trg_resv_before_update
BEFORE UPDATE ON reservations
FOR EACH ROW
BEGIN
  DECLARE v_slot_type    VARCHAR(10) DEFAULT NULL;
  DECLARE v_slot_status  VARCHAR(20) DEFAULT NULL;
  DECLARE v_vehicle_type VARCHAR(10) DEFAULT NULL;
  DECLARE v_overlaps     INT DEFAULT 0;

  SELECT ps.slot_type, ps.status
    INTO v_slot_type, v_slot_status
    FROM parking_slots ps
   WHERE ps.slot_id = NEW.slot_id;

  SELECT v.vehicle_type
    INTO v_vehicle_type
    FROM vehicles v
   WHERE v.vehicle_id = NEW.vehicle_id;

  IF NEW.status IN ('CONFIRMED', 'CHECKED_IN') THEN
    IF v_slot_status = 'MAINTENANCE' THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Cannot book a slot under maintenance';
    END IF;

    IF v_vehicle_type <> v_slot_type THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Vehicle type does not match slot type';
    END IF;

    IF (NEW.slot_id <> OLD.slot_id
        OR NEW.start_time <> OLD.start_time
        OR NEW.end_time <> OLD.end_time
        OR (OLD.status NOT IN ('CONFIRMED', 'CHECKED_IN') AND NEW.status IN ('CONFIRMED', 'CHECKED_IN'))) THEN
      SELECT COUNT(*)
        INTO v_overlaps
        FROM reservations r
       WHERE r.slot_id = NEW.slot_id
         AND r.reservation_id <> NEW.reservation_id
         AND r.status IN ('CONFIRMED', 'CHECKED_IN')
         AND NEW.start_time < r.end_time
         AND NEW.end_time > r.start_time;

      IF v_overlaps > 0 THEN
        SIGNAL SQLSTATE '45000'
          SET MESSAGE_TEXT = 'Overlapping reservation for this slot';
      END IF;
    END IF;
  END IF;
END$$

-- 2.3 Sync parking_slots.status and write audit_log on reservation INSERT
CREATE TRIGGER trg_resv_after_insert
AFTER INSERT ON reservations
FOR EACH ROW
BEGIN
  UPDATE parking_slots ps
     SET ps.status = CASE
       WHEN ps.status = 'MAINTENANCE' THEN 'MAINTENANCE'
       WHEN EXISTS (
         SELECT 1 FROM reservations r
          WHERE r.slot_id = NEW.slot_id AND r.status = 'CHECKED_IN'
       ) THEN 'OCCUPIED'
       WHEN EXISTS (
         SELECT 1 FROM reservations r
          WHERE r.slot_id = NEW.slot_id AND r.status = 'CONFIRMED'
       ) THEN 'RESERVED'
       ELSE 'AVAILABLE'
     END
   WHERE ps.slot_id = NEW.slot_id;

  INSERT INTO audit_log (table_name, record_id, action, old_values, new_values, changed_by)
  VALUES (
    'reservations',
    NEW.reservation_id,
    'INSERT',
    NULL,
    JSON_OBJECT(
      'vehicle_id', NEW.vehicle_id,
      'slot_id', NEW.slot_id,
      'start_time', DATE_FORMAT(NEW.start_time, '%Y-%m-%d %H:%i:%s'),
      'end_time', DATE_FORMAT(NEW.end_time, '%Y-%m-%d %H:%i:%s'),
      'status', NEW.status,
      'quoted_amount', NEW.quoted_amount
    ),
    COALESCE(@app_user, USER())
  );
END$$

-- 2.4 Sync parking_slots.status, write audit_log, and notify waitlist on reservation UPDATE
CREATE TRIGGER trg_resv_after_update
AFTER UPDATE ON reservations
FOR EACH ROW
BEGIN
  DECLARE v_lot_id            INT UNSIGNED DEFAULT NULL;
  DECLARE v_slot_type         VARCHAR(10) DEFAULT NULL;
  DECLARE v_waitlist_id       INT UNSIGNED DEFAULT NULL;
  DECLARE v_wait_user_id      INT UNSIGNED DEFAULT NULL;
  DECLARE v_remaining_overlap INT DEFAULT 0;

  UPDATE parking_slots ps
     SET ps.status = CASE
       WHEN ps.status = 'MAINTENANCE' THEN 'MAINTENANCE'
       WHEN EXISTS (
         SELECT 1 FROM reservations r
          WHERE r.slot_id = NEW.slot_id AND r.status = 'CHECKED_IN'
       ) THEN 'OCCUPIED'
       WHEN EXISTS (
         SELECT 1 FROM reservations r
          WHERE r.slot_id = NEW.slot_id AND r.status = 'CONFIRMED'
       ) THEN 'RESERVED'
       ELSE 'AVAILABLE'
     END
   WHERE ps.slot_id = NEW.slot_id;

  IF OLD.slot_id <> NEW.slot_id THEN
    UPDATE parking_slots ps
       SET ps.status = CASE
         WHEN ps.status = 'MAINTENANCE' THEN 'MAINTENANCE'
         WHEN EXISTS (
           SELECT 1 FROM reservations r
            WHERE r.slot_id = OLD.slot_id AND r.status = 'CHECKED_IN'
         ) THEN 'OCCUPIED'
         WHEN EXISTS (
           SELECT 1 FROM reservations r
            WHERE r.slot_id = OLD.slot_id AND r.status = 'CONFIRMED'
         ) THEN 'RESERVED'
         ELSE 'AVAILABLE'
       END
     WHERE ps.slot_id = OLD.slot_id;
  END IF;

  INSERT INTO audit_log (table_name, record_id, action, old_values, new_values, changed_by)
  VALUES (
    'reservations',
    NEW.reservation_id,
    'UPDATE',
    JSON_OBJECT(
      'slot_id', OLD.slot_id,
      'start_time', DATE_FORMAT(OLD.start_time, '%Y-%m-%d %H:%i:%s'),
      'end_time', DATE_FORMAT(OLD.end_time, '%Y-%m-%d %H:%i:%s'),
      'status', OLD.status,
      'checked_in_at', IF(OLD.checked_in_at IS NULL, NULL, DATE_FORMAT(OLD.checked_in_at, '%Y-%m-%d %H:%i:%s')),
      'checked_out_at', IF(OLD.checked_out_at IS NULL, NULL, DATE_FORMAT(OLD.checked_out_at, '%Y-%m-%d %H:%i:%s'))
    ),
    JSON_OBJECT(
      'slot_id', NEW.slot_id,
      'start_time', DATE_FORMAT(NEW.start_time, '%Y-%m-%d %H:%i:%s'),
      'end_time', DATE_FORMAT(NEW.end_time, '%Y-%m-%d %H:%i:%s'),
      'status', NEW.status,
      'checked_in_at', IF(NEW.checked_in_at IS NULL, NULL, DATE_FORMAT(NEW.checked_in_at, '%Y-%m-%d %H:%i:%s')),
      'checked_out_at', IF(NEW.checked_out_at IS NULL, NULL, DATE_FORMAT(NEW.checked_out_at, '%Y-%m-%d %H:%i:%s'))
    ),
    COALESCE(@app_user, USER())
  );

  -- If an active reservation freed up, notify the first matching waitlisted user
  IF OLD.status IN ('CONFIRMED', 'CHECKED_IN')
     AND NEW.status IN ('CANCELLED', 'EXPIRED', 'COMPLETED', 'NO_SHOW') THEN

    SELECT COUNT(*)
      INTO v_remaining_overlap
      FROM reservations r
     WHERE r.slot_id = OLD.slot_id
       AND r.status IN ('CONFIRMED', 'CHECKED_IN')
       AND r.start_time < OLD.end_time
       AND r.end_time > OLD.start_time;

    IF v_remaining_overlap = 0 THEN
      SELECT ps.lot_id, ps.slot_type
        INTO v_lot_id, v_slot_type
        FROM parking_slots ps
       WHERE ps.slot_id = OLD.slot_id;

      SELECT w.waitlist_id, v.user_id
        INTO v_waitlist_id, v_wait_user_id
        FROM waitlist w
        JOIN vehicles v ON v.vehicle_id = w.vehicle_id
       WHERE w.lot_id = v_lot_id
         AND w.status = 'WAITING'
         AND v.vehicle_type = v_slot_type
         AND w.desired_start < OLD.end_time
         AND w.desired_end > OLD.start_time
       ORDER BY w.created_at ASC, w.waitlist_id ASC
       LIMIT 1;

      IF v_waitlist_id IS NOT NULL THEN
        UPDATE waitlist
           SET status = 'NOTIFIED'
         WHERE waitlist_id = v_waitlist_id;

        INSERT INTO notifications (user_id, reservation_id, type, message)
        VALUES (
          v_wait_user_id,
          NEW.reservation_id,
          'WAITLIST_AVAILABLE',
          CONCAT('A ', v_slot_type, ' slot is now available at lot #', v_lot_id, ' for your waitlisted window.')
        );
      END IF;
    END IF;
  END IF;
END$$

-- 2.5 Write audit_log when pricing_rules are updated
CREATE TRIGGER trg_pricing_after_update
AFTER UPDATE ON pricing_rules
FOR EACH ROW
BEGIN
  INSERT INTO audit_log (table_name, record_id, action, old_values, new_values, changed_by)
  VALUES (
    'pricing_rules',
    NEW.rule_id,
    'UPDATE',
    JSON_OBJECT(
      'lot_id', OLD.lot_id,
      'vehicle_type', OLD.vehicle_type,
      'base_rate_per_hour', OLD.base_rate_per_hour,
      'overstay_penalty_per_hour', OLD.overstay_penalty_per_hour
    ),
    JSON_OBJECT(
      'lot_id', NEW.lot_id,
      'vehicle_type', NEW.vehicle_type,
      'base_rate_per_hour', NEW.base_rate_per_hour,
      'overstay_penalty_per_hour', NEW.overstay_penalty_per_hour
    ),
    COALESCE(@app_user, USER())
  );
END$$

-- ============================================================================
-- 3. STORED PROCEDURES (5)
-- ============================================================================

-- 3.1 book_slot: transactional booking with SELECT ... FOR UPDATE row locking
CREATE PROCEDURE book_slot(
  IN  p_vehicle_id     INT UNSIGNED,
  IN  p_slot_id        INT UNSIGNED,
  IN  p_start          DATETIME,
  IN  p_end            DATETIME,
  IN  p_series_id      INT UNSIGNED,
  OUT p_reservation_id INT UNSIGNED,
  OUT p_quoted_amount  DECIMAL(10,2),
  OUT p_qr_token       CHAR(36)
)
BEGIN
  DECLARE v_lot_id       INT UNSIGNED DEFAULT NULL;
  DECLARE v_slot_type    VARCHAR(10) DEFAULT NULL;
  DECLARE v_slot_status  VARCHAR(20) DEFAULT NULL;
  DECLARE v_user_id      INT UNSIGNED DEFAULT NULL;
  DECLARE v_vehicle_type VARCHAR(10) DEFAULT NULL;

  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;

  IF p_start IS NULL OR p_end IS NULL OR p_end <= p_start THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Reservation end_time must be after start_time';
  END IF;

  START TRANSACTION;

  -- Lock the target slot row so concurrent bookings for the same slot serialize here
  SELECT ps.lot_id, ps.slot_type, ps.status
    INTO v_lot_id, v_slot_type, v_slot_status
    FROM parking_slots ps
   WHERE ps.slot_id = p_slot_id
     FOR UPDATE;

  IF v_lot_id IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Parking slot not found';
  END IF;

  -- Deterministic concurrency-test hook (no-op unless @debug_sleep_seconds > 0)
  IF COALESCE(@debug_sleep_seconds, 0) > 0 THEN
    DO SLEEP(@debug_sleep_seconds);
  END IF;

  SELECT v.user_id, v.vehicle_type
    INTO v_user_id, v_vehicle_type
    FROM vehicles v
   WHERE v.vehicle_id = p_vehicle_id;

  IF v_user_id IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Vehicle not found';
  END IF;

  SET p_quoted_amount = get_dynamic_price(v_lot_id, v_vehicle_type, p_start, p_end);
  SET p_qr_token      = UUID();

  INSERT INTO reservations (
    vehicle_id, slot_id, series_id, start_time, end_time, status, quoted_amount, qr_token
  ) VALUES (
    p_vehicle_id, p_slot_id, p_series_id, p_start, p_end, 'CONFIRMED', p_quoted_amount, p_qr_token
  );

  SET p_reservation_id = LAST_INSERT_ID();

  INSERT INTO notifications (user_id, reservation_id, type, message)
  VALUES (
    v_user_id,
    p_reservation_id,
    'BOOKING_CONFIRMED',
    CONCAT('Booking #', p_reservation_id, ' confirmed for ₹', p_quoted_amount, '.')
  );

  COMMIT;
END$$

-- 3.2 cancel_booking: cancels a CONFIRMED booking (owner or admin only)
CREATE PROCEDURE cancel_booking(
  IN p_reservation_id     INT UNSIGNED,
  IN p_requesting_user_id INT UNSIGNED,
  IN p_is_admin           BOOLEAN
)
BEGIN
  DECLARE v_owner_id INT UNSIGNED DEFAULT NULL;
  DECLARE v_status   VARCHAR(20) DEFAULT NULL;

  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;

  START TRANSACTION;

  SELECT v.user_id, r.status
    INTO v_owner_id, v_status
    FROM reservations r
    JOIN vehicles v ON v.vehicle_id = r.vehicle_id
   WHERE r.reservation_id = p_reservation_id
     FOR UPDATE;

  IF v_owner_id IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Reservation not found';
  END IF;

  IF COALESCE(p_is_admin, FALSE) = FALSE AND v_owner_id <> p_requesting_user_id THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Not authorized to cancel this reservation';
  END IF;

  IF v_status <> 'CONFIRMED' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Only CONFIRMED reservations can be cancelled';
  END IF;

  UPDATE reservations
     SET status = 'CANCELLED'
   WHERE reservation_id = p_reservation_id;

  UPDATE payments
     SET status = 'REFUNDED'
   WHERE reservation_id = p_reservation_id
     AND payment_type = 'BOOKING'
     AND status = 'PAID';

  INSERT INTO notifications (user_id, reservation_id, type, message)
  VALUES (
    v_owner_id,
    p_reservation_id,
    'CANCELLED',
    CONCAT('Reservation #', p_reservation_id, ' has been cancelled.')
  );

  COMMIT;
END$$

-- 3.3 check_in: validates QR token and arrival window, marks reservation CHECKED_IN
CREATE PROCEDURE check_in(
  IN p_reservation_id INT UNSIGNED,
  IN p_qr_token       CHAR(36),
  IN p_checkin_time   DATETIME
)
BEGIN
  DECLARE v_status     VARCHAR(20) DEFAULT NULL;
  DECLARE v_qr_token   CHAR(36) DEFAULT NULL;
  DECLARE v_start_time DATETIME DEFAULT NULL;
  DECLARE v_grace_mins SMALLINT UNSIGNED DEFAULT 15;
  DECLARE v_now        DATETIME;

  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;

  SET v_now = COALESCE(p_checkin_time, NOW());

  START TRANSACTION;

  SELECT r.status, r.qr_token, r.start_time, pl.grace_period_minutes
    INTO v_status, v_qr_token, v_start_time, v_grace_mins
    FROM reservations r
    JOIN parking_slots ps ON ps.slot_id = r.slot_id
    JOIN parking_lots pl  ON pl.lot_id  = ps.lot_id
   WHERE r.reservation_id = p_reservation_id
     FOR UPDATE;

  IF v_status IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Reservation not found';
  END IF;

  IF v_status <> 'CONFIRMED' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Only CONFIRMED reservations can check in';
  END IF;

  IF v_qr_token <> p_qr_token THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Invalid QR token for check-in';
  END IF;

  IF v_now < DATE_SUB(v_start_time, INTERVAL 15 MINUTE) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Check-in too early (allowed up to 15 minutes before start_time)';
  END IF;

  IF v_now > DATE_ADD(v_start_time, INTERVAL v_grace_mins MINUTE) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Check-in grace period has expired';
  END IF;

  UPDATE reservations
     SET status        = 'CHECKED_IN',
         checked_in_at = v_now
   WHERE reservation_id = p_reservation_id;

  COMMIT;
END$$

-- 3.4 checkout_and_bill: completes stay, calculates overstay penalty, records payments
CREATE PROCEDURE checkout_and_bill(
  IN  p_reservation_id INT UNSIGNED,
  IN  p_checkout_time  DATETIME,
  IN  p_payment_method VARCHAR(10),
  OUT p_base_amount    DECIMAL(10,2),
  OUT p_penalty_amount DECIMAL(10,2),
  OUT p_total_amount   DECIMAL(10,2)
)
BEGIN
  DECLARE v_status         VARCHAR(20) DEFAULT NULL;
  DECLARE v_checked_in_at  DATETIME DEFAULT NULL;
  DECLARE v_end_time       DATETIME DEFAULT NULL;
  DECLARE v_quoted_amount  DECIMAL(10,2) DEFAULT 0.00;
  DECLARE v_user_id        INT UNSIGNED DEFAULT NULL;
  DECLARE v_penalty_rate   DECIMAL(8,2) DEFAULT 0.00;
  DECLARE v_overstay_hours INT DEFAULT 0;
  DECLARE v_paid_booking   INT DEFAULT 0;
  DECLARE v_now            DATETIME;

  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;

  SET v_now = COALESCE(p_checkout_time, NOW());

  START TRANSACTION;

  SELECT r.status,
         r.checked_in_at,
         r.end_time,
         r.quoted_amount,
         v.user_id,
         pr.overstay_penalty_per_hour
    INTO v_status,
         v_checked_in_at,
         v_end_time,
         v_quoted_amount,
         v_user_id,
         v_penalty_rate
    FROM reservations r
    JOIN vehicles v       ON v.vehicle_id    = r.vehicle_id
    JOIN parking_slots ps ON ps.slot_id      = r.slot_id
    JOIN pricing_rules pr ON pr.lot_id       = ps.lot_id
                         AND pr.vehicle_type = v.vehicle_type
   WHERE r.reservation_id = p_reservation_id
     FOR UPDATE;

  IF v_status IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Reservation not found';
  END IF;

  IF v_status <> 'CHECKED_IN' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Only CHECKED_IN reservations can check out';
  END IF;

  IF v_now < v_checked_in_at THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Check-out time cannot be before check-in time';
  END IF;

  SET p_base_amount = v_quoted_amount;

  IF v_now > v_end_time THEN
    SET v_overstay_hours = CEIL(TIMESTAMPDIFF(SECOND, v_end_time, v_now) / 3600.0);
    SET p_penalty_amount = ROUND(v_overstay_hours * v_penalty_rate, 2);
  ELSE
    SET p_penalty_amount = 0.00;
  END IF;

  SET p_total_amount = ROUND(p_base_amount + p_penalty_amount, 2);

  UPDATE reservations
     SET status         = 'COMPLETED',
         checked_out_at = v_now
   WHERE reservation_id = p_reservation_id;

  SELECT COUNT(*)
    INTO v_paid_booking
    FROM payments p
   WHERE p.reservation_id = p_reservation_id
     AND p.payment_type = 'BOOKING'
     AND p.status = 'PAID';

  IF v_paid_booking = 0 AND p_base_amount > 0 THEN
    INSERT INTO payments (
      reservation_id, amount, payment_type, method, status, transaction_ref, paid_at
    ) VALUES (
      p_reservation_id,
      p_base_amount,
      'CHECKOUT',
      p_payment_method,
      'PAID',
      CONCAT('TXN-CHK-', p_reservation_id, '-', UNIX_TIMESTAMP(v_now)),
      v_now
    );
  END IF;

  IF p_penalty_amount > 0 THEN
    INSERT INTO payments (
      reservation_id, amount, payment_type, method, status, transaction_ref, paid_at
    ) VALUES (
      p_reservation_id,
      p_penalty_amount,
      'PENALTY',
      p_payment_method,
      'PAID',
      CONCAT('TXN-PEN-', p_reservation_id, '-', UNIX_TIMESTAMP(v_now)),
      v_now
    );

    INSERT INTO notifications (user_id, reservation_id, type, message)
    VALUES (
      v_user_id,
      p_reservation_id,
      'OVERSTAY',
      CONCAT('Overstay penalty of ₹', p_penalty_amount, ' charged for reservation #', p_reservation_id, '.')
    );
  END IF;

  INSERT INTO notifications (user_id, reservation_id, type, message)
  VALUES (
    v_user_id,
    p_reservation_id,
    'PAYMENT',
    CONCAT('Check-out completed for reservation #', p_reservation_id, '. Total billed: ₹', p_total_amount, '.')
  );

  COMMIT;
END$$

-- 3.5 expire_stale_reservations: marks past-grace CONFIRMED bookings as EXPIRED
CREATE PROCEDURE expire_stale_reservations(
  IN  p_reference_time DATETIME,
  OUT p_expired_count  INT UNSIGNED
)
BEGIN
  DECLARE v_done   INT DEFAULT 0;
  DECLARE v_res_id INT UNSIGNED;
  DECLARE v_usr_id INT UNSIGNED;
  DECLARE v_now    DATETIME;

  DECLARE cur_stale CURSOR FOR
    SELECT r.reservation_id, v.user_id
      FROM reservations r
      JOIN vehicles v       ON v.vehicle_id = r.vehicle_id
      JOIN parking_slots ps ON ps.slot_id   = r.slot_id
      JOIN parking_lots pl  ON pl.lot_id    = ps.lot_id
     WHERE r.status = 'CONFIRMED'
       AND v_now > DATE_ADD(r.start_time, INTERVAL pl.grace_period_minutes MINUTE)
     ORDER BY r.reservation_id ASC;

  DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done = 1;

  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;

  SET v_now           = COALESCE(p_reference_time, NOW());
  SET p_expired_count = 0;

  START TRANSACTION;

  OPEN cur_stale;
  read_loop: LOOP
    FETCH cur_stale INTO v_res_id, v_usr_id;
    IF v_done = 1 THEN
      LEAVE read_loop;
    END IF;

    UPDATE reservations
       SET status = 'EXPIRED'
     WHERE reservation_id = v_res_id;

    INSERT INTO notifications (user_id, reservation_id, type, message)
    VALUES (
      v_usr_id,
      v_res_id,
      'EXPIRED',
      CONCAT('Reservation #', v_res_id, ' expired because check-in did not occur within the grace period.')
    );

    SET p_expired_count = p_expired_count + 1;
  END LOOP;
  CLOSE cur_stale;

  COMMIT;
END$$

DELIMITER ;

-- ============================================================================
-- 4. VIEWS (4)
-- ============================================================================

-- 4.1 v_daily_revenue: daily revenue breakdown per lot
CREATE VIEW v_daily_revenue AS
SELECT
  DATE(COALESCE(p.paid_at, p.created_at)) AS revenue_date,
  pl.lot_id,
  pl.name AS lot_name,
  SUM(CASE WHEN p.status = 'PAID' AND p.payment_type = 'BOOKING'  THEN p.amount ELSE 0.00 END) AS booking_revenue,
  SUM(CASE WHEN p.status = 'PAID' AND p.payment_type = 'CHECKOUT' THEN p.amount ELSE 0.00 END) AS checkout_revenue,
  SUM(CASE WHEN p.status = 'PAID' AND p.payment_type = 'PENALTY'  THEN p.amount ELSE 0.00 END) AS penalty_revenue,
  SUM(CASE WHEN p.status = 'REFUNDED' OR p.payment_type = 'REFUND' THEN p.amount ELSE 0.00 END) AS refunded_amount,
  SUM(
    CASE
      WHEN p.status = 'PAID' AND p.payment_type IN ('BOOKING', 'CHECKOUT', 'PENALTY') THEN p.amount
      WHEN p.payment_type = 'REFUND' THEN -p.amount
      ELSE 0.00
    END
  ) AS net_revenue,
  COUNT(p.payment_id) AS payment_count
FROM payments p
JOIN reservations r   ON r.reservation_id = p.reservation_id
JOIN parking_slots ps ON ps.slot_id       = r.slot_id
JOIN parking_lots pl  ON pl.lot_id        = ps.lot_id
GROUP BY DATE(COALESCE(p.paid_at, p.created_at)), pl.lot_id, pl.name;

-- 4.2 v_lot_occupancy: live slot status counts and utilization percentage per lot
CREATE VIEW v_lot_occupancy AS
SELECT
  pl.lot_id,
  pl.name AS lot_name,
  pl.city,
  COUNT(ps.slot_id) AS total_slots,
  SUM(ps.status = 'AVAILABLE')   AS available_slots,
  SUM(ps.status = 'RESERVED')    AS reserved_slots,
  SUM(ps.status = 'OCCUPIED')    AS occupied_slots,
  SUM(ps.status = 'MAINTENANCE') AS maintenance_slots,
  ROUND(
    (SUM(ps.status IN ('RESERVED', 'OCCUPIED')) * 100.0)
    / NULLIF(COUNT(ps.slot_id) - SUM(ps.status = 'MAINTENANCE'), 0),
    2
  ) AS occupancy_pct
FROM parking_lots pl
LEFT JOIN parking_slots ps ON ps.lot_id = pl.lot_id
GROUP BY pl.lot_id, pl.name, pl.city;

-- 4.3 v_active_reservations: all currently CONFIRMED or CHECKED_IN bookings with owner and lot details
CREATE VIEW v_active_reservations AS
SELECT
  r.reservation_id,
  r.status,
  r.start_time,
  r.end_time,
  r.quoted_amount,
  r.qr_token,
  r.checked_in_at,
  u.user_id,
  u.full_name AS user_name,
  u.email AS user_email,
  v.vehicle_id,
  v.plate_number,
  v.vehicle_type,
  ps.slot_id,
  ps.slot_number,
  ps.slot_type,
  pl.lot_id,
  pl.name AS lot_name,
  pl.city
FROM reservations r
JOIN vehicles v       ON v.vehicle_id = r.vehicle_id
JOIN users u          ON u.user_id    = v.user_id
JOIN parking_slots ps ON ps.slot_id   = r.slot_id
JOIN parking_lots pl  ON pl.lot_id    = ps.lot_id
WHERE r.status IN ('CONFIRMED', 'CHECKED_IN');

-- 4.4 v_peak_hours: ranks hours of the day per lot by reservation demand using a CTE + window function
CREATE VIEW v_peak_hours AS
WITH hourly_counts AS (
  SELECT
    pl.lot_id,
    pl.name AS lot_name,
    HOUR(r.start_time) AS hour_of_day,
    COUNT(r.reservation_id) AS booking_count
  FROM parking_lots pl
  JOIN parking_slots ps ON ps.lot_id  = pl.lot_id
  JOIN reservations r   ON r.slot_id  = ps.slot_id
  WHERE r.status IN ('CONFIRMED', 'CHECKED_IN', 'COMPLETED')
  GROUP BY pl.lot_id, pl.name, HOUR(r.start_time)
)
SELECT
  lot_id,
  lot_name,
  hour_of_day,
  booking_count,
  RANK() OVER (PARTITION BY lot_id ORDER BY booking_count DESC, hour_of_day ASC) AS hour_rank
FROM hourly_counts;

-- ============================================================================
-- 5. SCHEDULED EVENT (1)
-- ============================================================================
DELIMITER $$
CREATE EVENT ev_expire_stale_reservations
ON SCHEDULE EVERY 1 MINUTE
DO
BEGIN
  CALL expire_stale_reservations(NOW(), @ev_expired_count);
END$$
DELIMITER ;

