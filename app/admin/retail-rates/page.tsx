// app/admin/retail-rates/page.tsx
// Step 44: Admin Retail Rate Explorer — query the Retail Rate DB via our proxy
// ---------------------------------------------------------------------------
// What this page does
//  - Calls /api/retail-rates with either tdsp (oncor|centerpoint|aep_n|aep_c|tnmp) or utilityID (EIA)
//  - Optional: verified_from (epoch or ISO like 2024-01-01), page
//  - Displays a mini table (id, name, dates, sector, component kinds) and lets you inspect/copy raw JSON
//
// Why
//  - Validate whether Retail Rate DB is complete enough to replace (or complement) nightly EFL scraping.
//  - Quick QA across TDSPs.
//
// Notes
//  - TX-only by design to match your current scope.
//  - No API keys on client; proxy holds the key.
//  - Safe to run in Cursor devbox.

'use client';

import { useCallback, useMemo, useState } from 'react';

type MiniRow = {
  id: string | number | null;
  name: string | null;
  effective: string | null;
  expiration: string | null;
  sector: string | null;
  components: { count: number; kinds?: { type: string; count: number }[] };
  source: string | null;
  verified_at: string | null;
};

type ApiResp = {
  query: any;
  count: number;
  mini: MiniRow[];
  raw: any;
  error?: string;
};

const TDSP_EIA_HINT: Record<string, number> = {
  oncor: 44372,
  centerpoint: 8901,
  aep_n: 20404,
  aep_c: 3278,
  tnmp: 40051,
};

export default function AdminRetailRatesPage() {
  // ---- form state
  const [mode, setMode] = useState<'tdsp' | 'utilityID'>('tdsp');
  const [tdsp, setTdsp] = useState<'oncor' | 'centerpoint' | 'aep_n' | 'aep_c' | 'tnmp'>('oncor');
  const [utilityID, setUtilityID] = useState<string>('');
  const [verifiedFrom, setVerifiedFrom] = useState<string>('');
  const [page, setPage] = useState<string>('1');

  // ---- results
  const [loading, setLoading] = useState(false);
  const [res, setRes] = useState<ApiResp | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canFetch = useMemo(() => {
    if (mode === 'tdsp') return Boolean(tdsp);
    const n = Number(utilityID);
    return Number.isFinite(n) && n > 0;
  }, [mode, tdsp, utilityID]);

  const doFetch = useCallback(async () => {
    if (!canFetch || loading) return;
    setLoading(true);
    setError(null);
    setRes(null);

    try {
      const qs = new URLSearchParams();
      if (mode === 'tdsp') qs.set('tdsp', tdsp);
      else qs.set('utilityID', String(Number(utilityID)));

      qs.set('state', 'TX');
      const p = Math.max(1, Number(page) || 1);
      qs.set('page', String(p));
      if (verifiedFrom.trim()) qs.set('verified_from', verifiedFrom.trim());

      const r = await fetch(`/api/retail-rates?${qs.toString()}`, { cache: 'no-store' });
      const text = await r.text();
      const json = safeJson(text) as ApiResp;

      if (!r.ok) throw new Error((json as any)?.error || r.statusText || 'Request failed');

      setRes(json);
    } catch (e: any) {
      setError(e?.message || 'Failed to fetch retail rates.');
    } finally {
      setLoading(false);
    }
  }, [canFetch, loading, mode, tdsp, utilityID, verifiedFrom, page]);

  return (
    <main className="min-h-screen w-full bg-gray-50">
      <div className="mx-auto max-w-6xl px-4 py-10">
        <h1 className="text-2xl md:text-3xl font-bold">Retail Rate DB explorer</h1>
        <p className="text-gray-600 mt-1">
          Query <code className="bg-gray-100 px-1 rounded">/api/retail-rates</code> and inspect tariff structures for TX.
        </p>

        {/* Query form */}
        <div className="mt-6 rounded-xl border bg-white p-4 md:p-6">
          <div className="flex flex-wrap items-center gap-4">
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="radio" checked={mode === 'tdsp'} onChange={() => setMode('tdsp')} />
              TDSP
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="radio" checked={mode === 'utilityID'} onChange={() => setMode('utilityID')} />
              Utility ID (EIA)
            </label>
          </div>

          {mode === 'tdsp' ? (
            <div className="grid md:grid-cols-3 gap-3 mt-3">
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
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  EIA hint: <code className="bg-gray-100 px-1 rounded">{TDSP_EIA_HINT[tdsp]}</code>
                </p>
              </div>
            </div>
          ) : (
            <div className="grid md:grid-cols-3 gap-3 mt-3">
              <div>
                <label className="block text-sm font-medium mb-1">Utility ID (EIA)</label>
                <input
                  className="w-full rounded-lg border px-3 py-2"
                  placeholder="e.g., 44372"
                  value={utilityID}
                  onChange={(e) => setUtilityID(e.target.value)}
                  inputMode="numeric"
                />
              </div>
            </div>
          )}

          <div className="grid md:grid-cols-3 gap-3 mt-3">
            <div>
              <label className="block text-sm font-medium mb-1">verified_from (epoch or ISO)</label>
              <input
                className="w-full rounded-lg border px-3 py-2"
                placeholder="2024-01-01  or  1704067200"
                value={verifiedFrom}
                onChange={(e) => setVerifiedFrom(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">page</label>
              <input
                className="w-full rounded-lg border px-3 py-2"
                value={page}
                onChange={(e) => setPage(e.target.value)}
                inputMode="numeric"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 mt-4">
            <button
              onClick={doFetch}
              disabled={!canFetch || loading}
              className={`rounded-lg px-4 py-2 text-white ${canFetch && !loading ? 'bg-black hover:opacity-90' : 'bg-gray-400 cursor-not-allowed'}`}
            >
              {loading ? 'Fetching…' : 'Fetch rates'}
            </button>
            {(error || res) && (
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setRes(null);
                }}
                className="rounded-lg px-3 py-2 border bg-white hover:bg-gray-50"
              >
                Reset
              </button>
            )}
          </div>

          {error && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-red-700 text-sm">
              {error}
            </div>
          )}
        </div>

        {/* Results */}
        {res && (
          <div className="mt-6 space-y-4">
            <div className="text-sm text-gray-700">
              <strong>{res.count}</strong> record{res.count === 1 ? '' : 's'} • query:{' '}
              <code className="bg-gray-100 px-1 rounded">{JSON.stringify(res.query)}</code>
            </div>

            <div className="overflow-x-auto rounded-xl border bg-white">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <Th>ID</Th>
                    <Th>Name</Th>
                    <Th>Sector</Th>
                    <Th>Effective</Th>
                    <Th>Expires</Th>
                    <Th>Verified</Th>
                    <Th>Components</Th>
                    <Th>Source</Th>
                    <Th>Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {res.mini.map((m, i) => (
                    <tr key={`${m.id ?? 'row'}-${i}`} className="border-t">
                      <Td className="font-mono text-xs">{m.id ?? '-'}</Td>
                      <Td>{m.name ?? '-'}</Td>
                      <Td>{m.sector ?? '-'}</Td>
                      <Td>{fmtDate(m.effective)}</Td>
                      <Td>{fmtDate(m.expiration)}</Td>
                      <Td>{fmtDate(m.verified_at)}</Td>
                      <Td>
                        <span className="inline-flex items-center rounded bg-gray-100 px-2 py-0.5 text-xs">
                          {m.components?.count ?? 0} items
                        </span>
                        {!!m.components?.kinds?.length && (
                          <details className="mt-1">
                            <summary className="text-xs text-gray-600 cursor-pointer">kinds</summary>
                            <ul className="ml-5 list-disc text-xs text-gray-700">
                              {m.components.kinds.map((k, idx) => (
                                <li key={idx}>
                                  {k.type} × {k.count}
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </Td>
                      <Td>
                        {m.source ? (
                          <a
                            className="underline hover:no-underline text-xs"
                            href={m.source}
                            target="_blank"
                            rel="noreferrer"
                          >
                            source
                          </a>
                        ) : (
                          '-'
                        )}
                      </Td>
                      <Td>
                        <RowActions index={i} raw={res.raw} />
                      </Td>
                    </tr>
                  ))}
                  {!res.mini.length && (
                    <tr>
                      <Td colSpan={9} className="text-center text-gray-500">
                        No results for this query (some utilities return 204 when empty).
                      </Td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <details className="rounded-xl border bg-white p-4">
              <summary className="cursor-pointer font-medium">Raw response JSON</summary>
              <pre className="mt-3 text-xs bg-gray-50 border rounded-lg p-3 overflow-x-auto">
                {JSON.stringify(res.raw, null, 2)}
              </pre>
            </details>
          </div>
        )}
      </div>
    </main>
  );
}

function Th({ children, className = '' }: any) {
  return <th className={`px-3 py-2 text-xs font-semibold text-gray-600 ${className}`}>{children}</th>;
}
function Td({
  children,
  align,
  colSpan,
  className = '',
}: {
  children: any;
  align?: 'left' | 'right' | 'center';
  colSpan?: number;
  className?: string;
}) {
  return (
    <td
      colSpan={colSpan}
      className={`px-3 py-2 ${align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : ''} ${className}`}
    >
      {children}
    </td>
  );
}

function RowActions({ index, raw }: { index: number; raw: any }) {
  const item = useMemo(() => {
    // Try to find array payload under common keys
    const arr = (raw?.results || raw?.data || raw?.items || []) as any[];
    if (Array.isArray(arr) && arr[index]) return arr[index];
    // fallback: maybe raw itself is an array
    if (Array.isArray(raw) && raw[index]) return raw[index];
    return null;
  }, [raw, index]);

  const viewJson = useCallback(() => {
    if (!item) return;
    const blob = new Blob([JSON.stringify(item, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener,noreferrer');
  }, [item]);

  const copyJson = useCallback(async () => {
    if (!item) return;
    await navigator.clipboard.writeText(JSON.stringify(item, null, 2));
    alert('Tariff JSON copied to clipboard.');
  }, [item]);

  return (
    <div className="flex items-center gap-2 text-xs">
      <button className="rounded border px-2 py-1 bg-white hover:bg-gray-50" onClick={viewJson} disabled={!item}>
        View
      </button>
      <button className="rounded border px-2 py-1 bg-white hover:bg-gray-50" onClick={copyJson} disabled={!item}>
        Copy
      </button>
    </div>
  );
}

function fmtDate(s: string | null) {
  if (!s) return '-';
  const d = new Date(s);
  return isNaN(d.valueOf()) ? s : d.toISOString().slice(0, 10);
}

function safeJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}
