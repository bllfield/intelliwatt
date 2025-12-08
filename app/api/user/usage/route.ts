import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db';
import { usagePrisma } from '@/lib/db/usageClient';
import { normalizeEmail } from '@/lib/utils/email';
import { computeInsights } from '@/lib/usage/computeInsights';
import { NormalizedUsageRow } from '@/lib/usage/normalize';

export const dynamic = 'force-dynamic';

const DAY_MS = 24 * 60 * 60 * 1000;

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

function fillDailyGaps(points: UsageSeriesPoint[], startIso?: string | null, endIso?: string | null) {
  if (points.length === 0 && !startIso && !endIso) return points;

  const startMs = startIso ? new Date(startIso).getTime() : new Date(points[0].timestamp).getTime();
  const endMs = endIso ? new Date(endIso).getTime() : new Date(points[points.length - 1].timestamp).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs > endMs) return points;

  const map = new Map<number, number>();
  for (const p of points) {
    const dayMs = new Date(new Date(p.timestamp).toISOString().slice(0, 10)).getTime();
    if (Number.isFinite(dayMs)) map.set(dayMs, p.kwh);
  }

  const DAY_MS = 24 * 60 * 60 * 1000;
  const out: UsageSeriesPoint[] = [];
  for (let ms = startMs; ms <= endMs; ms += DAY_MS) {
    const key = ms;
    const kwh = map.get(key) ?? 0;
    out.push({ timestamp: new Date(ms).toISOString(), kwh });
  }

  return out;
}

async function getGreenButtonWindow(usageClient: any, houseId: string, rawId: string) {
  const latest = await usageClient.greenButtonInterval.findFirst({
    where: { homeId: houseId, rawId },
    orderBy: { timestamp: 'desc' },
    select: { timestamp: true },
  });

  if (!latest?.timestamp) return null;

  const cutoff = new Date(latest.timestamp.getTime() - 365 * DAY_MS); // strict last 12 months
  return { latest: latest.timestamp, cutoff };
}

async function getSmtWindow(esiid: string) {
  const latest = await prisma.smtInterval.findFirst({
    where: { esiid },
    orderBy: { ts: 'desc' },
    select: { ts: true },
  });

  if (!latest?.ts) return null;

  // Align SMT display window to the last 12 months (match Green Button behavior)
  const cutoff = new Date(latest.ts.getTime() - 365 * DAY_MS);
  return { latest: latest.ts, cutoff };
}

async function fetchNormalizedIntervals(
  source: 'SMT' | 'GREEN_BUTTON',
  houseId: string,
  esiid: string | null,
): Promise<NormalizedUsageRow[]> {
  if (source === 'SMT') {
    if (!esiid) return [];

    const window = await getSmtWindow(esiid);
    if (!window) return [];

    const rows = await prisma.smtInterval.findMany({
      where: {
        esiid,
        ts: { gte: window.cutoff },
      },
      orderBy: { ts: 'asc' },
      select: {
        id: true,
        esiid: true,
        meter: true,
        ts: true,
        kwh: true,
        source: true,
      },
    });

    return rows.map((row) => ({
      houseId,
      esiid: row.esiid,
      meter: row.meter,
      timestamp: row.ts,
      kwh: decimalToNumber(row.kwh),
      source: row.source ?? 'smt',
      rawSourceId: row.id,
    }));
  }

  const usageClient = usagePrisma as any;
  const latestRaw = await usageClient.rawGreenButton.findFirst({
    where: { homeId: houseId },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });

  if (!latestRaw) {
    return [];
  }

  const window = await getGreenButtonWindow(usageClient, houseId, latestRaw.id);
  if (!window) return [];

  const rows = (await usageClient.greenButtonInterval.findMany({
    where: { homeId: houseId, rawId: latestRaw.id, timestamp: { gte: window.cutoff } },
    orderBy: { timestamp: 'asc' },
    select: {
      id: true,
      rawId: true,
      homeId: true,
      timestamp: true,
      consumptionKwh: true,
      userId: true,
    },
  })) as Array<{
    id: string;
    rawId: string | null;
    homeId: string | null;
    timestamp: Date;
    consumptionKwh: Prisma.Decimal | number;
    userId: string | null;
  }>;

  return rows.map((row) => ({
    houseId: row.homeId ?? houseId,
    esiid: null,
    meter: 'green_button',
    timestamp: row.timestamp,
    kwh: decimalToNumber(row.consumptionKwh),
    source: 'green_button',
    rawSourceId: row.rawId ?? row.id,
  }));
}

async function fetchSmtDataset(esiid: string | null): Promise<UsageDatasetResult | null> {
  if (!esiid) return null;

  const window = await getSmtWindow(esiid);
  if (!window) return null;

  const aggregates = await prisma.smtInterval.aggregate({
    where: {
      esiid,
      ts: { gte: window.cutoff },
    },
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
    where: { esiid, ts: { gte: window.cutoff } },
    orderBy: { ts: 'desc' },
    take: 192, // ~2 days of 15-minute intervals
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
      AND "ts" >= ${window.cutoff}
      AND "ts" >= NOW() - INTERVAL '14 days'
    GROUP BY bucket
    ORDER BY bucket ASC
  `);

  const dailyRows = await prisma.$queryRaw<Array<{ bucket: Date; kwh: number }>>(Prisma.sql`
    SELECT date_trunc('day', "ts") AS bucket, SUM("kwh")::float AS kwh
    FROM "SmtInterval"
    WHERE "esiid" = ${esiid}
      AND "ts" >= ${window.cutoff}
    GROUP BY bucket
    ORDER BY bucket DESC
    LIMIT 400
  `);

  const monthlyRows = await prisma.$queryRaw<Array<{ bucket: Date; kwh: number }>>(Prisma.sql`
    SELECT date_trunc('month', "ts") AS bucket, SUM("kwh")::float AS kwh
    FROM "SmtInterval"
    WHERE "esiid" = ${esiid}
      AND "ts" >= ${window.cutoff}
    GROUP BY bucket
    ORDER BY bucket DESC
    LIMIT 120
  `);

  const annualRows = await prisma.$queryRaw<Array<{ bucket: Date; kwh: number }>>(Prisma.sql`
    SELECT date_trunc('year', "ts") AS bucket, SUM("kwh")::float AS kwh
    FROM "SmtInterval"
    WHERE "esiid" = ${esiid}
      AND "ts" >= ${window.cutoff}
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
      daily: fillDailyGaps(toSeriesPoint(dailyRows), start?.toISOString() ?? null, end?.toISOString() ?? null),
      monthly: toSeriesPoint(monthlyRows),
      annual: toSeriesPoint(annualRows),
    },
  };
}

async function fetchGreenButtonDataset(houseId: string): Promise<UsageDatasetResult | null> {
  const usageClient = usagePrisma as any;

  const latestRaw = await usageClient.rawGreenButton.findFirst({
    where: { homeId: houseId },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });

  if (!latestRaw) {
    return null;
  }

  const window = await getGreenButtonWindow(usageClient, houseId, latestRaw.id);
  if (!window) return null;

  const aggregates = await usageClient.greenButtonInterval.aggregate({
    where: { homeId: houseId, rawId: latestRaw.id, timestamp: { gte: window.cutoff } },
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
    where: { homeId: houseId, rawId: latestRaw.id, timestamp: { gte: window.cutoff } },
    orderBy: { timestamp: 'desc' },
    take: 192, // ~2 days of 15-minute intervals
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
      AND "rawId" = ${latestRaw.id}
      AND "timestamp" >= ${window.cutoff}
      AND "timestamp" >= NOW() - INTERVAL '14 days'
    GROUP BY bucket
    ORDER BY bucket ASC
  `);
  const hourlyRows = hourlyRowsRaw as Array<{ bucket: Date; kwh: number }>;

  const dailyRowsRaw = await usageClient.$queryRaw(Prisma.sql`
    SELECT date_trunc('day', "timestamp") AS bucket, SUM("consumptionKwh")::float AS kwh
    FROM "GreenButtonInterval"
    WHERE "homeId" = ${houseId}
      AND "rawId" = ${latestRaw.id}
      AND "timestamp" >= ${window.cutoff}
    GROUP BY bucket
    ORDER BY bucket DESC
    LIMIT 400
  `);
  const dailyRows = dailyRowsRaw as Array<{ bucket: Date; kwh: number }>;

  const monthlyRowsRaw = await usageClient.$queryRaw(Prisma.sql`
    SELECT date_trunc('month', "timestamp") AS bucket, SUM("consumptionKwh")::float AS kwh
    FROM "GreenButtonInterval"
    WHERE "homeId" = ${houseId}
      AND "rawId" = ${latestRaw.id}
      AND "timestamp" >= ${window.cutoff}
    GROUP BY bucket
    ORDER BY bucket DESC
    LIMIT 120
  `);
  const monthlyRows = monthlyRowsRaw as Array<{ bucket: Date; kwh: number }>;

  const annualRowsRaw = await usageClient.$queryRaw(Prisma.sql`
    SELECT date_trunc('year', "timestamp") AS bucket, SUM("consumptionKwh")::float AS kwh
    FROM "GreenButtonInterval"
    WHERE "homeId" = ${houseId}
      AND "rawId" = ${latestRaw.id}
      AND "timestamp" >= ${window.cutoff}
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
      daily: fillDailyGaps(toSeriesPoint(dailyRows), start?.toISOString() ?? null, end?.toISOString() ?? null),
      monthly: toSeriesPoint(monthlyRows),
      annual: toSeriesPoint(annualRows),
    },
  };
}

function chooseDataset(
  smt: UsageDatasetResult | null,
  greenButton: UsageDatasetResult | null,
): UsageDatasetResult | null {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const coverageDays = (dataset: UsageDatasetResult | null): number => {
    if (!dataset?.summary?.start || !dataset?.summary?.end) return 0;
    const startMs = new Date(dataset.summary.start).getTime();
    const endMs = new Date(dataset.summary.end).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return 0;
    return (endMs - startMs) / MS_PER_DAY;
  };

  const latestMs = (dataset: UsageDatasetResult | null): number => {
    if (!dataset?.summary?.latest) return 0;
    const ts = new Date(dataset.summary.latest).getTime();
    return Number.isFinite(ts) ? ts : 0;
  };

  const smtCoverage = coverageDays(smt);
  const gbCoverage = coverageDays(greenButton);
  const smtHasYear = smtCoverage >= 330;
  const gbHasYear = gbCoverage >= 330;

  // Prefer SMT whenever it is available; fall back to Green Button only if SMT is absent
  // or completely lacks coverage. This ensures SMT supersedes prior uploads.
  if (smt) {
    return smt;
  }

  return greenButton;
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

      let intervals: NormalizedUsageRow[] = [];
      if (selected?.summary?.source) {
        intervals = await fetchNormalizedIntervals(selected.summary.source, house.id, house.esiid ?? null);
      }

      const insights = intervals.length > 0 ? computeInsights(intervals) : null;
      const intervalsPayload = (insights?.intervals ?? intervals).map((row) => ({
        houseId: row.houseId,
        esiid: row.esiid,
        meter: row.meter,
        timestamp: row.timestamp.toISOString(),
        kwh: row.kwh,
        source: row.source,
        rawSourceId: row.rawSourceId,
      }));

      const dataset = selected
        ? {
            summary: selected.summary,
            series: selected.series,
            intervals: intervalsPayload,
            daily: insights?.dailyTotals ?? [],
            monthly: insights?.monthlyTotals ?? [],
            insights: insights
              ? {
                  fifteenMinuteAverages: insights.fifteenMinuteAverages,
                  peakDay: insights.peakDay,
                  peakHour: insights.peakHour,
                  baseload: insights.baseload,
                  weekdayVsWeekend: insights.weekdayVsWeekend,
                }
              : null,
          }
        : null;

      results.push({
        houseId: house.id,
        label: house.label || house.addressLine1,
        address: {
          line1: house.addressLine1,
          city: house.addressCity,
          state: house.addressState,
        },
        esiid: house.esiid,
        dataset,
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

