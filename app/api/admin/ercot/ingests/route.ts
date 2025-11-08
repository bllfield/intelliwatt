import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function jsonError(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

export async function GET(req: NextRequest) {
  if (!process.env.ADMIN_TOKEN || req.headers.get('x-admin-token') !== process.env.ADMIN_TOKEN) {
    return jsonError('Unauthorized', 401);
  }

  const searchParams = req.nextUrl.searchParams;
  const rawLimit = searchParams.get('limit');
  const rawStart = searchParams.get('dateStart');
  const rawEnd = searchParams.get('dateEnd');
  const rawStatus = searchParams.get('status');
  const rawTdsp = searchParams.get('tdsp');

  let limit = 50;
  if (rawLimit) {
    const parsed = Number(rawLimit);
    if (Number.isFinite(parsed)) {
      limit = Math.max(1, Math.min(200, Math.trunc(parsed)));
    }
  }

  let gte: Date | undefined;
  let lt: Date | undefined;
  if (rawStart) {
    const d = new Date(rawStart);
    if (!Number.isNaN(d.valueOf())) gte = d;
  }
  if (rawEnd) {
    const d = new Date(rawEnd);
    if (!Number.isNaN(d.valueOf())) lt = d;
  }

  const where: Record<string, any> = {};

  if (rawStatus && rawStatus.trim().length > 0) {
    where.status = rawStatus.trim();
  }
  if (rawTdsp && rawTdsp.trim().length > 0) {
    where.tdsp = rawTdsp.trim();
  }

  if (gte || lt) {
    where.createdAt = {};
    if (gte) where.createdAt.gte = gte;
    if (lt) where.createdAt.lt = lt;
  }

  try {
    const ingestModel = (prisma as any).ercotIngestLog;
    const rows = ingestModel
      ? await ingestModel.findMany({
          where,
          take: limit,
          orderBy: { finishedAt: 'desc' },
          select: {
            id: true,
            fileName: true,
            fileHash: true,
            rowsSeen: true,
            rowsUpsert: true,
            notes: true,
            headerSnapshot: true,
            finishedAt: true,
          },
        })
      : [];

    return NextResponse.json({ ok: true, rows });
  } catch (e: any) {
    return jsonError(e?.message || 'failed', 500);
  }
}
