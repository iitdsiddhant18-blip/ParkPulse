ParkPulse — SQL Analytics Queries & Views ReferenceAll 8 analytics requirements from Section 4 of the specification are implemented in raw SQL inside db/logic.sql and backend/src/routes/admin.routes.ts using JOINs, GROUP BY, Common Table Expressions (WITH), and window functions (RANK() OVER, DENSE_RANK() OVER, SUM() OVER).1. Peak Hours & Busiest Days (RANK() OVER + v_peak_hours)WITH global_hourly AS (
  SELECT
    HOUR(r.start_time) AS hour_of_day,
    COUNT(r.reservation_id) AS booking_count,
    ROUND(SUM(r.quoted_amount), 2) AS quoted_revenue
  FROM reservations r
  WHERE r.status IN ('CONFIRMED', 'CHECKED_IN', 'COMPLETED')
  GROUP BY HOUR(r.start_time)
)
SELECT
  hour_of_day,
  booking_count,
  quoted_revenue,
  RANK() OVER (ORDER BY booking_count DESC, hour_of_day ASC) AS demand_rank
FROM global_hourly
ORDER BY demand_rank ASC;
2. Utilization Rate & Revenue per Lot (v_lot_occupancy + v_daily_revenue CTEs)Computes live slot occupancy percentage alongside historical slot utilization percentage (COUNT(DISTINCT booked slots) * 100 / total_slots), total booked slot-hours, average stay duration, and net revenue per lot.3. Revenue by Day, Week, and Month (with SUM(net_revenue) OVER Running Total)WITH daily_totals AS (
  SELECT
    revenue_date,
    SUM(booking_revenue)  AS booking_revenue,
    SUM(checkout_revenue) AS checkout_revenue,
    SUM(penalty_revenue)  AS penalty_revenue,
    SUM(refunded_amount)  AS refunded_amount,
    SUM(net_revenue)      AS net_revenue,
    SUM(payment_count)    AS payment_count
  FROM v_daily_revenue
  GROUP BY revenue_date
)
SELECT
  revenue_date,
  net_revenue,
  SUM(net_revenue) OVER (ORDER BY revenue_date ASC) AS cumulative_revenue
FROM daily_totals
ORDER BY revenue_date ASC;
4. Most and Least Used Slots (DENSE_RANK() OVER)WITH slot_stats AS (
  SELECT
    ps.slot_id,
    ps.slot_number,
    ps.slot_type,
    pl.lot_id,
    pl.name AS lot_name,
    COUNT(CASE WHEN r.status IN ('CONFIRMED', 'CHECKED_IN', 'COMPLETED') THEN 1 END) AS usage_count,
    COALESCE(ROUND(SUM(CASE WHEN r.status IN ('CONFIRMED', 'CHECKED_IN', 'COMPLETED')
      THEN TIMESTAMPDIFF(MINUTE, r.start_time, r.end_time) / 60.0 ELSE 0 END), 2), 0.00) AS total_booked_hours
  FROM parking_slots ps
  JOIN parking_lots pl ON pl.lot_id = ps.lot_id
  LEFT JOIN reservations r ON r.slot_id = ps.slot_id
  GROUP BY ps.slot_id, ps.slot_number, ps.slot_type, pl.lot_id, pl.name
)
SELECT
  slot_id, slot_number, slot_type, lot_name, usage_count, total_booked_hours,
  DENSE_RANK() OVER (ORDER BY usage_count DESC, total_booked_hours DESC) AS most_used_rank,
  DENSE_RANK() OVER (ORDER BY usage_count ASC, total_booked_hours ASC)   AS least_used_rank
FROM slot_stats;
5. Average Parking Duration (AVG(TIMESTAMPDIFF(MINUTE, checked_in_at, checked_out_at)))Calculated across all COMPLETED reservations both globally (in the KPI CTE) and per parking lot.6. Cancellation, Expired, and No-Show RatesCalculated via conditional aggregation (SUM(status = 'CANCELLED') * 100.0 / NULLIF(COUNT(*), 0)) in the status_summary CTE.7. 7×24 Occupancy Heatmap (WEEKDAY(start_time) vs. HOUR(start_time))Aggregates booking counts for every (day_of_week 0..6, hour_of_day 0..23) coordinate to render the Admin 7×24 heatmap matrix.8. Dynamic Pricing Feedback Loop (POST /api/admin/analytics/apply-dynamic-pricing)Identifies high-demand (lot_id, day_of_week, hour_of_day) buckets (HAVING COUNT(*) >= 2) and upserts peak_multipliers (1.75x for $\ge 4$ bookings, 1.50x for $2\text{--}3$ bookings), directly feeding future get_dynamic_price() calculations.
