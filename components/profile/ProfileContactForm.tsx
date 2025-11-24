'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';

type Props = {
  initialEmail: string;
  initialPhone?: string | null;
  initialName?: string | null;
};

export function ProfileContactForm({ initialEmail, initialPhone, initialName }: Props) {
  const router = useRouter();
  const [email, setEmail] = useState(initialEmail);
  const [phone, setPhone] = useState(initialPhone ?? '');
  const [fullName, setFullName] = useState(initialName ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);

    try {
      const response = await fetch('/api/user/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, phone, fullName }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? 'Failed to save profile');
      }

      setMessage({ tone: 'success', text: 'Profile updated successfully.' });
      router.refresh();
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Failed to save profile.';
      setMessage({ tone: 'error', text });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col text-left text-xs font-semibold uppercase tracking-wide text-brand-cyan">
          Full name
          <input
            type="text"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            className="mt-1 rounded-lg border border-brand-cyan/40 bg-brand-navy px-3 py-2 text-sm text-brand-cyan placeholder:text-brand-cyan/50 focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
            placeholder="Name on your utility account"
            disabled={submitting}
          />
        </label>

        <label className="flex flex-col text-left text-xs font-semibold uppercase tracking-wide text-brand-cyan">
          Phone number
          <input
            type="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            className="mt-1 rounded-lg border border-brand-cyan/40 bg-brand-navy px-3 py-2 text-sm text-brand-cyan placeholder:text-brand-cyan/50 focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
            placeholder="(555) 555-5555"
            disabled={submitting}
          />
        </label>
      </div>

      <label className="flex flex-col text-left text-xs font-semibold uppercase tracking-wide text-brand-cyan">
        Email
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="mt-1 rounded-lg border border-brand-cyan/40 bg-brand-navy px-3 py-2 text-sm text-brand-cyan placeholder:text-brand-cyan/50 focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
          placeholder="you@example.com"
          disabled={submitting}
        />
      </label>

      {message ? (
        <div
          className={`rounded-lg border px-3 py-2 text-xs ${
            message.tone === 'success'
              ? 'border-emerald-400/50 bg-emerald-500/10 text-emerald-200'
              : 'border-rose-400/50 bg-rose-500/10 text-rose-100'
          }`}
        >
          {message.text}
        </div>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[11px] uppercase tracking-wide text-brand-cyan/70">
          Updating your email will immediately change your IntelliWatt login.
        </p>
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex items-center rounded-full border border-brand-cyan/60 bg-brand-cyan/10 px-5 py-2 text-xs font-semibold uppercase tracking-wide text-brand-cyan transition hover:border-brand-blue hover:text-brand-blue disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? 'Saving...' : 'Save changes'}
        </button>
      </div>
    </form>
  );
}

