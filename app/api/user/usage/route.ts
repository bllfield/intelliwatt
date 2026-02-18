import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db';
import { usagePrisma } from '@/lib/db/usageClient';
import { normalizeEmail } from '@/lib/utils/email';
import { buildUsageBucketsForEstimate } from '@/lib/usage/buildUsageBucketsForEstimate';

const DAY_MS = 24 * 60 * 60 * 1000;
const USAGE_DB_ENABLED = Boolean((process.env.USAGE_DATABASE_URL ?? '').trim());
const SMT_TZ = 'America/Chicago';

const chicagoDateFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: SMT_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function chicagoDateKey(d: Date): string {
  try {
    return chicagoDateFmt.format(d); // YYYY-MM-DD
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

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

type ImportExportTotals = {
  importKwh: number;
  exportKwh: number;
  netKwh: number;
};

function decimalToNumber(value: Prisma.Decimal | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  return Number(value);
}

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
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

  const startDate = startIso ? new Date(startIso) : new Date(points[0].timestamp);
  const endDate = endIso ? new Date(endIso) : new Date(points[points.length - 1].timestamp);
  const startMs = Number.isFinite(startDate.getTime())
    ? new Date(startDate.toISOString().slice(0, 10)).getTime()
    : Number.NaN;
  const endMs = Number.isFinite(endDate.getTime())
    ? new Date(endDate.toISOString().slice(0, 10)).getTime()
    : Number.NaN;
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

async function computeImportExportTotalsFromDb(args: {
  source: 'SMT' | 'GREEN_BUTTON';
  esiid?: string | null;
  houseId?: string | null;
  rawId?: string | null;
  cutoff: Date;
}): Promise<ImportExportTotals> {
  try {
    if (args.source === 'SMT') {
      const esiid = String(args.esiid ?? '').trim();
      if (!esiid) return { importKwh: 0, exportKwh: 0, netKwh: 0 };

      const rows = await prisma.$queryRaw<Array<{ importkwh: number; exportkwh: number }>>(Prisma.sql`
        WITH iv AS (
          SELECT
            "ts",
            MAX(CASE WHEN "kwh" >= 0 THEN "kwh" ELSE 0 END)::float AS importkwh,
            MAX(CASE WHEN "kwh" < 0 THEN ABS("kwh") ELSE 0 END)::float AS exportkwh
          FROM "SmtInterval"
          WHERE "esiid" = ${esiid}
            AND "ts" >= ${args.cutoff}
          GROUP BY "ts"
        )
        SELECT
          COALESCE(SUM(importkwh)::float, 0) AS importkwh,
          COALESCE(SUM(exportkwh)::float, 0) AS exportkwh
        FROM iv
      `);
      const importKwh = round2(rows?.[0]?.importkwh ?? 0);
      const exportKwh = round2(rows?.[0]?.exportkwh ?? 0);
      return { importKwh, exportKwh, netKwh: round2(importKwh - exportKwh) };
    }

    // Green Button data lives in the separate Usage DB; if it's not configured,
    // don't fail the entire /api/user/usage endpoint.
    if (!USAGE_DB_ENABLED) return { importKwh: 0, exportKwh: 0, netKwh: 0 };

    const usageClient = usagePrisma as any;
    const houseId = String(args.houseId ?? '').trim();
    const rawId = String(args.rawId ?? '').trim();
    if (!houseId || !rawId) return { importKwh: 0, exportKwh: 0, netKwh: 0 };

    const rows = (await usageClient.$queryRaw(Prisma.sql`
      SELECT
        COALESCE(SUM(CASE WHEN "consumptionKwh" >= 0 THEN "consumptionKwh" ELSE 0 END)::float, 0) AS importkwh,
        COALESCE(SUM(CASE WHEN "consumptionKwh" < 0 THEN ABS("consumptionKwh") ELSE 0 END)::float, 0) AS exportkwh
      FROM "GreenButtonInterval"
      WHERE "homeId" = ${houseId}
        AND "rawId" = ${rawId}
        AND "timestamp" >= ${args.cutoff}
    `)) as Array<{ importkwh: number; exportkwh: number }>;
    const importKwh = round2(rows?.[0]?.importkwh ?? 0);
    const exportKwh = round2(rows?.[0]?.exportkwh ?? 0);
    return { importKwh, exportKwh, netKwh: round2(importKwh - exportKwh) };
  } catch {
    return { importKwh: 0, exportKwh: 0, netKwh: 0 };
  }
}

async function computeInsightsFromDb(args: {
  source: 'SMT' | 'GREEN_BUTTON';
  esiid?: string | null;
  houseId?: string | null;
  rawId?: string | null;
  cutoff: Date;
}): Promise<{
  dailyTotals: Array<{ date: string; kwh: number }>;
  monthlyTotals: Array<{ month: string; kwh: number }>;
  fifteenMinuteAverages: Array<{ hhmm: string; avgKw: number }>;
  timeOfDayBuckets: Array<{ key: string; label: string; kwh: number }>;
  peakDay: { date: string; kwh: number } | null;
  peakHour: { hour: number; kw: number } | null;
  baseload: number | null;
  weekdayVsWeekend: { weekday: number; weekend: number };
}> {
  const empty = {
    dailyTotals: [] as Array<{ date: string; kwh: number }>,
    monthlyTotals: [] as Array<{ month: string; kwh: number }>,
    fifteenMinuteAverages: [] as Array<{ hhmm: string; avgKw: number }>,
    timeOfDayBuckets: [] as Array<{ key: string; label: string; kwh: number }>,
    peakDay: null as { date: string; kwh: number } | null,
    peakHour: null as { hour: number; kw: number } | null,
    baseload: null as number | null,
    weekdayVsWeekend: { weekday: 0, weekend: 0 },
  };

  try {
    if (args.source === 'SMT') {
      const esiid = String(args.esiid ?? '').trim();
      if (!esiid) return empty;

      const dailyRows = await prisma.$queryRaw<Array<{ date: string; kwh: number }>>(Prisma.sql`
        WITH iv AS (
          SELECT
            "ts",
            MAX(CASE WHEN "kwh" >= 0 THEN "kwh" ELSE 0 END)::float AS kwh
          FROM "SmtInterval"
          WHERE "esiid" = ${esiid}
            AND "ts" >= ${args.cutoff}
          GROUP BY "ts"
        )
        SELECT
          -- SmtInterval.ts is TIMESTAMP (no tz) but represents UTC instants.
          -- Convert UTC->America/Chicago explicitly before day bucketing.
          to_char((("ts" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago')::date, 'YYYY-MM-DD') AS date,
          COALESCE(SUM("kwh"), 0)::float AS kwh
        FROM iv
        GROUP BY 1
        ORDER BY 1 ASC
      `);
      const dailyTotals = dailyRows.map((r) => ({ date: String(r.date), kwh: round2(r.kwh) }));
      const peakDay =
        dailyTotals.length > 0 ? dailyTotals.reduce((a, b) => (b.kwh > a.kwh ? b : a)) : null;

      const monthlyRows = await prisma.$queryRaw<Array<{ month: string; kwh: number }>>(Prisma.sql`
        WITH iv AS (
          SELECT
            "ts",
            MAX(CASE WHEN "kwh" >= 0 THEN "kwh" ELSE 0 END)::float AS kwh
          FROM "SmtInterval"
          WHERE "esiid" = ${esiid}
            AND "ts" >= ${args.cutoff}
          GROUP BY "ts"
        )
        SELECT
          -- Bucket by America/Chicago local month (SMT semantics) and sum import kWh only.
          to_char(
            date_trunc('month', (("ts" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago'))::date,
            'YYYY-MM'
          ) AS month,
          COALESCE(SUM("kwh"), 0)::float AS kwh
        FROM iv
        GROUP BY 1
        ORDER BY 1 ASC
      `);
      const monthlyTotals = monthlyRows.map((r) => ({ month: String(r.month), kwh: round2(r.kwh) }));

      const fifteenRows = await prisma.$queryRaw<Array<{ hhmm: string; avgkw: number }>>(Prisma.sql`
        WITH iv AS (
          SELECT
            "ts",
            MAX(CASE WHEN "kwh" >= 0 THEN "kwh" ELSE 0 END)::float AS kwh
          FROM "SmtInterval"
          WHERE "esiid" = ${esiid}
            AND "ts" >= ${args.cutoff}
          GROUP BY "ts"
        )
        SELECT
          to_char((("ts" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago'), 'HH24:MI') AS hhmm,
          AVG(("kwh" * 4))::float AS avgkw
        FROM iv
        GROUP BY 1
        ORDER BY 1 ASC
      `);
      const fifteenMinuteAverages = fifteenRows.map((r) => ({ hhmm: String(r.hhmm), avgKw: round2(r.avgkw) }));

      const todRows = await prisma.$queryRaw<Array<{ key: string; label: string; sort: number; kwh: number }>>(Prisma.sql`
        SELECT
          key,
          label,
          sort,
          SUM("kwh")::float AS kwh
        FROM (
          SELECT
            CASE
              WHEN EXTRACT(HOUR FROM (("ts" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago')) >= 0
               AND EXTRACT(HOUR FROM (("ts" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago')) < 6
                THEN 'overnight'
              WHEN EXTRACT(HOUR FROM (("ts" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago')) >= 6
               AND EXTRACT(HOUR FROM (("ts" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago')) < 12
                THEN 'morning'
              WHEN EXTRACT(HOUR FROM (("ts" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago')) >= 12
               AND EXTRACT(HOUR FROM (("ts" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago')) < 18
                THEN 'afternoon'
              ELSE 'evening'
            END AS key,
            CASE
              WHEN EXTRACT(HOUR FROM (("ts" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago')) >= 0
               AND EXTRACT(HOUR FROM (("ts" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago')) < 6
                THEN 'Overnight (12am–6am)'
              WHEN EXTRACT(HOUR FROM (("ts" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago')) >= 6
               AND EXTRACT(HOUR FROM (("ts" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago')) < 12
                THEN 'Morning (6am–12pm)'
              WHEN EXTRACT(HOUR FROM (("ts" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago')) >= 12
               AND EXTRACT(HOUR FROM (("ts" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago')) < 18
                THEN 'Afternoon (12pm–6pm)'
              ELSE 'Evening (6pm–12am)'
            END AS label,
            CASE
              WHEN EXTRACT(HOUR FROM (("ts" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago')) >= 0
               AND EXTRACT(HOUR FROM (("ts" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago')) < 6
                THEN 1
              WHEN EXTRACT(HOUR FROM (("ts" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago')) >= 6
               AND EXTRACT(HOUR FROM (("ts" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago')) < 12
                THEN 2
              WHEN EXTRACT(HOUR FROM (("ts" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago')) >= 12
               AND EXTRACT(HOUR FROM (("ts" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago')) < 18
                THEN 3
              ELSE 4
            END AS sort,
            "kwh"
          FROM (
            SELECT
              "ts",
              MAX(CASE WHEN "kwh" >= 0 THEN "kwh" ELSE 0 END)::float AS kwh
            FROM "SmtInterval"
            WHERE "esiid" = ${esiid}
              AND "ts" >= ${args.cutoff}
            GROUP BY "ts"
          ) iv
        ) t
        GROUP BY key, label, sort
        ORDER BY sort ASC
      `);
      const timeOfDayBuckets = todRows.map((r) => ({
        key: String(r.key),
        label: String(r.label),
        kwh: round2(r.kwh),
      }));

      const peakHourRows = await prisma.$queryRaw<Array<{ hour: number; sumkwh: number }>>(Prisma.sql`
        SELECT
          EXTRACT(HOUR FROM (("ts" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago'))::int AS hour,
          SUM("kwh")::float AS sumkwh
        FROM (
          SELECT
            "ts",
            MAX(CASE WHEN "kwh" >= 0 THEN "kwh" ELSE 0 END)::float AS kwh
          FROM "SmtInterval"
          WHERE "esiid" = ${esiid}
            AND "ts" >= ${args.cutoff}
          GROUP BY "ts"
        ) iv
        GROUP BY 1
        ORDER BY sumkwh DESC
        LIMIT 1
      `);
      const peakHour = peakHourRows?.[0]
        ? { hour: Number(peakHourRows[0].hour), kw: round2(Number(peakHourRows[0].sumkwh) * 4) }
        : null;

      const baseloadRows = await prisma.$queryRaw<Array<{ baseload: number | null }>>(Prisma.sql`
        WITH t AS (
          SELECT ("kwh" * 4)::float AS kw
          FROM (
            SELECT
              "ts",
              MAX(CASE WHEN "kwh" >= 0 THEN "kwh" ELSE 0 END)::float AS kwh
            FROM "SmtInterval"
            WHERE "esiid" = ${esiid}
              AND "ts" >= ${args.cutoff}
            GROUP BY "ts"
          ) iv
        ),
        p AS (
          SELECT percentile_cont(0.10) WITHIN GROUP (ORDER BY kw) AS p10
          FROM t
        )
        SELECT AVG(t.kw)::float AS baseload
        FROM t, p
        WHERE t.kw <= p.p10
      `);
      const baseload = baseloadRows?.[0]?.baseload === null || baseloadRows?.[0]?.baseload === undefined
        ? null
        : round2(Number(baseloadRows[0].baseload));

      const dowRows = await prisma.$queryRaw<Array<{ weekdaykwh: number; weekendkwh: number }>>(Prisma.sql`
        SELECT
          COALESCE(SUM(CASE WHEN EXTRACT(DOW FROM "ts") IN (0,6) THEN 0 ELSE "kwh" END)::float, 0) AS weekdaykwh,
          COALESCE(SUM(CASE WHEN EXTRACT(DOW FROM "ts") IN (0,6) THEN "kwh" ELSE 0 END)::float, 0) AS weekendkwh
        FROM (
          SELECT
            "ts",
            MAX(CASE WHEN "kwh" >= 0 THEN "kwh" ELSE 0 END)::float AS kwh
          FROM "SmtInterval"
          WHERE "esiid" = ${esiid}
            AND "ts" >= ${args.cutoff}
          GROUP BY "ts"
        ) iv
      `);
      const weekday = round2(dowRows?.[0]?.weekdaykwh ?? 0);
      const weekend = round2(dowRows?.[0]?.weekendkwh ?? 0);

      return {
        dailyTotals,
        monthlyTotals,
        fifteenMinuteAverages,
        timeOfDayBuckets,
        peakDay,
        peakHour,
        baseload,
        weekdayVsWeekend: { weekday, weekend },
      };
    }

    // Green Button data lives in the separate Usage DB; if it's not configured,
    // return empty insights rather than throwing.
    if (!USAGE_DB_ENABLED) return empty;

    const usageClient = usagePrisma as any;
    const houseId = String(args.houseId ?? '').trim();
    const rawId = String(args.rawId ?? '').trim();
    if (!houseId || !rawId) return empty;

    const dailyRows = (await usageClient.$queryRaw(Prisma.sql`
      SELECT
        to_char(("timestamp" AT TIME ZONE 'America/Chicago')::date, 'YYYY-MM-DD') AS date,
        SUM("consumptionKwh")::float AS kwh
      FROM "GreenButtonInterval"
      WHERE "homeId" = ${houseId}
        AND "rawId" = ${rawId}
        AND "timestamp" >= ${args.cutoff}
      GROUP BY 1
      ORDER BY 1 ASC
    `)) as Array<{ date: string; kwh: number }>;
    const dailyTotals = dailyRows.map((r) => ({ date: String(r.date), kwh: round2(r.kwh) }));
    const peakDay =
      dailyTotals.length > 0 ? dailyTotals.reduce((a, b) => (b.kwh > a.kwh ? b : a)) : null;

    const monthlyRows = (await usageClient.$queryRaw(Prisma.sql`
      SELECT
        to_char(date_trunc('month', "timestamp")::date, 'YYYY-MM') AS month,
        SUM("consumptionKwh")::float AS kwh
      FROM "GreenButtonInterval"
      WHERE "homeId" = ${houseId}
        AND "rawId" = ${rawId}
        AND "timestamp" >= ${args.cutoff}
      GROUP BY 1
      ORDER BY 1 ASC
    `)) as Array<{ month: string; kwh: number }>;
    const monthlyTotals = monthlyRows.map((r) => ({ month: String(r.month), kwh: round2(r.kwh) }));

    const fifteenRows = (await usageClient.$queryRaw(Prisma.sql`
      SELECT
        to_char("timestamp", 'HH24:MI') AS hhmm,
        AVG(("consumptionKwh" * 4))::float AS avgkw
      FROM "GreenButtonInterval"
      WHERE "homeId" = ${houseId}
        AND "rawId" = ${rawId}
        AND "timestamp" >= ${args.cutoff}
      GROUP BY 1
      ORDER BY 1 ASC
    `)) as Array<{ hhmm: string; avgkw: number }>;
    const fifteenMinuteAverages = fifteenRows.map((r) => ({ hhmm: String(r.hhmm), avgKw: round2(r.avgkw) }));

    const todRows = (await usageClient.$queryRaw(Prisma.sql`
      SELECT
        key,
        label,
        sort,
        SUM("consumptionKwh")::float AS kwh
      FROM (
        SELECT
          CASE
            WHEN EXTRACT(HOUR FROM ("timestamp" AT TIME ZONE 'America/Chicago')) >= 0
             AND EXTRACT(HOUR FROM ("timestamp" AT TIME ZONE 'America/Chicago')) < 6
              THEN 'overnight'
            WHEN EXTRACT(HOUR FROM ("timestamp" AT TIME ZONE 'America/Chicago')) >= 6
             AND EXTRACT(HOUR FROM ("timestamp" AT TIME ZONE 'America/Chicago')) < 12
              THEN 'morning'
            WHEN EXTRACT(HOUR FROM ("timestamp" AT TIME ZONE 'America/Chicago')) >= 12
             AND EXTRACT(HOUR FROM ("timestamp" AT TIME ZONE 'America/Chicago')) < 18
              THEN 'afternoon'
            ELSE 'evening'
          END AS key,
          CASE
            WHEN EXTRACT(HOUR FROM ("timestamp" AT TIME ZONE 'America/Chicago')) >= 0
             AND EXTRACT(HOUR FROM ("timestamp" AT TIME ZONE 'America/Chicago')) < 6
              THEN 'Overnight (12am–6am)'
            WHEN EXTRACT(HOUR FROM ("timestamp" AT TIME ZONE 'America/Chicago')) >= 6
             AND EXTRACT(HOUR FROM ("timestamp" AT TIME ZONE 'America/Chicago')) < 12
              THEN 'Morning (6am–12pm)'
            WHEN EXTRACT(HOUR FROM ("timestamp" AT TIME ZONE 'America/Chicago')) >= 12
             AND EXTRACT(HOUR FROM ("timestamp" AT TIME ZONE 'America/Chicago')) < 18
              THEN 'Afternoon (12pm–6pm)'
            ELSE 'Evening (6pm–12am)'
          END AS label,
          CASE
            WHEN EXTRACT(HOUR FROM ("timestamp" AT TIME ZONE 'America/Chicago')) >= 0
             AND EXTRACT(HOUR FROM ("timestamp" AT TIME ZONE 'America/Chicago')) < 6
              THEN 1
            WHEN EXTRACT(HOUR FROM ("timestamp" AT TIME ZONE 'America/Chicago')) >= 6
             AND EXTRACT(HOUR FROM ("timestamp" AT TIME ZONE 'America/Chicago')) < 12
              THEN 2
            WHEN EXTRACT(HOUR FROM ("timestamp" AT TIME ZONE 'America/Chicago')) >= 12
             AND EXTRACT(HOUR FROM ("timestamp" AT TIME ZONE 'America/Chicago')) < 18
              THEN 3
            ELSE 4
          END AS sort,
          "consumptionKwh"
        FROM "GreenButtonInterval"
        WHERE "homeId" = ${houseId}
          AND "rawId" = ${rawId}
          AND "timestamp" >= ${args.cutoff}
      ) t
      GROUP BY key, label, sort
      ORDER BY sort ASC
    `)) as Array<{ key: string; label: string; sort: number; kwh: number }>;
    const timeOfDayBuckets = todRows.map((r) => ({
      key: String(r.key),
      label: String(r.label),
      kwh: round2(r.kwh),
    }));

    const peakHourRows = (await usageClient.$queryRaw(Prisma.sql`
      SELECT
        EXTRACT(HOUR FROM "timestamp")::int AS hour,
        SUM("consumptionKwh")::float AS sumkwh
      FROM "GreenButtonInterval"
      WHERE "homeId" = ${houseId}
        AND "rawId" = ${rawId}
        AND "timestamp" >= ${args.cutoff}
      GROUP BY 1
      ORDER BY sumkwh DESC
      LIMIT 1
    `)) as Array<{ hour: number; sumkwh: number }>;
    const peakHour = peakHourRows?.[0]
      ? { hour: Number(peakHourRows[0].hour), kw: round2(Number(peakHourRows[0].sumkwh) * 4) }
      : null;

    const baseloadRows = (await usageClient.$queryRaw(Prisma.sql`
      WITH t AS (
        SELECT ("consumptionKwh" * 4)::float AS kw
        FROM "GreenButtonInterval"
        WHERE "homeId" = ${houseId}
          AND "rawId" = ${rawId}
          AND "timestamp" >= ${args.cutoff}
      ),
      p AS (
        SELECT percentile_cont(0.10) WITHIN GROUP (ORDER BY kw) AS p10
        FROM t
      )
      SELECT AVG(t.kw)::float AS baseload
      FROM t, p
      WHERE t.kw <= p.p10
    `)) as Array<{ baseload: number | null }>;
    const baseload = baseloadRows?.[0]?.baseload === null || baseloadRows?.[0]?.baseload === undefined
      ? null
      : round2(Number(baseloadRows[0].baseload));

    const dowRows = (await usageClient.$queryRaw(Prisma.sql`
      SELECT
        COALESCE(SUM(CASE WHEN EXTRACT(DOW FROM "timestamp") IN (0,6) THEN 0 ELSE "consumptionKwh" END)::float, 0) AS weekdaykwh,
        COALESCE(SUM(CASE WHEN EXTRACT(DOW FROM "timestamp") IN (0,6) THEN "consumptionKwh" ELSE 0 END)::float, 0) AS weekendkwh
      FROM "GreenButtonInterval"
      WHERE "homeId" = ${houseId}
        AND "rawId" = ${rawId}
        AND "timestamp" >= ${args.cutoff}
    `)) as Array<{ weekdaykwh: number; weekendkwh: number }>;
    const weekday = round2(dowRows?.[0]?.weekdaykwh ?? 0);
    const weekend = round2(dowRows?.[0]?.weekendkwh ?? 0);

    return {
      dailyTotals,
      monthlyTotals,
      fifteenMinuteAverages,
      timeOfDayBuckets,
      peakDay,
      peakHour,
      baseload,
      weekdayVsWeekend: { weekday, weekend },
    };
  } catch {
    return empty;
  }
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

async function fetchSmtDataset(esiid: string | null): Promise<UsageDatasetResult | null> {
  if (!esiid) return null;

  const window = await getSmtWindow(esiid);
  if (!window) return null;

  // Opportunistic repair: if old data exists under meter='unknown' and a later re-sync
  // inserted the same timestamps under the real meter, delete the unknown duplicates.
  // This prevents downstream consumers (plan engine, etc.) from ever seeing doubled usage.
  try {
    const meters = await prisma.smtInterval.findMany({
      where: { esiid },
      distinct: ['meter'],
      select: { meter: true },
      take: 5,
    });
    const meterValues = meters.map((m) => String(m.meter ?? '').trim()).filter(Boolean);
    if (meterValues.includes('unknown') && meterValues.some((m) => m !== 'unknown')) {
      await prisma.$executeRaw(Prisma.sql`
        DELETE FROM "SmtInterval" u
        USING "SmtInterval" r
        WHERE u."esiid" = ${esiid}
          AND u."meter" = 'unknown'
          AND r."esiid" = u."esiid"
          AND r."ts" = u."ts"
          AND r."meter" <> u."meter"
      `);
    }
  } catch {
    // Never fail the usage endpoint due to cleanup best-effort.
  }

  // Deduplicate by ts to avoid double-counting if SMT re-syncs arrive with different meter IDs.
  const aggRows = await prisma.$queryRaw<
    Array<{ intervalscount: number; importkwh: number; exportkwh: number; start: Date | null; end: Date | null }>
  >(Prisma.sql`
    WITH iv AS (
      SELECT
        "ts",
        MAX(CASE WHEN "kwh" >= 0 THEN "kwh" ELSE 0 END)::float AS importkwh,
        MAX(CASE WHEN "kwh" < 0 THEN ABS("kwh") ELSE 0 END)::float AS exportkwh
      FROM "SmtInterval"
      WHERE "esiid" = ${esiid}
        AND "ts" >= ${window.cutoff}
      GROUP BY "ts"
    )
    SELECT
      COUNT(*)::int AS intervalsCount,
      COALESCE(SUM(importkwh), 0)::float AS importkwh,
      COALESCE(SUM(exportkwh), 0)::float AS exportkwh,
      MIN("ts") AS start,
      MAX("ts") AS end
    FROM iv
  `);

  const agg = aggRows?.[0] ?? null;
  const count = Number(agg?.intervalscount ?? 0);
  if (count === 0) {
    return null;
  }

  const importKwh = round2(Number(agg?.importkwh ?? 0));
  const exportKwh = round2(Number(agg?.exportkwh ?? 0));
  const totalKwh = round2(importKwh - exportKwh);
  const start = agg?.start ?? null;
  const end = agg?.end ?? null;

  const recentIntervals = await prisma.$queryRaw<Array<{ ts: Date; kwh: number }>>(Prisma.sql`
    SELECT
      "ts",
      MAX(CASE WHEN "kwh" >= 0 THEN "kwh" ELSE 0 END)::float AS kwh
    FROM "SmtInterval"
    WHERE "esiid" = ${esiid}
      AND "ts" >= ${window.cutoff}
    GROUP BY "ts"
    ORDER BY "ts" DESC
    LIMIT 192
  `);

  const intervals15 = recentIntervals
    .map((row) => ({
      timestamp: row.ts.toISOString(),
      kwh: decimalToNumber(row.kwh),
    }))
    .reverse();

  const hourlyRows = await prisma.$queryRaw<Array<{ bucket: Date; kwh: number }>>(Prisma.sql`
    WITH iv AS (
      SELECT
        "ts",
        MAX(CASE WHEN "kwh" >= 0 THEN "kwh" ELSE 0 END)::float AS kwh
      FROM "SmtInterval"
      WHERE "esiid" = ${esiid}
        AND "ts" >= ${window.cutoff}
        AND "ts" >= NOW() - INTERVAL '14 days'
      GROUP BY "ts"
    )
    SELECT
      date_trunc('hour', "ts") AS bucket,
      COALESCE(SUM("kwh"), 0)::float AS kwh
    FROM iv
    GROUP BY bucket
    ORDER BY bucket ASC
  `);

  const dailyRows = await prisma.$queryRaw<Array<{ bucket: Date; kwh: number }>>(Prisma.sql`
    WITH iv AS (
      SELECT
        "ts",
        MAX(CASE WHEN "kwh" >= 0 THEN "kwh" ELSE 0 END)::float AS kwh
      FROM "SmtInterval"
      WHERE "esiid" = ${esiid}
        AND "ts" >= ${window.cutoff}
      GROUP BY "ts"
    )
    SELECT
      -- SmtInterval.ts is UTC stored as TIMESTAMP (no tz). Convert to local time first for day bucketing.
      date_trunc('day', (("ts" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago')) AT TIME ZONE 'America/Chicago' AS bucket,
      COALESCE(SUM("kwh"), 0)::float AS kwh
    FROM iv
    GROUP BY bucket
    ORDER BY bucket DESC
    LIMIT 400
  `);

  const monthlyRows = await prisma.$queryRaw<Array<{ bucket: Date; kwh: number }>>(Prisma.sql`
    WITH iv AS (
      SELECT
        "ts",
        MAX(CASE WHEN "kwh" >= 0 THEN "kwh" ELSE 0 END)::float AS kwh
      FROM "SmtInterval"
      WHERE "esiid" = ${esiid}
        AND "ts" >= ${window.cutoff}
      GROUP BY "ts"
    )
    SELECT
      date_trunc('month', (("ts" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago')) AT TIME ZONE 'America/Chicago' AS bucket,
      COALESCE(SUM("kwh"), 0)::float AS kwh
    FROM iv
    GROUP BY bucket
    ORDER BY bucket DESC
    LIMIT 120
  `);

  const annualRows = await prisma.$queryRaw<Array<{ bucket: Date; kwh: number }>>(Prisma.sql`
    WITH iv AS (
      SELECT
        "ts",
        MAX(CASE WHEN "kwh" >= 0 THEN "kwh" ELSE 0 END)::float AS kwh
      FROM "SmtInterval"
      WHERE "esiid" = ${esiid}
        AND "ts" >= ${window.cutoff}
      GROUP BY "ts"
    )
    SELECT
      date_trunc('year', "ts") AS bucket,
      COALESCE(SUM("kwh"), 0)::float AS kwh
    FROM iv
    GROUP BY bucket
    ORDER BY bucket ASC
  `);

  return {
    summary: {
      source: 'SMT',
      intervalsCount: count,
      totalKwh,
      // Display coverage dates in America/Chicago (matches SMT semantics + analysis buckets).
      // Keep `latest` as an instant ISO string for internal windowing.
      start: start ? chicagoDateKey(start) : null,
      end: end ? chicagoDateKey(end) : null,
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
  // Green Button data lives in the separate Usage DB; if it's not configured,
  // skip it rather than failing the whole /api/user/usage request.
  if (!USAGE_DB_ENABLED) return null;

  try {
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
      SELECT date_trunc('day', "timestamp" AT TIME ZONE 'America/Chicago') AT TIME ZONE 'UTC' AS bucket,
             SUM("consumptionKwh")::float AS kwh
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
        daily: fillDailyGaps(
          toSeriesPoint(dailyRows),
          start?.toISOString() ?? null,
          end?.toISOString() ?? null,
        ),
        monthly: toSeriesPoint(monthlyRows),
        annual: toSeriesPoint(annualRows),
      },
    };
  } catch (err) {
    console.warn('[user/usage] green button dataset fetch failed; continuing without green button', err);
    return null;
  }
}

function chooseDataset(
  smt: UsageDatasetResult | null,
  greenButton: UsageDatasetResult | null,
): UsageDatasetResult | null {
  const latestMs = (dataset: UsageDatasetResult | null): number => {
    if (!dataset?.summary?.latest) return 0;
    const ts = new Date(dataset.summary.latest).getTime();
    return Number.isFinite(ts) ? ts : 0;
  };

  const smtLatest = latestMs(smt);
  const gbLatest = latestMs(greenButton);

  if (smtLatest === 0 && gbLatest === 0) return null;
  if (smtLatest === gbLatest) return smt ?? greenButton;

  return smtLatest > gbLatest ? smt : greenButton;
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
      let smtDataset: UsageDatasetResult | null = null;
      let greenDataset: UsageDatasetResult | null = null;
      try {
        smtDataset = await fetchSmtDataset(house.esiid ?? null);
      } catch (err) {
        console.warn('[user/usage] SMT dataset fetch failed; continuing without SMT', err);
        smtDataset = null;
      }
      try {
        greenDataset = await fetchGreenButtonDataset(house.id);
      } catch (err) {
        console.warn('[user/usage] green button dataset fetch failed; continuing without green button', err);
        greenDataset = null;
      }
      const selected = chooseDataset(smtDataset, greenDataset);

      // Canonical monthly totals (stitched 12-month billing window) for SMT homes.
      // This MUST match the plan engine's stitched window so month totals (e.g., Dec) are identical everywhere.
      let stitchedMonthlyTotals: Array<{ month: string; kwh: number }> | null = null;
      let stitchedMonthMeta: any | null = null;
      try {
        if (selected?.summary?.source === 'SMT' && house.esiid && selected.summary.latest) {
          const latest = new Date(selected.summary.latest);
          if (Number.isFinite(latest.getTime())) {
            const cutoff = new Date(latest.getTime() - 365 * DAY_MS);
            const bucketBuild = await buildUsageBucketsForEstimate({
              homeId: house.id,
              usageSource: 'SMT',
              esiid: house.esiid,
              rawId: null,
              windowEnd: latest,
              cutoff,
              requiredBucketKeys: ['kwh.m.all.total'],
              monthsCount: 12,
              maxStepDays: 2,
              stitchMode: 'DAILY_OR_INTERVAL',
            });

            stitchedMonthlyTotals = bucketBuild.yearMonths.map((ym) => ({
              month: ym,
              kwh: Number(bucketBuild.usageBucketsByMonth?.[ym]?.['kwh.m.all.total'] ?? 0) || 0,
            }));
            stitchedMonthMeta = bucketBuild.stitchedMonth ?? null;
          }
        }
      } catch {
        stitchedMonthlyTotals = null;
        stitchedMonthMeta = null;
      }

      // Insights: compute using DB-side aggregations (avoid pulling 365 days of 15-minute intervals into JS).
      let insights: any | null = null;
      let dailyTotals: Array<{ date: string; kwh: number }> = [];
      let monthlyTotals: Array<{ month: string; kwh: number }> = [];
      let totals: ImportExportTotals = { importKwh: 0, exportKwh: 0, netKwh: 0 };
      try {
        const latestIso = selected?.summary?.latest ?? null;
        const latest = latestIso ? new Date(latestIso) : null;
        if (selected?.summary?.source && latest && Number.isFinite(latest.getTime())) {
          const cutoff = new Date(latest.getTime() - 365 * DAY_MS);

          let rawId: string | null = null;
          if (selected.summary.source === 'GREEN_BUTTON') {
            const usageClient = usagePrisma as any;
            const latestRaw = await usageClient.rawGreenButton.findFirst({
              where: { homeId: house.id },
              orderBy: { createdAt: 'desc' },
              select: { id: true },
            });
            rawId = latestRaw?.id ?? null;
          }

          const computed = await computeInsightsFromDb({
            source: selected.summary.source,
            esiid: house.esiid ?? null,
            houseId: house.id,
            rawId,
            cutoff,
          });
          dailyTotals = computed.dailyTotals;
          monthlyTotals = computed.monthlyTotals;
          totals = await computeImportExportTotalsFromDb({
            source: selected.summary.source,
            esiid: house.esiid ?? null,
            houseId: house.id,
            rawId,
            cutoff,
          });

          insights = {
            fifteenMinuteAverages: computed.fifteenMinuteAverages,
            timeOfDayBuckets: computed.timeOfDayBuckets,
            ...(stitchedMonthMeta ? { stitchedMonth: stitchedMonthMeta } : {}),
            peakDay: computed.peakDay,
            peakHour: computed.peakHour,
            baseload: computed.baseload,
            weekdayVsWeekend: computed.weekdayVsWeekend,
          };
        }
      } catch {
        insights = null;
        dailyTotals = [];
        monthlyTotals = [];
        totals = { importKwh: 0, exportKwh: 0, netKwh: 0 };
      }

      const dataset = selected
        ? {
            summary: selected.summary,
            series: selected.series,
            daily: dailyTotals ?? [],
            // Prefer stitched 12-month totals (plan-engine canonical); fall back to strict interval-derived totals.
            monthly: stitchedMonthlyTotals ?? monthlyTotals ?? [],
            insights,
            totals,
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

    return NextResponse.json(
      {
        ok: true,
        houses: results,
      },
      {
        headers: {
          // Browser/private caching only; user-specific (cookie auth). This just reduces repeated fetches.
          // Usage changes infrequently; keep this fairly "sticky" so re-entering the page doesn't feel like recomputation.
          'Cache-Control': 'private, max-age=900, stale-while-revalidate=86400',
        },
      },
    );
  } catch (error) {
    console.error('[user/usage] failed to fetch usage dataset', error);
    // If an admin is logged in (e.g., impersonation/support), include a safe detail string
    // to speed up debugging without leaking internals to normal users.
    let detail: string | undefined = undefined;
    try {
      const cookieStore = cookies();
      const isAdmin = Boolean(cookieStore.get('intelliwatt_admin')?.value);
      if (isAdmin) {
        detail = String((error as any)?.message || error || '').slice(0, 500);
      }
    } catch {
      // ignore
    }
    return NextResponse.json({ ok: false, error: 'Internal error', ...(detail ? { detail } : {}) }, { status: 500 });
  }
}

