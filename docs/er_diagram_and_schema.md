# ParkPulse — ER Diagram, 3NF Normalization Justification & Data Dictionary

## 1. Entity-Relationship (ER) Diagram (Mermaid)

```mermaid
erDiagram
  users ||--o{ vehicles : "owns (fk_vehicles_user)"
  users ||--o{ favorite_lots : "bookmarks (fk_fav_user)"
  users ||--o{ notifications : "receives (fk_notif_user)"

  parking_lots ||--o{ parking_slots : "contains (fk_slots_lot)"
  parking_lots ||--o{ pricing_rules : "defines (fk_pricing_lot)"
  parking_lots ||--o{ peak_multipliers : "schedules (fk_peak_lot)"
  parking_lots ||--o{ favorite_lots : "bookmarked_in (fk_fav_lot)"
  parking_lots ||--o{ waitlist : "queued_for (fk_wait_lot)"

  vehicles ||--o{ reservation_series : "templates (fk_series_vehicle)"
  parking_slots ||--o{ reservation_series : "assigned_to (fk_series_slot)"

  vehicles ||--o{ reservations : "books (fk_resv_vehicle)"
  parking_slots ||--o{ reservations : "hosts (fk_resv_slot)"
  reservation_series |o--o{ reservations : "generates (fk_resv_series)"

  reservations ||--o{ payments : "billed_via (fk_payments_resv)"
  reservations ||--o| reviews : "rated_by (fk_reviews_resv)"
  reservations |o--o{ notifications : "triggers (fk_notif_resv)"

  vehicles ||--o{ waitlist : "waits_with (fk_wait_vehicle)"
How to Export the Visual ER Diagram in MySQL WorkbenchOpen MySQL Workbench and select Database → Reverse Engineer... (Ctrl+R).Connect using Host 127.0.0.1, Port 3307, Username root, Password parkpulse_dev.Select the parkpulse schema (all 14 tables) and click Execute → Finish to auto-layout the EER diagram.2. Third Normal Form (3NF) Justification (Viva Notes)Every table in parkpulse satisfies 1NF (atomic columns, primary key on every table), 2NF (no partial dependency on a composite key), and 3NF (no transitive dependency PK -> NonKeyA -> NonKeyB):Why reservations has NO user_id column:
Each vehicle belongs to exactly one user (vehicles.user_id). Storing user_id on reservations alongside vehicle_id would introduce the transitive dependency reservation_id -> vehicle_id -> user_id and allow an anomaly where a reservation's user_id disagrees with its vehicle's owner. Instead, the owner is derived via reservations.vehicle_id -> vehicles.user_id.Why reviews stores ONLY reservation_id (unique):
A review is written for a completed reservation. Both the reviewer (user_id) and the parking lot (lot_id) are functionally determined by reservation_id (reservation_id -> vehicle_id -> user_id and reservation_id -> slot_id -> lot_id). Storing user_id or lot_id in reviews would violate 3NF.Why waitlist stores vehicle_id and lot_id (no user_id or vehicle_type):
Both the user and the needed slot type (BIKE, CAR, SUV, EV) are functionally determined by vehicle_id -> vehicles.(user_id, vehicle_type).Why reservations.quoted_amount does NOT violate 3NF:
pricing_rules and peak_multipliers can be updated by an admin after a booking is confirmed. quoted_amount is an immutable point-in-time contractual snapshot calculated by get_dynamic_price() at booking creation, not a redundantly stored current lookup.Why parking_slots.status is maintained by triggers:
The live SSE slot grid requires instantaneous reads of current physical slot state (AVAILABLE, RESERVED, OCCUPIED, MAINTENANCE), and triggers trg_resv_after_insert and trg_resv_after_update keep it strictly synchronized with reservations.3. Relational Schema & 14-Table Data Dictionary#TablePrimary KeyForeign KeysKey Constraints & Purpose1usersuser_id—uq_users_email (email), role ENUM('USER','ADMIN')2vehiclesvehicle_iduser_id -> users(user_id) RESTRICTuq_vehicles_plate (plate_number), vehicle_type ENUM('BIKE','CAR','SUV','EV')3parking_lotslot_id—uq_lots_name_address, chk_lots_latitude (-90..90), chk_lots_longitude (-180..180), chk_lots_grace (<=120)4parking_slotsslot_idlot_id -> parking_lots(lot_id) CASCADEuq_slots_lot_number (lot_id, slot_number), idx_slots_lot_status_type5pricing_rulesrule_idlot_id -> parking_lots(lot_id) CASCADEuq_pricing_lot_type (lot_id, vehicle_type), chk_pricing_base (>0), chk_pricing_penalty (>=0)6peak_multipliersmultiplier_idlot_id -> parking_lots(lot_id) CASCADEuq_peak_lot_day_hour, chk_peak_day (0..6), chk_peak_hour (0..23), chk_peak_mult (1.00..3.00)7reservation_seriesseries_idvehicle_id -> vehicles RESTRICT, slot_id -> parking_slots RESTRICTchk_series_day (0..6), chk_series_duration (15..1440), chk_series_range (valid_to >= valid_from)8reservationsreservation_idvehicle_id -> vehicles RESTRICT, slot_id -> parking_slots RESTRICT, series_id -> reservation_series SET NULLuq_resv_qr (qr_token), chk_resv_times (end_time > start_time), chk_resv_amount (>=0), chk_resv_checkout9paymentspayment_idreservation_id -> reservations RESTRICTuq_payments_txn (transaction_ref), chk_payments_amount (>=0)10reviewsreview_idreservation_id -> reservations CASCADEuq_reviews_resv (reservation_id), chk_reviews_rating (1..5)11favorite_lots(user_id, lot_id)user_id -> users CASCADE, lot_id -> parking_lots CASCADEComposite PK prevents duplicate bookmarks12waitlistwaitlist_idvehicle_id -> vehicles CASCADE, lot_id -> parking_lots CASCADEchk_wait_times (desired_end > desired_start), idx_wait_lot_status13notificationsnotification_iduser_id -> users CASCADE, reservation_id -> reservations SET NULLidx_notif_user_read (user_id, is_read, created_at), idx_notif_email_pending14audit_logaudit_id(None — survives row deletion)JSON old_values and new_values, idx_audit_table_record (table_name, record_id)
