// app/admin/retail-rates/seed/page.tsx
// Step 46: Admin Retail Rate Seeding Console — push a single Retail-Rate item into /data/rates
// -------------------------------------------------------------------------------------------
// What this page does
//  - Paste a single JSON item from the Retail Rate DB (copy from Step 44 "View/Copy").
//  - POST it to /api/rates/seed-retail for normalization into our RateConfig.
//  - Supports dry-run (default) or write mode (dry=0), TDSP folder override, and optional file key override.
//  - Uses ADMIN_SEED_TOKEN (enter once; kept in-memory for the session).
//
// Why
//  - Lets us ingest/preview a rate record without wiring complex batch flows yet.
//  - Keeps the write-path server-side and authenticated.
//
// Env
//  - Set ADMIN_SEED_TOKEN in your server env (e.g., .env.local).

'use client';

import { useCallback, useMemo, useState } from 'react';

type SeedResp = {
  dryRun: boolean;
  key: string;
  path: string; // relative project path
  rateConfig: any;
  message: string;
  error?: string;
};

export default function SeedRetailRatePage() {
  const [token, setToken] = useState('');
  const [tdsp, setTdsp] = useState<'oncor' | 'centerpoint' | 'aep_n' | 'aep_c' | 'tnmp' | 'unknown'>('oncor');
  const [keyOverride, setKeyOverride] = useState('');
  const [dryRun, setDryRun] = useState(true);
  const [jsonText, setJsonText] = useState<string>(DEFAULT_SAMPLE);
  const [loading, setLoading] = useState(false);
  const [resp, setResp] = useState<SeedResp | null>(null);
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(() => safeParse(jsonText), [jsonText]);
  const canSubmit = Boolean(parsed && token && !loading);

  const submit = useCallback(async () => {
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    setResp(null);
    try {
      const qs = new URLSearchParams();
      qs.set('dry', dryRun ? '1' : '0');

      const r = await fetch(`/api/rates/seed-retail?${qs.toString()}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-seed-token': token.trim(),
        },
        body: JSON.stringify({
          item: parsed,
          tdsp,
          keyOverride: keyOverride.trim() || undefined,
        }),
      });

      const text = await r.text();
      const json = safeJson(text) as SeedResp;

      if (!r.ok) {
        throw new Error((json as any)?.error || r.statusText || 'Seed failed');
      }
      setResp(json);
    } catch (e: any) {
      setError(e?.message || 'Failed to seed retail rate item.');
    } finally {
      setLoading(false);
    }
  }, [canSubmit, dryRun, parsed, tdsp, keyOverride, token]);

  return (
    <main className="min-h-screen w-full bg-gray-50">
      <div className="mx-auto max-w-6xl px-4 py-10">
        <h1 className="text-2xl md:text-3xl font-bold">Seed Retail Rate → RateConfig</h1>
        <p className="text-gray-600 mt-1">
          Paste a single item from the Retail Rate DB (Step 44), then dry-run or write it to{' '}
          <code className="bg-gray-100 px-1 rounded">/data/rates/&lt;tdsp&gt;/&lt;key&gt;.json</code>.
        </p>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border bg-white p-4 md:col-span-2">
            <label className="block text-sm font-medium mb-2">Retail Rate Item (JSON)</label>
            <textarea
              className="w-full h-[420px] font-mono text-xs rounded-lg border px-3 py-2"
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              spellCheck={false}
            />
            {!parsed && (
              <p className="mt-2 text-xs text-red-600">
                Invalid JSON — fix syntax before submitting.
              </p>
            )}
          </div>

          <div className="rounded-xl border bg-white p-4 space-y-3">
            <div>
              <label className="block text-sm font-medium mb-1">ADMIN_SEED_TOKEN</label>
              <input
                className="w-full rounded-lg border px-3 py-2"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="enter token"
                type="password"
              />
              <p className="text-xs text-gray-500 mt-1">
                Must match <code className="bg-gray-100 px-1 rounded">process.env.ADMIN_SEED_TOKEN</code> on server.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">TDSP folder</label>
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
              <p className="text-xs text-gray-500 mt-1">
                Folder under <code className="bg-gray-100 px-1 rounded">data/rates/</code>.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">File key (optional)</label>
              <input
                className="w-full rounded-lg border px-3 py-2"
                placeholder="custom-key-without-dot-json"
                value={keyOverride}
                onChange={(e) => setKeyOverride(e.target.value)}
              />
              <p className="text-xs text-gray-500 mt-1">
                If blank, a key is generated from the item name/id.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <input
                id="dryrun"
                type="checkbox"
                checked={dryRun}
                onChange={(e) => setDryRun(e.target.checked)}
              />
              <label htmlFor="dryrun" className="text-sm">
                Dry-run (don't write file)
              </label>
            </div>

            <button
              onClick={submit}
              disabled={!canSubmit}
              className={`w-full rounded-lg px-4 py-2 text-white ${canSubmit ? 'bg-black hover:opacity-90' : 'bg-gray-400 cursor-not-allowed'}`}
            >
              {loading ? 'Seeding…' : dryRun ? 'Preview normalize' : 'Write file'}
            </button>

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-700 text-sm">
                {error}
              </div>
            )}
          </div>
        </div>

        {resp && (
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border bg-white p-4">
              <h2 className="font-semibold">Result</h2>
              <div className="mt-2 text-sm">
                <div>
                  <span className="text-gray-500">Mode:</span>{' '}
                  {resp.dryRun ? (
                    <span className="inline-flex items-center rounded bg-gray-100 px-2 py-0.5 text-xs">dry-run</span>
                  ) : (
                    <span className="inline-flex items-center rounded bg-green-100 px-2 py-0.5 text-xs">written</span>
                  )}
                </div>
                <div className="mt-1">
                  <span className="text-gray-500">Key:</span> <code className="bg-gray-100 px-1 rounded">{resp.key}</code>
                </div>
                <div className="mt-1">
                  <span className="text-gray-500">Path:</span>{' '}
                  <code className="bg-gray-100 px-1 rounded">{resp.path}</code>
                </div>
                <div className="mt-2 text-gray-700">{resp.message}</div>
              </div>
            </div>

            <div className="rounded-xl border bg-white p-4 md:col-span-2">
              <h2 className="font-semibold">Derived RateConfig</h2>
              <pre className="mt-2 text-xs bg-gray-50 border rounded-lg p-3 overflow-x-auto">
                {JSON.stringify(resp.rateConfig, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

function safeParse(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
function safeJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

const DEFAULT_SAMPLE = `{
  "id": "sample-123",
  "tariff_name": "Residential Basic",
  "utility_name": "Oncor Electric Delivery",
  "state": "TX",
  "customer_class": "residential",
  "effective_date": "2024-06-01",
  "expiration_date": null,
  "verified_at": "2024-06-15",
  "components": [
    { "name": "Base Customer Charge", "monthly_fee": 7.95 },
    { "name": "Energy", "rate": 0.125, "unit": "usd/kwh" }
  ],
  "source_url": "https://example.com/rate-sheet.pdf"
}`;
