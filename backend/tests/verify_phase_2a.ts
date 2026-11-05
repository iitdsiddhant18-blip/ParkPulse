import { Server } from 'http';
import { AddressInfo } from 'net';
import { RowDataPacket } from 'mysql2/promise';
import { createApp } from '../src/app';
import { pool } from '../src/db';

interface CheckRow {
  name: string;
  passed: boolean;
}

const results: CheckRow[] = [];

function record(name: string, condition: boolean): void {
  results.push({ name, passed: Boolean(condition) });
}

async function apiRequest(
  baseUrl: string,
  method: string,
  path: string,
  options: { token?: string; body?: unknown } = {}
): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (options.token) {
    headers['Authorization'] = `Bearer ${options.token}`;
  }

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

async function resetTestData(): Promise<void> {
  await pool.execute('DELETE FROM reviews');
  await pool.execute('DELETE FROM payments');
  await pool.execute('DELETE FROM notifications');
  await pool.execute('DELETE FROM waitlist');
  await pool.execute('DELETE FROM reservations');
  await pool.execute('DELETE FROM audit_log');
  await pool.execute('DELETE FROM favorite_lots WHERE user_id > 4 OR (user_id = 2 AND lot_id = 3)');
  await pool.execute('DELETE FROM vehicles WHERE vehicle_id > 5');
  await pool.execute('DELETE FROM parking_lots WHERE lot_id > 3');
  await pool.execute('DELETE FROM users WHERE user_id > 4');
  await pool.execute("UPDATE parking_slots SET status = 'AVAILABLE'");
  await pool.execute(
    "UPDATE pricing_rules SET base_rate_per_hour = 40.00 WHERE lot_id = 1 AND vehicle_type = 'CAR'"
  );
  await pool.execute('DELETE FROM audit_log');
}

async function main(): Promise<void> {
  const app = createApp();
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await resetTestData();

    // ===== Group 1: Health & Authentication (K01-K10) =====
    const k01 = await apiRequest(baseUrl, 'GET', '/api/health');
    record(
      'K01 GET /api/health returns 200 and connected db',
      k01.status === 200 && k01.data?.status === 'ok' && k01.data?.db === 'connected'
    );

    const k02 = await apiRequest(baseUrl, 'POST', '/api/auth/login', {
      body: { email: 'admin@parkpulse.dev', password: 'Admin@123' },
    });
    const adminToken = String(k02.data?.token ?? '');
    record(
      'K02 POST /api/auth/login with seed admin@parkpulse.dev returns 200 and ADMIN role',
      k02.status === 200 && adminToken.length > 20 && k02.data?.user?.role === 'ADMIN'
    );

    const k03 = await apiRequest(baseUrl, 'POST', '/api/auth/login', {
      body: { email: 'rohan@example.com', password: 'Password@123' },
    });
    const rohanToken = String(k03.data?.token ?? '');
    record(
      'K03 POST /api/auth/login with seed rohan@example.com returns 200 and USER role',
      k03.status === 200 && rohanToken.length > 20 && k03.data?.user?.role === 'USER'
    );

    const k04 = await apiRequest(baseUrl, 'POST', '/api/auth/login', {
      body: { email: 'rohan@example.com', password: 'WrongPassword@999' },
    });
    record('K04 POST /api/auth/login with wrong password returns 401', k04.status === 401);

    const k05 = await apiRequest(baseUrl, 'POST', '/api/auth/register', {
      body: {
        full_name: 'Meera Iyer',
        email: 'meera.test@example.com',
        phone: '9000000099',
        password: 'Password@123',
      },
    });
    const meeraToken = String(k05.data?.token ?? '');
    const meeraUserId = Number(k05.data?.user?.user_id ?? 0);
    record(
      'K05 POST /api/auth/register creates new USER and returns 201 with JWT',
      k05.status === 201 && meeraToken.length > 20 && k05.data?.user?.role === 'USER'
    );

    const k06 = await apiRequest(baseUrl, 'POST', '/api/auth/register', {
      body: {
        full_name: 'Duplicate User',
        email: 'rohan@example.com',
        password: 'Password@123',
      },
    });
    record('K06 POST /api/auth/register with duplicate email returns 409', k06.status === 409);

    const k07 = await apiRequest(baseUrl, 'GET', '/api/auth/me');
    record('K07 GET /api/auth/me without token returns 401', k07.status === 401);

    const k08 = await apiRequest(baseUrl, 'GET', '/api/auth/me', { token: rohanToken });
    record(
      'K08 GET /api/auth/me with valid token returns user profile',
      k08.status === 200 && k08.data?.user?.email === 'rohan@example.com'
    );

    const k09 = await apiRequest(baseUrl, 'GET', '/api/admin/users', { token: rohanToken });
    record('K09 GET /api/admin/users with USER token returns 403', k09.status === 403);

    const k10 = await apiRequest(baseUrl, 'GET', '/api/admin/users', { token: adminToken });
    record(
      'K10 GET /api/admin/users with ADMIN token returns 5 users (4 seed + 1 new)',
      k10.status === 200 && Array.isArray(k10.data?.users) && k10.data.users.length === 5
    );

    // ===== Group 2: Account Status & Admin User Management (K11-K13) =====
    const k11 = await apiRequest(baseUrl, 'PATCH', `/api/admin/users/${meeraUserId}/status`, {
      token: adminToken,
      body: { is_active: false },
    });
    record(
      'K11 PATCH /api/admin/users/:id/status deactivates new user',
      k11.status === 200 && k11.data?.user?.is_active === false
    );

    const k12 = await apiRequest(baseUrl, 'POST', '/api/auth/login', {
      body: { email: 'meera.test@example.com', password: 'Password@123' },
    });
    record(
      'K12 POST /api/auth/login as deactivated user returns 403',
      k12.status === 403 && k12.data?.error?.code === 'ACCOUNT_DEACTIVATED'
    );

    const k13 = await apiRequest(baseUrl, 'PATCH', `/api/admin/users/${meeraUserId}/status`, {
      token: adminToken,
      body: { is_active: true },
    });
    record(
      'K13 PATCH /api/admin/users/:id/status reactivates new user',
      k13.status === 200 && k13.data?.user?.is_active === true
    );

    // ===== Group 3: Vehicles CRUD & Ownership Rules (K14-K20) =====
    const k14 = await apiRequest(baseUrl, 'GET', '/api/vehicles', { token: rohanToken });
    record(
      'K14 GET /api/vehicles as Rohan (user 2) returns 2 seed vehicles',
      k14.status === 200 && Array.isArray(k14.data?.vehicles) && k14.data.vehicles.length === 2
    );

    const k15 = await apiRequest(baseUrl, 'POST', '/api/vehicles', {
      token: meeraToken,
      body: { plate_number: 'ka 09 zz 4321', vehicle_type: 'EV' },
    });
    const meeraVehicleId = Number(k15.data?.vehicle?.vehicle_id ?? 0);
    record(
      'K15 POST /api/vehicles adds new EV vehicle with normalized plate (201)',
      k15.status === 201 &&
        k15.data?.vehicle?.plate_number === 'KA09ZZ4321' &&
        k15.data?.vehicle?.vehicle_type === 'EV'
    );

    const k16 = await apiRequest(baseUrl, 'POST', '/api/vehicles', {
      token: meeraToken,
      body: { plate_number: 'KA01AB1234', vehicle_type: 'CAR' },
    });
    record(
      'K16 POST /api/vehicles with duplicate plate KA01AB1234 returns 409',
      k16.status === 409
    );

    const k17 = await apiRequest(baseUrl, 'POST', '/api/vehicles', {
      token: meeraToken,
      body: { plate_number: 'KA09TR9999', vehicle_type: 'TRUCK' },
    });
    record(
      'K17 POST /api/vehicles with invalid vehicle_type TRUCK returns 400',
      k17.status === 400
    );

    const k18 = await apiRequest(baseUrl, 'PUT', `/api/vehicles/${meeraVehicleId}`, {
      token: meeraToken,
      body: { plate_number: 'KA09ZZ8888' },
    });
    record(
      'K18 PUT /api/vehicles/:id updates plate_number for owner (200)',
      k18.status === 200 && k18.data?.vehicle?.plate_number === 'KA09ZZ8888'
    );

    const k19 = await apiRequest(baseUrl, 'DELETE', `/api/vehicles/${meeraVehicleId}`, {
      token: rohanToken,
    });
    record(
      'K19 DELETE /api/vehicles/:id on another user vehicle returns 403',
      k19.status === 403
    );

    const k20 = await apiRequest(baseUrl, 'DELETE', `/api/vehicles/${meeraVehicleId}`, {
      token: meeraToken,
    });
    record(
      'K20 DELETE /api/vehicles/:id removes test user vehicle (200)',
      k20.status === 200
    );

    // ===== Group 4: Lot Search, Availability & Admin Lot/Slot/Pricing CRUD (K21-K33) =====
    const k21 = await apiRequest(baseUrl, 'GET', '/api/lots');
    record(
      'K21 GET /api/lots returns 3 active seed lots with occupancy fields',
      k21.status === 200 &&
        Array.isArray(k21.data?.lots) &&
        k21.data.lots.length === 3 &&
        k21.data.lots[0].total_slots === 12
    );

    const k22 = await apiRequest(baseUrl, 'GET', '/api/lots?q=Indiranagar');
    record(
      'K22 GET /api/lots?q=Indiranagar filters to Lot 3',
      k22.status === 200 &&
        Array.isArray(k22.data?.lots) &&
        k22.data.lots.length === 1 &&
        k22.data.lots[0].lot_id === 3
    );

    const k23 = await apiRequest(baseUrl, 'GET', '/api/lots/1');
    record(
      'K23 GET /api/lots/1 returns Lot 1 with 12 slots and 4 pricing rules',
      k23.status === 200 &&
        Array.isArray(k23.data?.lot?.slots) &&
        k23.data.lot.slots.length === 12 &&
        Array.isArray(k23.data?.lot?.pricing_rules) &&
        k23.data.lot.pricing_rules.length === 4
    );

    const k24 = await apiRequest(
      baseUrl,
      'GET',
      '/api/lots/1/availability?start_time=2030-01-07T08:00:00&end_time=2030-01-07T10:00:00&vehicle_type=CAR'
    );
    record(
      'K24 GET /api/lots/1/availability for morning peak CAR returns 6 slots at quote 100',
      k24.status === 200 &&
        k24.data?.available_count === 6 &&
        k24.data?.slots?.[0]?.quoted_amount === 100
    );

    // Create a booking on slot 3 for 2030-01-07 08:00-10:00 via stored procedure to test availability overlap
    await pool.execute(
      "CALL book_slot(1, 3, '2030-01-07 08:00:00', '2030-01-07 10:00:00', NULL, @r_k25, @q_k25, @qr_k25)"
    );
    const [resvIdRows] = await pool.execute<RowDataPacket[]>(
      'SELECT @r_k25 AS resv_id, @qr_k25 AS qr_token'
    );
    const testResvId = Number(resvIdRows[0].resv_id);
    const testQrToken = String(resvIdRows[0].qr_token);

    const k25 = await apiRequest(
      baseUrl,
      'GET',
      '/api/lots/1/availability?start_time=2030-01-07T08:30:00&end_time=2030-01-07T09:30:00&vehicle_type=CAR'
    );
    const slot3Avail = k25.data?.slots?.find((s: any) => s.slot_id === 3);
    record(
      'K25 GET /api/lots/1/availability marks slot 3 unavailable when overlapping booking exists',
      k25.status === 200 &&
        k25.data?.available_count === 5 &&
        slot3Avail?.is_available_for_window === false
    );

    const k26 = await apiRequest(baseUrl, 'POST', '/api/lots', {
      token: rohanToken,
      body: {
        name: 'Unauthorized Lot',
        address: 'MG Road',
        city: 'Bengaluru',
        latitude: 12.975,
        longitude: 77.605,
      },
    });
    record('K26 POST /api/lots as non-admin USER returns 403', k26.status === 403);

    const k27 = await apiRequest(baseUrl, 'POST', '/api/lots', {
      token: adminToken,
      body: {
        name: 'Koramangala Test Lot',
        address: '80 Feet Road, Koramangala',
        city: 'Bengaluru',
        latitude: 12.9352,
        longitude: 77.6245,
        open_time: '06:00:00',
        close_time: '23:00:00',
        grace_period_minutes: 15,
      },
    });
    const tempLotId = Number(k27.data?.lot?.lot_id ?? 0);
    record(
      'K27 POST /api/lots as ADMIN creates temporary Lot (201)',
      k27.status === 201 && tempLotId > 3 && k27.data?.lot?.name === 'Koramangala Test Lot'
    );

    const k28 = await apiRequest(baseUrl, 'POST', `/api/lots/${tempLotId}/slots`, {
      token: adminToken,
      body: { slot_number: 'T01', slot_type: 'CAR' },
    });
    const tempSlotId = Number(k28.data?.slot?.slot_id ?? 0);
    record(
      'K28 POST /api/lots/:id/slots as ADMIN creates slot T01 in temp lot (201)',
      k28.status === 201 && tempSlotId > 30 && k28.data?.slot?.slot_number === 'T01'
    );

    const k29 = await apiRequest(baseUrl, 'POST', `/api/lots/${tempLotId}/slots`, {
      token: adminToken,
      body: { slot_number: 'T01', slot_type: 'SUV' },
    });
    record(
      'K29 POST /api/lots/:id/slots with duplicate slot_number T01 returns 409',
      k29.status === 409
    );

    const k30 = await apiRequest(
      baseUrl,
      'PUT',
      `/api/lots/${tempLotId}/slots/${tempSlotId}`,
      {
        token: adminToken,
        body: { status: 'MAINTENANCE' },
      }
    );
    record(
      'K30 PUT /api/lots/:id/slots/:slotId sets slot status to MAINTENANCE (200)',
      k30.status === 200 && k30.data?.slot?.status === 'MAINTENANCE'
    );

    const k31 = await apiRequest(baseUrl, 'PUT', '/api/lots/1/pricing', {
      token: adminToken,
      body: {
        vehicle_type: 'CAR',
        base_rate_per_hour: 45,
        overstay_penalty_per_hour: 80,
      },
    });
    const [auditRows] = await pool.execute<RowDataPacket[]>(
      `SELECT changed_by FROM audit_log WHERE table_name = 'pricing_rules' AND action = 'UPDATE' ORDER BY audit_id DESC LIMIT 1`
    );
    record(
      'K31 PUT /api/lots/1/pricing updates CAR rate to 45 and writes user:1 to audit_log',
      k31.status === 200 &&
        k31.data?.pricing_rule?.base_rate_per_hour === 45 &&
        auditRows[0]?.changed_by === 'user:1'
    );

    const k32 = await apiRequest(baseUrl, 'PUT', '/api/lots/1/pricing', {
      token: adminToken,
      body: {
        vehicle_type: 'CAR',
        base_rate_per_hour: 40,
        overstay_penalty_per_hour: 80,
      },
    });
    record(
      'K32 PUT /api/lots/1/pricing restores CAR rate to 40 (200)',
      k32.status === 200 && k32.data?.pricing_rule?.base_rate_per_hour === 40
    );

    const k33 = await apiRequest(baseUrl, 'DELETE', `/api/lots/${tempLotId}`, {
      token: adminToken,
    });
    record(
      'K33 DELETE /api/lots/:id as ADMIN deletes temporary lot and cascades slots (200)',
      k33.status === 200
    );

    // ===== Group 5: Favorites & Reviews (K34-K40) =====
    const k34 = await apiRequest(baseUrl, 'GET', '/api/favorites', { token: rohanToken });
    record(
      'K34 GET /api/favorites as Rohan (user 2) returns 2 seed favorite lots',
      k34.status === 200 &&
        Array.isArray(k34.data?.favorites) &&
        k34.data.favorites.length === 2
    );

    const k35 = await apiRequest(baseUrl, 'POST', '/api/favorites/3', { token: rohanToken });
    const k35List = await apiRequest(baseUrl, 'GET', '/api/favorites', { token: rohanToken });
    record(
      'K35 POST /api/favorites/3 adds Lot 3 to Rohan favorites (201)',
      k35.status === 201 && k35List.data?.favorites?.length === 3
    );

    const k36 = await apiRequest(baseUrl, 'DELETE', '/api/favorites/3', { token: rohanToken });
    record(
      'K36 DELETE /api/favorites/3 removes Lot 3 from Rohan favorites (200)',
      k36.status === 200
    );

    // Review on CONFIRMED reservation (not yet completed) must be rejected with 400
    const k37 = await apiRequest(baseUrl, 'POST', '/api/reviews', {
      token: rohanToken,
      body: { reservation_id: testResvId, rating: 5, comment: 'Too early to review' },
    });
    record(
      'K37 POST /api/reviews on CONFIRMED (non-completed) reservation returns 400',
      k37.status === 400 && k37.data?.error?.code === 'RESERVATION_NOT_COMPLETED'
    );

    // Complete the reservation via Phase 1b procedures check_in + checkout_and_bill
    await pool.execute('CALL check_in(?, ?, ?)', [
      testResvId,
      testQrToken,
      '2030-01-07 08:05:00',
    ]);
    await pool.execute('CALL checkout_and_bill(?, ?, ?, @b_k38, @p_k38, @t_k38)', [
      testResvId,
      '2030-01-07 09:50:00',
      'UPI',
    ]);

    // Meera (not owner of testResvId) tries to review Rohan's completed reservation -> 403
    const k38 = await apiRequest(baseUrl, 'POST', '/api/reviews', {
      token: meeraToken,
      body: { reservation_id: testResvId, rating: 4, comment: 'Not my booking' },
    });
    record(
      'K38 POST /api/reviews on another user COMPLETED reservation returns 403',
      k38.status === 403
    );

    // Rohan reviews his own COMPLETED reservation -> 201
    const k39 = await apiRequest(baseUrl, 'POST', '/api/reviews', {
      token: rohanToken,
      body: { reservation_id: testResvId, rating: 5, comment: 'Great parking lot!' },
    });
    const createdReviewId = Number(k39.data?.review?.review_id ?? 0);
    const lot1AfterReview = await apiRequest(baseUrl, 'GET', '/api/lots/1');
    record(
      'K39 POST /api/reviews on own COMPLETED reservation returns 201 and updates lot avg_rating',
      k39.status === 201 &&
        createdReviewId > 0 &&
        lot1AfterReview.data?.lot?.avg_rating === 5
    );

    // Second review on same reservation -> 409 Duplicate
    const k40 = await apiRequest(baseUrl, 'POST', '/api/reviews', {
      token: rohanToken,
      body: { reservation_id: testResvId, rating: 4, comment: 'Second review attempt' },
    });
    record(
      'K40 POST /api/reviews second time on same reservation returns 409',
      k40.status === 409
    );

    // ===== Group 6: Cleanup & Clean State Verification (K41-K42) =====
    const k41 = await apiRequest(baseUrl, 'DELETE', `/api/reviews/${createdReviewId}`, {
      token: rohanToken,
    });
    record('K41 DELETE /api/reviews/:id removes test review (200)', k41.status === 200);

    await resetTestData();

    const [counts] = await pool.execute<RowDataPacket[]>(
      `SELECT
         (SELECT COUNT(*) FROM users) AS users_cnt,
         (SELECT COUNT(*) FROM vehicles) AS vehicles_cnt,
         (SELECT COUNT(*) FROM parking_lots) AS lots_cnt,
         (SELECT COUNT(*) FROM parking_slots WHERE status = 'AVAILABLE') AS avail_slots_cnt,
         (SELECT COUNT(*) FROM reservations) AS resv_cnt`
    );
    const c = counts[0];
    record(
      'K42 cleanup leaves 4 seed users, 5 vehicles, 3 lots, 30 AVAILABLE slots, 0 reservations',
      Number(c.users_cnt) === 4 &&
        Number(c.vehicles_cnt) === 5 &&
        Number(c.lots_cnt) === 3 &&
        Number(c.avail_slots_cnt) === 30 &&
        Number(c.resv_cnt) === 0
    );

    // Print report in exact tab-separated format matching Phase 1
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
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Unhandled error in verify_phase_2a:', err);
  process.exit(1);
});

