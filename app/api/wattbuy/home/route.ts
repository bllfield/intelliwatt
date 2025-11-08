// app/api/wattbuy/home/route.ts
// Step 4: Home/utility details proxy (uses /v3/electricity/info)

import { NextRequest, NextResponse } from 'next/server';
import { wattbuy } from '@/lib/wattbuy';

export const dynamic = 'force-dynamic';

type ByWattkey = { wattkey: string };
type ByEsiid = { esiid: string };
type ByAddress = { address: string; city: string; state: string; zip: string };
type Payload = Partial<ByWattkey & ByEsiid & ByAddress>;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Payload;

    const hasWattkey = typeof body.wattkey === 'string' && body.wattkey.length > 0;
    const hasEsiid = typeof body.esiid === 'string' && body.esiid.length > 0;
    const hasAddress =
      typeof body.address === 'string' &&
      typeof body.city === 'string' &&
      typeof body.state === 'string' &&
      typeof body.zip === 'string' &&
      body.address.length > 0 &&
      body.city.length > 0 &&
      body.state.length > 0 &&
      body.zip.length > 0;

    if (!hasWattkey && !hasEsiid && !hasAddress) {
      return NextResponse.json(
        { error: 'Provide wattkey OR esiid OR address+city+state+zip' },
        { status: 400 }
      );
    }

    // Prefer wattkey > esiid > full address for precision
    const params = hasWattkey
      ? { wattkey: body.wattkey! }
      : hasEsiid
      ? { esiid: body.esiid! }
      : { address: body.address!, city: body.city!, state: body.state!, zip: body.zip! };

    const data = await wattbuy.homeDetails(params);

    // Some ERCOT addresses may return 204 upstream; our client returns null in that case
    if (!data) {
      return NextResponse.json(
        { error: 'No content from upstream (204). Try a different identifier (wattkey/esiid).' },
        { status: 204 }
      );
    }

    return NextResponse.json(data);
  } catch (e: any) {
    const message =
      typeof e?.message === 'string' ? e.message : 'home details lookup failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
