'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Bell, CheckCheck, MailCheck, Send } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import {
  apiGetNotifications,
  apiMarkAllNotificationsRead,
  apiMarkNotificationRead,
  apiTriggerReminders,
} from '@/lib/api';
import { NotificationItem } from '@/lib/types';

export default function NotificationsCenterPage() {
  const { user, token } = useAuth();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [simRefTime, setSimRefTime] = useState<string>('');
  const [banner, setBanner] = useState<string | null>(null);

  const loadNotifications = useCallback(async () => {
    if (!token) return;
    try {
      const res = await apiGetNotifications(token);
      setNotifications(res.notifications);
      setUnreadCount(res.unread_count);
    } catch {
      // Ignore
    }
  }, [token]);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  const handleMarkSingleRead = async (notificationId: number) => {
    if (!token) return;
    await apiMarkNotificationRead(token, notificationId);
    await loadNotifications();
  };

  const handleMarkAllRead = async () => {
    if (!token) return;
    await apiMarkAllNotificationsRead(token);
    await loadNotifications();
  };

  const handleTriggerReminders = async () => {
    if (!token) return;
    try {
      const res = await apiTriggerReminders(token, {
        reference_time: simRefTime || undefined,
        window_minutes: 60,
      });
      setBanner(
        `Reminder job completed: ${res.reminders_created} REMINDER alerts created, ${res.emails_dispatched} emails dispatched via Nodemailer.`
      );
      await loadNotifications();
    } catch (err: any) {
      setBanner(err?.message || 'Could not trigger reminders');
    }
  };

  const filtered =
    typeFilter === 'ALL'
      ? notifications
      : notifications.filter((n) => n.type === typeFilter);

  return (
    <div data-testid="notifications-page" className="space-y-8">
      {/* Editorial Header */}
      <div className="border-b border-editorial-border pb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 text-xs font-semibold text-editorial-muted">
            <span className="border-b-2 border-editorial-cobalt pb-0.5 font-bold text-editorial-ink">
              Communication Funnel · Notification Center
            </span>
            <span>|</span>
            <span>Nodemailer Email Confirmations, Reminders, Waitlist &amp; Overstay Alerts</span>
          </div>
          <span className="bg-editorial-lime px-2.5 py-1 font-mono text-xs font-bold text-editorial-ink">
            {unreadCount} UNREAD ALERTS
          </span>
        </div>

        <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-editorial-ink sm:text-4xl">
          Turn every booking event into an{' '}
          <span className="text-editorial-vermilion">automated alert</span>
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-editorial-muted">
          Database triggers and backend jobs log confirmations, upcoming booking reminders,
          waitlist openings, and overstay penalties—and dispatch emails automatically via
          Nodemailer.
        </p>
      </div>

      {banner && (
        <div className="border border-editorial-cobalt bg-editorial-cobalt/10 p-4 text-xs font-bold text-editorial-cobalt">
          {banner}
        </div>
      )}

      {!user ? (
        <div className="border border-editorial-ink bg-editorial-surface p-10 text-center">
          <p className="text-sm font-semibold text-editorial-ink">
            Sign in to view your notifications and email dispatch log.
          </p>
          <Link
            href="/login"
            className="mt-4 inline-block bg-editorial-vermilion px-5 py-2.5 text-xs font-bold uppercase text-white"
          >
            Sign In
          </Link>
        </div>
      ) : (
        <>
          {/* Filter & Action Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-4 border border-editorial-border bg-editorial-surface p-4">
            <div className="flex flex-wrap items-center gap-1.5">
              {[
                'ALL',
                'BOOKING_CONFIRMED',
                'REMINDER',
                'WAITLIST_AVAILABLE',
                'OVERSTAY',
                'PAYMENT',
                'CANCELLED',
                'EXPIRED',
              ].map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTypeFilter(t)}
                  className={`px-2.5 py-1 font-mono text-[11px] font-bold transition ${
                    typeFilter === t
                      ? 'bg-editorial-ink text-editorial-bg'
                      : 'bg-editorial-bg text-editorial-muted hover:text-editorial-ink'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            {unreadCount > 0 && (
              <button
                type="button"
                onClick={handleMarkAllRead}
                data-testid="mark-all-read-button"
                className="inline-flex items-center gap-1.5 bg-editorial-cobalt px-3.5 py-1.5 text-xs font-bold text-white"
              >
                <CheckCheck className="h-4 w-4" />
                <span>Mark All {unreadCount} Read</span>
              </button>
            )}
          </div>

          {/* Admin Reminder Job Trigger Bar */}
          {user.role === 'ADMIN' && (
            <div className="flex flex-wrap items-center justify-between gap-3 border border-editorial-ink bg-editorial-surface p-4">
              <div className="text-xs">
                <strong className="text-editorial-ink">
                  Admin Reminder &amp; Email Dispatch Simulator:
                </strong>{' '}
                <span className="text-editorial-muted">
                  Send reminders for CONFIRMED bookings starting within 60 minutes of reference
                  time.
                </span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="datetime-local"
                  value={simRefTime}
                  onChange={(e) => setSimRefTime(e.target.value)}
                  className="border border-editorial-border bg-white px-2.5 py-1.5 text-xs"
                />
                <button
                  type="button"
                  onClick={handleTriggerReminders}
                  className="inline-flex items-center gap-1.5 bg-editorial-vermilion px-3.5 py-1.5 text-xs font-bold text-white"
                >
                  <Send className="h-3.5 w-3.5" />
                  <span>Send Reminders</span>
                </button>
              </div>
            </div>
          )}

          {/* Editorial Action-Plan Checklist Rows (Slide 4 Pattern) */}
          <div className="border border-editorial-border bg-editorial-surface px-6 py-2">
            {filtered.length === 0 ? (
              <div className="py-12 text-center text-xs text-editorial-muted">
                <Bell className="mx-auto mb-2 h-6 w-6 text-editorial-muted" />
                No notifications match the selected filter.
              </div>
            ) : (
              <div className="divide-y divide-editorial-border">
                {filtered.map((n) => {
                  const isAlert =
                    n.type === 'OVERSTAY' || n.type === 'EXPIRED' || n.type === 'CANCELLED';
                  return (
                    <div
                      key={n.notification_id}
                      data-testid={`notification-row-${n.notification_id}`}
                      className="grid grid-cols-1 items-center gap-4 py-4 md:grid-cols-12"
                    >
                      <div className="md:col-span-2">
                        <span
                          className={`font-mono text-xs font-bold uppercase ${
                            isAlert ? 'text-editorial-vermilion' : 'text-editorial-cobalt'
                          }`}
                        >
                          {n.type.replace(/_/g, ' ')}
                        </span>
                      </div>

                      <div className="md:col-span-7">
                        <div
                          className={`text-sm ${
                            n.is_read ? 'font-normal text-editorial-muted' : 'font-bold text-editorial-ink'
                          }`}
                        >
                          {n.message}
                        </div>
                        <div className="mt-1 flex items-center gap-3 text-xs text-editorial-muted">
                          <span>Alert #{n.notification_id}</span>
                          {n.reservation_id && <span>· Booking #{n.reservation_id}</span>}
                          <span>· {n.created_at}</span>
                          {n.email_sent && (
                            <span className="inline-flex items-center gap-1 font-semibold text-editorial-cobalt">
                              <MailCheck className="h-3.5 w-3.5" /> Email Sent
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center justify-end gap-3 md:col-span-3">
                        <div
                          className={`editorial-stamp ${
                            isAlert
                              ? 'border-editorial-vermilion text-editorial-vermilion'
                              : 'border-editorial-cobalt text-editorial-cobalt'
                          }`}
                        >
                          {n.is_read ? 'READ' : 'NEW'}
                        </div>

                        {!n.is_read && (
                          <button
                            type="button"
                            onClick={() => handleMarkSingleRead(n.notification_id)}
                            className="border border-editorial-ink px-3 py-1.5 text-xs font-bold text-editorial-ink hover:bg-editorial-ink hover:text-editorial-bg"
                          >
                            Mark Read
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
