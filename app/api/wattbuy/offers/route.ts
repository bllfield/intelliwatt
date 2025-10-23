// app/api/wattbuy/offers/route.ts
// Step 5: Live offers proxy (uses /v3/offers)

import { NextRequest, NextResponse } from 'next/server';
import { wattbuy } from '@/lib/wattbuy';

type ByWattkey = { wattkey: string };
type ByAddress = { address: string; city: string; state: string; zip: string };
type Payload = Partial<ByWattkey & ByAddress>;

function normalizeOffer(o: any) {
  return {
    offer_id: o?.offer_id ?? o?.id ?? '',
    offer_name: o?.offer_name ?? null,
    offer_category: o?.offer_category ?? null, // expect "electricity_plans"
    link: o?.link ?? null,                     // enrollment link (redirect model)
    offer_image: o?.offer_image ?? null,
    plan_min_bill: o?.plan_min_bill ?? null,
    plan_max_bill: o?.plan_max_bill ?? null,
    cost: o?.cost ?? null,                     // blended ¢/kWh estimate
    form: o?.form ?? false,                    // if full integration is available
    is_primary_offer: o?.is_primary_offer ?? undefined,
    offer_data: o?.offer_data ?? {},           // contains supplier, term, kwh500/1000/2000, efl/tos/yrac, tdsp, etc.
  };
}

function extractElectricityOffers(raw: any): any[] {
  const out: any[] = [];
  const pushIfPlan = (arr: any[]) => arr?.forEach?.(o => {
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
        { error: 'Provide wattkey OR address+city+state+zip' },
        { status: 400 }
      );
    }

    const params = hasWattkey
      ? { wattkey: body.wattkey! }
      : { address: body.address!, city: body.city!, state: body.state!, zip: body.zip! };

    const raw: any = await wattbuy.offers(params);

    const offers = extractElectricityOffers(raw);
    const payload = {
      status: raw?.status ?? 'ok',
      count: offers.length,
      no_offers: offers.length === 0,
      offers,
    };

    return NextResponse.json(payload);
  } catch (e: any) {
    const message = typeof e?.message === 'string' ? e.message : 'offers lookup failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
