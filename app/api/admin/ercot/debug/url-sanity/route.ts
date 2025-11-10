import { NextResponse } from 'next/server';
import { resolveLatestFromPage } from '@/lib/ercot/resolve';

export const dynamic = 'force-dynamic';

export async function GET() {
  const pageUrl = process.env.ERCOT_PAGE_URL;
  if (!pageUrl) return NextResponse.json({ ok: false, error: 'MISSING_ERCOT_PAGE_URL' }, { status: 500 });
  const candidates = await resolveLatestFromPage(pageUrl);
  return NextResponse.json({ ok: true, pageUrl, candidates });
}

