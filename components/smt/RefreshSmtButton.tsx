'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

interface RefreshSmtButtonProps {
  homeId: string;
}

type RefreshState = 'idle' | 'success' | 'error';

export default function RefreshSmtButton({ homeId }: RefreshSmtButtonProps) {
  const router = useRouter();
  const [status, setStatus] = useState<RefreshState>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleClick = () => {
    if (!homeId || isPending) return;
    setStatus('idle');
    setMessage(null);

    startTransition(async () => {
      try {
        const response = await fetch('/api/smt/authorization/status', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ homeId }),
        });

        let payload: any = null;
        try {
          payload = await response.json();
        } catch {
          // ignore parse failure; handled below
        }

        if (!response.ok || !payload?.ok) {
          throw new Error(
            payload?.message ||
              payload?.error ||
              `Refresh failed with status ${response.status}`,
          );
        }

        const usageResponse = await fetch('/api/user/usage/refresh', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ homeId }),
        }).catch((error) => {
          throw new Error(
            error instanceof Error
              ? error.message
              : 'Failed to refresh usage history.',
          );
        });

        let usagePayload: any = null;
        try {
          usagePayload = await usageResponse.json();
        } catch {
          usagePayload = null;
        }

        if (!usageResponse.ok || !usagePayload?.ok) {
          throw new Error(
            usagePayload?.normalization?.result?.error ||
              usagePayload?.error ||
              `Usage refresh failed with status ${usageResponse.status}`,
          );
        }

        const normalizationWarning =
          usagePayload?.normalization?.result?.warning ?? null;

        setStatus('success');
        setMessage(
          normalizationWarning
            ? `SMT status refreshed. ${normalizationWarning}`
            : 'SMT data refreshed and usage reloaded.',
        );
        router.refresh();
      } catch (error) {
        setStatus('error');
        setMessage(
          error instanceof Error
            ? error.message
            : 'Failed to refresh Smart Meter Texas data.',
        );
      }
    });
  };

  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="inline-flex items-center rounded-full border border-brand-cyan/40 bg-brand-cyan/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-brand-cyan transition hover:border-brand-cyan hover:bg-brand-cyan/20 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? 'Refreshing…' : 'Refresh SMT Data'}
      </button>
      {status === 'success' && message ? (
        <span className="text-xs text-emerald-300">{message}</span>
      ) : null}
      {status === 'error' && message ? (
        <span className="text-xs text-rose-300">{message}</span>
      ) : null}
    </div>
  );
}


