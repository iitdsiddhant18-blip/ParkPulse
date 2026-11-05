'use client';

import React, { useEffect, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { ArrowRight, Compass, MapPin, Radio } from 'lucide-react';
import { apiGetLots, getLotStreamUrl } from '@/lib/api';
import { ParkingLotSummary } from '@/lib/types';

const LotMapCanvas = dynamic(() => import('@/components/LotMapCanvas'), {
  ssr: false,
  loading: () => (
    <div className="flex h-[460px] w-full items-center justify-center border border-editorial-ink bg-editorial-surface font-mono text-xs text-editorial-muted">
      Initializing Leaflet + OpenStreetMap canvas...
    </div>
  ),
});

export default function MapViewPage() {
  const [lots, setLots] = useState<ParkingLotSummary[]>([]);
  const [selectedLotId, setSelectedLotId] = useState<number>(1);
  const [sseActive, setSseActive] = useState<boolean>(false);

  const loadLots = useCallback(async () => {
    try {
      const res = await apiGetLots();
      setLots(res.lots);
      if (res.lots.length > 0 && !res.lots.some((l) => l.lot_id === selectedLotId)) {
        setSelectedLotId(res.lots[0].lot_id);
      }
    } catch {
      // Ignore
    }
  }, [selectedLotId]);

  useEffect(() => {
    loadLots();
  }, [loadLots]);

  // Subscribe to SSE on the currently selected map lot
  useEffect(() => {
    if (typeof window === 'undefined' || !selectedLotId) return;

    const es = new EventSource(getLotStreamUrl(selectedLotId));
    const onStreamFrame = (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data);
        setSseActive(true);
        setLots((prev) =>
          prev.map((l) =>
            l.lot_id === selectedLotId
              ? {
                  ...l,
                  total_slots: data.occupancy.total_slots,
                  available_slots: data.occupancy.available_slots,
                  reserved_slots: data.occupancy.reserved_slots,
                  occupied_slots: data.occupancy.occupied_slots,
                  maintenance_slots: data.occupancy.maintenance_slots,
                  occupancy_pct: data.occupancy.occupancy_pct,
                }
              : l
          )
        );
      } catch {
        // Ignore
      }
    };

    es.addEventListener('snapshot', onStreamFrame);
    es.addEventListener('slot_update', onStreamFrame);
    es.onerror = () => setSseActive(false);

    return () => es.close();
  }, [selectedLotId]);

  const selectedLot = lots.find((l) => l.lot_id === selectedLotId) ?? lots[0] ?? null;
  const totalSlotsAll = lots.reduce((acc, l) => acc + Number(l.total_slots), 0);
  const freeSlotsAll = lots.reduce((acc, l) => acc + Number(l.available_slots), 0);
  const freeRatioPct =
    totalSlotsAll > 0 ? Math.round((freeSlotsAll * 100) / totalSlotsAll) : 100;

  return (
    <div data-testid="map-view-page" className="space-y-8">
      {/* Editorial Header */}
      <div className="border-b border-editorial-border pb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 text-xs font-semibold text-editorial-muted">
            <span className="border-b-2 border-editorial-cobalt pb-0.5 font-bold text-editorial-ink">
              Bengaluru Urban Mobility Grid
            </span>
            <span>|</span>
            <span>Leaflet + OpenStreetMap Live Telemetry</span>
          </div>
          <span className="bg-editorial-lime px-2.5 py-1 font-mono text-xs font-bold text-editorial-ink">
            {sseActive ? 'SSE STREAM · ACTIVE' : 'LIVE TELEMETRY'}
          </span>
        </div>

        <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-editorial-ink sm:text-4xl">
          {freeSlotsAll} of {totalSlotsAll} citywide slots free—
          <span className="text-editorial-vermilion">{freeRatioPct}%</span> instant capacity
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-editorial-muted">
          Click any parking lot marker on the interactive map or in the corridor list below to
          inspect real-time slot availability and lock a reservation.
        </p>
      </div>

      {/* Main 2-Column Editorial Map + Telemetry Split */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <LotMapCanvas
            lots={lots}
            selectedLotId={selectedLotId}
            onSelectLot={(id) => setSelectedLotId(id)}
          />
        </div>

        {/* Right Column: Selected Lot Editorial Dossier */}
        <div className="flex flex-col justify-between border border-editorial-border bg-editorial-surface p-6">
          {selectedLot ? (
            <div className="space-y-6">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-editorial-muted">
                  Selected Corridor · Lot #{selectedLot.lot_id}
                </div>
                <h2 className="mt-1 font-serif text-2xl font-bold text-editorial-ink">
                  {selectedLot.name}
                </h2>
                <p className="mt-1 flex items-center gap-1 text-xs text-editorial-muted">
                  <MapPin className="h-3.5 w-3.5 text-editorial-vermilion" />
                  <span>
                    {selectedLot.address}, {selectedLot.city}
                  </span>
                </p>
              </div>

              {/* Oversized Editorial KPI Numerals */}
              <div className="grid grid-cols-2 gap-4 border-y border-editorial-border py-4">
                <div>
                  <div className="text-xs text-editorial-muted">Slots · free / total</div>
                  <div className="editorial-kpi-num mt-1 text-4xl text-editorial-vermilion">
                    {selectedLot.available_slots}
                    <span className="text-xl text-editorial-ink">
                      /{selectedLot.total_slots}
                    </span>
                  </div>
                </div>
                <div>
                  <div className="text-xs text-editorial-muted">Base tariff · starting</div>
                  <div className="editorial-kpi-num mt-1 text-4xl text-editorial-ink">
                    ₹{selectedLot.min_hourly_rate ?? 10}
                    <span className="text-xs font-normal text-editorial-muted"> / hr</span>
                  </div>
                </div>
              </div>

              {/* Slide 3 Style Split Ratio Bar */}
              <div>
                <div className="text-xs font-semibold text-editorial-muted">
                  Capacity split · free vs reserved/occupied
                </div>
                <div className="mt-2 flex h-6 w-full overflow-hidden border border-editorial-ink">
                  <div
                    className="bg-editorial-cobalt transition-all"
                    style={{
                      width: `${Math.max(
                        0,
                        100 - Number(selectedLot.occupancy_pct)
                      )}%`,
                    }}
                  />
                  <div
                    className="bg-editorial-vermilion transition-all"
                    style={{
                      width: `${Math.min(100, Number(selectedLot.occupancy_pct))}%`,
                    }}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between text-xs">
                  <span className="inline-flex items-center gap-1.5 font-semibold text-editorial-cobalt">
                    <span className="h-2.5 w-2.5 bg-editorial-cobalt" /> Free:{' '}
                    {selectedLot.available_slots} slots
                  </span>
                  <span className="inline-flex items-center gap-1.5 font-semibold text-editorial-vermilion">
                    <span className="h-2.5 w-2.5 bg-editorial-vermilion" /> Busy:{' '}
                    {selectedLot.reserved_slots + selectedLot.occupied_slots} slots
                  </span>
                </div>
              </div>

              <div className="space-y-1 font-mono text-xs text-editorial-muted">
                <div>
                  Coordinates: {Number(selectedLot.latitude).toFixed(4)}° N,{' '}
                  {Number(selectedLot.longitude).toFixed(4)}° E
                </div>
                <div>
                  Hours: {selectedLot.open_time.slice(0, 5)}–{selectedLot.close_time.slice(0, 5)}{' '}
                  · Grace: {selectedLot.grace_period_minutes} mins
                </div>
              </div>
            </div>
          ) : (
            <p className="text-xs text-editorial-muted">Select a parking lot marker...</p>
          )}

          {selectedLot && (
            <div className="mt-6 pt-4 border-t border-editorial-border">
              <Link
                href={`/lots/${selectedLot.lot_id}`}
                className="inline-flex w-full items-center justify-center gap-2 bg-editorial-vermilion py-3 text-xs font-bold uppercase tracking-wider text-white hover:opacity-90"
              >
                <span>Open Live Slot Grid & Reserve</span>
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Corridor Selector Strip */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {lots.map((lot) => {
          const active = lot.lot_id === selectedLotId;
          return (
            <button
              key={lot.lot_id}
              type="button"
              data-testid={`map-lot-selector-${lot.lot_id}`}
              onClick={() => setSelectedLotId(lot.lot_id)}
              className={`border p-4 text-left transition ${
                active
                  ? 'border-2 border-editorial-ink bg-editorial-surface'
                  : 'border-editorial-border bg-editorial-bg hover:bg-editorial-surface'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-bold text-editorial-vermilion">
                  0{lot.lot_id} / 0{lots.length}
                </span>
                <span className="inline-flex items-center gap-1 font-mono text-xs font-bold text-editorial-cobalt">
                  <Compass className="h-3.5 w-3.5" />
                  {lot.available_slots}/{lot.total_slots} FREE
                </span>
              </div>
              <div className="mt-1 text-base font-bold text-editorial-ink">{lot.name}</div>
              <div className="text-xs text-editorial-muted">{lot.address}</div>
            </button>
          );
        })}
      </div>

      {/* Full-Width Charcoal Summary Banner (Slide 2 & Slide 3 signature pattern) */}
      <div className="bg-editorial-ink px-6 py-4 text-xs text-editorial-bg sm:text-sm">
        <span className="font-bold text-editorial-lime">Live Telemetry Summary:</span>{' '}
        {lots.length} active Bengaluru hubs monitored via Server-Sent Events ·{' '}
        <strong>{freeSlotsAll} slots open right now</strong> · Dynamic peak multipliers active on
        weekday rush hours.
      </div>
    </div>
  );
}
