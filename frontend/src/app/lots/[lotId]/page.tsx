'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  Radio,
  MapPin,
  Star,
  CheckCircle2,
  AlertCircle,
  ListChecks,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import {
  apiCreateReservation,
  apiCreateWaitlist,
  apiGetLotAvailability,
  apiGetLotDetail,
  apiGetLotReviews,
  apiGetVehicles,
  getLotStreamUrl,
} from '@/lib/api';
import {
  ParkingLotDetail,
  PaymentMethod,
  ReservationRecord,
  ReviewRecord,
  SlotWindowAvailability,
  Vehicle,
  VehicleType,
} from '@/lib/types';
import { SlotGrid } from '@/components/SlotGrid';
import { QrTicketModal } from '@/components/QrTicketModal';

export default function LotDetailPage({ params }: { params: { lotId: string } }) {
  const lotId = Number(params.lotId);
  const { user, token } = useAuth();

  const [lot, setLot] = useState<ParkingLotDetail | null>(null);
  const [reviews, setReviews] = useState<ReviewRecord[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [windowMap, setWindowMap] = useState<Record<number, SlotWindowAvailability>>({});

  const [startTime, setStartTime] = useState<string>('2030-05-06T08:00');
  const [endTime, setEndTime] = useState<string>('2030-05-06T10:00');
  const [filterType, setFilterType] = useState<VehicleType | 'ALL'>('ALL');
  const [selectedSlotId, setSelectedSlotId] = useState<number | null>(null);
  const [selectedVehicleId, setSelectedVehicleId] = useState<number | null>(null);
  const [payNow, setPayNow] = useState<boolean>(true);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('UPI');

  const [sseConnected, setSseConnected] = useState<boolean>(false);
  const [lastRealtimeReason, setLastRealtimeReason] = useState<string>('initial');
  const [loading, setLoading] = useState<boolean>(true);
  const [bookingBusy, setBookingBusy] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(
    null
  );
  const [createdTicket, setCreatedTicket] = useState<ReservationRecord | null>(null);

  const loadLotAndReviews = useCallback(async () => {
    setLoading(true);
    try {
      const [lotRes, revRes] = await Promise.all([
        apiGetLotDetail(lotId),
        apiGetLotReviews(lotId),
      ]);
      setLot(lotRes.lot);
      setReviews(revRes.reviews);
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.message || 'Failed to load parking lot' });
    } finally {
      setLoading(false);
    }
  }, [lotId]);

  const checkWindowAvailability = useCallback(async () => {
    if (!startTime || !endTime) return;
    try {
      const res = await apiGetLotAvailability(lotId, {
        start_time: startTime,
        end_time: endTime,
      });
      const map: Record<number, SlotWindowAvailability> = {};
      for (const s of res.slots) {
        map[s.slot_id] = s;
      }
      setWindowMap(map);
    } catch {
      // Ignore invalid temporary date input
    }
  }, [lotId, startTime, endTime]);

  useEffect(() => {
    loadLotAndReviews();
  }, [loadLotAndReviews]);

  useEffect(() => {
    checkWindowAvailability();
  }, [checkWindowAvailability]);

  useEffect(() => {
    if (!token) {
      setVehicles([]);
      return;
    }
    apiGetVehicles(token)
      .then((res) => {
        setVehicles(res.vehicles);
        if (res.vehicles.length > 0) {
          setSelectedVehicleId(res.vehicles[0].vehicle_id);
        }
      })
      .catch(() => {});
  }, [token]);

  // Real-time Server-Sent Events (SSE) subscription for live slot grid
  useEffect(() => {
    if (typeof window === 'undefined' || !lotId) return;

    const es = new EventSource(getLotStreamUrl(lotId));
    const applyStreamPayload = (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data);
        setSseConnected(true);
        setLastRealtimeReason(data.reason || 'live');
        setLot((prev) =>
          prev
            ? {
                ...prev,
                total_slots: data.occupancy.total_slots,
                available_slots: data.occupancy.available_slots,
                reserved_slots: data.occupancy.reserved_slots,
                occupied_slots: data.occupancy.occupied_slots,
                maintenance_slots: data.occupancy.maintenance_slots,
                occupancy_pct: data.occupancy.occupancy_pct,
                slots: data.slots,
              }
            : prev
        );
      } catch {
        // Ignore malformed frame
      }
    };

    es.addEventListener('snapshot', applyStreamPayload);
    es.addEventListener('slot_update', (ev) => {
      applyStreamPayload(ev as MessageEvent);
      checkWindowAvailability();
    });
    es.onerror = () => setSseConnected(false);

    return () => {
      es.close();
    };
  }, [lotId, checkWindowAvailability]);

  const selectedSlot = lot?.slots.find((s) => s.slot_id === selectedSlotId) ?? null;
  const selectedSlotWindow = selectedSlotId ? windowMap[selectedSlotId] : null;

  const handleBookSlot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !selectedSlotId || !selectedVehicleId) return;

    setBookingBusy(true);
    setFeedback(null);
    try {
      const res = await apiCreateReservation(token, {
        vehicle_id: selectedVehicleId,
        slot_id: selectedSlotId,
        start_time: startTime,
        end_time: endTime,
        pay_now: payNow,
        payment_method: paymentMethod,
      });
      setCreatedTicket(res.reservation);
      setFeedback({
        type: 'ok',
        text: `Reservation #${res.reservation.reservation_id} confirmed for Slot ${res.reservation.slot_number}!`,
      });
      await checkWindowAvailability();
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.message || 'Booking failed' });
    } finally {
      setBookingBusy(false);
    }
  };

  const handleJoinWaitlist = async () => {
    if (!token || !selectedVehicleId) return;
    setBookingBusy(true);
    setFeedback(null);
    try {
      const res = await apiCreateWaitlist(token, {
        vehicle_id: selectedVehicleId,
        lot_id: lotId,
        desired_start: startTime,
        desired_end: endTime,
      });
      setFeedback({
        type: 'ok',
        text: `Added to waitlist (#${res.waitlist_entry.waitlist_id}). You will be notified automatically when a matching slot frees up!`,
      });
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.message || 'Failed to join waitlist' });
    } finally {
      setBookingBusy(false);
    }
  };

  return (
    <div data-testid="lot-detail-page" className="space-y-8">
      {loading || !lot ? (
        <div className="border border-editorial-border bg-editorial-surface p-8 text-xs text-editorial-muted">
          Loading parking lot details &amp; live SSE slot grid...
        </div>
      ) : (
        <>
          {/* Editorial Lot Header Card */}
          <div className="border border-editorial-border bg-editorial-surface p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="border-b-2 border-editorial-cobalt pb-0.5 font-mono text-xs font-bold text-editorial-ink">
                    HUB #{lot.lot_id}
                  </span>
                  <span className="text-editorial-muted">|</span>
                  <span className="bg-editorial-lime px-2.5 py-0.5 font-mono text-xs font-bold text-editorial-ink">
                    <Radio className="mr-1 inline h-3 w-3" />
                    {sseConnected ? 'SSE LIVE GRID' : 'CONNECTING SSE...'}
                  </span>
                </div>
                <h1 className="mt-3 font-serif text-3xl font-bold text-editorial-ink">
                  {lot.name}
                </h1>
                <p className="mt-1 flex items-center gap-1 text-xs text-editorial-muted">
                  <MapPin className="h-3.5 w-3.5 text-editorial-vermilion" />
                  <span>
                    {lot.address}, {lot.city}
                  </span>
                </p>
              </div>

              <div className="grid grid-cols-3 gap-4 border-l border-editorial-border pl-6">
                <div>
                  <div className="text-[11px] text-editorial-muted">Free</div>
                  <div className="editorial-kpi-num mt-1 text-3xl text-editorial-ink">
                    {lot.available_slots}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-editorial-muted">Reserved</div>
                  <div className="editorial-kpi-num mt-1 text-3xl text-editorial-cobalt">
                    {lot.reserved_slots}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-editorial-muted">Occupied</div>
                  <div className="editorial-kpi-num mt-1 text-3xl text-editorial-vermilion">
                    {lot.occupied_slots}
                  </div>
                </div>
              </div>
            </div>

            {/* Pricing Rules Bar */}
            <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-editorial-border pt-4 text-xs">
              <span className="font-bold uppercase tracking-wider text-editorial-muted">
                Tariff Schedule:
              </span>
              {lot.pricing_rules.map((pr) => (
                <span
                  key={pr.rule_id}
                  className="border border-editorial-border bg-editorial-bg px-2.5 py-1 font-mono font-semibold text-editorial-ink"
                >
                  {pr.vehicle_type}: ₹{pr.base_rate_per_hour}/hr (Overstay: ₹
                  {pr.overstay_penalty_per_hour}/hr)
                </span>
              ))}
              <span className="ml-auto font-mono text-[11px] text-editorial-muted">
                Stream event: {lastRealtimeReason}
              </span>
            </div>
          </div>

          {feedback && (
            <div
              className={`flex items-center gap-2 border p-4 text-xs font-bold ${
                feedback.type === 'ok'
                  ? 'border-editorial-cobalt bg-editorial-cobalt/10 text-editorial-cobalt'
                  : 'border-editorial-vermilion bg-editorial-vermilion/10 text-editorial-vermilion'
              }`}
            >
              {feedback.type === 'ok' ? (
                <CheckCircle2 className="h-4 w-4 shrink-0" />
              ) : (
                <AlertCircle className="h-4 w-4 shrink-0" />
              )}
              <span>{feedback.text}</span>
            </div>
          )}

          {/* Main 2-Column Layout: Live Slot Grid + Booking Panel */}
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
            <div className="space-y-5 border border-editorial-border bg-editorial-surface p-6 lg:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-editorial-border pb-3">
                <h2 className="text-lg font-bold text-editorial-ink">
                  Select Time Window &amp; Parking Slot
                </h2>
                <div className="flex items-center gap-1.5">
                  {(['ALL', 'CAR', 'BIKE', 'SUV', 'EV'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setFilterType(t)}
                      className={`px-2.5 py-1 font-mono text-xs font-bold transition ${
                        filterType === t
                          ? 'bg-editorial-ink text-editorial-bg'
                          : 'bg-editorial-bg text-editorial-muted hover:text-editorial-ink'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 border border-editorial-border bg-editorial-bg p-3.5 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-editorial-muted">
                    Start Date &amp; Time
                  </label>
                  <input
                    type="datetime-local"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="mt-1 w-full border border-editorial-border bg-white px-3 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-editorial-muted">
                    End Date &amp; Time
                  </label>
                  <input
                    type="datetime-local"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="mt-1 w-full border border-editorial-border bg-white px-3 py-1.5 text-sm"
                  />
                </div>
              </div>

              <SlotGrid
                slots={lot.slots}
                windowAvailability={windowMap}
                selectedSlotId={selectedSlotId}
                filterType={filterType}
                onSelectSlot={(id) => {
                  setSelectedSlotId(id);
                  const clicked = lot.slots.find((s) => s.slot_id === id);
                  if (clicked) {
                    const matchingVeh = vehicles.find(
                      (v) => v.vehicle_type === clicked.slot_type
                    );
                    if (matchingVeh) {
                      setSelectedVehicleId(matchingVeh.vehicle_id);
                    }
                  }
                }}
              />
            </div>

            {/* Right Column: Reservation Checkout Card */}
            <div className="border border-editorial-border bg-editorial-surface p-6">
              <h2 className="font-serif text-xl font-bold text-editorial-ink">
                Complete Reservation
              </h2>
              <p className="mt-1 text-xs text-editorial-muted">
                Dynamic pricing is computed per hour slice via{' '}
                <code className="font-mono">get_dynamic_price</code>.
              </p>

              {!user ? (
                <div className="mt-6 border border-editorial-border bg-editorial-bg p-5 text-center">
                  <p className="text-xs text-editorial-muted">
                    Sign in to reserve a slot or join the waitlist.
                  </p>
                  <Link
                    href="/login"
                    className="mt-3 inline-block bg-editorial-vermilion px-4 py-2 text-xs font-bold uppercase text-white"
                  >
                    Sign In to Continue
                  </Link>
                </div>
              ) : (
                <form onSubmit={handleBookSlot} className="mt-5 space-y-4">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-editorial-muted">
                      Select Your Vehicle
                    </label>
                    {vehicles.length === 0 ? (
                      <div className="mt-1 border border-editorial-vermilion bg-editorial-vermilion/10 p-3 text-xs text-editorial-vermilion">
                        You have no vehicles registered yet.{' '}
                        <Link href="/vehicles" className="font-bold underline">
                          Add a vehicle first
                        </Link>
                        .
                      </div>
                    ) : (
                      <select
                        value={selectedVehicleId ?? ''}
                        onChange={(e) => setSelectedVehicleId(Number(e.target.value))}
                        className="mt-1 w-full border border-editorial-border bg-white px-3 py-2 text-sm font-bold"
                      >
                        {vehicles.map((v) => (
                          <option key={v.vehicle_id} value={v.vehicle_id}>
                            {v.plate_number} ({v.vehicle_type})
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  <div className="border border-editorial-border bg-editorial-bg p-3.5 text-xs space-y-2">
                    <div className="flex justify-between">
                      <span className="text-editorial-muted">Selected Slot</span>
                      <span className="font-mono font-bold text-editorial-ink">
                        {selectedSlot
                          ? `${selectedSlot.slot_number} (${selectedSlot.slot_type})`
                          : 'Click a slot on grid'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-editorial-muted">Dynamic Price Quote</span>
                      <span className="font-mono text-base font-extrabold text-editorial-vermilion">
                        {selectedSlotWindow?.quoted_amount !== undefined &&
                        selectedSlotWindow?.quoted_amount !== null
                          ? `₹${Number(selectedSlotWindow.quoted_amount).toFixed(2)}`
                          : '—'}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-2 pt-1">
                    <label className="flex items-center gap-2 text-xs font-semibold text-editorial-ink">
                      <input
                        type="checkbox"
                        checked={payNow}
                        onChange={(e) => setPayNow(e.target.checked)}
                        className="border-editorial-ink"
                      />
                      <span>Pay booking amount upfront (instant receipt)</span>
                    </label>

                    {payNow && (
                      <select
                        value={paymentMethod}
                        onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                        className="w-full border border-editorial-border bg-white px-3 py-2 text-xs font-bold"
                      >
                        <option value="UPI">UPI</option>
                        <option value="CARD">CARD</option>
                        <option value="WALLET">WALLET</option>
                        <option value="CASH">CASH</option>
                      </select>
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={bookingBusy || !selectedSlotId || !selectedVehicleId}
                    data-testid="confirm-booking-button"
                    className="w-full bg-editorial-vermilion py-3 text-xs font-bold uppercase tracking-wider text-white hover:opacity-90 disabled:opacity-50"
                  >
                    {bookingBusy ? 'Processing...' : 'Confirm Reservation'}
                  </button>

                  <div className="border-t border-editorial-border pt-3">
                    <p className="text-[11px] text-editorial-muted">
                      Preferred slot busy for this window? Join the automatic waitlist:
                    </p>
                    <button
                      type="button"
                      disabled={bookingBusy || !selectedVehicleId}
                      onClick={handleJoinWaitlist}
                      className="mt-2 inline-flex w-full items-center justify-center gap-1.5 border border-editorial-cobalt bg-editorial-cobalt/10 py-2 text-xs font-bold text-editorial-cobalt hover:bg-editorial-cobalt hover:text-white disabled:opacity-50"
                    >
                      <ListChecks className="h-4 w-4" />
                      <span>Join Waitlist for This Window</span>
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>

          {/* Reviews Section */}
          <div className="border border-editorial-border bg-editorial-surface p-6">
            <div className="flex items-center justify-between border-b border-editorial-border pb-3">
              <h2 className="text-lg font-bold text-editorial-ink">
                Driver Ratings &amp; Reviews ({reviews.length})
              </h2>
              <span className="inline-flex items-center gap-1 font-mono text-sm font-bold text-editorial-vermilion">
                <Star className="h-4 w-4 fill-editorial-vermilion" />
                {lot.avg_rating ? Number(lot.avg_rating).toFixed(2) : 'No ratings yet'}
              </span>
            </div>

            {reviews.length === 0 ? (
              <p className="mt-4 text-xs text-editorial-muted">
                No reviews yet for this lot. Complete a reservation to leave the first review!
              </p>
            ) : (
              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                {reviews.map((rv) => (
                  <div
                    key={rv.review_id}
                    className="border border-editorial-border bg-editorial-bg p-3.5 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-editorial-ink">
                        {rv.reviewer_name || 'Verified Driver'}
                      </span>
                      <span className="font-mono font-bold text-editorial-vermilion">
                        {rv.rating} / 5 ★
                      </span>
                    </div>
                    {rv.comment && <p className="mt-1.5 text-editorial-muted">{rv.comment}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      <QrTicketModal
        reservation={createdTicket}
        onClose={() => setCreatedTicket(null)}
      />
    </div>
  );
}
