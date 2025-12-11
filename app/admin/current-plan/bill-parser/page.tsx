'use client';

import { useEffect, useMemo, useState } from 'react';

type ParsedCurrentPlanPayload = {
  esiid: string | null;
  meterNumber: string | null;
  providerName: string | null;
  tdspName: string | null;
  accountNumber: string | null;
  customerName: string | null;
  serviceAddressLine1: string | null;
  serviceAddressLine2: string | null;
  serviceAddressCity: string | null;
  serviceAddressState: string | null;
  serviceAddressZip: string | null;
  rateType: string | null;
  variableIndexType: string | null;
  planName: string | null;
  termMonths: number | null;
  contractStartDate: string | null;
  contractEndDate: string | null;
  earlyTerminationFeeCents: number | null;
  baseChargeCentsPerMonth: number | null;
  energyRateTiers: unknown;
  timeOfUse: unknown;
  billCredits: unknown;
  billingPeriodStart: string | null;
  billingPeriodEnd: string | null;
  billIssueDate: string | null;
  billDueDate: string | null;
  totalAmountDueCents: number | null;
  rawText: string;
};

type BillParseResponse =
  | {
      ok: true;
      parsed: ParsedCurrentPlanPayload;
      rawTextPreview?: string;
    }
  | {
      ok: false;
      error?: string;
    };

type TemplateRow = {
  id: string;
  userId: string;
  houseId: string | null;
  uploadId: string | null;
  providerName: string | null;
  planName: string | null;
  rateType: string | null;
  tdspName: string | null;
  esiid: string | null;
  meterNumber: string | null;
  serviceAddressLine1: string | null;
  serviceAddressCity: string | null;
  serviceAddressState: string | null;
  serviceAddressZip: string | null;
  parserVersion: string | null;
  confidenceScore: number | null;
  hasTimeOfUse: boolean;
  hasBillCredits: boolean;
  createdAt: string;
  updatedAt: string;
};

type TemplatesResponse = {
  ok: boolean;
  limit: number;
  count: number;
  templates: TemplateRow[];
  error?: string;
};

function useAdminToken() {
  const [token, setToken] = useState('');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored =
      window.localStorage.getItem('intelliwattAdminToken') ??
      window.localStorage.getItem('intelliwatt_admin_token') ??
      window.localStorage.getItem('iw_admin_token') ??
      '';
    setToken(stored);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const trimmed = token.trim();
    if (trimmed.length > 0) {
      window.localStorage.setItem('intelliwattAdminToken', trimmed);
    }
  }, [token]);

  return { token, setToken };
}

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export default function CurrentPlanBillParserAdmin() {
  const { token, setToken } = useAdminToken();
  const [rawText, setRawText] = useState('');
  const [esiidHint, setEsiidHint] = useState('');
  const [addressHint, setAddressHint] = useState('');
  const [cityHint, setCityHint] = useState('');
  const [stateHint, setStateHint] = useState('TX');

  const [parseLoading, setParseLoading] = useState(false);
  const [parseStatus, setParseStatus] = useState<number | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parseResult, setParseResult] = useState<BillParseResponse | null>(null);

  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);

  const ready = useMemo(() => Boolean(token.trim()), [token]);

  async function runParse() {
    if (!token.trim()) {
      alert('Admin token is required.');
      return;
    }
    if (!rawText.trim()) {
      alert('Paste bill text into the input before running the parser.');
      return;
    }

    setParseLoading(true);
    setParseStatus(null);
    setParseError(null);
    setParseResult(null);

    try {
      const res = await fetch('/api/admin/current-plan/bill-parse', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': token.trim(),
        },
        body: JSON.stringify({
          rawText,
          esiidHint: esiidHint.trim() || null,
          addressLine1Hint: addressHint.trim() || null,
          cityHint: cityHint.trim() || null,
          stateHint: stateHint.trim() || null,
        }),
      });

      setParseStatus(res.status);

      const body = (await res.json().catch(() => null)) as BillParseResponse | null;

      if (!body) {
        setParseError('Empty response body from bill-parse endpoint.');
        return;
      }

      if (!res.ok || !body.ok) {
        const msg =
          (!body.ok && 'error' in body && body.error) ||
          `Request failed with status ${res.status}`;
        setParseError(msg || 'Failed to parse bill.');
        setParseResult(body);
        return;
      }

      setParseResult(body);
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error('[admin/bill-parser] parse failed', err);
      setParseError(err?.message ?? 'Unknown error while parsing bill.');
    } finally {
      setParseLoading(false);
    }
  }

  async function loadTemplates() {
    if (!token.trim()) {
      setTemplatesError('Admin token is required to load templates.');
      return;
    }
    setTemplatesLoading(true);
    setTemplatesError(null);

    try {
      const res = await fetch('/api/admin/current-plan/templates?limit=100', {
        headers: {
          'x-admin-token': token.trim(),
        },
      });

      const body = (await res.json().catch(() => null)) as TemplatesResponse | null;

      if (!body) {
        setTemplatesError('Empty response from templates endpoint.');
        return;
      }

      if (!res.ok || !body.ok) {
        const msg = body.error || `Request failed with status ${res.status}`;
        setTemplatesError(msg || 'Failed to load templates.');
        return;
      }

      setTemplates(body.templates || []);
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error('[admin/bill-parser] templates load failed', err);
      setTemplatesError(err?.message ?? 'Unknown error while loading templates.');
    } finally {
      setTemplatesLoading(false);
    }
  }

  useEffect(() => {
    if (token.trim()) {
      loadTemplates();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const parsedOk = parseResult && parseResult.ok;
  const parsedPayload = parsedOk ? (parseResult as any).parsed : null;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <h1 className="text-2xl font-semibold">Current Plan Bill Parser</h1>

      <section className="grid md:grid-cols-2 gap-4">
        <div className="p-4 rounded-2xl border">
          <h2 className="font-medium mb-3">Admin Auth</h2>
          <label className="block text-sm mb-1">x-admin-token</label>
          <input
            className="w-full rounded-lg border px-3 py-2"
            type="password"
            placeholder="paste admin token"
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
          {!ready && (
            <p className="text-sm text-red-600 mt-2">
              Token required for admin bill parsing.
            </p>
          )}
        </div>

        <div className="p-4 rounded-2xl border">
          <h2 className="font-medium mb-3">Optional Hints</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm mb-1">ESIID hint</label>
              <input
                className="w-full rounded-lg border px-3 py-2"
                value={esiidHint}
                onChange={(event) => setEsiidHint(event.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm mb-1">Service address line 1 hint</label>
              <input
                className="w-full rounded-lg border px-3 py-2"
                value={addressHint}
                onChange={(event) => setAddressHint(event.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm mb-1">City hint</label>
              <input
                className="w-full rounded-lg border px-3 py-2"
                value={cityHint}
                onChange={(event) => setCityHint(event.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm mb-1">State hint</label>
              <input
                className="w-full rounded-lg border px-3 py-2"
                value={stateHint}
                onChange={(event) => setStateHint(event.target.value)}
              />
            </div>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            Hints are passed through to the OpenAI-assisted parser but are optional. Leave blank
            to rely solely on the bill text.
          </p>
        </div>
      </section>

      <section className="p-4 rounded-2xl border space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-medium">Bill Text Input</h2>
          <button
            type="button"
            onClick={runParse}
            disabled={parseLoading || !ready}
            className="px-4 py-2 rounded-lg border bg-black text-white text-sm disabled:opacity-60 disabled:cursor-not-allowed hover:bg-gray-900"
          >
            {parseLoading ? 'Parsing…' : 'Run bill parser'}
          </button>
        </div>
        <p className="text-sm text-gray-600">
          Paste the raw text of a residential bill below. The admin endpoint will run the same
          parsing logic used by the customer flow (regex + OpenAI), without writing anything to the
          database.
        </p>
        <textarea
          className="w-full min-h-[200px] rounded-lg border px-3 py-2 font-mono text-xs"
          placeholder="Paste bill text here…"
          value={rawText}
          onChange={(event) => setRawText(event.target.value)}
        />
        {parseError && (
          <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            Error: {parseError}
          </div>
        )}
      </section>

      <section className="grid md:grid-cols-2 gap-4">
        <div className="p-4 rounded-2xl border space-y-3">
          <h2 className="font-medium">Parse Summary</h2>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
            <dt className="text-gray-500">ok</dt>
            <dd>{parseResult ? String(parseResult.ok) : ''}</dd>
            <dt className="text-gray-500">HTTP status</dt>
            <dd>{parseStatus ?? ''}</dd>
            <dt className="text-gray-500">ESIID</dt>
            <dd>{parsedPayload?.esiid ?? '—'}</dd>
            <dt className="text-gray-500">Meter</dt>
            <dd>{parsedPayload?.meterNumber ?? '—'}</dd>
            <dt className="text-gray-500">Provider</dt>
            <dd>{parsedPayload?.providerName ?? '—'}</dd>
            <dt className="text-gray-500">TDSP</dt>
            <dd>{parsedPayload?.tdspName ?? '—'}</dd>
            <dt className="text-gray-500">Plan name</dt>
            <dd>{parsedPayload?.planName ?? '—'}</dd>
            <dt className="text-gray-500">Rate type</dt>
            <dd>{parsedPayload?.rateType ?? '—'}</dd>
            <dt className="text-gray-500">Base charge (¢/mo)</dt>
            <dd>{parsedPayload?.baseChargeCentsPerMonth ?? '—'}</dd>
            <dt className="text-gray-500">Early term fee (¢)</dt>
            <dd>{parsedPayload?.earlyTerminationFeeCents ?? '—'}</dd>
          </dl>
        </div>

        <div className="p-4 rounded-2xl border">
          <h2 className="font-medium mb-2">Raw Parser Response</h2>
          <pre className="text-xs bg-gray-50 rounded-lg p-3 overflow-auto max-h-[32rem]">
{prettyJson(parseResult)}
          </pre>
        </div>
      </section>

      <section className="p-4 rounded-2xl border space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-medium">Parsed Bill Templates</h2>
          <button
            type="button"
            onClick={loadTemplates}
            disabled={templatesLoading || !ready}
            className="px-4 py-2 rounded-lg border bg-white text-sm hover:bg-gray-50 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {templatesLoading ? 'Refreshing…' : 'Refresh list'}
          </button>
        </div>
        <p className="text-sm text-gray-600">
          These rows come from the <code>ParsedCurrentPlan</code> table in the current-plan module.
          Use this list to track which bill formats have been seen and whether they include TOU or
          bill credit details.
        </p>
        {templatesError && (
          <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            Error loading templates: {templatesError}
          </div>
        )}
        {templates.length === 0 ? (
          <div className="rounded-md border border-gray-200 bg-gray-50 px-4 py-6 text-sm text-gray-600">
            No parsed bill templates found yet.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="min-w-full text-xs">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Created</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Provider</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Plan</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Rate type</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">ESIID</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Meter</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">City</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">TOU</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Credits</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Parser</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Confidence</th>
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-2 text-gray-700">
                      {new Date(t.createdAt).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-gray-800">
                      {t.providerName ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-gray-800">
                      {t.planName ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-gray-700">
                      {t.rateType ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-gray-700">
                      {t.esiid ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-gray-700">
                      {t.meterNumber ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-gray-700">
                      {t.serviceAddressCity
                        ? `${t.serviceAddressCity}, ${t.serviceAddressState ?? ''}`
                        : '—'}
                    </td>
                    <td className="px-3 py-2 text-gray-700">
                      {t.hasTimeOfUse ? 'yes' : 'no'}
                    </td>
                    <td className="px-3 py-2 text-gray-700">
                      {t.hasBillCredits ? 'yes' : 'no'}
                    </td>
                    <td className="px-3 py-2 text-gray-700">
                      {t.parserVersion ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-gray-700">
                      {typeof t.confidenceScore === 'number'
                        ? t.confidenceScore.toFixed(3)
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}


