export type UserRole = 'USER' | 'ADMIN';
export type VehicleType = 'BIKE' | 'CAR' | 'SUV' | 'EV';
export type SlotStatus = 'AVAILABLE' | 'RESERVED' | 'OCCUPIED' | 'MAINTENANCE';
export type ReservationStatus =
  | 'CONFIRMED'
  | 'CHECKED_IN'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'NO_SHOW';
export type PaymentMethod = 'CARD' | 'UPI' | 'CASH' | 'WALLET';
export type WaitlistStatus = 'WAITING' | 'NOTIFIED' | 'FULFILLED' | 'CANCELLED' | 'EXPIRED';

export interface User {
  user_id: number;
  full_name: string;
  email: string;
  phone: string | null;
  role: UserRole;
  is_active: boolean;
  created_at: string;
}

export interface AdminUserRecord extends User {
  vehicle_count: number;
  reservation_count: number;
}

export interface Vehicle {
  vehicle_id: number;
  user_id: number;
  plate_number: string;
  vehicle_type: VehicleType;
  created_at: string;
}

export interface PricingRule {
  rule_id: number;
  lot_id: number;
  vehicle_type: VehicleType;
  base_rate_per_hour: number;
  overstay_penalty_per_hour: number;
}

export interface PeakMultiplier {
  multiplier_id: number;
  lot_id: number;
  day_of_week: number;
  hour_of_day: number;
  multiplier: number;
}

export interface ParkingSlot {
  slot_id: number;
  lot_id: number;
  slot_number: string;
  slot_type: VehicleType;
  status: SlotStatus;
}

export interface ParkingLotSummary {
  lot_id: number;
  name: string;
  address: string;
  city: string;
  latitude: number;
  longitude: number;
  open_time: string;
  close_time: string;
  grace_period_minutes: number;
  is_active: boolean;
  total_slots: number;
  available_slots: number;
  reserved_slots: number;
  occupied_slots: number;
  maintenance_slots: number;
  occupancy_pct: number;
  min_hourly_rate: number | null;
  avg_rating: number | null;
  review_count: number;
}

export interface ParkingLotDetail extends ParkingLotSummary {
  slots: ParkingSlot[];
  pricing_rules: PricingRule[];
}

export interface SlotWindowAvailability {
  slot_id: number;
  lot_id: number;
  slot_number: string;
  slot_type: VehicleType;
  current_status: SlotStatus;
  is_available_for_window: boolean;
  quoted_amount: number | null;
}

export interface LotAvailabilityResponse {
  lot_id: number;
  start_time: string;
  end_time: string;
  vehicle_type: VehicleType | null;
  available_count: number;
  slots: SlotWindowAvailability[];
}

export interface QuoteSlice {
  slice_start: string;
  slice_end: string;
  day_of_week: number;
  day_name: string;
  hour_of_day: number;
  minutes: number;
  base_rate_per_hour: number;
  multiplier: number;
  is_peak: boolean;
  slice_amount: number;
}

export interface QuoteBreakdownResponse {
  lot_id: number;
  vehicle_type: VehicleType;
  start_time: string;
  end_time: string;
  base_rate_per_hour: number;
  overstay_penalty_per_hour: number;
  total_quote: number;
  slices: QuoteSlice[];
}

export interface PaymentRecord {
  payment_id: number;
  reservation_id: number;
  amount: number;
  payment_type: 'BOOKING' | 'CHECKOUT' | 'PENALTY' | 'REFUND';
  method: PaymentMethod;
  status: 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED';
  transaction_ref: string | null;
  paid_at: string | null;
  created_at: string;
}

export interface ReviewRecord {
  review_id: number;
  reservation_id: number;
  rating: number;
  comment: string | null;
  created_at: string;
  user_id?: number;
  reviewer_name?: string;
  vehicle_type?: VehicleType;
  slot_number?: string;
  lot_id?: number;
}

export interface ReservationRecord {
  reservation_id: number;
  vehicle_id: number;
  slot_id: number;
  series_id: number | null;
  start_time: string;
  end_time: string;
  status: ReservationStatus;
  quoted_amount: number;
  qr_token: string;
  checked_in_at: string | null;
  checked_out_at: string | null;
  created_at: string;
  user_id?: number;
  user_name?: string;
  user_email?: string;
  plate_number: string;
  vehicle_type: VehicleType;
  slot_number: string;
  slot_type: VehicleType;
  slot_status?: SlotStatus;
  lot_id: number;
  lot_name: string;
  lot_address?: string;
  lot_city: string;
  total_paid?: number;
  has_review?: boolean;
  qr_code_data_url?: string;
  payments?: PaymentRecord[];
  review?: ReviewRecord | null;
}

export interface QrScanResponse {
  action_performed: 'CHECK_IN' | 'CHECK_OUT';
  reservation: ReservationRecord;
  billing?: {
    base_amount: number;
    penalty_amount: number;
    total_amount: number;
  };
}

export interface RecurringSeriesRecord {
  series_id: number;
  vehicle_id: number;
  slot_id: number;
  day_of_week: number;
  start_clock: string;
  duration_minutes: number;
  valid_from: string;
  valid_to: string;
  is_active: boolean;
  created_at: string;
  plate_number?: string;
  vehicle_type?: VehicleType;
  slot_number?: string;
  lot_id?: number;
  lot_name?: string;
  occurrence_count?: number;
  active_occurrences?: number;
}

export interface ReceiptData {
  receipt_number: string;
  reservation_id: number;
  status: ReservationStatus;
  customer: {
    user_id: number;
    full_name: string;
    email: string;
  };
  vehicle: {
    vehicle_id: number;
    plate_number: string;
    vehicle_type: VehicleType;
  };
  lot: {
    lot_id: number;
    name: string;
    address: string;
    city: string;
    slot_id: number;
    slot_number: string;
  };
  schedule: {
    start_time: string;
    end_time: string;
    checked_in_at: string | null;
    checked_out_at: string | null;
  };
  billing: {
    quoted_amount: number;
    penalty_paid: number;
    total_paid: number;
    refunded_amount: number;
  };
  payments: PaymentRecord[];
}

export interface FavoriteLot {
  user_id: number;
  lot_id: number;
  favorited_at: string;
  name: string;
  address: string;
  city: string;
  latitude: number;
  longitude: number;
  total_slots: number;
  available_slots: number;
  occupancy_pct: number;
}

export interface WaitlistEntry {
  waitlist_id: number;
  vehicle_id: number;
  lot_id: number;
  desired_start: string;
  desired_end: string;
  status: WaitlistStatus;
  created_at: string;
  plate_number: string;
  vehicle_type: VehicleType;
  lot_name: string;
  lot_city?: string;
}

export interface NotificationItem {
  notification_id: number;
  user_id: number;
  reservation_id: number | null;
  type: string;
  message: string;
  is_read: boolean;
  email_sent: boolean;
  created_at: string;
}

export interface AnalyticsOverviewResponse {
  kpis: {
    total_reservations: number;
    completed_count: number;
    confirmed_count: number;
    checked_in_count: number;
    cancelled_count: number;
    expired_count: number;
    no_show_count: number;
    avg_duration_minutes: number | null;
    completion_rate_pct: number;
    cancellation_rate_pct: number;
    no_show_expired_rate_pct: number;
    unfulfilled_rate_pct: number;
    total_net_revenue: number;
    total_booking_revenue: number;
    total_checkout_revenue: number;
    total_penalty_revenue: number;
    total_refunded_amount: number;
  };
  lot_utilization: Array<{
    lot_id: number;
    lot_name: string;
    city: string;
    total_slots: number;
    available_slots: number;
    reserved_slots: number;
    occupied_slots: number;
    live_occupancy_pct: number;
    total_bookings: number;
    completed_bookings: number;
    cancelled_bookings: number;
    missed_bookings: number;
    booked_slot_hours: number;
    avg_duration_minutes: number;
    slot_utilization_rate_pct: number;
    net_revenue: number;
  }>;
  revenue: {
    by_day: Array<{
      revenue_date: string;
      booking_revenue: number;
      checkout_revenue: number;
      penalty_revenue: number;
      refunded_amount: number;
      net_revenue: number;
      payment_count: number;
      cumulative_revenue: number;
    }>;
    by_week: Array<{
      year_week: number;
      week_start: string;
      week_end: string;
      booking_revenue: number;
      checkout_revenue: number;
      penalty_revenue: number;
      net_revenue: number;
    }>;
    by_month: Array<{
      year_month: string;
      booking_revenue: number;
      checkout_revenue: number;
      penalty_revenue: number;
      refunded_amount: number;
      net_revenue: number;
      payment_count: number;
    }>;
  };
  peak_hours: {
    by_lot: Array<{
      lot_id: number;
      lot_name: string;
      hour_of_day: number;
      booking_count: number;
      hour_rank: number;
    }>;
    global: Array<{
      hour_of_day: number;
      booking_count: number;
      quoted_revenue: number;
      demand_rank: number;
    }>;
  };
  busiest_days: Array<{
    day_of_week: number;
    day_name: string;
    booking_count: number;
    quoted_revenue: number;
    day_rank: number;
  }>;
  slot_usage: {
    most_used: Array<{
      slot_id: number;
      slot_number: string;
      slot_type: VehicleType;
      lot_id: number;
      lot_name: string;
      usage_count: number;
      total_booked_hours: number;
      most_used_rank: number;
      least_used_rank: number;
    }>;
    least_used: Array<{
      slot_id: number;
      slot_number: string;
      slot_type: VehicleType;
      lot_id: number;
      lot_name: string;
      usage_count: number;
      total_booked_hours: number;
      most_used_rank: number;
      least_used_rank: number;
    }>;
    all_slots: Array<{
      slot_id: number;
      slot_number: string;
      slot_type: VehicleType;
      lot_id: number;
      lot_name: string;
      usage_count: number;
      total_booked_hours: number;
      most_used_rank: number;
      least_used_rank: number;
    }>;
  };
  occupancy_heatmap: Array<{
    day_of_week: number;
    day_name: string;
    hour_of_day: number;
    booking_count: number;
  }>;
}
