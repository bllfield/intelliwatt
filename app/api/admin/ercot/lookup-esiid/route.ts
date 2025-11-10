import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

function requireAdmin(req: NextRequest) {
  const token = req.headers.get('x-admin-token') || '';
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) throw new Error('UNAUTHORIZED');
}

function norm(s?: string | null) {
  return (s || '').trim().toLowerCase();
}

export async function GET(req: NextRequest) {
  try {
    requireAdmin(req);
    const line1 = norm(req.nextUrl.searchParams.get('line1'));
    const city = norm(req.nextUrl.searchParams.get('city'));
    const state = norm(req.nextUrl.searchParams.get('state'));
    const zip = norm(req.nextUrl.searchParams.get('zip'));

    if (!line1 || !state || !zip) {
      return NextResponse.json({ ok: false, error: 'REQUIRED: line1,state,zip' }, { status: 400 });
    }

    const hit = await prisma.ercotEsiidIndex.findFirst({
      where: {
        serviceState: state,
        serviceZip: zip,
        serviceAddress1: { contains: line1, mode: 'insensitive' },
        serviceCity: city ? { equals: city } : undefined,
      },
      orderBy: { postedAtUtc: 'desc' },
    });

    return NextResponse.json({ ok: true, match: !!hit, esiid: hit?.esiid || null, hit });
  } catch (err: any) {
    const msg = err?.message || String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: msg === 'UNAUTHORIZED' ? 401 : 500 });
  }
}

