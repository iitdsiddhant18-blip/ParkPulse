'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from 'recharts';
import {
  BarChart3,
  Building2,
  CalendarClock,
  Database,
  Download,
  FileSpreadsheet,
  Flame,
  IndianRupee,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Users,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import {
  apiAdminApplyDynamicPricing,
  apiAdminCreateLot,
  apiAdminCreateSlot,
  apiAdminDeleteLot,
  apiAdminDownloadReport,
  apiAdminExpireStale,
  apiAdminGetAnalyticsOverview,
  apiAdminGetReservations,
  apiAdminGetUsers,
  apiAdminResetDemoAnalytics,
  apiAdminSeedDemoAnalytics,
  apiAdminUpdateSlot,
  apiAdminUpdateUserStatus,
  apiAdminUpsertMultiplier,
  apiAdminUpsertPricing,
  apiCancelReservation,
  apiGetLotDetail,
  apiGetLots,
} from '@/lib/api';
import {
  AdminUserRecord,
  AnalyticsOverviewResponse,
  ParkingLotDetail,
  ParkingLotSummary,
  ReservationRecord,
  SlotStatus,
  VehicleType,
} from '@/lib/types';

type AdminTab = 'ANALYTICS' | 'LOTS' | 'PRICING' | 'RESERVATIONS' | 'USERS';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function AdminDashboardPage() {
  const { user, token } = useAuth();
  const [activeTab, setActiveTab] = useState<AdminTab>('ANALYTICS');
  const [analytics, setAnalytics] = useState<AnalyticsOverviewResponse | null>(null);
  const [lots, setLots] = useState<ParkingLotSummary[]>([]);
  const [selectedLot, setSelectedLot] = useState<ParkingLotDetail | null>(null);
  const [reservations, setReservations] = useState<ReservationRecord[]>([]);
  const [users, setUsers] = useState<AdminUserRecord[]>([]);
  const [revenueGranularity, setRevenueGranularity] = useState<'DAY' | 'WEEK' | 'MONTH'>('DAY');
  const [busy, setBusy] = useState<boolean>(false);
  const [banner, setBanner] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [newLotName, setNewLotName] = useState<string>('');
  const [newLotAddress, setNewLotAddress] = useState<string>('');
  const [newLotCity, setNewLotCity] = useState<string>('Bengaluru');
  const [newLotLat, setNewLotLat] = useState<string>('12.9716');
  const [newLotLng, setNewLotLng] = useState<string>('77.5946');

  const [newSlotNumber, setNewSlotNumber] = useState<string>('');
  const [newSlotType, setNewSlotType] = useState<VehicleType>('CAR');

  const [priceLotId, setPriceLotId] = useState<number>(1);
  const [priceVehicleType, setPriceVehicleType] = useState<VehicleType>('CAR');
  const [baseRate, setBaseRate] = useState<string>('40');
  const [penaltyRate, setPenaltyRate] = useState<string>('80');

  const [multDay, setMultDay] = useState<number>(0);
  const [multHour, setMultHour] = useState<number>(9);
  const [multValue, setMultValue] = useState<string>('1.50');

  const loadAllAdminData = useCallback(async () => {
    if (!token || user?.role !== 'ADMIN') return;
    setBusy(true);
    try {
      const [overviewRes, lotsRes, resvRes, usersRes, lot1Detail] = await Promise.all([
        apiAdminGetAnalyticsOverview(token),
        apiGetLots(),
        apiAdminGetReservations(token),
        apiAdminGetUsers(token),
        apiGetLotDetail(1),
      ]);
      setAnalytics(overviewRes);
      setLots(lotsRes.lots);
      setReservations(resvRes.reservations);
      setUsers(usersRes.users);
      setSelectedLot(lot1Detail.lot);
    } catch (err: any) {
      setBanner({ type: 'err', text: err?.message || 'Failed to load admin dashboard data' });
    } finally {
      setBusy(false);
    }
  }, [token, user]);

  useEffect(() => {
    loadAllAdminData();
  }, [loadAllAdminData]);

  const handleSeedDemo = async () => {
    if (!token) return;
    setBusy(true);
    setBanner(null);
    try {
      const res = await apiAdminSeedDemoAnalytics(token);
      setBanner({
        type: 'ok',
        text: `Loaded ${res.seeded_reservations} historical reservations, ${res.seeded_payments} payments, and ${res.seeded_reviews} reviews!`,
      });
      await loadAllAdminData();
    } catch (err: any) {
      setBanner({ type: 'err', text: err?.message || 'Failed to seed demo data' });
    } finally {
      setBusy(false);
    }
  };

  const handleResetDemo = async () => {
    if (!token) return;
    setBusy(true);
    setBanner(null);
    try {
      await apiAdminResetDemoAnalytics(token);
      setBanner({ type: 'ok', text: 'Historical demo dataset cleared and multipliers restored.' });
      await loadAllAdminData();
    } catch (err: any) {
      setBanner({ type: 'err', text: err?.message || 'Failed to reset demo data' });
    } finally {
      setBusy(false);
    }
  };

  const handleApplyDynamicPricing = async () => {
    if (!token) return;
    setBusy(true);
    setBanner(null);
    try {
      const res = await apiAdminApplyDynamicPricing(token);
      setBanner({
        type: 'ok',
        text: `Dynamic pricing feedback applied! Adjusted ${res.updated_buckets} peak-hour multiplier buckets based on SQL demand rankings.`,
      });
      await loadAllAdminData();
    } catch (err: any) {
      setBanner({ type: 'err', text: err?.message || 'Dynamic pricing job failed' });
    } finally {
      setBusy(false);
    }
  };

  const handleExportReport = async (format: 'csv' | 'pdf') => {
    if (!token) return;
    try {
      const { buffer, contentType } = await apiAdminDownloadReport(token, format);
      const blob = new Blob([buffer], { type: contentType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `parkpulse-analytics-report.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setBanner({ type: 'err', text: err?.message || `Failed to export ${format.toUpperCase()}` });
    }
  };

  const handleCreateLot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    try {
      await apiAdminCreateLot(token, {
        name: newLotName,
        address: newLotAddress,
        city: newLotCity,
        latitude: Number(newLotLat),
        longitude: Number(newLotLng),
      });
      setNewLotName('');
      setNewLotAddress('');
      setBanner({ type: 'ok', text: 'New parking lot created.' });
      await loadAllAdminData();
    } catch (err: any) {
      setBanner({ type: 'err', text: err?.message || 'Failed to create lot' });
    }
  };

  const handleDeleteLot = async (lotId: number) => {
    if (!token) return;
    try {
      await apiAdminDeleteLot(token, lotId);
      setBanner({ type: 'ok', text: `Deleted lot #${lotId}` });
      await loadAllAdminData();
    } catch (err: any) {
      setBanner({ type: 'err', text: err?.message || 'Cannot delete lot' });
    }
  };

  const handleAddSlot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !selectedLot) return;
    try {
      await apiAdminCreateSlot(token, selectedLot.lot_id, {
        slot_number: newSlotNumber,
        slot_type: newSlotType,
      });
      setNewSlotNumber('');
      const refreshed = await apiGetLotDetail(selectedLot.lot_id);
      setSelectedLot(refreshed.lot);
      setBanner({ type: 'ok', text: `Slot ${newSlotNumber} added to ${selectedLot.name}` });
    } catch (err: any) {
      setBanner({ type: 'err', text: err?.message || 'Failed to add slot' });
    }
  };

  const handleToggleSlotMaintenance = async (slotId: number, currentStatus: SlotStatus) => {
    if (!token || !selectedLot) return;
    const nextStatus: SlotStatus =
      currentStatus === 'MAINTENANCE' ? 'AVAILABLE' : 'MAINTENANCE';
    try {
      await apiAdminUpdateSlot(token, selectedLot.lot_id, slotId, { status: nextStatus });
      const refreshed = await apiGetLotDetail(selectedLot.lot_id);
      setSelectedLot(refreshed.lot);
    } catch (err: any) {
      setBanner({ type: 'err', text: err?.message || 'Failed to update slot status' });
    }
  };

  const handleSavePricing = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    try {
      await apiAdminUpsertPricing(token, priceLotId, {
        vehicle_type: priceVehicleType,
        base_rate_per_hour: Number(baseRate),
        overstay_penalty_per_hour: Number(penaltyRate),
      });
      setBanner({
        type: 'ok',
        text: `Updated ${priceVehicleType} pricing for Lot #${priceLotId}`,
      });
      await loadAllAdminData();
    } catch (err: any) {
      setBanner({ type: 'err', text: err?.message || 'Failed to update pricing' });
    }
  };

  const handleSaveMultiplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    try {
      await apiAdminUpsertMultiplier(token, priceLotId, {
        day_of_week: multDay,
        hour_of_day: multHour,
        multiplier: Number(multValue),
      });
      setBanner({
        type: 'ok',
        text: `Updated peak multiplier (${multValue}x) for Lot #${priceLotId} on ${DAY_NAMES[multDay]} ${multHour}:00`,
      });
    } catch (err: any) {
      setBanner({ type: 'err', text: err?.message || 'Failed to update peak multiplier' });
    }
  };

  const heatmapMatrix: Record<string, number> = {};
  for (const cell of analytics?.occupancy_heatmap ?? []) {
    heatmapMatrix[`${cell.day_of_week}-${cell.hour_of_day}`] = Number(cell.booking_count);
  }

  return (
    <div data-testid="admin-dashboard-page" className="space-y-8">
      {/* Editorial Top Header & Action Bar */}
      <div className="border-b border-editorial-border pb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 text-xs font-semibold text-editorial-muted">
            <span className="border-b-2 border-editorial-cobalt pb-0.5 font-bold text-editorial-ink">
              Executive Operations · DBMS Analytics
            </span>
            <span>|</span>
            <span>CTEs · Window Functions · Dynamic Pricing Feedback</span>
          </div>
          <span className="bg-editorial-lime px-2.5 py-1 font-mono text-xs font-bold text-editorial-ink">
            ADMIN CONTROL CENTER
          </span>
        </div>

        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-editorial-ink sm:text-4xl">
              Admin Control Center &amp;{' '}
              <span className="text-editorial-vermilion">DBMS Analytics</span>
            </h1>
            <p className="mt-1 text-xs text-editorial-muted">
              Real SQL window functions (RANK, DENSE_RANK, SUM OVER), 7×24 occupancy heatmap, and
              CSV/PDF reporting.
            </p>
          </div>

          {user?.role === 'ADMIN' && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={handleSeedDemo}
                data-testid="seed-demo-button"
                className="inline-flex items-center gap-1.5 bg-editorial-ink px-3.5 py-2 text-xs font-bold uppercase text-editorial-bg hover:bg-editorial-vermilion disabled:opacity-50"
              >
                <Database className="h-3.5 w-3.5" />
                <span>Load Historical Demo Data</span>
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={handleApplyDynamicPricing}
                data-testid="apply-dynamic-pricing-button"
                className="inline-flex items-center gap-1.5 bg-editorial-vermilion px-3.5 py-2 text-xs font-bold uppercase text-white hover:opacity-90 disabled:opacity-50"
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>Run Dynamic Pricing Feedback</span>
              </button>
              <button
                type="button"
                onClick={() => handleExportReport('csv')}
                data-testid="export-csv-button"
                className="inline-flex items-center gap-1.5 border border-editorial-ink bg-editorial-surface px-3 py-2 text-xs font-bold text-editorial-ink"
              >
                <FileSpreadsheet className="h-3.5 w-3.5 text-editorial-cobalt" />
                <span>Export CSV</span>
              </button>
              <button
                type="button"
                onClick={() => handleExportReport('pdf')}
                data-testid="export-pdf-button"
                className="inline-flex items-center gap-1.5 border border-editorial-ink bg-editorial-surface px-3 py-2 text-xs font-bold text-editorial-ink"
              >
                <Download className="h-3.5 w-3.5 text-editorial-vermilion" />
                <span>Export PDF</span>
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={handleResetDemo}
                className="inline-flex items-center gap-1 border border-editorial-border bg-editorial-surface px-3 py-2 text-xs font-semibold text-editorial-muted hover:text-editorial-ink"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Reset Demo</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {banner && (
        <div
          className={`border p-4 text-xs font-bold ${
            banner.type === 'ok'
              ? 'border-editorial-cobalt bg-editorial-cobalt/10 text-editorial-cobalt'
              : 'border-editorial-vermilion bg-editorial-vermilion/10 text-editorial-vermilion'
          }`}
        >
          {banner.text}
        </div>
      )}

      {!user || user.role !== 'ADMIN' ? (
        <div className="border-2 border-editorial-ink bg-editorial-surface p-10 text-center">
          <ShieldAlert className="mx-auto h-10 w-10 text-editorial-vermilion" />
          <h2 className="mt-2 font-serif text-xl font-bold text-editorial-ink">
            Administrator Access Required
          </h2>
          <p className="mt-1 text-xs text-editorial-muted">
            Sign in with the seed Admin account (admin@parkpulse.dev / Admin@123) to view the
            analytics dashboard and manage parking lots.
          </p>
          <Link
            href="/login"
            className="mt-4 inline-block bg-editorial-vermilion px-5 py-2.5 text-xs font-bold uppercase text-white"
          >
            Go to Sign In
          </Link>
        </div>
      ) : (
        <>
          {/* Admin Sub-Navigation Tabs */}
          <div className="flex flex-wrap gap-2 border-b border-editorial-border pb-3">
            {[
              { id: 'ANALYTICS', label: '1. Analytics & Heatmap', icon: BarChart3 },
              { id: 'LOTS', label: '2. Lots & Slots', icon: Building2 },
              { id: 'PRICING', label: '3. Pricing & Multipliers', icon: IndianRupee },
              { id: 'RESERVATIONS', label: '4. All Reservations', icon: CalendarClock },
              { id: 'USERS', label: '5. Users & Roles', icon: Users },
            ].map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActiveTab(t.id as AdminTab)}
                  className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold uppercase tracking-wider transition ${
                    activeTab === t.id
                      ? 'bg-editorial-ink text-editorial-bg'
                      : 'border border-editorial-border bg-editorial-surface text-editorial-muted hover:text-editorial-ink'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span>{t.label}</span>
                </button>
              );
            })}
          </div>

          {/* TAB 1: ANALYTICS & HEATMAP */}
          {activeTab === 'ANALYTICS' && analytics && (
            <div data-testid="analytics-section" className="space-y-8">
              {/* Slide 3 Style Oversized KPI Numerals */}
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
                <div className="border border-editorial-border bg-editorial-surface p-5">
                  <div className="text-xs text-editorial-muted">Revenue · net total</div>
                  <div className="editorial-kpi-num mt-2 text-4xl text-editorial-cobalt">
                    ₹{Number(analytics.kpis.total_net_revenue).toFixed(0)}
                  </div>
                  <div className="mt-2 text-[11px] text-editorial-muted">
                    Penalties: ₹{Number(analytics.kpis.total_penalty_revenue).toFixed(0)} ·
                    Refunded: ₹{Number(analytics.kpis.total_refunded_amount).toFixed(0)}
                  </div>
                </div>

                <div className="border border-editorial-border bg-editorial-surface p-5">
                  <div className="text-xs text-editorial-muted">
                    Volume · completed / total
                  </div>
                  <div className="editorial-kpi-num mt-2 text-4xl text-editorial-vermilion">
                    {analytics.kpis.completed_count}
                    <span className="text-2xl text-editorial-ink">
                      /{analytics.kpis.total_reservations}
                    </span>
                  </div>
                  <div className="mt-2 text-[11px] text-editorial-muted">
                    Completion rate: {analytics.kpis.completion_rate_pct}%
                  </div>
                </div>

                <div className="border border-editorial-border bg-editorial-surface p-5">
                  <div className="text-xs text-editorial-muted">
                    Stay duration · average
                  </div>
                  <div className="editorial-kpi-num mt-2 text-4xl text-editorial-ink">
                    {analytics.kpis.avg_duration_minutes ?? 0}
                    <span className="text-sm font-normal text-editorial-muted"> mins</span>
                  </div>
                  <div className="mt-2 text-[11px] text-editorial-muted">
                    Across all completed stays
                  </div>
                </div>

                <div className="border border-editorial-border bg-editorial-surface p-5">
                  <div className="text-xs text-editorial-muted">
                    Unfulfilled · cancel + no-show
                  </div>
                  <div className="editorial-kpi-num mt-2 text-4xl text-editorial-vermilion">
                    {analytics.kpis.unfulfilled_rate_pct}%
                  </div>
                  <div className="mt-2 text-[11px] text-editorial-muted">
                    Cancelled: {analytics.kpis.cancellation_rate_pct}% · Expired/No-Show:{' '}
                    {analytics.kpis.no_show_expired_rate_pct}%
                  </div>
                </div>
              </div>

              {/* Revenue Chart (Day / Week / Month) & Peak Hours Chart */}
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <div className="border border-editorial-border bg-editorial-surface p-5">
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-base font-bold text-editorial-ink">
                      Revenue Breakdown ({revenueGranularity})
                    </h3>
                    <div className="flex gap-1">
                      {(['DAY', 'WEEK', 'MONTH'] as const).map((g) => (
                        <button
                          key={g}
                          type="button"
                          onClick={() => setRevenueGranularity(g)}
                          className={`px-2.5 py-1 font-mono text-xs font-bold ${
                            revenueGranularity === g
                              ? 'bg-editorial-ink text-editorial-bg'
                              : 'bg-editorial-bg text-editorial-muted'
                          }`}
                        >
                          {g}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={
                          revenueGranularity === 'DAY'
                            ? analytics.revenue.by_day
                            : revenueGranularity === 'WEEK'
                              ? analytics.revenue.by_week
                              : analytics.revenue.by_month
                        }
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#DDD4C5" />
                        <XAxis
                          dataKey={
                            revenueGranularity === 'DAY'
                              ? 'revenue_date'
                              : revenueGranularity === 'WEEK'
                                ? 'week_start'
                                : 'year_month'
                          }
                          tick={{ fontSize: 11, fill: '#161514' }}
                        />
                        <YAxis tick={{ fontSize: 11, fill: '#161514' }} />
                        <Tooltip />
                        <Legend />
                        <Bar dataKey="net_revenue" name="Net Revenue (₹)" fill="#161514" />
                        <Bar dataKey="penalty_revenue" name="Overstay Penalty (₹)" fill="#EE5335" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Peak Hours Ranking Chart */}
                <div className="border border-editorial-border bg-editorial-surface p-5">
                  <h3 className="mb-4 text-base font-bold text-editorial-ink">
                    Peak Hours Ranking (Window Function RANK() OVER)
                  </h3>
                  <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={analytics.peak_hours.global}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#DDD4C5" />
                        <XAxis
                          dataKey="hour_of_day"
                          tickFormatter={(h) => `${h}:00`}
                          tick={{ fontSize: 11, fill: '#161514' }}
                        />
                        <YAxis tick={{ fontSize: 11, fill: '#161514' }} />
                        <Tooltip />
                        <Legend />
                        <Bar dataKey="booking_count" name="Bookings" fill="#2251E5" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              {/* Lot Utilization Table & Busiest Days Table */}
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                <div className="border border-editorial-border bg-editorial-surface p-5 lg:col-span-2">
                  <h3 className="text-base font-bold text-editorial-ink">
                    Utilization Rate, Duration &amp; Revenue per Lot
                  </h3>
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-editorial-border text-editorial-muted">
                          <th className="py-2">Lot</th>
                          <th className="py-2">Slots Used %</th>
                          <th className="py-2">Bookings</th>
                          <th className="py-2">Booked Hrs</th>
                          <th className="py-2">Avg Stay</th>
                          <th className="py-2">Net Revenue</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-editorial-border">
                        {analytics.lot_utilization.map((lu) => (
                          <tr key={lu.lot_id}>
                            <td className="py-2.5 font-bold text-editorial-ink">{lu.lot_name}</td>
                            <td className="py-2.5 font-mono font-bold text-editorial-cobalt">
                              {lu.slot_utilization_rate_pct}%
                            </td>
                            <td className="py-2.5 font-mono">
                              {lu.completed_bookings} / {lu.total_bookings}
                            </td>
                            <td className="py-2.5 font-mono">{lu.booked_slot_hours} hrs</td>
                            <td className="py-2.5 font-mono">{lu.avg_duration_minutes} mins</td>
                            <td className="py-2.5 font-mono font-bold text-editorial-vermilion">
                              ₹{Number(lu.net_revenue).toFixed(2)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="border border-editorial-border bg-editorial-surface p-5">
                  <h3 className="text-base font-bold text-editorial-ink">Busiest Days of Week</h3>
                  <ul className="mt-3 space-y-2 text-xs">
                    {analytics.busiest_days.map((d) => (
                      <li
                        key={d.day_of_week}
                        className="flex items-center justify-between border border-editorial-border bg-editorial-bg px-3 py-2"
                      >
                        <span>
                          <strong className="font-mono text-editorial-vermilion">
                            #{d.day_rank}
                          </strong>{' '}
                          {d.day_name}
                        </span>
                        <span className="font-mono font-bold text-editorial-ink">
                          {d.booking_count} stays (₹{Number(d.quoted_revenue).toFixed(0)})
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Most & Least Used Slots */}
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <div className="border border-editorial-border bg-editorial-surface p-5">
                  <h3 className="text-base font-bold text-editorial-ink">
                    Most Used Parking Slots (DENSE_RANK)
                  </h3>
                  <ul className="mt-3 space-y-2 text-xs">
                    {analytics.slot_usage.most_used.slice(0, 5).map((s) => (
                      <li
                        key={s.slot_id}
                        className="flex items-center justify-between border border-editorial-border bg-editorial-bg px-3 py-2"
                      >
                        <span className="font-semibold text-editorial-ink">
                          #{s.most_used_rank} · {s.lot_name} — Slot {s.slot_number} ({s.slot_type})
                        </span>
                        <span className="font-mono font-bold text-editorial-cobalt">
                          {s.usage_count} stays ({s.total_booked_hours}h)
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="border border-editorial-border bg-editorial-surface p-5">
                  <h3 className="text-base font-bold text-editorial-ink">
                    Least Used Parking Slots (DENSE_RANK)
                  </h3>
                  <ul className="mt-3 space-y-2 text-xs">
                    {analytics.slot_usage.least_used.slice(0, 5).map((s) => (
                      <li
                        key={s.slot_id}
                        className="flex items-center justify-between border border-editorial-border bg-editorial-bg px-3 py-2"
                      >
                        <span className="font-semibold text-editorial-muted">
                          {s.lot_name} — Slot {s.slot_number} ({s.slot_type})
                        </span>
                        <span className="font-mono font-bold text-editorial-muted">
                          {s.usage_count} stays ({s.total_booked_hours}h)
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* 7 x 24 Occupancy Heatmap */}
              <div
                data-testid="occupancy-heatmap"
                className="border border-editorial-border bg-editorial-surface p-5"
              >
                <div className="flex items-center gap-2">
                  <Flame className="h-5 w-5 text-editorial-vermilion" />
                  <h3 className="text-base font-bold text-editorial-ink">
                    Occupancy Demand Heatmap (Day of Week vs. Hour of Day)
                  </h3>
                </div>
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full border-collapse text-center font-mono text-[10px]">
                    <thead>
                      <tr>
                        <th className="p-1 text-left font-bold text-editorial-muted">Day \ Hr</th>
                        {Array.from({ length: 24 }, (_, hr) => (
                          <th key={hr} className="p-1 font-semibold text-editorial-muted">
                            {hr}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {DAY_NAMES.map((dayLabel, dow) => (
                        <tr key={dow}>
                          <td className="p-1 text-left font-bold text-editorial-ink">{dayLabel}</td>
                          {Array.from({ length: 24 }, (_, hr) => {
                            const count = heatmapMatrix[`${dow}-${hr}`] ?? 0;
                            const bg =
                              count >= 4
                                ? 'bg-editorial-vermilion text-white font-bold'
                                : count >= 2
                                  ? 'bg-editorial-cobalt text-white font-bold'
                                  : count === 1
                                    ? 'bg-editorial-lime text-editorial-ink font-bold'
                                    : 'bg-editorial-bg text-editorial-muted/40';
                            return (
                              <td key={hr} className={`border border-editorial-surface p-1.5 ${bg}`}>
                                {count}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: LOTS & SLOTS */}
          {activeTab === 'LOTS' && (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <form
                onSubmit={handleCreateLot}
                className="space-y-3 border border-editorial-border bg-editorial-surface p-5"
              >
                <h3 className="text-base font-bold text-editorial-ink">Create Parking Lot</h3>
                <input
                  type="text"
                  required
                  placeholder="Lot Name"
                  value={newLotName}
                  onChange={(e) => setNewLotName(e.target.value)}
                  className="w-full border border-editorial-border bg-white px-3 py-2 text-xs"
                />
                <input
                  type="text"
                  required
                  placeholder="Street Address"
                  value={newLotAddress}
                  onChange={(e) => setNewLotAddress(e.target.value)}
                  className="w-full border border-editorial-border bg-white px-3 py-2 text-xs"
                />
                <input
                  type="text"
                  required
                  placeholder="City"
                  value={newLotCity}
                  onChange={(e) => setNewLotCity(e.target.value)}
                  className="w-full border border-editorial-border bg-white px-3 py-2 text-xs"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    step="0.0001"
                    required
                    value={newLotLat}
                    onChange={(e) => setNewLotLat(e.target.value)}
                    className="w-full border border-editorial-border bg-white px-3 py-2 text-xs"
                  />
                  <input
                    type="number"
                    step="0.0001"
                    required
                    value={newLotLng}
                    onChange={(e) => setNewLotLng(e.target.value)}
                    className="w-full border border-editorial-border bg-white px-3 py-2 text-xs"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full bg-editorial-ink py-2 text-xs font-bold uppercase text-editorial-bg"
                >
                  Create Lot
                </button>
              </form>

              <div className="space-y-4 lg:col-span-2">
                {lots.map((l) => (
                  <div
                    key={l.lot_id}
                    className="flex flex-wrap items-center justify-between gap-3 border border-editorial-border bg-editorial-surface p-4"
                  >
                    <div>
                      <div className="font-serif text-lg font-bold text-editorial-ink">
                        #{l.lot_id} · {l.name}
                      </div>
                      <div className="text-xs text-editorial-muted">
                        {l.address}, {l.city} · {l.available_slots}/{l.total_slots} free
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={async () => {
                          const det = await apiGetLotDetail(l.lot_id);
                          setSelectedLot(det.lot);
                        }}
                        className="border border-editorial-ink bg-editorial-bg px-3 py-1.5 text-xs font-bold text-editorial-ink"
                      >
                        Manage Slots
                      </button>
                      {l.lot_id > 3 && (
                        <button
                          type="button"
                          onClick={() => handleDeleteLot(l.lot_id)}
                          className="border border-editorial-vermilion bg-editorial-vermilion/10 px-3 py-1.5 text-xs font-bold text-editorial-vermilion"
                        >
                          Delete Lot
                        </button>
                      )}
                    </div>
                  </div>
                ))}

                {selectedLot && (
                  <div className="border border-editorial-border bg-editorial-surface p-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <h4 className="font-bold text-editorial-ink">
                        Slots in {selectedLot.name} ({selectedLot.slots.length})
                      </h4>
                      <form onSubmit={handleAddSlot} className="flex items-center gap-2">
                        <input
                          type="text"
                          required
                          placeholder="Slot # (e.g. A15)"
                          value={newSlotNumber}
                          onChange={(e) => setNewSlotNumber(e.target.value)}
                          className="border border-editorial-border bg-white px-2.5 py-1 text-xs"
                        />
                        <select
                          value={newSlotType}
                          onChange={(e) => setNewSlotType(e.target.value as VehicleType)}
                          className="border border-editorial-border bg-white px-2.5 py-1 text-xs font-bold"
                        >
                          <option value="CAR">CAR</option>
                          <option value="BIKE">BIKE</option>
                          <option value="SUV">SUV</option>
                          <option value="EV">EV</option>
                        </select>
                        <button
                          type="submit"
                          className="bg-editorial-vermilion px-3 py-1 text-xs font-bold text-white"
                        >
                          Add Slot
                        </button>
                      </form>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {selectedLot.slots.map((s) => (
                        <div
                          key={s.slot_id}
                          className="flex items-center justify-between border border-editorial-border bg-editorial-bg p-2.5 text-xs"
                        >
                          <div>
                            <div className="font-mono font-bold">{s.slot_number}</div>
                            <div className="font-mono text-[10px] text-editorial-muted">
                              {s.slot_type} · {s.status}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleToggleSlotMaintenance(s.slot_id, s.status)}
                            className="border border-editorial-ink bg-white px-2 py-1 text-[10px] font-bold"
                          >
                            {s.status === 'MAINTENANCE' ? 'Activate' : 'Maint.'}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: PRICING & MULTIPLIERS */}
          {activeTab === 'PRICING' && (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <form
                onSubmit={handleSavePricing}
                className="space-y-4 border border-editorial-border bg-editorial-surface p-5"
              >
                <h3 className="text-base font-bold text-editorial-ink">
                  Update Lot Pricing Rule (Audited in audit_log)
                </h3>
                <div>
                  <label className="block text-xs font-bold uppercase text-editorial-muted">
                    Select Lot
                  </label>
                  <select
                    value={priceLotId}
                    onChange={(e) => setPriceLotId(Number(e.target.value))}
                    className="mt-1 w-full border border-editorial-border bg-white px-3 py-2 text-xs font-bold"
                  >
                    {lots.map((l) => (
                      <option key={l.lot_id} value={l.lot_id}>
                        #{l.lot_id} — {l.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-editorial-muted">
                    Vehicle Type
                  </label>
                  <select
                    value={priceVehicleType}
                    onChange={(e) => setPriceVehicleType(e.target.value as VehicleType)}
                    className="mt-1 w-full border border-editorial-border bg-white px-3 py-2 text-xs font-bold"
                  >
                    <option value="BIKE">BIKE</option>
                    <option value="CAR">CAR</option>
                    <option value="SUV">SUV</option>
                    <option value="EV">EV</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold uppercase text-editorial-muted">
                      Base Rate (₹/hr)
                    </label>
                    <input
                      type="number"
                      min="1"
                      step="0.5"
                      value={baseRate}
                      onChange={(e) => setBaseRate(e.target.value)}
                      className="mt-1 w-full border border-editorial-border bg-white px-3 py-2 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-editorial-muted">
                      Overstay Penalty (₹/hr)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.5"
                      value={penaltyRate}
                      onChange={(e) => setPenaltyRate(e.target.value)}
                      className="mt-1 w-full border border-editorial-border bg-white px-3 py-2 text-xs"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  className="w-full bg-editorial-ink py-2.5 text-xs font-bold uppercase text-editorial-bg"
                >
                  Save Pricing Rule
                </button>
              </form>

              <form
                onSubmit={handleSaveMultiplier}
                className="space-y-4 border border-editorial-border bg-editorial-surface p-5"
              >
                <h3 className="text-base font-bold text-editorial-ink">
                  Set Custom Peak-Hour Multiplier (1.00x – 3.00x)
                </h3>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-bold uppercase text-editorial-muted">
                      Weekday
                    </label>
                    <select
                      value={multDay}
                      onChange={(e) => setMultDay(Number(e.target.value))}
                      className="mt-1 w-full border border-editorial-border bg-white px-2.5 py-2 text-xs font-bold"
                    >
                      {DAY_NAMES.map((d, idx) => (
                        <option key={idx} value={idx}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-editorial-muted">
                      Hour (0-23)
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="23"
                      value={multHour}
                      onChange={(e) => setMultHour(Number(e.target.value))}
                      className="mt-1 w-full border border-editorial-border bg-white px-2.5 py-2 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-editorial-muted">
                      Multiplier
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="3"
                      step="0.05"
                      value={multValue}
                      onChange={(e) => setMultValue(e.target.value)}
                      className="mt-1 w-full border border-editorial-border bg-white px-2.5 py-2 text-xs"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  className="w-full bg-editorial-vermilion py-2.5 text-xs font-bold uppercase text-white"
                >
                  Save Peak Multiplier
                </button>
              </form>
            </div>
          )}

          {/* TAB 4: ALL RESERVATIONS */}
          {activeTab === 'RESERVATIONS' && (
            <div className="space-y-4 border border-editorial-border bg-editorial-surface p-5">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-editorial-ink">
                  All System Reservations ({reservations.length})
                </h3>
                <button
                  type="button"
                  onClick={async () => {
                    if (!token) return;
                    const r = await apiAdminExpireStale(token);
                    setBanner({
                      type: 'ok',
                      text: `Expired ${r.expired_count} past-grace reservations.`,
                    });
                    await loadAllAdminData();
                  }}
                  className="bg-editorial-ink px-3.5 py-1.5 text-xs font-bold uppercase text-editorial-bg"
                >
                  Expire Stale Bookings Now
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-editorial-border text-editorial-muted">
                      <th className="py-2">ID</th>
                      <th className="py-2">Driver</th>
                      <th className="py-2">Lot &amp; Slot</th>
                      <th className="py-2">Vehicle</th>
                      <th className="py-2">Window</th>
                      <th className="py-2">Quote</th>
                      <th className="py-2">Status</th>
                      <th className="py-2">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-editorial-border">
                    {reservations.map((r) => (
                      <tr key={r.reservation_id}>
                        <td className="py-2 font-mono font-bold">#{r.reservation_id}</td>
                        <td className="py-2">{r.user_name}</td>
                        <td className="py-2">
                          {r.lot_name} ({r.slot_number})
                        </td>
                        <td className="py-2 font-mono">
                          {r.plate_number} ({r.vehicle_type})
                        </td>
                        <td className="py-2 font-mono">
                          {r.start_time} → {r.end_time}
                        </td>
                        <td className="py-2 font-mono font-bold">
                          ₹{Number(r.quoted_amount).toFixed(2)}
                        </td>
                        <td className="py-2 font-mono font-bold text-editorial-cobalt">
                          {r.status}
                        </td>
                        <td className="py-2">
                          {r.status === 'CONFIRMED' && (
                            <button
                              type="button"
                              onClick={async () => {
                                if (!token) return;
                                await apiCancelReservation(token, r.reservation_id);
                                await loadAllAdminData();
                              }}
                              className="border border-editorial-vermilion bg-editorial-vermilion/10 px-2 py-1 text-[11px] font-bold text-editorial-vermilion"
                            >
                              Cancel
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 5: USERS & ROLES */}
          {activeTab === 'USERS' && (
            <div className="border border-editorial-border bg-editorial-surface p-5">
              <h3 className="text-base font-bold text-editorial-ink">
                Registered Users ({users.length})
              </h3>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-editorial-border text-editorial-muted">
                      <th className="py-2">ID</th>
                      <th className="py-2">Name</th>
                      <th className="py-2">Email</th>
                      <th className="py-2">Role</th>
                      <th className="py-2">Vehicles</th>
                      <th className="py-2">Bookings</th>
                      <th className="py-2">Status</th>
                      <th className="py-2">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-editorial-border">
                    {users.map((u) => (
                      <tr key={u.user_id}>
                        <td className="py-2 font-mono font-bold">#{u.user_id}</td>
                        <td className="py-2 font-bold">{u.full_name}</td>
                        <td className="py-2">{u.email}</td>
                        <td className="py-2 font-mono font-bold text-editorial-cobalt">
                          {u.role}
                        </td>
                        <td className="py-2 font-mono">{u.vehicle_count}</td>
                        <td className="py-2 font-mono">{u.reservation_count}</td>
                        <td className="py-2">
                          <span
                            className={`px-2 py-0.5 font-mono text-[10px] font-bold ${
                              u.is_active
                                ? 'bg-editorial-lime text-editorial-ink'
                                : 'bg-editorial-vermilion text-white'
                            }`}
                          >
                            {u.is_active ? 'ACTIVE' : 'DEACTIVATED'}
                          </span>
                        </td>
                        <td className="py-2">
                          {u.user_id !== user.user_id && (
                            <button
                              type="button"
                              onClick={async () => {
                                if (!token) return;
                                await apiAdminUpdateUserStatus(token, u.user_id, !u.is_active);
                                await loadAllAdminData();
                              }}
                              className="border border-editorial-ink bg-white px-2.5 py-1 text-[11px] font-bold"
                            >
                              {u.is_active ? 'Deactivate' : 'Activate'}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
