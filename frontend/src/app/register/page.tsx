'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { UserPlus } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

export default function RegisterPage() {
  const router = useRouter();
  const { register } = useAuth();

  const [fullName, setFullName] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [phone, setPhone] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await register({
        full_name: fullName,
        email,
        phone: phone.trim() || undefined,
        password,
      });
      router.push('/vehicles');
    } catch (err: any) {
      setError(err?.message || 'Registration failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      data-testid="register-page"
      className="mx-auto max-w-md border-2 border-editorial-ink bg-editorial-surface p-6 sm:p-8"
    >
      <div className="flex items-center justify-between border-b border-editorial-border pb-3">
        <div className="flex items-center gap-2 text-editorial-vermilion">
          <UserPlus className="h-5 w-5" />
          <h1 className="font-serif text-2xl font-bold text-editorial-ink">
            Create Your Account
          </h1>
        </div>
        <span className="bg-editorial-lime px-2 py-0.5 font-mono text-[10px] font-bold text-editorial-ink">
          DRIVER SIGNUP
        </span>
      </div>
      <p className="mt-2 text-xs text-editorial-muted">
        Register to add your vehicles and reserve smart parking slots across Bengaluru.
      </p>

      {error && (
        <div className="mt-4 border border-editorial-vermilion bg-editorial-vermilion/10 p-3 text-xs font-bold text-editorial-vermilion">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-5 space-y-4">
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-editorial-muted">
            Full Name
          </label>
          <input
            type="text"
            required
            minLength={2}
            data-testid="register-name-input"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Aarav Sharma"
            className="mt-1 w-full border border-editorial-border bg-white px-3.5 py-2 text-sm text-editorial-ink focus:border-editorial-ink focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-editorial-muted">
            Email Address
          </label>
          <input
            type="email"
            required
            data-testid="register-email-input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="aarav@example.com"
            className="mt-1 w-full border border-editorial-border bg-white px-3.5 py-2 text-sm text-editorial-ink focus:border-editorial-ink focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-editorial-muted">
            Phone Number (optional)
          </label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="9000000010"
            className="mt-1 w-full border border-editorial-border bg-white px-3.5 py-2 text-sm text-editorial-ink focus:border-editorial-ink focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-editorial-muted">
            Password (min 8 characters)
          </label>
          <input
            type="password"
            required
            minLength={8}
            data-testid="register-password-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full border border-editorial-border bg-white px-3.5 py-2 text-sm text-editorial-ink focus:border-editorial-ink focus:outline-none"
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          data-testid="register-submit-button"
          className="w-full bg-editorial-vermilion py-2.5 text-xs font-bold uppercase tracking-wider text-white hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? 'Creating account...' : 'Create Account'}
        </button>
      </form>

      <p className="mt-5 text-center text-xs text-editorial-muted">
        Already have an account?{' '}
        <Link href="/login" className="font-bold text-editorial-cobalt hover:underline">
          Sign In
        </Link>
      </p>
    </div>
  );
}
