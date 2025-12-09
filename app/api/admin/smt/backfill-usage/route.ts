import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { usagePrisma } from '@/lib/db/usageClient';
import { requireAdmin } from '@/lib/auth/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const DEFAULT_WINDOW_DAYS = 400;

type SmtRow = {
  esiid: string;
  meter: string | null;
  ts: Date;
  kwh: Prisma.Decimal;
  source: string | null;
};

function decimalToNumber(value: Prisma.Decimal | number | null | undefined) {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  return Number(value.toString());
}

export async function POST(req: NextRequest) {
  const gate = requireAdmin(req);
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  const url = new URL(req.url);
  const esiid = url.searchParams.get('esiid')?.trim();
  const meter = url.searchParams.get('meter')?.trim() || undefined;
  const daysParam = Number(url.searchParams.get('days') || DEFAULT_WINDOW_DAYS);
  const windowDays = Number.isFinite(daysParam) && daysParam > 0 ? daysParam : DEFAULT_WINDOW_DAYS;

  if (!esiid) {
    return NextResponse.json({ ok: false, error: 'missing_esiid' }, { status: 400 });
  }

  try {
    const latest = await prisma.smtInterval.findFirst({
      where: { esiid, meter: meter || undefined },
      orderBy: { ts: 'desc' },
      select: { ts: true },
    });

    if (!latest?.ts) {
      return NextResponse.json({ ok: true, intervalsInserted: 0, duplicatesSkipped: 0, filesProcessed: 0, totalKwh: 0 });
    }

    const windowStart = new Date(latest.ts.getTime() - windowDays * 24 * 60 * 60 * 1000);

    const smtRows = (await prisma.smtInterval.findMany({
      where: {
        esiid,
        meter: meter || undefined,
        ts: { gte: windowStart, lte: latest.ts },
      },
      select: {
        esiid: true,
        meter: true,
        ts: true,
        kwh: true,
        source: true,
      },
      orderBy: { ts: 'asc' },
    })) as SmtRow[];

    if (smtRows.length === 0) {
      return NextResponse.json({ ok: true, intervalsInserted: 0, duplicatesSkipped: 0, filesProcessed: 0, totalKwh: 0 });
    }

    const usageClient: any = usagePrisma;
    if (!usageClient?.usageIntervalModule) {
      return NextResponse.json({ ok: false, error: 'usage_client_unavailable' }, { status: 500 });
    }

    const totalKwh = smtRows.reduce<number>((sum, row: SmtRow) => sum + decimalToNumber(row.kwh), 0);

    const groups = new Map<string, SmtRow[]>();
    for (const row of smtRows) {
      const key = `${row.esiid}|${row.meter || ''}`;
      const arr = groups.get(key) || [];
      arr.push(row);
      groups.set(key, arr);
    }

    let inserted = 0;

    for (const rows of Array.from(groups.values())) {
      const pairMin = rows[0].ts;
      const pairMax = rows[rows.length - 1].ts;
      const { esiid: pairEsiid, meter: pairMeter } = rows[0];

      await usageClient.usageIntervalModule.deleteMany({
        where: {
          esiid: pairEsiid,
          meter: pairMeter,
          ts: { gte: pairMin, lte: pairMax },
        },
      });

      const createResult = await usageClient.usageIntervalModule.createMany({
        data: rows.map((row: SmtRow) => ({
          esiid: row.esiid,
          meter: row.meter,
          ts: row.ts,
          kwh: row.kwh,
          filled: false,
          source: row.source ?? 'smt-backfill',
        })),
        skipDuplicates: false,
      });

      inserted += createResult.count;
    }

    return NextResponse.json({
      ok: true,
      filesProcessed: 0,
      intervalsInserted: inserted,
      duplicatesSkipped: 0,
      totalKwh,
      tsMin: smtRows[0].ts.toISOString(),
      tsMax: smtRows[smtRows.length - 1].ts.toISOString(),
      windowDays,
      groups: groups.size,
    });
  } catch (err) {
    console.error('[smt/backfill-usage] failed', err);
    return NextResponse.json({ ok: false, error: 'backfill_failed' }, { status: 500 });
  }
}
