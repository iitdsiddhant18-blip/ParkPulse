'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  QrCode,
  Receipt,
  CreditCard,
  XCircle,
  CheckCircle2,
  LogOut,
  Star,
  Clock,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import {
  apiCancelReservation,
  apiCheckIn,
  apiCheckOut,
  apiCreateReview,
  apiGetReceipt,
  apiGetReservationDetail,
  apiGetReservations,
  apiModifyReservation,
  apiPayReservation,
} from '@/lib/api';
import { ReceiptData, ReservationRecord } from '@/lib/types';
import { QrTicketModal } from '@/components/QrTicketModal';
import { ReceiptModal } from '@/components/ReceiptModal';

export default function ReservationsPage() {
  const { user, token } = useAuth();
  const [reservations, setReservations] = useState<ReservationRecord[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [activeQrModal, setActiveQrModal] = useState<ReservationRecord | null>(null);
  const [activeReceipt, setActiveReceipt] = useState<ReceiptData | null>(null);

  const [editingResv, setEditingResv] = useState<ReservationRecord | null>(null);
  const [modStart, setModStart] = useState<string>('');
  const [modEnd, setModEnd] = useState<string>('');

  const [reviewResv, setReviewResv] = useState<ReservationRecord | null>(null);
  const [rating, setRating] = useState<number>(5);
  const [comment, setComment] = useState<string>('');

  const loadReservations = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await apiGetReservations(token, statusFilter || undefined);
      setReservations(res.reservations);
    } catch (err: any) {
      setMessage({ type: 'err', text: err?.message || 'Failed to load reservations' });
    } finally {
      setLoading(false);
    }
  }, [token, statusFilter]);

  useEffect(() => {
    loadReservations();
  }, [loadReservations]);

  const handleOpenQr = async (reservationId: number) => {
    if (!token) return;
    try {
      const res = await apiGetReservationDetail(token, reservationId);
      setActiveQrModal(res.reservation);
    } catch (err: any) {
      setMessage({ type: 'err', text: err?.message || 'Could not load QR ticket' });
    }
  };

  const handleOpenReceipt = async (reservationId: number) => {
    if (!token) return;
    try {
      const res = await apiGetReceipt(token, reservationId);
      setActiveReceipt(res.receipt);
    } catch (err: any) {
      setMessage({ type: 'err', text: err?.message || 'Could not load receipt' });
    }
  };

  const handlePayNow = async (reservationId: number) => {
    if (!token) return;
    try {
      await apiPayReservation(token, reservationId, 'UPI');
      setMessage({ type: 'ok', text: `Payment recorded for reservation #${reservationId}` });
      await loadReservations();
    } catch (err: any) {
      setMessage({ type: 'err', text: err?.message || 'Payment failed' });
    }
  };

  const handleCancel = async (reservationId: number) => {
    if (!token) return;
    try {
      await apiCancelReservation(token, reservationId);
      setMessage({ type: 'ok', text: `Reservation #${reservationId} cancelled.` });
      await loadReservations();
    } catch (err: any) {
      setMessage({ type: 'err', text: err?.message || 'Cancellation failed' });
    }
  };

  const handleCheckIn = async (resv: ReservationRecord) => {
    if (!token) return;
    try {
      await apiCheckIn(token, resv.reservation_id, {
        qr_token: resv.qr_token,
        checkin_time: resv.start_time,
      });
      setActiveQrModal(null);
      setMessage({ type: 'ok', text: `Checked in to Slot ${resv.slot_number}!` });
      await loadReservations();
    } catch (err: any) {
      setMessage({ type: 'err', text: err?.message || 'Check-in failed' });
    }
  };

  const handleCheckOut = async (resv: ReservationRecord) => {
    if (!token) return;
    try {
      const out = await apiCheckOut(token, resv.reservation_id, {
        payment_method: 'UPI',
        checkout_time: resv.end_time,
      });
      setActiveQrModal(null);
      setMessage({
        type: 'ok',
        text: `Checked out! Total billed: ₹${out.billing.total_amount} (Penalty: ₹${out.billing.penalty_amount})`,
      });
      await loadReservations();
    } catch (err: any) {
      setMessage({ type: 'err', text: err?.message || 'Check-out failed' });
    }
  };

  const handleSaveModify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !editingResv) return;
    try {
      const updated = await apiModifyReservation(token, editingResv.reservation_id, {
        start_time: modStart,
        end_time: modEnd,
      });
      setEditingResv(null);
      setMessage({
        type: 'ok',
        text: `Updated reservation #${updated.reservation.reservation_id}. New quote: ₹${updated.reservation.quoted_amount}`,
      });
      await loadReservations();
    } catch (err: any) {
      setMessage({ type: 'err', text: err?.message || 'Modification failed' });
    }
  };

  const handleSubmitReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !reviewResv) return;
    try {
      await apiCreateReview(token, {
        reservation_id: reviewResv.reservation_id,
        rating,
        comment: comment.trim() || undefined,
      });
      setReviewResv(null);
      setComment('');
      setMessage({ type: 'ok', text: 'Thank you! Your review has been published.' });
      await loadReservations();
    } catch (err: any) {
      setMessage({ type: 'err', text: err?.message || 'Review submission failed' });
    }
  };

  return (
    <div data-testid="reservations-page" className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-editorial-border pb-6">
        <div>
          <div className="text-xs font-bold uppercase tracking-wider text-editorial-muted">
            Driver Ledger · Booking History &amp; Passes
          </div>
          <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-editorial-ink">
            My Bookings &amp; Receipts
          </h1>
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border border-editorial-ink bg-editorial-surface px-3.5 py-2 text-xs font-bold text-editorial-ink"
        >
          <option value="">All Statuses</option>
          <option value="CONFIRMED">CONFIRMED</option>
          <option value="CHECKED_IN">CHECKED_IN</option>
          <option value="COMPLETED">COMPLETED</option>
          <option value="CANCELLED">CANCELLED</option>
          <option value="EXPIRED">EXPIRED</option>
        </select>
      </div>

      {message && (
        <div
          className={`border p-3.5 text-xs font-bold ${
            message.type === 'ok'
              ? 'border-editorial-cobalt bg-editorial-cobalt/10 text-editorial-cobalt'
              : 'border-editorial-vermilion bg-editorial-vermilion/10 text-editorial-vermilion'
          }`}
        >
          {message.text}
        </div>
      )}

      {!user ? (
        <div className="border border-editorial-ink bg-editorial-surface p-10 text-center">
          <p className="text-sm font-semibold text-editorial-ink">
            Sign in to view your reservations and receipts.
          </p>
          <Link
            href="/login"
            className="mt-3 inline-block bg-editorial-vermilion px-4 py-2 text-xs font-bold uppercase text-white"
          >
            Sign In
          </Link>
        </div>
      ) : loading ? (
        <div className="border border-editorial-border bg-editorial-surface p-8 text-xs text-editorial-muted">
          Loading bookings...
        </div>
      ) : reservations.length === 0 ? (
        <div className="border border-editorial-border bg-editorial-surface p-10 text-center">
          <p className="text-sm font-bold text-editorial-ink">No reservations found.</p>
          <Link
            href="/"
            className="mt-3 inline-block bg-editorial-ink px-4 py-2 text-xs font-bold uppercase text-editorial-bg"
          >
            Find a Parking Lot
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {reservations.map((r) => (
            <div
              key={r.reservation_id}
              data-testid={`reservation-card-${r.reservation_id}`}
              className="border border-editorial-border bg-editorial-surface p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2.5">
                    <span className="font-serif text-lg font-bold text-editorial-ink">
                      #{r.reservation_id} · {r.lot_name}
                    </span>
                    <span className="bg-editorial-lime px-2.5 py-0.5 font-mono text-xs font-bold text-editorial-ink">
                      {r.status}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-editorial-muted">
                    Slot <strong className="text-editorial-ink">{r.slot_number}</strong> (
                    {r.slot_type}) · Vehicle{' '}
                    <strong className="text-editorial-ink">{r.plate_number}</strong>
                  </p>
                  <p className="mt-1 flex items-center gap-1 font-mono text-xs text-editorial-muted">
                    <Clock className="h-3.5 w-3.5" />
                    <span>
                      {r.start_time} → {r.end_time}
                    </span>
                  </p>
                </div>

                <div className="text-right">
                  <div className="text-xs text-editorial-muted">Quoted / Paid</div>
                  <div className="editorial-kpi-num mt-0.5 text-2xl text-editorial-ink">
                    ₹{Number(r.quoted_amount).toFixed(2)}{' '}
                    <span className="font-sans text-xs font-bold text-editorial-cobalt">
                      (Paid: ₹{Number(r.total_paid ?? 0).toFixed(2)})
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-editorial-border pt-3">
                <button
                  type="button"
                  onClick={() => handleOpenQr(r.reservation_id)}
                  className="inline-flex items-center gap-1 bg-editorial-ink px-3 py-1.5 text-xs font-bold text-editorial-bg hover:bg-editorial-vermilion"
                >
                  <QrCode className="h-3.5 w-3.5" />
                  <span>QR Ticket</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleOpenReceipt(r.reservation_id)}
                  className="inline-flex items-center gap-1 border border-editorial-ink px-3 py-1.5 text-xs font-bold text-editorial-ink hover:bg-editorial-bg"
                >
                  <Receipt className="h-3.5 w-3.5" />
                  <span>Receipt</span>
                </button>

                {r.status === 'CONFIRMED' && Number(r.total_paid ?? 0) === 0 && (
                  <button
                    type="button"
                    onClick={() => handlePayNow(r.reservation_id)}
                    className="inline-flex items-center gap-1 bg-editorial-cobalt px-3 py-1.5 text-xs font-bold text-white"
                  >
                    <CreditCard className="h-3.5 w-3.5" />
                    <span>Pay Now</span>
                  </button>
                )}

                {r.status === 'CONFIRMED' && (
                  <>
                    <button
                      type="button"
                      onClick={() => handleCheckIn(r)}
                      className="inline-flex items-center gap-1 border border-editorial-cobalt bg-editorial-cobalt/10 px-3 py-1.5 text-xs font-bold text-editorial-cobalt"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>Check In</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingResv(r);
                        setModStart(r.start_time.slice(0, 16).replace(' ', 'T'));
                        setModEnd(r.end_time.slice(0, 16).replace(' ', 'T'));
                      }}
                      className="border border-editorial-border bg-white px-3 py-1.5 text-xs font-bold text-editorial-ink"
                    >
                      Modify Window
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCancel(r.reservation_id)}
                      className="inline-flex items-center gap-1 border border-editorial-vermilion bg-editorial-vermilion/10 px-3 py-1.5 text-xs font-bold text-editorial-vermilion"
                    >
                      <XCircle className="h-3.5 w-3.5" />
                      <span>Cancel</span>
                    </button>
                  </>
                )}

                {r.status === 'CHECKED_IN' && (
                  <button
                    type="button"
                    onClick={() => handleCheckOut(r)}
                    className="inline-flex items-center gap-1 bg-editorial-vermilion px-3 py-1.5 text-xs font-bold text-white"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    <span>Check Out &amp; Bill</span>
                  </button>
                )}

                {r.status === 'COMPLETED' && !r.has_review && (
                  <button
                    type="button"
                    onClick={() => {
                      setReviewResv(r);
                      setRating(5);
                      setComment('');
                    }}
                    className="inline-flex items-center gap-1 bg-editorial-lime px-3 py-1.5 text-xs font-bold text-editorial-ink"
                  >
                    <Star className="h-3.5 w-3.5" />
                    <span>Rate &amp; Review</span>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modify Modal */}
      {editingResv && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-editorial-ink/70 p-4">
          <form
            onSubmit={handleSaveModify}
            className="w-full max-w-md space-y-4 border-2 border-editorial-ink bg-editorial-surface p-6 shadow-xl"
          >
            <h3 className="font-serif text-lg font-bold text-editorial-ink">
              Modify Reservation #{editingResv.reservation_id}
            </h3>
            <div>
              <label className="block text-xs font-bold uppercase text-editorial-muted">
                New Start
              </label>
              <input
                type="datetime-local"
                required
                value={modStart}
                onChange={(e) => setModStart(e.target.value)}
                className="mt-1 w-full border border-editorial-border bg-white px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-bold uppercase text-editorial-muted">
                New End
              </label>
              <input
                type="datetime-local"
                required
                value={modEnd}
                onChange={(e) => setModEnd(e.target.value)}
                className="mt-1 w-full border border-editorial-border bg-white px-3 py-2 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingResv(null)}
                className="border border-editorial-ink px-4 py-2 text-xs font-bold"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="bg-editorial-vermilion px-4 py-2 text-xs font-bold text-white"
              >
                Save Changes
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Review Modal */}
      {reviewResv && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-editorial-ink/70 p-4">
          <form
            onSubmit={handleSubmitReview}
            className="w-full max-w-md space-y-4 border-2 border-editorial-ink bg-editorial-surface p-6 shadow-xl"
          >
            <h3 className="font-serif text-lg font-bold text-editorial-ink">
              Review {reviewResv.lot_name}
            </h3>
            <div>
              <label className="block text-xs font-bold uppercase text-editorial-muted">
                Rating (1 to 5 Stars)
              </label>
              <select
                value={rating}
                onChange={(e) => setRating(Number(e.target.value))}
                className="mt-1 w-full border border-editorial-border bg-white px-3 py-2 text-sm"
              >
                {[5, 4, 3, 2, 1].map((n) => (
                  <option key={n} value={n}>
                    {n} Stars
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold uppercase text-editorial-muted">
                Comment
              </label>
              <textarea
                rows={3}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Share your parking experience..."
                className="mt-1 w-full border border-editorial-border bg-white px-3 py-2 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setReviewResv(null)}
                className="border border-editorial-ink px-4 py-2 text-xs font-bold"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="bg-editorial-vermilion px-4 py-2 text-xs font-bold text-white"
              >
                Submit Review
              </button>
            </div>
          </form>
        </div>
      )}

      <QrTicketModal
        reservation={activeQrModal}
        onClose={() => setActiveQrModal(null)}
        onCheckIn={handleCheckIn}
        onCheckOut={handleCheckOut}
      />

      <ReceiptModal receipt={activeReceipt} onClose={() => setActiveReceipt(null)} />
    </div>
  );
}
