'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, useTransition } from 'react';
import {
  resolveSmtOrchestrateUiPhase,
  smtOrchestrateCoverageSuffix,
} from '@/components/smt/applySmtOrchestrateState';

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
  const [isDoneProcessing, setIsDoneProcessing] = useState(false);

  const applyOrchestratePayload = useCallback(
    (payload: any): boolean => {
      const uiPhase = resolveSmtOrchestrateUiPhase(payload);
      if (!uiPhase) return false;

      const coverageText = smtOrchestrateCoverageSuffix(payload);
      const usageMessage =
        (payload?.usage?.message as string | undefined) ??
        (payload?.message as string | undefined) ??
        null;

      if (uiPhase === 'ready') {
        setIsWaitingOnSmt(false);
        setIsProcessing(false);
        setIsDoneProcessing(false);
        setStatus('success');
        setMessage(
          usageMessage ||
            'Your full SMT history has been ingested and your usage has been refreshed.',
        );
        router.refresh();
        return true;
      }

      if (uiPhase === 'ingest_complete') {
        setIsWaitingOnSmt(false);
        setIsProcessing(false);
        setIsDoneProcessing(true);
        setStatus('success');
        setMessage((usageMessage || 'Done processing SMT data.') + coverageText);
        router.refresh();
        return true;
      }

      if (uiPhase === 'processing') {
        setIsWaitingOnSmt(false);
        setIsProcessing(true);
        setIsDoneProcessing(false);
        setStatus('success');
        setMessage(
          (usageMessage ||
            'We are processing your SMT usage. Historical backfill can take some time.') +
            coverageText,
        );
        return false;
      }

      setIsWaitingOnSmt(true);
      setIsProcessing(false);
      setIsDoneProcessing(false);
      setStatus('success');
      setMessage(usageMessage || 'Waiting for SMT interval data delivery.');
      return false;
    },
    [router],
  );

  useEffect(() => {
    if (!homeId) return;
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch('/api/user/usage/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ homeId }),
          cache: 'no-store',
        });
        const payload: any = await res.json().catch(() => null);
        if (cancelled || !payload?.ok) return;
        applyOrchestratePayload(payload);
      } catch {
        // non-fatal; button stays idle until user clicks refresh
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [homeId, applyOrchestratePayload]);

  function pollDelayMs(attempts: number): number {
    if (attempts < 6) return 5000;
    if (attempts < 20) return 15000;
    return 30000;
  }

  async function pollUsageReady(homeIdToPoll: string, attempts: number = 0): Promise<void> {
    if (attempts > 60) {
      setIsWaitingOnSmt(false);
      setIsProcessing(false);
      setIsDoneProcessing(false);
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
        if (applyOrchestratePayload(payload)) return;
      }
    } catch {
      // swallow transient polling errors
    }

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
    setIsDoneProcessing(false);

    startTransition(async () => {
      try {
        try {
          await fetch('/api/user/usage/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ homeId }),
            cache: 'no-store',
          });
        } catch {
          // non-blocking
        }

        const usageResponse = await fetch('/api/user/smt/orchestrate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ homeId, force: true }),
          cache: 'no-store',
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

        const pullEligibleNow = Boolean(usagePayload?.actions?.pullEligibleNow ?? true);
        const pullEligibleAt = usagePayload?.actions?.pullEligibleAt ?? null;
        if (!pullEligibleNow && (usagePayload?.usage?.ready || usagePayload?.phase === 'ready')) {
          applyOrchestratePayload(usagePayload);
          return;
        }

        if (applyOrchestratePayload(usagePayload)) return;

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
            : isDoneProcessing
              ? 'Done Processing'
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
