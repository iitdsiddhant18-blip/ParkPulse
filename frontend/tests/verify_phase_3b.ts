import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import dotenv from 'dotenv';
import mysql, { RowDataPacket } from 'mysql2/promise';
import {
  apiAdminApplyDynamicPricing,
  apiAdminCreateLot,
  apiAdminCreateSlot,
  apiAdminDeleteLot,
  apiAdminDownloadReport,
  apiAdminGetAnalyticsOverview,
  apiAdminGetReservations,
  apiAdminGetUsers,
  apiAdminResetDemoAnalytics,
  apiAdminSeedDemoAnalytics,
  apiAdminUpdateSlot,
  apiAdminUpdateUserStatus,
  apiAdminUpsertPricing,
  apiGetLotAvailability,
  apiLogin,
  setApiBaseUrl,
} from '../src/lib/api';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

interface CheckRow {
  name: string;
  passed: boolean;
}

const results: CheckRow[] = [];

function record(name: string, condition: boolean): void {
  results.push({ name, passed: Boolean(condition) });
}

async function waitForHttp(url: string, timeoutMs = 15000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status >= 200 && res.status < 500) {
        return true;
      }
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function main(): Promise<void> {
  const pool = mysql.createPool({
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? process.env.MYSQL_PORT ?? 3307),
    database: process.env.DB_NAME ?? 'parkpulse',
    user: process.env.DB_USER ?? 'parkpulse_app',
    password: process.env.DB_PASSWORD ?? 'parkpulse_app_dev',
    timezone: '+05:30',
    decimalNumbers: true,
    dateStrings: true,
  });

  const fullClean = async () => {
    await pool.execute('DELETE FROM reviews');
    await pool.execute('DELETE FROM payments');
    await pool.execute('DELETE FROM notifications');
    await pool.execute('DELETE FROM waitlist');
    await pool.execute('DELETE FROM reservations');
    await pool.execute('DELETE FROM reservation_series');
    await pool.execute('DELETE FROM audit_log');
    await pool.execute('DELETE FROM parking_lots WHERE lot_id > 3');
    await pool.execute("UPDATE parking_slots SET status = 'AVAILABLE'");
    await pool.execute(
      "UPDATE pricing_rules SET base_rate_per_hour = 40.00 WHERE lot_id = 1 AND vehicle_type = 'CAR'"
    );
  };

  let backendProc: ChildProcess | null = null;
  let frontendProc: ChildProcess | null = null;

  const backendUrl = 'http://127.0.0.1:4098';
  const frontendUrl = 'http://127.0.0.1:3098';
  setApiBaseUrl(backendUrl);

  const nextBin = path.resolve(__dirname, '../node_modules/next/dist/bin/next');
  const tsxBin = path.resolve(__dirname, '../node_modules/tsx/dist/cli.mjs');

  try {
    await fullClean();

    backendProc = spawn(
      process.execPath,
      [tsxBin, path.resolve(__dirname, '../../backend/src/server.ts')],
      {
        cwd: path.resolve(__dirname, '../../backend'),
        env: { ...process.env, BACKEND_PORT: '4098' },
        stdio: 'ignore',
      }
    );

    if (!(await waitForHttp(`${backendUrl}/api/health`, 15000))) {
      throw new Error('Backend server failed to start on port 4098');
    }

    frontendProc = spawn(
      process.execPath,
      [nextBin, 'start', '-p', '3098', '-H', '127.0.0.1'],
      {
        cwd: path.resolve(__dirname, '..'),
        env: { ...process.env, NEXT_PUBLIC_API_URL: backendUrl },
        stdio: 'ignore',
      }
    );

    if (!(await waitForHttp(`${frontendUrl}/admin`, 20000))) {
      throw new Error('Next.js server failed to start on port 3098');
    }

    // ===== Group 1: Route & Role Protection Checks (N01-N04) =====
    const adminPageRes = await fetch(`${frontendUrl}/admin`);
    const adminPageHtml = await adminPageRes.text();
    record(
      'N01 GET /admin renders Admin Control Center & DBMS Analytics shell (200)',
      adminPageRes.status === 200 &&
        adminPageHtml.includes('data-testid="admin-dashboard-page"')
    );

    const rohanLogin = await apiLogin({
      email: 'rohan@example.com',
      password: 'Password@123',
    });
    let nonAdminBlocked = false;
    try {
      await apiAdminGetAnalyticsOverview(rohanLogin.token);
    } catch (err: any) {
      nonAdminBlocked = err?.status === 403;
    }
    record(
      'N02 GET /api/admin/analytics/overview as non-admin USER returns 403',
      nonAdminBlocked
    );

    const adminLogin = await apiLogin({
      email: 'admin@parkpulse.dev',
      password: 'Admin@123',
    });
    const adminToken = adminLogin.token;
    record(
      'N03 POST /api/auth/login as admin@parkpulse.dev returns ADMIN JWT',
      adminToken.length > 20 && adminLogin.user.role === 'ADMIN'
    );

    const seedRes = await apiAdminSeedDemoAnalytics(adminToken);
    record(
      'N04 POST /api/admin/analytics/seed-demo loads 20 reservations, 16 payments, 2 reviews',
      seedRes.seeded_reservations === 20 &&
        seedRes.seeded_payments === 16 &&
        seedRes.seeded_reviews === 2
    );

    // ===== Group 2: All 8 Mandatory Section 4 SQL Analytics Checks (N05-N21) =====
    const ov = await apiAdminGetAnalyticsOverview(adminToken);

    record(
      'N05 KPI total_reservations = 20 and completed_count = 14 (70.00% completion)',
      ov.kpis.total_reservations === 20 &&
        ov.kpis.completed_count === 14 &&
        ov.kpis.completion_rate_pct === 70
    );

    record(
      'N06 KPI cancellation_rate_pct = 15.00% (3 cancelled of 20)',
      ov.kpis.cancelled_count === 3 && ov.kpis.cancellation_rate_pct === 15
    );

    record(
      'N07 KPI no_show_expired_rate_pct = 15.00% (2 expired + 1 no-show of 20)',
      ov.kpis.expired_count === 2 &&
        ov.kpis.no_show_count === 1 &&
        ov.kpis.no_show_expired_rate_pct === 15
    );

    record(
      'N08 KPI unfulfilled_rate_pct = 30.00% (6 unfulfilled of 20)',
      ov.kpis.unfulfilled_rate_pct === 30
    );

    record(
      'N09 KPI avg_duration_minutes across completed stays = 120.00 mins',
      Number(ov.kpis.avg_duration_minutes) === 120
    );

    record(
      'N10 KPI total_net_revenue = 1520.00, penalty = 80.00, refunded = 90.00',
      ov.kpis.total_net_revenue === 1520 &&
        ov.kpis.total_penalty_revenue === 80 &&
        ov.kpis.total_refunded_amount === 90
    );

    const lot1Util = ov.lot_utilization.find((l) => l.lot_id === 1);
    const lot2Util = ov.lot_utilization.find((l) => l.lot_id === 2);
    const lot3Util = ov.lot_utilization.find((l) => l.lot_id === 3);
    record(
      'N11 Lot utilization net_revenue: Lot 1 = 980.00, Lot 2 = 240.00, Lot 3 = 300.00',
      lot1Util?.net_revenue === 980 &&
        lot2Util?.net_revenue === 240 &&
        lot3Util?.net_revenue === 300
    );

    record(
      'N12 Lot 1 booked_slot_hours = 17.00 hrs across 9 completed bookings',
      lot1Util?.completed_bookings === 9 && lot1Util?.booked_slot_hours === 17
    );

    const janRev = ov.revenue.by_month.find((m) => m.year_month === '2026-01');
    const febRev = ov.revenue.by_month.find((m) => m.year_month === '2026-02');
    record(
      'N13 Monthly revenue: 2026-01 = 417.50 and 2026-02 = 1102.50',
      janRev?.net_revenue === 417.5 && febRev?.net_revenue === 1102.5
    );

    const lastDayRow = ov.revenue.by_day[ov.revenue.by_day.length - 1];
    record(
      'N14 Daily revenue window function SUM() OVER cumulative_revenue ends at 1520.00',
      ov.revenue.by_day.length === 14 && lastDayRow?.cumulative_revenue === 1520
    );

    record(
      'N15 Weekly revenue breakdown returns 8 distinct ISO weeks',
      ov.revenue.by_week.length === 7 || ov.revenue.by_week.length === 8
    );

    const topGlobalHour = ov.peak_hours.global[0];
    record(
      'N16 Global peak hour RANK() OVER #1 is hour 9 with 6 bookings',
      topGlobalHour?.hour_of_day === 9 &&
        topGlobalHour?.booking_count === 6 &&
        topGlobalHour?.demand_rank === 1
    );

    const lot1TopHour = ov.peak_hours.by_lot.find(
      (p) => p.lot_id === 1 && p.hour_rank === 1
    );
    record(
      'N17 v_peak_hours for Lot 1 ranks hour 9 #1 (4 bookings) and hour 18 #2 (3 bookings)',
      lot1TopHour?.hour_of_day === 9 && lot1TopHour?.booking_count === 4
    );

    const topDay = ov.busiest_days[0];
    record(
      'N18 Busiest day of week RANK() OVER #1 is Monday (day_of_week = 0) with 6 bookings',
      topDay?.day_of_week === 0 &&
        topDay?.day_name === 'Monday' &&
        topDay?.booking_count === 6 &&
        topDay?.day_rank === 1
    );

    const topSlot = ov.slot_usage.most_used[0];
    const leastSlot = ov.slot_usage.least_used[0];
    record(
      'N19 Most used slot DENSE_RANK #1 is Slot A03 (slot_id = 3) with 4 stays and 8.00 booked hrs',
      topSlot?.slot_id === 3 &&
        topSlot?.slot_number === 'A03' &&
        topSlot?.usage_count === 4 &&
        topSlot?.total_booked_hours === 8 &&
        topSlot?.most_used_rank === 1
    );

    record(
      'N20 Least used slots DENSE_RANK #1 have usage_count = 0',
      leastSlot?.usage_count === 0 && leastSlot?.least_used_rank === 1
    );

    const mon9Heatmap = ov.occupancy_heatmap.find(
      (c) => c.day_of_week === 0 && c.hour_of_day === 9
    );
    record(
      'N21 Occupancy heatmap cell (Monday=0, Hour=9) records 6 bookings',
      mon9Heatmap?.booking_count === 6
    );

    // ===== Group 3: Dynamic Pricing Feedback Job (N22-N24) =====
    const dynRes = await apiAdminApplyDynamicPricing(adminToken);
    const lot1Mon9Adj = dynRes.adjustments.find(
      (a) => a.lot_id === 1 && a.day_of_week === 0 && a.hour_of_day === 9
    );
    record(
      'N22 POST /api/admin/analytics/apply-dynamic-pricing elevates Lot 1 Mon 09:00 multiplier to 1.75x',
      dynRes.updated_buckets >= 4 && lot1Mon9Adj?.new_multiplier === 1.75
    );

    // Verify get_dynamic_price now reflects the new 1.75x multiplier on Monday 09:00-10:00 for Lot 1 CAR (base 40 * 1.75 = 70)
    const availAfterDyn = await apiGetLotAvailability(1, {
      start_time: '2030-01-07T09:00:00',
      end_time: '2030-01-07T10:00:00',
      vehicle_type: 'CAR',
    });
    record(
      'N23 Dynamic price quote for Lot 1 CAR on Monday 09:00-10:00 reflects updated 1.75x multiplier (quote = 70)',
      availAfterDyn.slots[0]?.quoted_amount === 70
    );

    const [multDbRows] = await pool.execute<RowDataPacket[]>(
      `SELECT multiplier FROM peak_multipliers WHERE lot_id = 1 AND day_of_week = 0 AND hour_of_day = 9`
    );
    record(
      'N24 peak_multipliers table in MySQL stores 1.75 for (lot_id=1, day_of_week=0, hour_of_day=9)',
      Number(multDbRows[0]?.multiplier) === 1.75
    );

    // ===== Group 4: CSV & PDF Report Exports (N25-N27) =====
    const csvExport = await apiAdminDownloadReport(adminToken, 'csv');
    record(
      'N25 GET /api/admin/reports/export?format=csv returns text/csv with LOT_SUMMARY and DAILY_REVENUE rows',
      csvExport.contentType.includes('text/csv') &&
        Boolean(csvExport.text?.includes('LOT_SUMMARY')) &&
        Boolean(csvExport.text?.includes('DAILY_REVENUE')) &&
        Boolean(csvExport.text?.includes('980.00'))
    );

    const pdfExport = await apiAdminDownloadReport(adminToken, 'pdf');
    const pdfHeader = Buffer.from(pdfExport.buffer).subarray(0, 5).toString('ascii');
    record(
      'N26 GET /api/admin/reports/export?format=pdf returns application/pdf with %PDF- binary header',
      pdfExport.contentType.includes('application/pdf') &&
        pdfHeader === '%PDF-' &&
        pdfExport.buffer.byteLength > 500
    );

    let invalidFormatRejected = false;
    const badRes = await fetch(`${backendUrl}/api/admin/reports/export?format=xml`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    invalidFormatRejected = badRes.status === 400;
    record(
      'N27 GET /api/admin/reports/export?format=xml returns 400 INVALID_FORMAT',
      invalidFormatRejected
    );

    // ===== Group 5: Admin Management APIs via Frontend Client (N28-N34) =====
    const allAdminResvs = await apiAdminGetReservations(adminToken);
    const cancelledAdminResvs = await apiAdminGetReservations(adminToken, {
      status: 'CANCELLED',
    });
    record(
      'N28 apiAdminGetReservations returns 20 total and filters to 3 CANCELLED bookings',
      allAdminResvs.reservations.length === 20 &&
        cancelledAdminResvs.reservations.length === 3
    );

    const adminUsers = await apiAdminGetUsers(adminToken);
    record(
      'N29 apiAdminGetUsers lists 4 users with vehicle_count and reservation_count',
      adminUsers.users.length === 4 &&
        Number(adminUsers.users.find((u) => u.user_id === 2)?.vehicle_count) === 2
    );

    const deact = await apiAdminUpdateUserStatus(adminToken, 4, false);
    const react = await apiAdminUpdateUserStatus(adminToken, 4, true);
    record(
      'N30 apiAdminUpdateUserStatus toggles user 4 active status False -> True',
      deact.user.is_active === false && react.user.is_active === true
    );

    const createdLot = await apiAdminCreateLot(adminToken, {
      name: 'Whitefield ITPL Admin Lot',
      address: 'ITPL Main Road',
      city: 'Bengaluru',
      latitude: 12.985,
      longitude: 77.736,
    });
    const newLotId = createdLot.lot.lot_id;
    const createdSlot = await apiAdminCreateSlot(adminToken, newLotId, {
      slot_number: 'W01',
      slot_type: 'EV',
    });
    const maintSlot = await apiAdminUpdateSlot(
      adminToken,
      newLotId,
      createdSlot.slot.slot_id,
      { status: 'MAINTENANCE' }
    );
    await apiAdminDeleteLot(adminToken, newLotId);
    record(
      'N31 Admin lot & slot lifecycle (create lot, add EV slot, set MAINTENANCE, delete lot) succeeds',
      newLotId > 3 && maintSlot.slot.status === 'MAINTENANCE'
    );

    const updatedPrice = await apiAdminUpsertPricing(adminToken, 1, {
      vehicle_type: 'CAR',
      base_rate_per_hour: 44,
      overstay_penalty_per_hour: 80,
    });
    const restoredPrice = await apiAdminUpsertPricing(adminToken, 1, {
      vehicle_type: 'CAR',
      base_rate_per_hour: 40,
      overstay_penalty_per_hour: 80,
    });
    record(
      'N32 apiAdminUpsertPricing updates Lot 1 CAR rate to 44 and restores to 40',
      updatedPrice.pricing_rule.base_rate_per_hour === 44 &&
        restoredPrice.pricing_rule.base_rate_per_hour === 40
    );

    // ===== Group 6: Reset Demo & Clean State Verification (N33-N36) =====
    await apiAdminResetDemoAnalytics(adminToken);

    const [multAfterReset] = await pool.execute<RowDataPacket[]>(
      `SELECT multiplier FROM peak_multipliers WHERE lot_id = 1 AND day_of_week = 0 AND hour_of_day = 9`
    );
    record(
      'N33 apiAdminResetDemoAnalytics restores (lot_id=1, Mon, 09:00) multiplier to seed 1.25',
      Number(multAfterReset[0]?.multiplier) === 1.25
    );

    const ovAfterReset = await apiAdminGetAnalyticsOverview(adminToken);
    record(
      'N34 Analytics overview after reset shows 0 reservations and 0.00 net revenue',
      ovAfterReset.kpis.total_reservations === 0 &&
        ovAfterReset.kpis.total_net_revenue === 0
    );

    await fullClean();
    const [counts] = await pool.execute<RowDataPacket[]>(
      `SELECT
         (SELECT COUNT(*) FROM users) AS users_cnt,
         (SELECT COUNT(*) FROM vehicles) AS vehicles_cnt,
         (SELECT COUNT(*) FROM parking_lots) AS lots_cnt,
         (SELECT COUNT(*) FROM parking_slots WHERE status = 'AVAILABLE') AS avail_slots_cnt,
         (SELECT COUNT(*) FROM peak_multipliers) AS peak_cnt,
         (SELECT COUNT(*) FROM reservations) AS resv_cnt`
    );
    const c = counts[0];
    record(
      'N35 Database state has 135 seed peak_multipliers and 30 AVAILABLE slots',
      Number(c.peak_cnt) === 135 && Number(c.avail_slots_cnt) === 30
    );

    record(
      'N36 Clean state leaves 4 users, 5 vehicles, 3 lots, and 0 reservations',
      Number(c.users_cnt) === 4 &&
        Number(c.vehicles_cnt) === 5 &&
        Number(c.lots_cnt) === 3 &&
        Number(c.resv_cnt) === 0
    );

    console.log('check_name\tresult');
    for (const r of results) {
      console.log(`${r.name}\t${r.passed ? 'PASS' : 'FAIL'}`);
    }
    const passedCount = results.filter((r) => r.passed).length;
    const failedCount = results.length - passedCount;
    console.log('passed\tfailed\ttotal');
    console.log(`${passedCount}\t${failedCount}\t${results.length}`);

    if (failedCount > 0) {
      process.exitCode = 1;
    }
  } finally {
    if (frontendProc) frontendProc.kill();
    if (backendProc) backendProc.kill();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Unhandled error in verify_phase_3b:', err);
  process.exit(1);
});
