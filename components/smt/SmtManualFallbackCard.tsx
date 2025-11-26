'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Props = {
  houseAddressId?: string | null;
};

type ManualState = 'idle' | 'submitting' | 'success' | 'error';

export default function SmtManualFallbackCard({ houseAddressId = null }: Props) {
  const router = useRouter();
  const [manualState, setManualState] = useState<ManualState>('idle');
  const [manualMessage, setManualMessage] = useState<string | null>(null);

  const handleManualFallback = async () => {
    if (manualState === 'submitting') {
      return;
    }

    setManualState('submitting');
    setManualMessage(null);

    try {
      const manualResponse = await fetch('/api/user/manual-usage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          houseAddressId
            ? {
                houseId: houseAddressId,
              }
            : {},
        ),
      });

      if (!manualResponse.ok) {
        const error = await manualResponse.json().catch(() => ({ error: 'Unable to record manual usage' }));
        throw new Error(error?.error ?? 'Unable to record manual usage');
      }

      const manualData = await manualResponse.json();

      const entryResponse = await fetch('/api/user/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'smart_meter_connect',
          amount: 1,
          manualUsageId: manualData.id,
          ...(houseAddressId ? { houseId: houseAddressId } : {}),
        }),
      });

      if (!entryResponse.ok) {
        const error = await entryResponse.json().catch(() => ({ error: 'Unable to award manual entry' }));
        throw new Error(error?.error ?? 'Unable to award manual entry');
      }

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('entriesUpdated'));
      }

      setManualState('success');
      setManualMessage(
        'Manual usage placeholder saved. We’ll keep your rewards active while SMT access is pending.',
      );
      setTimeout(() => router.refresh(), 800);
    } catch (error) {
      console.error('Manual SMT fallback error', error);
      setManualState('error');
      setManualMessage(
        error instanceof Error ? error.message : 'We could not record manual usage right now. Please try again.',
      );
    }
  };

  return (
    <div className="rounded-3xl border-2 border-brand-blue bg-brand-navy px-5 py-5 text-sm text-brand-cyan shadow-[0_16px_45px_rgba(16,46,90,0.22)] sm:px-6 sm:py-6">
      <p className="font-semibold uppercase tracking-wide text-brand-cyan">Need to log usage manually?</p>
      <p className="mt-2 text-brand-cyan/80">
        If your utility account isn’t ready yet, record a manual placeholder so your rewards stay active. You can replace it
        with live SMT data anytime.
      </p>
      <button
        type="button"
        onClick={handleManualFallback}
        disabled={manualState === 'submitting'}
        className="mt-4 inline-flex items-center rounded-full border border-brand-blue px-5 py-2 text-xs font-semibold uppercase tracking-wide text-brand-blue transition hover:border-brand-blue/70 hover:bg-brand-blue/10 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {manualState === 'submitting' ? 'Recording manual usage…' : 'Record manual usage for now'}
      </button>
      {manualMessage ? (
        <p
          className={`mt-3 text-xs ${
            manualState === 'success' ? 'text-emerald-200' : manualState === 'error' ? 'text-rose-200' : 'text-brand-cyan/70'
          }`}
        >
          {manualMessage}
        </p>
      ) : null}
    </div>
  );
}


