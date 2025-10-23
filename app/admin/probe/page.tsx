// app/admin/probe/page.tsx
// Step 58: Admin Probe UI for WattBuy diagnostics (uses Step 57 API)
// ------------------------------------------------------------------
// What this does:
//  • Lets you enter either ESIID or Address and call /api/wattbuy/probe
//  • Optionally toggle Retail Rate DB preview
//  • Renders a summary card + first 25 offers (redacted enroll links)
//  • Purely an internal QA page — keep it out of nav
//
// Navigate to: /admin/probe

'use client';

import { useState, useEffect } from 'react';

type Addr = { line1: string; city: string; state: string; zip: string };

type OfferPreview = {
  offer_id: string;
  offer_name: string;
  supplier: string | null;
  tdsp: string | null;
  term: number | null;
  kwh500: number | null;
  kwh1000: number | null;
  kwh2000: number | null;
  efl: string | null;
  tos: string | null;
  yrac: string | null;
};

type ProbeResponse = {
  ok: boolean;
  error?: string;
  context?: {
    input: { esiid: string | null; address: Addr | null; retail: boolean; page: number };
    resolved: { esiid: string | null; tdsp: string | null; eia_utility_id: number | null };
  };
  probes?: {
    address_to_esiid: any;
    utility_info: any;
    offers_count: number;
    first_offer: OfferPreview | null;
    retail_rates_preview: any;
  };
  offers?: OfferPreview[];
};

type QaFlag = {
  code: string
  message: string
  severity: 'info' | 'warn' | 'error'
  meta?: Record<string, unknown>
}
type QaRow = {
  planId: string
  supplierName: string
  planName: string
  termMonths: number
  tdsp: string
  flags: QaFlag[]
}

function SeverityPill({ s }: { s: QaFlag['severity'] }) {
  const color = s === 'error' ? '#dc2626' : s === 'warn' ? '#d97706' : '#2563eb'
  return <span style={{ background: color, color: 'white', borderRadius: 6, padding: '2px 6px', fontSize: 12 }}>{s}</span>
}

function QaPanel() {
  const [rows, setRows] = useState<QaRow[]>([])
  const [loading, setLoading] = useState(false)
  const [tdsp, setTdsp] = useState('')
  const [limit, setLimit] = useState(25)

  async function load() {
    setLoading(true)
    try {
      const qs = new URLSearchParams()
      qs.set('limit', String(limit))
      if (tdsp) qs.set('tdsp', tdsp)
      const res = await fetch(`/api/admin/qa/master_plans?${qs.toString()}`, { cache: 'no-store' })
      const json = await res.json()
      setRows(json.results || [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, []) // initial

  return (
    <section style={{ marginTop: 32 }}>
      <h2 style={{ fontWeight: 700, fontSize: 20 }}>QA — Master Plans</h2>
      <div style={{ display: 'flex', gap: 8, margin: '8px 0' }}>
        <input value={tdsp} onChange={e => setTdsp(e.target.value)} placeholder="TDSP (e.g., ONCOR)" style={{ padding: 6, border: '1px solid #ddd', borderRadius: 6 }} />
        <input type="number" value={limit} onChange={e => setLimit(parseInt(e.target.value || '25', 10))} style={{ width: 90, padding: 6, border: '1px solid #ddd', borderRadius: 6 }} />
        <button onClick={load} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #ccc' }}>{loading ? 'Loading…' : 'Refresh'}</button>
      </div>
      <div style={{ border: '1px solid #eee', borderRadius: 8 }}>
        {rows.map(r => (
          <div key={r.planId} style={{ padding: 12, borderBottom: '1px solid #f1f1f1' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <div>
                <div style={{ fontWeight: 600 }}>{r.supplierName} — {r.planName}</div>
                <div style={{ color: '#555', fontSize: 12 }}>{r.tdsp} · {r.termMonths} mo · {r.planId}</div>
              </div>
              <div>
                {r.flags.map((f, i) => <SeverityPill key={i} s={f.severity} />)}
              </div>
            </div>
            <ul style={{ marginTop: 6, marginBottom: 0, paddingLeft: 18 }}>
              {r.flags.map((f, i) => (
                <li key={i} style={{ color: f.severity === 'error' ? '#991b1b' : f.severity === 'warn' ? '#92400e' : '#1e40af' }}>
                  <strong>{f.code}</strong>: {f.message}
                </li>
              ))}
            </ul>
          </div>
        ))}
        {!rows.length && <div style={{ padding: 12, color: '#666' }}>No results.</div>}
      </div>
    </section>
  )
}

export default function AdminProbePage() {
  const [esiid, setEsiid] = useState('');
  const [line1, setLine1] = useState('');
  const [city, setCity] = useState('');
  const [stateVal, setStateVal] = useState('TX');
  const [zip, setZip] = useState('');
  const [retail, setRetail] = useState(false);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [res, setRes] = useState<ProbeResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function runProbe(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr(null);
    setRes(null);

    const params = new URLSearchParams();
    if (esiid.trim()) {
      params.set('esiid', esiid.trim());
    } else if (line1 && city && stateVal && zip) {
      params.set('address', line1);
      params.set('city', city);
      params.set('state', stateVal);
      params.set('zip', zip);
    } else {
      setErr('Provide an ESIID or a full address.');
      setLoading(false);
      return;
    }
    if (retail) params.set('retail', 'true');
    if (page > 1) params.set('page', String(page));

    try {
      const r = await fetch(`/api/wattbuy/probe?${params.toString()}`);
      const data = (await r.json()) as ProbeResponse;
      if (!r.ok || data.ok === false) {
        setErr(data?.error || `Probe failed (${r.status})`);
      } else {
        setRes(data);
      }
    } catch (e: any) {
      setErr(e?.message || 'Network error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-2xl font-bold">WattBuy Probe</h1>
      <p className="text-sm text-gray-600 mt-1">Quick connectivity & data check (ESI ➜ Info ➜ Offers ➜ Retail Rates).</p>

      <form onSubmit={runProbe} className="mt-6 grid grid-cols-1 gap-4 rounded-2xl border p-4 md:grid-cols-12">
        <div className="md:col-span-12">
          <label className="text-sm font-medium">ESIID (optional)</label>
          <input
            value={esiid}
            onChange={(e) => setEsiid(e.target.value)}
            placeholder="10443720004529147"
            className="mt-1 w-full rounded-xl border px-3 py-2"
          />
          <p className="text-xs text-gray-500 mt-1">If ESIID is provided, address is ignored.</p>
        </div>

        <div className="md:col-span-5">
          <label className="text-sm font-medium">Address line</label>
          <input
            value={line1}
            onChange={(e) => setLine1(e.target.value)}
            placeholder="8808 Las Vegas Ct"
            className="mt-1 w-full rounded-xl border px-3 py-2"
          />
        </div>
        <div className="md:col-span-4">
          <label className="text-sm font-medium">City</label>
          <input
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="White Settlement"
            className="mt-1 w-full rounded-xl border px-3 py-2"
          />
        </div>
        <div className="md:col-span-1">
          <label className="text-sm font-medium">State</label>
          <input
            value={stateVal}
            onChange={(e) => setStateVal(e.target.value.toUpperCase())}
            placeholder="TX"
            className="mt-1 w-full rounded-xl border px-3 py-2"
          />
        </div>
        <div className="md:col-span-2">
          <label className="text-sm font-medium">ZIP</label>
          <input
            value={zip}
            onChange={(e) => setZip(e.target.value)}
            placeholder="76108"
            className="mt-1 w-full rounded-xl border px-3 py-2"
          />
        </div>

        <div className="md:col-span-2 flex items-center gap-2">
          <input id="retail" type="checkbox" checked={retail} onChange={(e) => setRetail(e.target.checked)} />
          <label htmlFor="retail" className="text-sm">Include Retail Rate DB</label>
        </div>
        <div className="md:col-span-2">
          <label className="text-sm font-medium">Retail page</label>
          <input
            type="number"
            min={1}
            value={page}
            onChange={(e) => setPage(Math.max(1, Number(e.target.value)))}
            className="mt-1 w-full rounded-xl border px-3 py-2"
          />
        </div>

        <div className="md:col-span-12">
          <button type="submit" disabled={loading} className="rounded-xl bg-black px-4 py-2 text-white disabled:opacity-50">
            {loading ? 'Probing…' : 'Run probe'}
          </button>
          {err && <span className="ml-3 text-sm text-red-600">{err}</span>}
        </div>
      </form>

      {res && (
        <div className="mt-8 space-y-6">
          {/* Summary */}
          <div className="rounded-2xl border p-4">
            <h2 className="text-lg font-semibold">Summary</h2>
            <div className="mt-2 grid gap-2 md:grid-cols-3 text-sm">
              <InfoRow k="Resolved ESIID" v={res.context?.resolved.esiid || '—'} />
              <InfoRow k="TDSP" v={res.context?.resolved.tdsp || '—'} />
              <InfoRow k="EIA Utility ID" v={String(res.context?.resolved.eia_utility_id ?? '—')} />
              <InfoRow k="Offers found" v={String(res.probes?.offers_count ?? 0)} />
              <InfoRow k="Retail page" v={String(res.context?.input.page ?? '—')} />
              <InfoRow k="Retail included" v={res.context?.input.retail ? 'yes' : 'no'} />
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <Block title="Address ➜ ESIID">{jsonPretty(res.probes?.address_to_esiid)}</Block>
              <Block title="Utility info">{jsonPretty(res.probes?.utility_info)}</Block>
            </div>

            {res.probes?.retail_rates_preview && (
              <div className="mt-4">
                <Block title="Retail rate DB (preview)">{jsonPretty(res.probes.retail_rates_preview)}</Block>
              </div>
            )}
          </div>

          {/* Offers table */}
          <div className="rounded-2xl border p-4">
            <h2 className="text-lg font-semibold">Offers (redacted links)</h2>
            {!res.offers?.length ? (
              <p className="text-sm text-gray-500 mt-2">No offers returned.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <Th>Offer ID</Th>
                      <Th>Supplier</Th>
                      <Th>Plan</Th>
                      <Th>TDSP</Th>
                      <Th>Term</Th>
                      <Th className="text-right">500 ¢/kWh</Th>
                      <Th className="text-right">1000 ¢/kWh</Th>
                      <Th className="text-right">2000 ¢/kWh</Th>
                      <Th>Docs</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {res.offers.slice(0, 25).map((o) => (
                      <tr key={o.offer_id} className="border-t">
                        <Td>{o.offer_id}</Td>
                        <Td>{o.supplier || '—'}</Td>
                        <Td>{o.offer_name}</Td>
                        <Td className="uppercase">{o.tdsp || '—'}</Td>
                        <Td>{o.term ?? '—'}</Td>
                        <Td align="right">{fmtCents(o.kwh500)}</Td>
                        <Td align="right">{fmtCents(o.kwh1000)}</Td>
                        <Td align="right">{fmtCents(o.kwh2000)}</Td>
                        <Td>
                          <Doc href={o.efl} label="EFL" />{' '}
                          <Doc href={o.tos} label="TOS" />{' '}
                          <Doc href={o.yrac} label="YRAC" />
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Raw JSON (debug) */}
          <div className="rounded-2xl border p-4">
            <h2 className="text-lg font-semibold">Raw JSON</h2>
            <pre className="mt-2 max-h-96 overflow-auto rounded-xl bg-gray-50 p-3 text-xs">
{JSON.stringify(res, null, 2)}
            </pre>
          </div>
        </div>
      )}

      <QaPanel />
    </div>
  );
}

function InfoRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl border px-3 py-2">
      <span className="text-gray-500">{k}</span>
      <span className="font-medium">{v}</span>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border p-3">
      <div className="text-sm font-semibold">{title}</div>
      <div className="mt-2 text-xs">{children}</div>
    </div>
  );
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-left ${className}`}>{children}</th>;
}
function Td({ children, align, className = '' }: { children: React.ReactNode; align?: 'left' | 'right' | 'center'; className?: string }) {
  return <td className={`px-3 py-2 ${align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : ''} ${className}`}>{children}</td>;
}

function fmtCents(v: number | null) {
  return typeof v === 'number' && Number.isFinite(v) ? `${v.toFixed(1)}` : '—';
}

function Doc({ href, label }: { href: string | null; label: string }) {
  if (!href) return <span className="text-gray-400">{label}</span>;
  return (
    <a href={href} target="_blank" rel="noreferrer" className="text-emerald-700 underline underline-offset-2 hover:text-emerald-800">
      {label}
    </a>
  );
}

function jsonPretty(x: any) {
  if (!x) return <span className="text-gray-400">—</span>;
  return (
    <pre className="max-h-72 overflow-auto rounded-lg bg-gray-50 p-2">
{JSON.stringify(x, null, 2)}
    </pre>
  );
}
