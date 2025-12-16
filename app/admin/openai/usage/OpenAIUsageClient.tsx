'use client';

import { useEffect, useState } from 'react';

type SummaryByDay = {
  date: string;
  calls: number;
  totalTokens: number;
  costUsd: number;
};

type SummaryByModule = {
  module: string;
  calls: number;
  totalTokens: number;
  costUsd: number;
  callsLastWindow: number;
  costUsdLastWindow: number;
};

type RecentEvent = {
  id: string;
  createdAt: string;
  module: string;
  operation: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
};

type OpenAIUsageResponse = {
  ok: boolean;
  windowDays: number;
  totalWindowCalls: number;
  totalWindowCostUsd: number;
  summaryByDay: SummaryByDay[];
  summaryByModule: SummaryByModule[];
  recentEvents: RecentEvent[];
};

export default function OpenAIUsageClient() {
  const [data, setData] = useState<OpenAIUsageResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [smokeLoading, setSmokeLoading] = useState(false);
  const [smokeNote, setSmokeNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);
        setSmokeNote(null);

        const adminToken =
          typeof window !== 'undefined'
            ? window.localStorage.getItem('intelliwattAdminToken') ??
              window.localStorage.getItem('intelliwatt_admin_token') ??
              window.localStorage.getItem('iw_admin_token')
            : null;

        if (!adminToken) {
          setError('Admin token not found in local storage.');
          setLoading(false);
          return;
        }

        const res = await fetch('/api/admin/openai/usage', {
          headers: {
            'x-admin-token': adminToken,
          },
        });

        const body = (await res.json().catch(() => null)) as
          | OpenAIUsageResponse
          | { error?: string }
          | null;

        if (!res.ok || !body) {
          const msg =
            (body && 'error' in body && body.error) ||
            `Request failed with status ${res.status}`;
          setError(msg || 'Failed to load OpenAI usage');
          setLoading(false);
          return;
        }

        if (!('ok' in body) || !body.ok) {
          setError('Failed to load OpenAI usage.');
          setLoading(false);
          return;
        }

        if (!cancelled) {
          setData(body as OpenAIUsageResponse);
          setLoading(false);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[OpenAIUsageClient] Failed to load OpenAI usage', err);
        if (!cancelled) {
          setError('Failed to load OpenAI usage');
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  async function runSmoke() {
    const adminToken =
      typeof window !== 'undefined'
        ? window.localStorage.getItem('intelliwattAdminToken') ??
          window.localStorage.getItem('intelliwatt_admin_token') ??
          window.localStorage.getItem('iw_admin_token')
        : null;

    if (!adminToken) {
      setSmokeNote('Admin token not found in local storage.');
      return;
    }

    setSmokeLoading(true);
    setSmokeNote(null);
    try {
      const res = await fetch('/api/admin/openai/usage/smoke', {
        method: 'POST',
        headers: { 'x-admin-token': adminToken },
      });
      const body = (await res.json().catch(() => null)) as any;
      if (!res.ok || !body?.ok) {
        setSmokeNote(body?.error || `Smoke request failed (HTTP ${res.status})`);
        return;
      }
      setSmokeNote('Smoke event logged. Reloading…');
      // Reload usage after writing the row.
      const reload = await fetch('/api/admin/openai/usage', {
        headers: { 'x-admin-token': adminToken },
      });
      const reloadBody = (await reload.json().catch(() => null)) as any;
      if (reload.ok && reloadBody?.ok) {
        setData(reloadBody as OpenAIUsageResponse);
        setSmokeNote('Smoke event logged and usage refreshed.');
      } else {
        setSmokeNote('Smoke event logged, but reload failed — refresh the page.');
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[OpenAIUsageClient] Smoke failed', err);
      setSmokeNote('Smoke event failed (see console).');
    } finally {
      setSmokeLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="text-sm text-brand-navy/70">Loading OpenAI usage…</div>
    );
  }

  if (error) {
    return (
      <div className="text-sm text-red-600">
        Error loading OpenAI usage: {error}
      </div>
    );
  }

  if (!data || !data.ok) {
    return (
      <div className="text-sm text-red-600">
        Failed to load OpenAI usage.
      </div>
    );
  }

  const totalCost = data.totalWindowCostUsd ?? 0;
  const topModule = data.summaryByModule[0];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-brand-navy/70">
          If this page isn’t updating, use the smoke test to verify DB writes from this runtime.
        </div>
        <button
          type="button"
          onClick={() => void runSmoke()}
          disabled={smokeLoading}
          className="rounded-md border border-brand-navy/20 bg-white px-3 py-1.5 text-xs font-medium text-brand-navy hover:bg-brand-navy/5 disabled:opacity-60"
        >
          {smokeLoading ? 'Logging…' : 'Log smoke event'}
        </button>
      </div>
      {smokeNote ? (
        <div className="text-xs text-brand-navy/70">{smokeNote}</div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-md border border-brand-navy/10 bg-brand-navy/5 p-4">
          <div className="text-xs font-medium text-brand-navy/70">Window</div>
          <div className="mt-1 text-lg font-semibold text-brand-navy">
            Last {data.windowDays} day{data.windowDays === 1 ? '' : 's'}
          </div>
        </div>
        <div className="rounded-md border border-brand-navy/10 bg-brand-navy/5 p-4">
          <div className="text-xs font-medium text-brand-navy/70">
            Total calls
          </div>
          <div className="mt-1 text-lg font-semibold text-brand-navy">
            {data.totalWindowCalls}
          </div>
        </div>
        <div className="rounded-md border border-brand-navy/10 bg-brand-navy/5 p-4">
          <div className="text-xs font-medium text-brand-navy/70">
            Estimated cost
          </div>
          <div className="mt-1 text-lg font-semibold text-brand-navy">
            ${totalCost.toFixed(4)}
          </div>
        </div>
      </div>

      {topModule && (
        <div className="rounded-md border border-brand-navy/10 bg-brand-navy/5 p-4">
          <div className="text-xs font-medium text-brand-navy/70">
            Top module (window)
          </div>
          <div className="mt-1 text-lg font-semibold text-brand-navy">
            {topModule.module}
          </div>
          <div className="text-sm text-brand-navy/70">
            {topModule.callsLastWindow} calls · $
            {topModule.costUsdLastWindow.toFixed(4)}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-brand-navy">
          Recent events
        </h2>
        {data.recentEvents.length === 0 ? (
          <div className="rounded-md border border-brand-navy/10 bg-brand-navy/5 px-4 py-3 text-sm text-brand-navy/70">
            No OpenAI usage has been logged yet.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border border-brand-navy/10">
            <table className="min-w-full text-xs">
              <thead className="bg-brand-navy/5">
                <tr>
                  <th className="px-2 py-1 text-left font-medium text-brand-navy/70">
                    Time
                  </th>
                  <th className="px-2 py-1 text-left font-medium text-brand-navy/70">
                    Module
                  </th>
                  <th className="px-2 py-1 text-left font-medium text-brand-navy/70">
                    Operation
                  </th>
                  <th className="px-2 py-1 text-left font-medium text-brand-navy/70">
                    Model
                  </th>
                  <th className="px-2 py-1 text-right font-medium text-brand-navy/70">
                    Tokens
                  </th>
                  <th className="px-2 py-1 text-right font-medium text-brand-navy/70">
                    Cost (USD)
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.recentEvents.map((ev) => (
                  <tr
                    key={ev.id}
                    className="border-t border-brand-navy/10 bg-white"
                  >
                    <td className="px-2 py-1 align-top text-brand-navy">
                      {new Date(ev.createdAt).toLocaleString()}
                    </td>
                    <td className="px-2 py-1 align-top text-brand-navy">
                      {ev.module}
                    </td>
                    <td className="px-2 py-1 align-top text-brand-navy">
                      {ev.operation}
                    </td>
                    <td className="px-2 py-1 align-top text-brand-navy">
                      {ev.model}
                    </td>
                    <td className="px-2 py-1 align-top text-right text-brand-navy">
                      {ev.totalTokens}
                    </td>
                    <td className="px-2 py-1 align-top text-right text-brand-navy">
                      ${ev.costUsd.toFixed(4)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}


