'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import QuickAddressEntry from '@/components/QuickAddressEntry';

type Props = {
  houseAddressId?: string | null;
  initialAddress?: string | null;
};

type ManualState = 'idle' | 'submitting' | 'success' | 'error';

export default function SmtAddressCaptureCard({ houseAddressId = null, initialAddress = null }: Props) {
  const router = useRouter();
  const [addressReady, setAddressReady] = useState(Boolean(initialAddress && initialAddress.trim().length > 0));
  const [addressMessage, setAddressMessage] = useState<string | null>(null);
  const [manualState, setManualState] = useState<ManualState>('idle');
  const [manualMessage, setManualMessage] = useState<string | null>(null);

  const handleAddressResult = (result: any) => {
    if (result) {
      setAddressReady(true);
      setAddressMessage('Service address saved. We’ll refresh your utility details automatically.');
      setTimeout(() => router.refresh(), 600);
    }
  };

  const handleManualFallback = async () => {
    if (manualState === 'submitting') {
      return;
    }
    if (!addressReady) {
      setManualState('error');
      setManualMessage('Save your service address above before recording manual usage.');
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
    <div className="space-y-6 rounded-3xl border border-brand-navy/15 bg-white/90 p-4 shadow-[0_18px_60px_rgba(16,46,90,0.06)] max-[480px]:p-3 sm:p-6 md:p-8">
      <div>
        <h2 className="text-lg font-semibold text-brand-navy sm:text-xl">Add your service address</h2>
        <p className="mt-2 text-sm leading-relaxed text-brand-slate">
          We’ll match this address to your utility and pull the correct ESIID so Smart Meter Texas can connect.
          Manual entry is available if your utility connection isn’t ready yet.
        </p>
      </div>

      <QuickAddressEntry
        onAddressSubmitted={(value) => {
          setAddressReady(Boolean(value && value.trim().length > 0));
          if (!value) {
            setAddressMessage(null);
          }
        }}
        userAddress={initialAddress ?? undefined}
        redirectOnSuccess={false}
        houseIdForSave={houseAddressId ?? null}
        keepOtherHouses={false}
        onSaveResult={handleAddressResult}
      />

      {addressMessage ? (
        <div className="rounded-2xl border border-emerald-400/40 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-900">
          {addressMessage}
        </div>
      ) : null}

      <div className="rounded-2xl border border-brand-blue/15 bg-brand-blue/5 px-4 py-4 text-sm text-brand-navy shadow-[0_8px_24px_rgba(16,46,90,0.08)]">
        <p className="font-semibold text-brand-navy">Need to log usage manually?</p>
        <p className="mt-1 text-brand-navy/70">
          If your utility account isn’t ready yet, record a manual placeholder so your rewards stay active. You
          can replace it with live SMT data anytime.
        </p>
        <button
          type="button"
          onClick={handleManualFallback}
          disabled={manualState === 'submitting'}
          className="mt-3 inline-flex items-center rounded-full border border-brand-blue/50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-brand-blue transition hover:border-brand-blue hover:bg-brand-blue/10 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {manualState === 'submitting' ? 'Recording manual usage…' : 'Record manual usage for now'}
        </button>
        {manualMessage ? (
          <p
            className={`mt-2 text-xs ${
              manualState === 'success' ? 'text-emerald-700' : manualState === 'error' ? 'text-rose-600' : 'text-brand-navy/70'
            }`}
          >
            {manualMessage}
          </p>
        ) : null}
      </div>
    </div>
  );
}


