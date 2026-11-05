'use client';

import React from 'react';
import { X, Receipt, Printer } from 'lucide-react';
import { ReceiptData } from '@/lib/types';

interface ReceiptModalProps {
  receipt: ReceiptData | null;
  onClose: () => void;
}

export function ReceiptModal({ receipt, onClose }: ReceiptModalProps) {
  if (!receipt) return null;

  return (
    <div
      data-testid="receipt-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-editorial-ink/70 p-4"
    >
      <div className="w-full max-w-lg border-2 border-editorial-ink bg-editorial-surface p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-editorial-border pb-3">
          <div className="flex items-center gap-2">
            <Receipt className="h-5 w-5 text-editorial-vermilion" />
            <div>
              <h3 className="font-mono text-lg font-bold text-editorial-ink">
                {receipt.receipt_number}
              </h3>
              <p className="text-xs text-editorial-muted">
                Reservation #{receipt.reservation_id} · {receipt.status}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-editorial-muted hover:text-editorial-ink"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-4 space-y-3 text-xs">
          <div className="border border-editorial-border bg-editorial-bg p-3">
            <div className="font-bold uppercase tracking-wider text-editorial-muted">
              Customer &amp; Vehicle
            </div>
            <div className="mt-1 font-bold text-editorial-ink">
              {receipt.customer.full_name} ({receipt.customer.email})
            </div>
            <div className="font-mono text-editorial-muted">
              Plate: {receipt.vehicle.plate_number} ({receipt.vehicle.vehicle_type})
            </div>
          </div>

          <div className="border border-editorial-border bg-editorial-bg p-3">
            <div className="font-bold uppercase tracking-wider text-editorial-muted">
              Location &amp; Stay
            </div>
            <div className="mt-1 font-bold text-editorial-ink">
              {receipt.lot.name} — Slot {receipt.lot.slot_number}
            </div>
            <div className="text-editorial-muted">
              {receipt.lot.address}, {receipt.lot.city}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 font-mono text-[11px] text-editorial-muted">
              <div>Booked Start: {receipt.schedule.start_time}</div>
              <div>Booked End: {receipt.schedule.end_time}</div>
              <div>Checked In: {receipt.schedule.checked_in_at || '—'}</div>
              <div>Checked Out: {receipt.schedule.checked_out_at || '—'}</div>
            </div>
          </div>

          <div className="border border-editorial-ink bg-white p-3">
            <div className="font-bold uppercase tracking-wider text-editorial-muted">
              Billing Breakdown
            </div>
            <div className="mt-2 space-y-1">
              <div className="flex justify-between">
                <span>Quoted Base Amount</span>
                <span className="font-mono font-bold">
                  ₹{Number(receipt.billing.quoted_amount).toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Overstay Penalty</span>
                <span className="font-mono font-bold text-editorial-vermilion">
                  ₹{Number(receipt.billing.penalty_paid).toFixed(2)}
                </span>
              </div>
              {receipt.billing.refunded_amount > 0 && (
                <div className="flex justify-between text-editorial-vermilion">
                  <span>Refunded Amount</span>
                  <span className="font-mono font-bold">
                    -₹{Number(receipt.billing.refunded_amount).toFixed(2)}
                  </span>
                </div>
              )}
              <div className="flex justify-between border-t border-editorial-border pt-1.5 text-sm font-bold text-editorial-ink">
                <span>Total Paid</span>
                <span className="font-mono text-editorial-cobalt">
                  ₹{Number(receipt.billing.total_paid).toFixed(2)}
                </span>
              </div>
            </div>
          </div>

          {receipt.payments.length > 0 && (
            <div>
              <div className="mb-1 font-bold uppercase tracking-wider text-editorial-muted">
                Payment Transactions
              </div>
              <ul className="space-y-1 font-mono">
                {receipt.payments.map((p) => (
                  <li
                    key={p.payment_id}
                    className="flex items-center justify-between border border-editorial-border bg-editorial-bg px-2.5 py-1.5"
                  >
                    <span>
                      {p.payment_type} via {p.method} ({p.status})
                    </span>
                    <span className="font-bold">₹{Number(p.amount).toFixed(2)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => typeof window !== 'undefined' && window.print()}
            className="inline-flex items-center gap-1.5 bg-editorial-ink px-4 py-2 text-xs font-bold uppercase text-editorial-bg hover:bg-editorial-vermilion"
          >
            <Printer className="h-4 w-4" />
            <span>Print Receipt</span>
          </button>
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
