'use client';

import { useEffect, useMemo, useState } from 'react';

type QueueItem = any;

const FACTCARDS_PREFILL_KEY = 'iw_factcards_prefill_v1';

function useLocalToken(key = 'iw_admin_token') {
  const [token, setToken] = useState('');
  useEffect(() => {
    try {
      setToken(localStorage.getItem(key) || '');
    } catch {
      setToken('');
    }
  }, [key]);
  useEffect(() => {
    if (!token) return;
    try {
      localStorage.setItem(key, token);
    } catch {
      // ignore
    }
  }, [key, token]);
  return { token, setToken };
}

function pretty(x: unknown) {
  try {
    return JSON.stringify(x, null, 2);
  } catch {
    return String(x);
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

function openInFactCards(args: { eflUrl?: string | null; offerId?: string | null; rawText?: string | null }) {
  const eflUrl = String(args.eflUrl ?? '').trim();
  const offerId = String(args.offerId ?? '').trim();
  const rawText = String(args.rawText ?? '');

  // Preferred path: URL deep-link (small + shareable).
  if (eflUrl) {
    const sp = new URLSearchParams({ eflUrl });
    if (offerId) sp.set('offerId', offerId);
    window.location.href = `/admin/efl/fact-cards?${sp.toString()}`;
    return;
  }

  // Fallback: store rawText locally and open fact-cards. This lets current-plan queue items (often missing eflUrl)
  // be resolved using the exact same engine, without copying any solver logic.
  if (rawText.trim()) {
    try {
      const payload = {
        t: Date.now(),
        rawText,
        offerId: offerId || null,
      };
      window.localStorage.setItem(FACTCARDS_PREFILL_KEY, JSON.stringify(payload));
    } catch {
      // ignore storage failures
    }
    window.location.href = `/admin/efl/fact-cards?prefill=local`;
  }
}

function parseQueueReason(s: unknown): any | null {
  const raw = String(s ?? '').trim();
  if (!raw) return null;
  if (!raw.startsWith('{')) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export default function EflReviewPage() {
  const { token, setToken } = useLocalToken();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [status, setStatus] = useState<'OPEN' | 'RESOLVED'>('OPEN');
  const [kind, setKind] = useState<'ALL' | 'EFL_PARSE' | 'PLAN_CALC_QUARANTINE'>('ALL');
  const [q, setQ] = useState('');
  const [source, setSource] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [linkRunnerUrl, setLinkRunnerUrl] = useState<string>('');
  const [copiedUrlAt, setCopiedUrlAt] = useState<number | null>(null);

  const ready = useMemo(() => Boolean(token), [token]);

  async function load() {
    if (!token) {
      setError('Admin token required.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        status,
        limit: '100',
      });
      if (kind !== 'ALL') {
        params.set('kind', kind);
      }
      if (q.trim()) {
        params.set('q', q.trim());
      }
      if (source.trim()) {
        params.set('source', source.trim());
      }
      const res = await fetch(`/api/admin/efl-review/list?${params.toString()}`, {
        headers: { 'x-admin-token': token },
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data?.error || res.statusText || 'Failed to load queue.');
      }
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load queue.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (ready) {
      void load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, status, kind]);

  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      const src = (sp.get('source') || '').trim();
      if (src) setSource(src);
      const k = (sp.get('kind') || '').trim().toUpperCase();
      if (k === 'EFL_PARSE' || k === 'PLAN_CALC_QUARANTINE') setKind(k as any);
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function resolveItem(id: string) {
    if (!token) return;
    setResolvingId(id);
    try {
      const res = await fetch('/api/admin/efl-review/resolve', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': token,
        },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data?.error || res.statusText || 'Failed to resolve item.');
      }
      // Refresh list after resolution.
      await load();
    } catch (err: any) {
      setError(err?.message || 'Failed to resolve item.');
    } finally {
      setResolvingId(null);
    }
  }

  return (
    <main className="min-h-screen w-full bg-gray-50">
      <div className="mx-auto max-w-6xl px-4 py-8 space-y-6">
        <div className="rounded-2xl border bg-white p-4 text-sm">
          <div className="font-medium">Fact Card ops are now unified</div>
          <div className="text-xs text-gray-600 mt-1">
            For batch parsing + queue + templates + manual loader (URL/upload/text) in one place, use{" "}
            <a className="text-blue-700 underline" href="/admin/efl/fact-cards">
              /admin/efl/fact-cards
            </a>
            .
          </div>
        </div>

        <header className="flex items-baseline justify-between gap-3">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">Review Queue</h1>
            <p className="text-sm text-gray-600 mt-1">
              Unified queue for template issues: EFL parsing/validation failures and plan-calc quarantines
              (NOT_COMPUTABLE / bucket mismatches / non-deterministic pricing).
            </p>
          </div>
        </header>

        <section className="grid md:grid-cols-3 gap-4">
          <div className="rounded-2xl border bg-white p-4 space-y-3">
            <h2 className="font-medium">Auth</h2>
            <label className="block text-sm mb-1">x-admin-token</label>
            <input
              type="password"
              className="w-full rounded-lg border px-3 py-2"
              placeholder="paste admin token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
            {!ready && (
              <p className="text-xs text-red-600">Token required to load the queue.</p>
            )}
          </div>

          <div className="rounded-2xl border bg-white p-4 space-y-3 md:col-span-2">
            <h2 className="font-medium">Filters</h2>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 text-sm">
                <label className="inline-flex items-center gap-1">
                  <input
                    type="radio"
                    checked={status === 'OPEN'}
                    onChange={() => setStatus('OPEN')}
                  />
                  <span>Open</span>
                </label>
                <label className="inline-flex items-center gap-1">
                  <input
                    type="radio"
                    checked={status === 'RESOLVED'}
                    onChange={() => setStatus('RESOLVED')}
                  />
                  <span>Resolved</span>
                </label>
              </div>
              <div className="min-w-[220px]">
                <select
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                  value={kind}
                  onChange={(e) => setKind(e.target.value as any)}
                >
                  <option value="ALL">All kinds</option>
                  <option value="EFL_PARSE">EFL Parse</option>
                  <option value="PLAN_CALC_QUARANTINE">Plan Calc Quarantine</option>
                </select>
              </div>
              <div className="min-w-[220px]">
                <select
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                  value={source}
                  onChange={(e) => {
                    const v = e.target.value;
                    setSource(v);
                  }}
                >
                  <option value="">All sources</option>
                  <option value="wattbuy_batch">Offers (wattbuy_batch)</option>
                  <option value="manual_upload">Offers (manual_upload)</option>
                  <option value="current_plan_efl">Current plan EFL</option>
                  <option value="dashboard_plans">Dashboard plans (auto)</option>
                  <option value="admin_plans_quarantine_scan">Admin quarantine scan</option>
                </select>
              </div>
              <div className="flex-1 min-w-[160px]">
                <input
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                  placeholder="Search supplier / plan / offerId / sha"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </div>
              <button
                type="button"
                onClick={load}
                disabled={loading || !ready}
                className="rounded-lg border bg-blue-600 text-white px-3 py-1.5 text-sm font-medium disabled:opacity-60"
              >
                {loading ? 'Loading…' : 'Refresh'}
              </button>
            </div>
            {error && (
              <p className="mt-2 text-xs text-red-600">
                {error}
              </p>
            )}
          </div>
        </section>

        <div className="rounded-2xl border bg-white p-3 text-xs text-gray-600">
          Tip: to jump straight to plan-calc quarantines, open{' '}
          <a className="text-blue-700 underline" href="/admin/efl-review?kind=PLAN_CALC_QUARANTINE">
            /admin/efl-review?kind=PLAN_CALC_QUARANTINE
          </a>
          .
        </div>

        <section className="rounded-2xl border bg-white p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-medium">EFL Link Runner</h2>
              <p className="text-xs text-gray-600 mt-1">
                Paste an EFL URL here (or click “Use” on a row) to open the link runner and
                quickly save the PDF locally.
              </p>
            </div>
            <a
              href="/admin/efl/links"
              className="text-xs font-medium text-blue-700 underline"
            >
              Open full Link Runner
            </a>
          </div>

          <div className="flex flex-col md:flex-row gap-2">
            <input
              className="flex-1 rounded-lg border px-3 py-2 text-sm"
              placeholder="https://.../some-efl.pdf"
              value={linkRunnerUrl}
              onChange={(e) => setLinkRunnerUrl(e.target.value)}
            />
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={
                  linkRunnerUrl.trim()
                    ? `/admin/efl/links?eflUrl=${encodeURIComponent(linkRunnerUrl.trim())}&sourceTag=efl_review_queue`
                    : '/admin/efl/links'
                }
                className="rounded-lg border bg-blue-600 text-white px-3 py-2 text-sm font-medium disabled:opacity-60"
                aria-disabled={!linkRunnerUrl.trim()}
                onClick={(e) => {
                  if (!linkRunnerUrl.trim()) e.preventDefault();
                }}
              >
                Run fingerprint
              </a>
              <button
                type="button"
                className="rounded-lg border bg-white px-3 py-2 text-sm font-medium disabled:opacity-60"
                disabled={!linkRunnerUrl.trim()}
                onClick={() => {
                  const u = linkRunnerUrl.trim();
                  if (!u) return;
                  window.open(u, '_blank', 'noopener,noreferrer');
                }}
              >
                Open PDF
              </button>
              <button
                type="button"
                className="rounded-lg border bg-white px-3 py-2 text-sm font-medium disabled:opacity-60"
                disabled={!linkRunnerUrl.trim()}
                onClick={async () => {
                  const u = linkRunnerUrl.trim();
                  if (!u) return;
                  const ok = await copyToClipboard(u);
                  if (ok) {
                    setCopiedUrlAt(Date.now());
                    setTimeout(() => setCopiedUrlAt(null), 1200);
                  }
                }}
              >
                {copiedUrlAt ? 'Copied' : 'Copy URL'}
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border bg-white p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-medium">
              {status === 'OPEN' ? 'Open items' : 'Resolved items'} ({items.length})
            </h2>
          </div>

          {items.length === 0 ? (
            <p className="text-sm text-gray-500">
              No {status === 'OPEN' ? 'open' : 'resolved'} items.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border bg-gray-50">
              <table className="min-w-full text-xs">
                <thead className="bg-gray-100 text-gray-700">
                  <tr>
                    <th className="px-2 py-1 text-left">Kind</th>
                    <th className="px-2 py-1 text-left">Supplier</th>
                    <th className="px-2 py-1 text-left">Plan</th>
                    <th className="px-2 py-1 text-left">OfferId</th>
                    <th className="px-2 py-1 text-left">EFL URL</th>
                    <th className="px-2 py-1 text-left">EFL Ver</th>
                    <th className="px-2 py-1 text-left">Status</th>
                    <th className="px-2 py-1 text-left">Queue reason</th>
                    <th className="px-2 py-1 text-left">Solver</th>
                    <th className="px-2 py-1 text-left">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item: any) => {
                    const id = item.id as string;
                    const solverApplied = Array.isArray(item.solverApplied)
                      ? (item.solverApplied as string[])
                      : [];
                    const queueReason: string | undefined = item.queueReason ?? undefined;
                    const parsedQueueReason = parseQueueReason(queueReason);
                    const kindLabel = String(item?.kind ?? '—');
                    const isResolved = Boolean(item.resolvedAt);
                    const eflUrl: string = typeof item.eflUrl === 'string' ? item.eflUrl : '';
                    const canOpenFactCards = Boolean(eflUrl || String(item?.rawText ?? '').trim());

                    const shortQueueReason = (() => {
                      if (!parsedQueueReason) return queueReason ?? '—';
                      // PLAN_CALC_QUARANTINE
                      if (String(parsedQueueReason?.type ?? '') === 'PLAN_CALC_QUARANTINE') {
                        return (
                          parsedQueueReason?.estimateReason ||
                          parsedQueueReason?.planCalcReasonCode ||
                          parsedQueueReason?.planCalcStatus ||
                          'PLAN_CALC_QUARANTINE'
                        );
                      }
                      return queueReason ?? '—';
                    })();
                    return (
                      <tr key={id} className="border-t align-top">
                        <td className="px-2 py-1">
                          <span
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 font-mono ${
                              kindLabel === 'PLAN_CALC_QUARANTINE'
                                ? 'border-amber-300 bg-amber-50 text-amber-900'
                                : 'border-slate-200 bg-white text-slate-700'
                            }`}
                            title={kindLabel}
                          >
                            {kindLabel}
                          </span>
                        </td>
                        <td className="px-2 py-1">{item.supplier ?? '—'}</td>
                        <td className="px-2 py-1">
                          <div className="max-w-[180px] truncate" title={item.planName ?? undefined}>
                            {item.planName ?? '—'}
                          </div>
                        </td>
                        <td className="px-2 py-1">
                          <div className="max-w-[120px] truncate" title={item.offerId ?? undefined}>
                            {item.offerId ?? '—'}
                          </div>
                        </td>
                        <td className="px-2 py-1">
                          {eflUrl ? (
                            <div className="flex items-center gap-1">
                              <input
                                className="w-[260px] max-w-[260px] rounded border bg-white px-2 py-1 font-mono text-[10px]"
                                readOnly
                                value={eflUrl}
                                onFocus={(e) => e.currentTarget.select()}
                                title={eflUrl}
                              />
                              <button
                                type="button"
                                className="rounded border bg-white px-2 py-1 text-[10px] font-medium hover:bg-gray-50"
                                onClick={async () => {
                                  const ok = await copyToClipboard(eflUrl);
                                  if (ok) {
                                    setCopiedUrlAt(Date.now());
                                    setTimeout(() => setCopiedUrlAt(null), 1200);
                                  }
                                }}
                              >
                                Copy
                              </button>
                              <button
                                type="button"
                                className="rounded border bg-white px-2 py-1 text-[10px] font-medium hover:bg-gray-50"
                                onClick={() => setLinkRunnerUrl(eflUrl)}
                                title="Load into link runner above"
                              >
                                Use
                              </button>
                              <a
                                href={eflUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="rounded border bg-white px-2 py-1 text-[10px] font-medium hover:bg-gray-50"
                                title="Open EFL PDF"
                              >
                                Open
                              </a>
                            </div>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-2 py-1">
                          <div className="max-w-[140px] truncate" title={item.eflVersionCode ?? undefined}>
                            {item.eflVersionCode ?? '—'}
                          </div>
                        </td>
                        <td className="px-2 py-1">
                          <span className="inline-flex items-center rounded-full border px-2 py-0.5 font-mono">
                            {item.finalStatus ?? '—'}
                          </span>
                        </td>
                        <td className="px-2 py-1">
                          <div className="max-w-[220px] truncate" title={queueReason}>
                            {shortQueueReason}
                          </div>
                        </td>
                        <td className="px-2 py-1">
                          {solverApplied.length > 0 ? (
                            <span className="font-mono text-[10px]">
                              {solverApplied.join(', ')}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-2 py-1">
                          <div className="flex flex-col gap-1">
                            <button
                              type="button"
                              disabled={!canOpenFactCards}
                              onClick={() =>
                                openInFactCards({
                                  eflUrl: eflUrl || null,
                                  offerId: item.offerId ?? null,
                                  rawText: !eflUrl ? (item?.rawText ?? null) : null,
                                })
                              }
                              className="rounded border bg-white px-2 py-0.5 text-[11px] font-medium hover:bg-gray-50 disabled:opacity-60"
                              title={
                                eflUrl
                                  ? 'Open in /admin/efl/fact-cards (URL runner)'
                                  : canOpenFactCards
                                    ? 'Open in /admin/efl/fact-cards (raw-text runner)'
                                    : 'No EFL URL or raw text available to open'
                              }
                            >
                              Open in Fact Cards
                            </button>
                            <details className="rounded border bg-white px-2 py-1">
                              <summary className="cursor-pointer text-[11px] font-medium">
                                View details
                              </summary>
                              <div className="mt-2 space-y-2 max-h-64 overflow-auto">
                                <div>
                                  <div className="text-[10px] font-semibold text-gray-600">
                                    PlanRules (effective)
                                  </div>
                                  <pre className="mt-1 whitespace-pre-wrap break-all rounded bg-gray-50 p-2 text-[10px]">
                                    {pretty(item.planRules)}
                                  </pre>
                                </div>
                                <div>
                                  <div className="text-[10px] font-semibold text-gray-600">
                                    RateStructure (effective)
                                  </div>
                                  <pre className="mt-1 whitespace-pre-wrap break-all rounded bg-gray-50 p-2 text-[10px]">
                                    {pretty(item.rateStructure)}
                                  </pre>
                                </div>
                                <div>
                                  <div className="text-[10px] font-semibold text-gray-600">
                                    validation
                                  </div>
                                  <pre className="mt-1 whitespace-pre-wrap break-all rounded bg-gray-50 p-2 text-[10px]">
                                    {pretty(item.validation)}
                                  </pre>
                                </div>
                                <div>
                                  <div className="text-[10px] font-semibold text-gray-600">
                                    derivedForValidation
                                  </div>
                                  <pre className="mt-1 whitespace-pre-wrap break-all rounded bg-gray-50 p-2 text-[10px]">
                                    {pretty(item.derivedForValidation)}
                                  </pre>
                                </div>
                                {item.rawText ? (
                                  <div>
                                    <div className="text-[10px] font-semibold text-gray-600">
                                      rawText (excerpt)
                                    </div>
                                    <pre className="mt-1 whitespace-pre-wrap break-all rounded bg-gray-50 p-2 text-[10px] max-h-40 overflow-auto">
                                      {String(item.rawText).slice(0, 4000)}
                                      {String(item.rawText).length > 4000 ? '…' : ''}
                                    </pre>
                                  </div>
                                ) : null}
                              </div>
                            </details>

                            {!isResolved && (
                              <button
                                type="button"
                                onClick={() => resolveItem(id)}
                                disabled={resolvingId === id || !ready}
                                className="rounded border border-emerald-500 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-60"
                              >
                                {resolvingId === id ? 'Resolving…' : 'Mark resolved'}
                              </button>
                            )}
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
      </div>
    </main>
  );
}


