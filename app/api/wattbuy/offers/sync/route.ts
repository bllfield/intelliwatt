// app/api/wattbuy/offers/sync/route.ts
// Step 8: Join live WattBuy offers to your local RateConfig, creating/updating OfferRateMap.
// Usage:
//   POST { wattkey }            -> fetch offers by wattkey, upsert mappings
//   POST { address, city, state, zip } -> fetch offers by address, upsert mappings
//   POST { offers: [...] }      -> (optional) pass offers you already fetched to upsert only
//
// Returns: { inserted, updated, totalOffers, createdRateConfigs, offersSample: [...] }

import { NextRequest, NextResponse } from 'next/server';
import { wattbuy } from '@/lib/wattbuy';
import { prisma } from '@/lib/db'; // If your prisma client is exported differently, adjust this import.

type ByWattkey = { wattkey: string };
type ByAddress = { address: string; city: string; state: string; zip: string };
type Payload = Partial<ByWattkey & ByAddress & { offers: any[] }>;

function normalizeOffer(o: any) {
  return {
    offer_id: o?.offer_id ?? o?.id ?? '',
    offer_name: o?.offer_name ?? null,
    offer_category: o?.offer_category ?? null, // "electricity_plans"
    link: o?.link ?? null,
    offer_image: o?.offer_image ?? null,
    plan_min_bill: o?.plan_min_bill ?? null,
    plan_max_bill: o?.plan_max_bill ?? null,
    cost: o?.cost ?? null,
    form: o?.form ?? false,
    is_primary_offer: o?.is_primary_offer ?? undefined,
    offer_data: o?.offer_data ?? {}, // supplier, term, kwh500/1000/2000, efl/tos/yrac, utility, etc.
  };
}

function extractElectricityOffers(raw: any): any[] {
  const out: any[] = [];
  const pushIfPlan = (arr: any[]) =>
    arr?.forEach?.((o) => {
      if (!o) return;
      if (o.offer_category === 'electricity_plans') out.push(normalizeOffer(o));
    });

  if (Array.isArray(raw)) pushIfPlan(raw);
  if (raw && typeof raw === 'object') {
    if (Array.isArray(raw.offers)) pushIfPlan(raw.offers);
    if (raw.categories?.electricity_plans) pushIfPlan(raw.categories.electricity_plans);
    if (Array.isArray(raw.results)) pushIfPlan(raw.results);
  }
  return out;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Payload;

    // 1) Decide source of offers (passed-in or fetch upstream)
    let offers: any[] = [];
    if (Array.isArray(body.offers) && body.offers.length) {
      offers = extractElectricityOffers(body.offers);
    } else {
      const hasWattkey = typeof body.wattkey === 'string' && body.wattkey.length > 0;
      const hasAddress =
        typeof body.address === 'string' &&
        typeof body.city === 'string' &&
        typeof body.state === 'string' &&
        typeof body.zip === 'string' &&
        body.address.length > 0 &&
        body.city.length > 0 &&
        body.state.length > 0 &&
        body.zip.length > 0;

      if (!hasWattkey && !hasAddress) {
        return NextResponse.json(
          { error: 'Provide wattkey OR address+city+state+zip, or pass offers[]' },
          { status: 400 }
        );
      }

      const params = hasWattkey
        ? { wattkey: body.wattkey! }
        : { address: body.address!, city: body.city!, state: body.state!, zip: body.zip! };

      const raw = await wattbuy.offers(params);
      offers = extractElectricityOffers(raw);
    }

    if (!offers.length) {
      return NextResponse.json({ totalOffers: 0, inserted: 0, updated: 0, createdRateConfigs: 0, offersSample: [] });
    }

    // 2) Upsert mappings for each offer
    let inserted = 0;
    let updated = 0;
    let createdRateConfigs = 0;

    // Process sequentially to keep logic simple and avoid too many concurrent DB writes.
    for (const o of offers) {
      const od = o.offer_data ?? {};
      const supplierSlug = String(od.supplier ?? '').toLowerCase(); // e.g., "gexa"
      const supplierName = od.supplier_name ?? null;
      const planId = od.plan_id != null ? String(od.plan_id) : null;
      const nameId = od.name_id != null ? String(od.name_id) : null;
      const tdspSlug = od.utility ?? null; // "oncor"
      const tdspName = od.utility_name ?? null;
      const eflUrl = od.efl ?? null;
      const tosUrl = od.tos ?? null;
      const yracUrl = od.yrac ?? null;
      const termMonths = od.term ?? null;
      const rateType = od.rate_type ?? (od.is_green ? 'renewable' : od.is_variable ? 'variable' : od.is_fixed ? 'fixed' : null);
      const isGreen = !!od.is_green;
      const greenPct = typeof od.green_percentage === 'number' ? od.green_percentage : null;

      // Try to find an existing RateConfig by strong keys first
      const existingRC = await prisma.rateConfig.findFirst({
        where: {
          supplierSlug,
          tdspSlug,
          ...(planId ? { planId } : {}),
          ...(nameId ? { nameId } : {}),
        },
      });

      const rateConfig = existingRC || await prisma.rateConfig.create({
          data: {
            key: `${supplierSlug}:${planId ?? 'unknown'}:${tdspSlug ?? 'unknown'}`,
            supplierSlug,
            supplierName: supplierName ?? undefined,
            planId: planId ?? undefined,
            nameId: nameId ?? undefined,
            planName: o.offer_name ?? undefined,
            tdsp: tdspName ?? undefined,
            tdspSlug: tdspSlug ?? undefined,
            termMonths: termMonths ?? undefined,
            rateType: rateType ?? undefined,
            isGreen,
            greenPct: greenPct ?? undefined,
            eflUrl: eflUrl ?? undefined,
            tosUrl: tosUrl ?? undefined,
            yracUrl: yracUrl ?? undefined,
            notes: 'Seeded from WattBuy offers sync; awaiting EFL parse.',
          },
        });

      if (!existingRC) createdRateConfigs += 1;

      // Upsert OfferRateMap keyed by offerId
      const existingMap = await prisma.offerRateMap.findUnique({
        where: { offerId: o.offer_id },
      });

      if (existingMap) {
        await prisma.offerRateMap.update({
          where: { offerId: o.offer_id },
          data: {
            rateConfigId: rateConfig.id,
            supplierSlug,
            planId: planId ?? undefined,
            nameId: nameId ?? undefined,
            tdspSlug: tdspSlug ?? undefined,
            eflUrl: eflUrl ?? undefined,
          },
        });
        updated += 1;
      } else {
        await prisma.offerRateMap.create({
          data: {
            offerId: o.offer_id,
            rateConfigId: rateConfig.id,
            supplierSlug,
            planId: planId ?? undefined,
            nameId: nameId ?? undefined,
            tdspSlug: tdspSlug ?? undefined,
            eflUrl: eflUrl ?? undefined,
          },
        });
        inserted += 1;
      }
    }

    return NextResponse.json({
      totalOffers: offers.length,
      inserted,
      updated,
      createdRateConfigs,
      offersSample: offers.slice(0, 3), // just to eyeball in dev
    });
  } catch (e: any) {
    const message = typeof e?.message === 'string' ? e.message : 'offers sync failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
