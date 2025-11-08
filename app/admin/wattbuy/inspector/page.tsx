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
  const [city, setCity] = useState('Fort Worth');
  const [state, setState] = useState('tx'); // lowercase per spec
  const [zip, setZip] = useState('76116');
  const [utilityID, setUtilityID] = useState('44372'); // Oncor
  const [result, setResult] = useState<InspectResult | null>(null);
  const [raw, setRaw] = useState<Json | null>(null);
  const [loading, setLoading] = useState(false);

  const ready = useMemo(() => Boolean(token), [token]);

  async function hit(path: string) {
    if (!token) { alert('Set x-admin-token first'); return; }
    setLoading(true);
    setResult(null);
    setRaw(null);
    try {
      const r = await fetch(path, { headers: { 'x-admin-token': token, 'accept': 'application/json' } });
      const data = await r.json().catch(() => ({}));
      setRaw(data);
      // normalize into InspectResult-ish shape if endpoint differs
      const normalized: InspectResult = {
        ok: data?.ok,
        status: data?.status,
        error: data?.error,
        where: data?.where,
        headers: data?.headers,
        topType: data?.topType,
        topKeys: data?.topKeys,
        foundListPath: data?.foundListPath,
        count: data?.count,
        sample: data?.sample,
        note: data?.note,
      };
      setResult(normalized);
    } catch (e: any) {
      setResult({ ok: false, status: 500, error: e?.message || 'fetch failed' });
    } finally {
      setLoading(false);
    }
  }

  const qsAddr = `address=${encodeURIComponent(address)}&city=${encodeURIComponent(city)}&state=${encodeURIComponent(state)}&zip=${encodeURIComponent(zip)}`;

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
          <h2 className="font-medium mb-3">By Utility</h2>
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
            {loading ? 'Loading…' : 'Get Retail Rates (utilityID+state)'}
          </button>
        </div>
      </section>

      <section className="p-4 rounded-2xl border">
        <h2 className="font-medium mb-3">By Address</h2>
        <div className="grid md:grid-cols-4 gap-3">
          <div>
            <label className="block text-sm mb-1">Address</label>
            <input className="w-full rounded-lg border px-3 py-2" value={address} onChange={(e)=>setAddress(e.target.value)} />
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
            {loading ? 'Loading…' : 'Retail Rates (derive utilityID)'}
          </button>
          <button
            onClick={() => hit(`/api/admin/wattbuy/electricity/info?${qsAddr}&housing_chars=true&utility_list=true`)}
            className="px-3 py-2 rounded-lg border hover:bg-gray-50"
            disabled={loading || !ready}
          >
            {loading ? 'Loading…' : 'Electricity Info (ESIID, utilities)'}
          </button>
          <button
            onClick={() => hit(`/api/admin/wattbuy/electricity?${qsAddr}`)}
            className="px-3 py-2 rounded-lg border hover:bg-gray-50"
            disabled={loading || !ready}
          >
            {loading ? 'Loading…' : 'Electricity (estimation bundle)'}
          </button>
        </div>
      </section>

      <section className="grid md:grid-cols-2 gap-4">
        <div className="p-4 rounded-2xl border">
          <h3 className="font-medium mb-2">Inspector Summary</h3>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
            <dt className="text-gray-500">ok</dt><dd>{String(result?.ok ?? '')}</dd>
            <dt className="text-gray-500">status</dt><dd>{result?.status ?? ''}</dd>
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
        </div>
      </section>
    </div>
  );
}

