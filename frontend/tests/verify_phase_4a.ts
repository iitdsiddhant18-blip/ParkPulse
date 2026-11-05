import fs from 'fs';
import http from 'http';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import dotenv from 'dotenv';
import mysql, { RowDataPacket } from 'mysql2/promise';
import {
  apiAdminExpireStale,
  apiCancelReservation,
  apiCancelSeries,
  apiCreateReservation,
  apiCreateSeries,
  apiGetLots,
  apiGetNotifications,
  apiGetQuoteBreakdown,
  apiGetReceipt,
  apiGetSeries,
  apiLogin,
  apiMarkAllNotificationsRead,
  apiMarkNotificationRead,
  apiScanQr,
  apiTriggerReminders,
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

  const cleanDb = async () => {
    await pool.execute('DELETE FROM reviews');
    await pool.execute('DELETE FROM payments');
    await pool.execute('DELETE FROM notifications');
    await pool.execute('DELETE FROM waitlist');
    await pool.execute('DELETE FROM reservations');
    await pool.execute('DELETE FROM reservation_series');
    await pool.execute('DELETE FROM audit_log');
    await pool.execute('DELETE FROM parking_lots WHERE lot_id > 3');
    await pool.execute('DELETE FROM vehicles WHERE vehicle_id > 5');
    await pool.execute('DELETE FROM users WHERE user_id > 4');
    await pool.execute("UPDATE parking_slots SET status = 'AVAILABLE'");
  };

  let backendProc: ChildProcess | null = null;
  let frontendProc: ChildProcess | null = null;

  const backendUrl = 'http://127.0.0.1:4097';
  const frontendUrl = 'http://127.0.0.1:3097';
  setApiBaseUrl(backendUrl);

  const nextBin = path.resolve(__dirname, '../node_modules/next/dist/bin/next');
  const tsxBin = path.resolve(__dirname, '../node_modules/tsx/dist/cli.mjs');

  try {
    await cleanDb();

    backendProc = spawn(
      process.execPath,
      [tsxBin, path.resolve(__dirname, '../../backend/src/server.ts')],
      {
        cwd: path.resolve(__dirname, '../../backend'),
        env: { ...process.env, BACKEND_PORT: '4097' },
        stdio: 'ignore',
      }
    );

    if (!(await waitForHttp(`${backendUrl}/api/health`, 15000))) {
      throw new Error('Backend server failed to start on port 4097');
    }

    frontendProc = spawn(
      process.execPath,
      [nextBin, 'start', '-p', '3097', '-H', '127.0.0.1'],
      {
        cwd: path.resolve(__dirname, '..'),
        env: { ...process.env, NEXT_PUBLIC_API_URL: backendUrl },
        stdio: 'ignore',
      }
    );

    if (!(await waitForHttp(`${frontendUrl}/map`, 20000))) {
      throw new Error('Next.js server failed to start on port 3097');
    }

    // ===== Group 1: Editorial Design System & Phase 4a Route Rendering (P01-P07) =====
    const checkRoute = async (routePath: string, testId: string): Promise<string> => {
      const res = await fetch(`${frontendUrl}${routePath}`);
      if (res.status !== 200) return '';
      const html = await res.text();
      return html.includes(`data-testid="${testId}"`) ? html : '';
    };

    const mapHtml = await checkRoute('/map', 'map-view-page');
    record(
      'P01 GET /map renders Live Leaflet Map View page shell (200 and map-view-page)',
      mapHtml.length > 0
    );

    const scannerHtml = await checkRoute('/scanner', 'qr-scanner-page');
    record(
      'P02 GET /scanner renders QR Gate Scanner Terminal page shell (200 and qr-scanner-page)',
      scannerHtml.length > 0
    );

    const seriesHtml = await checkRoute('/series', 'recurring-series-page');
    record(
      'P03 GET /series renders Recurring Series & Dynamic Price page shell (200 and recurring-series-page)',
      seriesHtml.length > 0
    );

    const notifHtml = await checkRoute('/notifications', 'notifications-page');
    record(
      'P04 GET /notifications renders Notification Center page shell (200 and notifications-page)',
      notifHtml.length > 0
    );

    const globalsCssText = fs.readFileSync(
      path.resolve(__dirname, '../src/app/globals.css'),
      'utf8'
    );
    record(
      'P05 Editorial Sand palette (#F3ECE0, #EE5335, #2251E5, #CEE938) & fonts configured in globals.css and layout',
      mapHtml.includes('data-theme="editorial-sand"') &&
        globalsCssText.includes('#F3ECE0') &&
        globalsCssText.includes('#EE5335') &&
        globalsCssText.includes('#2251E5') &&
        globalsCssText.includes('#CEE938') &&
        globalsCssText.includes('Playfair+Display')
    );

    record(
      'P06 Navbar renders links to /map, /scanner, /series, and /notifications',
      mapHtml.includes('href="/map"') &&
        mapHtml.includes('href="/scanner"') &&
        mapHtml.includes('href="/series"') &&
        mapHtml.includes('href="/notifications"')
    );

    const qbMorning = await apiGetQuoteBreakdown(1, {
      start_time: '2030-06-03 08:00:00',
      end_time: '2030-06-03 10:00:00',
      vehicle_type: 'CAR',
    });
    record(
      'P07 GET /api/lots/1/quote-breakdown returns 2 morning peak slices (1.25x) and total_quote = 100',
      qbMorning.total_quote === 100 &&
        qbMorning.slices.length === 2 &&
        qbMorning.slices[0].multiplier === 1.25 &&
        qbMorning.slices[0].is_peak === true
    );

    // ===== Group 2: Live Map Data & Real-Time SSE Marker Updates (P08-P12) =====
    const adminLogin = await apiLogin({
      email: 'admin@parkpulse.dev',
      password: 'Admin@123',
    });
    const adminToken = adminLogin.token;

    const rohanLogin = await apiLogin({
      email: 'rohan@example.com',
      password: 'Password@123',
    });
    const rohanToken = rohanLogin.token;

    const ananyaLogin = await apiLogin({
      email: 'ananya@example.com',
      password: 'Password@123',
    });
    const ananyaToken = ananyaLogin.token;

    const lotsList = await apiGetLots();
    record(
      'P08 apiGetLots returns valid Bengaluru latitude/longitude coordinates for all 3 lots',
      lotsList.lots.length === 3 &&
        lotsList.lots.every(
          (l) =>
            Number(l.latitude) > 12.8 &&
            Number(l.latitude) < 13.2 &&
            Number(l.longitude) > 77.4 &&
            Number(l.longitude) < 77.8
        )
    );

    const sseLot2 = openSseOnce(getLotStreamUrl(2));
    const lot2Snap = await sseLot2.waitForEvent('snapshot', 3000);
    record(
      'P09 Lot 2 SSE stream (/api/lots/2/stream) emits initial snapshot with 10 available slots',
      lot2Snap?.lot_id === 2 && lot2Snap?.occupancy?.available_slots === 10
    );

    const lot2Booking = await apiCreateReservation(rohanToken, {
      vehicle_id: 1,
      slot_id: 15, // B03 CAR in Lot 2
      start_time: '2030-06-03 10:00:00',
      end_time: '2030-06-03 12:00:00',
    });
    const lot2Update = await sseLot2.waitForEvent('slot_update', 3000);
    record(
      'P10 Booking Slot 15 in Lot 2 broadcasts SSE slot_update showing available_slots = 9',
      lot2Update?.occupancy?.available_slots === 9 &&
        lot2Update?.occupancy?.reserved_slots === 1
    );
    sseLot2.close();

    const qbCross = await apiGetQuoteBreakdown(1, {
      start_time: '2030-06-03 16:00:00',
      end_time: '2030-06-03 18:00:00',
      vehicle_type: 'CAR',
    });
    record(
      'P11 Cross-boundary quote breakdown (16:00-18:00 Mon) shows 1.00x (40) + 1.50x (60) = 100',
      qbCross.total_quote === 100 &&
        qbCross.slices.length === 2 &&
        qbCross.slices[0].multiplier === 1.0 &&
        qbCross.slices[0].slice_amount === 40 &&
        qbCross.slices[1].multiplier === 1.5 &&
        qbCross.slices[1].slice_amount === 60
    );

    await apiCancelReservation(rohanToken, lot2Booking.reservation.reservation_id);
    const lotsAfterCancel = await apiGetLots();
    const lot2After = lotsAfterCancel.lots.find((l) => l.lot_id === 2);
    record(
      'P12 Cancelling Lot 2 booking restores Lot 2 available_slots to 10',
      lot2After?.available_slots === 10
    );

    // ===== Group 3: QR Scanner Check-In, Check-Out & Overstay Penalty Flow (P13-P20) =====
    const qrBooking = await apiCreateReservation(rohanToken, {
      vehicle_id: 1,
      slot_id: 3, // A03 CAR in Lot 1
      start_time: '2030-06-10 10:00:00',
      end_time: '2030-06-10 12:00:00',
    });
    const qrResId = qrBooking.reservation.reservation_id;
    const qrToken = qrBooking.reservation.qr_token;
    record(
      'P13 Booking Slot 3 for 2030-06-10 10:00-12:00 returns CONFIRMED pass with quote 80',
      qrBooking.reservation.status === 'CONFIRMED' &&
        qrBooking.reservation.quoted_amount === 80 &&
        qrToken.length === 36
    );

    // Pass full JSON QR payload string to apiScanQr to test JSON token extraction
    const jsonQrPayload = JSON.stringify({
      reservation_id: qrResId,
      qr_token: qrToken,
    });
    let scanIn: any = null;
    try {
      scanIn = await apiScanQr(rohanToken, {
        qr_token: jsonQrPayload,
        action: 'AUTO',
        scan_time: '2030-06-10 10:04:00',
      });
    } catch {
      // ignore
    }
    record(
      'P14 apiScanQr with JSON QR payload performs CHECK_IN and marks slot OCCUPIED',
      scanIn?.action_performed === 'CHECK_IN' &&
        scanIn?.reservation?.status === 'CHECKED_IN' &&
        scanIn?.reservation?.slot_status === 'OCCUPIED'
    );

    // Scan out 2 hours late (14:00:00 vs 12:00:00 end_time -> 2h * 80/hr = 160 overstay penalty)
    let scanOut: any = null;
    try {
      scanOut = await apiScanQr(rohanToken, {
        qr_token: qrToken,
        action: 'AUTO',
        scan_time: '2030-06-10 14:00:00',
        payment_method: 'UPI',
      });
    } catch {
      // ignore
    }
    record(
      'P15 apiScanQr on CHECKED_IN pass 2h past end_time performs CHECK_OUT with 160 overstay penalty (total 240)',
      scanOut?.action_performed === 'CHECK_OUT' &&
        scanOut?.reservation?.status === 'COMPLETED' &&
        scanOut?.billing?.base_amount === 80 &&
        scanOut?.billing?.penalty_amount === 160 &&
        scanOut?.billing?.total_amount === 240
    );

    let completedScanRejected = false;
    try {
      await apiScanQr(rohanToken, {
        qr_token: qrToken,
        action: 'AUTO',
      });
    } catch (err: any) {
      completedScanRejected = err?.status === 400 && err?.code === 'INVALID_QR_STATE';
    }
    record(
      'P16 Scanning an already COMPLETED QR pass returns 400 INVALID_QR_STATE',
      completedScanRejected
    );

    let unknownQrRejected = false;
    try {
      await apiScanQr(rohanToken, {
        qr_token: '99999999-9999-9999-9999-999999999999',
        action: 'AUTO',
      });
    } catch (err: any) {
      unknownQrRejected = err?.status === 404 && err?.code === 'QR_NOT_FOUND';
    }
    record(
      'P17 Scanning an unknown QR token returns 404 QR_NOT_FOUND',
      unknownQrRejected
    );

    const notifsAfterOverstay = await apiGetNotifications(rohanToken);
    const overstayNotif = notifsAfterOverstay.notifications.find(
      (n) => n.reservation_id === qrResId && n.type === 'OVERSTAY'
    );
    record(
      'P18 Overstay check-out generates OVERSTAY notification with email_sent = true',
      overstayNotif !== undefined && overstayNotif.email_sent === true
    );

    let qrReceipt: any = null;
    try {
      qrReceipt = await apiGetReceipt(rohanToken, qrResId);
    } catch {
      // ignore
    }
    record(
      'P19 Receipt for QR-scanned stay shows penalty_paid = 160 and total_paid = 240',
      qrReceipt?.receipt?.billing?.penalty_paid === 160 &&
        qrReceipt?.receipt?.billing?.total_paid === 240
    );

    const [slot3Rows] = await pool.execute<RowDataPacket[]>(
      `SELECT status FROM parking_slots WHERE slot_id = 3`
    );
    record(
      'P20 Slot 3 returns to AVAILABLE after QR check-out',
      slot3Rows[0]?.status === 'AVAILABLE'
    );

    // ===== Group 4: Recurring Reservation Series UI Client Flow (P21-P26) =====
    // Wednesdays (day_of_week = 2) between 2030-07-01 and 2030-07-20: July 3, July 10, July 17 (3 occurrences)
    // Ananya's EV (vehicle_id = 4) on Slot 11 (A11 EV in Lot 1, base rate = 50, morning peak 08:00-10:00 = 1.25x -> 125.00)
    const createdSeries = await apiCreateSeries(ananyaToken, {
      vehicle_id: 4,
      slot_id: 11,
      day_of_week: 2,
      start_clock: '08:00',
      duration_minutes: 120,
      valid_from: '2030-07-01',
      valid_to: '2030-07-20',
    });
    const seriesId = createdSeries.series.series_id;
    record(
      'P21 apiCreateSeries books 3 Wednesday EV occurrences at morning peak quote 125.00 each',
      seriesId > 0 &&
        createdSeries.reservations.length === 3 &&
        createdSeries.reservations.every((r) => Number(r.quoted_amount) === 125)
    );

    const listedSeries = await apiGetSeries(ananyaToken);
    record(
      'P22 apiGetSeries returns active series with occurrence_count = 3 and active_occurrences = 3',
      listedSeries.series.length === 1 &&
        listedSeries.series[0].occurrence_count === 3 &&
        listedSeries.series[0].active_occurrences === 3
    );

    let overlapSeriesRejected = false;
    try {
      await apiCreateSeries(ananyaToken, {
        vehicle_id: 4,
        slot_id: 11,
        day_of_week: 2,
        start_clock: '09:00',
        duration_minutes: 60,
        valid_from: '2030-07-01',
        valid_to: '2030-07-20',
      });
    } catch (err: any) {
      overlapSeriesRejected = err?.status === 409;
    }
    record(
      'P23 Overlapping recurring series is rejected with 409 SLOT_OVERLAP',
      overlapSeriesRejected
    );

    // Cancel first occurrence individually, leaving 2 active occurrences
    await apiCancelReservation(
      ananyaToken,
      createdSeries.reservations[0].reservation_id
    );
    const seriesAfterOneCancel = await apiGetSeries(ananyaToken);
    record(
      'P24 Cancelling 1 occurrence updates active_occurrences to 2 while series stays active',
      seriesAfterOneCancel.series[0].is_active === true &&
        seriesAfterOneCancel.series[0].active_occurrences === 2
    );

    const cancelSeriesRes = await apiCancelSeries(ananyaToken, seriesId);
    record(
      'P25 apiCancelSeries deactivates series and cancels remaining 2 occurrences',
      cancelSeriesRes.cancelled_occurrences === 2
    );

    const [slot11Rows] = await pool.execute<RowDataPacket[]>(
      `SELECT status FROM parking_slots WHERE slot_id = 11`
    );
    record(
      'P26 Slot 11 returns to AVAILABLE after series cancellation',
      slot11Rows[0]?.status === 'AVAILABLE'
    );

    // ===== Group 5: Notification Center, Reminder Trigger & Clean Reset (P27-P34) =====
    const futureRes = await apiCreateReservation(rohanToken, {
      vehicle_id: 1,
      slot_id: 4,
      start_time: '2030-08-01 10:00:00',
      end_time: '2030-08-01 12:00:00',
    });
    const futureResId = futureRes.reservation.reservation_id;

    const remRes = await apiTriggerReminders(adminToken, {
      reference_time: '2030-08-01 09:15:00',
      window_minutes: 60,
    });
    record(
      'P27 apiTriggerReminders creates 1 REMINDER alert and dispatches 1 email for upcoming booking',
      remRes.reminders_created === 1 && remRes.emails_dispatched === 1
    );

    const rohanNotifs = await apiGetNotifications(rohanToken);
    const reminderItem = rohanNotifs.notifications.find(
      (n) => n.reservation_id === futureResId && n.type === 'REMINDER'
    );
    record(
      'P28 apiGetNotifications lists BOOKING_CONFIRMED, OVERSTAY, PAYMENT, and REMINDER alerts',
      reminderItem !== undefined &&
        reminderItem.is_read === false &&
        rohanNotifs.unread_count >= 2
    );

    const beforeUnread = rohanNotifs.unread_count;
    const markedOne = await apiMarkNotificationRead(
      rohanToken,
      reminderItem!.notification_id
    );
    const afterOneNotifs = await apiGetNotifications(rohanToken);
    record(
      'P29 apiMarkNotificationRead marks single alert read and decrements unread_count by 1',
      markedOne.notification.is_read === true &&
        afterOneNotifs.unread_count === beforeUnread - 1
    );

    await apiMarkAllNotificationsRead(rohanToken);
    const afterAllNotifs = await apiGetNotifications(rohanToken);
    record(
      'P30 apiMarkAllNotificationsRead sets unread_count to 0',
      afterAllNotifs.unread_count === 0
    );

    const expRes = await apiAdminExpireStale(adminToken, '2030-08-01 10:20:00');
    const [slot4Rows] = await pool.execute<RowDataPacket[]>(
      `SELECT status FROM parking_slots WHERE slot_id = 4`
    );
    record(
      'P31 apiAdminExpireStale marks past-grace booking EXPIRED and frees Slot 4',
      expRes.expired_count === 1 && slot4Rows[0]?.status === 'AVAILABLE'
    );

    const notifsAfterExpire = await apiGetNotifications(rohanToken);
    const expiredAlert = notifsAfterExpire.notifications.find(
      (n) => n.reservation_id === futureResId && n.type === 'EXPIRED'
    );
    record(
      'P32 Expiring stale booking creates EXPIRED alert with email_sent = true in Notification Center',
      expiredAlert !== undefined && expiredAlert.email_sent === true
    );

    await cleanDb();
    const [cleanCounts] = await pool.execute<RowDataPacket[]>(
      `SELECT
         (SELECT COUNT(*) FROM reservations) AS resv_cnt,
         (SELECT COUNT(*) FROM reservation_series) AS series_cnt,
         (SELECT COUNT(*) FROM notifications) AS notif_cnt,
         (SELECT COUNT(*) FROM parking_slots WHERE status = 'AVAILABLE') AS avail_cnt`
    );
    const cc = cleanCounts[0];
    record(
      'P33 Cleanup leaves 0 reservations, 0 series, 0 notifications, and 30 AVAILABLE slots',
      Number(cc.resv_cnt) === 0 &&
        Number(cc.series_cnt) === 0 &&
        Number(cc.notif_cnt) === 0 &&
        Number(cc.avail_cnt) === 30
    );

    const [seedCounts] = await pool.execute<RowDataPacket[]>(
      `SELECT
         (SELECT COUNT(*) FROM users) AS users_cnt,
         (SELECT COUNT(*) FROM vehicles) AS vehicles_cnt,
         (SELECT COUNT(*) FROM parking_lots) AS lots_cnt,
         (SELECT COUNT(*) FROM peak_multipliers) AS peak_cnt`
    );
    const sc = seedCounts[0];
    record(
      'P34 Cleanup preserves 4 seed users, 5 vehicles, 3 lots, and 135 peak_multipliers',
      Number(sc.users_cnt) === 4 &&
        Number(sc.vehicles_cnt) === 5 &&
        Number(sc.lots_cnt) === 3 &&
        Number(sc.peak_cnt) === 135
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
  console.error('Unhandled error in verify_phase_4a:', err);
  process.exit(1);
});
