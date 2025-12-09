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

export default function SmtSftpFlowTestPage() {
  const { token, setToken } = useLocalToken();
  const ready = useMemo(() => Boolean(token), [token]);
  const [loading, setLoading] = useState(false);

  const [pullResult, setPullResult] = useState<ApiResult | null>(null);
  const [pipelineResult, setPipelineResult] = useState<ApiResult | null>(null);
  const [rawFilesResult, setRawFilesResult] = useState<ApiResult | null>(null);
  const [usageDebugResult, setUsageDebugResult] = useState<ApiResult | null>(null);
  const [intervalsDebugResult, setIntervalsDebugResult] = useState<ApiResult | null>(null);

  const [pullRaw, setPullRaw] = useState<Json | null>(null);
  const [pipelineRaw, setPipelineRaw] = useState<Json | null>(null);
  const [rawFilesRaw, setRawFilesRaw] = useState<Json | null>(null);
  const [usageRaw, setUsageRaw] = useState<Json | null>(null);
  const [intervalsRaw, setIntervalsRaw] = useState<Json | null>(null);
  const [rawPayloadPreviews, setRawPayloadPreviews] = useState<
    Array<{ id: string; filename: string; createdAt: string; sizeBytes: number | null; textPreview: string | null }>
  >([]);

  async function runTest() {
    if (!token) {
      alert('Set x-admin-token first');
      return;
    }
    setLoading(true);
    setPullResult(null);
    setPipelineResult(null);
    setRawFilesResult(null);
    setUsageDebugResult(null);
    setIntervalsDebugResult(null);
    setPullRaw(null);
    setPipelineRaw(null);
    setRawFilesRaw(null);
    setUsageRaw(null);
    setIntervalsRaw(null);
    setRawPayloadPreviews([]);

    try {
      // 1) Trigger SMT pull via admin webhook (SFTP ingest path)
      const pullRes = await fetch('/api/admin/smt/pull', {
        method: 'POST',
        headers: {
          'x-admin-token': token,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({ esiid: TEST_ESIID }),
      });
      const pullJson = (await pullRes
        .json()
        .catch(() => ({ error: 'Failed to parse JSON', status: pullRes.status }))) as Json;
      setPullRaw(pullJson);
      setPullResult({
        ok: pullJson?.ok,
        status: pullRes.status,
        error: pullJson?.error,
        message: pullJson?.message,
        data: pullJson,
      });

      // 2) Pipeline debug: latest RawSmtFile rows + recent SmtInterval rows + stats
      const pipelineRes = await fetch(
        `/api/admin/ui/smt/pipeline-debug?intervalsLimit=200&rawLimit=20`,
        {
          method: 'GET',
          headers: {
            'x-admin-token': token,
            accept: 'application/json',
          },
        },
      );
      const pipelineJson = (await pipelineRes
        .json()
        .catch(() => ({ error: 'Failed to parse JSON', status: pipelineRes.status }))) as Json;
      setPipelineRaw(pipelineJson);
      setPipelineResult({
        ok: pipelineJson?.ok,
        status: pipelineRes.status,
        error: pipelineJson?.error,
        message: pipelineJson?.message,
        data: pipelineJson,
      });

      // 3) Raw files listing (same as SMT inspector "List Raw Files").
      // We do not filter by ESIID here so you can see every payload SMT has delivered recently.
      const rawFilesRes = await fetch('/api/admin/debug/smt/raw-files?limit=20', {
        method: 'GET',
        headers: {
          'x-admin-token': token,
          accept: 'application/json',
        },
      });
      const rawFilesJson = (await rawFilesRes
        .json()
        .catch(() => ({ error: 'Failed to parse JSON', status: rawFilesRes.status }))) as Json;
      setRawFilesRaw(rawFilesJson);
      setRawFilesResult({
        ok: rawFilesJson?.ok,
        status: rawFilesRes.status,
        error: rawFilesJson?.error,
        message: rawFilesJson?.message,
        data: rawFilesJson,
      });

      // 3b) For each raw file, fetch a text preview so we can see the actual payload content.
      if (rawFilesJson?.rows && Array.isArray(rawFilesJson.rows)) {
        const previews: Array<{
          id: string;
          filename: string;
          createdAt: string;
          sizeBytes: number | null;
          textPreview: string | null;
        }> = [];
        for (const row of rawFilesJson.rows as any[]) {
          const id = row.id;
          if (!id) continue;
          try {
            const detailRes = await fetch(`/api/admin/debug/smt/raw-files/${encodeURIComponent(id)}`, {
              method: 'GET',
              headers: {
                'x-admin-token': token,
                accept: 'application/json',
              },
            });
            const detailJson = (await detailRes
              .json()
              .catch(() => ({ error: 'Failed to parse JSON', status: detailRes.status }))) as any;
            if (detailJson?.ok) {
              previews.push({
                id: String(detailJson.id ?? id),
                filename: detailJson.filename ?? row.filename ?? '',
                createdAt: detailJson.createdAt ?? row.createdAt ?? '',
                sizeBytes: detailJson.sizeBytes ?? row.sizeBytes ?? null,
                textPreview: typeof detailJson.textPreview === 'string' ? detailJson.textPreview : null,
              });
            }
          } catch {
            // ignore individual preview errors; we'll still show listing JSON
          }
        }
        setRawPayloadPreviews(previews);
      }

      // 4) Usage debug for this ESIID over 365 days
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

      // 5) Sample of raw SmtInterval rows for this ESIID
      const intervalsRes = await fetch(
        `/api/admin/debug/smt/intervals?esiid=${encodeURIComponent(TEST_ESIID)}&limit=50`,
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
      setPullResult((prev) => prev ?? { ok: false, status: 500, error: msg });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <h1 className="text-2xl font-semibold">SMT SFTP Flow Test (Droplet + Raw Files)</h1>
      <p className="text-sm text-gray-700">
        This admin-only harness exercises the SFTP pipeline for a hard-coded ESIID (<code>{TEST_ESIID}</code>) by:
        <br />
        1) Triggering <code>/api/admin/smt/pull</code> (droplet webhook → SFTP) for that ESIID;
        <br />
        2) Showing pipeline debug (raw files + recent intervals);
        <br />
        3) Showing the raw SMT files table;
        <br />
        4) Showing usage/interval debug for 365 days; and
        <br />
        5) Rendering the same usage dashboard the customer sees.
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
            ESIID is hard-coded to <code>{TEST_ESIID}</code>. SFTP ingest is triggered via <code>/api/admin/smt/pull</code>.
          </p>
          <button
            onClick={runTest}
            className="px-4 py-2 rounded-lg border bg-green-50 font-semibold hover:bg-green-100"
            disabled={loading || !ready}
          >
            {loading ? 'Running SFTP flow…' : 'Run SFTP Flow Test'}
          </button>
        </div>
      </section>

      <section className="grid md:grid-cols-3 gap-4">
        <div className="p-4 rounded-2xl border">
          <h3 className="font-medium mb-2">1. SMT Pull (/api/admin/smt/pull)</h3>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
            <dt className="text-gray-500">ok</dt>
            <dd>{String(pullResult?.ok ?? '')}</dd>
            <dt className="text-gray-500">status</dt>
            <dd>{pullResult?.status ?? ''}</dd>
            <dt className="text-gray-500">error</dt>
            <dd>{pullResult?.error ?? ''}</dd>
            <dt className="text-gray-500">message</dt>
            <dd>{pullResult?.message ?? ''}</dd>
          </dl>
        </div>
        <div className="p-4 rounded-2xl border">
          <h3 className="font-medium mb-2">2. Pipeline Debug (/api/admin/ui/smt/pipeline-debug)</h3>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
            <dt className="text-gray-500">ok</dt>
            <dd>{String(pipelineResult?.ok ?? '')}</dd>
            <dt className="text-gray-500">status</dt>
            <dd>{pipelineResult?.status ?? ''}</dd>
            <dt className="text-gray-500">error</dt>
            <dd>{pipelineResult?.error ?? ''}</dd>
          </dl>
        </div>
        <div className="p-4 rounded-2xl border">
          <h3 className="font-medium mb-2">3. Raw Files (/api/admin/debug/smt/raw-files)</h3>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
            <dt className="text-gray-500">ok</dt>
            <dd>{String(rawFilesResult?.ok ?? '')}</dd>
            <dt className="text-gray-500">status</dt>
            <dd>{rawFilesResult?.status ?? ''}</dd>
            <dt className="text-gray-500">error</dt>
            <dd>{rawFilesResult?.error ?? ''}</dd>
          </dl>
        </div>
      </section>

      <section className="grid md:grid-cols-2 gap-4">
        <div className="p-4 rounded-2xl border">
          <h3 className="font-medium mb-2">4. Usage debug (/api/admin/usage/debug)</h3>
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
          <h3 className="font-medium mb-2">5. Sample intervals (/api/admin/debug/smt/intervals)</h3>
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

      <section className="grid md:grid-cols-3 gap-4">
        <div className="p-4 rounded-2xl border md:col-span-1">
          <h3 className="font-medium mb-2">SMT Pull raw</h3>
          <pre className="text-xs bg-gray-50 rounded-lg p-3 overflow-auto max-h-[32rem]">
{pretty(pullRaw)}
          </pre>
        </div>
        <div className="p-4 rounded-2xl border md:col-span-1">
          <h3 className="font-medium mb-2">Pipeline debug raw</h3>
          <pre className="text-xs bg-gray-50 rounded-lg p-3 overflow-auto max-h-[32rem]">
{pretty(pipelineRaw)}
          </pre>
        </div>
        <div className="p-4 rounded-2xl border md:col-span-1">
          <h3 className="font-medium mb-2">Raw files listing</h3>
          <pre className="text-xs bg-gray-50 rounded-lg p-3 overflow-auto max-h-[32rem]">
{pretty(rawFilesRaw)}
          </pre>
        </div>
      </section>

      {rawPayloadPreviews.length > 0 && (
        <section className="p-4 rounded-2xl border">
          <h3 className="font-medium mb-2">Raw SMT Payloads for this ESIID (text previews)</h3>
          <p className="text-sm text-gray-700 mb-3">
            Each block below is a distinct <code>RawSmtFile</code> row (one payload SMT delivered). This is the actual CSV
            content we ingested from SFTP/upload, truncated for display.
          </p>
          <div className="space-y-4">
            {rawPayloadPreviews.map((p) => (
              <div key={p.id} className="border rounded-lg p-3 bg-white">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <div className="text-sm">
                    <div className="font-semibold">{p.filename}</div>
                    <div className="text-xs text-gray-600">
                      id=<span className="font-mono">{p.id}</span> · createdAt={p.createdAt} · size=
                      {p.sizeBytes != null ? p.sizeBytes.toLocaleString() : '—'} bytes
                    </div>
                  </div>
                </div>
                <pre className="text-xs bg-gray-50 rounded-md p-2 overflow-auto max-h-64">
{p.textPreview ?? '(binary or no text preview available)'}
                </pre>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="grid md:grid-cols-2 gap-4">
        <div className="p-4 rounded-2xl border">
          <h3 className="font-medium mb-2">Usage debug raw</h3>
          <pre className="text-xs bg-gray-50 rounded-lg p-3 overflow-auto max-h-[32rem]">
{pretty(usageRaw)}
          </pre>
        </div>
        <div className="p-4 rounded-2xl border">
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


