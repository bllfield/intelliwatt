// app/api/recommendations/quote/route.ts
// Step 12: Quote endpoint — merge live WattBuy availability with your parsed EFLs,
// then compute customer-specific bill estimates using SMT (if you pass intervals) or a monthly kWh.
//
// Accepts (any one of the location inputs):
//   { wattkey }
//   { address, city, state, zip }
//
// And one of the usage inputs:
//   { monthlyKwh }
//   { intervals15min: [{ ts, kwh }, ...] }  // preferred when you have SMT data
//
// Optional flags:
//   { limit?: number }            // cap number of offers processed (default 30)
//   { includeRaw?: boolean }      // include the raw WattBuy offer payload for debugging
//   { fallbackToAvg?: boolean }   // if no parsed EFL, try kwh500/1000/2000 avg ¢/kWh fallback (default true)
//
// Response:
//   {
//     addressContext: { ... },
//     usageContext: { monthlyKwh, intervalsCount },
//     offers: [
//       {
//         offerId,
//         supplier,
//         planName,
//         termMonths,
//         tdsp,
//         eflUrl,
//         est: { subtotalCents, effectiveCentsPerKwh, breakdown, notes },
//         badges: string[],
//         links: { enroll, tos?, yrac? },
//         // if includeRaw=true:
//         raw?: { offer: any }
//       },
//       ...
//     ]
//   }
//
// Hook this endpoint from your UI to display ranked plan options with YOUR calculator.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { wattbuy } from '@/lib/wattbuy';
import { estimateBill, sumIntervalsKwh, type Interval15 } from '@/lib/rates/calc';

type ByWattkey = { wattkey: string };
type ByAddress = { address: string; city: string; state: string; zip: string };

type Payload = Partial<
  ByWattkey &
    ByAddress & {
      monthlyKwh?: number;
      intervals15min?: Interval15[];
      limit?: number;
      includeRaw?: boolean;
      fallbackToAvg?: boolean;
    }
>;

function extractOffers(raw: any): any[] {
  const out: any[] = [];
  const pushIfPlan = (arr: any[]) =>
    arr?.forEach?.((o) => {
      if (o?.offer_category === 'electricity_plans') out.push(o);
    });
  if (Array.isArray(raw?.offers)) pushIfPlan(raw.offers);
  else if (Array.isArray(raw)) pushIfPlan(raw);
  else if (raw?.categories?.electricity_plans) pushIfPlan(raw.categories.electricity_plans);
  return out;
}

function nearestAvgFromOffer(o: any, monthlyKwh: number): number | null {
  const d = o?.offer_data ?? {};
  const points: Array<{ at: number; val?: number }> = [
    { at: 500, val: typeof d.kwh500 === 'number' ? d.kwh500 : undefined },
    { at: 1000, val: typeof d.kwh1000 === 'number' ? d.kwh1000 : undefined },
    { at: 2000, val: typeof d.kwh2000 === 'number' ? d.kwh2000 : undefined },
  ].filter((p) => typeof p.val === 'number') as any;
  if (!points.length) return null;
  points.sort((a, b) => Math.abs(a.at - monthlyKwh) - Math.abs(b.at - monthlyKwh));
  return points[0].val as number;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Payload;

    // Validate location
    const hasWattkey = typeof body.wattkey === 'string' && body.wattkey.length > 0;
    const hasAddress =
      typeof body.address === 'string' &&
      typeof body.city === 'string' &&
      typeof body.state === 'string' &&
      typeof body.zip === 'string' &&
      body.address!.length > 0 &&
      body.city!.length > 0 &&
      body.state!.length > 0 &&
      body.zip!.length > 0;

    if (!hasWattkey && !hasAddress) {
      return NextResponse.json(
        { error: 'Provide wattkey OR address+city+state+zip.' },
        { status: 400 }
      );
    }

    const includeRaw = !!body.includeRaw;
    const fallbackToAvg = body.fallbackToAvg ?? true;
    const limit = Math.min(Math.max(body.limit ?? 30, 1), 60);

    // Usage context
    const intervals = Array.isArray(body.intervals15min) ? body.intervals15min : undefined;
    const monthlyKwh =
      typeof body.monthlyKwh === 'number' && body.monthlyKwh > 0
        ? body.monthlyKwh
        : intervals?.length
        ? sumIntervalsKwh(intervals)
        : undefined;

    if (!monthlyKwh && !intervals?.length) {
      return NextResponse.json(
        { error: 'Provide monthlyKwh or intervals15min for a personalized quote.' },
        { status: 400 }
      );
    }

    // Fetch live offers
    const param = hasWattkey
      ? { wattkey: body.wattkey! }
      : { address: body.address!, city: body.city!, state: body.state!, zip: body.zip! };

    const raw = await wattbuy.offers(param);
    const offers = extractOffers(raw).slice(0, limit);

    if (!offers.length) {
      return NextResponse.json({
        addressContext: param,
        usageContext: { monthlyKwh: monthlyKwh ?? 0, intervalsCount: intervals?.length ?? 0 },
        offers: [],
        message: 'No electricity_plans returned for this location.',
      });
    }

    // Build quotes
    const results: Array<{
      offerId: string;
      supplier: string | null;
      planName: string | null;
      termMonths: number | null;
      tdsp: string | null;
      eflUrl: string | null;
      est: {
        subtotalCents: number;
        effectiveCentsPerKwh: number;
        breakdown: any;
        notes: string[];
      };
      badges: string[];
      links: { enroll?: string | null; tos?: string | null; yrac?: string | null };
      raw?: any;
    }> = [];

    for (const o of offers) {
      const d = o?.offer_data ?? {};
      const offerId: string = o?.offer_id ?? '';
      const supplier: string | null = d?.supplier_name ?? null;
      const supplierSlug: string | null = (d?.supplier ?? null) && String(d.supplier).toLowerCase();
      const planName: string | null = o?.offer_name ?? null;
      const termMonths: number | null = typeof d?.term === 'number' ? d.term : null;
      const tdsp: string | null = d?.utility_name ?? null;
      const tdspSlug: string | null = d?.utility ?? null;
      const eflUrl: string | null = d?.efl ?? null;

      // Find our mapping & RateConfig
      const map = await prisma.offerRateMap.findUnique({
        where: { offerId },
        select: { rateConfigId: true },
      });

      let breakdown: any | null = null;
      let subtotalCents = 0;
      let eff = 0;
      let notes: string[] = [];

      if (map?.rateConfigId) {
        const rc = await prisma.rateConfig.findUnique({ where: { id: map.rateConfigId } });
        if (rc) {
          const est = await estimateBill({
            config: rc,
            usage: {
              monthlyKwh: monthlyKwh ?? undefined,
              hours: intervals ? intervals.map(i => ({ ts: i.ts, kwh: i.kwh })) : undefined,
            },
          });
          breakdown = est.breakdown;
          subtotalCents = Math.round(est.totals.usd * 100);
          eff = monthlyKwh ? Math.round((est.totals.usd / monthlyKwh) * 100) : 0;
          notes = est.notes;
        }
      }

      // Fallback: if no parsed EFL yet, try WattBuy average rates nearest to usage
      if ((!breakdown || subtotalCents === 0) && (monthlyKwh ?? 0) > 0 && fallbackToAvg) {
        const nearest = nearestAvgFromOffer(o, monthlyKwh!); // in ¢/kWh
        if (typeof nearest === 'number') {
          const cents = Math.round(nearest * monthlyKwh!);
          breakdown = {
            energyChargeCents: cents,
            subtotalCents: cents,
            effectiveCentsPerKwh: nearest,
            notes: ['Fallback: nearest WattBuy avg ¢/kWh (kwh500/1000/2000).'],
          };
          subtotalCents = cents;
          eff = nearest;
          notes = breakdown.notes;
        }
      }

      // As a last resort, show 0 with a note.
      if (!breakdown) {
        breakdown = {
          energyChargeCents: 0,
          subtotalCents: 0,
          effectiveCentsPerKwh: 0,
          notes: ['No parsed EFL yet and no avg fallback available.'],
        };
      }

      const badges: string[] = [];
      if (d?.is_green) badges.push('100% renewable');
      if (d?.superlatives?.length) badges.push(...d.superlatives);

      results.push({
        offerId,
        supplier,
        planName,
        termMonths,
        tdsp,
        eflUrl,
        est: {
          subtotalCents,
          effectiveCentsPerKwh: eff,
          breakdown,
          notes,
        },
        badges,
        links: { enroll: o?.link ?? null, tos: d?.tos ?? null, yrac: d?.yrac ?? null },
        ...(includeRaw ? { raw: { offer: o } } : {}),
      });
    }

    // Rank by subtotal ascending (cheapest first)
    results.sort((a, b) => a.est.subtotalCents - b.est.subtotalCents);

    return NextResponse.json({
      addressContext: hasWattkey ? { wattkey: body.wattkey } : { address: body.address, city: body.city, state: body.state, zip: body.zip },
      usageContext: {
        monthlyKwh: monthlyKwh ?? 0,
        intervalsCount: intervals?.length ?? 0,
      },
      offers: results,
    });
  } catch (e: any) {
    const message = typeof e?.message === 'string' ? e.message : 'quote failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
