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
  const [result, setResult] = useState<InspectResult | null>(null);
  const [raw, setRaw] = useState<Json | null>(null);
  const [loading, setLoading] = useState(false);

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
        </div>
      </section>
    </div>
  );
}

