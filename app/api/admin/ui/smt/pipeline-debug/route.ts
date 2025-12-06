import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const gate = requireAdmin(req);
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  const { searchParams } = new URL(req.url);
  const intervalsLimitParam = Number(searchParams.get('intervalsLimit') ?? '25');
  const rawLimitParam = Number(searchParams.get('rawLimit') ?? '15');

  const intervalsLimit = Number.isFinite(intervalsLimitParam)
    ? Math.min(Math.max(Math.floor(intervalsLimitParam), 1), 200)
    : 25;
  const rawLimit = Number.isFinite(rawLimitParam) ? Math.min(Math.max(Math.floor(rawLimitParam), 1), 200) : 15;

  const [rawFiles, intervals, agg, distinctEsiids] = await Promise.all([
    prisma.rawSmtFile.findMany({
      orderBy: { created_at: 'desc' },
      take: rawLimit,
      select: {
        id: true,
        filename: true,
        size_bytes: true,
        sha256: true,
        created_at: true,
        received_at: true,
        source: true,
        storage_path: true,
        content_type: true,
      },
    }),
    prisma.smtInterval.findMany({
      orderBy: { ts: 'desc' },
      take: intervalsLimit,
      select: {
        id: true,
        esiid: true,
        meter: true,
        ts: true,
        kwh: true,
        source: true,
        createdAt: true,
      },
    }),
    prisma.smtInterval.aggregate({
      _count: { _all: true },
      _min: { ts: true },
      _max: { ts: true },
    }),
    prisma.smtInterval.findMany({
      distinct: ['esiid'],
      select: { esiid: true },
      take: 5000,
    }),
  ]);

  const response = {
    ok: true,
    stats: {
      totalIntervals: agg._count?._all ?? 0,
      uniqueEsiids: distinctEsiids.length,
      tsMin: agg._min?.ts ? agg._min.ts.toISOString() : null,
      tsMax: agg._max?.ts ? agg._max.ts.toISOString() : null,
    },
    rawFiles: rawFiles.map((r) => ({
      id: String(r.id),
      filename: r.filename,
      sizeBytes: r.size_bytes,
      sha256: r.sha256,
      createdAt: r.created_at.toISOString(),
      receivedAt: r.received_at ? r.received_at.toISOString() : null,
      source: r.source ?? null,
      storagePath: r.storage_path ?? null,
      contentType: r.content_type ?? null,
    })),
    intervals: intervals.map((row) => ({
      id: row.id,
      esiid: row.esiid,
      meter: row.meter,
      ts: row.ts.toISOString(),
      kwh: Number(row.kwh),
      source: row.source ?? null,
      createdAt: row.createdAt.toISOString(),
    })),
  };

  return NextResponse.json(response);
}
