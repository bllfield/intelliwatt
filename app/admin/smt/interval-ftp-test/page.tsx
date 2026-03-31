'use client';

import { useEffect, useMemo, useState } from 'react';
import { lookupSmtHousesByEmail, type AdminHouseOption } from '@/app/admin/smt/_lib/houseLookup';

type Json = any;

type ApiResult = {
  ok?: boolean;
  status?: number;
  error?: string;
  message?: string;
  data?: Json;
};

function useLocalToken(key = 'iw_admin_token') {
  const [token, setToken] = useState('');
  useEffect(() => {
    setToken(localStorage.getItem(key) || '');
  }, [key]);
  useEffect(() => {
    if (token) localStorage.setItem(key, token);
  }, [key, token]);
  return { token, setToken };
}

function pretty(x: Json) {
  try {
    return JSON.stringify(x, null, 2);
  } catch {
    return String(x);
  }
}

export default function SmtIntervalFtpTestPage() {
  const { token, setToken } = useLocalToken();
  const ready = useMemo(() => Boolean(token), [token]);
  const [loading, setLoading] = useState(false);
  const [houseLookupLoading, setHouseLookupLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [houseLookupError, setHouseLookupError] = useState<string | null>(null);
  const [houses, setHouses] = useState<AdminHouseOption[]>([]);
  const [selectedHouseId, setSelectedHouseId] = useState('');

  const [result, setResult] = useState<ApiResult | null>(null);
  const [raw, setRaw] = useState<Json | null>(null);
  const selectedHouse = houses.find((house) => house.id === selectedHouseId) ?? null;

  async function loadHouses() {
    if (!token) {
      alert('Set x-admin-token first');
      return;
    }
    setHouseLookupLoading(true);
    setHouseLookupError(null);
    try {
      const lookup = await lookupSmtHousesByEmail({ email, token });
      if (!lookup.ok) {
        setHouses([]);
        setSelectedHouseId('');
        setHouseLookupError(lookup.error ?? 'house_lookup_failed');
        return;
      }
      const rows = lookup.houses ?? [];
      setHouses(rows);
      setSelectedHouseId(rows[0]?.id ?? '');
      if (rows.length === 0) {
        setHouseLookupError('No active houses found for that email.');
      }
    } finally {
      setHouseLookupLoading(false);
    }
  }

  async function runTest() {
    if (!token) {
      alert('Set x-admin-token first');
      return;
    }
    if (!selectedHouseId) {
      alert('Load houses for an email and select a house first');
      return;
    }
    setLoading(true);
    setResult(null);
    setRaw(null);

    try {
      const res = await fetch('/api/admin/smt/interval-ftp-test', {
        method: 'POST',
        headers: {
          'x-admin-token': token,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({ houseId: selectedHouseId }),
      });
      const json = (await res
        .json()
        .catch(() => ({ error: 'Failed to parse JSON', status: res.status }))) as Json;
      setRaw(json);
      setResult({
        ok: json?.ok,
        status: res.status,
        error: json?.error,
        message: json?.message,
        data: json,
      });
    } catch (e: any) {
      const msg = e?.message || 'fetch failed';
      setResult({ ok: false, status: 500, error: msg });
    } finally {
      setLoading(false);
    }
  }

  const intervalPayload = (raw as any)?.intervalPayload ?? null;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <h1 className="text-2xl font-semibold">SMT 15-Min FTP Interval Test</h1>
      <p className="text-sm text-gray-700">
        This admin-only harness triggers the SMT 15-minute interval backfill request via the droplet proxy
        (<code>/v2/15minintervalreads/</code>) for the selected house over a 365-day window.
        It shows the exact request body shape (fields and values) we use for FTP CSV delivery.
      </p>

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

        <div className="p-4 rounded-2xl border flex flex-col gap-3">
          <h2 className="font-medium">House Lookup</h2>
          <p className="text-sm text-gray-700">
            Load houses by user email, then run the FTP interval backfill test for the selected house.
          </p>
          <label className="block text-sm">
            <span className="mb-1 block">User email</span>
            <input
              className="w-full rounded-lg border px-3 py-2"
              type="email"
              placeholder="user@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={loadHouses}
              className="px-4 py-2 rounded-lg border bg-slate-50 font-semibold hover:bg-slate-100"
              disabled={houseLookupLoading || !ready}
            >
              {houseLookupLoading ? 'Loading houses…' : 'Load Houses'}
            </button>
            {selectedHouse ? (
              <span className="text-xs text-gray-600">
                Selected: <code>{selectedHouse.label}</code>
              </span>
            ) : null}
          </div>
          <label className="block text-sm">
            <span className="mb-1 block">House</span>
            <select
              className="w-full rounded-lg border px-3 py-2"
              value={selectedHouseId}
              onChange={(e) => setSelectedHouseId(e.target.value)}
            >
              <option value="">Select a house</option>
              {houses.map((house) => (
                <option key={house.id} value={house.id}>
                  {house.label}
                </option>
              ))}
            </select>
          </label>
          {houseLookupError ? <p className="text-sm text-red-600">{houseLookupError}</p> : null}
          <button
            onClick={runTest}
            className="px-4 py-2 rounded-lg border bg-blue-50 font-semibold hover:bg-blue-100"
            disabled={loading || !ready || !selectedHouseId}
          >
            {loading ? 'Running FTP interval test…' : 'Run SMT 15-Min FTP Test'}
          </button>
        </div>
      </section>

      <section className="grid md:grid-cols-2 gap-4">
        <div className="p-4 rounded-2xl border">
          <h3 className="font-medium mb-2">Result Summary</h3>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
            <dt className="text-gray-500">ok</dt>
            <dd>{String(result?.ok ?? '')}</dd>
            <dt className="text-gray-500">status</dt>
            <dd>{result?.status ?? ''}</dd>
            <dt className="text-gray-500">error</dt>
            <dd>{result?.error ?? ''}</dd>
            <dt className="text-gray-500">message</dt>
            <dd>{result?.message ?? ''}</dd>
          </dl>
        </div>
        <div className="p-4 rounded-2xl border">
          <h3 className="font-medium mb-2">Date Window</h3>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
            <dt className="text-gray-500">startDate (MM/DD/YYYY)</dt>
            <dd>{(raw as any)?.startDate ?? ''}</dd>
            <dt className="text-gray-500">endDate (MM/DD/YYYY)</dt>
            <dd>{(raw as any)?.endDate ?? ''}</dd>
            <dt className="text-gray-500">startDateIso</dt>
            <dd className="text-xs break-all">{(raw as any)?.startDateIso ?? ''}</dd>
            <dt className="text-gray-500">endDateIso</dt>
            <dd className="text-xs break-all">{(raw as any)?.endDateIso ?? ''}</dd>
          </dl>
        </div>
      </section>

      <section className="p-4 rounded-2xl border">
        <h3 className="font-medium mb-2">Interval FTP Request Body (what droplet sends to SMT)</h3>
        {!intervalPayload && (
          <p className="text-sm text-gray-500">
            Run the test to see the payload. The <code>trans_id</code> is generated on the droplet; this inspector shows
            the exact field names and values (including <code>deliveryMode=&quot;FTP&quot;</code> and{' '}
            <code>reportFormat=&quot;CSV&quot;</code>).
          </p>
        )}
        {intervalPayload && (
          <pre className="text-xs bg-gray-50 rounded-lg p-3 overflow-auto max-h-[32rem]">
{pretty(intervalPayload)}
          </pre>
        )}
      </section>

      <section className="p-4 rounded-2xl border">
        <h3 className="font-medium mb-2">Droplet curl example (manual SMT 15-min FTP call)</h3>
        <p className="text-sm text-gray-700 mb-3">
          This is a sample command you could run on the SMT droplet (as <code>deploy</code>) to call{' '}
          <code>/v2/15minintervalreads/</code> directly, using the same body shape as our proxy. Replace the token and
          dates as needed.
        </p>
        <pre className="text-xs bg-gray-50 rounded-lg p-3 overflow-auto max-h-[32rem]">
{`# On droplet (as deploy), after obtaining an SMT JWT token:
export SMT_API_BASE_URL="https://services.smartmetertexas.net"
export SMT_JWT="<paste_access_token_here>"

curl -sS -X POST "$SMT_API_BASE_URL/v2/15minintervalreads/" \\
  -H "Authorization: Bearer $SMT_JWT" \\
  -H "Content-Type: application/json" \\
  -d '{
    "trans_id": "INT15XXXXXXXXXXXX",
    "requestorID": "INTELLIPATH",
    "requesterType": "CSP",
    "requesterAuthenticationID": "134642921",
    "startDate": "MM/DD/YYYY",
    "endDate": "MM/DD/YYYY",
    "deliveryMode": "FTP",
    "reportFormat": "CSV",
    "version": "A",
    "readingType": "C",
    "esiid": ["<resolved-house-esiid>"],
    "SMTTermsandConditions": "Y"
  }'
`}
        </pre>
      </section>

      <section className="p-4 rounded-2xl border">
        <h3 className="font-medium mb-2">Raw Response from App Proxy</h3>
        <pre className="text-xs bg-gray-50 rounded-lg p-3 overflow-auto max-h-[32rem]">
{pretty(raw)}
        </pre>
      </section>
    </div>
  );
}


