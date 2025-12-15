'use client';

import { useCallback, useEffect, useState } from 'react';

interface IngestRun {
  id: string;
  createdAt: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  trigger: string;
  sourceKind: string;
  processedTdspCount: number;
  createdVersionCount: number;
  noopVersionCount: number;
  skippedTdspCount: number;
  errorTdspCount: number;
  changesJson?: any;
  errorsJson?: any;
  logs?: string | null;
}

interface TdspTariffVersionWithUtility {
  id: string;
  tdspId: string;
  tariffName: string | null;
  effectiveStart: string;
  effectiveEnd: string | null;
  sourceUrl: string | null;
  tdsp: {
    id: string;
    code: string;
    name: string;
  };
}

export default function TdspIngestAdminPage() {
  const [adminToken, setAdminToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<IngestRun | null>(null);
  const [recentRuns, setRecentRuns] = useState<IngestRun[]>([]);
  const [recentTariffs, setRecentTariffs] = useState<TdspTariffVersionWithUtility[]>([]);
  const [rawStatusJson, setRawStatusJson] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem('intelliwattAdminToken');
    if (stored) setAdminToken(stored);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const trimmed = adminToken.trim();
    if (trimmed.length > 0) {
      window.localStorage.setItem('intelliwattAdminToken', trimmed);
    } else {
      window.localStorage.removeItem('intelliwattAdminToken');
    }
  }, [adminToken]);

  const fetchStatus = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const headers: HeadersInit = {};
      const token = adminToken.trim();
      if (token) headers['x-admin-token'] = token;
      const res = await fetch('/api/admin/tdsp/ingest/status', { headers });
      const raw = await res.text();
      setRawStatusJson(raw || null);
      if (!res.ok) {
        setError(`Status error ${res.status}: ${raw || res.statusText}`);
        return;
      }
      const json = raw ? JSON.parse(raw) : null;
      if (!json || !json.ok) {
        setError('Status response not ok');
        return;
      }
      setLastRun(json.lastRun ?? null);
      setRecentRuns(json.recentRuns ?? []);
      setRecentTariffs(json.recentTariffVersions ?? []);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err ?? 'unknown error');
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [adminToken]);

  const runIngest = useCallback(async () => {
    try {
      setRunning(true);
      setError(null);
      const headers: HeadersInit = {};
      const token = adminToken.trim();
      if (token) headers['x-admin-token'] = token;
      const res = await fetch('/api/admin/tdsp/ingest', {
        method: 'POST',
        headers,
      });
      const raw = await res.text();
      if (!res.ok) {
        setError(`Ingest error ${res.status}: ${raw || res.statusText}`);
        return;
      }
      await fetchStatus();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err ?? 'unknown error');
      setError(msg);
    } finally {
      setRunning(false);
    }
  }, [adminToken, fetchStatus]);

  const formatDateTime = (iso?: string | null) => {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return iso;
      return d.toLocaleString();
    } catch {
      return iso;
    }
  };

  const durationSeconds = (start?: string, end?: string | null) => {
    if (!start || !end) return '—';
    try {
      const s = new Date(start).getTime();
      const e = new Date(end).getTime();
      if (!Number.isFinite(s) || !Number.isFinite(e)) return '—';
      const secs = Math.round((e - s) / 1000);
      return `${secs}s`;
    } catch {
      return '—';
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-50">
      <div className="mx-auto max-w-6xl px-4 py-8 space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">
            TDSP Tariff Ingest – PUCT Rate Reports
          </h1>
          <p className="text-sm text-slate-300 max-w-2xl">
            Daily ingest runner for TDSP PUCT Rate_Report PDFs. This panel lets you
            trigger a run, see the latest status, and inspect recent tariff versions.
          </p>
        </header>

        <section className="space-y-3 rounded-lg border border-slate-700 bg-slate-900/60 p-4">
          <h2 className="text-sm font-semibold tracking-wide text-slate-200">
            Admin token
          </h2>
          <p className="text-xs text-slate-400">
            Paste the admin token (same as main admin dashboard). It is stored in
            localStorage under <code>intelliwattAdminToken</code>.
          </p>
          <input
            type="password"
            value={adminToken}
            onChange={(e) => setAdminToken(e.target.value)}
            className="w-full rounded border border-slate-600 bg-slate-950 px-3 py-2 text-sm"
            placeholder="x-admin-token / TDSP_TARIFF_INGEST_ADMIN_TOKEN"
          />
          <div className="flex gap-3">
            <button
              onClick={fetchStatus}
              disabled={loading}
              className="rounded bg-sky-600 px-3 py-1.5 text-sm font-medium hover:bg-sky-500 disabled:opacity-60"
            >
              {loading ? 'Loading…' : 'Load status'}
            </button>
            <button
              onClick={runIngest}
              disabled={running || !adminToken.trim()}
              className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium hover:bg-emerald-500 disabled:opacity-60"
            >
              {running ? 'Running ingest…' : 'Run ingest now'}
            </button>
          </div>
          {error ? (
            <p className="text-xs text-red-400 whitespace-pre-wrap">{error}</p>
          ) : null}
        </section>

        {lastRun ? (
          <section className="space-y-2 rounded-lg border border-slate-700 bg-slate-900/60 p-4">
            <h2 className="text-sm font-semibold tracking-wide text-slate-200">
              Last ingest run
            </h2>
            <dl className="grid grid-cols-[140px,minmax(0,1fr)] gap-y-1 text-xs">
              <dt className="text-slate-400">Run ID</dt>
              <dd className="font-mono">{lastRun.id}</dd>
              <dt className="text-slate-400">Status</dt>
              <dd className="font-mono">{lastRun.status}</dd>
              <dt className="text-slate-400">Trigger</dt>
              <dd className="font-mono">{lastRun.trigger}</dd>
              <dt className="text-slate-400">Source</dt>
              <dd className="font-mono">{lastRun.sourceKind}</dd>
              <dt className="text-slate-400">Started</dt>
              <dd>{formatDateTime(lastRun.startedAt)}</dd>
              <dt className="text-slate-400">Finished</dt>
              <dd>{formatDateTime(lastRun.finishedAt)}</dd>
              <dt className="text-slate-400">Duration</dt>
              <dd>{durationSeconds(lastRun.startedAt, lastRun.finishedAt)}</dd>
              <dt className="text-slate-400">Counts</dt>
              <dd className="font-mono">
                processed={lastRun.processedTdspCount} created={lastRun.createdVersionCount}{' '}
                noop={lastRun.noopVersionCount} skipped={lastRun.skippedTdspCount}{' '}
                errors={lastRun.errorTdspCount}
              </dd>
              {lastRun.logs ? (
                <>
                  <dt className="text-slate-400">Logs</dt>
                  <dd className="font-mono whitespace-pre-wrap">{lastRun.logs}</dd>
                </>
              ) : null}
            </dl>

            {Array.isArray(lastRun.changesJson) && lastRun.changesJson.length > 0 ? (
              <div className="mt-3">
                <h3 className="text-xs font-semibold text-slate-200">
                  Changes (last run)
                </h3>
                <ul className="mt-1 space-y-1 text-[11px]">
                  {lastRun.changesJson.map((c: any, idx: number) => (
                    <li key={idx} className="font-mono text-slate-200">
                      {c.tdspCode}: {c.action} {c.effectiveStartISO ?? '—'}{' '}
                      {c.versionId ? `v=${c.versionId}` : ''}{' '}
                      {c.sha256 ? `sha=${c.sha256.slice(0, 10)}…` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {Array.isArray(lastRun.errorsJson) && lastRun.errorsJson.length > 0 ? (
              <div className="mt-3">
                <h3 className="text-xs font-semibold text-red-300">Errors (last run)</h3>
                <ul className="mt-1 space-y-1 text-[11px]">
                  {lastRun.errorsJson.map((e: any, idx: number) => (
                    <li key={idx} className="font-mono text-red-300">
                      {e.tdspCode}: {e.message}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        ) : (
          <section className="rounded-lg border border-slate-700 bg-slate-900/60 p-4 text-xs text-slate-300">
            No ingest runs recorded yet.
          </section>
        )}

        {recentRuns.length > 0 ? (
          <section className="space-y-2 rounded-lg border border-slate-700 bg-slate-900/60 p-4">
            <h2 className="text-sm font-semibold tracking-wide text-slate-200">
              Recent runs
            </h2>
            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-800 text-slate-200">
                    <th className="px-2 py-1 text-left">Run ID</th>
                    <th className="px-2 py-1 text-left">Status</th>
                    <th className="px-2 py-1 text-left">Trigger</th>
                    <th className="px-2 py-1 text-left">Started</th>
                    <th className="px-2 py-1 text-left">Finished</th>
                    <th className="px-2 py-1 text-left">Duration</th>
                    <th className="px-2 py-1 text-left">Counts</th>
                  </tr>
                </thead>
                <tbody>
                  {recentRuns.map((r) => (
                    <tr key={r.id} className="border-t border-slate-800">
                      <td className="px-2 py-1 font-mono">{r.id.slice(0, 8)}…</td>
                      <td className="px-2 py-1 font-mono">{r.status}</td>
                      <td className="px-2 py-1 font-mono">{r.trigger}</td>
                      <td className="px-2 py-1">{formatDateTime(r.startedAt)}</td>
                      <td className="px-2 py-1">{formatDateTime(r.finishedAt)}</td>
                      <td className="px-2 py-1">
                        {durationSeconds(r.startedAt, r.finishedAt)}
                      </td>
                      <td className="px-2 py-1 font-mono">
                        p={r.processedTdspCount} c={r.createdVersionCount} n={r.noopVersionCount}{' '}
                        s={r.skippedTdspCount} e={r.errorTdspCount}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {recentTariffs.length > 0 ? (
          <section className="space-y-2 rounded-lg border border-slate-700 bg-slate-900/60 p-4">
            <h2 className="text-sm font-semibold tracking-wide text-slate-200">
              Recent TDSP tariff versions
            </h2>
            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-800 text-slate-200">
                    <th className="px-2 py-1 text-left">TDSP</th>
                    <th className="px-2 py-1 text-left">Tariff</th>
                    <th className="px-2 py-1 text-left">Effective Start</th>
                    <th className="px-2 py-1 text-left">Effective End</th>
                    <th className="px-2 py-1 text-left">Source URL</th>
                  </tr>
                </thead>
                <tbody>
                  {recentTariffs.map((v) => (
                    <tr key={v.id} className="border-t border-slate-800">
                      <td className="px-2 py-1 font-mono">
                        {v.tdsp.code} – {v.tdsp.name}
                      </td>
                      <td className="px-2 py-1">{v.tariffName ?? '—'}</td>
                      <td className="px-2 py-1 font-mono">
                        {formatDateTime(v.effectiveStart)}
                      </td>
                      <td className="px-2 py-1 font-mono">
                        {formatDateTime(v.effectiveEnd)}
                      </td>
                      <td className="px-2 py-1">
                        {v.sourceUrl ? (
                          <a
                            href={v.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-sky-400 hover:underline"
                          >
                            open
                          </a>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        <section className="space-y-2 rounded-lg border border-slate-700 bg-slate-900/60 p-4">
          <h2 className="text-sm font-semibold tracking-wide text-slate-200">
            Debug (status JSON)
          </h2>
          <p className="text-xs text-slate-400">
            Raw JSON payload from <code>/api/admin/tdsp/ingest/status</code>.
          </p>
          <pre className="mt-1 max-h-72 overflow-auto rounded bg-slate-950 p-2 text-[10px] leading-snug">
            {rawStatusJson ?? '—'}
          </pre>
        </section>
      </div>
    </main>
  );
}


