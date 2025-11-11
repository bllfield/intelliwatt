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
  const [address, setAddress] = useState({
    line1: '',
    city: '',
    state: 'TX',
    zip: '',
  });
  const [manualEsiid, setManualEsiid] = useState('');
  const [foundEsiid, setFoundEsiid] = useState<string | null>(null);
  const [rawFiles, setRawFiles] = useState<any[]>([]);
  const [selectedRawFile, setSelectedRawFile] = useState<any | null>(null);
  const [rawFileContent, setRawFileContent] = useState<string | null>(null);
  const [rawFileBase64, setRawFileBase64] = useState<string | null>(null);

  const ready = useMemo(() => Boolean(token), [token]);

  async function hit(path: string, options?: RequestInit) {
    if (!token) { alert('Set x-admin-token first'); return; }
    setLoading(true);
    setResult(null);
    setRaw(null);
    setSelectedRawFile(null);
    setRawFileContent(null);
    setRawFileBase64(null);
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

  async function listRawFiles() {
    if (!token) { alert('Set x-admin-token first'); return; }
    setLoading(true);
    setResult(null);
    setRaw(null);
    try {
      const r = await fetch('/api/admin/debug/smt/raw-files?limit=10', {
        headers: { 'x-admin-token': token, 'accept': 'application/json' },
      });
      const data = await r.json().catch(() => ({ error: 'Failed to parse JSON', status: r.status }));
      setRaw(data);
      setResult({ ok: data?.ok ?? true, status: r.status, data });
      setRawFiles(Array.isArray(data?.rows) ? data.rows : []);
    } catch (e: any) {
      setResult({ ok: false, status: 500, error: e?.message || 'fetch failed' });
      setRawFiles([]);
    } finally {
      setLoading(false);
    }
  }

  async function loadRawFile(id: string) {
    if (!token) { alert('Set x-admin-token first'); return; }
    setLoading(true);
    setSelectedRawFile(null);
    setRawFileContent(null);
    setRawFileBase64(null);
    try {
      const r = await fetch(`/api/admin/debug/smt/raw-files/${encodeURIComponent(id)}`, {
        headers: { 'x-admin-token': token, 'accept': 'application/json' },
      });
      const data = await r.json().catch(() => ({ error: 'Failed to parse JSON', status: r.status }));
      if (!data?.ok) {
        setResult({ ok: false, status: r.status, error: data?.error || 'Failed to load raw file', data });
        return;
      }
      setSelectedRawFile(data);
      if (data.textPreview) {
        setRawFileContent(data.textPreview as string);
      } else if (data.contentBase64) {
        setRawFileBase64(data.contentBase64 as string);
      }
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

  async function lookupEsiidAndPull() {
    if (!token) { alert('Set x-admin-token first'); return; }
    
    let esiid: string | null = null;
    
    // If manual ESIID is provided, use it directly
    if (manualEsiid && manualEsiid.trim()) {
      esiid = manualEsiid.trim();
      setFoundEsiid(esiid);
    } else {
      // Otherwise, lookup ESIID via WattBuy Electricity endpoint
      if (!address.line1 || !address.city || !address.state || !address.zip) {
        alert('Please fill in all address fields OR enter a manual ESIID');
        return;
      }
      
      setLoading(true);
      setResult(null);
      setRaw(null);
      setFoundEsiid(null);
      
      try {
        // Step 1: Lookup ESIID via WattBuy Electricity Info endpoint
        const params = new URLSearchParams({
          address: address.line1,
          city: address.city,
          state: address.state,
          zip: address.zip,
          utility_list: 'true',
        });
        const infoRes = await fetch(`/api/admin/wattbuy/electricity/info?${params.toString()}`, {
          method: 'GET',
          headers: { 'x-admin-token': token },
        });
        const infoData = await infoRes.json().catch(() => ({ error: 'Failed to parse JSON' }));
        
        if (!infoData.ok || !infoData.data) {
          setRaw(infoData);
          setResult({
            ok: false,
            status: infoRes.status,
            error: infoData.error || 'WattBuy electricity/info lookup failed',
            data: infoData,
          });
          setLoading(false);
          return;
        }

        // Extract ESIID from electricity/info response
        const elec = infoData.data;
        const directFields = ['esiid', 'esiId', 'esi_id', 'ESIID', 'ESI_ID', 'esi'];
        
        // Try direct fields
        for (const field of directFields) {
          if (elec[field] && typeof elec[field] === 'string' && elec[field].trim()) {
            esiid = elec[field].trim();
            break;
          }
        }
        
        // Try addresses array
        if (!esiid && Array.isArray(elec.addresses) && elec.addresses.length > 0) {
          for (const addr of elec.addresses) {
            if (addr && typeof addr === 'object') {
              for (const field of directFields) {
                if (addr[field] && typeof addr[field] === 'string' && addr[field].trim()) {
                  esiid = addr[field].trim();
                  break;
                }
              }
              if (esiid) break;
            }
          }
        }
        
        // Try utility_info array
        if (!esiid && Array.isArray(elec.utility_info) && elec.utility_info.length > 0) {
          for (const ui of elec.utility_info) {
            if (ui && typeof ui === 'object') {
              for (const field of directFields) {
                if (ui[field] && typeof ui[field] === 'string' && ui[field].trim()) {
                  esiid = ui[field].trim();
                  break;
                }
              }
              if (esiid) break;
            }
          }
        }
        
        if (!esiid) {
          setRaw({
            electricityInfo: infoData,
            error: 'NO_ESIID_FOUND',
            message: 'ESIID not found in WattBuy electricity/info response',
            sampleKeys: Object.keys(elec || {}).slice(0, 20),
          });
          setResult({
            ok: false,
            status: 404,
            error: 'NO_ESIID_FOUND',
            data: { message: 'ESIID not found in WattBuy electricity/info response', electricityInfo: infoData },
          });
          setLoading(false);
          return;
        }
        
        setFoundEsiid(esiid);
      } catch (e: any) {
        setResult({ ok: false, status: 500, error: e?.message || 'ESIID lookup failed' });
        setLoading(false);
        return;
      }
    }
    
    // Step 2: Trigger SMT pull with ESIID (either from lookup or manual)
    if (!esiid) {
      setResult({ ok: false, status: 400, error: 'No ESIID available' });
      setLoading(false);
      return;
    }
    
    try {
      setLoading(true);
      const pullRes = await fetch('/api/admin/smt/pull', {
        method: 'POST',
        headers: { 'x-admin-token': token, 'content-type': 'application/json' },
        body: JSON.stringify({ esiid }),
      });
      const pullData = await pullRes.json().catch(() => ({ error: 'Failed to parse JSON' }));
      
      setRaw({
        esiid: esiid,
        source: manualEsiid ? 'manual' : 'wattbuy_electricity',
        pull: pullData,
      });
      setResult({
        ok: pullData.ok,
        status: pullRes.status,
        error: pullData.error,
        data: pullData,
        message: pullData.message,
      });
    } catch (e: any) {
      setResult({ ok: false, status: 500, error: e?.message || 'SMT pull failed' });
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
              onClick={listRawFiles}
              className="w-full px-3 py-2 rounded-lg border hover:bg-gray-50"
              disabled={loading || !ready}
            >
              {loading ? 'Loading…' : 'List Raw Files'}
            </button>
          </div>
        </div>
      </section>

      <section className="p-4 rounded-2xl border">
        <h2 className="font-medium mb-3">Address to SMT Pull</h2>
        <p className="text-sm text-gray-600 mb-3">
          Option 1: Enter address to lookup ESIID via WattBuy Electricity Info endpoint (/v3/electricity/info), then trigger SMT pull<br/>
          Option 2: Enter ESIID manually to test SMT pull directly (skip WattBuy lookup)
        </p>
        <div className="mb-4">
          <label className="block text-sm mb-1 font-semibold">Manual ESIID (optional - skip WattBuy lookup)</label>
          <input
            type="text"
            className="w-full rounded-lg border px-3 py-2 mb-4"
            placeholder="Enter ESIID manually (17-18 digits)"
            value={manualEsiid}
            onChange={(e) => setManualEsiid(e.target.value)}
          />
        </div>
        <div className="grid md:grid-cols-4 gap-4 mb-4">
          <div>
            <label className="block text-sm mb-1">Address Line 1</label>
            <input
              type="text"
              className="w-full rounded-lg border px-3 py-2"
              placeholder="123 Main St"
              value={address.line1}
              onChange={(e) => setAddress({ ...address, line1: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-sm mb-1">City</label>
            <input
              type="text"
              className="w-full rounded-lg border px-3 py-2"
              placeholder="Dallas"
              value={address.city}
              onChange={(e) => setAddress({ ...address, city: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-sm mb-1">State</label>
            <input
              type="text"
              className="w-full rounded-lg border px-3 py-2"
              placeholder="TX"
              value={address.state}
              onChange={(e) => setAddress({ ...address, state: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-sm mb-1">ZIP</label>
            <input
              type="text"
              className="w-full rounded-lg border px-3 py-2"
              placeholder="75201"
              value={address.zip}
              onChange={(e) => setAddress({ ...address, zip: e.target.value })}
            />
          </div>
        </div>
        <button
          onClick={lookupEsiidAndPull}
          className="px-4 py-2 rounded-lg border hover:bg-gray-50 bg-green-50 font-semibold"
          disabled={loading || !ready}
        >
          {loading ? 'Processing…' : 'Lookup ESIID & Pull SMT'}
        </button>
        {foundEsiid && (
          <div className="mt-3 p-3 bg-green-50 rounded-lg">
            <p className="text-sm font-semibold">ESIID Found: <span className="font-mono">{foundEsiid}</span></p>
            <p className="text-sm text-gray-600">SMT pull has been triggered for this ESIID</p>
          </div>
        )}
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

        {rawFiles.length > 0 && (
          <div className="mt-6">
            <h3 className="font-medium mb-2">Recent SMT Raw Files</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-2 px-2">Created</th>
                    <th className="text-left py-2 px-2">Filename</th>
                    <th className="text-left py-2 px-2">Size</th>
                    <th className="text-left py-2 px-2">Source</th>
                    <th className="text-left py-2 px-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rawFiles.map((file: any) => (
                    <tr key={file.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-2 px-2 whitespace-nowrap">{file.createdAt}</td>
                      <td className="py-2 px-2">{file.filename}</td>
                      <td className="py-2 px-2">{file.sizeBytes?.toLocaleString?.() ?? file.sizeBytes}</td>
                      <td className="py-2 px-2">{file.source || 'adhocusage'}</td>
                      <td className="py-2 px-2">
                        <button
                          onClick={() => loadRawFile(file.id)}
                          className="px-3 py-1 rounded border hover:bg-gray-100"
                          disabled={loading}
                        >
                          Inspect
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {selectedRawFile && (
              <div className="mt-4 p-4 border rounded-lg bg-gray-50">
                <h4 className="font-semibold mb-2">{selectedRawFile.filename}</h4>
                <dl className="grid md:grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  <div>
                    <dt className="text-gray-500">ID</dt>
                    <dd className="font-mono">{selectedRawFile.id}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Size</dt>
                    <dd>{selectedRawFile.sizeBytes?.toLocaleString?.() ?? selectedRawFile.sizeBytes} bytes</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">SHA256</dt>
                    <dd className="font-mono text-xs break-all">{selectedRawFile.sha256}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Content Type</dt>
                    <dd>{selectedRawFile.contentType || 'application/octet-stream'}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Storage Path</dt>
                    <dd className="text-xs break-all">{selectedRawFile.storagePath || '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">Created</dt>
                    <dd>{selectedRawFile.createdAt}</dd>
                  </div>
                </dl>
                {rawFileContent && (
                  <div className="mt-3">
                    <div className="text-xs text-gray-500 mb-1">Text Preview</div>
                    <pre className="text-xs bg-white rounded-lg p-3 overflow-auto max-h-72 border">
{rawFileContent}
                    </pre>
                  </div>
                )}
                {!rawFileContent && rawFileBase64 && (
                  <div className="mt-3">
                    <div className="text-xs text-gray-500 mb-1">Content (base64)</div>
                    <pre className="text-xs bg-white rounded-lg p-3 overflow-auto max-h-72 border">
{rawFileBase64}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
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

