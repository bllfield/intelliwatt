// app/api/admin/rates/refresh/route.ts
// Step 20: Nightly rates discovery + EFL refresh (Texas)
// Pull current WattBuy offers across TX TDSPs using representative addresses,
// upsert RateConfig via EFL fetch/parse, and maintain OfferRateMap.
//
// How to use (manual trigger):
//   POST /api/admin/rates/refresh
//   Body (JSON) optional:
//     {
//       "tdsp": ["oncor","centerpoint","aep_north","aep_central","tnmp"], // subset ok
//       "force": false,                   // re-parse EFL even if hash unchanged
//       "limit": 200,                     // cap offers processed
//       "addresses": {                    // override or add addresses per TDSP
//         "oncor": [{ "address":"8808 Las Vegas Ct", "city":"White Settlement", "zip":"76108" }]
//       }
//     }
//
// Production tip (Vercel Cron):
//   Add a daily cron hitting this route (no body) to keep RateConfig fresh.
//
// Requirements:
// - WATTBUY_API_KEY must be set
// - lib/wattbuy.ts must export `getOffers` and (optionally) `lookupEsiByAddress`
// - Steps 16–19 in place (EFL fetch/parse + upsert)

import { NextRequest, NextResponse } from 'next/server';
import { upsertRatesFromOffers } from '@/lib/rates/upsert';
import { wattbuy } from '@/lib/wattbuy';

type Addr = { address: string; city: string; state?: string; zip: string };

// Representative addresses per TDSP (safe public test addresses; replace with your own if desired)
const DEFAULT_TX_ADDRESSES: Record<string, Addr[]> = {
  oncor: [
    { address: '8808 Las Vegas Ct', city: 'White Settlement', state: 'TX', zip: '76108' },
    { address: '3500 Maple Ave', city: 'Dallas', state: 'TX', zip: '75219' },
  ],
  centerpoint: [
    { address: '901 Bagby St', city: 'Houston', state: 'TX', zip: '77002' },
    { address: '1500 McKinney St', city: 'Houston', state: 'TX', zip: '77010' },
  ],
  aep_north: [
    { address: '400 W 3rd St', city: 'Abilene', state: 'TX', zip: '79601' },
  ],
  aep_central: [
    { address: '1201 Leopard St', city: 'Corpus Christi', state: 'TX', zip: '78401' },
  ],
  tnmp: [
    { address: '3900 N 10th St', city: 'McAllen', state: 'TX', zip: '78501' },
  ],
};

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      tdsp?: string[];
      force?: boolean;
      limit?: number;
      addresses?: Record<string, Addr[]>;
    };

    const tdspRequested = normArr(body.tdsp);
    const limit = toInt(body.limit) ?? 250;
    const force = !!body.force;

    // Build target TDSP list
    const allTdsp = Object.keys(DEFAULT_TX_ADDRESSES);
    const tdspList = tdspRequested.length ? tdspRequested : allTdsp;

    // Merge overrides
    const addrBook: Record<string, Addr[]> = { ...DEFAULT_TX_ADDRESSES };
    if (body.addresses) {
      for (const [k, v] of Object.entries(body.addresses)) {
        if (!Array.isArray(v) || !v.length) continue;
        addrBook[k] = v.map((a) => ({ ...a, state: a.state || 'TX' }));
      }
    }

    // 1) Discover active offers by querying each TDSP with a few addresses
    const seen = new Map<string, any>(); // offer_id → offer
    const byTdsp: Record<string, { addressesTried: number; offersFound: number }> = {};

    for (const tdsp of tdspList) {
      const addrs = addrBook[tdsp] || [];
      byTdsp[tdsp] = { addressesTried: 0, offersFound: 0 };

      for (const a of addrs) {
        byTdsp[tdsp].addressesTried++;

        // Prefer direct address query; if 0 offers, attempt wattkey lookup fallback
        const offers1 = await wattbuy.offers({
          address: a.address,
          city: a.city,
          state: a.state || 'TX',
          zip: a.zip,
        }).catch(() => null);

        let offers = Array.isArray(offers1) ? offers1 : [];

        if (!offers.length) {
          // fallback: lookup wattkey/esiid, then query offers by wattkey
          const info = await wattbuy.esiidByAddress(
            a.address,
            a.city,
            a.state || 'TX',
            a.zip
          ).catch(() => null);

          const wattkey = info?.addresses?.[0]?.wattkey;
          if (wattkey) {
            const offers2 = await wattbuy.offers({ wattkey }).catch(() => null);
            const alt = Array.isArray(offers2) ? offers2 : [];
            if (alt.length) offers = alt;
          }
        }

        for (const o of offers) {
          if (!o?.offer_id) continue;
          if (!seen.has(o.offer_id)) {
            seen.set(o.offer_id, o);
            byTdsp[tdsp].offersFound++;
          }
        }

        // Early stop if we have plenty from this TDSP
        if (byTdsp[tdsp].offersFound >= limit) break;
      }
    }

    const offersArr = Array.from(seen.values());
    if (!offersArr.length) {
      return NextResponse.json(
        { ok: false, message: 'No offers discovered. Check addresses or WattBuy credentials.', byTdsp },
        { status: 502 }
      );
    }

    // 2) Upsert rates (fetch/parse EFLs) with modest concurrency
    const results = await upsertRatesFromOffers(offersArr, { force, concurrency: 3 });

    const summary = summarize(results);

    return NextResponse.json({
      ok: true,
      force,
      tdspProcessed: tdspList,
      totals: {
        offersDiscovered: offersArr.length,
        rateUpsertsOk: summary.okCount,
        rateUpsertsErr: summary.errCount,
        updatedCount: summary.updatedCount,
      },
      byTdsp,
      errors: summary.errors.slice(0, 25), // cap errors in response
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Refresh failed.' }, { status: 500 });
  }
}

// -------- helpers --------
function normArr(v: unknown): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map((s) => String(s).trim().toLowerCase()).filter(Boolean);
  return String(v).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}
function toInt(v: any) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : undefined;
}
function summarize(results: Array<{ ok: boolean; updated?: boolean; error?: string }>) {
  let okCount = 0;
  let errCount = 0;
  let updatedCount = 0;
  const errors: string[] = [];
  for (const r of results) {
    if (r.ok) {
      okCount++;
      if (r.updated) updatedCount++;
    } else {
      errCount++;
      if (r.error) errors.push(r.error);
    }
  }
  return { okCount, errCount, updatedCount, errors };
}
