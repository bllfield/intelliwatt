'use client';

import { useEffect, useMemo, useState } from 'react';
import UsageDashboard from '@/components/usage/UsageDashboard';

type Json = any;

type ApiResult = {
  ok?: boolean;
  status?: number;
  error?: string;
  message?: string;
  data?: Json;
};

const TEST_ESIID = '10443720004766435';

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

export default function SmtIntervalApiTestPage() {
  const { token, setToken } = useLocalToken();
  const ready = useMemo(() => Boolean(token), [token]);
  const [loading, setLoading] = useState(false);

  const [billingResult, setBillingResult] = useState<ApiResult | null>(null);
  // Full response we got back from our /api/admin/smt/billing/fetch wrapper.
  const [usageDebugResult, setUsageDebugResult] = useState<ApiResult | null>(null);
  const [intervalsDebugResult, setIntervalsDebugResult] = useState<ApiResult | null>(null);

  const [billingRaw, setBillingRaw] = useState<Json | null>(null);
  const [usageRaw, setUsageRaw] = useState<Json | null>(null);
  const [intervalsRaw, setIntervalsRaw] = useState<Json | null>(null);

  async function runTest() {
    if (!token) {
      alert('Set x-admin-token first');
      return;
    }
    setLoading(true);
    setBillingResult(null);
    setUsageDebugResult(null);
    setIntervalsDebugResult(null);
    setBillingRaw(null);
    setUsageRaw(null);
    setIntervalsRaw(null);

    try {
      // 1) Call /api/admin/smt/billing/fetch to hit SMT /v2/energydata
      const billingRes = await fetch('/api/admin/smt/billing/fetch', {
        method: 'POST',
        headers: {
          'x-admin-token': token,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          esiid: TEST_ESIID,
          includeInterval: true,
          includeDaily: false,
          includeMonthly: false,
        }),
      });
      const billingJson = (await billingRes
        .json()
        .catch(() => ({ error: 'Failed to parse JSON', status: billingRes.status }))) as Json;
      setBillingRaw(billingJson);
      setBillingResult({
        ok: billingJson?.ok,
        status: billingRes.status,
        error: billingJson?.error,
        message: billingJson?.message,
        data: billingJson,
      });

      // 2) Call /api/admin/usage/debug for the same ESIID to see what landed in SmtInterval/usage module
      const usageRes = await fetch(
        `/api/admin/usage/debug?esiid=${encodeURIComponent(TEST_ESIID)}&days=365`,
        {
          method: 'GET',
          headers: {
            'x-admin-token': token,
            accept: 'application/json',
          },
        },
      );
      const usageJson = (await usageRes
        .json()
        .catch(() => ({ error: 'Failed to parse JSON', status: usageRes.status }))) as Json;
      setUsageRaw(usageJson);
      setUsageDebugResult({
        ok: usageJson?.ok,
        status: usageRes.status,
        error: usageJson?.error,
        message: usageJson?.message,
        data: usageJson,
      });

      // 3) Call /api/admin/debug/smt/intervals for a sample of raw SmtInterval rows
      const intervalsRes = await fetch(
        `/api/admin/debug/smt/intervals?esiid=${encodeURIComponent(TEST_ESIID)}&limit=25`,
        {
          method: 'GET',
          headers: {
            'x-admin-token': token,
            accept: 'application/json',
          },
        },
      );
      const intervalsJson = (await intervalsRes
        .json()
        .catch(() => ({ error: 'Failed to parse JSON', status: intervalsRes.status }))) as Json;
      setIntervalsRaw(intervalsJson);
      setIntervalsDebugResult({
        ok: intervalsJson?.ok,
        status: intervalsRes.status,
        error: intervalsJson?.error,
        message: intervalsJson?.message,
        data: intervalsJson,
      });
    } catch (e: any) {
      const msg = e?.message || 'fetch failed';
      setBillingResult((prev) => prev ?? { ok: false, status: 500, error: msg });
    } finally {
      setLoading(false);
    }
  }

  // Pull out SMT-specific diagnostics from whatever billingRawshape we got back.
  const smtDiagnostics = useMemo(() => {
    const raw = billingRaw as any;
    if (!raw) return null;
    const smtJson = raw.smtJson ?? null;
    const smtText = raw.smtText ?? null;
    const payloadUsed = raw.payloadUsed ?? null;

    // SMT error metadata often shows up on the top-level JSON:
    // statusCode, errorCode, errorMessage, message, detail, etc.
    const j: any = smtJson || {};

    return {
      smtUrl: raw.smtUrl ?? null,
      httpStatusFromWrapper: billingResult?.status ?? null,
      smtStatusCode: j.statusCode ?? j.StatusCode ?? null,
      smtErrorCode: j.errorCode ?? j.ErrorCode ?? j.code ?? null,
      smtErrorMessage:
        j.errorMessage ??
        j.ErrorMessage ??
        j.message ??
        j.Message ??
        j.detail ??
        j.Detail ??
        null,
      payloadUsed,
      smtJson,
      smtText,
    };
  }, [billingRaw, billingResult]);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <h1 className="text-2xl font-semibold">SMT Interval API Test (JSON)</h1>
      <p className="text-sm text-gray-700">
        This admin-only harness calls <code>/api/admin/smt/billing/fetch</code> for a hard-coded ESIID (
        <code>{TEST_ESIID}</code>) over a 365-day window, then shows:
        <br />
        1) The SMT API response; 2) Usage/interval debug for that ESIID; 3) The same usage dashboard output the customer
        would see.
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
          <h2 className="font-medium">Test Controls</h2>
          <p className="text-sm text-gray-700">
            ESIID is hard-coded to <code>{TEST_ESIID}</code>. Date window is 365 days (same as live backfill logic).
          </p>
          <button
            onClick={runTest}
            className="px-4 py-2 rounded-lg border bg-blue-50 font-semibold hover:bg-blue-100"
            disabled={loading || !ready}
          >
            {loading ? 'Running test…' : 'Run SMT Interval API Test'}
          </button>
        </div>
      </section>

      <section className="grid md:grid-cols-3 gap-4">
        <div className="p-4 rounded-2xl border">
          <h3 className="font-medium mb-2">SMT /v2/energydata result</h3>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
            <dt className="text-gray-500">ok</dt>
            <dd>{String(billingResult?.ok ?? '')}</dd>
            <dt className="text-gray-500">status</dt>
            <dd>{billingResult?.status ?? ''}</dd>
            <dt className="text-gray-500">error</dt>
            <dd>{billingResult?.error ?? ''}</dd>
            <dt className="text-gray-500">message</dt>
            <dd>{billingResult?.message ?? ''}</dd>
          </dl>
        </div>
        <div className="p-4 rounded-2xl border">
          <h3 className="font-medium mb-2">Usage debug (/api/admin/usage/debug)</h3>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
            <dt className="text-gray-500">ok</dt>
            <dd>{String(usageDebugResult?.ok ?? '')}</dd>
            <dt className="text-gray-500">status</dt>
            <dd>{usageDebugResult?.status ?? ''}</dd>
            <dt className="text-gray-500">error</dt>
            <dd>{usageDebugResult?.error ?? ''}</dd>
            <dt className="text-gray-500">message</dt>
            <dd>{usageDebugResult?.message ?? ''}</dd>
          </dl>
        </div>
        <div className="p-4 rounded-2xl border">
          <h3 className="font-medium mb-2">Sample intervals (/api/admin/debug/smt/intervals)</h3>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
            <dt className="text-gray-500">ok</dt>
            <dd>{String(intervalsDebugResult?.ok ?? '')}</dd>
            <dt className="text-gray-500">status</dt>
            <dd>{intervalsDebugResult?.status ?? ''}</dd>
            <dt className="text-gray-500">error</dt>
            <dd>{intervalsDebugResult?.error ?? ''}</dd>
          </dl>
        </div>
      </section>

      <section className="p-4 rounded-2xl border">
        <h2 className="font-medium mb-3">SMT Request & Error Inspector</h2>
        <p className="text-sm text-gray-700 mb-3">
          This section surfaces exactly what we sent to SMT and what SMT told us back, including any{' '}
          <code>statusCode</code>, <code>errorCode</code>, or &quot;already delivered&quot;-style messages from their
          JSON. Use this when SMT says it has already delivered data or is refusing a backfill.
        </p>
        {!billingRaw && (
          <p className="text-sm text-gray-500">Run the test above to see SMT request/response details.</p>
        )}
        {billingRaw && smtDiagnostics && (
          <div className="space-y-4">
            <div className="grid md:grid-cols-3 gap-4">
              <div>
                <h3 className="font-medium mb-2 text-sm">HTTP / Wrapper Status</h3>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <dt className="text-gray-500">wrapper.ok</dt>
                  <dd>{String(billingResult?.ok ?? '')}</dd>
                  <dt className="text-gray-500">wrapper.status</dt>
                  <dd>{billingResult?.status ?? ''}</dd>
                </dl>
              </div>
              <div>
                <h3 className="font-medium mb-2 text-sm">SMT Error Fields (parsed)</h3>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <dt className="text-gray-500">smt.statusCode</dt>
                  <dd>{smtDiagnostics.smtStatusCode ?? ''}</dd>
                  <dt className="text-gray-500">smt.errorCode</dt>
                  <dd>{smtDiagnostics.smtErrorCode ?? ''}</dd>
                  <dt className="text-gray-500">smt.errorMessage</dt>
                  <dd className="break-words">{smtDiagnostics.smtErrorMessage ?? ''}</dd>
                </dl>
              </div>
              <div>
                <h3 className="font-medium mb-2 text-sm">Request Meta</h3>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <dt className="text-gray-500">smtUrl</dt>
                  <dd className="break-all">{smtDiagnostics.smtUrl ?? ''}</dd>
                  <dt className="text-gray-500">date window</dt>
                  <dd>
                    {String((billingRaw as any)?.startDate ?? '')} → {String((billingRaw as any)?.endDate ?? '')}
                  </dd>
                </dl>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <h3 className="font-medium mb-2 text-sm">Payload Sent to SMT</h3>
                <pre className="text-xs bg-gray-50 rounded-lg p-3 overflow-auto max-h-[24rem]">
{pretty(smtDiagnostics.payloadUsed ?? {})}
                </pre>
              </div>
              <div>
                <h3 className="font-medium mb-2 text-sm">Raw SMT Body (JSON or text)</h3>
                <pre className="text-xs bg-gray-50 rounded-lg p-3 overflow-auto max-h-[24rem]">
{pretty(smtDiagnostics.smtJson ?? smtDiagnostics.smtText ?? {})}
                </pre>
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="grid md:grid-cols-3 gap-4">
        <div className="p-4 rounded-2xl border md:col-span-1">
          <h3 className="font-medium mb-2">SMT billing/fetch raw</h3>
          <pre className="text-xs bg-gray-50 rounded-lg p-3 overflow-auto max-h-[32rem]">
{pretty(billingRaw)}
          </pre>
        </div>
        <div className="p-4 rounded-2xl border md:col-span-1">
          <h3 className="font-medium mb-2">Usage debug raw</h3>
          <pre className="text-xs bg-gray-50 rounded-lg p-3 overflow-auto max-h-[32rem]">
{pretty(usageRaw)}
          </pre>
        </div>
        <div className="p-4 rounded-2xl border md:col-span-1">
          <h3 className="font-medium mb-2">Intervals debug raw</h3>
          <pre className="text-xs bg-gray-50 rounded-lg p-3 overflow-auto max-h-[32rem]">
{pretty(intervalsRaw)}
          </pre>
        </div>
      </section>

      <section className="p-4 rounded-2xl border">
        <h2 className="font-medium mb-3">Customer Usage View (live)</h2>
        <p className="text-sm text-gray-700 mb-3">
          This is the same <code>UsageDashboard</code> component used on the customer usage page. After running the test,
          reload this section (or the page) to see what the customer would see for their usage data.
        </p>
        <UsageDashboard />
      </section>
    </div>
  );
}


