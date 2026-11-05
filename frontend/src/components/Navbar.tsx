'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Bell,
  CalendarClock,
  Car,
  Heart,
  ListChecks,
  LogOut,
  Map,
  MapPin,
  QrCode,
  Repeat,
  ShieldCheck,
  User as UserIcon,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { apiGetNotifications, apiMarkAllNotificationsRead } from '@/lib/api';
import { NotificationItem } from '@/lib/types';

export function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, token, logout } = useAuth();

  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [showNotifDrawer, setShowNotifDrawer] = useState<boolean>(false);

  useEffect(() => {
    if (!token) {
      setUnreadCount(0);
      setNotifications([]);
      return;
    }

    let cancelled = false;
    const fetchNotifs = async () => {
      try {
        const res = await apiGetNotifications(token);
        if (!cancelled) {
          setUnreadCount(res.unread_count);
          setNotifications(res.notifications.slice(0, 6));
        }
      } catch {
        // Ignore background poll error
      }
    };

    fetchNotifs();
    const timer = setInterval(fetchNotifs, 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [token, pathname]);

  const handleMarkAllRead = async () => {
    if (!token) return;
    try {
      await apiMarkAllNotificationsRead(token);
      setUnreadCount(0);
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    } catch {
      // Ignore
    }
  };

  const handleLogout = async () => {
    await logout();
    router.push('/login');
  };

  const navLinks = [
    { href: '/', label: 'Lots', icon: MapPin },
    { href: '/map', label: 'Live Map', icon: Map },
    { href: '/scanner', label: 'QR Scanner', icon: QrCode },
    { href: '/series', label: 'Recurring', icon: Repeat },
    { href: '/reservations', label: 'Bookings', icon: CalendarClock },
    { href: '/vehicles', label: 'Vehicles', icon: Car },
    { href: '/favorites', label: 'Favorites', icon: Heart },
    { href: '/waitlist', label: 'Waitlist', icon: ListChecks },
    { href: '/notifications', label: 'Alerts', icon: Bell },
    { href: '/admin', label: 'Admin', icon: ShieldCheck },
  ];

  return (
    <header
      data-testid="main-navbar"
      className="sticky top-0 z-40 border-b border-editorial-border bg-editorial-bg/95 backdrop-blur"
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="border-b-2 border-editorial-cobalt pb-0.5 font-serif text-xl font-bold tracking-tight text-editorial-ink"
          >
            ParkPulse
          </Link>
          <span className="hidden text-editorial-muted sm:inline">|</span>
          <span className="hidden bg-editorial-lime px-2 py-0.5 font-mono text-[11px] font-bold text-editorial-ink sm:inline-block">
            BENGALURU · LIVE SSE
          </span>

          <nav className="hidden items-center gap-1 lg:flex">
            {navLinks.map((item) => {
              const Icon = item.icon;
              const isActive =
                item.href === '/' ? pathname === '/' : pathname?.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold transition ${
                    isActive
                      ? 'border-b-2 border-editorial-cobalt text-editorial-cobalt'
                      : 'text-editorial-muted hover:text-editorial-ink'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-2.5">
          {user ? (
            <>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowNotifDrawer((prev) => !prev)}
                  className="relative border border-editorial-border bg-editorial-surface p-2 text-editorial-ink hover:border-editorial-ink"
                  title="Notifications"
                >
                  <Bell className="h-4 w-4" />
                  {unreadCount > 0 && (
                    <span className="absolute -right-1.5 -top-1.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-editorial-vermilion px-1 font-mono text-[10px] font-bold text-white">
                      {unreadCount}
                    </span>
                  )}
                </button>

                {showNotifDrawer && (
                  <div className="absolute right-0 mt-2 w-80 border border-editorial-ink bg-editorial-surface p-4 shadow-xl">
                    <div className="mb-2 flex items-center justify-between border-b border-editorial-border pb-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-editorial-muted">
                        Alerts · {unreadCount} unread
                      </span>
                      <div className="flex items-center gap-2">
                        {unreadCount > 0 && (
                          <button
                            type="button"
                            onClick={handleMarkAllRead}
                            className="text-xs font-semibold text-editorial-cobalt hover:underline"
                          >
                            Read all
                          </button>
                        )}
                        <Link
                          href="/notifications"
                          onClick={() => setShowNotifDrawer(false)}
                          className="text-xs font-bold text-editorial-vermilion hover:underline"
                        >
                          Open Center →
                        </Link>
                      </div>
                    </div>
                    {notifications.length === 0 ? (
                      <p className="py-4 text-center text-xs text-editorial-muted">
                        No alerts recorded yet
                      </p>
                    ) : (
                      <ul className="max-h-64 space-y-2 overflow-y-auto">
                        {notifications.map((n) => (
                          <li
                            key={n.notification_id}
                            className={`border-l-2 p-2 text-xs ${
                              n.is_read
                                ? 'border-editorial-border bg-editorial-bg/60 text-editorial-muted'
                                : 'border-editorial-vermilion bg-white text-editorial-ink'
                            }`}
                          >
                            <div className="font-mono text-[10px] font-bold uppercase text-editorial-cobalt">
                              {n.type}
                            </div>
                            <div className="mt-0.5">{n.message}</div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>

              <div className="hidden items-center gap-2 border border-editorial-border bg-editorial-surface px-3 py-1.5 text-xs font-semibold text-editorial-ink sm:flex">
                <UserIcon className="h-3.5 w-3.5 text-editorial-vermilion" />
                <span>{user.full_name}</span>
                <span className="bg-editorial-lime px-1.5 py-0.5 font-mono text-[10px] font-bold text-editorial-ink">
                  {user.role}
                </span>
              </div>

              <button
                type="button"
                onClick={handleLogout}
                className="inline-flex items-center gap-1 border border-editorial-ink bg-editorial-ink px-3 py-1.5 text-xs font-semibold text-editorial-bg hover:bg-editorial-vermilion hover:border-editorial-vermilion"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>Exit</span>
              </button>
            </>
          ) : (
            <div className="flex items-center gap-2">
              <Link
                href="/login"
                className="border border-editorial-ink px-3 py-1.5 text-xs font-bold text-editorial-ink hover:bg-editorial-surface"
              >
                Sign In
              </Link>
              <Link
                href="/register"
                className="bg-editorial-vermilion px-3.5 py-1.5 text-xs font-bold text-white hover:opacity-90"
              >
                Register
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Mobile & Tablet Horizontal Scroll Nav */}
      <div className="flex items-center gap-2 overflow-x-auto border-t border-editorial-border bg-editorial-surface px-4 py-1.5 lg:hidden">
        {navLinks.map((item) => {
          const Icon = item.icon;
          const isActive =
            item.href === '/' ? pathname === '/' : pathname?.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex shrink-0 items-center gap-1 px-2 py-1 text-[11px] font-semibold ${
                isActive
                  ? 'bg-editorial-ink text-editorial-bg'
                  : 'text-editorial-muted'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </header>
  );
}
