-- ParkPulse - Phase 1b database security (MySQL 8.4)
-- Creates separate admin and application MySQL accounts with least-privilege grants.

USE parkpulse;

CREATE USER IF NOT EXISTS 'parkpulse_admin'@'%' IDENTIFIED BY 'parkpulse_admin_dev';
CREATE USER IF NOT EXISTS 'parkpulse_admin'@'localhost' IDENTIFIED BY 'parkpulse_admin_dev';

GRANT ALL PRIVILEGES ON parkpulse.* TO 'parkpulse_admin'@'%';
GRANT ALL PRIVILEGES ON parkpulse.* TO 'parkpulse_admin'@'localhost';

CREATE USER IF NOT EXISTS 'parkpulse_app'@'%' IDENTIFIED BY 'parkpulse_app_dev';
CREATE USER IF NOT EXISTS 'parkpulse_app'@'localhost' IDENTIFIED BY 'parkpulse_app_dev';

-- Application account gets DML + EXECUTE on parkpulse, but NO DDL (no DROP, ALTER, CREATE, GRANT)
GRANT SELECT, INSERT, UPDATE, DELETE, EXECUTE, SHOW VIEW ON parkpulse.* TO 'parkpulse_app'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE, EXECUTE, SHOW VIEW ON parkpulse.* TO 'parkpulse_app'@'localhost';

FLUSH PRIVILEGES;

