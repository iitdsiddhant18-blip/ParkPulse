'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LogIn, KeyRound } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();

  const [email, setEmail] = useState<string>('rohan@example.com');
  const [password, setPassword] = useState<string>('Password@123');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(email, password);
      router.push('/');
    } catch (err: any) {
      setError(err?.message || 'Invalid credentials');
    } finally {
      setSubmitting(false);
    }
  };

  const fillDemo = (demoEmail: string, demoPass: string) => {
    setEmail(demoEmail);
    setPassword(demoPass);
    setError(null);
  };

  return (
    <div
      data-testid="login-page"
      className="mx-auto max-w-md border-2 border-editorial-ink bg-editorial-surface p-6 sm:p-8"
    >
      <div className="flex items-center justify-between border-b border-editorial-border pb-3">
        <div className="flex items-center gap-2 text-editorial-vermilion">
          <LogIn className="h-5 w-5" />
          <h1 className="font-serif text-2xl font-bold text-editorial-ink">
            Sign In to ParkPulse
          </h1>
        </div>
        <span className="bg-editorial-lime px-2 py-0.5 font-mono text-[10px] font-bold text-editorial-ink">
          JWT AUTH
        </span>
      </div>
      <p className="mt-2 text-xs text-editorial-muted">
        Sign in to reserve parking slots, scan QR passes, and manage your vehicles.
      </p>

      {error && (
        <div className="mt-4 border border-editorial-vermilion bg-editorial-vermilion/10 p-3 text-xs font-bold text-editorial-vermilion">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-5 space-y-4">
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-editorial-muted">
            Email Address
          </label>
          <input
            type="email"
            required
            data-testid="login-email-input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full border border-editorial-border bg-white px-3.5 py-2 text-sm text-editorial-ink focus:border-editorial-ink focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-editorial-muted">
            Password
          </label>
          <input
            type="password"
            required
            data-testid="login-password-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full border border-editorial-border bg-white px-3.5 py-2 text-sm text-editorial-ink focus:border-editorial-ink focus:outline-none"
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          data-testid="login-submit-button"
          className="w-full bg-editorial-ink py-2.5 text-xs font-bold uppercase tracking-wider text-editorial-bg hover:bg-editorial-vermilion disabled:opacity-50"
        >
          {submitting ? 'Signing in...' : 'Sign In'}
        </button>
      </form>

      {/* Quick Demo Credentials */}
      <div className="mt-6 border border-editorial-border bg-editorial-bg p-3.5">
        <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-editorial-muted">
          <KeyRound className="h-3.5 w-3.5 text-editorial-vermilion" />
          <span>1-Click Seed Accounts</span>
        </div>
        <div className="mt-2.5 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => fillDemo('rohan@example.com', 'Password@123')}
            className="border border-editorial-border bg-editorial-surface px-2.5 py-1.5 text-left text-xs hover:border-editorial-ink"
          >
            <div className="font-bold text-editorial-ink">Rohan (User)</div>
            <div className="font-mono text-[10px] text-editorial-muted">CAR + BIKE</div>
          </button>
          <button
            type="button"
            onClick={() => fillDemo('ananya@example.com', 'Password@123')}
            className="border border-editorial-border bg-editorial-surface px-2.5 py-1.5 text-left text-xs hover:border-editorial-ink"
          >
            <div className="font-bold text-editorial-ink">Ananya (User)</div>
            <div className="font-mono text-[10px] text-editorial-muted">SUV + EV</div>
          </button>
          <button
            type="button"
            onClick={() => fillDemo('karthik@example.com', 'Password@123')}
            className="border border-editorial-border bg-editorial-surface px-2.5 py-1.5 text-left text-xs hover:border-editorial-ink"
          >
            <div className="font-bold text-editorial-ink">Karthik (User)</div>
            <div className="font-mono text-[10px] text-editorial-muted">CAR</div>
          </button>
          <button
            type="button"
            onClick={() => fillDemo('admin@parkpulse.dev', 'Admin@123')}
            className="border border-editorial-cobalt bg-editorial-surface px-2.5 py-1.5 text-left text-xs hover:border-editorial-ink"
          >
            <div className="font-bold text-editorial-cobalt">Admin Account</div>
            <div className="font-mono text-[10px] text-editorial-muted">Full Access</div>
          </button>
        </div>
      </div>

      <p className="mt-5 text-center text-xs text-editorial-muted">
        Don&apos;t have an account?{' '}
        <Link href="/register" className="font-bold text-editorial-cobalt hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}
