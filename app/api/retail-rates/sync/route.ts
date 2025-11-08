// app/api/retail-rates/sync/route.ts
// Step 47: Batch sync Retail Rate DB → local /data/rates (multi-page, TX TDSPs)
// -----------------------------------------------------------------------------
// What it does
//   - Loops through WattBuy Retail Rate DB pages for a TX TDSP (or EIA utility_id).
//   - Normalizes each item into our RateConfig and (optionally) writes JSON files.
//   - Returns a full summary: fetched pages, counts, errors, and preview of first few outputs.
//
// Why
//   - Quickly ingest/refresh a whole utility's residential tariffs for evaluation vs. EFL scraping.
//
// Usage (POST recommended)
//   curl -X POST '/api/retail-rates/sync?dry=1' \
//     -H 'x-seed-token: <ADMIN_SEED_TOKEN>' -H 'content-type: application/json' \
//     -d '{ "tdsp": "oncor", "verified_from": "2024-01-01", "maxPages": 10 }'
//
// Or with utility_id (EIA):
//   curl -X POST '/api/retail-rates/sync?dry=0' \
//     -H 'x-seed-token: <ADMIN_SEED_TOKEN>' -H 'content-type: application/json' \
//     -d '{ "utility_id": 44372, "maxPages": 5 }'
//
// Env
//   - WATTBUY_API_KEY
//   - ADMIN_SEED_TOKEN
//
// Notes
//   - Default dry-run to protect filesystem.
//   - TX-only guard (state=TX).
//   - Schema variance is handled defensively (like Step 45).
//   - Files write to: /data/rates/<tdsp>/<slug>-<id>.json

import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import { wbGet } from '@/lib/wattbuy/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SyncBody = {
  tdsp?: 'oncor' | 'centerpoint' | 'aep_n' | 'aep_c' | 'tnmp' | string;
  utility_id?: number;
  verified_from?: number | string; // epoch seconds or ISO
  maxPages?: number; // default 10
  state?: 'TX' | string; // default TX
  // Optional filter (future): sector='residential' etc.
};

const TDSP_TO_EIA: Record<string, number> = {
  oncor: 44372,
  centerpoint: 8901,
  aep_n: 20404,
  aep_c: 3278,
  tnmp: 40051,
};

export async function POST(req: NextRequest) {
  try {
    // ---- auth
    const token = req.headers.get('x-seed-token')?.trim();
    if (!token || token !== process.env.ADMIN_SEED_TOKEN) {
      return NextResponse.json({ error: 'Unauthorized (invalid seed token).' }, { status: 401 });
    }
    if (!process.env.WATTBUY_API_KEY) {
      return NextResponse.json({ error: 'WATTBUY_API_KEY not configured on server.' }, { status: 500 });
    }

    // ---- input
    const url = new URL(req.url);
    const dry = url.searchParams.get('dry') !== '0'; // default dry-run

    const bodyText = await req.text();
    let body: SyncBody = {};
    try {
      body = bodyText ? JSON.parse(bodyText) : {};
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
    }

    const state = (body.state || 'TX').toUpperCase();
    if (state !== 'TX') {
      return NextResponse.json({ error: 'This sync endpoint is TX-only.' }, { status: 400 });
    }

    // Resolve utility_id from tdsp if needed
    let utilityID: number | null = null;
    let tdspFolder = (body.tdsp || '').toLowerCase().trim() || null;

    if (typeof body.utility_id === 'number' && Number.isFinite(body.utility_id)) {
      utilityID = body.utility_id;
      if (!tdspFolder) tdspFolder = eiaToTdsp(utilityID);
    } else if (tdspFolder) {
      const mapped = TDSP_TO_EIA[tdspFolder];
      if (!mapped) {
        return NextResponse.json(
          { error: `Unknown tdsp "${tdspFolder}". Use one of: ${Object.keys(TDSP_TO_EIA).join(', ')}` },
          { status: 400 }
        );
      }
      utilityID = mapped;
    } else {
      return NextResponse.json(
        { error: 'Provide either "tdsp" (oncor|centerpoint|aep_n|aep_c|tnmp) or "utility_id" (EIA).' },
        { status: 400 }
      );
    }

    // verified_from normalization → epoch seconds
    let verified_from: number | undefined = undefined;
    if (body.verified_from != null) {
      if (typeof body.verified_from === 'number') {
        verified_from = Math.floor(body.verified_from);
      } else {
        const d = new Date(body.verified_from);
        if (!isNaN(d.valueOf())) {
          verified_from = Math.floor(d.getTime() / 1000);
        } else {
          return NextResponse.json(
            { error: 'verified_from must be epoch seconds or a valid date string (e.g., 2024-01-01).' },
            { status: 400 }
          );
        }
      }
    }

    const maxPages = Math.max(1, Math.min(100, Number(body.maxPages || 10)));

    // ---- fetch loop
    const summary = {
      query: { tdsp: tdspFolder, utility_id: utilityID, state, verified_from: verified_from ?? null, maxPages, dryRun: dry },
      pagesFetched: 0,
      totalItems: 0,
      written: 0,
      skipped: 0,
      errors: [] as { page: number; message: string }[],
      previews: [] as any[], // first few RateConfigs for UI
      paths: [] as string[],
    };

    for (let page = 1; page <= maxPages; page++) {
      const { ok, items, upstreamStatus, upstreamError } = await fetchRetailRatesPage({
        utility_id: utilityID!,
        state,
        page,
        verified_from,
      });

      if (!ok) {
        // Stop on hard error; some utilities return 204 "No Content" when empty
        if (upstreamStatus === 204) break;
        summary.errors.push({ page, message: upstreamError || `Upstream status ${upstreamStatus}` });
        break;
      }

      const count = items.length;
      if (count === 0) break; // no more results
      summary.pagesFetched++;
      summary.totalItems += count;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];

        // Normalize
        const norm = normalizeRetailItem(item);

        // Determine folder and file path
        const tdsp = slugify(tdspFolder || guessTdspFromItem(item) || 'unknown');
        const key = norm.key || slugify(`${norm.meta.display_name || 'rate'}-${norm.source.id ?? 'id'}`);
        const relPath = path.posix.join('data', 'rates', tdsp, `${key}.json`);
        const absPath = path.join(process.cwd(), relPath);

        // Collect preview of first 5
        if (summary.previews.length < 5) summary.previews.push(norm);

        // Write or dry-run
        try {
          if (!dry) {
            await fs.mkdir(path.dirname(absPath), { recursive: true });
            await fs.writeFile(absPath, JSON.stringify(norm, null, 2), 'utf8');
          }
          summary.written++;
          summary.paths.push(`/${relPath}`);
        } catch (e: any) {
          summary.skipped++;
          summary.errors.push({ page, message: `Write failed for ${relPath}: ${e?.message || e}` });
        }
      }

      // Small politeness delay to avoid hammering upstream
      await sleep(150);
    }

    return NextResponse.json(summary, { status: 200 });
  } catch (err: any) {
    const msg = (err?.message || 'Internal error').replace(/(Bearer\s+)?[A-Za-z0-9-_]{20,}/g, '***');
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ----------------- helpers -----------------

async function fetchRetailRatesPage(opts: {
  utility_id: number;
  state: string;
  page: number;
  verified_from?: number;
}): Promise<{ ok: boolean; items: any[]; upstreamStatus: number; upstreamError?: string }> {
  // Use wbGet (clean headers, no internal header forwarding)
  const params: Record<string, unknown> = {
    utility_id: String(opts.utility_id),
    state: opts.state,
    page: String(opts.page),
  };
  if (opts.verified_from != null) params.verified_from = String(opts.verified_from);

  const result = await wbGet('electricity/retail-rates', params);

  if (!result.ok) {
    if (result.status === 204) {
      return { ok: false, items: [], upstreamStatus: 204 };
    }
    return {
      ok: false,
      items: [],
      upstreamStatus: result.status,
      upstreamError: result.text || 'Upstream error',
    };
  }

  const json = result.data;
  const status = result.status;

  // result.ok is already checked above, so we can proceed
  const items = extractItems(json);
  return { ok: true, items, upstreamStatus: status };
}

function extractItems(json: any): any[] {
  // Try common containers
  if (Array.isArray(json?.results)) return json.results;
  if (Array.isArray(json?.data)) return json.data;
  if (Array.isArray(json?.items)) return json.items;
  if (Array.isArray(json)) return json;
  // Try to locate first array value in object
  for (const v of Object.values(json || {})) {
    if (Array.isArray(v)) return v;
  }
  return [];
}

function guessTdspFromItem(item: any): string | null {
  const u = (item?.utility_name || item?.tdsp || item?.utility || '').toString().toLowerCase();
  if (!u) return null;
  if (u.includes('oncor')) return 'oncor';
  if (u.includes('centerpoint')) return 'centerpoint';
  if (u.includes('aep') && u.includes('north')) return 'aep_n';
  if (u.includes('aep') && (u.includes('central') || u.includes('cpl'))) return 'aep_c';
  if (u.includes('texas new mexico power') || u.includes('tnmp')) return 'tnmp';
  return null;
}

function eiaToTdsp(eia: number): string | null {
  for (const [k, v] of Object.entries(TDSP_TO_EIA)) if (v === eia) return k;
  return null;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function safeJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '').slice(0, 96);
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
  if (u.includes('cent') && u.includes('kwh')) return n; // ¢/kWh
  if (u.includes('usd') || u.includes('$') || u.includes('/kwh')) return Math.round(n * 100 * 1000) / 1000;

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
    received_at: string;
    id?: string | number | null;
    name?: string | null;
    utility_id?: number | null;
    verified_at?: string | null;
    raw: any;
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

function normalizeRetailItem(item: any): RateConfig {
  const nowIso = new Date().toISOString();

  const id = item?.id ?? item?.tariff_id ?? item?.rate_id ?? null;
  const name = item?.name ?? item?.tariff_name ?? item?.plan_name ?? null;
  const sector = item?.sector ?? item?.customer_class ?? null;
  const effective = item?.effective_date ?? item?.effective ?? null;
  const expiration = item?.expiration_date ?? item?.expires ?? null;
  const verified_at = item?.verified_at ?? item?.last_verified ?? null;
  const utilityID = numOrNull(item?.utility_id ?? item?.eia_utility_id);
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

    const perKwh = rateToCents(c?.per_kwh ?? c?.energy_rate ?? c?.rate ?? c?.price ?? null, c?.unit || c?.units || null);

    const tier =
      c?.tier_start_kwh != null || c?.tier_end_kwh != null
        ? {
            start_kwh: numOrNull(c?.tier_start_kwh),
            end_kwh: numOrNull(c?.tier_end_kwh),
          }
        : null;

    const tou =
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

    const perDay = moneyOrNull(c?.per_day ?? c?.daily_fee ?? c?.meter_charge_per_day);
    if (perDay != null) {
      components.push({
        kind: 'per_day',
        amount_usd_per_day: perDay,
        notes: c?.notes || type || null,
      });
      continue;
    }

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
      utility_id: utilityID,
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
