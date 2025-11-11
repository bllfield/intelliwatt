import { NextRequest, NextResponse } from 'next/server';
import { wbGetOffers } from '@/lib/wattbuy/client';
import { requireAdmin } from '@/lib/auth/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const gate = requireAdmin(req);
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });
  try {
    const { searchParams } = new URL(req.url);
    const address = searchParams.get('address') ?? '';
    const city = searchParams.get('city') ?? '';
    const state = searchParams.get('state') ?? '';
    const zip = searchParams.get('zip') ?? '';
    // Always request full plan set unless explicitly overridden
    const all = (searchParams.get('all') ?? 'true') === 'true';
    const language = (searchParams.get('language') as 'en' | 'es') ?? 'en';
    const is_renter = (searchParams.get('is_renter') ?? 'false') === 'true';
    const category = searchParams.get('category') ?? undefined;

    const resp = await wbGetOffers({
      address, city, state, zip, language, is_renter, all, category,
    });
    return NextResponse.json(resp, { status: resp.status });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: 'OFFERS_BY_ADDRESS_ERROR', message: err?.message }, { status: 500 });
  }
}

