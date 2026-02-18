'use client';

import { useEffect, useMemo, useState } from 'react';
import { TdspCode } from '@prisma/client';

type TdspTariffDebugResponse = {
  ok: boolean;
  tdspCode: string | null;
  asOfDate: string | null;
  utility: any | null;
  version: any | null;
  components: any[];
  lookupSummary: {
    monthlyCents: number | null;
    perKwhCents: number | null;
    confidence: string | null;
  } | null;
  debug: string[];
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

const TDSP_OPTIONS = Object.values(TdspCode) as string[];

export default function TdspTariffViewer() {
  const { token, setToken } = useLocalToken();
  const [tdspCode, setTdspCode] = useState<string>('ONCOR');
  const [asOfDate, setAsOfDate] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TdspTariffDebugResponse | null>(null);

  const ready = useMemo(() => Boolean(token), [token]);

  useEffect(() => {
    if (!asOfDate) {
      const today = new Date();
      const iso = today.toISOString().slice(0, 10);
      setAsOfDate(iso);
    }
  }, [asOfDate]);

  async function loadTariffs() {
    if (!token) {
      alert('Set x-admin-token first');
      return;
    }
    if (!tdspCode) {
      alert('Select a TDSP code');
      return;
    }
    if (!asOfDate) {
      alert('Set as-of date');
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const params = new URLSearchParams({
        tdspCode,
        asOfDate,
      });
      const r = await fetch(`/api/admin/tdsp-tariffs?${params.toString()}`, {
        headers: {
          'x-admin-token': token,
          accept: 'application/json',
        },
      });
      const data = (await r.json()) as TdspTariffDebugResponse;
      setResult(data);
    } catch (err: any) {
      setResult({
        ok: false,
        tdspCode,
        asOfDate,
        utility: null,
        version: null,
        components: [],
        lookupSummary: null,
        debug: [err?.message || 'fetch failed'],
      });
    } finally {
      setLoading(false);
    }
  }

  const utility = result?.utility;
  const version = result?.version;
  const components = result?.components ?? [];
  const summary = result?.lookupSummary;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <h1 className="text-2xl font-semibold">TDSP Tariff Viewer</h1>
      <p className="text-sm text-gray-600 mb-2">
        Admin-only helper for inspecting Texas TDSP delivery tariffs and the
        values returned by <code>lookupTdspCharges</code>.
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
          {!ready && (
            <p className="text-sm text-red-600 mt-2">Token required.</p>
          )}
        </div>

        <div className="p-4 rounded-2xl border">
          <h2 className="font-medium mb-3">Inputs</h2>
          <div className="space-y-3">
            <div>
              <label className="block text-sm mb-1">TDSP Code</label>
              <select
                className="w-full rounded-lg border px-3 py-2"
                value={tdspCode}
                onChange={(e) => setTdspCode(e.target.value)}
              >
                {TDSP_OPTIONS.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm mb-1">As-of Date</label>
              <input
                type="date"
                className="w-full rounded-lg border px-3 py-2"
                value={asOfDate}
                onChange={(e) => setAsOfDate(e.target.value)}
              />
            </div>
            <button
              onClick={loadTariffs}
              className="w-full px-3 py-2 rounded-lg border hover:bg-gray-50 disabled:opacity-60"
              disabled={loading || !ready}
            >
              {loading ? 'Loading…' : 'Load Tariff'}
            </button>
          </div>
        </div>
      </section>

      <section className="grid md:grid-cols-2 gap-4">
        <div className="p-4 rounded-2xl border">
          <h2 className="font-medium mb-3">Utility</h2>
          {utility ? (
            <dl className="text-sm space-y-1">
              <div className="flex justify-between gap-3">
                <dt className="font-mono text-xs text-gray-500">code</dt>
                <dd className="font-semibold">{result?.tdspCode}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="font-mono text-xs text-gray-500">name</dt>
                <dd className="truncate">{utility.name}</dd>
              </div>
              {utility.shortName && (
                <div className="flex justify-between gap-3">
                  <dt className="font-mono text-xs text-gray-500">
                    shortName
                  </dt>
                  <dd className="truncate">{utility.shortName}</dd>
                </div>
              )}
              {utility.websiteUrl && (
                <div className="flex justify-between gap-3">
                  <dt className="font-mono text-xs text-gray-500">
                    websiteUrl
                  </dt>
                  <dd className="truncate">
                    <a
                      href={utility.websiteUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-brand-navy underline"
                    >
                      {utility.websiteUrl}
                    </a>
                  </dd>
                </div>
              )}
            </dl>
          ) : (
            <p className="text-sm text-gray-500">No utility found.</p>
          )}
        </div>

        <div className="p-4 rounded-2xl border">
          <h2 className="font-medium mb-3">Active Tariff Version</h2>
          {version ? (
            <dl className="text-sm space-y-1">
              <div className="flex justify-between gap-3">
                <dt className="font-mono text-xs text-gray-500">tariffName</dt>
                <dd className="truncate">{version.tariffName ?? '—'}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="font-mono text-xs text-gray-500">
                  effectiveStart
                </dt>
                <dd>{version.effectiveStart}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="font-mono text-xs text-gray-500">
                  effectiveEnd
                </dt>
                <dd>{version.effectiveEnd ?? '—'}</dd>
              </div>
              {version.sourceUrl && (
                <div className="flex justify-between gap-3">
                  <dt className="font-mono text-xs text-gray-500">
                    sourceUrl
                  </dt>
                  <dd className="truncate">
                    <a
                      href={version.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-brand-navy underline"
                    >
                      {version.sourceUrl}
                    </a>
                  </dd>
                </div>
              )}
              {version.notes && (
                <div className="mt-2">
                  <dt className="font-mono text-xs text-gray-500 mb-1">
                    notes
                  </dt>
                  <dd className="text-xs whitespace-pre-wrap">
                    {version.notes}
                  </dd>
                </div>
              )}
            </dl>
          ) : (
            <p className="text-sm text-gray-500">
              No active tariff version found for this date.
            </p>
          )}
        </div>
      </section>

      <section className="p-4 rounded-2xl border space-y-3">
        <h2 className="font-medium mb-1">Components</h2>
        {components.length ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm border">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-2 py-1 border text-left">chargeType</th>
                  <th className="px-2 py-1 border text-left">unit</th>
                  <th className="px-2 py-1 border text-right">rate</th>
                  <th className="px-2 py-1 border text-right">minKwh</th>
                  <th className="px-2 py-1 border text-right">maxKwh</th>
                  <th className="px-2 py-1 border text-left">notes</th>
                </tr>
              </thead>
              <tbody>
                {components.map((c) => (
                  <tr key={c.id}>
                    <td className="px-2 py-1 border font-mono text-xs">
                      {c.chargeType}
                    </td>
                    <td className="px-2 py-1 border font-mono text-xs">
                      {c.unit}
                    </td>
                    <td className="px-2 py-1 border text-right font-mono text-xs">
                      {c.rate}
                    </td>
                    <td className="px-2 py-1 border text-right font-mono text-xs">
                      {c.minKwh ?? '—'}
                    </td>
                    <td className="px-2 py-1 border text-right font-mono text-xs">
                      {c.maxKwh ?? '—'}
                    </td>
                    <td className="px-2 py-1 border text-xs">
                      {c.notes ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-gray-500">No components for this version.</p>
        )}
      </section>

      <section className="grid md:grid-cols-2 gap-4">
        <div className="p-4 rounded-2xl border">
          <h2 className="font-medium mb-2">Summary (lookupTdspCharges)</h2>
          {summary ? (
            <dl className="text-sm space-y-1">
              <div className="flex justify-between gap-3">
                <dt className="font-mono text-xs text-gray-500">
                  monthlyCents
                </dt>
                <dd>{summary.monthlyCents ?? 'null'}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="font-mono text-xs text-gray-500">
                  perKwhCents
                </dt>
                <dd>{summary.perKwhCents ?? 'null'}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="font-mono text-xs text-gray-500">
                  confidence
                </dt>
                <dd>{summary.confidence ?? 'null'}</dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-gray-500">
              lookupTdspCharges() returned null or no numeric values.
            </p>
          )}
        </div>

        <div className="p-4 rounded-2xl border">
          <h2 className="font-medium mb-2">Debug</h2>
          <pre className="text-xs bg-gray-50 rounded-lg p-2 overflow-auto max-h-64">
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      </section>
    </div>
  );
}


