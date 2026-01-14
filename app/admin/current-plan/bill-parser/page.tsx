'use client';

import { useEffect, useMemo, useState, ChangeEvent } from 'react';
import type { ParsedCurrentPlanPayload as ParsedCurrentPlanPayloadBase } from '@/lib/billing/parseBillText';

type ParsedCurrentPlanPayload = ParsedCurrentPlanPayloadBase;

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

type BillQueueItem = any;
type BillPlanTemplateRow = {
  id: string;
  providerName: string | null;
  planName: string | null;
  rateType: string | null;
  termMonths: number | null;
  earlyTerminationFeeCents: number | null;
  baseChargeCentsPerMonth: number | null;
  hasTimeOfUse: boolean;
  hasBillCredits: boolean;
  createdAt: string;
  updatedAt: string;
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

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

type SmtPreviewProps = {
  parsed: ParsedCurrentPlanPayload;
};

function SmtAuthorizationPreview({ parsed }: SmtPreviewProps) {
  const addressLines = [
    parsed.serviceAddressLine1 ?? '',
    parsed.serviceAddressLine2 ?? '',
  ]
    .filter((line) => line && line.trim().length > 0)
    .join('\n');

  const cityStateZip = [parsed.serviceAddressCity, parsed.serviceAddressState, parsed.serviceAddressZip]
    .filter((part) => part && part.trim().length > 0)
    .join(', ');

  return (
    <section className="p-4 rounded-2xl border space-y-3">
      <h2 className="font-medium">SMT Authorization Form Preview</h2>
      <p className="text-xs text-gray-600">
        Read-only snapshot of the customer SMT form, prefilled from the parsed bill data. This does
        not submit or call SMT – it is only for visual verification.
      </p>

      <div className="grid gap-3 rounded-lg border-2 border-brand-blue bg-brand-navy p-3 text-xs text-brand-cyan md:grid-cols-2">
        <div className="space-y-1">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-brand-cyan">
            Service Address on File
          </div>
          <div className="space-y-0.5 whitespace-pre-line">
            <div>{addressLines || <span className="italic text-brand-cyan/70">Not available</span>}</div>
            <div>{cityStateZip || <span className="italic text-brand-cyan/70">Not available</span>}</div>
            <div>
              <span className="font-semibold">ESIID · </span>
              {parsed.esiid || <span className="italic text-brand-cyan/70">Not available</span>}
            </div>
            <div>
              <span className="font-semibold">Utility · </span>
              {parsed.tdspName || <span className="italic text-brand-cyan/70">Not available</span>}
            </div>
          </div>
        </div>
        <div className="space-y-1">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-brand-cyan">
            Retail Electric Provider
          </div>
          <div className="space-y-0.5">
            <div>
              <span className="font-semibold">Provider · </span>
              {parsed.providerName || <span className="italic text-brand-cyan/70">Not available</span>}
            </div>
            <div>
              <span className="font-semibold">Customer name · </span>
              {parsed.customerName || <span className="italic text-brand-cyan/70">Not available</span>}
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1 text-xs">
          <label className="block font-semibold uppercase tracking-wide text-slate-800">
            Name on electric bill
          </label>
          <input
            type="text"
            readOnly
            value={parsed.customerName ?? ''}
            className="w-full rounded-md border border-slate-300 bg-slate-100 px-2 py-1.5 text-xs text-slate-900"
            placeholder="First and last name"
          />
        </div>
        <div className="space-y-1 text-xs">
          <label className="block font-semibold uppercase tracking-wide text-slate-800">
            Meter number
          </label>
          <input
            type="text"
            readOnly
            value={parsed.meterNumber ?? ''}
            className="w-full rounded-md border border-slate-300 bg-slate-100 px-2 py-1.5 text-xs text-slate-900"
            placeholder="Meter number from bill"
          />
        </div>
      </div>
    </section>
  );
}

type CurrentPlanPreviewProps = {
  parsed: ParsedCurrentPlanPayload;
};

function CurrentPlanFormPreview({ parsed }: CurrentPlanPreviewProps) {
  const normalizedRateType: ParsedCurrentPlanPayload['rateType'] =
    parsed.rateType === 'FIXED' ||
    parsed.rateType === 'VARIABLE' ||
    parsed.rateType === 'TIME_OF_USE' ||
    parsed.rateType === 'OTHER'
      ? parsed.rateType
      : null;

  const baseFeeDollars =
    typeof parsed.baseChargeCentsPerMonth === 'number'
      ? (parsed.baseChargeCentsPerMonth / 100).toFixed(2)
      : '';

  const earlyTerminationDollars =
    typeof parsed.earlyTerminationFeeCents === 'number'
      ? (parsed.earlyTerminationFeeCents / 100).toFixed(2)
      : '';

  const termMonths = parsed.termMonths != null ? String(parsed.termMonths) : '';
  const contractEndDate = parsed.contractEndDate
    ? parsed.contractEndDate.slice(0, 10)
    : '';

  const esiid = parsed.esiid ?? '';
  const accountLast4 =
    parsed.accountNumber && parsed.accountNumber.length >= 4
      ? parsed.accountNumber.slice(-4)
      : '';

  return (
    <section className="p-4 rounded-2xl border space-y-3">
      <h2 className="font-medium">Current Plan Form Preview</h2>
      <p className="text-xs text-gray-600">
        Read-only approximation of the customer Current Rate Details form, populated from the parsed
        bill. This is a mirror of what the customer UI would use for auto-fill.
      </p>

      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1 text-xs text-brand-navy">
            <span className="font-semibold uppercase tracking-wide text-brand-navy/80">
              Electric company name
            </span>
            <input
              type="text"
              readOnly
              value={parsed.providerName ?? ''}
              className="w-full rounded-xl border border-slate-300 bg-slate-100 px-3 py-1.5 text-xs text-brand-navy"
              placeholder="e.g., Sample Energy Co."
            />
          </label>
          <label className="block space-y-1 text-xs text-brand-navy">
            <span className="font-semibold uppercase tracking-wide text-brand-navy/80">
              Plan name
            </span>
            <input
              type="text"
              readOnly
              value={parsed.planName ?? ''}
              className="w-full rounded-xl border border-slate-300 bg-slate-100 px-3 py-1.5 text-xs text-brand-navy"
              placeholder="e.g., Free Nights &amp; Weekends 12"
            />
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block space-y-1 text-xs text-brand-navy">
            <span className="font-semibold uppercase tracking-wide text-brand-navy/80">
              Rate type
            </span>
            <select
              value={normalizedRateType ?? ''}
              disabled
              className="w-full rounded-xl border border-slate-300 bg-slate-100 px-3 py-1.5 text-xs text-brand-navy"
            >
              <option value="">(not set)</option>
              <option value="FIXED">Fixed rate</option>
              <option value="VARIABLE">Variable / indexed rate</option>
              <option value="TIME_OF_USE">Time-of-use</option>
              <option value="OTHER">Other / custom</option>
            </select>
          </label>
          <label className="block space-y-1 text-xs text-brand-navy">
            <span className="font-semibold uppercase tracking-wide text-brand-navy/80">
              Base monthly fee ($/month)
            </span>
            <input
              type="text"
              readOnly
              value={baseFeeDollars}
              className="w-full rounded-xl border border-slate-300 bg-slate-100 px-3 py-1.5 text-xs text-brand-navy"
              placeholder="e.g., 4.95"
            />
          </label>
          <label className="block space-y-1 text-xs text-brand-navy">
            <span className="font-semibold uppercase tracking-wide text-brand-navy/80">
              Term length (months)
            </span>
            <input
              type="text"
              readOnly
              value={termMonths}
              className="w-full rounded-xl border border-slate-300 bg-slate-100 px-3 py-1.5 text-xs text-brand-navy"
              placeholder="e.g., 12"
            />
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block space-y-1 text-xs text-brand-navy">
            <span className="font-semibold uppercase tracking-wide text-brand-navy/80">
              Contract expiration date
            </span>
            <input
              type="date"
              readOnly
              value={contractEndDate}
              className="w-full rounded-xl border border-slate-300 bg-slate-100 px-3 py-1.5 text-xs text-brand-navy"
            />
          </label>
          <label className="block space-y-1 text-xs text-brand-navy">
            <span className="font-semibold uppercase tracking-wide text-brand-navy/80">
              Early termination fee ($)
            </span>
            <input
              type="text"
              readOnly
              value={earlyTerminationDollars}
              className="w-full rounded-xl border border-slate-300 bg-slate-100 px-3 py-1.5 text-xs text-brand-navy"
              placeholder="e.g., 150"
            />
          </label>
          <label className="block space-y-1 text-xs text-brand-navy">
            <span className="font-semibold uppercase tracking-wide text-brand-navy/80">
              ESIID
            </span>
            <input
              type="text"
              readOnly
              value={esiid}
              className="w-full rounded-xl border border-slate-300 bg-slate-100 px-3 py-1.5 text-xs text-brand-navy"
              placeholder="17- or 22-digit ID"
            />
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1 text-xs text-brand-navy">
            <span className="font-semibold uppercase tracking-wide text-brand-navy/80">
              Account number (last digits)
            </span>
            <input
              type="text"
              readOnly
              value={accountLast4}
              className="w-full rounded-xl border border-slate-300 bg-slate-100 px-3 py-1.5 text-xs text-brand-navy"
              placeholder="Last 4 digits"
            />
          </label>
          <label className="block space-y-1 text-xs text-brand-navy">
            <span className="font-semibold uppercase tracking-wide text-brand-navy/80">
              Time-of-use / credits flags
            </span>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="inline-flex items-center rounded-full border border-slate-300 bg-slate-100 px-3 py-1">
                TOU config:{" "}
                {Array.isArray((parsed as any)?.timeOfUse?.periods) && (parsed as any).timeOfUse.periods.length > 0
                  ? 'present'
                  : '—'}
              </span>
              <span className="inline-flex items-center rounded-full border border-slate-300 bg-slate-100 px-3 py-1">
                Bill credits:{" "}
                {(parsed as any)?.billCredits?.enabled === true &&
                Array.isArray((parsed as any)?.billCredits?.rules) &&
                (parsed as any).billCredits.rules.length > 0
                  ? 'present'
                  : '—'}
              </span>
              <span className="inline-flex items-center rounded-full border border-slate-300 bg-slate-100 px-3 py-1">
                Energy tiers:{' '}
                {Array.isArray(parsed.energyRateTiers)
                  ? `${(parsed.energyRateTiers as unknown[]).length} tier(s)`
                  : '—'}
              </span>
            </div>
          </label>
        </div>
      </div>
    </section>
  );
}

export default function CurrentPlanBillParserAdmin() {
  const { token, setToken } = useAdminToken();
  const [rawText, setRawText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
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

  const [billPlanTemplatesLoading, setBillPlanTemplatesLoading] = useState(false);
  const [billPlanTemplatesError, setBillPlanTemplatesError] = useState<string | null>(null);
  const [billPlanTemplates, setBillPlanTemplates] = useState<BillPlanTemplateRow[]>([]);
  const [billPlanBackfillLoading, setBillPlanBackfillLoading] = useState(false);
  const [billPlanBackfillNote, setBillPlanBackfillNote] = useState<string | null>(null);

  // Bill parse review queue (DB-backed; uses the same table as EFL review queue)
  const [queueStatus, setQueueStatus] = useState<'OPEN' | 'RESOLVED'>('OPEN');
  const [queueQ, setQueueQ] = useState('');
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [queueItems, setQueueItems] = useState<BillQueueItem[]>([]);
  const [queueResolvingId, setQueueResolvingId] = useState<string | null>(null);
  const [queueCopiedAt, setQueueCopiedAt] = useState<number | null>(null);

  const ready = useMemo(() => Boolean(token.trim()), [token]);

  async function loadQueue() {
    if (!token.trim()) {
      setQueueError('Admin token is required to load the bill parse queue.');
      return;
    }
    setQueueLoading(true);
    setQueueError(null);
    try {
      const params = new URLSearchParams({
        status: queueStatus,
        limit: '100',
        // Bill parser page: ONLY include bill parsing queue items (statements), not current-plan EFL queue items.
        source: 'current_plan_bill',
        kind: 'EFL_PARSE',
      });
      if (queueQ.trim()) params.set('q', queueQ.trim());
      const res = await fetch(`/api/admin/efl-review/list?${params.toString()}`, {
        headers: { 'x-admin-token': token.trim() },
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        throw new Error(body?.error || `Request failed with status ${res.status}`);
      }
      setQueueItems(Array.isArray(body.items) ? body.items : []);
    } catch (err: any) {
      setQueueError(err?.message ?? 'Failed to load bill parse queue.');
    } finally {
      setQueueLoading(false);
    }
  }

  async function resolveQueueItem(id: string) {
    if (!token.trim()) return;
    setQueueResolvingId(id);
    try {
      const res = await fetch('/api/admin/efl-review/resolve', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': token.trim(),
        },
        body: JSON.stringify({ id }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        throw new Error(body?.error || `Request failed with status ${res.status}`);
      }
      await loadQueue();
    } catch (err: any) {
      setQueueError(err?.message ?? 'Failed to resolve queue item.');
    } finally {
      setQueueResolvingId(null);
    }
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    setFileError(null);
    setFileName(file.name);
    setFileLoading(true);

    try {
      if (!token.trim()) {
        setFileError('Admin token is required before uploading a bill.');
        return;
      }

      const lowerName = (file.name || '').toLowerCase();
      const mime = (file.type || '').toLowerCase();
      const isPdf =
        mime === 'application/pdf' ||
        lowerName.endsWith('.pdf');

      if (!isPdf) {
        setFileError(
          'Only PDF bill uploads are allowed. If your bill is an image or screenshot, open it and copy/paste the visible text into the textarea instead.',
        );
        return;
      }

      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/admin/current-plan/extract-text', {
        method: 'POST',
        headers: {
          'x-admin-token': token.trim(),
        },
        body: formData,
      });

      const body = (await res.json().catch(() => null)) as
        | { ok: boolean; text?: string; error?: string }
        | null;

      if (!body) {
        setFileError('Empty response from admin extract-text endpoint.');
        return;
      }

      if (!res.ok || !body.ok || !body.text) {
        setFileError(
          body.error ||
            `Failed to extract text from PDF (status ${res.status}). Try opening the bill and copy/pasting the visible text instead.`,
        );
        return;
      }

      setRawText(body.text);
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.error('[admin/bill-parser] failed to extract text from PDF', err);
      setFileError(
        err?.message ??
          'Failed to extract text from PDF. Try opening the bill and copy/pasting the visible text instead.',
      );
    } finally {
      setFileLoading(false);
    }
  }

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
      // Bill parser page: exclude EFL-derived ParsedCurrentPlan rows.
      const res = await fetch('/api/admin/current-plan/templates?limit=100&excludeEfl=1', {
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

  async function loadBillPlanTemplates() {
    if (!token.trim()) {
      setBillPlanTemplatesError("Admin token is required to load current plan templates.");
      return;
    }
    setBillPlanTemplatesLoading(true);
    setBillPlanTemplatesError(null);
    try {
      // Bill parser page: show only templates backed by statement bill parses (exclude EFL-derived templates).
      const res = await fetch("/api/admin/current-plan/bill-plan-templates?limit=200&onlyFromBills=1", {
        headers: { "x-admin-token": token.trim() },
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        throw new Error(body?.error || `Request failed with status ${res.status}`);
      }
      setBillPlanTemplates(Array.isArray(body.templates) ? body.templates : []);
    } catch (err: any) {
      console.error("[admin/bill-parser] bill plan templates load failed", err);
      setBillPlanTemplatesError(err?.message ?? "Unknown error while loading current plan templates.");
    } finally {
      setBillPlanTemplatesLoading(false);
    }
  }

  async function backfillBillPlanTemplates() {
    if (!token.trim()) {
      setBillPlanBackfillNote("Admin token is required.");
      return;
    }
    setBillPlanBackfillLoading(true);
    setBillPlanBackfillNote(null);
    setBillPlanTemplatesError(null);
    try {
      const res = await fetch("/api/admin/current-plan/bill-plan-templates/backfill?limit=500", {
        method: "POST",
        headers: { "x-admin-token": token.trim() },
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        throw new Error(body?.error || `Request failed with status ${res.status}`);
      }
      setBillPlanBackfillNote(
        `Backfill: scanned=${body.scanned ?? 0} unique=${body.uniqueCandidates ?? 0} upserted=${body.upserted ?? 0} errors=${body.errors ?? 0}`,
      );
      await loadBillPlanTemplates();
    } catch (err: any) {
      console.error("[admin/bill-parser] bill plan templates backfill failed", err);
      setBillPlanTemplatesError(err?.message ?? "Unknown error while backfilling current plan templates.");
    } finally {
      setBillPlanBackfillLoading(false);
    }
  }

  useEffect(() => {
    if (token.trim()) {
      loadTemplates();
      loadBillPlanTemplates();
      loadQueue();
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

      <section id="queue" className="p-4 rounded-2xl border space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="font-medium">Bill Parse Review Queue</h2>
            <p className="text-sm text-gray-600">
              These are customer bill parses that did not extract the required fields. Use this queue to copy
              the raw text + parser outputs for debugging, load the bill into the runner above, and mark items
              resolved once fixed.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <select
              value={queueStatus}
              onChange={(e) => setQueueStatus(e.target.value as any)}
              className="rounded-lg border px-3 py-2 text-sm"
            >
              <option value="OPEN">Open</option>
              <option value="RESOLVED">Resolved</option>
            </select>
            <input
              value={queueQ}
              onChange={(e) => setQueueQ(e.target.value)}
              placeholder="Search provider / plan / sha / reason…"
              className="rounded-lg border px-3 py-2 text-sm w-full sm:w-[320px]"
            />
            <button
              type="button"
              onClick={loadQueue}
              disabled={queueLoading || !ready}
              className="px-4 py-2 rounded-lg border bg-white text-sm hover:bg-gray-50 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {queueLoading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>

        {queueError ? (
          <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            Error loading queue: {queueError}
          </div>
        ) : null}

        {queueCopiedAt ? (
          <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            Copied debug bundle to clipboard ({new Date(queueCopiedAt).toLocaleTimeString()}).
          </div>
        ) : null}

        {queueItems.length === 0 ? (
          <div className="rounded-md border border-gray-200 bg-gray-50 px-4 py-6 text-sm text-gray-600">
            No items in the bill parse queue.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="min-w-full text-xs">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Created</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Provider</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Plan</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Reason</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">SHA</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody>
                {queueItems.map((it: any) => {
                  const id = String(it.id);
                  const sha = String(it.eflPdfSha256 ?? '');
                  const provider = it.supplier ?? '—';
                  const plan = it.planName ?? '—';
                  const reason = it.queueReason ?? '—';
                  const createdAt = it.createdAt ? new Date(it.createdAt).toLocaleString() : '—';
                  const raw = typeof it.rawText === 'string' ? it.rawText : '';
                  const derived = it.derivedForValidation ?? null;
                  const solverApplied = it.solverApplied ?? null;

                  const debugBundle = {
                    source: it.source ?? null,
                    kind: it.kind ?? null,
                    createdAt: it.createdAt ?? null,
                    updatedAt: it.updatedAt ?? null,
                    queueReason: it.queueReason ?? null,
                    sha256: sha,
                    solverApplied,
                    derivedForValidation: derived,
                    rawText: raw,
                  };

                  return (
                    <tr key={id} className="border-t border-gray-100 align-top hover:bg-gray-50">
                      <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{createdAt}</td>
                      <td className="px-3 py-2 text-gray-800">{provider}</td>
                      <td className="px-3 py-2 text-gray-800">{plan}</td>
                      <td className="px-3 py-2 text-gray-700 max-w-[320px]">
                        <div className="break-words">{String(reason)}</div>
                      </td>
                      <td className="px-3 py-2 text-gray-700 font-mono max-w-[220px]">
                        <div className="break-all">{sha.slice(0, 12)}…</div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-col gap-2">
                          <button
                            type="button"
                            className="px-2 py-1 rounded border bg-white text-[11px] font-medium hover:bg-gray-50"
                            onClick={async () => {
                              const ok = await copyToClipboard(prettyJson(debugBundle));
                              if (ok) {
                                setQueueCopiedAt(Date.now());
                                window.setTimeout(() => setQueueCopiedAt(null), 5000);
                              } else {
                                alert('Copy failed (clipboard permission).');
                              }
                            }}
                          >
                            Copy debug bundle
                          </button>
                          <button
                            type="button"
                            className="px-2 py-1 rounded border bg-white text-[11px] font-medium hover:bg-gray-50"
                            disabled={!raw}
                            onClick={() => {
                              if (!raw) return;
                              setRawText(raw);
                              // Best-effort: prefill hints if present in derivedForValidation.
                              try {
                                const baseline = (derived as any)?.baseline ?? null;
                                if (baseline?.esiid && typeof baseline.esiid === 'string') setEsiidHint(baseline.esiid);
                                if (baseline?.serviceAddressLine1 && typeof baseline.serviceAddressLine1 === 'string') setAddressHint(baseline.serviceAddressLine1);
                                if (baseline?.serviceAddressCity && typeof baseline.serviceAddressCity === 'string') setCityHint(baseline.serviceAddressCity);
                                if (baseline?.serviceAddressState && typeof baseline.serviceAddressState === 'string') setStateHint(baseline.serviceAddressState);
                              } catch {
                                // ignore
                              }
                              window.scrollTo({ top: 0, behavior: 'smooth' });
                            }}
                          >
                            Load into parser
                          </button>
                          {queueStatus === 'OPEN' ? (
                            <button
                              type="button"
                              className="px-2 py-1 rounded border border-emerald-500 bg-emerald-50 text-[11px] font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-60"
                              disabled={queueResolvingId === id || !ready}
                              onClick={() => resolveQueueItem(id)}
                            >
                              {queueResolvingId === id ? 'Resolving…' : 'Mark resolved'}
                            </button>
                          ) : null}
                          <details className="rounded border bg-white px-2 py-1">
                            <summary className="cursor-pointer text-[11px] font-medium text-gray-700">
                              View raw text + outputs
                            </summary>
                            <div className="mt-2 space-y-2">
                              <div className="text-[11px] font-semibold text-gray-600">Raw text</div>
                              <pre className="max-h-[240px] overflow-auto rounded bg-gray-50 p-2 text-[11px] whitespace-pre-wrap">
{raw || '—'}
                              </pre>
                              <div className="text-[11px] font-semibold text-gray-600">derivedForValidation</div>
                              <pre className="max-h-[240px] overflow-auto rounded bg-gray-50 p-2 text-[11px]">
{prettyJson(derived)}
                              </pre>
                              <div className="text-[11px] font-semibold text-gray-600">solverApplied</div>
                              <pre className="max-h-[200px] overflow-auto rounded bg-gray-50 p-2 text-[11px]">
{prettyJson(solverApplied)}
                              </pre>
                            </div>
                          </details>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
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
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-800">
            Upload bill file (optional)
          </label>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="file"
              accept=".pdf,application/pdf"
              onChange={handleFileChange}
              className="text-sm"
            />
            {fileName && (
              <span className="text-xs text-gray-600">
                Selected: {fileName}
                {fileLoading ? ' (reading…) ' : ''}
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500">
            This helper mirrors the production flow: it accepts <span className="font-semibold">PDF bills only</span>,
            uses the same server-side PDF text extractor, and then runs the OpenAI-assisted parser on the
            extracted text. For images or screenshots, open the bill and copy/paste the visible text into
            the textarea instead.
          </p>
          {fileError && (
            <div className="mt-1 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {fileError}
            </div>
          )}
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

      {parsedPayload && (
        <section className="grid md:grid-cols-2 gap-4">
          <SmtAuthorizationPreview parsed={parsedPayload} />
          <CurrentPlanFormPreview parsed={parsedPayload} />
        </section>
      )}

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

      <section className="p-4 rounded-2xl border space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-medium">Current Plan Templates (BillPlanTemplate)</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadBillPlanTemplates}
              disabled={billPlanTemplatesLoading || !ready}
              className="px-4 py-2 rounded-lg border bg-white text-sm hover:bg-gray-50 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {billPlanTemplatesLoading ? "Refreshing…" : "Refresh list"}
            </button>
            <button
              type="button"
              onClick={backfillBillPlanTemplates}
              disabled={billPlanBackfillLoading || !ready}
              className="px-4 py-2 rounded-lg border border-blue-200 bg-blue-50 text-blue-900 text-sm hover:bg-blue-100 disabled:opacity-60 disabled:cursor-not-allowed"
              title="Promote the most recent ParsedCurrentPlan rows into plan-level templates (provider+plan)."
            >
              {billPlanBackfillLoading ? "Backfilling…" : "Backfill from ParsedCurrentPlan"}
            </button>
          </div>
        </div>
        <p className="text-sm text-gray-600">
          These are plan-level templates (provider + plan name) derived from customer uploads (including current-plan EFL PDFs).
          When a current plan EFL is corrected and passes validation, it should auto-resolve out of the queue and land here.
        </p>
        {billPlanBackfillNote ? (
          <div className="text-xs text-gray-600">{billPlanBackfillNote}</div>
        ) : null}
        {billPlanTemplatesError && (
          <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            Error loading current plan templates: {billPlanTemplatesError}
          </div>
        )}
        {billPlanTemplates.length === 0 ? (
          <div className="rounded-md border border-gray-200 bg-gray-50 px-4 py-6 text-sm text-gray-600">
            No current plan templates found yet.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="min-w-full text-xs">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Updated</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Provider</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Plan</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Rate type</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Term</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Base (¢/mo)</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">ETF (¢)</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">TOU</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Credits</th>
                </tr>
              </thead>
              <tbody>
                {billPlanTemplates.map((t) => (
                  <tr key={t.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-2 text-gray-700 whitespace-nowrap">
                      {t.updatedAt ? new Date(t.updatedAt).toLocaleString() : "—"}
                    </td>
                    <td className="px-3 py-2 text-gray-800">{t.providerName ?? "—"}</td>
                    <td className="px-3 py-2 text-gray-800">{t.planName ?? "—"}</td>
                    <td className="px-3 py-2 text-gray-700">{t.rateType ?? "—"}</td>
                    <td className="px-3 py-2 text-gray-700">{typeof t.termMonths === "number" ? `${t.termMonths} mo` : "—"}</td>
                    <td className="px-3 py-2 text-gray-700">{typeof t.baseChargeCentsPerMonth === "number" ? t.baseChargeCentsPerMonth : "—"}</td>
                    <td className="px-3 py-2 text-gray-700">{typeof t.earlyTerminationFeeCents === "number" ? t.earlyTerminationFeeCents : "—"}</td>
                    <td className="px-3 py-2 text-gray-700">{t.hasTimeOfUse ? "yes" : "no"}</td>
                    <td className="px-3 py-2 text-gray-700">{t.hasBillCredits ? "yes" : "no"}</td>
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


