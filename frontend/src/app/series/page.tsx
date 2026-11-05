'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Repeat, Sparkles, Trash2, Calendar, CheckCircle2, AlertCircle } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import {
  apiCancelSeries,
  apiCreateSeries,
  apiGetLotDetail,
  apiGetLots,
  apiGetQuoteBreakdown,
  apiGetSeries,
  apiGetVehicles,
} from '@/lib/api';
import {
  ParkingLotDetail,
  ParkingLotSummary,
  QuoteBreakdownResponse,
  RecurringSeriesRecord,
  Vehicle,
} from '@/lib/types';

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function RecurringSeriesPage() {
  const { user, token } = useAuth();
  const [lots, setLots] = useState<ParkingLotSummary[]>([]);
  const [selectedLot, setSelectedLot] = useState<ParkingLotDetail | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [seriesList, setSeriesList] = useState<RecurringSeriesRecord[]>([]);

  const [lotId, setLotId] = useState<number>(1);
  const [slotId, setSlotId] = useState<number>(3);
  const [vehicleId, setVehicleId] = useState<number>(1);
  const [dayOfWeek, setDayOfWeek] = useState<number>(0);
  const [startClock, setStartClock] = useState<string>('08:00');
  const [durationMinutes, setDurationMinutes] = useState<number>(120);
  const [validFrom, setValidFrom] = useState<string>('2030-07-01');
  const [validTo, setValidTo] = useState<string>('2030-07-22');

  const [quoteBreakdown, setQuoteBreakdown] = useState<QuoteBreakdownResponse | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const loadInitialData = useCallback(async () => {
    try {
      const [lotsRes, lot1Res] = await Promise.all([apiGetLots(), apiGetLotDetail(lotId)]);
      setLots(lotsRes.lots);
      setSelectedLot(lot1Res.lot);
      if (lot1Res.lot.slots.length > 0) {
        setSlotId(lot1Res.lot.slots[0].slot_id);
      }
    } catch {
      // Ignore
    }
  }, [lotId]);

  const loadUserSeriesAndVehicles = useCallback(async () => {
    if (!token) return;
    try {
      const [vehRes, serRes] = await Promise.all([
        apiGetVehicles(token),
        apiGetSeries(token),
      ]);
      setVehicles(vehRes.vehicles);
      setSeriesList(serRes.series);
      if (vehRes.vehicles.length > 0) {
        setVehicleId(vehRes.vehicles[0].vehicle_id);
      }
    } catch {
      // Ignore
    }
  }, [token]);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  useEffect(() => {
    loadUserSeriesAndVehicles();
  }, [loadUserSeriesAndVehicles]);

  // Compute live dynamic price breakdown for a representative occurrence
  useEffect(() => {
    const selectedVeh = vehicles.find((v) => v.vehicle_id === vehicleId);
    const vType = selectedVeh?.vehicle_type || 'CAR';

    // Pick a known date in July 2030 matching dayOfWeek (2030-07-01 is Monday = 0)
    const dayNum = 1 + dayOfWeek;
    const sampleDate = `2030-07-${String(dayNum).padStart(2, '0')}`;
    const startDt = `${sampleDate} ${startClock}:00`;

    const [hh, mm] = startClock.split(':').map(Number);
    const startMs = Date.UTC(2030, 6, dayNum, hh || 8, mm || 0, 0);
    const endMs = startMs + durationMinutes * 60_000;
    const ed = new Date(endMs);
    const endDt = `${ed.getUTCFullYear()}-${String(ed.getUTCMonth() + 1).padStart(
      2,
      '0'
    )}-${String(ed.getUTCDate()).padStart(2, '0')} ${String(ed.getUTCHours()).padStart(
      2,
      '0'
    )}:${String(ed.getUTCMinutes()).padStart(2, '0')}:00`;

    apiGetQuoteBreakdown(lotId, {
      start_time: startDt,
      end_time: endDt,
      vehicle_type: vType,
    })
      .then((res) => setQuoteBreakdown(res))
      .catch(() => {});
  }, [lotId, vehicleId, vehicles, dayOfWeek, startClock, durationMinutes]);

  const handleCreateSeries = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await apiCreateSeries(token, {
        vehicle_id: vehicleId,
        slot_id: slotId,
        day_of_week: dayOfWeek,
        start_clock: startClock,
        duration_minutes: durationMinutes,
        valid_from: validFrom,
        valid_to: validTo,
      });
      setFeedback({
        type: 'ok',
        text: `Recurring Series #${res.series.series_id} created! Booked ${res.reservations.length} weekly occurrences automatically.`,
      });
      await loadUserSeriesAndVehicles();
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.message || 'Failed to create recurring series' });
    } finally {
      setBusy(false);
    }
  };

  const handleCancelSeries = async (seriesId: number) => {
    if (!token) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await apiCancelSeries(token, seriesId);
      setFeedback({
        type: 'ok',
        text: `Series #${seriesId} deactivated (${res.cancelled_occurrences} future occurrences cancelled).`,
      });
      await loadUserSeriesAndVehicles();
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.message || 'Failed to cancel series' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="recurring-series-page" className="space-y-8">
      {/* Editorial Header */}
      <div className="border-b border-editorial-border pb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 text-xs font-semibold text-editorial-muted">
            <span className="border-b-2 border-editorial-cobalt pb-0.5 font-bold text-editorial-ink">
              Commuter Automation · Recurring Series
            </span>
            <span>|</span>
            <span>Hour-Slice Dynamic Pricing Function: get_dynamic_price</span>
          </div>
          <span className="bg-editorial-lime px-2.5 py-1 font-mono text-xs font-bold text-editorial-ink">
            ATOMIC BATCH BOOKING
          </span>
        </div>

        <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-editorial-ink sm:text-4xl">
          Lock your weekly commuter slot—with{' '}
          <span className="text-editorial-vermilion">transparent</span> peak-hour pricing
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-editorial-muted">
          Define a weekday schedule once. ParkPulse verifies every matching date in your range
          and books all occurrences atomically via <code className="font-mono">book_slot</code>.
        </p>
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

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* Left Column: Recurring Series Builder */}
        <div className="border border-editorial-border bg-editorial-surface p-6">
          <div className="flex items-center gap-2">
            <Repeat className="h-5 w-5 text-editorial-vermilion" />
            <h2 className="text-lg font-bold text-editorial-ink">
              Create Weekly Recurring Series
            </h2>
          </div>

          {!user ? (
            <div className="mt-6 border border-editorial-border bg-editorial-bg p-6 text-center">
              <p className="text-xs text-editorial-muted">
                Sign in to create recurring commuter reservations.
              </p>
              <Link
                href="/login"
                className="mt-3 inline-block bg-editorial-vermilion px-4 py-2 text-xs font-bold uppercase text-white"
              >
                Sign In
              </Link>
            </div>
          ) : (
            <form onSubmit={handleCreateSeries} className="mt-5 space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-editorial-muted">
                    Parking Lot
                  </label>
                  <select
                    value={lotId}
                    onChange={(e) => setLotId(Number(e.target.value))}
                    className="mt-1 w-full border border-editorial-border bg-white px-3 py-2 text-xs font-bold"
                  >
                    {lots.map((l) => (
                      <option key={l.lot_id} value={l.lot_id}>
                        #{l.lot_id} · {l.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-editorial-muted">
                    Your Vehicle
                  </label>
                  <select
                    value={vehicleId}
                    onChange={(e) => {
                      const nextVehId = Number(e.target.value);
                      setVehicleId(nextVehId);
                      const veh = vehicles.find((v) => v.vehicle_id === nextVehId);
                      if (veh && selectedLot) {
                        const compat = selectedLot.slots.find(
                          (s) => s.slot_type === veh.vehicle_type
                        );
                        if (compat) setSlotId(compat.slot_id);
                      }
                    }}
                    className="mt-1 w-full border border-editorial-border bg-white px-3 py-2 text-xs font-bold"
                  >
                    {vehicles.map((v) => (
                      <option key={v.vehicle_id} value={v.vehicle_id}>
                        {v.plate_number} ({v.vehicle_type})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="block text-xs font-semibold text-editorial-muted">
                    Target Slot
                  </label>
                  <select
                    value={slotId}
                    onChange={(e) => setSlotId(Number(e.target.value))}
                    className="mt-1 w-full border border-editorial-border bg-white px-3 py-2 text-xs font-bold"
                  >
                    {(selectedLot?.slots ?? []).map((s) => (
                      <option key={s.slot_id} value={s.slot_id}>
                        Slot {s.slot_number} ({s.slot_type})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-editorial-muted">
                    Day of Week
                  </label>
                  <select
                    value={dayOfWeek}
                    onChange={(e) => setDayOfWeek(Number(e.target.value))}
                    className="mt-1 w-full border border-editorial-border bg-white px-3 py-2 text-xs font-bold"
                  >
                    {WEEKDAY_LABELS.map((d, idx) => (
                      <option key={idx} value={idx}>
                        {d} (WEEKDAY={idx})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-editorial-muted">
                    Start Clock &amp; Duration
                  </label>
                  <div className="mt-1 flex gap-1">
                    <input
                      type="time"
                      value={startClock}
                      onChange={(e) => setStartClock(e.target.value)}
                      className="w-1/2 border border-editorial-border bg-white px-2 py-1.5 text-xs"
                    />
                    <select
                      value={durationMinutes}
                      onChange={(e) => setDurationMinutes(Number(e.target.value))}
                      className="w-1/2 border border-editorial-border bg-white px-2 py-1.5 text-xs font-bold"
                    >
                      <option value={60}>60m (1h)</option>
                      <option value={90}>90m (1.5h)</option>
                      <option value={120}>120m (2h)</option>
                      <option value={180}>180m (3h)</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-editorial-muted">
                    Valid From
                  </label>
                  <input
                    type="date"
                    required
                    value={validFrom}
                    onChange={(e) => setValidFrom(e.target.value)}
                    className="mt-1 w-full border border-editorial-border bg-white px-3 py-2 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-editorial-muted">
                    Valid To
                  </label>
                  <input
                    type="date"
                    required
                    value={validTo}
                    onChange={(e) => setValidTo(e.target.value)}
                    className="mt-1 w-full border border-editorial-border bg-white px-3 py-2 text-xs"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={busy}
                data-testid="create-series-button"
                className="w-full bg-editorial-vermilion py-3 text-xs font-bold uppercase tracking-wider text-white hover:opacity-90 disabled:opacity-50"
              >
                {busy ? 'Booking Occurrences...' : 'Create Recurring Series & Book All Dates'}
              </button>
            </form>
          )}
        </div>

        {/* Right Column: Live Dynamic Price Hour-Slice Breakdown */}
        <div
          data-testid="dynamic-price-breakdown-card"
          className="flex flex-col justify-between border border-editorial-border bg-editorial-surface p-6"
        >
          <div>
            <div className="flex items-center justify-between border-b border-editorial-border pb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-editorial-cobalt" />
                <h2 className="text-lg font-bold text-editorial-ink">
                  Dynamic Price Quote Breakdown
                </h2>
              </div>
              <span className="font-mono text-xs font-bold text-editorial-vermilion">
                SQL: get_dynamic_price()
              </span>
            </div>

            {quoteBreakdown ? (
              <div className="mt-5 space-y-5">
                <div className="grid grid-cols-3 gap-4 border-b border-editorial-border pb-4">
                  <div>
                    <div className="text-xs text-editorial-muted">Base rate · /hr</div>
                    <div className="editorial-kpi-num mt-1 text-3xl text-editorial-ink">
                      ₹{quoteBreakdown.base_rate_per_hour}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-editorial-muted">Overstay · /hr</div>
                    <div className="editorial-kpi-num mt-1 text-3xl text-editorial-vermilion">
                      ₹{quoteBreakdown.overstay_penalty_per_hour}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-editorial-muted">Per-occurrence quote</div>
                    <div className="editorial-kpi-num mt-1 text-3xl text-editorial-cobalt">
                      ₹{Number(quoteBreakdown.total_quote).toFixed(2)}
                    </div>
                  </div>
                </div>

                <div>
                  <div className="text-xs font-bold uppercase tracking-wider text-editorial-muted">
                    Hour-by-Hour Multiplier Slices ({quoteBreakdown.slices.length})
                  </div>
                  <div className="mt-2 space-y-2">
                    {quoteBreakdown.slices.map((sl, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between border border-editorial-border bg-editorial-bg px-3.5 py-2.5 text-xs"
                      >
                        <div>
                          <div className="font-bold text-editorial-ink">
                            {sl.day_name} · Hour {sl.hour_of_day}:00 ({sl.minutes} mins)
                          </div>
                          <div className="font-mono text-[11px] text-editorial-muted">
                            {sl.slice_start.slice(11, 16)} → {sl.slice_end.slice(11, 16)}
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          <span
                            className={`px-2 py-0.5 font-mono text-xs font-bold ${
                              sl.is_peak
                                ? 'bg-editorial-vermilion text-white'
                                : 'bg-editorial-ink text-editorial-bg'
                            }`}
                          >
                            {sl.multiplier.toFixed(2)}x {sl.is_peak ? 'PEAK' : 'BASE'}
                          </span>
                          <span className="font-mono text-sm font-bold text-editorial-ink">
                            ₹{sl.slice_amount.toFixed(2)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <p className="py-10 text-center text-xs text-editorial-muted">
                Calculating dynamic price slices...
              </p>
            )}
          </div>

          <div className="mt-6 bg-editorial-ink p-4 text-xs text-editorial-bg">
            <strong>How it works:</strong> Bookings crossing hour boundaries are sliced per hour
            and multiplied by <code className="text-editorial-lime">peak_multipliers</code>.
          </div>
        </div>
      </div>

      {/* Existing Recurring Series List (Slide 4 Action Plan Table Style) */}
      <div className="border border-editorial-border bg-editorial-surface p-6">
        <div className="flex items-center gap-2 border-b border-editorial-border pb-3">
          <Calendar className="h-5 w-5 text-editorial-ink" />
          <h2 className="text-lg font-bold text-editorial-ink">
            Your Recurring Reservation Series ({seriesList.length})
          </h2>
        </div>

        {seriesList.length === 0 ? (
          <p className="py-8 text-center text-xs text-editorial-muted">
            No recurring reservation series created yet.
          </p>
        ) : (
          <div className="divide-y divide-editorial-border">
            {seriesList.map((s) => (
              <div
                key={s.series_id}
                data-testid={`series-row-${s.series_id}`}
                className="flex flex-wrap items-center justify-between gap-4 py-4"
              >
                <div className="flex items-center gap-4">
                  <div
                    className={`editorial-stamp ${
                      s.is_active
                        ? 'border-editorial-cobalt text-editorial-cobalt'
                        : 'border-editorial-muted text-editorial-muted'
                    }`}
                  >
                    {WEEKDAY_LABELS[s.day_of_week] ?? 'DAY'}
                  </div>

                  <div>
                    <div className="text-base font-bold text-editorial-ink">
                      Series #{s.series_id} · {s.lot_name} (Slot {s.slot_number})
                    </div>
                    <div className="text-xs text-editorial-muted">
                      Vehicle: <strong>{s.plate_number}</strong> ({s.vehicle_type}) · Start:{' '}
                      {s.start_clock} ({s.duration_minutes} mins) · Range: {s.valid_from} →{' '}
                      {s.valid_to}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="text-right font-mono text-xs">
                    <div className="font-bold text-editorial-ink">
                      {s.active_occurrences} / {s.occurrence_count} Active
                    </div>
                    <div
                      className={
                        s.is_active ? 'text-editorial-cobalt' : 'text-editorial-vermilion'
                      }
                    >
                      {s.is_active ? 'ACTIVE SERIES' : 'DEACTIVATED'}
                    </div>
                  </div>

                  {s.is_active && (
                    <button
                      type="button"
                      onClick={() => handleCancelSeries(s.series_id)}
                      className="inline-flex items-center gap-1 border border-editorial-vermilion bg-editorial-vermilion/10 px-3 py-1.5 text-xs font-bold text-editorial-vermilion hover:bg-editorial-vermilion hover:text-white"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>Cancel Series</span>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
