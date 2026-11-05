'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { QrCode, ScanLine, CheckCircle2, AlertCircle, Camera } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { apiGetReservations, apiScanQr, extractQrToken } from '@/lib/api';
import { PaymentMethod, QrScanResponse, ReservationRecord } from '@/lib/types';

export default function QrScannerPage() {
  const { user, token } = useAuth();
  const [activeBookings, setActiveBookings] = useState<ReservationRecord[]>([]);
  const [qrInput, setQrInput] = useState<string>('');
  const [scanAction, setScanAction] = useState<'AUTO' | 'CHECK_IN' | 'CHECK_OUT'>('AUTO');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('UPI');
  const [scanTime, setScanTime] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);
  const [scanResult, setScanResult] = useState<QrScanResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadActiveBookings = useCallback(async () => {
    if (!token) return;
    try {
      const res = await apiGetReservations(token);
      setActiveBookings(
        res.reservations.filter(
          (r) => r.status === 'CONFIRMED' || r.status === 'CHECKED_IN'
        )
      );
    } catch {
      // Ignore
    }
  }, [token]);

  useEffect(() => {
    loadActiveBookings();
  }, [loadActiveBookings]);

  const handleSelectBookingPass = (r: ReservationRecord) => {
    const payload = JSON.stringify({
      reservation_id: r.reservation_id,
      qr_token: r.qr_token,
    });
    setQrInput(payload);
    setScanTime(
      (r.status === 'CONFIRMED' ? r.start_time : r.end_time)
        .slice(0, 16)
        .replace(' ', 'T')
    );
    setError(null);
  };

  const handleExecuteScan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !qrInput.trim()) return;
    setBusy(true);
    setError(null);
    setScanResult(null);

    try {
      const res = await apiScanQr(token, {
        qr_token: qrInput,
        action: scanAction,
        scan_time: scanTime ? scanTime : undefined,
        payment_method: paymentMethod,
      });
      setScanResult(res);
      await loadActiveBookings();
    } catch (err: any) {
      setError(err?.message || 'QR scan failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="qr-scanner-page" className="space-y-8">
      {/* Editorial Header */}
      <div className="border-b border-editorial-border pb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 text-xs font-semibold text-editorial-muted">
            <span className="border-b-2 border-editorial-cobalt pb-0.5 font-bold text-editorial-ink">
              Gate Terminal · QR Verification
            </span>
            <span>|</span>
            <span>Stored Procedures: check_in &amp; checkout_and_bill</span>
          </div>
          <span className="bg-editorial-lime px-2.5 py-1 font-mono text-xs font-bold text-editorial-ink">
            OPTICAL + TOKEN SCANNER
          </span>
        </div>

        <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-editorial-ink sm:text-4xl">
          Scan once to <span className="text-editorial-cobalt">check in</span>; scan on exit to{' '}
          <span className="text-editorial-vermilion">auto-bill</span>
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-editorial-muted">
          Select an active pass below or paste/scan a QR payload. In AUTO mode, CONFIRMED passes
          transition to CHECKED_IN and CHECKED_IN passes compute overstay penalties and complete
          checkout.
        </p>
      </div>

      {!user ? (
        <div className="border border-editorial-ink bg-editorial-surface p-10 text-center">
          <p className="text-sm font-semibold text-editorial-ink">
            Sign in to scan your parking QR passes or operate the gate terminal.
          </p>
          <Link
            href="/login"
            className="mt-4 inline-block bg-editorial-vermilion px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-white"
          >
            Sign In
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
          {/* Left Column: Scanner Terminal Form */}
          <div className="space-y-6 border border-editorial-border bg-editorial-surface p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Camera className="h-5 w-5 text-editorial-vermilion" />
                <h2 className="text-lg font-bold text-editorial-ink">
                  QR Gate Scanner Terminal
                </h2>
              </div>
              <span className="font-mono text-xs text-editorial-muted">
                Token: {qrInput ? extractQrToken(qrInput).slice(0, 13) + '…' : 'Ready'}
              </span>
            </div>

            {/* Active Passes Quick-Load */}
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-editorial-muted">
                1-Click Active Booking Passes ({activeBookings.length})
              </div>
              {activeBookings.length === 0 ? (
                <p className="mt-2 text-xs text-editorial-muted">
                  No active CONFIRMED or CHECKED_IN bookings found. Paste any QR token below or{' '}
                  <Link href="/" className="font-bold text-editorial-cobalt underline">
                    create a booking first
                  </Link>
                  .
                </p>
              ) : (
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {activeBookings.map((b) => (
                    <button
                      key={b.reservation_id}
                      type="button"
                      onClick={() => handleSelectBookingPass(b)}
                      className="flex items-center justify-between border border-editorial-border bg-editorial-bg p-3 text-left text-xs hover:border-editorial-ink"
                    >
                      <div>
                        <div className="font-bold text-editorial-ink">
                          #{b.reservation_id} · {b.lot_name}
                        </div>
                        <div className="text-[11px] text-editorial-muted">
                          Slot {b.slot_number} ({b.plate_number})
                        </div>
                      </div>
                      <span
                        className={`px-2 py-0.5 font-mono text-[10px] font-bold ${
                          b.status === 'CONFIRMED'
                            ? 'bg-editorial-cobalt text-white'
                            : 'bg-editorial-vermilion text-white'
                        }`}
                      >
                        {b.status}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <form onSubmit={handleExecuteScan} className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-editorial-muted">
                  QR Payload JSON or 36-Char UUID Token
                </label>
                <textarea
                  rows={3}
                  required
                  data-testid="qr-token-input"
                  value={qrInput}
                  onChange={(e) => setQrInput(e.target.value)}
                  placeholder='{"reservation_id":1,"qr_token":"xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"} or raw UUID'
                  className="mt-1 w-full border border-editorial-border bg-white p-3 font-mono text-xs text-editorial-ink focus:border-editorial-ink focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="block text-xs font-semibold text-editorial-muted">
                    Scan Mode
                  </label>
                  <select
                    value={scanAction}
                    onChange={(e) =>
                      setScanAction(e.target.value as 'AUTO' | 'CHECK_IN' | 'CHECK_OUT')
                    }
                    className="mt-1 w-full border border-editorial-border bg-white px-3 py-2 text-xs font-bold"
                  >
                    <option value="AUTO">AUTO (Smart Detect)</option>
                    <option value="CHECK_IN">Force CHECK_IN</option>
                    <option value="CHECK_OUT">Force CHECK_OUT</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-editorial-muted">
                    Payment Method
                  </label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                    className="mt-1 w-full border border-editorial-border bg-white px-3 py-2 text-xs font-bold"
                  >
                    <option value="UPI">UPI</option>
                    <option value="CARD">CARD</option>
                    <option value="WALLET">WALLET</option>
                    <option value="CASH">CASH</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-editorial-muted">
                    Simulated Scan Time
                  </label>
                  <input
                    type="datetime-local"
                    value={scanTime}
                    onChange={(e) => setScanTime(e.target.value)}
                    className="mt-1 w-full border border-editorial-border bg-white px-2.5 py-2 text-xs"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={busy || !qrInput.trim()}
                data-testid="execute-qr-scan-button"
                className="inline-flex w-full items-center justify-center gap-2 bg-editorial-ink py-3 text-xs font-bold uppercase tracking-wider text-editorial-bg hover:bg-editorial-vermilion disabled:opacity-50"
              >
                <ScanLine className="h-4 w-4" />
                <span>{busy ? 'Verifying QR Pass...' : 'Scan & Execute Gate Action'}</span>
              </button>
            </form>
          </div>

          {/* Right Column: Editorial Scan Result & Billing Dossier */}
          <div className="flex flex-col justify-between border border-editorial-border bg-editorial-surface p-6">
            <div>
              <div className="flex items-center justify-between border-b border-editorial-border pb-3">
                <span className="text-xs font-bold uppercase tracking-wider text-editorial-muted">
                  Gate Telemetry Output
                </span>
                <QrCode className="h-5 w-5 text-editorial-ink" />
              </div>

              {error && (
                <div className="mt-4 flex items-center gap-2 border border-editorial-vermilion bg-editorial-vermilion/10 p-4 text-xs font-bold text-editorial-vermilion">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {!scanResult && !error && (
                <div className="py-16 text-center text-xs text-editorial-muted">
                  Awaiting QR scan. Select an active pass on the left or paste a QR token to
                  verify check-in / check-out and overstay penalty calculation.
                </div>
              )}

              {scanResult && (
                <div data-testid="qr-scan-result" className="mt-6 space-y-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase text-editorial-cobalt">
                        <CheckCircle2 className="h-4 w-4" />
                        <span>Action Performed: {scanResult.action_performed}</span>
                      </div>
                      <h3 className="mt-1 font-serif text-2xl font-bold text-editorial-ink">
                        Reservation #{scanResult.reservation.reservation_id} ·{' '}
                        {scanResult.reservation.lot_name}
                      </h3>
                      <p className="text-xs text-editorial-muted">
                        Slot {scanResult.reservation.slot_number} ({scanResult.reservation.slot_type}
                        ) · Plate {scanResult.reservation.plate_number}
                      </p>
                    </div>

                    <div
                      className={`editorial-stamp ${
                        scanResult.action_performed === 'CHECK_IN'
                          ? 'border-editorial-cobalt text-editorial-cobalt'
                          : 'border-editorial-vermilion text-editorial-vermilion'
                      }`}
                    >
                      {scanResult.action_performed === 'CHECK_IN' ? 'IN' : 'OUT'}
                    </div>
                  </div>

                  {scanResult.billing && (
                    <div className="grid grid-cols-3 gap-4 border-y border-editorial-border py-4">
                      <div>
                        <div className="text-xs text-editorial-muted">Base · quoted</div>
                        <div className="editorial-kpi-num mt-1 text-3xl text-editorial-ink">
                          ₹{Number(scanResult.billing.base_amount).toFixed(0)}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-editorial-muted">Overstay · penalty</div>
                        <div className="editorial-kpi-num mt-1 text-3xl text-editorial-vermilion">
                          ₹{Number(scanResult.billing.penalty_amount).toFixed(0)}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-editorial-muted">Total · billed</div>
                        <div className="editorial-kpi-num mt-1 text-3xl text-editorial-cobalt">
                          ₹{Number(scanResult.billing.total_amount).toFixed(0)}
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="space-y-1 font-mono text-xs text-editorial-muted">
                    <div>New Status: {scanResult.reservation.status}</div>
                    <div>Booked Window: {scanResult.reservation.start_time} → {scanResult.reservation.end_time}</div>
                    <div>Checked In At: {scanResult.reservation.checked_in_at || '—'}</div>
                    <div>Checked Out At: {scanResult.reservation.checked_out_at || '—'}</div>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-6 bg-editorial-ink p-4 text-xs text-editorial-bg">
              <strong>DBMS Rule Enforced:</strong> Overstay penalties round up to the next full
              hour via <code className="text-editorial-lime">CEIL(TIMESTAMPDIFF / 3600)</code> inside{' '}
              <code className="text-editorial-lime">checkout_and_bill</code>.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
