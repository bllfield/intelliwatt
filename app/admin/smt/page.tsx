'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import {
  fetchSmtPullStatuses,
  normalizeLatestServerAction,
  fetchNormalizeStatuses,
  fetchRecentIntervals,
  fetchPipelineDebug,
  type SmtPullStatusesPayload,
  type NormalizeRunSummary,
  type IntervalPreview,
  type PipelineDebug,
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
  const [normStatusLimit, setNormStatusLimit] = useState(5);
  const [normStatus, setNormStatus] = useState<NormalizeRunSummary | null>(null);
  const [normStatusError, setNormStatusError] = useState<string | null>(null);
  const [isNormStatusPending, startNormStatusTransition] = useTransition();
  const [intervalPreview, setIntervalPreview] = useState<IntervalPreview | null>(null);
  const [intervalPreviewError, setIntervalPreviewError] = useState<string | null>(null);
  const [isIntervalPreviewPending, startIntervalPreviewTransition] = useTransition();
  const [pipelineDebug, setPipelineDebug] = useState<PipelineDebug | null>(null);
  const [pipelineDebugError, setPipelineDebugError] = useState<string | null>(null);
  const [isPipelineDebugPending, startPipelineDebugTransition] = useTransition();

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

  const handleRefreshNormalizeStatus = useCallback(
    (nextLimit?: number) => {
      const effectiveLimit = Math.max(1, Math.min(50, nextLimit ?? normStatusLimit));
      setNormStatusLimit(effectiveLimit);
      setNormStatusError(null);
      startNormStatusTransition(async () => {
        try {
          const payload = await fetchNormalizeStatuses(effectiveLimit);
          setNormStatus(payload);
        } catch (err: any) {
          setNormStatusError(err?.message ?? String(err));
        }
      });
    },
    [normStatusLimit],
  );

  useEffect(() => {
    handleRefreshNormalizeStatus();
  }, [handleRefreshNormalizeStatus]);

  const handleRefreshIntervalPreview = useCallback(() => {
    setIntervalPreviewError(null);
    startIntervalPreviewTransition(async () => {
      try {
        const payload = await fetchRecentIntervals(2, 400);
        setIntervalPreview(payload);
      } catch (err: any) {
        setIntervalPreviewError(err?.message ?? String(err));
      }
    });
  }, []);

  useEffect(() => {
    handleRefreshIntervalPreview();
  }, [handleRefreshIntervalPreview]);

  const handleRefreshPipelineDebug = useCallback(() => {
    setPipelineDebugError(null);
    startPipelineDebugTransition(async () => {
      try {
        const payload = await fetchPipelineDebug(50, 25);
        setPipelineDebug(payload);
      } catch (err: any) {
        setPipelineDebugError(err?.message ?? String(err));
      }
    });
  }, []);

  useEffect(() => {
    handleRefreshPipelineDebug();
  }, [handleRefreshPipelineDebug]);

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
                  <th className="px-3 py-2 text-left font-medium">Details</th>
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
                  meterRows.map((row) => {
                    const rawPayload = row.rawPayload as Record<string, unknown> | null | undefined;
                    const stderr =
                      rawPayload && typeof rawPayload === 'object'
                        ? (rawPayload._stderr as string | undefined) ??
                          (rawPayload.stderr as string | undefined)
                        : undefined;
                    const stdout =
                      rawPayload && typeof rawPayload === 'object'
                        ? (rawPayload.stdout as string | undefined)
                        : undefined;
                    const hasDetails = Boolean(stderr || stdout);

                    return (
                      <tr key={row.id} className="odd:bg-white even:bg-neutral-50">
                        <td className="px-3 py-2 font-mono text-[11px] uppercase md:text-xs">{row.esiid}</td>
                        <td className="px-3 py-2 text-xs md:text-sm">
                          <span
                            className={`font-semibold ${row.status === 'error' ? 'text-red-600' : 'text-neutral-800'}`}
                          >
                            {row.status}
                          </span>
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
                        <td className="px-3 py-2 text-[11px] text-neutral-600 md:text-xs">
                          {hasDetails ? (
                            <details className="space-y-1">
                              <summary className="cursor-pointer text-neutral-700 underline-offset-2 hover:underline">
                                View log
                              </summary>
                              {stderr ? (
                                <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-neutral-900 p-2 font-mono text-[10px] text-neutral-100 md:text-[11px]">
                                  {stderr}
                                </pre>
                              ) : null}
                              {stdout && !stderr ? (
                                <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-neutral-900 p-2 font-mono text-[10px] text-neutral-100 md:text-[11px]">
                                  {stdout}
                                </pre>
                              ) : null}
                            </details>
                          ) : (
                            <span className="text-neutral-400">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
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
            <h2 className="text-lg font-semibold text-neutral-900">Pipeline Debug</h2>
            <p className="text-sm text-neutral-600">End-to-end ingest visibility: raw files, interval counts, latest rows.</p>
            {pipelineDebug?.stats ? (
              <p className="text-xs text-neutral-500">
                Intervals: {pipelineDebug.stats.totalIntervals} · ESIIDs: {pipelineDebug.stats.uniqueEsiids} ·
                Window: {pipelineDebug.stats.tsMin ?? '—'} → {pipelineDebug.stats.tsMax ?? '—'}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={handleRefreshPipelineDebug}
            disabled={isPipelineDebugPending}
            className="rounded border border-neutral-300 bg-neutral-50 px-3 py-1.5 text-sm font-medium text-neutral-700 transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPipelineDebugPending ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        {pipelineDebugError && (
          <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">
            {pipelineDebugError}
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-neutral-800">Raw files (latest)</h3>
            <div className="max-h-80 overflow-auto rounded border border-neutral-200 bg-neutral-900 p-3 text-xs text-neutral-100">
              {pipelineDebug?.rawFiles?.length ? (
                pipelineDebug.rawFiles.map((file) => (
                  <div key={file.id} className="border-b border-neutral-800 py-1 last:border-none">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[11px] text-neutral-200">{file.filename}</span>
                      <span className="text-[11px] text-neutral-400">{(file.sizeBytes ?? 0).toLocaleString()} bytes</span>
                    </div>
                    <div className="text-[11px] text-neutral-400">{file.source ?? 'smt'} · {file.createdAt}</div>
                    <div className="text-[10px] text-neutral-500">sha256 {file.sha256}</div>
                  </div>
                ))
              ) : (
                <div className="text-neutral-400">No raw files found.</div>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-neutral-800">Latest intervals</h3>
            <div className="max-h-80 overflow-auto rounded border border-neutral-200 bg-neutral-900 p-3 text-xs text-neutral-100">
              {pipelineDebug?.intervals?.length ? (
                pipelineDebug.intervals.map((row) => (
                  <div key={`${row.esiid}-${row.meter}-${row.ts}`} className="flex items-center gap-3 border-b border-neutral-800 py-1 last:border-none">
                    <span className="min-w-[150px] font-mono text-[11px] text-neutral-300">{row.ts}</span>
                    <span className="w-28 font-mono text-[11px] uppercase text-neutral-200">{row.esiid}</span>
                    <span className="w-16 font-mono text-[11px] uppercase text-neutral-300">{row.meter}</span>
                    <span className="w-16 text-right font-mono text-[11px] text-neutral-100">{row.kwh.toFixed(3)}</span>
                    <span className="flex-1 text-[11px] text-neutral-400">{row.source ?? 'smt'} · {row.createdAt}</span>
                  </div>
                ))
              ) : (
                <div className="text-neutral-400">No intervals found.</div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-3 rounded border border-neutral-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-neutral-900">Normalize Status (dry run)</h2>
            <p className="text-sm text-neutral-600">Shows the last raw SMT files and what normalization would do (no writes).</p>
            {normStatus?.tsMax ? (
              <p className="text-xs text-neutral-500">Coverage {normStatus.tsMin ?? '—'} → {normStatus.tsMax ?? '—'}</p>
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
                value={normStatusLimit}
                onChange={(event) => handleRefreshNormalizeStatus(Number(event.target.value) || 5)}
              />
            </label>
            <button
              type="button"
              onClick={() => handleRefreshNormalizeStatus(normStatusLimit)}
              disabled={isNormStatusPending}
              className="rounded border border-neutral-300 bg-neutral-50 px-3 py-1.5 text-sm font-medium text-neutral-700 transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isNormStatusPending ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>

        {normStatusError && (
          <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">
            {normStatusError}
          </div>
        )}

        {normStatus ? (
          <div className="overflow-hidden rounded border border-neutral-200 bg-white">
            <table className="min-w-full divide-y divide-neutral-200 text-xs md:text-sm">
              <thead className="bg-neutral-100 text-neutral-700">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">File</th>
                  <th className="px-3 py-2 text-left font-medium">Records</th>
                  <th className="px-3 py-2 text-left font-medium">Inserted</th>
                  <th className="px-3 py-2 text-left font-medium">Skipped</th>
                  <th className="px-3 py-2 text-left font-medium">kWh</th>
                  <th className="px-3 py-2 text-left font-medium">tsMin → tsMax</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {normStatus.files.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-4 text-center text-neutral-500">
                      No raw SMT files found.
                    </td>
                  </tr>
                ) : (
                  normStatus.files.map((file) => (
                    <tr key={file.id} className="odd:bg-white even:bg-neutral-50">
                      <td className="px-3 py-2 text-[11px] font-mono uppercase md:text-xs">{file.filename}</td>
                      <td className="px-3 py-2 text-xs md:text-sm">{file.records}</td>
                      <td className="px-3 py-2 text-xs md:text-sm">{file.inserted}</td>
                      <td className="px-3 py-2 text-xs md:text-sm">{file.skipped}</td>
                      <td className="px-3 py-2 text-xs md:text-sm">{file.kwh.toFixed(3)}</td>
                      <td className="px-3 py-2 text-[11px] text-neutral-600 md:text-xs">
                        {file.tsMin ?? '—'} → {file.tsMax ?? '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot className="bg-neutral-50 text-neutral-800">
                <tr>
                  <td className="px-3 py-2 font-semibold">Totals</td>
                  <td className="px-3 py-2 text-xs md:text-sm">{normStatus.filesProcessed}</td>
                  <td className="px-3 py-2 text-xs md:text-sm">{normStatus.intervalsInserted}</td>
                  <td className="px-3 py-2 text-xs md:text-sm">{normStatus.duplicatesSkipped}</td>
                  <td className="px-3 py-2 text-xs md:text-sm">{normStatus.totalKwh.toFixed(3)}</td>
                  <td className="px-3 py-2 text-[11px] text-neutral-600 md:text-xs">
                    {normStatus.tsMin ?? '—'} → {normStatus.tsMax ?? '—'}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : null}
      </div>

      <div className="space-y-3 rounded border border-neutral-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-neutral-900">Normalized Interval Preview</h2>
            <p className="text-sm text-neutral-600">Last 2 days of 15-minute intervals (post-normalization).</p>
            {intervalPreview?.tsMin ? (
              <p className="text-xs text-neutral-500">Coverage {intervalPreview.tsMin} → {intervalPreview.tsMax}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={handleRefreshIntervalPreview}
            disabled={isIntervalPreviewPending}
            className="rounded border border-neutral-300 bg-neutral-50 px-3 py-1.5 text-sm font-medium text-neutral-700 transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isIntervalPreviewPending ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        {intervalPreviewError && (
          <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">
            {intervalPreviewError}
          </div>
        )}

        <div className="max-h-80 overflow-auto rounded border border-neutral-200 bg-neutral-900 p-3 text-xs text-neutral-100">
          {intervalPreview?.rows?.length ? (
            intervalPreview.rows.map((row) => (
              <div key={`${row.esiid}-${row.meter}-${row.ts}`} className="flex gap-3 border-b border-neutral-800 py-1 last:border-none">
                <span className="min-w-[170px] font-mono text-[11px] text-neutral-300">{row.ts}</span>
                <span className="w-24 font-mono text-[11px] uppercase text-neutral-200">{row.esiid}</span>
                <span className="w-24 font-mono text-[11px] uppercase text-neutral-300">{row.meter}</span>
                <span className="w-16 text-right font-mono text-[11px] text-neutral-100">{row.kwh.toFixed(3)}</span>
                <span className="flex-1 text-[11px] text-neutral-400">{row.source ?? 'smt'}</span>
              </div>
            ))
          ) : (
            <div className="text-neutral-400">No interval data found in the last 2 days.</div>
          )}
        </div>
      </div>

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
