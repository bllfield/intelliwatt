// app/admin/offers/page.tsx
// Step 42: Admin Offers Explorer — fetch & inspect raw WattBuy offers via our proxy
// -------------------------------------------------------------------------------
// What this page does:
//  - Query /api/offers by full address (address/city/state/zip) or by ESIID
//  - Show a quick "mini" table for QA (supplier, plan, term, ¢/kWh, kWh tiers, EFL links)
//  - Inspect/copy the raw offer JSON per row
//  - Copy a single offer JSON to clipboard for pasting into /admin/seed
//
// Notes:
//  - No API key on client; /api/offers holds the server key.
//  - TX only for now (consistent with proxy).
//  - Safe to use in Cursor devbox.

'use client';

import { useCallback, useMemo, useState } from 'react';

type Mini = {
  offer_id: string;
  name: string | null;
  supplier: string | null;
  tdsp: string | null;
  term: number | null;
  kwh500: number | null;
  kwh1000: number | null;
  kwh2000: number | null;
  cost: number | null;
  cancel_fee: string | null;
  links: { efl: string | null; tos: string | null; yrac: string | null };
};

type OffersResponse = {
  query: any;
  count: number;
  mini: Mini[];
  raw: any;
  error?: string;
};

function classifyOfferLikeWattbuy(o: any): 'fixed' | 'tou' | 'free-weekends' | 'free-nights' | 'variable' | 'other' | 'unknown' {
  const od = o?.offer_data ?? {};
  const name = String(o?.offer_name ?? o?.name ?? od?.offer_name ?? od?.name ?? '').toLowerCase();
  const supplier = String(od?.supplier ?? od?.supplier_name ?? '').toLowerCase();
  const productType = String(od?.product_type ?? od?.productType ?? '').toLowerCase();
  const planType = String(od?.plan_type ?? od?.planType ?? od?.rate_type ?? od?.rateType ?? '').toLowerCase();
  const hay = `${name} ${supplier} ${productType} ${planType}`;

  if (hay.includes('free weekend')) return 'free-weekends';
  if (hay.includes('free night')) return 'free-nights';
  if (hay.includes('tou') || hay.includes('time of use') || hay.includes('time-of-use')) return 'tou';
  if (hay.includes('variable')) return 'variable';
  if (productType.includes('fixed') || planType.includes('fixed') || hay.includes('fixed rate') || hay.includes('fixed-rate')) return 'fixed';
  if (name.trim()) return 'unknown';
  return 'other';
}

export default function AdminOffersExplorer() {
  // ---- form
  const [mode, setMode] = useState<'address' | 'esiid'>('address');
  const [address, setAddress] = useState('1234 Sample Street');
  const [city, setCity] = useState('Sample City');
  const [state, setState] = useState('TX');
  const [zip, setZip] = useState('75000');
  const [esiid, setEsiid] = useState('');

  // ---- results
  const [loading, setLoading] = useState(false);
  const [res, setRes] = useState<OffersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canFetch = useMemo(() => {
    if (mode === 'esiid') return esiid.trim().length > 5;
    return Boolean(address.trim() && city.trim() && state.trim() && zip.trim());
  }, [mode, address, city, state, zip, esiid]);

  const doFetch = useCallback(async () => {
    if (!canFetch || loading) return;
    setLoading(true);
    setError(null);
    setRes(null);

    try {
      const qs =
        mode === 'esiid'
          ? new URLSearchParams({ esiid: esiid.trim() })
          : new URLSearchParams({
              address: address.trim(),
              city: city.trim(),
              state: state.trim().toUpperCase(),
              zip: zip.trim(),
            });

      const r = await fetch(`/api/offers?${qs.toString()}`, { cache: 'no-store' });
      const text = await r.text();
      const json = safeJson(text) as OffersResponse;

      if (!r.ok) {
        throw new Error((json as any)?.error || r.statusText || 'Request failed');
      }
      setRes(json);
    } catch (e: any) {
      setError(e?.message || 'Failed to fetch offers.');
    } finally {
      setLoading(false);
    }
  }, [mode, address, city, state, zip, esiid, canFetch, loading]);

  const kindByOfferId = useMemo(() => {
    const out: Record<string, string> = {};
    const offers = (res as any)?.raw?.offers;
    if (Array.isArray(offers)) {
      for (const o of offers) {
        const id = String(o?.offer_id ?? '').trim();
        if (!id) continue;
        out[id] = classifyOfferLikeWattbuy(o);
      }
    }
    return out;
  }, [res]);

  return (
    <main className="min-h-screen w-full bg-gray-50">
      <div className="mx-auto max-w-6xl px-4 py-10">
        <h1 className="text-2xl md:text-3xl font-bold">Offers explorer</h1>
        <p className="text-gray-600 mt-1">
          Query <code className="bg-gray-100 px-1 rounded">/api/offers</code> and inspect WattBuy results.
        </p>

        {/* Query form */}
        <div className="mt-6 rounded-xl border bg-white p-4 md:p-6">
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="radio"
                checked={mode === 'address'}
                onChange={() => setMode('address')}
              />
              Address
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="radio"
                checked={mode === 'esiid'}
                onChange={() => setMode('esiid')}
              />
              ESIID
            </label>
          </div>

          {mode === 'address' ? (
            <div className="grid md:grid-cols-6 gap-3 mt-3">
              <div className="md:col-span-3">
                <label className="block text-sm font-medium mb-1">Street</label>
                <input
                  className="w-full rounded-lg border px-3 py-2"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium mb-1">City</label>
                <input
                  className="w-full rounded-lg border px-3 py-2"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                />
              </div>
              <div className="md:col-span-1">
                <label className="block text-sm font-medium mb-1">State</label>
                <input
                  className="w-full rounded-lg border px-3 py-2"
                  value={state}
                  onChange={(e) => setState(e.target.value.toUpperCase())}
                  maxLength={2}
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium mb-1">ZIP</label>
                <input
                  className="w-full rounded-lg border px-3 py-2"
                  value={zip}
                  onChange={(e) => setZip(e.target.value)}
                  inputMode="numeric"
                />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
              <div>
                <label className="block text-sm font-medium mb-1">ESIID</label>
                <input
                  className="w-full rounded-lg border px-3 py-2"
                  placeholder="1044…"
                  value={esiid}
                  onChange={(e) => setEsiid(e.target.value)}
                />
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 mt-4">
            <button
              onClick={doFetch}
              disabled={!canFetch || loading}
              className={`rounded-lg px-4 py-2 text-white ${canFetch && !loading ? 'bg-black hover:opacity-90' : 'bg-gray-400 cursor-not-allowed'}`}
            >
              {loading ? 'Fetching…' : 'Fetch offers'}
            </button>
            {(error || res) && (
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setRes(null);
                }}
                className="rounded-lg px-3 py-2 border bg-white hover:bg-gray-50"
              >
                Reset
              </button>
            )}
          </div>

          {error && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-red-700 text-sm">
              {error}
            </div>
          )}
        </div>

        {/* Results */}
        {res && (
          <div className="mt-6 space-y-4">
            <div className="text-sm text-gray-700">
              <strong>{res.count}</strong> offer{res.count === 1 ? '' : 's'} • query:{' '}
              <code className="bg-gray-100 px-1 rounded">{JSON.stringify(res.query)}</code>
            </div>

            <div className="overflow-x-auto rounded-xl border bg-white">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <Th>Supplier</Th>
                    <Th>Type</Th>
                    <Th>Plan</Th>
                    <Th>TDSP</Th>
                    <Th>Term</Th>
                    <Th className="text-right">¢/kWh (req.)</Th>
                    <Th className="text-right">500</Th>
                    <Th className="text-right">1000</Th>
                    <Th className="text-right">2000</Th>
                    <Th>Docs</Th>
                    <Th>Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {res.mini.map((m) => (
                    <tr key={m.offer_id} className="border-t">
                      <Td>{m.supplier || '-'}</Td>
                      <Td className="font-mono text-xs">{String(kindByOfferId[m.offer_id] ?? classifyOfferLikeWattbuy(m))}</Td>
                      <Td>{m.name || m.offer_id}</Td>
                      <Td>{m.tdsp || '-'}</Td>
                      <Td>{m.term ? `${m.term} mo` : '-'}</Td>
                      <Td align="right">{numFmt(m.cost)}</Td>
                      <Td align="right">{numFmt(m.kwh500)}</Td>
                      <Td align="right">{numFmt(m.kwh1000)}</Td>
                      <Td align="right">{numFmt(m.kwh2000)}</Td>
                      <Td>
                        <DocLinks links={m.links} />
                      </Td>
                      <Td>
                        <RowActions offerId={m.offer_id} raw={res.raw} />
                      </Td>
                    </tr>
                  ))}
                  {!res.mini.length && (
                    <tr>
                      <Td colSpan={11} className="text-center text-gray-500">
                        No offers found for this query.
                      </Td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Raw payload inspector (collapsible) */}
            <details className="rounded-xl border bg-white p-4">
              <summary className="cursor-pointer font-medium">Raw response JSON</summary>
              <pre className="mt-3 text-xs bg-gray-50 border rounded-lg p-3 overflow-x-auto">
                {JSON.stringify(res.raw, null, 2)}
              </pre>
            </details>
          </div>
        )}
      </div>
    </main>
  );
}

function Th({ children, className = '' }: any) {
  return <th className={`px-3 py-2 text-xs font-semibold text-gray-600 ${className}`}>{children}</th>;
}
function Td({
  children,
  align,
  colSpan,
  className = '',
}: {
  children: any;
  align?: 'left' | 'right' | 'center';
  colSpan?: number;
  className?: string;
}) {
  return (
    <td
      colSpan={colSpan}
      className={`px-3 py-2 ${align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : ''} ${className}`}
    >
      {children}
    </td>
  );
}

function numFmt(n: number | null) {
  if (n == null || !Number.isFinite(n)) return '-';
  return Number(n).toFixed(3);
}

function DocLinks({ links }: { links: { efl: string | null; tos: string | null; yrac: string | null } }) {
  return (
    <div className="flex flex-wrap gap-2 text-xs">
      {links.efl && (
        <a className="underline hover:no-underline" href={links.efl} target="_blank" rel="noreferrer">
          EFL
        </a>
      )}
      {links.tos && (
        <a className="underline hover:no-underline" href={links.tos} target="_blank" rel="noreferrer">
          TOS
        </a>
      )}
      {links.yrac && (
        <a className="underline hover:no-underline" href={links.yrac} target="_blank" rel="noreferrer">
          YRAC
        </a>
      )}
    </div>
  );
}

function RowActions({ offerId, raw }: { offerId: string; raw: any }) {
  // Find the full offer object by id inside raw.offers (if present)
  const offer = useMemo(() => {
    const arr = (raw as any)?.offers;
    if (Array.isArray(arr)) {
      return arr.find((o: any) => o?.offer_id === offerId) || null;
    }
    return null;
  }, [offerId, raw]);

  const [eflLoading, setEflLoading] = useState(false);
  const [eflError, setEflError] = useState<string | null>(null);
  const [eflSnapshot, setEflSnapshot] = useState<{
    parseConfidence: number | null;
    repPuctCertificate: string | null;
    eflVersionCode: string | null;
    warnings: string[];
  } | null>(null);

  const copyOffer = useCallback(async () => {
    if (!offer) return;
    const text = JSON.stringify(offer, null, 2);
    await navigator.clipboard.writeText(text);
    alert('Offer JSON copied to clipboard. Paste it into /admin/seed.');
  }, [offer]);

  const showOffer = useCallback(() => {
    if (!offer) return;
    const blob = new Blob([JSON.stringify(offer, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener,noreferrer');
  }, [offer]);

  const loadFactCard = useCallback(async () => {
    if (!offer) return;
    setEflLoading(true);
    setEflError(null);
    setEflSnapshot(null);

    try {
      const body = {
        offerId: offer.offer_id ?? null,
        providerName: offer.offer_data?.supplier_name ?? offer.offer_data?.supplier ?? null,
        planName: offer.offer_name ?? null,
        termMonths: typeof offer.offer_data?.term === 'number' ? offer.offer_data.term : null,
        tdspName: offer.offer_data?.utility ?? null,
        rawText: null,
        eflPdfSha256: null,
        repPuctCertificate: null,
        eflVersionCode: null,
      };

      const res = await fetch('/api/efl/template/from-offer', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();

      if (!res.ok || json.ok === false) {
        throw new Error(json.error || res.statusText || 'Template lookup failed');
      }

      setEflSnapshot({
        parseConfidence: typeof json.parseConfidence === 'number' ? json.parseConfidence : null,
        repPuctCertificate: json.repPuctCertificate ?? null,
        eflVersionCode: json.eflVersionCode ?? null,
        warnings: Array.isArray(json.warnings) ? json.warnings : [],
      });
    } catch (e: any) {
      setEflError(e?.message || 'Failed to load EFL template.');
    } finally {
      setEflLoading(false);
    }
  }, [offer]);

  return (
    <div className="flex flex-col gap-1 text-xs">
      <div className="flex items-center gap-2">
        <button
          className="rounded border px-2 py-1 bg-white hover:bg-gray-50"
          onClick={showOffer}
          disabled={!offer}
          title="View JSON"
        >
          View
        </button>
        <button
          className="rounded border px-2 py-1 bg-white hover:bg-gray-50"
          onClick={copyOffer}
          disabled={!offer}
          title="Copy JSON to clipboard"
        >
          Copy
        </button>
        <button
          className="rounded border px-2 py-1 bg-white hover:bg-gray-50"
          onClick={loadFactCard}
          disabled={!offer || eflLoading}
          title="Load EFL fact card template (non-blocking)"
        >
          {eflLoading ? 'Parsing…' : 'Fact card'}
        </button>
      </div>
      {eflError && <div className="text-red-600">{eflError}</div>}
      {eflSnapshot && (
        <div className="text-gray-600">
          <div>
            Confidence:{' '}
            {eflSnapshot.parseConfidence != null ? `${eflSnapshot.parseConfidence}%` : 'n/a'}
          </div>
          {eflSnapshot.repPuctCertificate && (
            <div>PUCT Cert: {eflSnapshot.repPuctCertificate}</div>
          )}
          {eflSnapshot.eflVersionCode && <div>Ver #: {eflSnapshot.eflVersionCode}</div>}
          {eflSnapshot.warnings.length > 0 && (
            <div className="mt-1 text-[11px] text-gray-500">
              Warnings: {eflSnapshot.warnings.join(' • ')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function safeJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}
