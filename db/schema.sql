-- ParkPulse - Phase 1a schema (MySQL 8)
-- Creates 14 tables. No triggers, procedures, views or events here (Phase 1b).

CREATE DATABASE IF NOT EXISTS parkpulse
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_0900_ai_ci;
USE parkpulse;

-- 1. users
CREATE TABLE users (
  user_id       INT UNSIGNED NOT NULL AUTO_INCREMENT,
  full_name     VARCHAR(100) NOT NULL,
  email         VARCHAR(150) NOT NULL,
  phone         VARCHAR(20)  NULL,
  password_hash VARCHAR(100) NOT NULL,
  role          ENUM('USER','ADMIN') NOT NULL DEFAULT 'USER',
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB;

-- 2. vehicles (owned by one user)
CREATE TABLE vehicles (
  vehicle_id   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id      INT UNSIGNED NOT NULL,
  plate_number VARCHAR(20)  NOT NULL,
  vehicle_type ENUM('BIKE','CAR','SUV','EV') NOT NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (vehicle_id),
  UNIQUE KEY uq_vehicles_plate (plate_number),
  KEY idx_vehicles_user (user_id),
  CONSTRAINT fk_vehicles_user FOREIGN KEY (user_id)
    REFERENCES users (user_id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB;

-- 3. parking_lots
CREATE TABLE parking_lots (
  lot_id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name                 VARCHAR(120) NOT NULL,
  address              VARCHAR(255) NOT NULL,
  city                 VARCHAR(80)  NOT NULL,
  latitude             DECIMAL(9,6) NOT NULL,
  longitude            DECIMAL(9,6) NOT NULL,
  open_time            TIME NOT NULL DEFAULT '00:00:00',
  close_time           TIME NOT NULL DEFAULT '23:59:59',
  grace_period_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 15,
  is_active            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (lot_id),
  UNIQUE KEY uq_lots_name_address (name, address),
  KEY idx_lots_city_name (city, name),
  CONSTRAINT chk_lots_latitude  CHECK (latitude  BETWEEN -90  AND 90),
  CONSTRAINT chk_lots_longitude CHECK (longitude BETWEEN -180 AND 180),
  CONSTRAINT chk_lots_grace     CHECK (grace_period_minutes <= 120)
) ENGINE=InnoDB;

-- 4. parking_slots
CREATE TABLE parking_slots (
  slot_id     INT UNSIGNED NOT NULL AUTO_INCREMENT,
  lot_id      INT UNSIGNED NOT NULL,
  slot_number VARCHAR(10)  NOT NULL,
  slot_type   ENUM('BIKE','CAR','SUV','EV') NOT NULL,
  status      ENUM('AVAILABLE','RESERVED','OCCUPIED','MAINTENANCE') NOT NULL DEFAULT 'AVAILABLE',
  PRIMARY KEY (slot_id),
  UNIQUE KEY uq_slots_lot_number (lot_id, slot_number),
  KEY idx_slots_lot_status_type (lot_id, status, slot_type),
  CONSTRAINT fk_slots_lot FOREIGN KEY (lot_id)
    REFERENCES parking_lots (lot_id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

-- 5. pricing_rules (base price per lot and vehicle type)
CREATE TABLE pricing_rules (
  rule_id                   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  lot_id                    INT UNSIGNED NOT NULL,
  vehicle_type              ENUM('BIKE','CAR','SUV','EV') NOT NULL,
  base_rate_per_hour        DECIMAL(8,2) NOT NULL,
  overstay_penalty_per_hour DECIMAL(8,2) NOT NULL DEFAULT 0.00,
  PRIMARY KEY (rule_id),
  UNIQUE KEY uq_pricing_lot_type (lot_id, vehicle_type),
  CONSTRAINT fk_pricing_lot FOREIGN KEY (lot_id)
    REFERENCES parking_lots (lot_id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT chk_pricing_base    CHECK (base_rate_per_hour > 0),
  CONSTRAINT chk_pricing_penalty CHECK (overstay_penalty_per_hour >= 0)
) ENGINE=InnoDB;

-- 6. peak_multipliers (dynamic pricing: multiplier per lot / weekday / hour)
-- day_of_week follows MySQL WEEKDAY(): 0 = Monday ... 6 = Sunday
CREATE TABLE peak_multipliers (
  multiplier_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  lot_id        INT UNSIGNED NOT NULL,
  day_of_week   TINYINT UNSIGNED NOT NULL,
  hour_of_day   TINYINT UNSIGNED NOT NULL,
  multiplier    DECIMAL(4,2) NOT NULL DEFAULT 1.00,
  PRIMARY KEY (multiplier_id),
  UNIQUE KEY uq_peak_lot_day_hour (lot_id, day_of_week, hour_of_day),
  CONSTRAINT fk_peak_lot FOREIGN KEY (lot_id)
    REFERENCES parking_lots (lot_id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT chk_peak_day  CHECK (day_of_week BETWEEN 0 AND 6),
  CONSTRAINT chk_peak_hour CHECK (hour_of_day BETWEEN 0 AND 23),
  CONSTRAINT chk_peak_mult CHECK (multiplier BETWEEN 1.00 AND 3.00)
) ENGINE=InnoDB;

-- 7. reservation_series (recurring reservation templates)
CREATE TABLE reservation_series (
  series_id        INT UNSIGNED NOT NULL AUTO_INCREMENT,
  vehicle_id       INT UNSIGNED NOT NULL,
  slot_id          INT UNSIGNED NOT NULL,
  day_of_week      TINYINT UNSIGNED NOT NULL,
  start_clock      TIME NOT NULL,
  duration_minutes SMALLINT UNSIGNED NOT NULL,
  valid_from       DATE NOT NULL,
  valid_to         DATE NOT NULL,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (series_id),
  KEY idx_series_vehicle (vehicle_id),
  KEY idx_series_slot (slot_id),
  CONSTRAINT fk_series_vehicle FOREIGN KEY (vehicle_id)
    REFERENCES vehicles (vehicle_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_series_slot FOREIGN KEY (slot_id)
    REFERENCES parking_slots (slot_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT chk_series_day      CHECK (day_of_week BETWEEN 0 AND 6),
  CONSTRAINT chk_series_duration CHECK (duration_minutes BETWEEN 15 AND 1440),
  CONSTRAINT chk_series_range    CHECK (valid_to >= valid_from)
) ENGINE=InnoDB;

-- 8. reservations
-- The owner is reached through vehicle_id -> vehicles.user_id (no user_id here, keeps 3NF).
CREATE TABLE reservations (
  reservation_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  vehicle_id     INT UNSIGNED NOT NULL,
  slot_id        INT UNSIGNED NOT NULL,
  series_id      INT UNSIGNED NULL,
  start_time     DATETIME NOT NULL,
  end_time       DATETIME NOT NULL,
  status         ENUM('CONFIRMED','CHECKED_IN','COMPLETED','CANCELLED','EXPIRED','NO_SHOW')
                 NOT NULL DEFAULT 'CONFIRMED',
  quoted_amount  DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  qr_token       CHAR(36) NOT NULL,
  checked_in_at  DATETIME NULL,
  checked_out_at DATETIME NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (reservation_id),
  UNIQUE KEY uq_resv_qr (qr_token),
  KEY idx_resv_slot_time (slot_id, start_time, end_time),
  KEY idx_resv_vehicle (vehicle_id),
  KEY idx_resv_status_start (status, start_time),
  KEY idx_resv_series (series_id),
  CONSTRAINT fk_resv_vehicle FOREIGN KEY (vehicle_id)
    REFERENCES vehicles (vehicle_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_resv_slot FOREIGN KEY (slot_id)
    REFERENCES parking_slots (slot_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_resv_series FOREIGN KEY (series_id)
    REFERENCES reservation_series (series_id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT chk_resv_times  CHECK (end_time > start_time),
  CONSTRAINT chk_resv_amount CHECK (quoted_amount >= 0),
  CONSTRAINT chk_resv_checkout CHECK (checked_out_at IS NULL OR checked_in_at IS NULL OR checked_out_at >= checked_in_at)
) ENGINE=InnoDB;

-- 9. payments
CREATE TABLE payments (
  payment_id      INT UNSIGNED NOT NULL AUTO_INCREMENT,
  reservation_id  INT UNSIGNED NOT NULL,
  amount          DECIMAL(10,2) NOT NULL,
  payment_type    ENUM('BOOKING','CHECKOUT','PENALTY','REFUND') NOT NULL,
  method          ENUM('CARD','UPI','CASH','WALLET') NOT NULL,
  status          ENUM('PENDING','PAID','FAILED','REFUNDED') NOT NULL DEFAULT 'PENDING',
  transaction_ref VARCHAR(64) NULL,
  paid_at         DATETIME NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (payment_id),
  UNIQUE KEY uq_payments_txn (transaction_ref),
  KEY idx_payments_resv (reservation_id),
  KEY idx_payments_paid_at (paid_at),
  CONSTRAINT fk_payments_resv FOREIGN KEY (reservation_id)
    REFERENCES reservations (reservation_id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT chk_payments_amount CHECK (amount >= 0)
) ENGINE=InnoDB;

-- 10. reviews (one review per completed reservation; user and lot are derived via joins)
CREATE TABLE reviews (
  review_id      INT UNSIGNED NOT NULL AUTO_INCREMENT,
  reservation_id INT UNSIGNED NOT NULL,
  rating         TINYINT UNSIGNED NOT NULL,
  comment        VARCHAR(500) NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (review_id),
  UNIQUE KEY uq_reviews_resv (reservation_id),
  CONSTRAINT fk_reviews_resv FOREIGN KEY (reservation_id)
    REFERENCES reservations (reservation_id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT chk_reviews_rating CHECK (rating BETWEEN 1 AND 5)
) ENGINE=InnoDB;

-- 11. favorite_lots (many-to-many users <-> lots)
CREATE TABLE favorite_lots (
  user_id    INT UNSIGNED NOT NULL,
  lot_id     INT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, lot_id),
  KEY idx_fav_lot (lot_id),
  CONSTRAINT fk_fav_user FOREIGN KEY (user_id)
    REFERENCES users (user_id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_fav_lot FOREIGN KEY (lot_id)
    REFERENCES parking_lots (lot_id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

-- 12. waitlist (user and vehicle type are derived from vehicle_id)
CREATE TABLE waitlist (
  waitlist_id   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  vehicle_id    INT UNSIGNED NOT NULL,
  lot_id        INT UNSIGNED NOT NULL,
  desired_start DATETIME NOT NULL,
  desired_end   DATETIME NOT NULL,
  status        ENUM('WAITING','NOTIFIED','FULFILLED','CANCELLED','EXPIRED') NOT NULL DEFAULT 'WAITING',
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (waitlist_id),
  KEY idx_wait_lot_status (lot_id, status, created_at),
  KEY idx_wait_vehicle (vehicle_id),
  CONSTRAINT fk_wait_vehicle FOREIGN KEY (vehicle_id)
    REFERENCES vehicles (vehicle_id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_wait_lot FOREIGN KEY (lot_id)
    REFERENCES parking_lots (lot_id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT chk_wait_times CHECK (desired_end > desired_start)
) ENGINE=InnoDB;

-- 13. notifications
CREATE TABLE notifications (
  notification_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id         INT UNSIGNED NOT NULL,
  reservation_id  INT UNSIGNED NULL,
  type            ENUM('BOOKING_CONFIRMED','REMINDER','CANCELLED','EXPIRED','WAITLIST_AVAILABLE','PAYMENT','OVERSTAY') NOT NULL,
  message         VARCHAR(500) NOT NULL,
  is_read         BOOLEAN NOT NULL DEFAULT FALSE,
  email_sent      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (notification_id),
  KEY idx_notif_user_read (user_id, is_read, created_at),
  KEY idx_notif_email_pending (email_sent, created_at),
  KEY idx_notif_resv (reservation_id),
  CONSTRAINT fk_notif_user FOREIGN KEY (user_id)
    REFERENCES users (user_id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_notif_resv FOREIGN KEY (reservation_id)
    REFERENCES reservations (reservation_id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB;

-- 14. audit_log (filled by triggers in Phase 1b; deliberately has no foreign keys)
CREATE TABLE audit_log (
  audit_id   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  table_name VARCHAR(64) NOT NULL,
  record_id  BIGINT UNSIGNED NOT NULL,
  action     ENUM('INSERT','UPDATE','DELETE') NOT NULL,
  old_values JSON NULL,
  new_values JSON NULL,
  changed_by VARCHAR(100) NOT NULL DEFAULT 'unknown',
  changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (audit_id),
  KEY idx_audit_table_record (table_name, record_id),
  KEY idx_audit_changed_at (changed_at)
) ENGINE=InnoDB;

