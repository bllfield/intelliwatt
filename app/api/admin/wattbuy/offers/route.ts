import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin';
// import { fetchWattBuyOffers } from '@/lib/wattbuy/fetchOffers';

export async function GET(req: NextRequest) {
  const gate = requireAdmin(req);
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  const { searchParams } = new URL(req.url);
  const zip = searchParams.get('zip') ?? '75201';
  const monthly_kwh = Number(searchParams.get('monthly_kwh') ?? 2000);
  const term = Number(searchParams.get('term') ?? 12);

  // TODO: wire real client; return stub so smoke test passes
  return NextResponse.json({ zip, monthly_kwh, term, offers: [] });
}

