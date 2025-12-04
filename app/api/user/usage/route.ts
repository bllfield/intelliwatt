import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db';
import { usagePrisma } from '@/lib/db/usageClient';
import { normalizeEmail } from '@/lib/utils/email';

type UsageSeriesPoint = {
  timestamp: string;
  kwh: number;
};

type UsageSummary = {
  source: 'SMT' | 'GREEN_BUTTON';
  intervalsCount: number;
  totalKwh: number;
  start: string | null;
  end: string | null;
  latest: string | null;
};

type UsageDatasetResult = {
  summary: UsageSummary;
  series: {
    intervals15: UsageSeriesPoint[];
    hourly: UsageSeriesPoint[];
    daily: UsageSeriesPoint[];
    monthly: UsageSeriesPoint[];
    annual: UsageSeriesPoint[];
  };
};

function decimalToNumber(value: Prisma.Decimal | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  return Number(value);
}

function toSeriesPoint(rows: Array<{ bucket: Date; kwh: number }>): UsageSeriesPoint[] {
  return rows
    .map((row: { bucket: Date; kwh: number }) => ({
      timestamp: row.bucket.toISOString(),
      kwh: Number(row.kwh ?? 0),
    }))
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

async function fetchSmtDataset(esiid: string | null): Promise<UsageDatasetResult | null> {
  if (!esiid) return null;

  const aggregates = await prisma.smtInterval.aggregate({
    where: { esiid },
    _count: { _all: true },
    _sum: { kwh: true },
    _min: { ts: true },
    _max: { ts: true },
  });

  const count = aggregates._count?._all ?? 0;
  if (count === 0) {
    return null;
  }

  const totalKwh = decimalToNumber(aggregates._sum?.kwh ?? 0);
  const start = aggregates._min?.ts ?? null;
  const end = aggregates._max?.ts ?? null;

  const recentIntervals = await prisma.smtInterval.findMany({
    where: { esiid },
    orderBy: { ts: 'desc' },
    take: 96,
  });

  const intervals15 = recentIntervals
    .map((row) => ({
      timestamp: row.ts.toISOString(),
      kwh: decimalToNumber(row.kwh),
    }))
    .reverse();

  const hourlyRows = await prisma.$queryRaw<Array<{ bucket: Date; kwh: number }>>(Prisma.sql`
    SELECT date_trunc('hour', "ts") AS bucket, SUM("kwh")::float AS kwh
    FROM "SmtInterval"
    WHERE "esiid" = ${esiid}
      AND "ts" >= NOW() - INTERVAL '14 days'
    GROUP BY bucket
    ORDER BY bucket ASC
  `);

  const dailyRows = await prisma.$queryRaw<Array<{ bucket: Date; kwh: number }>>(Prisma.sql`
    SELECT date_trunc('day', "ts") AS bucket, SUM("kwh")::float AS kwh
    FROM "SmtInterval"
    WHERE "esiid" = ${esiid}
    GROUP BY bucket
    ORDER BY bucket DESC
    LIMIT 400
  `);

  const monthlyRows = await prisma.$queryRaw<Array<{ bucket: Date; kwh: number }>>(Prisma.sql`
    SELECT date_trunc('month', "ts") AS bucket, SUM("kwh")::float AS kwh
    FROM "SmtInterval"
    WHERE "esiid" = ${esiid}
    GROUP BY bucket
    ORDER BY bucket DESC
    LIMIT 120
  `);

  const annualRows = await prisma.$queryRaw<Array<{ bucket: Date; kwh: number }>>(Prisma.sql`
    SELECT date_trunc('year', "ts") AS bucket, SUM("kwh")::float AS kwh
    FROM "SmtInterval"
    WHERE "esiid" = ${esiid}
    GROUP BY bucket
    ORDER BY bucket ASC
  `);

  return {
    summary: {
      source: 'SMT',
      intervalsCount: count,
      totalKwh,
      start: start ? start.toISOString() : null,
      end: end ? end.toISOString() : null,
      latest: end ? end.toISOString() : null,
    },
    series: {
      intervals15,
      hourly: toSeriesPoint(hourlyRows),
      daily: toSeriesPoint(dailyRows),
      monthly: toSeriesPoint(monthlyRows),
      annual: toSeriesPoint(annualRows),
    },
  };
}

async function fetchGreenButtonDataset(houseId: string): Promise<UsageDatasetResult | null> {
  const usageClient = usagePrisma as any;

  const aggregates = await usageClient.greenButtonInterval.aggregate({
    where: { homeId: houseId },
    _count: { _all: true },
    _sum: { consumptionKwh: true },
    _min: { timestamp: true },
    _max: { timestamp: true },
  });

  const count = aggregates._count?._all ?? 0;
  if (count === 0) {
    return null;
  }

  const totalKwh = decimalToNumber(aggregates._sum?.consumptionKwh ?? 0);
  const start = aggregates._min?.timestamp ?? null;
  const end = aggregates._max?.timestamp ?? null;

  const recentIntervals = (await usageClient.greenButtonInterval.findMany({
    where: { homeId: houseId },
    orderBy: { timestamp: 'desc' },
    take: 96,
  })) as Array<{ timestamp: Date; consumptionKwh: Prisma.Decimal | number }>;

  const intervals15 = recentIntervals
    .map((row: { timestamp: Date; consumptionKwh: Prisma.Decimal | number }) => ({
      timestamp: row.timestamp.toISOString(),
      kwh: decimalToNumber(row.consumptionKwh),
    }))
    .reverse();

  const hourlyRowsRaw = await usageClient.$queryRaw(Prisma.sql`
    SELECT date_trunc('hour', "timestamp") AS bucket, SUM("consumptionKwh")::float AS kwh
    FROM "GreenButtonInterval"
    WHERE "homeId" = ${houseId}
      AND "timestamp" >= NOW() - INTERVAL '14 days'
    GROUP BY bucket
    ORDER BY bucket ASC
  `);
  const hourlyRows = hourlyRowsRaw as Array<{ bucket: Date; kwh: number }>;

  const dailyRowsRaw = await usageClient.$queryRaw(Prisma.sql`
    SELECT date_trunc('day', "timestamp") AS bucket, SUM("consumptionKwh")::float AS kwh
    FROM "GreenButtonInterval"
    WHERE "homeId" = ${houseId}
    GROUP BY bucket
    ORDER BY bucket DESC
    LIMIT 400
  `);
  const dailyRows = dailyRowsRaw as Array<{ bucket: Date; kwh: number }>;

  const monthlyRowsRaw = await usageClient.$queryRaw(Prisma.sql`
    SELECT date_trunc('month', "timestamp") AS bucket, SUM("consumptionKwh")::float AS kwh
    FROM "GreenButtonInterval"
    WHERE "homeId" = ${houseId}
    GROUP BY bucket
    ORDER BY bucket DESC
    LIMIT 120
  `);
  const monthlyRows = monthlyRowsRaw as Array<{ bucket: Date; kwh: number }>;

  const annualRowsRaw = await usageClient.$queryRaw(Prisma.sql`
    SELECT date_trunc('year', "timestamp") AS bucket, SUM("consumptionKwh")::float AS kwh
    FROM "GreenButtonInterval"
    WHERE "homeId" = ${houseId}
    GROUP BY bucket
    ORDER BY bucket ASC
  `);
  const annualRows = annualRowsRaw as Array<{ bucket: Date; kwh: number }>;

  return {
    summary: {
      source: 'GREEN_BUTTON',
      intervalsCount: count,
      totalKwh,
      start: start ? start.toISOString() : null,
      end: end ? end.toISOString() : null,
      latest: end ? end.toISOString() : null,
    },
    series: {
      intervals15,
      hourly: toSeriesPoint(hourlyRows),
      daily: toSeriesPoint(dailyRows),
      monthly: toSeriesPoint(monthlyRows),
      annual: toSeriesPoint(annualRows),
    },
  };
}

function chooseDataset(
  smt: UsageDatasetResult | null,
  greenButton: UsageDatasetResult | null,
): UsageDatasetResult | null {
  if (smt && !greenButton) return smt;
  if (!smt && greenButton) return greenButton;
  if (!smt && !greenButton) return null;

  const smtLatest = smt?.summary.latest ? new Date(smt.summary.latest).getTime() : 0;
  const greenLatest = greenButton?.summary.latest ? new Date(greenButton.summary.latest).getTime() : 0;

  return greenLatest >= smtLatest ? greenButton! : smt!;
}

export async function GET(_request: NextRequest) {
  try {
    const cookieStore = cookies();
    const rawEmail = cookieStore.get('intelliwatt_user')?.value;
    if (!rawEmail) {
      return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 });
    }

    const userEmail = normalizeEmail(rawEmail);
    const user = await prisma.user.findUnique({
      where: { email: userEmail },
      select: { id: true },
    });

    if (!user) {
      return NextResponse.json({ ok: false, error: 'User not found' }, { status: 404 });
    }

    const houses = await prisma.houseAddress.findMany({
      where: { userId: user.id, archivedAt: null },
      select: {
        id: true,
        label: true,
        addressLine1: true,
        addressCity: true,
        addressState: true,
        esiid: true,
      },
    });

    const results = [];
    for (const house of houses) {
      const smtDataset = await fetchSmtDataset(house.esiid ?? null);
      const greenDataset = await fetchGreenButtonDataset(house.id);
      const selected = chooseDataset(smtDataset, greenDataset);

      results.push({
        houseId: house.id,
        label: house.label || house.addressLine1,
        address: {
          line1: house.addressLine1,
          city: house.addressCity,
          state: house.addressState,
        },
        esiid: house.esiid,
        dataset: selected,
        alternatives: {
          smt: smtDataset?.summary ?? null,
          greenButton: greenDataset?.summary ?? null,
        },
      });
    }

    return NextResponse.json({
      ok: true,
      houses: results,
    });
  } catch (error) {
    console.error('[user/usage] failed to fetch usage dataset', error);
    return NextResponse.json({ ok: false, error: 'Internal error' }, { status: 500 });
  }
}

