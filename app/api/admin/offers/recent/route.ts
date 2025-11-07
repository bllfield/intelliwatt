import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/db';

function requireAdmin(req: NextRequest) {
  const expected = process.env.ADMIN_TOKEN || '';
  const token = req.headers.get('x-admin-token') || '';
  if (!expected || token !== expected) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  return null;
}

export async function GET(req: NextRequest) {
  const guard = requireAdmin(req);
  if (guard) return guard;

  const sp = req.nextUrl.searchParams;
  const rawZip = sp.get('zip5')?.trim();
  const rawStart = sp.get('dateStart');
  const rawEnd = sp.get('dateEnd');
  const rawLimit = sp.get('limit');

  let gte: Date | undefined;
  let lt: Date | undefined;
  let limit = 50;

  if (rawLimit) {
    const n = Number(rawLimit);
    if (Number.isFinite(n)) limit = Math.max(1, Math.min(200, Math.trunc(n)));
  }
  if (rawStart) {
    const d = new Date(rawStart);
    if (!Number.isNaN(d.valueOf())) gte = d;
  }
  if (rawEnd) {
    const d = new Date(rawEnd);
    if (!Number.isNaN(d.valueOf())) lt = d;
  }

  const where: any = {};
  if (rawZip) where.zip5 = rawZip;
  if (gte || lt) {
    where.createdAt = {};
    if (gte) where.createdAt.gte = gte;
    if (lt) where.createdAt.lt = lt;
  }

  try {
    const rows = await prisma.rawWattbuyOffer.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      // adjust select if needed to trim payload
    });

    return NextResponse.json({ ok: true, rows });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 }
    );
  }
}
