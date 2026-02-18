'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

type ApiResult = {
  endpoint: string;
  status: number;
  ok: boolean;
  payload: Record<string, unknown>;
  response: any;
  error?: string;
};

function useLocalToken(key = 'iw_admin_token') {
  const [token, setToken] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem(key) || '';
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (token) {
      window.localStorage.setItem(key, token);
    } else {
      window.localStorage.removeItem(key);
    }
  }, [key, token]);

  return { token, setToken };
}

function pretty(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export default function SMTAgreementsAdmin() {
  const { token, setToken } = useLocalToken();
  const ready = useMemo(() => Boolean(token), [token]);

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ApiResult | null>(null);

  const [statusEsiid, setStatusEsiid] = useState('');
  const [agreementsNumber, setAgreementsNumber] = useState('');
  const [agreementsStatusReason, setAgreementsStatusReason] = useState('');
  const [esiidsAgreementNumber, setEsiidsAgreementNumber] = useState('');
  const [terminateAgreementNumber, setTerminateAgreementNumber] = useState('');
  const [terminateEmail, setTerminateEmail] = useState('');
  const [reportCorrelationId, setReportCorrelationId] = useState('');
  const [reportServiceType, setReportServiceType] = useState('');

  async function callAdmin(
    endpoint: string,
    body: Record<string, unknown>,
  ): Promise<void> {
    if (!token) {
      alert('Set x-admin-token first');
      return;
    }

    setLoading(true);
    setResult(null);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-admin-token': token,
          accept: 'application/json',
        },
        body: JSON.stringify(body),
      });

      const response = await res
        .json()
        .catch(() => ({ error: 'Failed to parse JSON' }));

      setResult({
        endpoint,
        status: res.status,
        ok: res.ok,
        payload: body,
        response,
      });
    } catch (error: any) {
      setResult({
        endpoint,
        status: 0,
        ok: false,
        payload: body,
        response: null,
        error: error?.message ?? 'Request failed',
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">SMT Agreement Admin Tools</h1>
        <p className="mt-2 text-sm text-gray-600">
          Internal-only utilities for SMT agreements. All requests require a valid{' '}
          <code>x-admin-token</code> and are proxied through the IntelliWatt droplet.
        </p>
        <p className="mt-1 text-sm text-gray-600">
          Return to{' '}
          <Link className="text-brand-navy underline" href="/admin/smt/inspector">
            SMT Inspector hub
          </Link>
          .
        </p>
      </div>

      <section className="rounded-2xl border p-4">
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
          <p className="mt-2 text-sm text-red-600">Token required for all actions.</p>
        )}
      </section>

      <section className="rounded-2xl border p-4 space-y-3">
        <h2 className="font-medium">Agreement Status by ESIID</h2>
        <p className="text-sm text-gray-600">
          Calls <code>/api/admin/smt/agreements/status</code> → droplet{' '}
          <code>/agreements/status</code> to check current SMT agreement/subscription state.
        </p>
        <form
          className="flex flex-col gap-3 md:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            if (!statusEsiid.trim()) {
              alert('Enter an ESIID');
              return;
            }
            void callAdmin('/api/admin/smt/agreements/status', {
              esiid: statusEsiid.trim(),
            });
          }}
        >
          <input
            className="flex-1 rounded-lg border px-3 py-2"
            placeholder="ESIID (required)"
            value={statusEsiid}
            onChange={(e) => setStatusEsiid(e.target.value)}
          />
          <button
            type="submit"
            className="rounded-lg border bg-blue-50 px-4 py-2 font-semibold hover:bg-blue-100"
            disabled={loading || !ready}
          >
            {loading ? 'Working…' : 'Fetch Status'}
          </button>
        </form>
      </section>

      <section className="rounded-2xl border p-4 space-y-3">
        <h2 className="font-medium">Agreement ESIIDs</h2>
        <p className="text-sm text-gray-600">
          Calls <code>/api/admin/smt/agreements/esiids</code> → droplet{' '}
          <code>/smt/agreements/esiids</code> to list all ESIIDs tied to an agreement.
        </p>
        <form
          className="flex flex-col gap-3 md:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            if (!esiidsAgreementNumber.trim()) {
              alert('Enter an agreement number');
              return;
            }
            const agreementNumber = Number.parseInt(esiidsAgreementNumber.trim(), 10);
            void callAdmin('/api/admin/smt/agreements/esiids', {
              agreementNumber: Number.isNaN(agreementNumber)
                ? esiidsAgreementNumber.trim()
                : agreementNumber,
            });
          }}
        >
          <input
            className="flex-1 rounded-lg border px-3 py-2"
            placeholder="Agreement number"
            value={esiidsAgreementNumber}
            onChange={(e) => setEsiidsAgreementNumber(e.target.value)}
          />
          <button
            type="submit"
            className="rounded-lg border bg-blue-50 px-4 py-2 font-semibold hover:bg-blue-100"
            disabled={loading || !ready}
          >
            {loading ? 'Working…' : 'Fetch ESIIDs'}
          </button>
        </form>
      </section>

      <section className="rounded-2xl border p-4 space-y-3">
        <h2 className="font-medium">Terminate Agreement</h2>
        <p className="text-sm text-gray-600">
          Calls <code>/api/admin/smt/agreements/terminate</code> → droplet{' '}
          <code>/smt/agreements/terminate</code> (SMT Terminateagreement). Requires the original
          retail customer email used in SMT.
        </p>
        <form
          className="grid gap-3 md:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!terminateAgreementNumber.trim()) {
              alert('Agreement number required');
              return;
            }
            if (!terminateEmail.trim()) {
              alert('Retail customer email required');
              return;
            }
            const agreementNumber = Number.parseInt(
              terminateAgreementNumber.trim(),
              10,
            );
            void callAdmin('/api/admin/smt/agreements/terminate', {
              agreementNumber: Number.isNaN(agreementNumber)
                ? terminateAgreementNumber.trim()
                : agreementNumber,
              retailCustomerEmail: terminateEmail.trim(),
            });
          }}
        >
          <input
            className="rounded-lg border px-3 py-2"
            placeholder="Agreement number"
            value={terminateAgreementNumber}
            onChange={(e) => setTerminateAgreementNumber(e.target.value)}
          />
          <input
            className="rounded-lg border px-3 py-2"
            placeholder="Retail customer email"
            value={terminateEmail}
            onChange={(e) => setTerminateEmail(e.target.value)}
          />
          <div className="md:col-span-2">
            <button
              type="submit"
              className="rounded-lg border bg-red-50 px-4 py-2 font-semibold text-red-700 hover:bg-red-100"
              disabled={loading || !ready}
            >
              {loading ? 'Working…' : 'Terminate Agreement'}
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-2xl border p-4 space-y-3">
        <h2 className="font-medium">My Agreements (Filter)</h2>
        <p className="text-sm text-gray-600">
          Calls <code>/api/admin/smt/agreements/myagreements</code> to list agreements for this CSP.
          Filters are optional; omit fields to list all.
        </p>
        <form
          className="grid gap-3 md:grid-cols-3"
          onSubmit={(event) => {
            event.preventDefault();
            const payload: Record<string, unknown> = {};
            if (agreementsNumber.trim()) {
              const parsed = Number.parseInt(agreementsNumber.trim(), 10);
              payload.agreementNumber = Number.isNaN(parsed)
                ? agreementsNumber.trim()
                : parsed;
            }
            if (agreementsStatusReason.trim()) {
              payload.statusReason = agreementsStatusReason.trim();
            }
            void callAdmin('/api/admin/smt/agreements/myagreements', payload);
          }}
        >
          <input
            className="rounded-lg border px-3 py-2"
            placeholder="Agreement number (optional)"
            value={agreementsNumber}
            onChange={(e) => setAgreementsNumber(e.target.value)}
          />
          <input
            className="rounded-lg border px-3 py-2"
            placeholder="Status reason (optional)"
            value={agreementsStatusReason}
            onChange={(e) => setAgreementsStatusReason(e.target.value)}
          />
          <div className="md:col-span-1 flex items-center">
            <button
              type="submit"
              className="rounded-lg border bg-blue-50 px-4 py-2 font-semibold hover:bg-blue-100"
              disabled={loading || !ready}
            >
              {loading ? 'Working…' : 'List Agreements'}
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-2xl border p-4 space-y-3">
        <h2 className="font-medium">Report Status (Correlation)</h2>
        <p className="text-sm text-gray-600">
          Calls <code>/api/admin/smt/report-status</code> → droplet{' '}
          <code>/smt/report-status</code> to check SMT <code>reportrequeststatus</code> for adhoc or
          subscription reports.
        </p>
        <form
          className="grid gap-3 md:grid-cols-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!reportCorrelationId.trim()) {
              alert('Correlation ID required');
              return;
            }
            const payload: Record<string, unknown> = {
              correlationId: reportCorrelationId.trim(),
            };
            if (reportServiceType) {
              payload.serviceType = reportServiceType;
            }
            void callAdmin('/api/admin/smt/report-status', payload);
          }}
        >
          <input
            className="md:col-span-2 rounded-lg border px-3 py-2"
            placeholder="Correlation ID"
            value={reportCorrelationId}
            onChange={(e) => setReportCorrelationId(e.target.value)}
          />
          <select
            className="rounded-lg border px-3 py-2"
            value={reportServiceType}
            onChange={(e) => setReportServiceType(e.target.value)}
          >
            <option value="">Service type (optional)</option>
            <option value="ADHOC">ADHOC</option>
            <option value="SUBSCRIPTION">SUBSCRIPTION</option>
          </select>
          <div className="md:col-span-3 flex items-center">
            <button
              type="submit"
              className="rounded-lg border bg-blue-50 px-4 py-2 font-semibold hover:bg-blue-100"
              disabled={loading || !ready}
            >
              {loading ? 'Working…' : 'Fetch Report Status'}
            </button>
          </div>
        </form>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border p-4">
          <h3 className="font-medium mb-2">Request Summary</h3>
          {result ? (
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
              <dt className="text-gray-500">endpoint</dt>
              <dd>{result.endpoint}</dd>
              <dt className="text-gray-500">status</dt>
              <dd>{result.status}</dd>
              <dt className="text-gray-500">ok</dt>
              <dd>{String(result.ok)}</dd>
              <dt className="text-gray-500">error</dt>
              <dd>{result.error ?? ''}</dd>
            </dl>
          ) : (
            <p className="text-sm text-gray-500">No calls yet.</p>
          )}
        </div>
        <div className="rounded-2xl border p-4">
          <h3 className="font-medium mb-2">Raw Response</h3>
          <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap rounded bg-gray-50 p-3 text-xs">
{pretty(result?.response ?? null)}
          </pre>
        </div>
      </section>
    </div>
  );
}

