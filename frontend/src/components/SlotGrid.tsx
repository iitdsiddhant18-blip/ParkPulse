'use client';

import React from 'react';
import { ParkingSlot, SlotWindowAvailability, VehicleType } from '@/lib/types';

interface SlotGridProps {
  slots: ParkingSlot[];
  windowAvailability: Record<number, SlotWindowAvailability>;
  selectedSlotId: number | null;
  filterType: VehicleType | 'ALL';
  onSelectSlot: (slotId: number) => void;
}

export function SlotGrid({
  slots,
  windowAvailability,
  selectedSlotId,
  filterType,
  onSelectSlot,
}: SlotGridProps) {
  const filteredSlots =
    filterType === 'ALL' ? slots : slots.filter((s) => s.slot_type === filterType);

  const statusBadgeColor = (status: string) => {
    switch (status) {
      case 'AVAILABLE':
        return 'bg-editorial-lime text-editorial-ink border-editorial-ink';
      case 'RESERVED':
        return 'bg-editorial-cobalt text-white border-editorial-cobalt';
      case 'OCCUPIED':
        return 'bg-editorial-vermilion text-white border-editorial-vermilion';
      case 'MAINTENANCE':
        return 'bg-editorial-border text-editorial-muted border-editorial-muted';
      default:
        return 'bg-editorial-surface text-editorial-ink border-editorial-border';
    }
  };

  return (
    <div data-testid="live-slot-grid" className="space-y-4">
      <div className="flex flex-wrap items-center gap-4 text-xs font-semibold text-editorial-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 border border-editorial-ink bg-editorial-lime" /> Available Now
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 bg-editorial-cobalt" /> Reserved
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 bg-editorial-vermilion" /> Occupied
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 bg-editorial-muted" /> Maintenance
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {filteredSlots.map((slot) => {
          const win = windowAvailability[slot.slot_id];
          const canBookWindow = win ? win.is_available_for_window : slot.status !== 'MAINTENANCE';
          const isSelected = selectedSlotId === slot.slot_id;

          return (
            <button
              key={slot.slot_id}
              type="button"
              data-testid={`slot-card-${slot.slot_number}`}
              disabled={!canBookWindow}
              onClick={() => onSelectSlot(slot.slot_id)}
              className={`flex flex-col justify-between border p-3.5 text-left transition ${
                isSelected
                  ? 'border-2 border-editorial-ink bg-editorial-bg ring-2 ring-editorial-vermilion'
                  : canBookWindow
                    ? 'border-editorial-border bg-white hover:border-editorial-ink'
                    : 'cursor-not-allowed border-editorial-border bg-editorial-bg/50 opacity-55'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-base font-bold text-editorial-ink">
                  {slot.slot_number}
                </span>
                <span className="border border-editorial-border bg-editorial-surface px-2 py-0.5 font-mono text-[10px] font-bold text-editorial-ink">
                  {slot.slot_type}
                </span>
              </div>

              <div className="mt-3 flex items-center justify-between gap-2">
                <span
                  className={`inline-block border px-2 py-0.5 font-mono text-[10px] font-bold ${statusBadgeColor(
                    slot.status
                  )}`}
                >
                  {slot.status}
                </span>

                {win && win.quoted_amount !== null && (
                  <span className="font-mono text-xs font-bold text-editorial-vermilion">
                    ₹{Number(win.quoted_amount).toFixed(0)}
                  </span>
                )}
              </div>

              {win && (
                <div className="mt-1.5 text-[11px] font-semibold">
                  {win.is_available_for_window ? (
                    <span className="text-editorial-cobalt">Open for window</span>
                  ) : (
                    <span className="text-editorial-vermilion">Busy for window</span>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
