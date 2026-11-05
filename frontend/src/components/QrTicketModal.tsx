'use client';

import React from 'react';
import { X, QrCode, CheckCircle2, LogOut } from 'lucide-react';
import { ReservationRecord } from '@/lib/types';

interface QrTicketModalProps {
  reservation: ReservationRecord | null;
  onClose: () => void;
  onCheckIn?: (reservation: ReservationRecord) => void;
  onCheckOut?: (reservation: ReservationRecord) => void;
}

export function QrTicketModal({
  reservation,
  onClose,
  onCheckIn,
  onCheckOut,
}: QrTicketModalProps) {
  if (!reservation) return null;

  return (
    <div
      data-testid="qr-ticket-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-editorial-ink/70 p-4"
    >
      <div className="w-full max-w-md border-2 border-editorial-ink bg-editorial-surface p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-editorial-border pb-3">
          <div className="flex items-center gap-2">
            <QrCode className="h-5 w-5 text-editorial-vermilion" />
            <h3 className="font-serif text-lg font-bold text-editorial-ink">
              Parking Pass #{reservation.reservation_id}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-editorial-muted hover:text-editorial-ink"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-4 flex flex-col items-center border border-dashed border-editorial-ink bg-editorial-bg p-4">
          {reservation.qr_code_data_url ? (
            <img
              src={reservation.qr_code_data_url}
              alt={`QR Pass #${reservation.reservation_id}`}
              className="h-48 w-48 border border-editorial-ink bg-white p-2"
            />
          ) : (
            <div className="flex h-40 w-40 items-center justify-center bg-white font-mono text-xs text-editorial-muted">
              QR Ready
            </div>
          )}
          <p className="mt-2 font-mono text-xs font-bold text-editorial-ink">
            {reservation.qr_token}
          </p>
          <span className="mt-1 bg-editorial-lime px-2.5 py-0.5 font-mono text-xs font-bold text-editorial-ink">
            {reservation.status}
          </span>
        </div>

        <div className="mt-4 space-y-2 text-xs text-editorial-ink">
          <div className="flex justify-between">
            <span className="text-editorial-muted">Parking Lot</span>
            <span className="font-bold">{reservation.lot_name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-editorial-muted">Slot &amp; Vehicle</span>
            <span className="font-bold">
              Slot {reservation.slot_number} ({reservation.plate_number} ·{' '}
              {reservation.vehicle_type})
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-editorial-muted">Start Time</span>
            <span className="font-mono">{reservation.start_time}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-editorial-muted">End Time</span>
            <span className="font-mono">{reservation.end_time}</span>
          </div>
          <div className="flex justify-between border-t border-editorial-border pt-2">
            <span className="text-editorial-muted">Quoted Fee</span>
            <span className="font-mono text-base font-bold text-editorial-vermilion">
              ₹{Number(reservation.quoted_amount).toFixed(2)}
            </span>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          {reservation.status === 'CONFIRMED' && onCheckIn && (
            <button
              type="button"
              onClick={() => onCheckIn(reservation)}
              className="inline-flex items-center gap-1.5 bg-editorial-cobalt px-4 py-2 text-xs font-bold text-white"
            >
              <CheckCircle2 className="h-4 w-4" />
              <span>Simulate QR Check-In</span>
            </button>
          )}
          {reservation.status === 'CHECKED_IN' && onCheckOut && (
            <button
              type="button"
              onClick={() => onCheckOut(reservation)}
              className="inline-flex items-center gap-1.5 bg-editorial-vermilion px-4 py-2 text-xs font-bold text-white"
            >
              <LogOut className="h-4 w-4" />
              <span>Simulate QR Check-Out</span>
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="border border-editorial-ink px-4 py-2 text-xs font-bold text-editorial-ink hover:bg-editorial-bg"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
