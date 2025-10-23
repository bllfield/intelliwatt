// app/api/rates/seed-retail/route.ts
// Step 45: Seed a local RateConfig from a WattBuy Retail Rate DB item
// -------------------------------------------------------------------
// What it does
//   - Accepts a single "tariff"/item from /v3/electricity/retail-rates (your Admin explorer step 44).
//   - Normalizes it into our internal RateConfig shape (best-effort).
//   - (Optional) writes it to /data/rates/<tdsp>/<slug>-<id>.json when dry=0.
//   - Returns the derived RateConfig plus metadata (path, key, dryRun).
//
// Why
//   - Lets you evaluate/ingest the Retail Rate DB as a source alongside (or in place of) EFL parsing.
//   - Keeps the raw source embedded for traceability.
//
// Usage (POST)
//   curl -X POST /api/rates/seed-retail?dry=1 \
//     -H 'content-type: application/json' \
//     -H 'x-seed-token: <ADMIN_SEED_TOKEN>' \
//     -d '{ "item": { ...retailRateItem }, "tdsp": "oncor" }'
//
// Env
//   ADMIN_SEED_TOKEN  -> simple guard for write access
//
// Notes
//   - The Retail Rate DB schema can vary; this normalizer is defensive and keeps the raw item.
//   - You can later refine `normalizeRetailItem()` to map more component types.

import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SeedReqBody = {
  item: any;           // single record from /v3/electricity/retail-rates
  tdsp?: string | null; // optional override for foldering (e.g., "oncor")
  keyOverride?: string; // optional explicit file key (without .json)
};

type RateComponent =
  | {
      kind: 'flat_per_kwh';
      rate_cents_per_kwh: number;
      tier?: { start_kwh?: number | null; end_kwh?: number | null } | null;
      tou?: { label?: string | null; start_hour?: number | null; end_hour?: number | null } | null;
      notes?: string | null;
    }
  | {
      kind: 'fixed_monthly';
      amount_usd: number;
      notes?: string | null;
    }
  | {
      kind: 'per_day';
      amount_usd_per_day: number;
      notes?: string | null;
    }
  | {
      kind: 'tdsp_passthrough';
      label?: string | null;
      details?: any;
    };

type RateConfig = {
  schema: 'intelliwatt.rate.v1';
  key: string;
  source: {
    provider: 'wattbuy.retail-rate-db';
    received_at: string; // ISO
    id?: string | number | null;
    name?: string | null;
    utilityID?: number | null;
    verified_at?: string | null;
    raw: any; // keep entire source for audit
  };
  meta: {
    display_name: string;
    sector?: string | null;
    effective?: string | null;
    expiration?: string | null;
    state?: string | null;
    tdsp?: string | null;
    eia_utility_id?: number | null;
    source_url?: string | null;
  };
  pricing: {
    base_monthly_usd?: number | null;
    components: RateComponent[];
  };
};

export async function POST(req: NextRequest) {
  try {
    const token = req.headers.get('x-seed-token')?.trim();
    if (!token || token !== process.env.ADMIN_SEED_TOKEN) {
      return NextResponse.json({ error: 'Unauthorized (invalid seed token).' }, { status: 401 });
    }

    const url = new URL(req.url);
    const dry = url.searchParams.get('dry') !== '0'; // default dry-run
    const bodyText = await req.text();
    let body: SeedReqBody;
    try {
      body = JSON.parse(bodyText);
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
    }
    if (!body?.item || typeof body.item !== 'object') {
      return NextResponse.json({ error: 'Body must include a single "item" object.' }, { status: 400 });
    }

    // Normalize
    const norm = normalizeRetailItem(body.item);
    // Folder by TDSP (if provided) or fallback to 'unknown'
    const tdspFolder = slugify(body.tdsp || norm.meta.tdsp || 'unknown');
    const keyBase =
      body.keyOverride ||
      slugify(
        [
          norm.meta.display_name || norm.source.name || 'rate',
          norm.source.id != null ? String(norm.source.id) : '',
        ]
          .filter(Boolean)
          .join('-'),
      );

    const key = keyBase || `rate-${Date.now()}`;
    const relPath = path.posix.join('data', 'rates', tdspFolder, `${key}.json`);
    const absPath = path.join(process.cwd(), relPath);

    const result = {
      dryRun: dry,
      key,
      path: `/${relPath}`,
      rateConfig: norm,
      message: dry ? 'Preview only (set dry=0 to write file).' : 'File written.',
    };

    if (dry) {
      return NextResponse.json(result, { status: 200 });
    }

    // Ensure directory and write file
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, JSON.stringify(norm, null, 2), 'utf8');

    return NextResponse.json(result, { status: 200 });
  } catch (err: any) {
    const msg = (err?.message || 'Internal error').replace(
      /(Bearer\s+)?[A-Za-z0-9-_]{20,}/g,
      '***',
    );
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * Best-effort mapping from a Retail Rate DB record to our RateConfig.
 * We handle common patterns:
 *  - fixed monthly charges
 *  - flat ¢/kWh energy charges (optionally tiered)
 *  - time-of-use windows (if present)
 *  - pass-through/other components retained under tdsp_passthrough
 */
function normalizeRetailItem(item: any): RateConfig {
  const nowIso = new Date().toISOString();

  const id = item?.id ?? item?.tariff_id ?? item?.rate_id ?? null;
  const name = item?.name ?? item?.tariff_name ?? item?.plan_name ?? null;
  const sector = item?.sector ?? item?.customer_class ?? null;
  const effective = item?.effective_date ?? item?.effective ?? null;
  const expiration = item?.expiration_date ?? item?.expires ?? null;
  const verified_at = item?.verified_at ?? item?.last_verified ?? null;
  const utilityID = numOrNull(item?.utilityID ?? item?.utility_id ?? item?.eia_utility_id);
  const state = (item?.state || item?.service_territory || '').toString().slice(0, 2).toUpperCase() || null;
  const tdsp = (item?.tdsp || item?.utility_name || item?.utility || null) && String(item?.tdsp || item?.utility_name || item?.utility);
  const source_url = item?.source_url || item?.source || null;

  const componentsSrc = Array.isArray(item?.components)
    ? item.components
    : Array.isArray(item?.rates)
    ? item.rates
    : Array.isArray(item?.charges)
    ? item.charges
    : [];

  const components: RateComponent[] = [];
  let baseMonthly: number | null = null;

  for (const c of componentsSrc) {
    const type = (c?.type || c?.charge_type || c?.name || '').toString().toLowerCase();

    // Fixed monthly charge
    // Look for fields like fixed_charge, customer_charge, base_charge
    const fixedMonthly =
      moneyOrNull(c?.fixed_charge ?? c?.customer_charge ?? c?.base_charge ?? c?.amount_usd ?? c?.monthly_fee);
    if (fixedMonthly != null && fixedMonthly >= 0) {
      baseMonthly = (baseMonthly ?? 0) + fixedMonthly;
      components.push({
        kind: 'fixed_monthly',
        amount_usd: fixedMonthly,
        notes: c?.notes || type || null,
      });
      continue;
    }

    // Energy per kWh – cents (or dollars)
    // Common fields: per_kwh, energy_rate, rate, price
    const perKwh =
      rateToCents(
        c?.per_kwh ?? c?.energy_rate ?? c?.rate ?? c?.price ?? null,
        c?.unit || c?.units || null,
      );

    // Tier bounds (if any)
    const tier: { start_kwh?: number | null; end_kwh?: number | null } | null =
      c?.tier_start_kwh != null || c?.tier_end_kwh != null
        ? {
            start_kwh: numOrNull(c?.tier_start_kwh),
            end_kwh: numOrNull(c?.tier_end_kwh),
          }
        : null;

    // TOU window (if any)
    const tou: { label?: string | null; start_hour?: number | null; end_hour?: number | null } | null =
      c?.tou || c?.time_of_use
        ? {
            label: (c?.label || c?.tou_label || 'TOU').toString(),
            start_hour: hourOrNull(c?.start_hour ?? c?.tou?.start_hour),
            end_hour: hourOrNull(c?.end_hour ?? c?.tou?.end_hour),
          }
        : null;

    if (perKwh != null) {
      components.push({
        kind: 'flat_per_kwh',
        rate_cents_per_kwh: perKwh,
        tier,
        tou,
        notes: c?.notes || type || null,
      });
      continue;
    }

    // Daily fee?
    const perDay = moneyOrNull(c?.per_day ?? c?.daily_fee ?? c?.meter_charge_per_day);
    if (perDay != null) {
      components.push({
        kind: 'per_day',
        amount_usd_per_day: perDay,
        notes: c?.notes || type || null,
      });
      continue;
    }

    // Anything else: keep as pass-through for future handling
    components.push({
      kind: 'tdsp_passthrough',
      label: c?.name || c?.type || 'component',
      details: c,
    });
  }

  const display_name =
    name ||
    [
      item?.utility_name || item?.tdsp || 'TX Utility',
      sector ? `(${sector})` : '',
      effective ? `@ ${toISODate(effective)}` : '',
    ]
      .filter(Boolean)
      .join(' ');

  return {
    schema: 'intelliwatt.rate.v1',
    key: slugify(`${display_name}-${id ?? 'rate'}`),
    source: {
      provider: 'wattbuy.retail-rate-db',
      received_at: nowIso,
      id,
      name,
      utilityID,
      verified_at,
      raw: item,
    },
    meta: {
      display_name,
      sector,
      effective: toISODate(effective),
      expiration: toISODate(expiration),
      state,
      tdsp: tdsp || null,
      eia_utility_id: utilityID ?? null,
      source_url,
    },
    pricing: {
      base_monthly_usd: baseMonthly,
      components,
    },
  };
}

// ----------------- helpers -----------------

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
    .slice(0, 96);
}

function toISODate(d: any): string | null {
  if (!d) return null;
  const t = typeof d === 'number' ? d * (d < 10_000_000_000 ? 1000 : 1) : d;
  const dt = new Date(t);
  return isNaN(dt.valueOf()) ? null : dt.toISOString().slice(0, 10);
}

function numOrNull(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function moneyOrNull(v: any): number | null {
  // Accept numbers, "$x.yz", or cents (if clearly marked)
  if (v == null) return null;
  if (typeof v === 'string') {
    const m = v.match(/^\s*\$?\s*([0-9]+(?:\.[0-9]+)?)\s*$/);
    if (m) return Number(m[1]);
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function rateToCents(v: any, unit?: string | null): number | null {
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;

  const u = (unit || '').toString().toLowerCase().trim();
  // Common cases:
  //  - if unit is '/kwh' or 'usd/kwh' -> dollars per kWh -> convert to ¢/kWh
  //  - if unit is 'cents/kwh' -> already ¢/kWh
  //  - if unit missing -> guess: if n < 1 treat as $/kWh; if n >= 1 and < 100 treat as ¢/kWh
  if (u.includes('cent') && u.includes('kwh')) return n; // ¢/kWh
  if (u.includes('usd') || u.includes('$') || u.includes('/kwh')) return Math.round(n * 100 * 1000) / 1000;

  // heuristic fallback
  if (n < 1) return Math.round(n * 100 * 1000) / 1000; // $/kWh -> ¢/kWh
  if (n <= 100) return n; // assume ¢/kWh
  return null;
}

function hourOrNull(v: any): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (n < 0 || n >= 24) return null;
  return Math.floor(n);
}
