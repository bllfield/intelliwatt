'use client';

import React, { useCallback, useMemo, useState } from 'react';

function toBase64(csv: string) {
  if (typeof window === 'undefined') return '';
  const encoder = new TextEncoder();
  const bytes = encoder.encode(csv);
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return window.btoa(binary);
}

function makeSampleCsv() {
  const rows = ['ts,kwh'];
  const base = '2025-11-11T';
  for (let i = 0; i < 96; i += 1) {
    const hour = Math.floor(i / 4)
      .toString()
      .padStart(2, '0');
    const minutes = ((i % 4) * 15)
      .toString()
      .padStart(2, '0');
    rows.push(`${base}${hour}:${minutes}:00Z,1.23`);
  }
  return rows.join('\n');
}

export default function SmtToolsPage() {
  const [adminToken, setAdminToken] = useState('');
  const [log, setLog] = useState('');
  const [rows, setRows] = useState<any[]>([]);

  const headers = useMemo(() => ({
    'content-type': 'application/json',
    'x-admin-token': adminToken.trim(),
  }), [adminToken]);

  const runWebhook = useCallback(async () => {
    setLog('Triggering webhook…');
    try {
      const res = await fetch('/api/admin/smt/pull', {
        method: 'POST',
        headers,
        body: JSON.stringify({ esiid: '1044TEST', meter: 'M1' }),
      });
      const text = await res.text();
      setLog(text);
    } catch (err: any) {
      setLog(`Webhook error: ${err?.message ?? String(err)}`);
    }
  }, [headers]);

  const runInline = useCallback(async () => {
    setLog('Sending inline CSV…');
    try {
      const csv = makeSampleCsv();
      const encoder = new TextEncoder();
      const bytes = encoder.encode(csv);
      const b64 = toBase64(csv);

      const res = await fetch('/api/admin/smt/pull', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          mode: 'inline',
          source: 'adhocusage',
          filename: 'adhoc_1044TEST_usage_2025-11-11.csv',
          mime: 'text/csv',
          encoding: 'base64',
          sizeBytes: bytes.length,
          content_b64: b64,
          esiid: '1044TEST',
          meter: 'M1',
          captured_at: '2025-11-11T23:59:00Z',
        }),
      });
      const text = await res.text();
      setLog(text);
    } catch (err: any) {
      setLog(`Inline error: ${err?.message ?? String(err)}`);
    }
  }, [headers]);

  const refreshFiles = useCallback(async () => {
    setLog('Loading latest raw files…');
    try {
      const res = await fetch('/api/admin/debug/smt/raw-files?limit=10', {
        headers: {
          'x-admin-token': adminToken.trim(),
        },
      });
      const json = await res.json();
      setRows(Array.isArray(json?.rows) ? json.rows : []);
      setLog('Loaded raw files.');
    } catch (err: any) {
      setLog(`Fetch error: ${err?.message ?? String(err)}`);
    }
  }, [adminToken]);

  return (
    <div className="p-6 space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">SMT Tools</h1>
        <p className="text-sm text-gray-600">
          Trigger webhook pulls, send inline CSV payloads, and inspect the last few stored files.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="password"
          placeholder="x-admin-token (64 chars)"
          className="border px-3 py-2 rounded w-[360px]"
          value={adminToken}
          onChange={(event) => setAdminToken(event.target.value)}
        />
        <button
          type="button"
          onClick={runWebhook}
          className="px-4 py-2 rounded bg-black text-white hover:bg-gray-800"
        >
          Trigger Webhook Pull
        </button>
        <button
          type="button"
          onClick={runInline}
          className="px-4 py-2 rounded bg-black text-white hover:bg-gray-800"
        >
          Send Inline Test CSV
        </button>
        <button
          type="button"
          onClick={refreshFiles}
          className="px-4 py-2 rounded bg-gray-800 text-white hover:bg-gray-700"
        >
          Refresh Files
        </button>
      </div>

      <pre className="bg-gray-100 p-3 rounded text-sm whitespace-pre-wrap min-h-[140px]">
        {log || 'Responses will appear here.'}
      </pre>

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Latest Raw Files</h2>
        <table className="w-full text-sm border border-gray-200">
          <thead>
            <tr className="bg-gray-50 text-left">
              <th className="p-2">Filename</th>
              <th className="p-2">Size (bytes)</th>
              <th className="p-2">SHA256</th>
              <th className="p-2">Source</th>
              <th className="p-2">Storage Path</th>
              <th className="p-2">Received</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="p-2 text-gray-500" colSpan={6}>
                  No rows loaded yet.
                </td>
              </tr>
            ) : (
              rows.map((row, index) => (
                <tr key={row.id ?? index} className="border-t border-gray-200">
                  <td className="p-2 font-mono text-xs break-all">{row.filename}</td>
                  <td className="p-2 font-mono text-xs">{row.sizeBytes}</td>
                  <td className="p-2 font-mono text-xs break-all">{row.sha256}</td>
                  <td className="p-2 font-mono text-xs">{row.source}</td>
                  <td className="p-2 font-mono text-xs break-all">{row.storagePath}</td>
                  <td className="p-2 font-mono text-xs">{row.receivedAt ?? row.createdAt}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
