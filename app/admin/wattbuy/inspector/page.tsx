'use client';

import { useEffect, useMemo, useState } from 'react';

type Json = any;
type InspectResult = {
  ok?: boolean;
  where?: Record<string, string>;
  headers?: Record<string, string | null>;
  topType?: string;
  topKeys?: string[];
  foundListPath?: string;
  count?: number;
  sample?: any[];
  note?: string;
  status?: number;
  error?: string;
};

function useLocalToken(key = 'iw_admin_token') {
  const [token, setToken] = useState('');
  useEffect(() => { setToken(localStorage.getItem(key) || ''); }, []);
  useEffect(() => { if (token) localStorage.setItem(key, token); }, [token]);
  return { token, setToken };
}

function pretty(x: Json) {
  try { return JSON.stringify(x, null, 2); } catch { return String(x); }
}

export default function WattBuyInspector() {
  const { token, setToken } = useLocalToken();
  const [address, setAddress] = useState('9514 Santa Paula Dr');
  const [unit, setUnit] = useState('');
  const [city, setCity] = useState('Fort Worth');
  const [state, setState] = useState('tx'); // lowercase per spec
  const [zip, setZip] = useState('76116');
  const [utilityID, setUtilityID] = useState('44372'); // Oncor
  const [wattkey, setWattkey] = useState('');
  const [probeMode, setProbeMode] = useState<'test' | 'live'>('test');
  const [result, setResult] = useState<InspectResult | null>(null);
  const [raw, setRaw] = useState<Json | null>(null);
  const [loading, setLoading] = useState(false);
  // Batch EFL parser harness (admin tool): default to STORE semantics, with optional dry run.
  const [batchDryRun, setBatchDryRun] = useState(false);
  const [batchLimit, setBatchLimit] = useState(500);
  // Do not expose per-run cap: the API uses a time budget to avoid Vercel timeouts and
  // returns nextStartIndex so we can auto-continue until all offers are processed.
  const batchProcessLimit = 500;
  const [batchStartIndex, setBatchStartIndex] = useState(0);
  const [batchRunAll, setBatchRunAll] = useState(true);
  const [batchForceReparseTemplates, setBatchForceReparseTemplates] = useState(false);
  const [batchResults, setBatchResults] = useState<any[] | null>(null);

  const ready = useMemo(() => Boolean(token), [token]);

  async function hit(path: string) {
    if (!token) {
      alert('Need admin token');
      return;
    }
    setLoading(true);
    setResult(null);
    setRaw(null);
    try {
      const res = await fetch(path, {
        headers: { 'x-admin-token': token },
      });
      const data = await res.json();
      setResult(data);
      setRaw(data);
    } catch (err: any) {
      console.error(err);
      setResult({ ok: false, error: err?.message || 'Unknown error' });
    } finally {
      setLoading(false);
    }
  }

  async function hitEflProbe() {
    if (!token) {
      alert('Need admin token');
      return;
    }

    const trimmedWattkey = wattkey.trim();
    const trimmedAddress = address.trim();
    const trimmedCity = city.trim();
    const trimmedState = state.trim();
    const trimmedZip = zip.trim();

    if (!trimmedWattkey && (!trimmedAddress || !trimmedCity || !trimmedState || !trimmedZip)) {
      alert('Provide either wattkey or a full address (address, city, state, zip).');
      return;
    }

    setLoading(true);
    setResult(null);
    setRaw(null);

    try {
      const body: any = { mode: probeMode };
      if (trimmedWattkey) {
        body.wattkey = trimmedWattkey;
      } else {
        body.address = trimmedAddress;
        body.city = trimmedCity;
        body.state = trimmedState;
        body.zip = trimmedZip;
      }

      const res = await fetch('/api/admin/wattbuy/efl-probe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': token,
        },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      setResult(data);
      setRaw(data);
    } catch (err: any) {
      console.error(err);
      setResult({ ok: false, error: err?.message || 'Unknown error' });
    } finally {
      setLoading(false);
    }
  }

  async function hitBatchEflParse() {
    if (!token) {
      alert('Need admin token');
      return;
    }

    const trimmedAddress = address.trim();
    const trimmedCity = city.trim();
    const trimmedState = state.trim();
    const trimmedZip = zip.trim();

    if (!trimmedAddress || !trimmedCity || !trimmedState || !trimmedZip) {
      alert('Provide full address (address, city, state, zip) for batch EFL parse.');
      return;
    }

    try {
      // Run once or auto-continue until the API reports no truncation.
      setLoading(true);
      setResult(null);
      setRaw(null);
      setBatchResults(null);

      const mode = batchDryRun ? 'DRY_RUN' : 'STORE_TEMPLATES_ON_PASS';

      let next = batchStartIndex;
      let lastData: any = null;
      const allRows: any[] = [];

      while (true) {
        const body = {
          address: {
            line1: trimmedAddress,
            city: trimmedCity,
            state: trimmedState,
            zip: trimmedZip,
          },
          offerLimit: batchLimit,
          startIndex: next,
          processLimit: batchProcessLimit,
          timeBudgetMs: 240_000,
          dryRun: batchDryRun,
          forceReparseTemplates: batchForceReparseTemplates,
          // Back-compat: keep mode for older deployments.
          mode,
        };

        const res = await fetch('/api/admin/wattbuy/offers-batch-efl-parse', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-admin-token': token,
          },
          body: JSON.stringify(body),
        });

        const data = await res.json();
        lastData = data;
        setRaw(data);
        if (!res.ok || !data.ok) {
          setResult({ ok: false, error: (data as any)?.error || 'Batch EFL parse failed.' });
          return;
        }

        const rows = Array.isArray(data.results) ? data.results : [];
        allRows.push(...rows);
        setBatchResults([...allRows]);

        if (typeof data.nextStartIndex === 'number' && Number.isFinite(data.nextStartIndex)) {
          next = data.nextStartIndex;
          setBatchStartIndex(next);
        }

        setResult({
          ok: true,
          note: [
            `Processed ${data.processedCount} EFLs (scanned ${data.scannedCount ?? data.processedCount} offers) in mode=${data.mode}.`,
            batchForceReparseTemplates ? `forceReparseTemplates=true` : null,
            data.truncated && typeof data.nextStartIndex === 'number'
              ? `Continuing… nextStartIndex=${data.nextStartIndex}.`
              : 'Done.',
          ]
            .filter(Boolean)
            .join(' '),
        });

        if (!batchRunAll) break;
        if (!data.truncated) break;
        // Small delay between chunks to reduce burst pressure.
        await new Promise((r) => setTimeout(r, 150));
      }

      setRaw(lastData);
    } catch (err: any) {
      console.error(err);
      setResult({ ok: false, error: err?.message || 'Unknown batch error' });
    } finally {
      setLoading(false);
    }
  }

  const qsAddr = useMemo(() => {
    const params = new URLSearchParams({
      address,
      city,
      state,
      zip,
    });
    if (unit.trim()) {
      params.set('unit', unit.trim());
    }
    return params.toString();
  }, [address, unit, city, state, zip]);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <h1 className="text-2xl font-semibold">WattBuy Inspector</h1>

      <div className="rounded-2xl border bg-white p-4 text-sm">
        <div className="font-medium">Fact Card parsing tools moved</div>
        <div className="text-xs text-gray-600 mt-1">
          Use the unified ops page to run batch parses, inspect the review queue, browse templates, and load any plan into the manual loader:{" "}
          <a className="text-brand-navy underline" href="/admin/efl/fact-cards">
            /admin/efl/fact-cards
          </a>
        </div>
      </div>

      <section className="grid md:grid-cols-2 gap-4">
        <div className="p-4 rounded-2xl border">
          <h2 className="font-medium mb-3">Auth</h2>
          <label className="block text-sm mb-1">x-admin-token</label>
          <input
            className="w-full rounded-lg border px-3 py-2"
            type="password"
            placeholder="paste admin token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          {!ready && <p className="text-sm text-red-600 mt-2">Token required.</p>}
        </div>

        <div className="p-4 rounded-2xl border">
          <h2 className="font-medium mb-3">Regulated Utilities</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm mb-1">utilityID</label>
              <input className="w-full rounded-lg border px-3 py-2" value={utilityID} onChange={(e)=>setUtilityID(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm mb-1">state (lowercase)</label>
              <input className="w-full rounded-lg border px-3 py-2" value={state} onChange={(e)=>setState(e.target.value)} />
            </div>
          </div>
          <button
            onClick={() => hit(`/api/admin/wattbuy/retail-rates-test?utilityID=${encodeURIComponent(utilityID)}&state=${encodeURIComponent(state)}`)}
            className="mt-3 px-3 py-2 rounded-lg border hover:bg-gray-50"
            disabled={loading || !ready}
          >
            {loading ? 'Loading…' : 'Regulated Utility Rates'}
          </button>
        </div>
      </section>

      <section className="p-4 rounded-2xl border">
        <h2 className="font-medium mb-3">Deregulated Plan Tools</h2>
        <div className="grid md:grid-cols-5 gap-3">
          <div>
            <label className="block text-sm mb-1">Address</label>
            <input className="w-full rounded-lg border px-3 py-2" value={address} onChange={(e)=>setAddress(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm mb-1">Unit / Apt</label>
            <input className="w-full rounded-lg border px-3 py-2" value={unit} onChange={(e)=>setUnit(e.target.value)} placeholder="#123, Apt B" />
          </div>
          <div>
            <label className="block text-sm mb-1">City</label>
            <input className="w-full rounded-lg border px-3 py-2" value={city} onChange={(e)=>setCity(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm mb-1">State (lowercase)</label>
            <input className="w-full rounded-lg border px-3 py-2" value={state} onChange={(e)=>setState(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm mb-1">ZIP</label>
            <input className="w-full rounded-lg border px-3 py-2" value={zip} onChange={(e)=>setZip(e.target.value)} />
          </div>
        </div>
        <div className="flex flex-wrap gap-3 mt-3">
          <button
            onClick={() => hit(`/api/admin/wattbuy/retail-rates-by-address?${qsAddr}`)}
            className="px-3 py-2 rounded-lg border hover:bg-gray-50"
            disabled={loading || !ready}
          >
            {loading ? 'Loading…' : 'Regulated Utility Rates'}
          </button>
          <button
            onClick={() => hit(`/api/admin/wattbuy/electricity/info?${qsAddr}&housing_chars=true&utility_list=true`)}
            className="px-3 py-2 rounded-lg border hover:bg-gray-50"
            disabled={loading || !ready}
          >
            {loading ? 'Loading…' : 'Utility & ESIID Info'}
          </button>
          <button
            onClick={() => hit(`/api/admin/wattbuy/electricity?${qsAddr}`)}
            className="px-3 py-2 rounded-lg border hover:bg-gray-50"
            disabled={loading || !ready}
          >
            {loading ? 'Loading…' : 'Electricity Estimates'}
          </button>
          <button
            onClick={() => hit(`/api/admin/wattbuy/offers-by-address?${qsAddr}&all=true`)}
            className="px-3 py-2 rounded-lg border hover:bg-gray-50"
            disabled={loading || !ready}
          >
            {loading ? 'Loading…' : 'Deregulated Plan Options'}
          </button>
          <button
            onClick={() => hit(`/api/admin/wattbuy/property-bundle?${qsAddr}`)}
            className="px-3 py-2 rounded-lg border hover:bg-gray-50 bg-green-50"
            disabled={loading || !ready}
          >
            {loading ? 'Loading…' : 'Property Bundle (WattBuy → SMT usage → offers)'}
          </button>
        </div>

        <div className="mt-4 rounded-2xl border border-dashed border-blue-200 bg-blue-50/40 p-4 space-y-3">
          <h3 className="font-medium text-sm text-blue-900">EFL PlanRules Probe (WattBuy → EFL Engine)</h3>
          <p className="text-xs text-blue-900/80">
            This calls <code className="rounded bg-white/60 px-1 py-0.5 text-[10px]">POST /api/admin/wattbuy/efl-probe</code>,
            fetches WattBuy offers, follows each plan&apos;s EFL URL, and runs the EFL Fact Card
            engine. Use it to verify which plans already have cached <code className="rounded bg-white/60 px-1 py-0.5 text-[10px]">RatePlan.rateStructure</code>
            and which require manual review.
          </p>
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <label className="block text-xs font-medium mb-1 text-blue-900">
                wattkey (optional)
              </label>
              <input
                className="w-full rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-xs"
                placeholder="wattkey from electricity API"
                value={wattkey}
                onChange={(e) => setWattkey(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1 text-blue-900">
                Mode
              </label>
              <select
                className="w-full rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-xs"
                value={probeMode}
                onChange={(e) => setProbeMode(e.target.value as 'test' | 'live')}
              >
                <option value="test">test (no DB writes)</option>
                <option value="live">live (upsert RatePlan)</option>
              </select>
            </div>
            <div className="flex items-end">
              <button
                type="button"
                onClick={hitEflProbe}
                disabled={loading || !ready}
                className="inline-flex items-center rounded-lg border border-blue-400 bg-blue-600/90 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? 'Probing…' : 'Run EFL Probe'}
              </button>
            </div>
          </div>
          <p className="text-[11px] text-blue-900/70">
            If <code className="rounded bg-white/60 px-1 py-0.5 text-[10px]">wattkey</code> is blank, the probe will
            use the address, city, state, and ZIP from above. Results appear in the Inspector
            Summary and Raw Response panes.
          </p>

          <div className="mt-4 border-t border-blue-100 pt-3">
            <h4 className="font-medium text-xs text-blue-900 mb-2">
              Batch EFL Parser Test (manual-upload pipeline)
            </h4>
            <p className="text-[11px] text-blue-900/80 mb-2">
              Uses the same deterministic EFL pipeline as admin manual upload (PDF → text → AI
              (if enabled) → avg-price validator + TDSP utility table fallback) across a batch
              of WattBuy offers for this address.
            </p>
            <div className="flex flex-wrap items-center gap-3 text-[11px]">
              <div>
                <label className="block font-medium mb-1 text-blue-900">Offer limit</label>
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={batchLimit}
                  onChange={(e) => setBatchLimit(Number(e.target.value) || 1)}
                  className="w-24 rounded border border-blue-200 bg-white px-2 py-1"
                />
              </div>
              <div>
                <label className="block font-medium mb-1 text-blue-900">Chunking</label>
                <div className="text-[11px] text-blue-800">
                  Auto-chunked by time budget (keeps running until complete).
                </div>
              </div>
              <div>
                <label className="block font-medium mb-1 text-blue-900">Start index</label>
                <input
                  type="number"
                  min={0}
                  value={batchStartIndex}
                  onChange={(e) => setBatchStartIndex(Math.max(0, Number(e.target.value) || 0))}
                  className="w-28 rounded border border-blue-200 bg-white px-2 py-1"
                  title="Start scanning offers from this index; auto-advances when truncated."
                />
              </div>
              <label className="flex items-center gap-2 select-none text-blue-900">
                <input
                  type="checkbox"
                  checked={batchDryRun}
                  onChange={(e) => setBatchDryRun(e.target.checked)}
                />
                Dry run (don&apos;t store templates)
              </label>
              <label className="flex items-center gap-2 select-none text-blue-900">
                <input
                  type="checkbox"
                  checked={batchForceReparseTemplates}
                  onChange={(e) => setBatchForceReparseTemplates(e.target.checked)}
                />
                Overwrite existing templates (force reparse)
              </label>
              <label className="flex items-center gap-2 select-none text-blue-900">
                <input
                  type="checkbox"
                  checked={batchRunAll}
                  onChange={(e) => setBatchRunAll(e.target.checked)}
                />
                Run all (auto-continue)
              </label>
              <button
                onClick={hitBatchEflParse}
                disabled={loading || !ready}
                className="inline-flex items-center rounded border border-blue-300 bg-white px-3 py-1.5 text-[11px] font-medium text-blue-900 hover:bg-blue-50 disabled:opacity-60"
              >
                {loading ? 'Running batch…' : 'Run Batch EFL Parser'}
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="p-4 rounded-2xl border">
        <h2 className="font-medium mb-3">Offers (with wattkey)</h2>
        <p className="text-sm text-gray-600 mb-3">First get electricity to obtain wattkey, then use it for offers</p>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={async () => {
              // First get electricity to extract wattkey
              setLoading(true);
              setResult(null);
              setRaw(null);
              try {
                const elecRes = await fetch(`/api/admin/wattbuy/electricity?${qsAddr}`, {
                  headers: { 'x-admin-token': token },
                });
                const elecData = await elecRes.json();
                const wattkey = elecData?.data?.wattkey;
                if (!wattkey) {
                  setResult({ ok: false, status: 400, error: 'No wattkey found in electricity response' });
                  setRaw(elecData);
                  return;
                }
                // Then get offers with wattkey
                await hit(`/api/admin/wattbuy/offers?wattkey=${encodeURIComponent(wattkey)}&all=true`);
              } catch (e: any) {
                setResult({ ok: false, status: 500, error: e?.message || 'fetch failed' });
              } finally {
                setLoading(false);
              }
            }}
            className="px-3 py-2 rounded-lg border hover:bg-gray-50"
            disabled={loading || !ready}
          >
            {loading ? 'Loading…' : 'Offers (auto wattkey)'}
          </button>
        </div>
      </section>

      <section className="grid md:grid-cols-2 gap-4">
        <div className="p-4 rounded-2xl border">
          <h3 className="font-medium mb-2">Inspector Summary</h3>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
            <dt className="text-gray-500">ok</dt><dd>{String(result?.ok ?? '')}</dd>
            <dt className="text-gray-500">http status</dt><dd>{result?.status ?? ''}</dd>
            <dt className="text-gray-500">content-length</dt><dd>{result?.headers?.['content-length'] ?? ''}</dd>
            <dt className="text-gray-500">topType</dt><dd>{result?.topType ?? ''}</dd>
            <dt className="text-gray-500">foundListPath</dt><dd>{result?.foundListPath ?? ''}</dd>
            <dt className="text-gray-500">count</dt><dd>{result?.count ?? 0}</dd>
            <dt className="text-gray-500">note</dt><dd>{result?.note ?? ''}</dd>
          </dl>

          <div className="mt-3">
            <div className="text-xs text-gray-500 mb-1">Upstream headers (ids)</div>
            <pre className="text-xs bg-gray-50 rounded-lg p-3 overflow-auto max-h-60">
{pretty(result?.headers || {})}
            </pre>
          </div>

          <div className="mt-3">
            <div className="text-xs text-gray-500 mb-1">Selector (where)</div>
            <pre className="text-xs bg-gray-50 rounded-lg p-3 overflow-auto max-h-60">
{pretty(result?.where || {})}
            </pre>
          </div>

          {result?.sample && (
            <div className="mt-3">
              <div className="text-xs text-gray-500 mb-1">Sample</div>
              <pre className="text-xs bg-gray-50 rounded-lg p-3 overflow-auto max-h-60">
{pretty(result.sample)}
              </pre>
            </div>
          )}
        </div>

        <div className="p-4 rounded-2xl border">
          <h3 className="font-medium mb-2">Raw Response</h3>
          <pre className="text-xs bg-gray-50 rounded-lg p-3 overflow-auto max-h-[32rem]">
{pretty(raw)}
          </pre>
          {(raw as any)?.rawTextPreview && (
            <div className="mt-3">
              <div className="text-xs text-gray-500 mb-1">Raw Text Preview</div>
              <pre className="text-xs bg-gray-50 rounded-lg p-3 overflow-auto max-h-40">
{String((raw as any).rawTextPreview)}
              </pre>
            </div>
          )}

          {Array.isArray(batchResults) && batchResults.length > 0 && (
            <div className="mt-6">
              <h3 className="font-medium mb-2">Batch EFL Parser Results</h3>
              <div className="overflow-x-auto rounded-2xl border bg-white">
                <table className="min-w-full text-xs">
                  <thead className="bg-gray-50 text-gray-700">
                    <tr>
                      <th className="px-2 py-1 text-left">Supplier</th>
                      <th className="px-2 py-1 text-left">Plan</th>
                      <th className="px-2 py-1 text-left">TDSP</th>
                      <th className="px-2 py-1 text-left">Term</th>
                      <th className="px-2 py-1 text-left">Status</th>
                      <th className="px-2 py-1 text-left">Template</th>
                      <th className="px-2 py-1 text-left">TDSP Mode</th>
                      <th className="px-2 py-1 text-right">Conf.</th>
                      <th className="px-2 py-1 text-left">Queue reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batchResults.map((r: any, idx: number) => {
                      const finalStatus =
                        r.finalValidationStatus ?? r.validationStatus ?? null;
                      const originalStatus = r.originalValidationStatus ?? null;
                      const statusTooltip =
                        originalStatus && originalStatus !== finalStatus
                          ? `original: ${originalStatus}`
                          : undefined;

                      return (
                        <tr key={r.offerId ?? idx} className="border-t">
                          <td className="px-2 py-1 align-top">{r.supplier ?? '—'}</td>
                          <td className="px-2 py-1 align-top">{r.planName ?? '—'}</td>
                          <td className="px-2 py-1 align-top">{r.tdspName ?? '—'}</td>
                          <td className="px-2 py-1 align-top">
                            {typeof r.termMonths === 'number' ? `${r.termMonths} mo` : '—'}
                          </td>
                          <td className="px-2 py-1 align-top">
                            <span className="font-mono" title={statusTooltip}>
                              {finalStatus ?? '—'}
                            </span>
                          </td>
                          <td className="px-2 py-1 align-top">
                            <span
                              className="font-mono"
                              title={
                                r.templateHit
                                  ? 'Template exists for this EFL fingerprint (fast-path hit)'
                                  : undefined
                              }
                            >
                              {r.templateAction}
                              {r.templateHit ? ' (hit)' : ''}
                            </span>
                          </td>
                          <td className="px-2 py-1 align-top">
                            <span className="font-mono">{r.tdspAppliedMode ?? '—'}</span>
                          </td>
                          <td className="px-2 py-1 align-top text-right">
                            {typeof r.parseConfidence === 'number'
                              ? `${Math.round(r.parseConfidence * 100)}%`
                              : '—'}
                          </td>
                          <td className="px-2 py-1 align-top">
                            <div
                              className="max-w-xs truncate"
                              title={r.finalQueueReason ?? r.queueReason ?? undefined}
                            >
                              {r.finalQueueReason ?? r.queueReason ?? '—'}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

