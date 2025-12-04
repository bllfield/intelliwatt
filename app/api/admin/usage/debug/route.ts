import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db';
import { usagePrisma } from '@/lib/db/usageClient';
import { requireAdmin } from '@/lib/auth/admin';

export const dynamic = 'force-dynamic';

function decimalToNumber(value: Prisma.Decimal | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (value instanceof Prisma.Decimal) {
    return Number(value.toString());
  }
  return Number(value);
}

function bigIntToNumber(value: unknown): number {
  if (typeof value === 'bigint') {
    return Number(value);
  }
  if (typeof value === 'number') {
    return value;
  }
  if (value === null || value === undefined) {
    return 0;
  }
  return Number(value);
}

const RECENT_USAGE_WINDOW_DAYS = 30;
const RECENT_USAGE_WINDOW_MS = RECENT_USAGE_WINDOW_DAYS * 24 * 60 * 60 * 1000;

export async function GET(request: NextRequest) {
  const gate = requireAdmin(request);
  if (!gate.ok) {
    return NextResponse.json(gate.body, { status: gate.status });
  }

  try {
    const usageClient = usagePrisma as any;
    const recentCutoff = new Date(Date.now() - RECENT_USAGE_WINDOW_MS);

    const [
      smtAggregate,
      smtTopEsiidsRaw,
      smtLatestIntervalsRaw,
      smtRawFiles,
      smtDistinctCountResult,
      usageAggregate,
      usageLatestRowsRaw,
    ] = await Promise.all([
      prisma.smtInterval.aggregate({
        where: {
          ts: {
            gte: recentCutoff,
          },
        },
        _count: { _all: true },
        _min: { ts: true },
        _max: { ts: true },
        _sum: { kwh: true },
      }),
      prisma.smtInterval.groupBy({
        where: {
          ts: {
            gte: recentCutoff,
          },
        },
        by: ['esiid'],
        _count: { _all: true },
        _sum: { kwh: true },
        _max: { ts: true },
        orderBy: {
          _max: {
            ts: 'desc',
          },
        },
        take: 15,
      }),
      prisma.smtInterval.findMany({
        where: {
          ts: {
            gte: recentCutoff,
          },
        },
        orderBy: { ts: 'desc' },
        take: 25,
        select: {
          esiid: true,
          meter: true,
          ts: true,
          kwh: true,
          source: true,
        },
      }),
      prisma.rawSmtFile.findMany({
        orderBy: { created_at: 'desc' },
        take: 12,
        select: {
          id: true,
          filename: true,
          size_bytes: true,
          source: true,
          storage_path: true,
          created_at: true,
          updated_at: true,
          received_at: true,
        },
      }),
      prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(DISTINCT "esiid")::bigint AS count
        FROM "SmtInterval"
        WHERE "ts" >= ${recentCutoff}
      `,
      usageClient.usageIntervalModule.aggregate({
        where: {
          ts: {
            gte: recentCutoff,
          },
        },
        _count: { _all: true },
        _min: { ts: true },
        _max: { ts: true },
        _sum: { kwh: true },
      }),
      usageClient.usageIntervalModule.findMany({
        where: {
          ts: {
            gte: recentCutoff,
          },
        },
        orderBy: { ts: 'desc' },
        take: 50,
        select: {
          esiid: true,
          meter: true,
          ts: true,
          kwh: true,
          filled: true,
          source: true,
        },
      }),
    ]);

    const uniqueEsiidCount = bigIntToNumber(smtDistinctCountResult?.[0]?.count ?? 0);

    const smtTopEsiids = smtTopEsiidsRaw.map((group) => ({
      esiid: group.esiid,
      intervalCount: group._count._all,
      totalKwh: decimalToNumber(group._sum.kwh),
      lastTimestamp: group._max.ts ? group._max.ts.toISOString() : null,
    }));

    const smtLatestIntervals = smtLatestIntervalsRaw.map((row) => ({
      esiid: row.esiid,
      meter: row.meter,
      ts: row.ts.toISOString(),
      kwh: decimalToNumber(row.kwh),
      source: row.source ?? null,
    }));

    const smtTotals = {
      intervalCount: smtAggregate._count?._all ?? 0,
      totalKwh: decimalToNumber(smtAggregate._sum?.kwh ?? 0),
      earliestTs: smtAggregate._min?.ts ? smtAggregate._min.ts.toISOString() : null,
      latestTs: smtAggregate._max?.ts ? smtAggregate._max.ts.toISOString() : null,
      uniqueEsiids: uniqueEsiidCount,
    };

    const usageTotals = {
      intervalCount: usageAggregate._count?._all ?? 0,
      totalKwh: decimalToNumber(usageAggregate._sum?.kwh ?? 0),
      earliestTs: usageAggregate._min?.ts ? usageAggregate._min.ts.toISOString() : null,
      latestTs: usageAggregate._max?.ts ? usageAggregate._max.ts.toISOString() : null,
    };

    const usageLatestRows = usageLatestRowsRaw.map((row: any) => ({
      esiid: row.esiid,
      meter: row.meter,
      ts: row.ts instanceof Date ? row.ts.toISOString() : new Date(row.ts).toISOString(),
      kwh: decimalToNumber(row.kwh),
      filled: Boolean(row.filled),
      source: row.source ?? null,
    }));

    const smtRawFilesPayload = smtRawFiles.map((file) => ({
      id: file.id.toString(),
      filename: file.filename,
      sizeBytes: file.size_bytes,
      source: file.source ?? 'smt',
      storagePath: file.storage_path ?? null,
      createdAt: file.created_at.toISOString(),
      updatedAt: file.updated_at.toISOString(),
      receivedAt: file.received_at ? file.received_at.toISOString() : null,
    }));

    return NextResponse.json({
      ok: true,
      smt: {
        totals: smtTotals,
        topEsiids: smtTopEsiids,
        latestIntervals: smtLatestIntervals,
        rawFiles: smtRawFilesPayload,
        windowDays: RECENT_USAGE_WINDOW_DAYS,
      },
      usageModule: {
        totals: usageTotals,
        latestRows: usageLatestRows,
        windowDays: RECENT_USAGE_WINDOW_DAYS,
      },
    });
  } catch (error) {
    console.error('[admin/usage/debug] failed', error);
    return NextResponse.json({ ok: false, error: 'debug_fetch_failed' }, { status: 500 });
  }
}

