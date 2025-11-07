import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function requireAdmin(req: NextRequest) {
  const token = req.headers.get('x-admin-token') || '';
  const expected = process.env.ADMIN_TOKEN || '';
  if (!expected || token !== expected) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  return null;
}

export async function GET(req: NextRequest) {
  const guard = requireAdmin(req);
  if (guard) return guard;

  const sp = req.nextUrl.searchParams;
  const rawStatus = sp.get('status');
  const rawTdsp = sp.get('tdsp');

  const where: any = {};
  if (rawStatus && rawStatus.trim()) where.status = rawStatus.trim();
  if (rawTdsp && rawTdsp.trim()) where.tdsp = rawTdsp.trim();

  try {
    const ingestModel = (prisma as any).ercotIngestLog;
    const row = ingestModel
      ? await ingestModel.findFirst({
          where,
          orderBy: { finishedAt: 'desc' },
        })
      : null;
    return NextResponse.json({ ok: true, row }
    );
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
}
