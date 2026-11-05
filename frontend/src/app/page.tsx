'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Heart, MapPin, Search, Star, Clock, ArrowRight } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import {
  apiAddFavorite,
  apiGetFavorites,
  apiGetLots,
  apiRemoveFavorite,
} from '@/lib/api';
import { ParkingLotSummary } from '@/lib/types';

export default function HomePage() {
  const { token } = useAuth();
  const [lots, setLots] = useState<ParkingLotSummary[]>([]);
  const [favoriteLotIds, setFavoriteLotIds] = useState<Set<number>>(new Set());
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [vehicleTypeFilter, setVehicleTypeFilter] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLots = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiGetLots({
        q: searchQuery.trim() || undefined,
        vehicle_type: vehicleTypeFilter || undefined,
      });
      setLots(res.lots);
    } catch (err: any) {
      setError(err?.message || 'Failed to load parking lots');
    } finally {
      setLoading(false);
    }
  }, [searchQuery, vehicleTypeFilter]);

  useEffect(() => {
    fetchLots();
  }, [fetchLots]);

  useEffect(() => {
    if (!token) {
      setFavoriteLotIds(new Set());
      return;
    }
    apiGetFavorites(token)
      .then((res) => {
        setFavoriteLotIds(new Set(res.favorites.map((f) => f.lot_id)));
      })
      .catch(() => {});
  }, [token]);

  const toggleFavorite = async (lotId: number) => {
    if (!token) return;
    try {
      if (favoriteLotIds.has(lotId)) {
        await apiRemoveFavorite(token, lotId);
        setFavoriteLotIds((prev) => {
          const next = new Set(prev);
          next.delete(lotId);
          return next;
        });
      } else {
        await apiAddFavorite(token, lotId);
        setFavoriteLotIds((prev) => new Set(prev).add(lotId));
      }
    } catch {
      // Ignore favorite toggle error
    }
  };

  const totalSlots = lots.reduce((s, l) => s + Number(l.total_slots), 0);
  const freeSlots = lots.reduce((s, l) => s + Number(l.available_slots), 0);

  return (
    <div data-testid="lot-discovery-page" className="space-y-8">
      {/* Slide 1 Editorial Hero Section */}
      <div className="border-b border-editorial-border pb-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 text-xs font-semibold text-editorial-muted">
            <span className="border-b-2 border-editorial-cobalt pb-0.5 font-bold text-editorial-ink">
              Bengaluru Urban Parking Authority
            </span>
            <span>|</span>
            <span>Smart Reservation &amp; Real-Time Telemetry</span>
          </div>
          <span className="bg-editorial-lime px-3 py-1 font-mono text-xs font-bold text-editorial-ink">
            LIVE · 08:00—23:59 IST
          </span>
        </div>

        <div className="mt-6">
          <h1 className="font-serif text-4xl font-bold tracking-tight text-editorial-ink sm:text-6xl">
            ParkPulse
          </h1>
          <div className="mt-2">
            <span className="editorial-ribbon text-2xl sm:text-4xl">
              FIND · RESERVE · PARK IN REAL TIME
            </span>
          </div>
        </div>

        <p className="mt-5 max-w-2xl text-sm leading-relaxed text-editorial-ink/90">
          Eliminate urban parking congestion across Bengaluru. Inspect live slot grids updated
          via Server-Sent Events, lock transparent peak-hour dynamic pricing, and check in with
          one QR scan.
        </p>

        {/* Slide 1 Inline Vermilion Stats Strip */}
        <div className="mt-5 flex flex-wrap items-center gap-4 border-t border-editorial-border pt-4 text-xs text-editorial-muted">
          <span>
            <strong className="font-mono text-base font-bold text-editorial-vermilion">
              {lots.length}
            </strong>{' '}
            metropolitan hubs
          </span>
          <span>|</span>
          <span>
            <strong className="font-mono text-base font-bold text-editorial-vermilion">
              {freeSlots}/{totalSlots}
            </strong>{' '}
            open slots right now
          </span>
          <span>|</span>
          <span>
            <strong className="font-mono text-base font-bold text-editorial-vermilion">
              1.00x–1.75x
            </strong>{' '}
            dynamic peak multipliers
          </span>
        </div>

        {/* Search & Filter Bar */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            fetchLots();
          }}
          className="mt-6 flex flex-col gap-3 sm:flex-row"
        >
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-3 h-4 w-4 text-editorial-muted" />
            <input
              type="text"
              data-testid="lot-search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by lot name, area, or city (e.g. Orion, Indiranagar)..."
              className="w-full border border-editorial-ink bg-editorial-surface py-2.5 pl-10 pr-4 text-sm text-editorial-ink placeholder:text-editorial-muted focus:outline-none"
            />
          </div>

          <select
            data-testid="vehicle-type-select"
            value={vehicleTypeFilter}
            onChange={(e) => setVehicleTypeFilter(e.target.value)}
            className="border border-editorial-ink bg-editorial-surface px-4 py-2.5 text-sm font-bold text-editorial-ink"
          >
            <option value="">All Vehicle Types</option>
            <option value="BIKE">BIKE</option>
            <option value="CAR">CAR</option>
            <option value="SUV">SUV</option>
            <option value="EV">EV</option>
          </select>

          <button
            type="submit"
            className="bg-editorial-ink px-6 py-2.5 text-xs font-bold uppercase tracking-wider text-editorial-bg hover:bg-editorial-vermilion"
          >
            Filter Hubs
          </button>
        </form>
      </div>

      {error && (
        <div className="border border-editorial-vermilion bg-editorial-vermilion/10 p-4 text-xs font-bold text-editorial-vermilion">
          {error}
        </div>
      )}

      {/* Lot Cards Grid */}
      {loading ? (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className="h-72 animate-pulse border border-editorial-border bg-editorial-surface p-6"
            />
          ))}
        </div>
      ) : lots.length === 0 ? (
        <div className="border border-editorial-border bg-editorial-surface p-12 text-center">
          <p className="text-base font-bold text-editorial-ink">
            No parking lots match your search.
          </p>
          <p className="mt-1 text-xs text-editorial-muted">
            Try clearing the search filter or selecting a different vehicle type.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {lots.map((lot) => {
            const isFav = favoriteLotIds.has(lot.lot_id);
            const occPct = Math.min(100, Number(lot.occupancy_pct));
            const freePct = Math.max(0, 100 - occPct);

            return (
              <div
                key={lot.lot_id}
                data-testid={`lot-card-${lot.lot_id}`}
                className="flex flex-col justify-between border border-editorial-border bg-editorial-surface p-6 transition hover:border-editorial-ink"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="font-mono text-[11px] font-bold text-editorial-muted">
                        HUB 0{lot.lot_id} / 0{lots.length}
                      </span>
                      <h2 className="mt-0.5 font-serif text-xl font-bold text-editorial-ink">
                        {lot.name}
                      </h2>
                      <p className="mt-1 flex items-center gap-1 text-xs text-editorial-muted">
                        <MapPin className="h-3.5 w-3.5 text-editorial-vermilion" />
                        <span>
                          {lot.address}, {lot.city}
                        </span>
                      </p>
                    </div>

                    {token && (
                      <button
                        type="button"
                        onClick={() => toggleFavorite(lot.lot_id)}
                        className={`border p-2 transition ${
                          isFav
                            ? 'border-editorial-vermilion bg-editorial-vermilion/10 text-editorial-vermilion'
                            : 'border-editorial-border text-editorial-muted hover:border-editorial-ink'
                        }`}
                        title={isFav ? 'Remove from favorites' : 'Save to favorites'}
                      >
                        <Heart
                          className={`h-4 w-4 ${isFav ? 'fill-editorial-vermilion' : ''}`}
                        />
                      </button>
                    )}
                  </div>

                  {/* Slide 3 Style Oversized KPI Numerals */}
                  <div className="mt-5 grid grid-cols-2 gap-3 border-y border-editorial-border py-3.5">
                    <div>
                      <div className="text-[11px] text-editorial-muted">
                        Capacity · free / total
                      </div>
                      <div className="editorial-kpi-num mt-1 text-3xl text-editorial-vermilion">
                        {lot.available_slots}
                        <span className="text-lg text-editorial-ink">
                          /{lot.total_slots}
                        </span>
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] text-editorial-muted">
                        Entry · starting rate
                      </div>
                      <div className="editorial-kpi-num mt-1 text-3xl text-editorial-ink">
                        ₹{lot.min_hourly_rate ?? 10}
                        <span className="text-xs font-normal text-editorial-muted"> / hr</span>
                      </div>
                    </div>
                  </div>

                  {/* Slide 3 Split Ratio Bar */}
                  <div className="mt-4">
                    <div className="flex h-4 w-full overflow-hidden border border-editorial-ink">
                      <div
                        className="bg-editorial-cobalt transition-all"
                        style={{ width: `${freePct}%` }}
                      />
                      <div
                        className="bg-editorial-vermilion transition-all"
                        style={{ width: `${occPct}%` }}
                      />
                    </div>
                    <div className="mt-1.5 flex items-center justify-between text-[11px] font-semibold">
                      <span className="text-editorial-cobalt">
                        ■ Free {freePct.toFixed(0)}% ({lot.available_slots})
                      </span>
                      <span className="text-editorial-vermilion">
                        ■ Occupied {occPct.toFixed(0)}%
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between text-xs text-editorial-muted">
                    <span className="inline-flex items-center gap-1 font-mono text-[11px]">
                      <Clock className="h-3.5 w-3.5" />
                      {lot.open_time.slice(0, 5)}–{lot.close_time.slice(0, 5)} (Grace:{' '}
                      {lot.grace_period_minutes}m)
                    </span>
                    <span className="inline-flex items-center gap-1 font-bold text-editorial-ink">
                      <Star className="h-3.5 w-3.5 fill-editorial-vermilion text-editorial-vermilion" />
                      {lot.avg_rating ? Number(lot.avg_rating).toFixed(1) : 'New'} (
                      {lot.review_count})
                    </span>
                  </div>
                </div>

                <div className="mt-5 flex items-center justify-between border-t border-editorial-border pt-4">
                  <Link
                    href={`/map`}
                    className="text-xs font-bold text-editorial-cobalt hover:underline"
                  >
                    Locate on Map
                  </Link>

                  <Link
                    href={`/lots/${lot.lot_id}`}
                    className="inline-flex items-center gap-1.5 bg-editorial-ink px-4 py-2 text-xs font-bold uppercase tracking-wider text-editorial-bg hover:bg-editorial-vermilion"
                  >
                    <span>Live Grid &amp; Book</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Slide 2 / Slide 3 Full-Width Charcoal Summary Strip */}
      <div className="bg-editorial-ink px-6 py-4 text-xs text-editorial-bg sm:text-sm">
        <span className="font-bold text-editorial-lime">System Guarantee:</span> All bookings
        are wrapped in <code className="font-mono text-editorial-lime">SELECT ... FOR UPDATE</code>{' '}
        transactions with database-level overlap triggers, automatic waitlist notifications, and
        instant QR pass generation.
      </div>
    </div>
  );
}
