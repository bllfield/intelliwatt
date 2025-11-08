import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function requireAdmin(req: NextRequest) {
  const expected = process.env.ADMIN_TOKEN || '';
  const token = req.headers.get('x-admin-token') || '';
  if (!expected || token !== expected) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  return null;
}

/**
 * GET /api/admin/offers/recent
 * Token-gated (x-admin-token) recent WattBuy offer snapshots persisted on HouseAddress.
 *
 * Query params:
 * - zip5?=NNNNN        -> filters `addressZip5`
 * - dateStart?=ISO     -> lower bound (inclusive) on `updatedAt`
 * - dateEnd?=ISO       -> upper bound (exclusive) on `updatedAt`
 * - limit?=1..200      -> max rows (default 50)
 */
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

  // Base filter: only rows that actually have a saved WattBuy payload
  const where: any = {
    rawWattbuyJson: { not: null },
  };

  if (rawZip) {
    where.addressZip5 = rawZip;
  }

  if (gte || lt) {
    where.updatedAt = {};
    if (gte) where.updatedAt.gte = gte;
    if (lt) where.updatedAt.lt = lt;
  }

  try {
    const rows = await prisma.houseAddress.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        houseId: true,
        addressLine1: true,
        addressCity: true,
        addressState: true,
        addressZip5: true,
        updatedAt: true,
        rawWattbuyJson: true,
      },
    });

    return NextResponse.json({ ok: true, rows });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 }
    );
  }
}

