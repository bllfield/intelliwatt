'use client';

import { useEffect, useMemo, useState } from 'react';

type Json = any;
type InspectResult = {
  ok?: boolean;
  status?: number;
  error?: string;
  data?: any;
  message?: string;
};

function useLocalToken(key = 'iw_admin_token') {
  const [token, setToken] = useState('');
  useEffect(() => { setToken(localStorage.getItem(key) || ''); }, []);
  useEffect(() => { if (token) localStorage.setItem(key, token); }, [token]);
  return { token, setToken };
}

function pretty(x: Json) {
  try { return JSON.stringify(x, null, 2); } catch { return String(x); }
}

export default function SMTInspector() {
  const { token, setToken } = useLocalToken();
  const [result, setResult] = useState<InspectResult | null>(null);
  const [raw, setRaw] = useState<Json | null>(null);
  const [loading, setLoading] = useState(false);
  const [testFile, setTestFile] = useState<File | null>(null);
  const [testText, setTestText] = useState('');

  const ready = useMemo(() => Boolean(token), [token]);

  async function hit(path: string, options?: RequestInit) {
    if (!token) { alert('Set x-admin-token first'); return; }
    setLoading(true);
    setResult(null);
    setRaw(null);
    try {
      const r = await fetch(path, {
        headers: { 'x-admin-token': token, 'accept': 'application/json', ...options?.headers },
        ...options,
      });
      const data = await r.json().catch(() => ({ error: 'Failed to parse JSON', status: r.status }));
      setRaw(data);
      const normalized: InspectResult = {
        ok: data?.ok,
        status: r.status,
        error: data?.error,
        data: data,
        message: data?.message,
      };
      setResult(normalized);
    } catch (e: any) {
      setResult({ ok: false, status: 500, error: e?.message || 'fetch failed' });
    } finally {
      setLoading(false);
    }
  }

  async function testIngest() {
    if (!token) { alert('Set x-admin-token first'); return; }
    setLoading(true);
    setResult(null);
    setRaw(null);
    try {
      let body: FormData | string;
      let headers: Record<string, string> = { 'x-admin-token': token };

      if (testFile) {
        // Use multipart/form-data
        const formData = new FormData();
        formData.append('file', testFile);
        if (testText) formData.append('type', testText);
        body = formData;
        // Don't set Content-Type for FormData, browser will set it with boundary
      } else if (testText) {
        // Use JSON
        body = JSON.stringify({ text: testText, type: 'auto' });
        headers['content-type'] = 'application/json';
      } else {
        alert('Please provide either a file or text content');
        setLoading(false);
        return;
      }

      const r = await fetch('/api/smt/ingest', {
        method: 'POST',
        headers,
        body: body as any,
      });
      const data = await r.json().catch(() => ({ error: 'Failed to parse JSON', status: r.status }));
      setRaw(data);
      setResult({
        ok: data?.ok !== false,
        status: r.status,
        error: data?.error,
        data: data,
      });
    } catch (e: any) {
      setResult({ ok: false, status: 500, error: e?.message || 'fetch failed' });
    } finally {
      setLoading(false);
    }
  }

  async function testRawUpload() {
    if (!token) { alert('Set x-admin-token first'); return; }
    if (!testFile) { alert('Please select a file first'); return; }
    setLoading(true);
    setResult(null);
    setRaw(null);
    try {
      // For raw-upload, we need filename, sizeBytes, sha256
      // This is a simplified test - in production you'd compute SHA256
      const sizeBytes = testFile.size;
      const filename = testFile.name;
      // For testing, we'll use a placeholder SHA256
      const sha256 = 'test-' + Date.now().toString();

      const body = JSON.stringify({
        filename,
        sizeBytes,
        sha256,
        source: 'admin-inspector',
      });

      const r = await fetch('/api/admin/smt/raw-upload', {
        method: 'POST',
        headers: { 'x-admin-token': token, 'content-type': 'application/json' },
        body,
      });
      const data = await r.json().catch(() => ({ error: 'Failed to parse JSON', status: r.status }));
      setRaw(data);
      setResult({
        ok: data?.ok,
        status: r.status,
        error: data?.error,
        data: data,
      });
    } catch (e: any) {
      setResult({ ok: false, status: 500, error: e?.message || 'fetch failed' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <h1 className="text-2xl font-semibold">SMT Inspector</h1>

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

        <div className="p-4 rounded-2xl border">
          <h2 className="font-medium mb-3">Quick Tests</h2>
          <div className="space-y-2">
            <button
              onClick={() => hit('/api/admin/smt/ping')}
              className="w-full px-3 py-2 rounded-lg border hover:bg-gray-50"
              disabled={loading || !ready}
            >
              {loading ? 'Loading…' : 'Ping SMT'}
            </button>
            <button
              onClick={() => hit('/api/admin/smt/health')}
              className="w-full px-3 py-2 rounded-lg border hover:bg-gray-50"
              disabled={loading}
            >
              {loading ? 'Loading…' : 'Health Check (public)'}
            </button>
            <button
              onClick={() => hit('/api/admin/debug/smt/raw-files')}
              className="w-full px-3 py-2 rounded-lg border hover:bg-gray-50"
              disabled={loading || !ready}
            >
              {loading ? 'Loading…' : 'List Raw Files'}
            </button>
          </div>
        </div>
      </section>

      <section className="p-4 rounded-2xl border">
        <h2 className="font-medium mb-3">File Upload Tests</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm mb-1">Test File (CSV or XML)</label>
            <input
              type="file"
              accept=".csv,.xml,.txt"
              onChange={(e) => setTestFile(e.target.files?.[0] || null)}
              className="w-full rounded-lg border px-3 py-2"
            />
            {testFile && (
              <p className="text-sm text-gray-600 mt-1">
                Selected: {testFile.name} ({testFile.size} bytes)
              </p>
            )}
          </div>
          <div>
            <label className="block text-sm mb-1">Or paste text content</label>
            <textarea
              className="w-full rounded-lg border px-3 py-2 font-mono text-sm"
              rows={4}
              placeholder="Paste CSV or Green Button XML here..."
              value={testText}
              onChange={(e) => setTestText(e.target.value)}
            />
          </div>
          <div className="flex gap-3">
            <button
              onClick={testIngest}
              className="px-4 py-2 rounded-lg border hover:bg-gray-50"
              disabled={loading || !ready || (!testFile && !testText)}
            >
              {loading ? 'Loading…' : 'Test Ingest'}
            </button>
            <button
              onClick={testRawUpload}
              className="px-4 py-2 rounded-lg border hover:bg-gray-50"
              disabled={loading || !ready || !testFile}
            >
              {loading ? 'Loading…' : 'Test Raw Upload'}
            </button>
          </div>
        </div>
      </section>

      <section className="grid md:grid-cols-2 gap-4">
        <div className="p-4 rounded-2xl border">
          <h3 className="font-medium mb-2">Response Summary</h3>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
            <dt className="text-gray-500">ok</dt><dd>{String(result?.ok ?? '')}</dd>
            <dt className="text-gray-500">status</dt><dd>{result?.status ?? ''}</dd>
            <dt className="text-gray-500">error</dt><dd>{result?.error ?? ''}</dd>
            <dt className="text-gray-500">message</dt><dd>{result?.message ?? ''}</dd>
          </dl>
        </div>

        <div className="p-4 rounded-2xl border">
          <h3 className="font-medium mb-2">Raw Response</h3>
          <pre className="text-xs bg-gray-50 rounded-lg p-3 overflow-auto max-h-[32rem]">
{pretty(raw)}
          </pre>
        </div>
      </section>
    </div>
  );
}

