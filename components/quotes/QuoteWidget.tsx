// components/quotes/QuoteWidget.tsx
// Step 37: Drop-in client component to request and display quotes
// - Uses lib/quote/client.ts fetchQuotes()
// - Minimal form: address + flat usage (kWh). State defaults to TX.
// - Renders a simple list of returned plans; you can replace the list item
//   with a fancier <QuoteCard /> in a later step.
//
// Usage:
//   import QuoteWidget from '@/components/quotes/QuoteWidget';
//   <QuoteWidget />
//
// Safe to mount on any page (no API key on client; calls /api/quote)

'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  fetchQuotes,
  makeFlatUsage,
  type QuoteItem,
  type QuoteResponse,
} from '@/lib/quote/client';

type Props = {
  defaultAddress?: {
    address?: string;
    city?: string;
    state?: string; // TX
    zip?: string;
  };
  defaultKwh?: number;
  className?: string;
};

export default function QuoteWidget({
  defaultAddress,
  defaultKwh = 1000,
  className,
}: Props) {
  // --- form state
  const [address, setAddress] = useState(defaultAddress?.address ?? '');
  const [city, setCity] = useState(defaultAddress?.city ?? '');
  const [state, setState] = useState((defaultAddress?.state ?? 'TX').toUpperCase());
  const [zip, setZip] = useState(defaultAddress?.zip ?? '');
  const [kwh, setKwh] = useState<number>(defaultKwh);

  // --- request state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<QuoteResponse | null>(null);

  // keep a ref to cancel in-flight
  const abortRef = useRef<AbortController | null>(null);

  const canSubmit = useMemo(() => {
    return Boolean(address.trim() && city.trim() && state.trim() && zip.trim() && kwh > 0);
  }, [address, city, state, zip, kwh]);

  const onSubmit = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      if (!canSubmit || loading) return;

      // Cancel previous
      if (abortRef.current) {
        abortRef.current.abort();
      }
      const ac = new AbortController();
      abortRef.current = ac;

      setLoading(true);
      setError(null);
      setResult(null);

      try {
        const res = await fetchQuotes(
          {
            address: address.trim(),
            city: city.trim(),
            state: state.trim().toUpperCase(),
            zip: zip.trim(),
            usage: makeFlatUsage(kwh),
          },
          { signal: ac.signal }
        );
        setResult(res);
      } catch (err: any) {
        setError(err?.message || 'Failed to fetch quotes.');
      } finally {
        setLoading(false);
      }
    },
    [address, city, state, zip, kwh, canSubmit, loading]
  );

  const onReset = useCallback(() => {
    setError(null);
    setResult(null);
  }, []);

  return (
    <div className={cn('w-full max-w-3xl mx-auto rounded-2xl border p-4 md:p-6 shadow-sm bg-white', className)}>
      <h2 className="text-xl md:text-2xl font-semibold mb-4">Find electricity plans</h2>

      <form onSubmit={onSubmit} className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
          <div className="md:col-span-3">
            <label className="block text-sm font-medium mb-1">Street address</label>
            <input
              className="w-full rounded-lg border px-3 py-2"
              placeholder="8808 Las Vegas Ct"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              autoComplete="address-line1"
            />
          </div>

          <div className="md:col-span-2">
            <label className="block text-sm font-medium mb-1">City</label>
            <input
              className="w-full rounded-lg border px-3 py-2"
              placeholder="White Settlement"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              autoComplete="address-level2"
            />
          </div>

          <div className="md:col-span-1">
            <label className="block text-sm font-medium mb-1">State</label>
            <input
              className="w-full rounded-lg border px-3 py-2"
              value={state}
              onChange={(e) => setState(e.target.value.toUpperCase())}
              maxLength={2}
              autoComplete="address-level1"
            />
          </div>

          <div className="md:col-span-2">
            <label className="block text-sm font-medium mb-1">ZIP</label>
            <input
              className="w-full rounded-lg border px-3 py-2"
              placeholder="76108"
              value={zip}
              onChange={(e) => setZip(e.target.value)}
              inputMode="numeric"
              autoComplete="postal-code"
            />
          </div>

          <div className="md:col-span-2">
            <label className="block text-sm font-medium mb-1">Monthly usage (kWh)</label>
            <input
              className="w-full rounded-lg border px-3 py-2"
              placeholder="1000"
              value={String(kwh)}
              onChange={(e) => setKwh(Math.max(0, Number(e.target.value.replace(/[^\d.]/g, '')) || 0))}
              inputMode="decimal"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 pt-2">
          <button
            type="submit"
            disabled={!canSubmit || loading}
            className={cn(
              'rounded-lg px-4 py-2 text-white',
              canSubmit && !loading ? 'bg-black hover:opacity-90' : 'bg-gray-400 cursor-not-allowed'
            )}
          >
            {loading ? 'Searching…' : 'Get quotes'}
          </button>

          {(error || result) && (
            <button
              type="button"
              onClick={onReset}
              className="rounded-lg px-3 py-2 border bg-white hover:bg-gray-50"
            >
              Reset
            </button>
          )}
        </div>
      </form>

      {/* Feedback */}
      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="mt-6 space-y-3 animate-pulse">
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="mt-6">
          <div className="text-sm text-gray-600 mb-2">
            <strong>{result.meta.offer_count}</strong> plan{result.meta.offer_count === 1 ? '' : 's'} for{' '}
            <span className="font-medium">
              {result.meta.address}, {result.meta.city}, {result.meta.state} {result.meta.zip}
            </span>{' '}
            at <span className="font-medium">{Math.round(result.meta.usage_kwh)} kWh</span>.
          </div>

          <ul className="space-y-3">
            {result.quotes.map((q) => (
              <QuoteListItem key={q.offer_id} q={q} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function QuoteListItem({ q }: { q: QuoteItem }) {
  return (
    <li className="rounded-xl border p-4 hover:shadow-sm transition">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-base md:text-lg font-semibold">{q.offer_name}</div>
          <div className="text-sm text-gray-600">
            {q.supplier ? q.supplier : 'Unknown supplier'} • {q.tdsp ?? 'TDSP'} •{' '}
            {q.term ? `${q.term} mo` : 'term n/a'}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xl font-semibold">
            ${q.totals.total_dollars.toFixed(2)} <span className="text-sm text-gray-500">/mo est.</span>
          </div>
          <div className="text-sm text-gray-600">
            {q.totals.eff_cents_per_kwh.toFixed(3)} ¢/kWh
          </div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
        <KV label="Energy" value={fmtCents(q.breakdown.energyCents)} />
        <KV label="Delivery" value={fmtCents(q.breakdown.deliveryCents)} />
        <KV label="Base fee" value={fmtCents(q.breakdown.baseFeeCents)} />
        <KV label="Credits" value={`- ${fmtCents(q.breakdown.creditsCents)}`} />
      </div>

      {(q.links?.efl || q.links?.tos || q.links?.yrac) && (
        <div className="mt-3 text-xs text-gray-600 flex flex-wrap gap-3">
          {q.links.efl && (
            <a className="underline hover:no-underline" href={q.links.efl} target="_blank" rel="noreferrer">
              EFL
            </a>
          )}
          {q.links.tos && (
            <a className="underline hover:no-underline" href={q.links.tos} target="_blank" rel="noreferrer">
              TOS
            </a>
          )}
          {q.links.yrac && (
            <a className="underline hover:no-underline" href={q.links.yrac} target="_blank" rel="noreferrer">
              YRAC
            </a>
          )}
          <span className="ml-auto">
            {q.matched_rate ? (
              <span className="inline-flex items-center gap-1 text-green-700">
                <Dot className="text-green-500" /> matched rate
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-amber-700">
                <Dot className="text-amber-500" /> estimated
              </span>
            )}
          </span>
        </div>
      )}
    </li>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-gray-50 px-3 py-2">
      <div className="text-gray-500">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}

function fmtCents(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function SkeletonRow() {
  return (
    <div className="rounded-xl border p-4">
      <div className="h-4 w-48 bg-gray-200 rounded mb-2" />
      <div className="h-3 w-32 bg-gray-200 rounded" />
      <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
        <div className="h-10 bg-gray-100 rounded" />
        <div className="h-10 bg-gray-100 rounded" />
        <div className="h-10 bg-gray-100 rounded" />
        <div className="h-10 bg-gray-100 rounded" />
      </div>
    </div>
  );
}

function Dot({ className = '' }: { className?: string }) {
  return <span className={cn('inline-block h-2 w-2 rounded-full bg-current', className)} />;
}

// tiny classnames helper
function cn(...xs: Array<string | undefined | null | false>) {
  return xs.filter(Boolean).join(' ');
}
