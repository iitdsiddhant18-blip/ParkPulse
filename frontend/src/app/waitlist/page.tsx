'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { ListChecks, XCircle } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { apiCancelWaitlist, apiGetWaitlist } from '@/lib/api';
import { WaitlistEntry } from '@/lib/types';

export default function WaitlistPage() {
  const { user, token } = useAuth();
  const [entries, setEntries] = useState<WaitlistEntry[]>([]);

  const loadWaitlist = useCallback(async () => {
    if (!token) return;
    try {
      const res = await apiGetWaitlist(token);
      setEntries(res.waitlist);
    } catch {
      // Ignore
    }
  }, [token]);

  useEffect(() => {
    loadWaitlist();
  }, [loadWaitlist]);

  const handleCancel = async (waitlistId: number) => {
    if (!token) return;
    await apiCancelWaitlist(token, waitlistId);
    await loadWaitlist();
  };

  return (
    <div data-testid="waitlist-page" className="space-y-8">
      <div className="border-b border-editorial-border pb-6">
        <div className="text-xs font-bold uppercase tracking-wider text-editorial-muted">
          Queue Automation · Trigger trg_resv_after_update
        </div>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-editorial-ink">
          My Waitlist Queue
        </h1>
        <p className="mt-1 text-xs text-editorial-muted">
          When a matching slot frees up in your desired window, our database trigger automatically
          marks your entry NOTIFIED and dispatches an email alert.
        </p>
      </div>

      {!user ? (
        <div className="border border-editorial-ink bg-editorial-surface p-10 text-center">
          <p className="text-sm font-semibold text-editorial-ink">
            Sign in to view your waitlist entries.
          </p>
          <Link
            href="/login"
            className="mt-3 inline-block bg-editorial-vermilion px-4 py-2 text-xs font-bold uppercase text-white"
          >
            Sign In
          </Link>
        </div>
      ) : entries.length === 0 ? (
        <div className="border border-editorial-border bg-editorial-surface p-10 text-center">
          <ListChecks className="mx-auto h-8 w-8 text-editorial-muted" />
          <p className="mt-2 text-sm font-bold text-editorial-ink">No waitlist entries.</p>
        </div>
      ) : (
        <div className="divide-y divide-editorial-border border border-editorial-border bg-editorial-surface px-6 py-2">
          {entries.map((w) => (
            <div
              key={w.waitlist_id}
              className="flex flex-wrap items-center justify-between gap-4 py-4"
            >
              <div>
                <div className="flex items-center gap-2.5">
                  <span className="font-serif text-lg font-bold text-editorial-ink">
                    #{w.waitlist_id} · {w.lot_name}
                  </span>
                  <span
                    className={`px-2.5 py-0.5 font-mono text-xs font-bold ${
                      w.status === 'NOTIFIED'
                        ? 'bg-editorial-lime text-editorial-ink'
                        : 'bg-editorial-cobalt text-white'
                    }`}
                  >
                    {w.status}
                  </span>
                </div>
                <p className="mt-1 font-mono text-xs text-editorial-muted">
                  Vehicle: <strong className="text-editorial-ink">{w.plate_number}</strong> (
                  {w.vehicle_type}) · Window: {w.desired_start} → {w.desired_end}
                </p>
              </div>

              {(w.status === 'WAITING' || w.status === 'NOTIFIED') && (
                <button
                  type="button"
                  onClick={() => handleCancel(w.waitlist_id)}
                  className="inline-flex items-center gap-1 border border-editorial-vermilion bg-editorial-vermilion/10 px-3 py-1.5 text-xs font-bold text-editorial-vermilion"
                >
                  <XCircle className="h-3.5 w-3.5" />
                  <span>Cancel</span>
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
