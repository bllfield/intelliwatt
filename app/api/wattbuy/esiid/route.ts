// app/api/wattbuy/esiid/route.ts
// Step 3: ESIID lookup proxy (uses /v3/electricity/info/esi)

import { NextRequest, NextResponse } from 'next/server';
import { wattbuy } from '@/lib/wattbuy';

type AddressPayload = {
  address: string;
  city: string;
  state: string;
  zip: string;
};

export async function POST(req: NextRequest) {
  try {
    const { address, city, state, zip } = (await req.json()) as Partial<AddressPayload>;

    if (!address || !city || !state || !zip) {
      return NextResponse.json(
        { error: 'address, city, state, zip required' },
        { status: 400 }
      );
    }

    const data: any = await wattbuy.esiidByAddress(address, city, state, zip);

    // Normalize the most useful fields for your frontend/runtime
    const first = Array.isArray(data?.addresses) ? data.addresses[0] : null;
    const normalized = first
      ? {
          esiid: first.esiid,
          wattkey: first.wattkey,
          utility: first.utility,                // tdsp slug (e.g., "oncor")
          utility_name: first.utility_name,      // "Oncor Electric Delivery"
          preferred_name: first.preferred_name,  // "Oncor"
          plans_available: !!first.plans_available,
          exact_match: !!data?.exact_match,
        }
      : null;

    return NextResponse.json({ ...data, normalized });
  } catch (e: any) {
    // Forward a helpful error while hiding secrets
    const message =
      typeof e?.message === 'string' ? e.message : 'esiid lookup failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
