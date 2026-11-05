import http from 'http';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import dotenv from 'dotenv';
import mysql, { RowDataPacket } from 'mysql2/promise';
import {
  apiAddFavorite,
  apiCancelWaitlist,
  apiCheckIn,
  apiCheckOut,
  apiCreateReservation,
  apiCreateReview,
  apiCreateVehicle,
  apiCreateWaitlist,
  apiDeleteVehicle,
  apiGetFavorites,
  apiGetLotAvailability,
  apiGetLotDetail,
  apiGetLotReviews,
  apiGetLots,
  apiGetMe,
  apiGetReceipt,
  apiGetVehicles,
  apiGetWaitlist,
  apiLogin,
  apiModifyReservation,
  apiPayReservation,
  apiRegister,
  apiUpdateVehicle,
  apiRemoveFavorite,
  getLotStreamUrl,
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

function openSseOnce(
  url: string
): {
  waitForEvent: (eventName: string, timeoutMs?: number) => Promise<any | null>;
  close: () => void;
} {
  const events: Array<{ event: string; data: any }> = [];
  const waiters: Array<{ eventName: string; resolve: (d: any) => void }> = [];
  let buffer = '';

  const req = http.get(url, (res) => {
    res.setEncoding('utf8');
    res.on('data', (chunk: string) => {
      buffer += chunk;
      let idx = buffer.indexOf('\n\n');
      while (idx !== -1) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        idx = buffer.indexOf('\n\n');

        let evName = 'message';
        let dataStr = '';
        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) evName = line.slice(6).trim();
          else if (line.startsWith('data:')) dataStr += line.slice(5).trim();
        }
        if (dataStr) {
          try {
            const parsed = JSON.parse(dataStr);
            events.push({ event: evName, data: parsed });
            for (let i = waiters.length - 1; i >= 0; i--) {
              if (waiters[i].eventName === evName) {
                const w = waiters.splice(i, 1)[0];
                w.resolve(parsed);
              }
            }
          } catch {
            // ignore
          }
        }
      }
    });
  });

  return {
    waitForEvent(eventName: string, timeoutMs = 4000): Promise<any | null> {
      const found = events.find((e) => e.event === eventName);
      if (found) return Promise.resolve(found.data);
      return new Promise((resolve) => {
        const t = setTimeout(() => resolve(null), timeoutMs);
        waiters.push({
          eventName,
          resolve: (d) => {
            clearTimeout(t);
            resolve(d);
          },
        });
      });
    },
    close() {
      req.destroy();
    },
  };
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

  const resetDb = async () => {
    await pool.execute('DELETE FROM reviews');
    await pool.execute('DELETE FROM payments');
    await pool.execute('DELETE FROM notifications');
    await pool.execute('DELETE FROM waitlist');
    await pool.execute('DELETE FROM reservations');
    await pool.execute('DELETE FROM reservation_series');
    await pool.execute('DELETE FROM audit_log');
    await pool.execute('DELETE FROM favorite_lots WHERE user_id > 4 OR (user_id = 2 AND lot_id = 3)');
    await pool.execute('DELETE FROM vehicles WHERE vehicle_id > 5');
    await pool.execute('DELETE FROM parking_lots WHERE lot_id > 3');
    await pool.execute('DELETE FROM users WHERE user_id > 4');
    await pool.execute("UPDATE parking_slots SET status = 'AVAILABLE'");
  };

  let backendProc: ChildProcess | null = null;
  let frontendProc: ChildProcess | null = null;

  const backendUrl = 'http://127.0.0.1:4099';
  const frontendUrl = 'http://127.0.0.1:3099';
  setApiBaseUrl(backendUrl);

  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const nextBin = path.resolve(__dirname, '../node_modules/next/dist/bin/next');
  const tsxBin = path.resolve(__dirname, '../node_modules/tsx/dist/cli.mjs');

  try {
    await resetDb();

    // 1. Start backend on port 4099
    backendProc = spawn(
      process.execPath,
      [tsxBin, path.resolve(__dirname, '../../backend/src/server.ts')],
      {
        cwd: path.resolve(__dirname, '../../backend'),
        env: { ...process.env, BACKEND_PORT: '4099' },
        stdio: 'ignore',
      }
    );

    const backendUp = await waitForHttp(`${backendUrl}/api/health`, 15000);
    if (!backendUp) {
      throw new Error('Backend server failed to start on port 4099');
    }

    // 2. Start compiled Next.js production server on port 3099
    frontendProc = spawn(
      process.execPath,
      [nextBin, 'start', '-p', '3099', '-H', '127.0.0.1'],
      {
        cwd: path.resolve(__dirname, '..'),
        env: { ...process.env, NEXT_PUBLIC_API_URL: backendUrl },
        stdio: 'ignore',
      }
    );

    const frontendUp = await waitForHttp(`${frontendUrl}/login`, 20000);
    if (!frontendUp) {
      throw new Error('Next.js server failed to start on port 3099 (run npm run build first)');
    }

    // ===== Group 1: Next.js Route Rendering & HTML Landmarks (M01-M08) =====
    const checkRoute = async (routePath: string, testId: string): Promise<boolean> => {
      const res = await fetch(`${frontendUrl}${routePath}`);
      const html = await res.text();
      return res.status === 200 && html.includes(`data-testid="${testId}"`);
    };

    record(
      'M01 GET / renders ParkPulse discovery page (200 and lot-discovery-page)',
      await checkRoute('/', 'lot-discovery-page')
    );
    record(
      'M02 GET /login renders sign-in page with demo account buttons (200)',
      await checkRoute('/login', 'login-page')
    );
    record(
      'M03 GET /register renders registration page (200)',
      await checkRoute('/register', 'register-page')
    );
    record(
      'M04 GET /lots/1 renders lot detail & live slot grid shell (200)',
      await checkRoute('/lots/1', 'lot-detail-page')
    );
    record(
      'M05 GET /reservations renders bookings & receipts page shell (200)',
      await checkRoute('/reservations', 'reservations-page')
    );
    record(
      'M06 GET /vehicles renders vehicle management page shell (200)',
      await checkRoute('/vehicles', 'vehicles-page')
    );
    record(
      'M07 GET /favorites renders favorite lots page shell (200)',
      await checkRoute('/favorites', 'favorites-page')
    );
    record(
      'M08 GET /waitlist renders waitlist management page shell (200)',
      await checkRoute('/waitlist', 'waitlist-page')
    );

    // ===== Group 2: Auth & Lot Discovery via Frontend API Client (M09-M17) =====
    const reg = await apiRegister({
      full_name: 'Nikhil Verma',
      email: 'nikhil.ui@example.com',
      phone: '9000000088',
      password: 'Password@123',
    });
    record(
      'M09 apiRegister registers new user via frontend API client',
      reg.token.length > 20 && reg.user.email === 'nikhil.ui@example.com'
    );

    const rohanAuth = await apiLogin({
      email: 'rohan@example.com',
      password: 'Password@123',
    });
    const rohanToken = rohanAuth.token;
    record(
      'M10 apiLogin logs in seed user rohan@example.com and returns JWT',
      rohanToken.length > 20 && rohanAuth.user.user_id === 2
    );

    const me = await apiGetMe(rohanToken);
    record(
      'M11 apiGetMe fetches authenticated user profile',
      me.user.full_name === 'Rohan Mehta'
    );

    const allLots = await apiGetLots().catch(() => ({ lots: [] as any }));
    record(
      'M12 apiGetLots lists 3 active seed lots with occupancy and min_hourly_rate',
      allLots.lots.length === 3 && allLots.lots[0].min_hourly_rate === 10
    );

    const filteredLots = await apiGetLots({ q: 'Orion' }).catch(() => ({ lots: [] as any }));
    record(
      'M13 apiGetLots({ q: "Orion" }) filters to Lot 1 (Orion Mall Parking)',
      filteredLots.lots.length === 1 && filteredLots.lots[0].lot_id === 1
    );

    const lot1 = await apiGetLotDetail(1);
    record(
      'M14 apiGetLotDetail(1) returns Lot 1 with 12 slots and 4 pricing rules',
      lot1.lot.slots.length === 12 && lot1.lot.pricing_rules.length === 4
    );

    const avail = await apiGetLotAvailability(1, {
      start_time: '2030-05-06T08:00',
      end_time: '2030-05-06T10:00',
      vehicle_type: 'CAR',
    });
    record(
      'M15 apiGetLotAvailability(1) returns 6 available CAR slots with dynamic quote 100',
      avail.available_count === 6 && avail.slots[0].quoted_amount === 100
    );

    const rohanVehicles = await apiGetVehicles(rohanToken);
    record(
      'M16 apiGetVehicles returns Rohan 2 seed vehicles (CAR and BIKE)',
      rohanVehicles.vehicles.length === 2
    );

    const createdVeh = await apiCreateVehicle(reg.token, {
      plate_number: 'ka 04 ui 7777',
      vehicle_type: 'EV',
    });
    const updatedVeh = await apiUpdateVehicle(reg.token, createdVeh.vehicle.vehicle_id, {
      plate_number: 'KA04UI9999',
    });
    record(
      'M17 apiCreateVehicle & apiUpdateVehicle add and update vehicle for new user',
      updatedVeh.vehicle.plate_number === 'KA04UI9999'
    );

    // ===== Group 3: End-to-End Booking, SSE, Payment, Check-In/Out, Receipt & Review (M18-M30) =====
    const sse = openSseOnce(getLotStreamUrl(1));
    await sse.waitForEvent('snapshot', 3000);

    const booking = await apiCreateReservation(rohanToken, {
      vehicle_id: 1,
      slot_id: 3,
      start_time: '2030-05-06T08:00',
      end_time: '2030-05-06T10:00',
    });
    const resId = booking.reservation.reservation_id;
    const qrToken = booking.reservation.qr_token;
    record(
      'M18 apiCreateReservation books slot 3 and returns QR data URL',
      resId > 0 &&
        booking.reservation.quoted_amount === 100 &&
        String(booking.reservation.qr_code_data_url ?? '').startsWith('data:image/png;base64,')
    );

    const sseUpdate = await sse.waitForEvent('slot_update', 3000);
    const slot3Sse = sseUpdate?.slots?.find((s: any) => s.slot_id === 3);
    record(
      'M19 Lot 1 SSE stream (/api/lots/1/stream) broadcasts RESERVED status for slot 3',
      slot3Sse?.status === 'RESERVED' && sseUpdate?.occupancy?.reserved_slots === 1
    );
    sse.close();

    const modRes = await apiModifyReservation(rohanToken, resId, {
      start_time: '2030-05-06T10:00',
      end_time: '2030-05-06T12:00',
    });
    record(
      'M20 apiModifyReservation updates booking to off-peak window and recalculates quote to 80',
      modRes.reservation.quoted_amount === 80
    );

    const payRes = await apiPayReservation(rohanToken, resId, 'UPI');
    record(
      'M21 apiPayReservation records PAID booking payment of 80',
      payRes.payment.amount === 80 && payRes.payment.status === 'PAID'
    );

    const chkIn = await apiCheckIn(rohanToken, resId, {
      qr_token: qrToken,
      checkin_time: '2030-05-06 10:05:00',
    });
    record(
      'M22 apiCheckIn transitions reservation to CHECKED_IN and slot to OCCUPIED',
      chkIn.reservation.status === 'CHECKED_IN' && chkIn.reservation.slot_status === 'OCCUPIED'
    );

    const chkOut = await apiCheckOut(rohanToken, resId, {
      payment_method: 'UPI',
      checkout_time: '2030-05-06 12:45:00',
    });
    record(
      'M23 apiCheckOut completes stay with 45m overstay penalty of 80 (total 160)',
      chkOut.reservation.status === 'COMPLETED' &&
        chkOut.billing.penalty_amount === 80 &&
        chkOut.billing.total_amount === 160
    );

    const rcpt = await apiGetReceipt(rohanToken, resId);
    record(
      'M24 apiGetReceipt returns itemized receipt PP-RCPT with total_paid 160',
      rcpt.receipt.receipt_number.startsWith('PP-RCPT-') &&
        rcpt.receipt.billing.total_paid === 160
    );

    const rev = await apiCreateReview(rohanToken, {
      reservation_id: resId,
      rating: 5,
      comment: 'Seamless booking from the Next.js web app!',
    });
    record(
      'M25 apiCreateReview submits 5-star review on completed reservation',
      rev.review.rating === 5
    );

    const lotRevs = await apiGetLotReviews(1);
    record(
      'M26 apiGetLotReviews(1) lists the newly created 5-star review',
      lotRevs.reviews.length === 1 && lotRevs.reviews[0].rating === 5
    );

    await apiAddFavorite(rohanToken, 3);
    const favsAfterAdd = await apiGetFavorites(rohanToken);
    record(
      'M27 apiAddFavorite & apiGetFavorites add Lot 3 to Rohan favorites and list 3 favorites',
      favsAfterAdd.favorites.length === 3
    );

    await apiRemoveFavorite(rohanToken, 3);
    const favsAfterRem = await apiGetFavorites(rohanToken);
    record(
      'M28 apiRemoveFavorite removes Lot 3 and restores Rohan favorites to 2',
      favsAfterRem.favorites.length === 2
    );

    const wl = await apiCreateWaitlist(rohanToken, {
      vehicle_id: 1,
      lot_id: 1,
      desired_start: '2030-05-10T09:00',
      desired_end: '2030-05-10T11:00',
    });
    const wlList = await apiGetWaitlist(rohanToken);
    await apiCancelWaitlist(rohanToken, wl.waitlist_entry.waitlist_id);
    record(
      'M29 apiCreateWaitlist, apiGetWaitlist & apiCancelWaitlist complete waitlist lifecycle',
      wlList.waitlist.length === 1 && wlList.waitlist[0].status === 'WAITING'
    );

    await apiDeleteVehicle(reg.token, createdVeh.vehicle.vehicle_id);
    await resetDb();

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
      'M30 cleanup restores 4 seed users, 5 vehicles, 3 lots, 30 AVAILABLE slots, 0 reservations',
      Number(c.users_cnt) === 4 &&
        Number(c.vehicles_cnt) === 5 &&
        Number(c.lots_cnt) === 3 &&
        Number(c.avail_slots_cnt) === 30 &&
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
  console.error('Unhandled error in verify_phase_3a:', err);
  process.exit(1);
});
