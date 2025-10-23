// app/plans/page.tsx
// Step 56: Render 500/1000/2000 kWh tier table (EFL vs IntelliWatt calc)
// ----------------------------------------------------------------------
// What's new vs Step 52:
//  • PlanRow type extended with `tiers`
//  • UI section "Tier comparison" added to each card
//  • Shows:
//      - EFL-advertised ¢/kWh (if provided by WattBuy)
//      - IntelliWatt estimated total $ and effective ¢/kWh
//
// Drop-in replacement for the existing file.

'use client';

import { useState } from 'react';

type Address = { line1: string; city: string; state: string; zip: string };

type TierRow = {
  kwh: 500 | 1000 | 2000;
  efl_cents_per_kwh?: number | null;
  calc_total_usd: number;
  calc_effective_cents_per_kwh: number;
};

type StandardTiers = {
  days: number;
  results: TierRow[];
};

type PlanRow = {
  rank: number;
  offer_id: string;
  supplier: string;
  supplier_slug: string;
  tdsp: string | null;
  plan_name: string;
  term_months: number | null;
  links: { efl: string | null; tos: string | null; yrac: string | null; enroll: string | null };
  kwh: number;
  days: number;
  est_monthly_usd: number;
  breakdown: Array<{ kind: string; label: string; usd: number; kwh?: number; extra?: any }>;
  tiers?: StandardTiers; // <-- NEW
  match_confidence: number;
  badges: string[];
  calc_notes?: string[];
};

type ApiResponse = {
  context: {
    esiid: string | null;
    tdsp: string | null;
    address: Address | null;
    monthlyKwh: number;
    serviceDays: number;
    offers_count: number;
    plans_count: number;
  };
  plans: PlanRow[];
  unmatched_offers: Array<{ offer_id: string; supplier: string | null; plan_name: string; reason: string; suggestions: any[] }>;
  meta: { generated_at: string; calc_schema: string };
  error?: string;
  detail?: string;
};

export default function PlansPage() {
  const [esiid, setEsiid] = useState('');
  const [line1, setLine1] = useState('');
  const [city, setCity] = useState('');
  const [stateVal, setStateVal] = useState('TX');
  const [zip, setZip] = useState('');
  const [monthlyKwh, setMonthlyKwh] = useState(1000);
  const [serviceDays, setServiceDays] = useState(30);
  const [loading, setLoading] = useState(false);
  const [resp, setResp] = useState<ApiResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr(null);
    setResp(null);

    // Build payload: require either esiid or full address
    const hasAddr = line1 && city && stateVal && zip;
    const payload: any = {
      usage: { monthlyKwh: Number(monthlyKwh), serviceDays: Number(serviceDays) },
      limit: 25,
      filters: {},
    };
    if (esiid.trim()) payload.esiid = esiid.trim();
    else if (hasAddr) payload.address = { line1, city, state: stateVal, zip };
    else {
      setErr('Enter an ESIID or a full address.');
      setLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/recommendations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as ApiResponse;
      if (!res.ok) {
        setErr(data?.error || `Request failed: ${res.status}`);
      } else {
        setResp(data);
      }
    } catch (e: any) {
      setErr(e?.message || 'Network error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-2xl font-bold">Find electricity plans</h1>
      <p className="text-sm text-gray-500 mt-1">
        Texas only (TDSP-aware). Enter an ESIID or a full service address.
      </p>

      <form onSubmit={onSubmit} className="mt-6 grid grid-cols-1 gap-4 rounded-2xl border p-4 md:grid-cols-12">
        <div className="md:col-span-12">
          <label className="text-sm font-medium">ESIID (optional)</label>
          <input
            value={esiid}
            onChange={(e) => setEsiid(e.target.value)}
            placeholder="e.g., 10443720004529147"
            className="mt-1 w-full rounded-xl border px-3 py-2"
          />
          <p className="text-xs text-gray-500 mt-1">If you provide an ESIID, the address is not required.</p>
        </div>

        <div className="md:col-span-6">
          <label className="text-sm font-medium">Address line</label>
          <input
            value={line1}
            onChange={(e) => setLine1(e.target.value)}
            placeholder="8808 Las Vegas Ct"
            className="mt-1 w-full rounded-xl border px-3 py-2"
          />
        </div>
        <div className="md:col-span-3">
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

        <div className="md:col-span-3">
          <label className="text-sm font-medium">Monthly usage (kWh)</label>
          <input
            type="number"
            value={monthlyKwh}
            onChange={(e) => setMonthlyKwh(Number(e.target.value))}
            className="mt-1 w-full rounded-xl border px-3 py-2"
          />
        </div>
        <div className="md:col-span-3">
          <label className="text-sm font-medium">Service days</label>
          <input
            type="number"
            value={serviceDays}
            onChange={(e) => setServiceDays(Number(e.target.value))}
            className="mt-1 w-full rounded-xl border px-3 py-2"
          />
        </div>

        <div className="md:col-span-12 flex items-center gap-3">
          <button
            type="submit"
            disabled={loading}
            className="rounded-xl bg-black px-4 py-2 text-white disabled:opacity-50"
          >
            {loading ? 'Searching…' : 'Search plans'}
          </button>
          {err && <span className="text-sm text-red-600">{err}</span>}
        </div>
      </form>

      {/* Results */}
      {resp && (
        <div className="mt-8">
          <div className="mb-4 text-sm text-gray-600">
            <div>Results for {resp.context.esiid ? `ESIID ${resp.context.esiid}` : `${resp.context.address?.line1}, ${resp.context.address?.city} ${resp.context.address?.zip}`}</div>
            <div>
              TDSP: <strong className="uppercase">{resp.context.tdsp || 'unknown'}</strong> • Usage: <strong>{resp.context.monthlyKwh} kWh</strong> over <strong>{resp.context.serviceDays} days</strong>
            </div>
            <div className="text-xs text-gray-500 mt-1">
              Generated {new Date(resp.meta.generated_at).toLocaleString()} • {resp.plans.length} matched plan(s), {resp.unmatched_offers.length} unmatched offer(s)
            </div>
          </div>

          <ul className="space-y-6">
            {resp.plans.map((p) => (
              <li key={p.offer_id}>
                <PlanCard plan={p} />
              </li>
            ))}
          </ul>

          {resp.unmatched_offers.length > 0 && (
            <div className="mt-10 rounded-2xl border p-4">
              <h3 className="font-semibold">Unmatched offers (debug)</h3>
              <p className="text-sm text-gray-500">These came from WattBuy but didn't match your PlanMaster. We'll improve keys in Step 50+.</p>
              <ul className="mt-2 text-sm list-disc pl-5">
                {resp.unmatched_offers.map((u) => (
                  <li key={u.offer_id}>
                    {u.supplier || 'Unknown supplier'} — {u.plan_name} (offer {u.offer_id})
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PlanCard({ plan }: { plan: PlanRow }) {
  const [open, setOpen] = useState(false);

  // Helper to render tier cell
  function TierCell({ t }: { t: TierRow }) {
    return (
      <div className="rounded-xl border p-3">
        <div className="text-sm font-medium">{t.kwh} kWh / {t.kwh === 500 ? 'apt/small' : t.kwh === 1000 ? 'avg' : 'large'}</div>
        <div className="mt-2 text-xs text-gray-500">EFL rate</div>
        <div className="text-sm">
          {isFiniteNum(t.efl_cents_per_kwh) ? `${t.efl_cents_per_kwh!.toFixed(2)}¢/kWh` : '—'}
        </div>
        <div className="mt-2 text-xs text-gray-500">Our estimate</div>
        <div className="text-sm">
          ${t.calc_total_usd.toFixed(2)} • {t.calc_effective_cents_per_kwh.toFixed(2)}¢/kWh
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border p-5 shadow-sm">
      {/* Header */}
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-xs text-gray-500">Rank #{plan.rank}</div>
          <h2 className="text-lg font-semibold">{plan.plan_name}</h2>
          <div className="text-sm text-gray-600">
            {plan.supplier} • Term: <strong>{plan.term_months ?? '—'}</strong> mo • TDSP:{' '}
            <span className="uppercase">{plan.tdsp || 'unknown'}</span>
          </div>
          {!!plan.badges?.length && (
            <div className="mt-1 flex flex-wrap gap-2">
              {plan.badges.map((b) => (
                <span key={b} className="rounded-full border px-2 py-0.5 text-xs">
                  {b}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="text-right">
          <div className="text-sm text-gray-500">Est. monthly</div>
          <div className="text-2xl font-bold">${plan.est_monthly_usd.toFixed(2)}</div>
          <div className="text-xs text-gray-500">
            {plan.kwh} kWh / {plan.days} days
          </div>

          <div className="mt-3 flex items-center gap-2">
            {plan.links.enroll && (
              <a
                href={plan.links.enroll}
                target="_blank"
                rel="noreferrer"
                className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
              >
                Enroll
              </a>
            )}
            <button
              onClick={() => setOpen((v) => !v)}
              className="rounded-xl border px-3 py-2 text-sm"
              aria-expanded={open}
              aria-controls={`breakdown-${plan.offer_id}`}
            >
              {open ? 'Hide details' : 'Pricing breakdown'}
            </button>
          </div>
        </div>
      </div>

      {/* Docs */}
      <div className="mt-4 grid items-center gap-2 md:grid-cols-3">
        <DocLink label="Electricity Facts Label (EFL)" href={plan.links.efl} />
        <DocLink label="Terms of Service" href={plan.links.tos} />
        <DocLink label="Your Rights as a Customer" href={plan.links.yrac} />
      </div>

      {/* NEW: Tiers */}
      {plan.tiers?.results?.length ? (
        <div className="mt-4">
          <div className="mb-2 text-sm font-semibold">Tier comparison <span className="font-normal text-gray-500">(for {plan.tiers.days} service days)</span></div>
          <div className="grid gap-3 md:grid-cols-3">
            {plan.tiers.results.map((t) => (
              <TierCell key={t.kwh} t={t} />
            ))}
          </div>
        </div>
      ) : null}

      {/* Breakdown */}
      {open && (
        <div id={`breakdown-${plan.offer_id}`} className="mt-4 overflow-hidden rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left">Component</th>
                <th className="px-3 py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {plan.breakdown.map((b, i) => (
                <tr key={i} className="border-t">
                  <td className="px-3 py-2">{b.label}</td>
                  <td className="px-3 py-2 text-right">${b.usd.toFixed(2)}</td>
                </tr>
              ))}
              <tr className="border-t bg-gray-50 font-medium">
                <td className="px-3 py-2">Estimated total</td>
                <td className="px-3 py-2 text-right">${plan.est_monthly_usd.toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
          {plan.calc_notes && plan.calc_notes.length > 0 && (
            <div className="px-3 py-2 text-xs text-gray-500">
              Notes: {plan.calc_notes.join(' • ')}
            </div>
          )}
        </div>
      )}

      {/* Compliance footer per card (concise, full texts on checkout in Step 57) */}
      <div className="mt-4 rounded-xl bg-gray-50 p-3 text-xs text-gray-600">
        <p>
          Prices shown are estimates based on your usage. Review the Electricity Facts Label, Terms of Service,
          and Your Rights as a Customer for full pricing details, tiers, fees, and conditions. Cancellation fees
          and deposits vary by supplier and plan; see linked documents for specifics.
        </p>
      </div>
    </div>
  );
}

function DocLink({ label, href }: { label: string; href: string | null }) {
  const base = <span className="text-sm">{label}</span>;
  if (!href) {
    return (
      <div className="flex items-center gap-2 text-gray-400">
        {base}
        <span className="text-xs">(not provided)</span>
      </div>
    );
  }
  return (
    <a href={href} target="_blank" rel="noreferrer" className="text-emerald-700 underline underline-offset-2 hover:text-emerald-800">
      {label}
    </a>
  );
}

function isFiniteNum(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}
