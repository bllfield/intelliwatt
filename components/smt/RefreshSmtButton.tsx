'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

interface RefreshSmtButtonProps {
  homeId: string;
}

type RefreshState = 'idle' | 'success' | 'error';

type UsageRefreshResponse = {
  ok: boolean;
  homes?: Array<{
    homeId: string;
    authorizationRefreshed: boolean;
    authorizationMessage?: string;
    pull: {
      attempted: boolean;
      ok: boolean;
      status?: number;
      message?: string;
    };
  }>;
  normalization?: {
    attempted: boolean;
    ok: boolean;
    status?: number;
    message?: string;
  };
};

export default function RefreshSmtButton({ homeId }: RefreshSmtButtonProps) {
  const router = useRouter();
  const [status, setStatus] = useState<RefreshState>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isWaitingOnSmt, setIsWaitingOnSmt] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  async function pollUsageReady(homeIdToPoll: string, attempts: number = 0): Promise<void> {
    // Cap polling to about 8 minutes at 5s intervals (~96 attempts).
    if (attempts > 96) {
      setIsWaitingOnSmt(false);
      setIsProcessing(false);
      setStatus('error');
      setMessage('Still waiting on SMT data after several minutes. Try again later.');
      return;
    }

    try {
      const res = await fetch('/api/user/usage/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ homeId: homeIdToPoll }),
        cache: 'no-store',
      });

      const payload: any = await res.json().catch(() => null);
      if (res.ok && payload?.ok) {
        if (payload.status === 'ready' || payload.ready) {
          setIsWaitingOnSmt(false);
          setIsProcessing(false);
          setStatus('success');
          setMessage('Your SMT usage data has arrived and usage has been refreshed.');
          router.refresh();
          return;
        }
        if (payload.status === 'processing' || (payload.rawFiles > 0 && !payload.ready)) {
          // We have raw files but intervals are not fully ready; show "processing".
          setIsWaitingOnSmt(false);
          setIsProcessing(true);
          setStatus('success');
          setMessage(
            'We received your SMT data package and are processing your usage. This can take a few minutes.',
          );
        }
      }
    } catch {
      // swallow transient polling errors; we will try again
    }

    // Try again in 5 seconds.
    setTimeout(() => {
      void pollUsageReady(homeIdToPoll, attempts + 1);
    }, 5000);
  }

  const handleClick = () => {
    if (!homeId || isPending) return;
    setStatus('idle');
    setMessage(null);
    setIsWaitingOnSmt(false);
    setIsProcessing(false);

    startTransition(async () => {
      try {
        const statusResponse = await fetch('/api/smt/authorization/status', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ homeId }),
        });

        let statusPayload: any = null;
        try {
          statusPayload = await statusResponse.json();
        } catch {
          statusPayload = null;
        }

        if (!statusResponse.ok || !statusPayload?.ok) {
          throw new Error(
            statusPayload?.message ||
              statusPayload?.error ||
              `SMT status refresh failed (${statusResponse.status})`,
          );
        }

        const usageResponse = await fetch('/api/user/usage/refresh', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ homeId }),
        });

        let usagePayload: UsageRefreshResponse | null = null;
        try {
          usagePayload = (await usageResponse.json()) as UsageRefreshResponse;
        } catch {
          usagePayload = null;
        }

        if (!usageResponse.ok || !usagePayload?.ok) {
          throw new Error(
            usagePayload?.normalization?.message ||
              usagePayload?.homes?.[0]?.pull?.message ||
              'Usage refresh failed.',
          );
        }

        const homeSummary = usagePayload.homes?.find((home) => home.homeId === homeId);
        const summaryMessages: string[] = [];

        if (homeSummary) {
          if (homeSummary.authorizationRefreshed) {
            summaryMessages.push('SMT authorization refreshed.');
          } else if (homeSummary.authorizationMessage) {
            summaryMessages.push(homeSummary.authorizationMessage);
          }

          if (homeSummary.pull.attempted) {
            summaryMessages.push(
              homeSummary.pull.ok
                ? homeSummary.pull.message ?? 'SMT usage pull triggered.'
                : homeSummary.pull.message ?? 'SMT usage pull failed.',
            );
          }
        }

        if (usagePayload.normalization?.attempted) {
          summaryMessages.push(
            usagePayload.normalization.ok
              ? usagePayload.normalization.message ?? 'Usage normalization triggered.'
              : usagePayload.normalization.message ?? 'Usage normalization failed.',
          );
        }

        // If SMT pull/backfill/normalize succeeded, start polling to see when
        // the data actually lands. This is primarily for the SMT path, which
        // may take some time between backfill request and SFTP delivery.
        setIsWaitingOnSmt(true);
        setStatus('success');
        setMessage(
          (summaryMessages.filter(Boolean).join(' ') || 'SMT usage refresh triggered.') +
            ' We requested your SMT data and are waiting for it to be delivered. This can take a few minutes.',
        );
        void pollUsageReady(homeId);
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
        disabled={isPending || isWaitingOnSmt || isProcessing}
        className="inline-flex items-center rounded-full border border-brand-cyan/40 bg-brand-cyan/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-brand-cyan transition hover:border-brand-cyan hover:bg-brand-cyan/20 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending || isWaitingOnSmt
          ? 'Waiting on SMT…'
          : isProcessing
          ? 'Processing SMT Data…'
          : 'Refresh SMT Data'}
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


