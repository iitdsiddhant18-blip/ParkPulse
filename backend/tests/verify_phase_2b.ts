import http, { Server } from 'http';
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

interface SseEvent {
  event: string;
  data: any;
}

function openSseReader(url: string): {
  events: SseEvent[];
  waitForEvent: (eventName: string, timeoutMs?: number) => Promise<SseEvent | null>;
  close: () => void;
} {
  const events: SseEvent[] = [];
  const waiters: Array<{ eventName: string; resolve: (e: SseEvent) => void }> = [];
  let buffer = '';

  const req = http.get(url, (res) => {
    res.setEncoding('utf8');
    res.on('data', (chunk: string) => {
      buffer += chunk;
      let idx = buffer.indexOf('\n\n');
      while (idx !== -1) {
        const rawBlock = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        idx = buffer.indexOf('\n\n');

        const lines = rawBlock.split('\n');
        let evName = 'message';
        let dataStr = '';
        for (const line of lines) {
          if (line.startsWith('event:')) {
            evName = line.slice('event:'.length).trim();
          } else if (line.startsWith('data:')) {
            dataStr += line.slice('data:'.length).trim();
          }
        }
        if (dataStr) {
          try {
            const parsed = JSON.parse(dataStr);
            const evObj: SseEvent = { event: evName, data: parsed };
            events.push(evObj);
            for (let i = waiters.length - 1; i >= 0; i--) {
              if (waiters[i].eventName === evName) {
                const w = waiters.splice(i, 1)[0];
                w.resolve(evObj);
              }
            }
          } catch {
            // ignore non-json comment
          }
        }
      }
    });
  });

  return {
    events,
    waitForEvent(eventName: string, timeoutMs = 4000): Promise<SseEvent | null> {
      const existing = events.find((e) => e.event === eventName);
      if (existing) {
        return Promise.resolve(existing);
      }
      return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), timeoutMs);
        waiters.push({
          eventName,
          resolve: (ev) => {
            clearTimeout(timer);
            resolve(ev);
          },
        });
      });
    },
    close() {
      req.destroy();
    },
  };
}

async function resetDatabaseState(): Promise<void> {
  await pool.execute('DELETE FROM reviews');
  await pool.execute('DELETE FROM payments');
  await pool.execute('DELETE FROM notifications');
  await pool.execute('DELETE FROM waitlist');
  await pool.execute('DELETE FROM reservations');
  await pool.execute('DELETE FROM reservation_series');
  await pool.execute('DELETE FROM audit_log');
  await pool.execute("UPDATE parking_slots SET status = 'AVAILABLE'");
}

async function main(): Promise<void> {
  const app = createApp();
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });

  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await resetDatabaseState();

    // Authenticate seed accounts
    const adminLogin = await apiRequest(baseUrl, 'POST', '/api/auth/login', {
      body: { email: 'admin@parkpulse.dev', password: 'Admin@123' },
    });
    const adminToken = String(adminLogin.data?.token ?? '');

    const rohanLogin = await apiRequest(baseUrl, 'POST', '/api/auth/login', {
      body: { email: 'rohan@example.com', password: 'Password@123' },
    });
    const rohanToken = String(rohanLogin.data?.token ?? '');

    const ananyaLogin = await apiRequest(baseUrl, 'POST', '/api/auth/login', {
      body: { email: 'ananya@example.com', password: 'Password@123' },
    });
    const ananyaToken = String(ananyaLogin.data?.token ?? '');

    const karthikLogin = await apiRequest(baseUrl, 'POST', '/api/auth/login', {
      body: { email: 'karthik@example.com', password: 'Password@123' },
    });
    const karthikToken = String(karthikLogin.data?.token ?? '');

    // ===== Group 1: SSE Live Slot Stream & First Booking (L01-L04) =====
    const sse = openSseReader(`${baseUrl}/api/lots/1/stream`);
    const snapshotEv = await sse.waitForEvent('snapshot', 3000);
    record(
      'L01 GET /api/lots/1/stream emits initial snapshot event with 12 AVAILABLE slots',
      snapshotEv !== null &&
        snapshotEv.data?.lot_id === 1 &&
        snapshotEv.data?.occupancy?.available_slots === 12 &&
        Array.isArray(snapshotEv.data?.slots) &&
        snapshotEv.data.slots.length === 12
    );

    // Book Slot 3 (CAR in Lot 1) for Rohan (vehicle 1, CAR) on Monday 2030-02-04 08:00-10:00 (morning peak = 100)
    const l02 = await apiRequest(baseUrl, 'POST', '/api/reservations', {
      token: rohanToken,
      body: {
        vehicle_id: 1,
        slot_id: 3,
        start_time: '2030-02-04 08:00:00',
        end_time: '2030-02-04 10:00:00',
      },
    });
    const res1Id = Number(l02.data?.reservation?.reservation_id ?? 0);
    const res1Qr = String(l02.data?.reservation?.qr_token ?? '');
    const res1QrUrl = String(l02.data?.reservation?.qr_code_data_url ?? '');
    record(
      'L02 POST /api/reservations creates CONFIRMED booking with quote 100 and QR data URL (201)',
      l02.status === 201 &&
        res1Id > 0 &&
        l02.data?.reservation?.status === 'CONFIRMED' &&
        l02.data?.reservation?.quoted_amount === 100 &&
        res1Qr.length === 36 &&
        res1QrUrl.startsWith('data:image/png;base64,')
    );

    const updateEv = await sse.waitForEvent('slot_update', 3000);
    const slot3InSse = updateEv?.data?.slots?.find((s: any) => s.slot_id === 3);
    record(
      'L03 SSE stream broadcasts slot_update showing slot 3 RESERVED and reserved_slots = 1',
      updateEv !== null &&
        updateEv.data?.occupancy?.reserved_slots === 1 &&
        slot3InSse?.status === 'RESERVED'
    );
    sse.close();

    const [l04Rows] = await pool.execute<RowDataPacket[]>(
      `SELECT email_sent FROM notifications WHERE reservation_id = ? AND type = 'BOOKING_CONFIRMED' LIMIT 1`,
      [res1Id]
    );
    record(
      'L04 BOOKING_CONFIRMED notification dispatched via Nodemailer (email_sent = true)',
      Boolean(l04Rows[0]?.email_sent) === true
    );

    // ===== Group 2: Booking Rules, Overlap & Modification (L05-L11) =====
    const l05 = await apiRequest(baseUrl, 'POST', '/api/reservations', {
      token: rohanToken,
      body: {
        vehicle_id: 3, // Ananya's SUV
        slot_id: 9,
        start_time: '2030-02-04 08:00:00',
        end_time: '2030-02-04 10:00:00',
      },
    });
    record(
      'L05 POST /api/reservations with another user vehicle returns 403',
      l05.status === 403
    );

    const l06 = await apiRequest(baseUrl, 'POST', '/api/reservations', {
      token: rohanToken,
      body: {
        vehicle_id: 2, // Rohan's BIKE
        slot_id: 4, // CAR slot
        start_time: '2030-02-04 08:00:00',
        end_time: '2030-02-04 10:00:00',
      },
    });
    record(
      'L06 POST /api/reservations with mismatched vehicle/slot type (BIKE in CAR slot) returns 400',
      l06.status === 400 && l06.data?.error?.code === 'BUSINESS_RULE_VIOLATION'
    );

    const l07 = await apiRequest(baseUrl, 'POST', '/api/reservations', {
      token: karthikToken,
      body: {
        vehicle_id: 5, // Karthik's CAR
        slot_id: 3,
        start_time: '2030-02-04 09:00:00',
        end_time: '2030-02-04 11:00:00',
      },
    });
    record(
      'L07 POST /api/reservations with overlapping window on slot 3 returns 409 SLOT_OVERLAP',
      l07.status === 409 && l07.data?.error?.code === 'SLOT_OVERLAP'
    );

    const l08 = await apiRequest(baseUrl, 'GET', '/api/reservations', { token: rohanToken });
    record(
      'L08 GET /api/reservations as Rohan lists his active reservation',
      l08.status === 200 &&
        Array.isArray(l08.data?.reservations) &&
        l08.data.reservations.length === 1 &&
        l08.data.reservations[0].reservation_id === res1Id
    );

    const l09 = await apiRequest(baseUrl, 'GET', `/api/reservations/${res1Id}`, {
      token: ananyaToken,
    });
    record(
      'L09 GET /api/reservations/:id as non-owner Ananya returns 403',
      l09.status === 403
    );

    const l10 = await apiRequest(baseUrl, 'GET', `/api/reservations/${res1Id}`, {
      token: rohanToken,
    });
    record(
      'L10 GET /api/reservations/:id as owner Rohan returns 200 with QR code and payments',
      l10.status === 200 &&
        l10.data?.reservation?.reservation_id === res1Id &&
        String(l10.data?.reservation?.qr_code_data_url ?? '').startsWith('data:image/png;base64,')
    );

    // Modify res1 from morning peak (08:00-10:00, quote 100) to off-peak (10:00-12:00, quote 80)
    const l11 = await apiRequest(baseUrl, 'PUT', `/api/reservations/${res1Id}`, {
      token: rohanToken,
      body: {
        start_time: '2030-02-04 10:00:00',
        end_time: '2030-02-04 12:00:00',
      },
    });
    record(
      'L11 PUT /api/reservations/:id modifies window to off-peak 10:00-12:00 and updates quote to 80',
      l11.status === 200 && l11.data?.reservation?.quoted_amount === 80
    );

    // ===== Group 3: Payments, Check-In, Check-Out, Overstay, Receipts & QR Scan (L12-L24) =====
    const l12 = await apiRequest(baseUrl, 'POST', `/api/reservations/${res1Id}/pay`, {
      token: rohanToken,
      body: { method: 'CARD' },
    });
    record(
      'L12 POST /api/reservations/:id/pay records PAID BOOKING payment of 80 (201)',
      l12.status === 201 &&
        l12.data?.payment?.amount === 80 &&
        l12.data?.payment?.payment_type === 'BOOKING' &&
        l12.data?.payment?.status === 'PAID'
    );

    const l13 = await apiRequest(baseUrl, 'POST', `/api/reservations/${res1Id}/pay`, {
      token: rohanToken,
      body: { method: 'CARD' },
    });
    record(
      'L13 POST /api/reservations/:id/pay second time returns 409 ALREADY_PAID',
      l13.status === 409 && l13.data?.error?.code === 'ALREADY_PAID'
    );

    const l14 = await apiRequest(baseUrl, 'POST', `/api/reservations/${res1Id}/check-in`, {
      token: rohanToken,
      body: {
        qr_token: '00000000-0000-0000-0000-000000000000',
        checkin_time: '2030-02-04 10:05:00',
      },
    });
    record(
      'L14 POST /api/reservations/:id/check-in with invalid qr_token returns 400',
      l14.status === 400
    );

    const l15 = await apiRequest(baseUrl, 'POST', `/api/reservations/${res1Id}/check-in`, {
      token: rohanToken,
      body: {
        qr_token: res1Qr,
        checkin_time: '2030-02-04 09:30:00',
      },
    });
    record(
      'L15 POST /api/reservations/:id/check-in more than 15m early returns 400',
      l15.status === 400
    );

    const l16 = await apiRequest(baseUrl, 'POST', `/api/reservations/${res1Id}/check-in`, {
      token: rohanToken,
      body: {
        qr_token: res1Qr,
        checkin_time: '2030-02-04 10:05:00',
      },
    });
    record(
      'L16 POST /api/reservations/:id/check-in within window sets CHECKED_IN and slot OCCUPIED (200)',
      l16.status === 200 &&
        l16.data?.reservation?.status === 'CHECKED_IN' &&
        l16.data?.reservation?.slot_status === 'OCCUPIED'
    );

    const l17 = await apiRequest(baseUrl, 'PUT', `/api/reservations/${res1Id}`, {
      token: rohanToken,
      body: { end_time: '2030-02-04 13:00:00' },
    });
    record(
      'L17 PUT /api/reservations/:id on already CHECKED_IN reservation returns 400',
      l17.status === 400
    );

    // Check out 45m after 12:00:00 end_time -> 1 ceiling hour overstay penalty = 80.00
    const l18 = await apiRequest(baseUrl, 'POST', `/api/reservations/${res1Id}/check-out`, {
      token: rohanToken,
      body: {
        checkout_time: '2030-02-04 12:45:00',
        payment_method: 'UPI',
      },
    });
    record(
      'L18 POST /api/reservations/:id/check-out with 45m overstay bills penalty 80 and total 160 (200)',
      l18.status === 200 &&
        l18.data?.reservation?.status === 'COMPLETED' &&
        l18.data?.billing?.base_amount === 80 &&
        l18.data?.billing?.penalty_amount === 80 &&
        l18.data?.billing?.total_amount === 160
    );

    record(
      'L19 check-out preserves existing BOOKING payment and adds PENALTY payment (2 rows total)',
      Array.isArray(l18.data?.payments) &&
        l18.data.payments.length === 2 &&
        l18.data.payments.some((p: any) => p.payment_type === 'BOOKING' && p.amount === 80) &&
        l18.data.payments.some((p: any) => p.payment_type === 'PENALTY' && p.amount === 80)
    );

    const l20 = await apiRequest(baseUrl, 'GET', `/api/reservations/${res1Id}/receipt`, {
      token: rohanToken,
    });
    record(
      'L20 GET /api/reservations/:id/receipt returns itemized receipt with total_paid 160 and penalty_paid 80',
      l20.status === 200 &&
        String(l20.data?.receipt?.receipt_number ?? '').startsWith('PP-RCPT-') &&
        l20.data?.receipt?.billing?.total_paid === 160 &&
        l20.data?.receipt?.billing?.penalty_paid === 80
    );

    // Create second booking res2 on Slot 4 (2030-02-05 14:00-15:00, quote 40) to test QR scanner check-in + check-out
    const l21 = await apiRequest(baseUrl, 'POST', '/api/reservations', {
      token: rohanToken,
      body: {
        vehicle_id: 1,
        slot_id: 4,
        start_time: '2030-02-05 14:00:00',
        end_time: '2030-02-05 15:00:00',
      },
    });
    const res2Qr = String(l21.data?.reservation?.qr_token ?? '');
    record(
      'L21 POST /api/reservations creates second booking on slot 4 with quote 40 (201)',
      l21.status === 201 && l21.data?.reservation?.quoted_amount === 40
    );

    const l22 = await apiRequest(baseUrl, 'POST', '/api/reservations/qr/scan', {
      token: rohanToken,
      body: {
        qr_token: res2Qr,
        action: 'AUTO',
        scan_time: '2030-02-05 14:02:00',
      },
    });
    record(
      'L22 POST /api/reservations/qr/scan on CONFIRMED booking performs CHECK_IN (200)',
      l22.status === 200 &&
        l22.data?.action_performed === 'CHECK_IN' &&
        l22.data?.reservation?.status === 'CHECKED_IN'
    );

    const l23 = await apiRequest(baseUrl, 'POST', '/api/reservations/qr/scan', {
      token: rohanToken,
      body: {
        qr_token: res2Qr,
        action: 'AUTO',
        scan_time: '2030-02-05 14:50:00',
        payment_method: 'WALLET',
      },
    });
    record(
      'L23 POST /api/reservations/qr/scan on CHECKED_IN booking performs CHECK_OUT with 0 penalty (200)',
      l23.status === 200 &&
        l23.data?.action_performed === 'CHECK_OUT' &&
        l23.data?.reservation?.status === 'COMPLETED' &&
        l23.data?.billing?.penalty_amount === 0 &&
        l23.data?.billing?.total_amount === 40
    );

    const [l24Rows] = await pool.execute<RowDataPacket[]>(
      `SELECT status FROM parking_slots WHERE slot_id = 4`
    );
    record(
      'L24 slot 4 returns to AVAILABLE after QR check-out',
      l24Rows[0]?.status === 'AVAILABLE'
    );

    // ===== Group 4: Waitlist, Cancellation, Refunds & Auto-Notification (L25-L33) =====
    const l25 = await apiRequest(baseUrl, 'POST', '/api/reservations', {
      token: rohanToken,
      body: {
        vehicle_id: 1,
        slot_id: 5,
        start_time: '2030-02-06 08:00:00',
        end_time: '2030-02-06 10:00:00',
        pay_now: true,
        payment_method: 'UPI',
      },
    });
    const res3Id = Number(l25.data?.reservation?.reservation_id ?? 0);
    record(
      'L25 POST /api/reservations with pay_now=true books slot 5 and records upfront payment (201)',
      l25.status === 201 && res3Id > 0
    );

    const l26 = await apiRequest(baseUrl, 'POST', '/api/waitlist', {
      token: karthikToken,
      body: {
        vehicle_id: 5, // Karthik's CAR
        lot_id: 1,
        desired_start: '2030-02-06 08:30:00',
        desired_end: '2030-02-06 09:30:00',
      },
    });
    const waitId = Number(l26.data?.waitlist_entry?.waitlist_id ?? 0);
    record(
      'L26 POST /api/waitlist adds Karthik CAR to Lot 1 waitlist with status WAITING (201)',
      l26.status === 201 && waitId > 0 && l26.data?.waitlist_entry?.status === 'WAITING'
    );

    const l27 = await apiRequest(baseUrl, 'GET', '/api/waitlist', { token: karthikToken });
    record(
      'L27 GET /api/waitlist as Karthik returns 1 WAITING entry',
      l27.status === 200 &&
        Array.isArray(l27.data?.waitlist) &&
        l27.data.waitlist.length === 1 &&
        l27.data.waitlist[0].waitlist_id === waitId
    );

    const l28 = await apiRequest(baseUrl, 'POST', `/api/reservations/${res3Id}/cancel`, {
      token: karthikToken,
    });
    record(
      'L28 POST /api/reservations/:id/cancel by non-owner Karthik is rejected (400)',
      l28.status === 400
    );

    const l29 = await apiRequest(baseUrl, 'POST', `/api/reservations/${res3Id}/cancel`, {
      token: rohanToken,
    });
    record(
      'L29 POST /api/reservations/:id/cancel by owner Rohan transitions status to CANCELLED (200)',
      l29.status === 200 && l29.data?.reservation?.status === 'CANCELLED'
    );

    const [l30Rows] = await pool.execute<RowDataPacket[]>(
      `SELECT status FROM payments WHERE reservation_id = ? AND payment_type = 'BOOKING' LIMIT 1`,
      [res3Id]
    );
    record(
      'L30 cancelling paid reservation refunds upfront BOOKING payment (status = REFUNDED)',
      l30Rows[0]?.status === 'REFUNDED'
    );

    const l31 = await apiRequest(baseUrl, 'GET', '/api/waitlist', { token: karthikToken });
    record(
      'L31 cancelling reservation auto-transitions Karthik waitlist entry to NOTIFIED',
      l31.status === 200 && l31.data?.waitlist?.[0]?.status === 'NOTIFIED'
    );

    const l32 = await apiRequest(baseUrl, 'GET', '/api/notifications', { token: karthikToken });
    const waitNotif = l32.data?.notifications?.find(
      (n: any) => n.type === 'WAITLIST_AVAILABLE'
    );
    record(
      'L32 Karthik receives WAITLIST_AVAILABLE notification with email_sent = true',
      l32.status === 200 && waitNotif !== undefined && waitNotif.email_sent === true
    );

    const l33 = await apiRequest(baseUrl, 'DELETE', `/api/waitlist/${waitId}`, {
      token: karthikToken,
    });
    record(
      'L33 DELETE /api/waitlist/:id cancels waitlist entry (200)',
      l33.status === 200
    );

    // ===== Group 5: Recurring Reservation Series (L34-L39) =====
    // Mondays between 2030-03-04 and 2030-03-18: 2030-03-04, 2030-03-11, 2030-03-18 (3 occurrences)
    const l34 = await apiRequest(baseUrl, 'POST', '/api/series', {
      token: ananyaToken,
      body: {
        vehicle_id: 3, // Ananya's SUV
        slot_id: 9, // SUV slot in Lot 1
        day_of_week: 0, // Monday
        start_clock: '10:00:00',
        duration_minutes: 120,
        valid_from: '2030-03-04',
        valid_to: '2030-03-18',
      },
    });
    const seriesId = Number(l34.data?.series?.series_id ?? 0);
    record(
      'L34 POST /api/series creates Monday recurring series and books 3 occurrences (201)',
      l34.status === 201 &&
        seriesId > 0 &&
        Array.isArray(l34.data?.reservations) &&
        l34.data.reservations.length === 3
    );

    const l35 = await apiRequest(baseUrl, 'GET', '/api/series', { token: ananyaToken });
    record(
      'L35 GET /api/series as Ananya shows occurrence_count = 3 and active_occurrences = 3',
      l35.status === 200 &&
        l35.data?.series?.[0]?.series_id === seriesId &&
        l35.data?.series?.[0]?.occurrence_count === 3 &&
        l35.data?.series?.[0]?.active_occurrences === 3
    );

    const l36 = await apiRequest(baseUrl, 'POST', '/api/series', {
      token: ananyaToken,
      body: {
        vehicle_id: 3,
        slot_id: 9,
        day_of_week: 0,
        start_clock: '11:00:00',
        duration_minutes: 60,
        valid_from: '2030-03-04',
        valid_to: '2030-03-18',
      },
    });
    const [seriesCountRows] = await pool.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM reservation_series`
    );
    record(
      'L36 POST /api/series overlapping existing series returns 409 and rolls back partial series',
      l36.status === 409 && Number(seriesCountRows[0].cnt) === 1
    );

    const l37 = await apiRequest(baseUrl, 'DELETE', `/api/series/${seriesId}`, {
      token: ananyaToken,
    });
    record(
      'L37 DELETE /api/series/:id deactivates series and cancels all 3 occurrences (200)',
      l37.status === 200 && l37.data?.cancelled_occurrences === 3
    );

    const [l38Rows] = await pool.execute<RowDataPacket[]>(
      `SELECT status FROM parking_slots WHERE slot_id = 9`
    );
    record(
      'L38 slot 9 returns to AVAILABLE after series cancellation',
      l38Rows[0]?.status === 'AVAILABLE'
    );

    const l39 = await apiRequest(baseUrl, 'GET', '/api/series', { token: ananyaToken });
    record(
      'L39 GET /api/series shows is_active = false and active_occurrences = 0',
      l39.status === 200 &&
        l39.data?.series?.[0]?.is_active === false &&
        l39.data?.series?.[0]?.active_occurrences === 0
    );

    // ===== Group 6: Reminders, Notifications, Admin Expiry & Clean Reset (L40-L48) =====
    const l40 = await apiRequest(baseUrl, 'POST', '/api/reservations', {
      token: rohanToken,
      body: {
        vehicle_id: 1,
        slot_id: 6,
        start_time: '2030-04-01 10:00:00',
        end_time: '2030-04-01 12:00:00',
      },
    });
    const res4Id = Number(l40.data?.reservation?.reservation_id ?? 0);
    record(
      'L40 POST /api/reservations books res4 on slot 6 for 2030-04-01 10:00-12:00 (201)',
      l40.status === 201 && res4Id > 0
    );

    const l41 = await apiRequest(baseUrl, 'POST', '/api/notifications/send-reminders', {
      token: adminToken,
      body: {
        reference_time: '2030-04-01 09:30:00',
        window_minutes: 60,
      },
    });
    record(
      'L41 POST /api/notifications/send-reminders creates and emails 1 REMINDER notification',
      l41.status === 200 &&
        l41.data?.reminders_created === 1 &&
        l41.data?.emails_dispatched === 1
    );

    const l42 = await apiRequest(baseUrl, 'POST', '/api/notifications/send-reminders', {
      token: adminToken,
      body: {
        reference_time: '2030-04-01 09:35:00',
        window_minutes: 60,
      },
    });
    record(
      'L42 POST /api/notifications/send-reminders is idempotent (reminders_created = 0 on repeat)',
      l42.status === 200 && l42.data?.reminders_created === 0
    );

    const l43 = await apiRequest(baseUrl, 'GET', '/api/notifications', { token: rohanToken });
    const firstNotifId = Number(l43.data?.notifications?.[0]?.notification_id ?? 0);
    record(
      'L43 GET /api/notifications as Rohan returns notifications with unread_count > 0',
      l43.status === 200 && l43.data?.unread_count > 0 && firstNotifId > 0
    );

    const l44 = await apiRequest(
      baseUrl,
      'PATCH',
      `/api/notifications/${firstNotifId}/read`,
      { token: rohanToken }
    );
    record(
      'L44 PATCH /api/notifications/:id/read marks notification as read (200)',
      l44.status === 200 && l44.data?.notification?.is_read === true
    );

    const l45 = await apiRequest(baseUrl, 'POST', '/api/notifications/read-all', {
      token: rohanToken,
    });
    const afterReadAll = await apiRequest(baseUrl, 'GET', '/api/notifications', {
      token: rohanToken,
    });
    record(
      'L45 POST /api/notifications/read-all sets unread_count to 0 (200)',
      l45.status === 200 && afterReadAll.data?.unread_count === 0
    );

    const l46 = await apiRequest(
      baseUrl,
      'GET',
      '/api/admin/reservations?status=CONFIRMED',
      { token: adminToken }
    );
    record(
      'L46 GET /api/admin/reservations?status=CONFIRMED returns res4 for ADMIN',
      l46.status === 200 &&
        Array.isArray(l46.data?.reservations) &&
        l46.data.reservations.length === 1 &&
        l46.data.reservations[0].reservation_id === res4Id
    );

    // Lot 1 grace period is 15 minutes; at 10:20:00 res4 (start 10:00:00) is past grace and must expire
    const l47 = await apiRequest(baseUrl, 'POST', '/api/admin/reservations/expire-stale', {
      token: adminToken,
      body: { reference_time: '2030-04-01 10:20:00' },
    });
    const [slot6Rows] = await pool.execute<RowDataPacket[]>(
      `SELECT status FROM parking_slots WHERE slot_id = 6`
    );
    record(
      'L47 POST /api/admin/reservations/expire-stale marks res4 EXPIRED and frees slot 6',
      l47.status === 200 &&
        l47.data?.expired_count === 1 &&
        slot6Rows[0]?.status === 'AVAILABLE'
    );

    await resetDatabaseState();
    const [counts] = await pool.execute<RowDataPacket[]>(
      `SELECT
         (SELECT COUNT(*) FROM users) AS users_cnt,
         (SELECT COUNT(*) FROM vehicles) AS vehicles_cnt,
         (SELECT COUNT(*) FROM parking_lots) AS lots_cnt,
         (SELECT COUNT(*) FROM parking_slots WHERE status = 'AVAILABLE') AS avail_slots_cnt,
         (SELECT COUNT(*) FROM reservations) AS resv_cnt,
         (SELECT COUNT(*) FROM reservation_series) AS series_cnt`
    );
    const c = counts[0];
    record(
      'L48 cleanup leaves 4 seed users, 5 vehicles, 3 lots, 30 AVAILABLE slots, 0 reservations, 0 series',
      Number(c.users_cnt) === 4 &&
        Number(c.vehicles_cnt) === 5 &&
        Number(c.lots_cnt) === 3 &&
        Number(c.avail_slots_cnt) === 30 &&
        Number(c.resv_cnt) === 0 &&
        Number(c.series_cnt) === 0
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
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Unhandled error in verify_phase_2b:', err);
  process.exit(1);
});
