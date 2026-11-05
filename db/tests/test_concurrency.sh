#!/usr/bin/env bash
# ParkPulse - Phase 1b concurrency verification script.
# Launches two concurrent MySQL client sessions that race to book slot 3 for the exact same time window.
# Session 1 acquires SELECT ... FOR UPDATE on slot 3 and holds it for 1 second (@debug_sleep_seconds = 1).
# Session 2 arrives 0.2 seconds later, blocks on the row lock, and is rejected with ERROR 1644 once Session 1 commits.

set -u

DB_USER="parkpulse_app"
DB_PASS="parkpulse_app_dev"
DB_NAME="parkpulse"

OUT1="/tmp/pp_conc_s1.out"
OUT2="/tmp/pp_conc_s2.out"
rm -f "$OUT1" "$OUT2"

# Ensure clean starting state
mysql -uroot -pparkpulse_dev "$DB_NAME" -e "
  DELETE FROM payments;
  DELETE FROM notifications;
  DELETE FROM waitlist;
  DELETE FROM reservations;
  DELETE FROM audit_log;
  UPDATE parking_slots SET status = 'AVAILABLE';
" 2>/dev/null

# Session 1 (background): Vehicle 1 (CAR, User 2) books Slot 3 for 2030-06-01 10:00-12:00, holding lock for 1s
(
  mysql -u"$DB_USER" -p"$DB_PASS" "$DB_NAME" --batch -e "
    SET @debug_sleep_seconds = 1;
    CALL book_slot(1, 3, '2030-06-01 10:00:00', '2030-06-01 12:00:00', NULL, @r1, @q1, @qr1);
    SELECT 'S1_OK' AS status, @q1 AS quote;
  " >"$OUT1" 2>&1
) &
PID1=$!

sleep 0.2

# Session 2 (background): Vehicle 5 (CAR, User 4) races for the same Slot 3 and window while Session 1 holds lock
(
  mysql -u"$DB_USER" -p"$DB_PASS" "$DB_NAME" --batch -e "
    CALL book_slot(5, 3, '2030-06-01 10:00:00', '2030-06-01 12:00:00', NULL, @r2, @q2, @qr2);
    SELECT 'S2_OK' AS status, @q2 AS quote;
  " >"$OUT2" 2>&1
) &
PID2=$!

wait "$PID1"
wait "$PID2"

S1_OK=$(grep -c "S1_OK" "$OUT1" || true)
S2_REJECTED=$(grep -c "Overlapping reservation for this slot" "$OUT2" || true)
ACTIVE_COUNT=$(mysql -uroot -pparkpulse_dev "$DB_NAME" --batch --skip-column-names -e "
  SELECT COUNT(*) FROM reservations WHERE slot_id = 3 AND status = 'CONFIRMED';
" 2>/dev/null)
SLOT_STATUS=$(mysql -uroot -pparkpulse_dev "$DB_NAME" --batch --skip-column-names -e "
  SELECT status FROM parking_slots WHERE slot_id = 3;
" 2>/dev/null)

# Clean up test rows
mysql -uroot -pparkpulse_dev "$DB_NAME" -e "
  DELETE FROM notifications;
  DELETE FROM reservations;
  DELETE FROM audit_log;
  ALTER TABLE notifications AUTO_INCREMENT = 1;
  ALTER TABLE reservations AUTO_INCREMENT = 1;
  ALTER TABLE audit_log AUTO_INCREMENT = 1;
  UPDATE parking_slots SET status = 'AVAILABLE';
" 2>/dev/null

CLEAN_COUNT=$(mysql -uroot -pparkpulse_dev "$DB_NAME" --batch --skip-column-names -e "
  SELECT COUNT(*) FROM reservations;
" 2>/dev/null)

printf "check_name\tresult\n"
if [ "$S1_OK" -eq 1 ]; then
  printf "J01 session 1 acquired FOR UPDATE lock and committed booking\tPASS\n"
else
  printf "J01 session 1 acquired FOR UPDATE lock and committed booking\tFAIL\n"
fi

if [ "$S2_REJECTED" -eq 1 ]; then
  printf "J02 concurrent session 2 blocked on lock and rejected overlap\tPASS\n"
else
  printf "J02 concurrent session 2 blocked on lock and rejected overlap\tFAIL\n"
fi

if [ "$ACTIVE_COUNT" = "1" ] && [ "$SLOT_STATUS" = "RESERVED" ]; then
  printf "J03 exactly 1 reservation exists and slot 3 is RESERVED\tPASS\n"
else
  printf "J03 exactly 1 reservation exists and slot 3 is RESERVED\tFAIL\n"
fi

if [ "$CLEAN_COUNT" = "0" ]; then
  printf "J04 concurrency test cleanup restored clean state\tPASS\n"
else
  printf "J04 concurrency test cleanup restored clean state\tFAIL\n"
fi

rm -f "$OUT1" "$OUT2"

