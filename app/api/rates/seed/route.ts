// app/api/rates/seed/route.ts
// Step 39: Seed a local Rate JSON from a WattBuy offer (admin-only)
// -----------------------------------------------------------------
// What it does
//   - Accepts a single WattBuy offer payload (as returned by /v3/offers).
//   - Builds a normalized RateConfig skeleton (see lib/rates/store.ts).
//   - Writes it to /data/rates/<tdspSlug>/<supplierSlug>-<planIdOrSlug>.json
//   - Returns the derived key, file path, and file contents.
//
// Why
//   - Lets you quickly scaffold local, structured rate files so the calculator
//     can use exact tiers/credits later (once you parse EFLs or hand-enter).
//
// Auth
//   - Set ADMIN_SEED_TOKEN in your env and pass header:  x-seed-token: <token>
//   - Optional ?dry=1 to preview without writing.
//
// Example (preview only):
//   curl -s -X POST "http://localhost:3000/api/rates/seed?dry=1" \
//     -H "content-type: application/json" \
//     -H "x-seed-token: $ADMIN_SEED_TOKEN" \
//     -d '{ "offer": { ... one item from /v3/offers ... } }'
//
// Example (write to disk):
//   curl -s -X POST "http://localhost:3000/api/rates/seed" \
//     -H "content-type: application/json" \
//     -H "x-seed-token: $ADMIN_SEED_TOKEN" \
//     -d @offer.json
//
// Notes
//   - Requires server runtime (fs). Do NOT deploy as edge.
//   - Safe to run in Cursor Devbox; files will appear under /data/rates/...
//   - See lib/rates/store.ts for RateConfig fields.

import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SeedBody = {
  offer: any; // raw WattBuy offer object
};

export async function POST(req: NextRequest) {
  try {
    // --- auth
    const hdrToken = req.headers.get('x-seed-token') || '';
    const envToken = process.env.ADMIN_SEED_TOKEN || '';
    if (!envToken || hdrToken !== envToken) {
      return NextResponse.json({ error: 'Unauthorized (seed token missing or invalid).' }, { status: 401 });
    }

    // --- read/validate
    const body = (await req.json()) as Partial<SeedBody>;
    if (!body || !body.offer) {
      return NextResponse.json({ error: 'Missing { offer } payload.' }, { status: 400 });
    }
    const offer = body.offer;
    const dry = (req.nextUrl.searchParams.get('dry') || '').toLowerCase() === '1';

    // --- convert to RateConfig skeleton
    const rc = toRateSeed(offer);

    if (!rc.tdspSlug) {
      return NextResponse.json({ error: 'Could not derive TDSP/utility from offer.' }, { status: 400 });
    }
    if (!rc.supplierSlug) {
      return NextResponse.json({ error: 'Could not derive supplier from offer.' }, { status: 400 });
    }
    if (!rc.planId && !rc.planName) {
      return NextResponse.json({ error: 'Offer missing plan_id and offer_name; cannot create filename.' }, { status: 400 });
    }

    const fileName = `${rc.supplierSlug}-${(rc.planId || slug(rc.planName!)).toLowerCase()}.json`;
    const dir = path.join(process.cwd(), 'data', 'rates', rc.tdspSlug);
    const filePath = path.join(dir, fileName);

    const pretty = JSON.stringify(rc, null, 2) + '\n';

    if (!dry) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, pretty, 'utf8');
    }

    return NextResponse.json(
      {
        dryRun: dry,
        key: rc.key,
        path: `/data/rates/${rc.tdspSlug}/${fileName}`,
        rateConfig: rc,
        message: dry ? 'Preview only (no file written).' : 'Seed file written.',
      },
      { status: 200 }
    );
  } catch (err: any) {
    const msg = String(err?.message || err || 'Internal error').replace(/(Bearer\s+)?[A-Za-z0-9-_]{20,}/g, '***');
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ---------------- helpers ----------------

function toRateSeed(offer: any) {
  const od = offer?.offer_data || {};
  const supplierSlug = normalizeSupplier(od.supplier || od.supplier_name || offer?.supplier);
  const supplierName = od.supplier_name || offer?.supplier_name || unslug(supplierSlug);
  const tdspSlug = normalizeTdsp(od.utility || od.utility_name || offer?.utility);
  const planId = toStr(od.plan_id);
  const planName = offer?.offer_name || null;
  const termMonths = toNum(od.term);

  const key = [supplierSlug, tdspSlug, planId || slug(planName || '')].filter(Boolean).join(':');

  const avg500 = toNum(od.kwh500);
  const avg1000 = toNum(od.kwh1000);
  const avg2000 = toNum(od.kwh2000);

  const now = new Date().toISOString();

  return {
    key,
    supplierSlug,
    supplierName,
    planId: planId || null,
    planName,
    termMonths: termMonths ?? null,
    tdspSlug,

    // Leave these null for now — you'll fill them from EFL parser or by hand:
    baseMonthlyFeeCents: null,
    tduDeliveryCentsPerKwh: null,
    centsPerKwhJson: null as any, // e.g. [{ upToKwh: 500, rateCents: 12.5 }, ...]
    billCreditsJson: null as any, // e.g. [{ thresholdKwh: 1000, creditCents: 12500 }]

    // Optional TOU windows, if applicable
    touWindowsJson: null as any,

    // Fallback averages (kept for cross-checks)
    avgPrice500: isFiniteNum(avg500) ? avg500 : null,
    avgPrice1000: isFiniteNum(avg1000) ? avg1000 : null,
    avgPrice2000: isFiniteNum(avg2000) ? avg2000 : null,

    links: {
      efl: od.efl || null,
      tos: od.tos || null,
      yrac: od.yrac || null,
    },

    notes: [
      `Seeded from WattBuy offer ${offer?.offer_id || 'n/a'} on ${now}`,
      'Fill centsPerKwhJson / billCreditsJson from EFL.',
    ],
  };
}

function normalizeSupplier(s: any): string | null {
  const x = toStr(s).toLowerCase();
  if (!x) return null;
  if (x.includes('gexa')) return 'gexa';
  if (x.includes('frontier')) return 'frontier';
  if (x.includes('champion')) return 'champion';
  if (x.includes('chariot')) return 'chariot';
  if (x.includes('payless')) return 'payless';
  return slug(x);
}

function normalizeTdsp(s: any): string | null {
  const x = toStr(s).toLowerCase();
  if (!x) return null;
  if (x.includes('oncor')) return 'oncor';
  if (x.includes('centerpoint')) return 'centerpoint';
  if (x.includes('aep') && x.includes('north')) return 'aep_n';
  if (x.includes('aep') && (x.includes('central') || x.includes('south'))) return 'aep_c';
  if (x.includes('tnmp') || x.includes('texas new mexico')) return 'tnmp';
  return slug(x);
}

function slug(s: string): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
    .replace(/--+/g, '-');
}

function unslug(s: string | null): string | null {
  if (!s) return s;
  return s
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function toStr(v: any): string {
  if (v == null) return '';
  return String(v).trim();
}
function toNum(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function isFiniteNum(n: any): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}
