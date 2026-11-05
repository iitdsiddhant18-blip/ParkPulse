import {
  AdminUserRecord,
  AnalyticsOverviewResponse,
  FavoriteLot,
  LotAvailabilityResponse,
  NotificationItem,
  ParkingLotDetail,
  ParkingLotSummary,
  ParkingSlot,
  PaymentMethod,
  PaymentRecord,
  PeakMultiplier,
  PricingRule,
  QrScanResponse,
  QuoteBreakdownResponse,
  ReceiptData,
  RecurringSeriesRecord,
  ReservationRecord,
  ReviewRecord,
  SlotStatus,
  User,
  Vehicle,
  VehicleType,
  WaitlistEntry,
} from './types';

let apiBaseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export function getApiBaseUrl(): string {
  return apiBaseUrl;
}

export function setApiBaseUrl(url: string): void {
  apiBaseUrl = url.replace(/\/+$/, '');
}

export function getLotStreamUrl(lotId: number): string {
  return `${apiBaseUrl}/api/lots/${lotId}/stream`;
}

/**
 * Extracts a 36-character UUID `qr_token` from either a JSON QR payload
 * `{"reservation_id":1,"qr_token":"..."}` or a raw UUID string.
 */
export function extractQrToken(rawInput: string): string {
  const trimmed = rawInput.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed?.qr_token === 'string') {
        return parsed.qr_token.trim();
      }
    } catch {
      // Fall back to regex extraction
    }
  }
  const uuidMatch = trimmed.match(
    /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/
  );
  return uuidMatch ? uuidMatch[0] : trimmed;
}

export class ApiClientError extends Error {
  public readonly status: number;
  public readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function requestJson<T>(
  method: string,
  path: string,
  options: { token?: string | null; body?: unknown } = {}
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (options.token) {
    headers['Authorization'] = `Bearer ${options.token}`;
  }

  const res = await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    cache: 'no-store',
  });

  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }

  if (!res.ok) {
    const code = parsed?.error?.code || 'API_ERROR';
    const message = parsed?.error?.message || `Request failed with status ${res.status}`;
    throw new ApiClientError(res.status, code, message);
  }

  return parsed as T;
}

// ===== Auth =====
export async function apiRegister(input: {
  full_name: string;
  email: string;
  phone?: string;
  password: string;
}): Promise<{ token: string; user: User }> {
  return requestJson('POST', '/api/auth/register', { body: input });
}

export async function apiLogin(input: {
  email: string;
  password: string;
}): Promise<{ token: string; user: User }> {
  return requestJson('POST', '/api/auth/login', { body: input });
}

export async function apiLogout(token: string): Promise<{ message: string }> {
  return requestJson('POST', '/api/auth/logout', { token });
}

export async function apiGetMe(token: string): Promise<{ user: User }> {
  return requestJson('GET', '/api/auth/me', { token });
}

// ===== Lots, Availability & Dynamic Price Breakdown =====
export async function apiGetLots(filters?: {
  q?: string;
  city?: string;
  vehicle_type?: string;
}): Promise<{ lots: ParkingLotSummary[] }> {
  const params = new URLSearchParams();
  if (filters?.q) params.set('q', filters.q);
  if (filters?.city) params.set('city', filters.city);
  if (filters?.vehicle_type) params.set('vehicle_type', filters.vehicle_type);
  const qs = params.toString();
  return requestJson('GET', `/api/lots${qs ? `?${qs}` : ''}`);
}

export async function apiGetLotDetail(lotId: number): Promise<{ lot: ParkingLotDetail }> {
  return requestJson('GET', `/api/lots/${lotId}`);
}

export async function apiGetLotAvailability(
  lotId: number,
  params: { start_time: string; end_time: string; vehicle_type?: string }
): Promise<LotAvailabilityResponse> {
  const search = new URLSearchParams({
    start_time: params.start_time,
    end_time: params.end_time,
  });
  if (params.vehicle_type) {
    search.set('vehicle_type', params.vehicle_type);
  }
  return requestJson('GET', `/api/lots/${lotId}/availability?${search.toString()}`);
}

export async function apiGetQuoteBreakdown(
  lotId: number,
  params: { start_time: string; end_time: string; vehicle_type: VehicleType }
): Promise<QuoteBreakdownResponse> {
  const search = new URLSearchParams({
    start_time: params.start_time,
    end_time: params.end_time,
    vehicle_type: params.vehicle_type,
  });
  return requestJson('GET', `/api/lots/${lotId}/quote-breakdown?${search.toString()}`);
}

export async function apiGetLotReviews(lotId: number): Promise<{ reviews: ReviewRecord[] }> {
  return requestJson('GET', `/api/lots/${lotId}/reviews`);
}

// ===== Vehicles =====
export async function apiGetVehicles(token: string): Promise<{ vehicles: Vehicle[] }> {
  return requestJson('GET', '/api/vehicles', { token });
}

export async function apiCreateVehicle(
  token: string,
  input: { plate_number: string; vehicle_type: VehicleType }
): Promise<{ vehicle: Vehicle }> {
  return requestJson('POST', '/api/vehicles', { token, body: input });
}

export async function apiUpdateVehicle(
  token: string,
  vehicleId: number,
  input: { plate_number?: string; vehicle_type?: VehicleType }
): Promise<{ vehicle: Vehicle }> {
  return requestJson('PUT', `/api/vehicles/${vehicleId}`, { token, body: input });
}

export async function apiDeleteVehicle(
  token: string,
  vehicleId: number
): Promise<{ message: string; vehicle_id: number }> {
  return requestJson('DELETE', `/api/vehicles/${vehicleId}`, { token });
}

// ===== Reservations, Payments, Check-In/Out, QR Scan & Receipts =====
export async function apiGetReservations(
  token: string,
  status?: string
): Promise<{ reservations: ReservationRecord[] }> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  return requestJson('GET', `/api/reservations${qs}`, { token });
}

export async function apiGetReservationDetail(
  token: string,
  reservationId: number
): Promise<{ reservation: ReservationRecord }> {
  return requestJson('GET', `/api/reservations/${reservationId}`, { token });
}

export async function apiCreateReservation(
  token: string,
  input: {
    vehicle_id: number;
    slot_id: number;
    start_time: string;
    end_time: string;
    pay_now?: boolean;
    payment_method?: PaymentMethod;
  }
): Promise<{ reservation: ReservationRecord }> {
  return requestJson('POST', '/api/reservations', { token, body: input });
}

export async function apiModifyReservation(
  token: string,
  reservationId: number,
  input: { slot_id?: number; start_time?: string; end_time?: string }
): Promise<{ reservation: ReservationRecord }> {
  return requestJson('PUT', `/api/reservations/${reservationId}`, { token, body: input });
}

export async function apiCancelReservation(
  token: string,
  reservationId: number
): Promise<{ reservation: ReservationRecord }> {
  return requestJson('POST', `/api/reservations/${reservationId}/cancel`, { token });
}

export async function apiPayReservation(
  token: string,
  reservationId: number,
  method: PaymentMethod = 'UPI'
): Promise<{ payment: PaymentRecord }> {
  return requestJson('POST', `/api/reservations/${reservationId}/pay`, {
    token,
    body: { method },
  });
}

export async function apiCheckIn(
  token: string,
  reservationId: number,
  input: { qr_token: string; checkin_time?: string }
): Promise<{ reservation: ReservationRecord }> {
  return requestJson('POST', `/api/reservations/${reservationId}/check-in`, {
    token,
    body: input,
  });
}

export async function apiCheckOut(
  token: string,
  reservationId: number,
  input: { payment_method?: PaymentMethod; checkout_time?: string } = {}
): Promise<{
  reservation: ReservationRecord;
  billing: { base_amount: number; penalty_amount: number; total_amount: number };
  payments: PaymentRecord[];
}> {
  return requestJson('POST', `/api/reservations/${reservationId}/check-out`, {
    token,
    body: input,
  });
}

export async function apiScanQr(
  token: string,
  input: {
    qr_token: string;
    action?: 'AUTO' | 'CHECK_IN' | 'CHECK_OUT';
    scan_time?: string;
    payment_method?: PaymentMethod;
  }
): Promise<QrScanResponse> {
  const cleanToken = extractQrToken(input.qr_token);
  return requestJson('POST', '/api/reservations/qr/scan', {
    token,
    body: {
      ...input,
      qr_token: cleanToken,
    },
  });
}

export async function apiGetReceipt(
  token: string,
  reservationId: number
): Promise<{ receipt: ReceiptData }> {
  return requestJson('GET', `/api/reservations/${reservationId}/receipt`, { token });
}

// ===== Recurring Reservation Series (Phase 4a) =====
export async function apiGetSeries(
  token: string
): Promise<{ series: RecurringSeriesRecord[] }> {
  return requestJson('GET', '/api/series', { token });
}

export async function apiCreateSeries(
  token: string,
  input: {
    vehicle_id: number;
    slot_id: number;
    day_of_week: number;
    start_clock: string;
    duration_minutes: number;
    valid_from: string;
    valid_to: string;
  }
): Promise<{ series: RecurringSeriesRecord; reservations: ReservationRecord[] }> {
  return requestJson('POST', '/api/series', { token, body: input });
}

export async function apiCancelSeries(
  token: string,
  seriesId: number
): Promise<{
  message: string;
  series_id: number;
  cancelled_occurrences: number;
}> {
  return requestJson('DELETE', `/api/series/${seriesId}`, { token });
}

// ===== Favorites =====
export async function apiGetFavorites(token: string): Promise<{ favorites: FavoriteLot[] }> {
  return requestJson('GET', '/api/favorites', { token });
}

export async function apiAddFavorite(
  token: string,
  lotId: number
): Promise<{ message: string; user_id: number; lot_id: number }> {
  return requestJson('POST', `/api/favorites/${lotId}`, { token });
}

export async function apiRemoveFavorite(
  token: string,
  lotId: number
): Promise<{ message: string; user_id: number; lot_id: number }> {
  return requestJson('DELETE', `/api/favorites/${lotId}`, { token });
}

// ===== Reviews =====
export async function apiCreateReview(
  token: string,
  input: { reservation_id: number; rating: number; comment?: string }
): Promise<{ review: ReviewRecord }> {
  return requestJson('POST', '/api/reviews', { token, body: input });
}

export async function apiDeleteReview(
  token: string,
  reviewId: number
): Promise<{ message: string; review_id: number }> {
  return requestJson('DELETE', `/api/reviews/${reviewId}`, { token });
}

// ===== Waitlist =====
export async function apiGetWaitlist(token: string): Promise<{ waitlist: WaitlistEntry[] }> {
  return requestJson('GET', '/api/waitlist', { token });
}

export async function apiCreateWaitlist(
  token: string,
  input: {
    vehicle_id: number;
    lot_id: number;
    desired_start: string;
    desired_end: string;
  }
): Promise<{ waitlist_entry: WaitlistEntry }> {
  return requestJson('POST', '/api/waitlist', { token, body: input });
}

export async function apiCancelWaitlist(
  token: string,
  waitlistId: number
): Promise<{ message: string; waitlist_id: number }> {
  return requestJson('DELETE', `/api/waitlist/${waitlistId}`, { token });
}

// ===== Notifications & Reminders =====
export async function apiGetNotifications(
  token: string
): Promise<{ unread_count: number; notifications: NotificationItem[] }> {
  return requestJson('GET', '/api/notifications', { token });
}

export async function apiMarkNotificationRead(
  token: string,
  notificationId: number
): Promise<{ notification: NotificationItem }> {
  return requestJson('PATCH', `/api/notifications/${notificationId}/read`, { token });
}

export async function apiMarkAllNotificationsRead(token: string): Promise<{ message: string }> {
  return requestJson('POST', '/api/notifications/read-all', { token });
}

export async function apiTriggerReminders(
  token: string,
  input?: { reference_time?: string; window_minutes?: number }
): Promise<{ reminders_created: number; emails_dispatched: number }> {
  return requestJson('POST', '/api/notifications/send-reminders', {
    token,
    body: input ?? {},
  });
}

// ===== Admin Panel & Analytics (Phase 3b) =====
export async function apiAdminGetAnalyticsOverview(
  token: string
): Promise<AnalyticsOverviewResponse> {
  return requestJson('GET', '/api/admin/analytics/overview', { token });
}

export async function apiAdminSeedDemoAnalytics(token: string): Promise<{
  message: string;
  seeded_reservations: number;
  seeded_payments: number;
  seeded_reviews: number;
}> {
  return requestJson('POST', '/api/admin/analytics/seed-demo', { token });
}

export async function apiAdminResetDemoAnalytics(token: string): Promise<{
  message: string;
}> {
  return requestJson('POST', '/api/admin/analytics/reset-demo', { token });
}

export async function apiAdminApplyDynamicPricing(token: string): Promise<{
  updated_buckets: number;
  adjustments: Array<{
    lot_id: number;
    day_of_week: number;
    hour_of_day: number;
    booking_count: number;
    new_multiplier: number;
  }>;
}> {
  return requestJson('POST', '/api/admin/analytics/apply-dynamic-pricing', { token });
}

export async function apiAdminDownloadReport(
  token: string,
  format: 'csv' | 'pdf'
): Promise<{ contentType: string; buffer: ArrayBuffer; text?: string }> {
  const res = await fetch(`${apiBaseUrl}/api/admin/reports/export?format=${format}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new ApiClientError(res.status, 'EXPORT_FAILED', `Report export failed (${res.status})`);
  }

  const contentType = res.headers.get('content-type') || '';
  const buffer = await res.arrayBuffer();
  const text = format === 'csv' ? new TextDecoder('utf-8').decode(buffer) : undefined;
  return { contentType, buffer, text };
}

export async function apiAdminGetUsers(
  token: string
): Promise<{ users: AdminUserRecord[] }> {
  return requestJson('GET', '/api/admin/users', { token });
}

export async function apiAdminUpdateUserStatus(
  token: string,
  userId: number,
  isActive: boolean
): Promise<{ user: User }> {
  return requestJson('PATCH', `/api/admin/users/${userId}/status`, {
    token,
    body: { is_active: isActive },
  });
}

export async function apiAdminGetReservations(
  token: string,
  filters?: { status?: string; lot_id?: number; user_id?: number }
): Promise<{ reservations: ReservationRecord[] }> {
  const params = new URLSearchParams();
  if (filters?.status) params.set('status', filters.status);
  if (filters?.lot_id) params.set('lot_id', String(filters.lot_id));
  if (filters?.user_id) params.set('user_id', String(filters.user_id));
  const qs = params.toString();
  return requestJson('GET', `/api/admin/reservations${qs ? `?${qs}` : ''}`, { token });
}

export async function apiAdminExpireStale(
  token: string,
  referenceTime?: string
): Promise<{ expired_count: number }> {
  return requestJson('POST', '/api/admin/reservations/expire-stale', {
    token,
    body: referenceTime ? { reference_time: referenceTime } : {},
  });
}

export async function apiAdminCreateLot(
  token: string,
  input: {
    name: string;
    address: string;
    city: string;
    latitude: number;
    longitude: number;
    open_time?: string;
    close_time?: string;
    grace_period_minutes?: number;
  }
): Promise<{ lot: ParkingLotSummary }> {
  return requestJson('POST', '/api/lots', { token, body: input });
}

export async function apiAdminDeleteLot(
  token: string,
  lotId: number
): Promise<{ message: string; lot_id: number }> {
  return requestJson('DELETE', `/api/lots/${lotId}`, { token });
}

export async function apiAdminCreateSlot(
  token: string,
  lotId: number,
  input: { slot_number: string; slot_type: VehicleType; status?: SlotStatus }
): Promise<{ slot: ParkingSlot }> {
  return requestJson('POST', `/api/lots/${lotId}/slots`, { token, body: input });
}

export async function apiAdminUpdateSlot(
  token: string,
  lotId: number,
  slotId: number,
  input: { slot_number?: string; slot_type?: VehicleType; status?: SlotStatus }
): Promise<{ slot: ParkingSlot }> {
  return requestJson('PUT', `/api/lots/${lotId}/slots/${slotId}`, { token, body: input });
}

export async function apiAdminDeleteSlot(
  token: string,
  lotId: number,
  slotId: number
): Promise<{ message: string; slot_id: number }> {
  return requestJson('DELETE', `/api/lots/${lotId}/slots/${slotId}`, { token });
}

export async function apiAdminUpsertPricing(
  token: string,
  lotId: number,
  input: {
    vehicle_type: VehicleType;
    base_rate_per_hour: number;
    overstay_penalty_per_hour: number;
  }
): Promise<{ pricing_rule: PricingRule }> {
  return requestJson('PUT', `/api/lots/${lotId}/pricing`, { token, body: input });
}

export async function apiAdminUpsertMultiplier(
  token: string,
  lotId: number,
  input: { day_of_week: number; hour_of_day: number; multiplier: number }
): Promise<{ peak_multiplier: PeakMultiplier }> {
  return requestJson('PUT', `/api/lots/${lotId}/peak-multipliers`, { token, body: input });
}
