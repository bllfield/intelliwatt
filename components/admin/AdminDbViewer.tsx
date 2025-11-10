// components/admin/AdminDbViewer.tsx

'use client';

import { useEffect, useMemo, useState } from 'react';

type TableMeta = { name: string; count: number; columns: Array<{ name: string; type: string }> };

type QueryResp = { ok: boolean; columns: string[]; rows: any[] };

export default function AdminDbViewer() {
  const [token, setToken] = useState<string>('');
  const [tables, setTables] = useState<TableMeta[]>([]);
  const [active, setActive] = useState<string>('');
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = useState(50);
  const [orderBy, setOrderBy] = useState<string | undefined>(undefined);
  const [orderDir, setOrderDir] = useState<'asc' | 'desc'>('desc');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);

  // Pull token from session on load
  useEffect(() => {
    const saved = sessionStorage.getItem('iw_admin_token') || '';
    if (saved) setToken(saved);
  }, []);

  const headers = useMemo(() => {
    const h: Record<string, string> = {};
    if (token) h['x-admin-token'] = token;
    return h;
  }, [token]);

  async function loadTables() {
    if (!token) return;
    const r = await fetch('/api/admin/db/tables', { headers });
    if (r.ok) {
      const j = await r.json();
      setTables(j.tables || []);
      if (!active && j.tables?.[0]?.name) setActive(j.tables[0].name);
    } else {
      alert('Auth failed or error loading tables.');
    }
  }

  async function runQuery(newOffset?: number) {
    if (!token || !active) return;
    setLoading(true);
    const body = { table: active, offset: newOffset ?? offset, limit, orderBy, orderDir, q };
    const r = await fetch('/api/admin/db/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers } as HeadersInit,
      body: JSON.stringify(body)
    });
    setLoading(false);
    if (!r.ok) {
      const t = await r.text();
      alert(`Query error: ${t}`);
      return;
    }
    const j: QueryResp = await r.json();
    if (j.ok) {
      setColumns(j.columns || []);
      setRows(j.rows || []);
      if (typeof newOffset === 'number') setOffset(newOffset);
    }
  }

  async function exportCsv() {
    if (!token || !active) return;
    const r = await fetch('/api/admin/db/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ table: active, offset, limit, orderBy, orderDir, q, csv: true })
    });
    if (!r.ok) {
      alert('CSV export failed.');
      return;
    }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${active}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  useEffect(() => {
    if (token) {
      sessionStorage.setItem('iw_admin_token', token);
      loadTables();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    runQuery(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, limit, orderBy, orderDir]);

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Database (Read-only)</h1>
      <div className="grid md:grid-cols-3 gap-4">
        <div className="col-span-1 space-y-3">
          <label className="block text-sm font-medium">Admin Token</label>
          <input
            type="password"
            value={token}
            onChange={e => setToken(e.target.value)}
            placeholder="Paste x-admin-token"
            className="w-full border rounded-lg px-3 py-2"
          />
          <div className="mt-4">
            <label className="block text-sm font-medium mb-2">Tables</label>
            <div className="space-y-1 max-h-[420px] overflow-auto border rounded-lg">
              {tables.map(t => (
                <button
                  key={t.name}
                  onClick={() => { setActive(t.name); setOffset(0); }}
                  className={`w-full text-left px-3 py-2 hover:bg-gray-50 ${active === t.name ? 'bg-gray-100 font-medium' : ''}`}
                  title={`${t.count} rows`}
                >
                  {t.name} <span className="text-xs text-gray-500">({t.count.toLocaleString()} rows)</span>
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="col-span-2 space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="block text-sm font-medium">Search</label>
              <input
                value={q}
                onChange={e => setQ(e.target.value)}
                onKeyDown={e => (e.key === 'Enter' ? runQuery(0) : null)}
                placeholder="Search text columns (ILIKE)"
                className="border rounded-lg px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium">Limit</label>
              <input
                type="number"
                value={limit}
                onChange={e => setLimit(Math.max(1, Math.min(500, Number(e.target.value) || 50)))}
                className="w-24 border rounded-lg px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium">Order By</label>
              <select
                className="border rounded-lg px-3 py-2"
                value={orderBy || ''}
                onChange={e => setOrderBy(e.target.value || undefined)}
              >
                <option value="">(auto)</option>
                {columns.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium">Direction</label>
              <select className="border rounded-lg px-3 py-2" value={orderDir} onChange={e => setOrderDir(e.target.value as any)}>
                <option value="desc">desc</option>
                <option value="asc">asc</option>
              </select>
            </div>
            <button
              onClick={() => runQuery(0)}
              className="ml-auto rounded-lg px-4 py-2 border hover:bg-gray-50"
            >
              {loading ? 'Loading…' : 'Run'}
            </button>
            <button
              onClick={exportCsv}
              className="rounded-lg px-4 py-2 border hover:bg-gray-50"
            >
              Export CSV
            </button>
          </div>
          <div className="overflow-auto border rounded-lg">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {columns.map(c => <th key={c} className="px-3 py-2 text-left font-medium">{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t">
                    {columns.map(c => {
                      const v = r[c];
                      const s = v === null || v === undefined
                        ? ''
                        : typeof v === 'object'
                          ? JSON.stringify(v)
                          : String(v);
                      return <td key={c} className="px-3 py-2 align-top">{s}</td>;
                    })}
                  </tr>
                ))}
                {(!rows || rows.length === 0) && (
                  <tr><td className="px-3 py-6 text-gray-500" colSpan={columns.length || 1}>No rows</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => runQuery(Math.max(0, offset - limit))}
              className="rounded-lg px-3 py-1 border hover:bg-gray-50"
              disabled={offset === 0}
            >
              Prev
            </button>
            <div className="text-sm text-gray-600">Offset: {offset}</div>
            <button
              onClick={() => runQuery(offset + limit)}
              className="rounded-lg px-3 py-1 border hover:bg-gray-50"
              disabled={!rows || rows.length < limit}
            >
              Next
            </button>
          </div>
        </div>
      </div>
      <p className="text-xs text-gray-500">
        Read-only. Protected by <code>x-admin-token</code>. Token is stored only in your browser sessionStorage.
      </p>
    </div>
  );
}
