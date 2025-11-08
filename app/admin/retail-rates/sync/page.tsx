// app/admin/retail-rates/sync/page.tsx
// Step 48: Admin UI — Batch sync Retail Rate DB for a TX TDSP
// -----------------------------------------------------------
// What this page does
//  - Lets an admin trigger the batch sync endpoint (Step 47) with controls:
//      • TDSP (or explicit EIA utility_id)
//      • verified_from (ISO like 2024-01-01 or epoch seconds)
//      • maxPages
//      • dry-run toggle
//      • ADMIN_SEED_TOKEN
//  - Displays a summary (counts, paths written) and previews of the first few RateConfigs.
//  - Provides a "Save result JSON" button for local download (client-side).
//
// Usage
//  - Navigate to /admin/retail-rates/sync
//  - Enter token = ADMIN_SEED_TOKEN (server env)
//  - Pick TDSP (or enter a utility_id), set options, click "Run Sync"
//
// Env (server)
//  - ADMIN_SEED_TOKEN
//  - WATTBUY_API_KEY

'use client';

import { useCallback, useMemo, useState } from 'react';

type SyncResponse = {
  query: {
    tdsp: string | null;
    utility_id: number | null;
    state: string;
    verified_from: number | null;
    maxPages: number;
    dryRun: boolean;
  };
  pagesFetched: number;
  totalItems: number;
  written: number;
  skipped: number;
  errors: { page: number; message: string }[];
  previews: any[];
  paths: string[];
  error?: string;
};

export default function RetailRatesSyncPage() {
  const [token, setToken] = useState('');
  const [useUtilityID, setUseUtilityID] = useState(false);

  const [tdsp, setTdsp] = useState<'oncor' | 'centerpoint' | 'aep_n' | 'aep_c' | 'tnmp' | 'unknown'>('oncor');
  const [utilityId, setUtilityId] = useState<string>(''); // EIA number (string input)
  const [verifiedFrom, setVerifiedFrom] = useState<string>('2024-01-01');
  const [maxPages, setMaxPages] = useState<number>(5);
  const [dryRun, setDryRun] = useState(true);

  const [loading, setLoading] = useState(false);
  const [resp, setResp] = useState<SyncResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = useMemo(() => {
    if (!token || loading) return false;
    if (useUtilityID) {
      return /^\d+$/.test(utilityId.trim());
    }
    return Boolean(tdsp);
  }, [token, loading, useUtilityID, utilityId, tdsp]);

  const runSync = useCallback(async () => {
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    setResp(null);
    try {
      const qs = new URLSearchParams();
      qs.set('dry', dryRun ? '1' : '0');

      const body: any = {
        maxPages,
        state: 'TX',
      };
      if (verifiedFrom.trim()) body.verified_from = verifiedFrom.trim();
      if (useUtilityID) {
        body.utility_id = Number(utilityId.trim());
      } else {
        body.tdsp = tdsp;
      }

      const r = await fetch(`/api/retail-rates/sync?${qs.toString()}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-seed-token': token.trim(),
        },
        body: JSON.stringify(body),
      });

      const text = await r.text();
      const json = safeJson(text) as SyncResponse;

      if (!r.ok) {
        throw new Error((json as any)?.error || r.statusText || 'Sync failed');
      }
      setResp(json);
    } catch (e: any) {
      setError(e?.message || 'Failed to run sync.');
    } finally {
      setLoading(false);
    }
  }, [canSubmit, dryRun, maxPages, tdsp, verifiedFrom, token, useUtilityID, utilityId]);

  const download = useCallback(() => {
    if (!resp) return;
    const blob = new Blob([JSON.stringify(resp, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const tag = useUtilityID ? `eia-${utilityId.trim()}` : tdsp;
    a.href = url;
    a.download = `retail-rates-sync-${tag}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [resp, useUtilityID, utilityId, tdsp]);

  return (
    <main className="min-h-screen w-full bg-gray-50">
      <div className="mx-auto max-w-6xl px-4 py-10">
        <h1 className="text-2xl md:text-3xl font-bold">Retail Rate DB — Batch Sync (TX)</h1>
        <p className="text-gray-600 mt-1">
          Trigger a multi-page pull from WattBuy's Retail Rate Database and normalize to{' '}
          <code className="bg-gray-100 px-1 rounded">/data/rates/&lt;tdsp&gt;/</code>.
        </p>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border bg-white p-4 space-y-3 md:col-span-2">
            <div>
              <label className="block text-sm font-medium mb-1">ADMIN_SEED_TOKEN</label>
              <input
                className="w-full rounded-lg border px-3 py-2"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="enter token"
                type="password"
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                id="use-utility-id"
                type="checkbox"
                checked={useUtilityID}
                onChange={(e) => setUseUtilityID(e.target.checked)}
              />
              <label htmlFor="use-utility-id" className="text-sm">
                Use EIA utility_id instead of TDSP shortcut
              </label>
            </div>

            {!useUtilityID ? (
              <div className="grid gap-2 md:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium mb-1">TDSP</label>
                  <select
                    className="w-full rounded-lg border px-3 py-2"
                    value={tdsp}
                    onChange={(e) => setTdsp(e.target.value as any)}
                  >
                    <option value="oncor">oncor</option>
                    <option value="centerpoint">centerpoint</option>
                    <option value="aep_n">aep_n (AEP North)</option>
                    <option value="aep_c">aep_c (AEP Central)</option>
                    <option value="tnmp">tnmp</option>
                    <option value="unknown">unknown</option>
                  </select>
                </div>
                <div className="opacity-60">
                  <label className="block text-sm font-medium mb-1">utility_id (EIA)</label>
                  <input
                    className="w-full rounded-lg border px-3 py-2"
                    value=""
                    disabled
                    placeholder="auto-mapped when using TDSP"
                  />
                </div>
              </div>
            ) : (
              <div className="grid gap-2 md:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium mb-1">utility_id (EIA)</label>
                  <input
                    className="w-full rounded-lg border px-3 py-2"
                    value={utilityId}
                    onChange={(e) => setUtilityId(e.target.value)}
                    placeholder="e.g., 44372 for Oncor"
                    inputMode="numeric"
                  />
                </div>
                <div className="opacity-60">
                  <label className="block text-sm font-medium mb-1">TDSP</label>
                  <input
                    className="w-full rounded-lg border px-3 py-2"
                    value="—"
                    disabled
                    placeholder="n/a when using utility_id"
                  />
                </div>
              </div>
            )}

            <div className="grid gap-2 md:grid-cols-3">
              <div>
                <label className="block text-sm font-medium mb-1">verified_from (ISO or epoch)</label>
                <input
                  className="w-full rounded-lg border px-3 py-2"
                  value={verifiedFrom}
                  onChange={(e) => setVerifiedFrom(e.target.value)}
                  placeholder="2024-01-01 or 1704067200"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Optional; upstream defaults to ~1 year lookback if omitted.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">maxPages</label>
                <input
                  className="w-full rounded-lg border px-3 py-2"
                  type="number"
                  min={1}
                  max={100}
                  value={maxPages}
                  onChange={(e) => setMaxPages(Math.max(1, Math.min(100, Number(e.target.value || 1))))}
                />
              </div>
              <div className="flex items-end gap-2">
                <input
                  id="dryrun"
                  type="checkbox"
                  checked={dryRun}
                  onChange={(e) => setDryRun(e.target.checked)}
                />
                <label htmlFor="dryrun" className="text-sm">
                  Dry-run (don't write files)
                </label>
              </div>
            </div>

            <div className="pt-2">
              <button
                onClick={runSync}
                disabled={!canSubmit}
                className={`rounded-lg px-4 py-2 text-white ${canSubmit ? 'bg-black hover:opacity-90' : 'bg-gray-400 cursor-not-allowed'}`}
              >
                {loading ? 'Syncing…' : 'Run Sync'}
              </button>
            </div>

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-700 text-sm">
                {error}
              </div>
            )}
          </div>

          {resp && (
            <div className="rounded-xl border bg-white p-4 space-y-3">
              <h2 className="font-semibold">Summary</h2>
              <div className="text-sm space-y-1">
                <div>
                  <span className="text-gray-500">Mode:</span>{' '}
                  {resp.query.dryRun ? (
                    <span className="inline-flex items-center rounded bg-gray-100 px-2 py-0.5 text-xs">dry-run</span>
                  ) : (
                    <span className="inline-flex items-center rounded bg-green-100 px-2 py-0.5 text-xs">written</span>
                  )}
                </div>
                <div>
                  <span className="text-gray-500">TDSP:</span> {resp.query.tdsp ?? '—'}
                </div>
                <div>
                  <span className="text-gray-500">utility_id:</span> {resp.query.utility_id ?? '—'}
                </div>
                <div>
                  <span className="text-gray-500">verified_from:</span> {resp.query.verified_from ?? '—'}
                </div>
                <div>
                  <span className="text-gray-500">pages:</span> {resp.pagesFetched}/{resp.query.maxPages}
                </div>
                <div>
                  <span className="text-gray-500">items:</span> {resp.totalItems}
                </div>
                <div>
                  <span className="text-gray-500">written:</span> {resp.written}{' '}
                  <span className="text-gray-500 ml-2">skipped:</span> {resp.skipped}
                </div>
                {!!resp.errors?.length && (
                  <details className="mt-2">
                    <summary className="cursor-pointer">Errors ({resp.errors.length})</summary>
                    <ul className="mt-2 list-disc pl-5 space-y-1">
                      {resp.errors.slice(0, 10).map((e, i) => (
                        <li key={i} className="text-xs">
                          p{e.page}: {e.message}
                        </li>
                      ))}
                      {resp.errors.length > 10 && (
                        <li className="text-xs text-gray-500">…{resp.errors.length - 10} more</li>
                      )}
                    </ul>
                  </details>
                )}
              </div>

              <button
                onClick={download}
                className="w-full rounded-lg bg-gray-900 text-white px-3 py-2 text-sm hover:opacity-90"
              >
                Save result JSON
              </button>
            </div>
          )}
        </div>

        {resp && (
          <div className="mt-6 grid gap-4">
            <div className="rounded-xl border bg-white p-4">
              <h2 className="font-semibold">Paths</h2>
              {resp.paths?.length ? (
                <pre className="mt-2 text-xs bg-gray-50 border rounded-lg p-3 overflow-x-auto">
                  {resp.paths.slice(0, 200).join('\n')}
                </pre>
              ) : (
                <p className="text-sm text-gray-600 mt-2">No paths (dry-run or zero writes).</p>
              )}
            </div>

            <div className="rounded-xl border bg-white p-4">
              <h2 className="font-semibold">Previews (first {resp.previews?.length ?? 0})</h2>
              {resp.previews?.length ? (
                <pre className="mt-2 text-xs bg-gray-50 border rounded-lg p-3 overflow-x-auto">
                  {JSON.stringify(resp.previews, null, 2)}
                </pre>
              ) : (
                <p className="text-sm text-gray-600 mt-2">No preview items returned.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

function safeJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}
