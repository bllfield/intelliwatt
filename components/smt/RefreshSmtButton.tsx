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
  const [isWaitingOnSmt, setIsWaitingOnSmt] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  function pollDelayMs(attempts: number): number {
    // Reduce DB pressure while still giving quick initial feedback.
    if (attempts < 6) return 5000; // ~30s fast checks
    if (attempts < 20) return 15000; // ~3.5 min
    return 30000; // thereafter
  }

  async function pollUsageReady(homeIdToPoll: string, attempts: number = 0): Promise<void> {
    // Cap polling to about ~20 minutes with backoff.
    if (attempts > 60) {
      setIsWaitingOnSmt(false);
      setIsProcessing(false);
      setStatus('error');
      setMessage('Still waiting on SMT data after several minutes. Try again later.');
      return;
    }

    try {
      const res = await fetch('/api/user/smt/orchestrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ homeId: homeIdToPoll }),
        cache: 'no-store',
      });

      const payload: any = await res.json().catch(() => null);
      if (res.ok && payload?.ok) {
        if (payload.phase === 'ready' || payload?.usage?.ready) {
          setIsWaitingOnSmt(false);
          setIsProcessing(false);
          setStatus('success');
          setMessage('Your full SMT history has been ingested and your usage has been refreshed.');
          router.refresh();
          return;
        }
        if (payload.phase === 'active_waiting_usage' || payload?.usage?.status === 'processing' || (payload?.usage?.rawFiles > 0 && !payload?.usage?.ready)) {
          // We have raw files but intervals are not fully ready; show "processing".
          setIsWaitingOnSmt(false);
          setIsProcessing(true);
          setStatus('success');
          const coverage = payload?.usage?.coverage;
          const coverageText =
            coverage?.start && coverage?.end
              ? ` Current coverage: ${String(coverage.start).slice(0, 10)} – ${String(coverage.end).slice(0, 10)} (${coverage.days ?? '?'} day(s)).`
              : '';
          setMessage(
            (payload?.usage?.message ||
              'We are processing your SMT usage. Historical backfill can take some time.') + coverageText,
          );
        }
      }
    } catch {
      // swallow transient polling errors; we will try again
    }

    // Try again with backoff.
    setTimeout(() => {
      void pollUsageReady(homeIdToPoll, attempts + 1);
    }, pollDelayMs(attempts));
  }

  const handleClick = () => {
    if (!homeId || isPending) return;
    setStatus('idle');
    setMessage(null);
    setIsWaitingOnSmt(false);
    setIsProcessing(false);

    startTransition(async () => {
      try {
        // Call usage refresh first so backfill + pull run immediately (no 60s orchestrate throttle).
        try {
          await fetch('/api/user/usage/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ homeId }),
            cache: 'no-store',
          });
        } catch {
          // Non-blocking; orchestrate below still runs for status and pull if needed.
        }

        const usageResponse = await fetch('/api/user/smt/orchestrate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ homeId, force: true }),
        });

        let usagePayload: any = null;
        try {
          usagePayload = await usageResponse.json();
        } catch {
          usagePayload = null;
        }

        if (!usageResponse.ok || !usagePayload?.ok) {
          throw new Error(
            (usagePayload as any)?.message ||
              (usagePayload as any)?.error ||
              'SMT orchestrator failed.',
          );
        }

        // If the server says we're in a 30-day cooldown (data is fresh and no gaps),
        // surface that and avoid long polling loops.
        const pullEligibleNow = Boolean(usagePayload?.actions?.pullEligibleNow ?? true);
        const pullEligibleAt = usagePayload?.actions?.pullEligibleAt ?? null;
        if (!pullEligibleNow && (usagePayload?.usage?.ready || usagePayload?.phase === 'ready')) {
          setIsWaitingOnSmt(false);
          setIsProcessing(false);
          setStatus('success');
          setMessage(
            (usagePayload?.usage?.message as string) ||
              (pullEligibleAt
                ? `Your SMT data is up to date. Next refresh available after ${String(pullEligibleAt).slice(0, 10)}.`
                : 'Your SMT data is up to date.'),
          );
          router.refresh();
          return;
        }

        // If SMT pull/backfill/normalize succeeded, start polling to see when
        // the data actually lands. This is primarily for the SMT path, which
        // may take some time between backfill request and SFTP delivery.
        setIsWaitingOnSmt(true);
        setStatus('success');
        setMessage(
          pullEligibleAt && !pullEligibleNow
            ? `Your SMT data is up to date. Next refresh available after ${String(pullEligibleAt).slice(0, 10)}.`
            : 'Refresh requested. If your data is older than 30 days or has gaps, we will pull updated SMT usage. This can take a few minutes.',
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


