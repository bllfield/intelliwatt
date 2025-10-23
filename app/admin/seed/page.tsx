// app/admin/seed/page.tsx
// Step 40: Admin UI to seed a local Rate JSON from a WattBuy offer
// -----------------------------------------------------------------
// What this page does:
//  - Paste a single offer object (from /v3/offers) into the textarea.
//  - Click "Preview seed" to see the derived RateConfig without writing.
//  - Click "Write file" to save /data/rates/<tdsp>/<supplier>-<plan>.json
//  - Requires ADMIN_SEED_TOKEN in env; include it via prompt each session
//
// Notes:
//  - This is a simple client-only page that calls /api/rates/seed.
//  - You can grab an offer by hitting your own /api/offers proxy or WB console.
//  - Result shows the derived key, target path, and the JSON to be written.

'use client';

import { useMemo, useState } from 'react';

type SeedResult = {
  dryRun: boolean;
  key: string;
  path: string;
  rateConfig: any;
  message: string;
};

export default function SeedRatePage() {
  const [token, setToken] = useState('');
  const [offerJson, setOfferJson] = useState<string>('');
  const [dry, setDry] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SeedResult | null>(null);

  const prettyInput = useMemo(() => {
    try {
      if (!offerJson.trim()) return '';
      const parsed = JSON.parse(offerJson);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return offerJson;
    }
  }, [offerJson]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);

    let payload: any;
    try {
      payload = JSON.parse(offerJson);
    } catch {
      setError('Offer JSON is not valid JSON.');
      return;
    }
    if (!payload || typeof payload !== 'object' || !payload.offer_id) {
      setError('Expected a single WattBuy offer object (must include offer_id).');
      return;
    }
    if (!token.trim()) {
      setError('Please enter the admin seed token.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/rates/seed?dry=${dry ? '1' : '0'}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-seed-token': token.trim(),
        },
        body: JSON.stringify({ offer: payload }),
      });

      const text = await res.text();
      const json = safeJson(text);

      if (!res.ok) {
        throw new Error(json?.error || res.statusText || 'Seed failed');
      }

      setResult(json as SeedResult);
    } catch (err: any) {
      setError(err?.message || 'Seed failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen w-full bg-gray-50">
      <div className="mx-auto max-w-5xl px-4 py-10">
        <h1 className="text-2xl md:text-3xl font-bold">Seed plan from WattBuy offer</h1>
        <p className="text-gray-600 mt-1">
          Paste a single offer object from <code className="px-1 rounded bg-gray-100">/v3/offers</code> and seed a local rate.
        </p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <div className="grid md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium mb-1">Offer JSON</label>
              <textarea
                className="w-full h-64 rounded-lg border px-3 py-2 font-mono text-sm"
                placeholder='{ "offer_id": "wbdb-...", "offer_name": "...", "offer_data": { "utility": "oncor", "supplier": "gexa", "plan_id": "..." , "efl": "...", "kwh500": 15.2, "kwh1000": 12.4, ... } }'
                value={prettyInput}
                onChange={(e) => setOfferJson(e.target.value)}
              />
              <p className="text-xs text-gray-500 mt-1">
                Tip: you can copy a single object from your <code>/v3/offers</code> response.
              </p>
            </div>

            <div className="md:col-span-1">
              <label className="block text-sm font-medium mb-1">Admin seed token</label>
              <input
                className="w-full rounded-lg border px-3 py-2"
                placeholder="Enter ADMIN_SEED_TOKEN"
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />

              <div className="mt-4 rounded-lg border p-3 bg-white">
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={dry}
                    onChange={(e) => setDry(e.target.checked)}
                  />
                  Preview only (don't write file)
                </label>

                <div className="flex gap-2 mt-3">
                  <button
                    type="submit"
                    disabled={loading}
                    className="rounded-lg px-4 py-2 bg-black text-white hover:opacity-90 disabled:opacity-50"
                  >
                    {loading ? 'Seeding…' : dry ? 'Preview seed' : 'Write file'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setOfferJson('');
                      setResult(null);
                      setError(null);
                    }}
                    className="rounded-lg px-3 py-2 border bg-white hover:bg-gray-50"
                  >
                    Reset
                  </button>
                </div>
              </div>
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-700 text-sm">
              {error}
            </div>
          )}

          {result && (
            <div className="rounded-xl border bg-white p-4 space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-xs font-medium">
                  {result.dryRun ? 'Preview' : 'Written'}
                </span>
                <div className="text-sm text-gray-700">
                  <strong>Key:</strong> {result.key}
                </div>
                <div className="text-sm text-gray-700">
                  <strong>Path:</strong> <code className="px-1 bg-gray-100 rounded">{result.path}</code>
                </div>
                <div className="text-sm text-gray-500 ml-auto">{result.message}</div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">RateConfig</label>
                <pre className="text-xs bg-gray-50 border rounded-lg p-3 overflow-x-auto">
                  {JSON.stringify(result.rateConfig, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </form>
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
