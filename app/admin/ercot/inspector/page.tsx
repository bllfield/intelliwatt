'use client';

import { useEffect, useMemo, useState } from 'react';

type Json = any;
type InspectResult = {
  ok?: boolean;
  status?: number;
  error?: string;
  data?: any;
  message?: string;
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

export default function ERCOTInspector() {
  const { token, setToken } = useLocalToken();
  const [result, setResult] = useState<InspectResult | null>(null);
  const [raw, setRaw] = useState<Json | null>(null);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({
    dateStart: '',
    dateEnd: '',
    status: '',
    tdsp: '',
    limit: '50',
  });
  const [address, setAddress] = useState({
    line1: '',
    city: '',
    state: 'TX',
    zip: '',
  });

  const ready = useMemo(() => Boolean(token), [token]);

  async function hit(path: string, options?: RequestInit) {
    if (!token) { alert('Set x-admin-token first'); return; }
    setLoading(true);
    setResult(null);
    setRaw(null);
    try {
      const r = await fetch(path, {
        headers: { 'x-admin-token': token, 'accept': 'application/json', ...options?.headers },
        ...options,
      });
      const data = await r.json().catch(() => ({ error: 'Failed to parse JSON', status: r.status }));
      setRaw(data);
      const normalized: InspectResult = {
        ok: data?.ok,
        status: r.status,
        error: data?.error,
        data: data,
        message: data?.message,
      };
      setResult(normalized);
    } catch (e: any) {
      setResult({ ok: false, status: 500, error: e?.message || 'fetch failed' });
    } finally {
      setLoading(false);
    }
  }

  async function fetchIngests() {
    const params = new URLSearchParams();
    if (filters.dateStart) params.set('dateStart', filters.dateStart);
    if (filters.dateEnd) params.set('dateEnd', filters.dateEnd);
    if (filters.status) params.set('status', filters.status);
    if (filters.tdsp) params.set('tdsp', filters.tdsp);
    if (filters.limit) params.set('limit', filters.limit);
    await hit(`/api/admin/ercot/ingests?${params.toString()}`);
  }

  async function lookupEsiid() {
    if (!token) { alert('Set x-admin-token first'); return; }
    if (!address.line1 || !address.city || !address.state || !address.zip) {
      alert('Please fill in all address fields');
      return;
    }
    setLoading(true);
    setResult(null);
    setRaw(null);
    try {
      const r = await fetch('/api/admin/ercot/lookup-esiid', {
        method: 'POST',
        headers: { 'x-admin-token': token, 'content-type': 'application/json' },
        body: JSON.stringify(address),
      });
      const data = await r.json().catch(() => ({ error: 'Failed to parse JSON', status: r.status }));
      setRaw(data);
      setResult({
        ok: data?.ok,
        status: r.status,
        error: data?.error,
        data: data,
        message: data?.message,
      });
    } catch (e: any) {
      setResult({ ok: false, status: 500, error: e?.message || 'fetch failed' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <h1 className="text-2xl font-semibold">ERCOT ESIID Inspector</h1>

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
          <h2 className="font-medium mb-3">Quick Tests</h2>
          <div className="space-y-2">
            <button
              onClick={() => hit('/api/admin/ercot/debug/last')}
              className="w-full px-3 py-2 rounded-lg border hover:bg-gray-50"
              disabled={loading || !ready}
            >
              {loading ? 'Loading…' : 'Get Last Ingest'}
            </button>
            <button
              onClick={fetchIngests}
              className="w-full px-3 py-2 rounded-lg border hover:bg-gray-50"
              disabled={loading || !ready}
            >
              {loading ? 'Loading…' : 'List Ingests (with filters)'}
            </button>
          </div>
        </div>
      </section>

      <section className="p-4 rounded-2xl border">
        <h2 className="font-medium mb-3">Address to ESIID Lookup</h2>
        <div className="grid md:grid-cols-4 gap-4 mb-4">
          <div>
            <label className="block text-sm mb-1">Address Line 1</label>
            <input
              type="text"
              className="w-full rounded-lg border px-3 py-2"
              placeholder="123 Main St"
              value={address.line1}
              onChange={(e) => setAddress({ ...address, line1: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-sm mb-1">City</label>
            <input
              type="text"
              className="w-full rounded-lg border px-3 py-2"
              placeholder="Dallas"
              value={address.city}
              onChange={(e) => setAddress({ ...address, city: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-sm mb-1">State</label>
            <input
              type="text"
              className="w-full rounded-lg border px-3 py-2"
              placeholder="TX"
              value={address.state}
              onChange={(e) => setAddress({ ...address, state: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-sm mb-1">ZIP</label>
            <input
              type="text"
              className="w-full rounded-lg border px-3 py-2"
              placeholder="75201"
              value={address.zip}
              onChange={(e) => setAddress({ ...address, zip: e.target.value })}
            />
          </div>
        </div>
        <button
          onClick={lookupEsiid}
          className="px-4 py-2 rounded-lg border hover:bg-gray-50 bg-blue-50"
          disabled={loading || !ready}
        >
          {loading ? 'Looking up…' : 'Lookup ESIID'}
        </button>
        {raw?.esiid && (
          <div className="mt-3 p-3 bg-green-50 rounded-lg">
            <p className="text-sm font-semibold">Found ESIID: <span className="font-mono">{raw.esiid}</span></p>
            {raw.utility && <p className="text-sm">Utility: {raw.utility}</p>}
            {raw.tdsp && <p className="text-sm">TDSP: {raw.tdsp}</p>}
          </div>
        )}
      </section>

      <section className="p-4 rounded-2xl border">
        <h2 className="font-medium mb-3">Ingest Filters</h2>
        <div className="grid md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm mb-1">Date Start</label>
            <input
              type="date"
              className="w-full rounded-lg border px-3 py-2"
              value={filters.dateStart}
              onChange={(e) => setFilters({ ...filters, dateStart: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Date End</label>
            <input
              type="date"
              className="w-full rounded-lg border px-3 py-2"
              value={filters.dateEnd}
              onChange={(e) => setFilters({ ...filters, dateEnd: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Status</label>
            <input
              type="text"
              className="w-full rounded-lg border px-3 py-2"
              placeholder="e.g., completed, failed"
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-sm mb-1">TDSP</label>
            <input
              type="text"
              className="w-full rounded-lg border px-3 py-2"
              placeholder="e.g., oncor, centerpoint"
              value={filters.tdsp}
              onChange={(e) => setFilters({ ...filters, tdsp: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Limit</label>
            <input
              type="number"
              className="w-full rounded-lg border px-3 py-2"
              placeholder="50"
              value={filters.limit}
              onChange={(e) => setFilters({ ...filters, limit: e.target.value })}
            />
          </div>
        </div>
      </section>

      <section className="grid md:grid-cols-2 gap-4">
        <div className="p-4 rounded-2xl border">
          <h3 className="font-medium mb-2">Response Summary</h3>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
            <dt className="text-gray-500">ok</dt><dd>{String(result?.ok ?? '')}</dd>
            <dt className="text-gray-500">status</dt><dd>{result?.status ?? ''}</dd>
            <dt className="text-gray-500">error</dt><dd>{result?.error ?? ''}</dd>
            <dt className="text-gray-500">count</dt><dd>{raw?.count ?? ''}</dd>
            <dt className="text-gray-500">esiid</dt><dd>{raw?.esiid ?? ''}</dd>
            <dt className="text-gray-500">message</dt><dd>{result?.message ?? ''}</dd>
          </dl>
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

