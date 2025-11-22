'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import {
  fetchSmtPullStatuses,
  normalizeLatestServerAction,
  type SmtPullStatusesPayload,
} from './actions';

type MonitorPayload = SmtPullStatusesPayload;

export default function AdminSmtToolsPage() {
  const [isPending, startTransition] = useTransition();
  const [isMonitorPending, startMonitorTransition] = useTransition();
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(5);
  const [monitorLimit, setMonitorLimit] = useState(10);
  const [monitor, setMonitor] = useState<MonitorPayload | null>(null);
  const [monitorError, setMonitorError] = useState<string | null>(null);

  const handleNormalize = () => {
    setError(null);
    setResult(null);
    startTransition(async () => {
      try {
        const payload = await normalizeLatestServerAction(limit);
        setResult(payload);
      } catch (err: any) {
        setError(err?.message ?? String(err));
      }
    });
  };

  const handleRefreshMonitor = useCallback(
    (nextLimit?: number) => {
      const effectiveLimit = Math.max(1, Math.min(50, nextLimit ?? monitorLimit));
      setMonitorLimit(effectiveLimit);
      setMonitorError(null);
      startMonitorTransition(async () => {
        try {
          const payload = await fetchSmtPullStatuses(effectiveLimit);
          setMonitor(payload);
        } catch (err: any) {
          setMonitorError(err?.message ?? String(err));
        }
      });
    },
    [monitorLimit],
  );

  useEffect(() => {
    handleRefreshMonitor();
    const interval = setInterval(() => {
      handleRefreshMonitor(monitorLimit);
    }, 15000);
    return () => clearInterval(interval);
  }, [handleRefreshMonitor, monitorLimit]);

  const renderMonitorTable = () => {
    if (!monitor) {
      return null;
    }

    const rows = monitor.authorizations ?? [];
    const meterRows = monitor.meterInfos ?? [];

    return (
      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-neutral-700">Authorizations &amp; Backfills</h3>
          <div className="overflow-hidden rounded border border-neutral-200 bg-white">
            <table className="min-w-full divide-y divide-neutral-200 text-xs md:text-sm">
              <thead className="bg-neutral-100 text-neutral-700">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">ESIID</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-left font-medium">Meter</th>
                  <th className="px-3 py-2 text-left font-medium">Updated</th>
                  <th className="px-3 py-2 text-left font-medium">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-4 text-center text-neutral-500">
                      No SMT authorizations found.
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.id} className="odd:bg-white even:bg-neutral-50">
                      <td className="px-3 py-2 font-mono text-[11px] uppercase md:text-xs">
                        {row.esiid}
                      </td>
                      <td className="px-3 py-2 text-xs md:text-sm">
                        <span className="font-semibold text-neutral-800">{row.smtStatus ?? 'pending'}</span>
                      </td>
                      <td className="px-3 py-2 text-xs md:text-sm">
                        <div className="font-mono text-[11px] uppercase md:text-xs">
                          {row.meterInfo?.meterNumber ?? '—'}
                        </div>
                        {row.meterInfo?.status ? (
                          <div className="text-[11px] text-neutral-500 md:text-xs">
                            {row.meterInfo.status}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-xs text-neutral-500 md:text-sm">
                        {new Date(row.updatedAt).toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-neutral-600 md:text-xs">
                        {row.smtStatusMessage ?? row.houseAddress?.addressLine1 ?? '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-neutral-700">Meter Info Jobs</h3>
          <div className="overflow-hidden rounded border border-neutral-200 bg-white">
            <table className="min-w-full divide-y divide-neutral-200 text-xs md:text-sm">
              <thead className="bg-neutral-100 text-neutral-700">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">ESIID</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-left font-medium">Updated</th>
                  <th className="px-3 py-2 text-left font-medium">Meter</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {meterRows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-4 text-center text-neutral-500">
                      No meter info jobs found.
                    </td>
                  </tr>
                ) : (
                  meterRows.map((row) => (
                    <tr key={row.id} className="odd:bg-white even:bg-neutral-50">
                      <td className="px-3 py-2 font-mono text-[11px] uppercase md:text-xs">{row.esiid}</td>
                      <td className="px-3 py-2 text-xs md:text-sm">
                        <span className="font-semibold text-neutral-800">{row.status}</span>
                        {row.errorMessage ? (
                          <div className="text-[11px] text-red-600 md:text-xs">{row.errorMessage}</div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-xs text-neutral-500 md:text-sm">
                        {new Date(row.updatedAt).toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-neutral-700 md:text-xs">
                        {row.meterNumber ?? '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6 p-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">SMT Tools</h1>
        <p className="text-sm text-neutral-600">
          Trigger normalization runs without exposing the admin token in-browser. Uses server actions to proxy your request.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <span>Limit</span>
          <input
            type="number"
            min={1}
            max={100}
            className="w-24 rounded border px-2 py-1"
            value={limit}
            onChange={(event) => setLimit(Number(event.target.value) || 1)}
          />
        </label>

        <button
          type="button"
          onClick={handleNormalize}
          disabled={isPending}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? 'Normalizing…' : `Normalize Latest (limit=${limit})`}
        </button>
      </div>

      {error && (
        <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {result && (
        <pre className="max-h-[480px] overflow-auto rounded bg-neutral-900 p-4 text-xs text-neutral-100">
{JSON.stringify(result, null, 2)}
        </pre>
      )}

      <div className="space-y-3 rounded border border-neutral-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-neutral-900">Live Pull Monitor</h2>
            <p className="text-sm text-neutral-600">
              Recent SMT authorizations, backfills, and meter-info jobs. Refreshes every 15 seconds.
            </p>
            {monitor?.fetchedAt ? (
              <p className="text-xs text-neutral-500">
                Last fetched&nbsp;
                {new Date(monitor.fetchedAt).toLocaleTimeString()}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <span>Rows</span>
              <input
                type="number"
                min={1}
                max={50}
                className="w-20 rounded border px-2 py-1"
                value={monitorLimit}
                onChange={(event) => handleRefreshMonitor(Number(event.target.value) || 10)}
              />
            </label>
            <button
              type="button"
              onClick={() => handleRefreshMonitor(monitorLimit)}
              disabled={isMonitorPending}
              className="rounded border border-neutral-300 bg-neutral-50 px-3 py-1.5 text-sm font-medium text-neutral-700 transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isMonitorPending ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>

        {monitorError && (
          <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">
            {monitorError}
          </div>
        )}

        {renderMonitorTable()}
      </div>
    </div>
  );
}
