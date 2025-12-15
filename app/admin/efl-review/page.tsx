'use client';

import { useEffect, useMemo, useState } from 'react';

type QueueItem = any;

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

export default function EflReviewPage() {
  const { token, setToken } = useLocalToken();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [status, setStatus] = useState<'OPEN' | 'RESOLVED'>('OPEN');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

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
      if (q.trim()) {
        params.set('q', q.trim());
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
  }, [ready, status]);

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
        <header className="flex items-baseline justify-between gap-3">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">EFL Parse Review Queue</h1>
            <p className="text-sm text-gray-600 mt-1">
              EFLs whose avg-price validation FAILED after solver passes. Use this to review
              and resolve problematic templates before they are surfaced to customers.
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
              <div className="flex-1 min-w-[160px]">
                <input
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                  placeholder="Search supplier / plan / offer / sha"
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

        <section className="rounded-2xl border bg-white p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-medium">
              {status === 'OPEN' ? 'Open items' : 'Resolved items'} ({items.length})
            </h2>
          </div>

          {items.length === 0 ? (
            <p className="text-sm text-gray-500">
              No {status === 'OPEN' ? 'open' : 'resolved'} EFL parse review items.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border bg-gray-50">
              <table className="min-w-full text-xs">
                <thead className="bg-gray-100 text-gray-700">
                  <tr>
                    <th className="px-2 py-1 text-left">Supplier</th>
                    <th className="px-2 py-1 text-left">Plan</th>
                    <th className="px-2 py-1 text-left">OfferId</th>
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
                    const isResolved = Boolean(item.resolvedAt);
                    return (
                      <tr key={id} className="border-t align-top">
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
                            {queueReason ?? '—'}
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


