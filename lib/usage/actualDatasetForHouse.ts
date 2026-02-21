/**
 * Shared logic to get the actual usage dataset for a single house (SMT or Green Button).
 * Used by the Usage API and by the simulator when serving BASELINE with actual data,
 * so the baseline shows the exact same data as the Usage page.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { usagePrisma } from "@/lib/db/usageClient";
import { buildUsageBucketsForEstimate } from "@/lib/usage/buildUsageBucketsForEstimate";
import { chooseActualSource } from "@/modules/realUsageAdapter/actual";

const DAY_MS = 24 * 60 * 60 * 1000;
const USAGE_DB_ENABLED = Boolean((process.env.USAGE_DATABASE_URL ?? "").trim());
const SMT_TZ = "America/Chicago";

const chicagoDateFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: SMT_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function chicagoDateKey(d: Date): string {
  try {
    return chicagoDateFmt.format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

export type UsageSeriesPoint = { timestamp: string; kwh: number };

export type UsageSummary = {
  source: "SMT" | "GREEN_BUTTON";
  intervalsCount: number;
  totalKwh: number;
  start: string | null;
  end: string | null;
  latest: string | null;
};

export type UsageDatasetResult = {
  summary: UsageSummary;
  series: {
    intervals15: UsageSeriesPoint[];
    hourly: UsageSeriesPoint[];
    daily: UsageSeriesPoint[];
    monthly: UsageSeriesPoint[];
    annual: UsageSeriesPoint[];
  };
};

export type ImportExportTotals = { importKwh: number; exportKwh: number; netKwh: number };

/** Same shape as one house's dataset in GET /api/user/usage */
export type ActualHouseDataset = {
  summary: UsageSummary;
  series: UsageDatasetResult["series"];
  daily: Array<{ date: string; kwh: number }>;
  monthly: Array<{ month: string; kwh: number }>;
  insights: Record<string, unknown> | null;
  totals: ImportExportTotals;
};

function decimalToNumber(value: Prisma.Decimal | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  return Number(value);
}

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function toSeriesPoint(rows: Array<{ bucket: Date; kwh: number }>): UsageSeriesPoint[] {
  return rows
    .map((row) => ({
      timestamp: row.bucket.toISOString(),
      kwh: Number(row.kwh ?? 0),
    }))
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

function fillDailyGaps(
  points: UsageSeriesPoint[],
  startIso?: string | null,
  endIso?: string | null
): UsageSeriesPoint[] {
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
  const out: UsageSeriesPoint[] = [];
  for (let ms = startMs; ms <= endMs; ms += DAY_MS) {
    out.push({ timestamp: new Date(ms).toISOString(), kwh: map.get(ms) ?? 0 });
  }
  return out;
}

async function computeImportExportTotalsFromDb(args: {
  source: "SMT" | "GREEN_BUTTON";
  esiid?: string | null;
  houseId?: string | null;
  rawId?: string | null;
  cutoff: Date;
}): Promise<ImportExportTotals> {
  try {
    if (args.source === "SMT") {
      const esiid = String(args.esiid ?? "").trim();
      if (!esiid) return { importKwh: 0, exportKwh: 0, netKwh: 0 };
      const rows = await prisma.$queryRaw<Array<{ importkwh: number; exportkwh: number }>>(
        Prisma.sql`
        WITH iv AS (
          SELECT
            "ts",
            MAX(CASE WHEN "kwh" >= 0 THEN "kwh" ELSE 0 END)::float AS importkwh,
            MAX(CASE WHEN "kwh" < 0 THEN ABS("kwh") ELSE 0 END)::float AS exportkwh
          FROM "SmtInterval"
          WHERE "esiid" = ${esiid} AND "ts" >= ${args.cutoff}
          GROUP BY "ts"
        )
        SELECT COALESCE(SUM(importkwh)::float, 0) AS importkwh, COALESCE(SUM(exportkwh)::float, 0) AS exportkwh
        FROM iv
      `
      );
      const importKwh = round2(rows?.[0]?.importkwh ?? 0);
      const exportKwh = round2(rows?.[0]?.exportkwh ?? 0);
      return { importKwh, exportKwh, netKwh: round2(importKwh - exportKwh) };
    }
    if (!USAGE_DB_ENABLED) return { importKwh: 0, exportKwh: 0, netKwh: 0 };
    const usageClient = usagePrisma as any;
    const houseId = String(args.houseId ?? "").trim();
    const rawId = String(args.rawId ?? "").trim();
    if (!houseId || !rawId) return { importKwh: 0, exportKwh: 0, netKwh: 0 };
    const rows = (await usageClient.$queryRaw(Prisma.sql`
      SELECT COALESCE(SUM(CASE WHEN "consumptionKwh" >= 0 THEN "consumptionKwh" ELSE 0 END)::float, 0) AS importkwh,
             COALESCE(SUM(CASE WHEN "consumptionKwh" < 0 THEN ABS("consumptionKwh") ELSE 0 END)::float, 0) AS exportkwh
      FROM "GreenButtonInterval"
      WHERE "homeId" = ${houseId} AND "rawId" = ${rawId} AND "timestamp" >= ${args.cutoff}
    `)) as Array<{ importkwh: number; exportkwh: number }>;
    const importKwh = round2(rows?.[0]?.importkwh ?? 0);
    const exportKwh = round2(rows?.[0]?.exportkwh ?? 0);
    return { importKwh, exportKwh, netKwh: round2(importKwh - exportKwh) };
  } catch {
    return { importKwh: 0, exportKwh: 0, netKwh: 0 };
  }
}

async function computeInsightsFromDb(args: {
  source: "SMT" | "GREEN_BUTTON";
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
    if (args.source === "SMT") {
      const esiid = String(args.esiid ?? "").trim();
      if (!esiid) return empty;
      const dailyRows = await prisma.$queryRaw<Array<{ date: string; kwh: number }>>(Prisma.sql`
        WITH iv AS (
          SELECT "ts", MAX(CASE WHEN "kwh" >= 0 THEN "kwh" ELSE 0 END)::float AS kwh
          FROM "SmtInterval" WHERE "esiid" = ${esiid} AND "ts" >= ${args.cutoff}
          GROUP BY "ts"
        )
        SELECT to_char((("ts" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago')::date, 'YYYY-MM-DD') AS date, COALESCE(SUM("kwh"), 0)::float AS kwh
        FROM iv GROUP BY 1 ORDER BY 1 ASC
      `);
      const dailyTotals = dailyRows.map((r) => ({ date: String(r.date), kwh: round2(r.kwh) }));
      const peakDay = dailyTotals.length > 0 ? dailyTotals.reduce((a, b) => (b.kwh > a.kwh ? b : a)) : null;
      const monthlyRows = await prisma.$queryRaw<Array<{ month: string; kwh: number }>>(Prisma.sql`
        WITH iv AS (
          SELECT "ts", MAX(CASE WHEN "kwh" >= 0 THEN "kwh" ELSE 0 END)::float AS kwh
          FROM "SmtInterval" WHERE "esiid" = ${esiid} AND "ts" >= ${args.cutoff}
          GROUP BY "ts"
        )
        SELECT to_char(date_trunc('month', (("ts" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago'))::date, 'YYYY-MM') AS month, COALESCE(SUM("kwh"), 0)::float AS kwh
        FROM iv GROUP BY 1 ORDER BY 1 ASC
      `);
      const monthlyTotals = monthlyRows.map((r) => ({ month: String(r.month), kwh: round2(r.kwh) }));
      const fifteenRows = await prisma.$queryRaw<Array<{ hhmm: string; avgkw: number }>>(Prisma.sql`
        WITH iv AS (
          SELECT "ts", MAX(CASE WHEN "kwh" >= 0 THEN "kwh" ELSE 0 END)::float AS kwh
          FROM "SmtInterval" WHERE "esiid" = ${esiid} AND "ts" >= ${args.cutoff}
          GROUP BY "ts"
        )
        SELECT to_char((("ts" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago'), 'HH24:MI') AS hhmm, AVG(("kwh" * 4))::float AS avgkw
        FROM iv GROUP BY 1 ORDER BY 1 ASC
      `);
      const fifteenMinuteAverages = fifteenRows.map((r) => ({ hhmm: String(r.hhmm), avgKw: round2(r.avgkw) }));
      const todRows = await prisma.$queryRaw<Array<{ key: string; label: string; sort: number; kwh: number }>>(
        Prisma.sql`
        SELECT key, label, sort, SUM("kwh")::float AS kwh FROM (
          SELECT
            CASE WHEN EXTRACT(HOUR FROM (("ts" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago')) < 6 THEN 'overnight'
                 WHEN EXTRACT(HOUR FROM (("ts" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago')) < 12 THEN 'morning'
                 WHEN EXTRACT(HOUR FROM (("ts" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago')) < 18 THEN 'afternoon'
                 ELSE 'evening' END AS key,
            CASE WHEN EXTRACT(HOUR FROM (("ts" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago')) < 6 THEN 'Overnight (12am–6am)'
                 WHEN EXTRACT(HOUR FROM (("ts" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago')) < 12 THEN 'Morning (6am–12pm)'
                 WHEN EXTRACT(HOUR FROM (("ts" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago')) < 18 THEN 'Afternoon (12pm–6pm)'
                 ELSE 'Evening (6pm–12am)' END AS label,
            CASE WHEN EXTRACT(HOUR FROM (("ts" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago')) < 6 THEN 1
                 WHEN EXTRACT(HOUR FROM (("ts" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago')) < 12 THEN 2
                 WHEN EXTRACT(HOUR FROM (("ts" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago')) < 18 THEN 3 ELSE 4 END AS sort,
            "kwh"
          FROM (SELECT "ts", MAX(CASE WHEN "kwh" >= 0 THEN "kwh" ELSE 0 END)::float AS kwh FROM "SmtInterval" WHERE "esiid" = ${esiid} AND "ts" >= ${args.cutoff} GROUP BY "ts") iv
        ) t GROUP BY key, label, sort ORDER BY sort ASC
      `
      );
      const timeOfDayBuckets = todRows.map((r) => ({ key: String(r.key), label: String(r.label), kwh: round2(r.kwh) }));
      const peakHourRows = await prisma.$queryRaw<Array<{ hour: number; sumkwh: number }>>(Prisma.sql`
        SELECT EXTRACT(HOUR FROM (("ts" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago'))::int AS hour, SUM("kwh")::float AS sumkwh
        FROM (SELECT "ts", MAX(CASE WHEN "kwh" >= 0 THEN "kwh" ELSE 0 END)::float AS kwh FROM "SmtInterval" WHERE "esiid" = ${esiid} AND "ts" >= ${args.cutoff} GROUP BY "ts") iv
        GROUP BY 1 ORDER BY sumkwh DESC LIMIT 1
      `);
      const peakHour = peakHourRows?.[0] ? { hour: Number(peakHourRows[0].hour), kw: round2(Number(peakHourRows[0].sumkwh) * 4) } : null;
      const baseloadRows = await prisma.$queryRaw<Array<{ baseload: number | null }>>(Prisma.sql`
        WITH t AS (SELECT ("kwh" * 4)::float AS kw FROM (SELECT "ts", MAX(CASE WHEN "kwh" >= 0 THEN "kwh" ELSE 0 END)::float AS kwh FROM "SmtInterval" WHERE "esiid" = ${esiid} AND "ts" >= ${args.cutoff} GROUP BY "ts") iv),
             p AS (SELECT percentile_cont(0.10) WITHIN GROUP (ORDER BY kw) AS p10 FROM t)
        SELECT AVG(t.kw)::float AS baseload FROM t, p WHERE t.kw <= p.p10
      `);
      const baseload = baseloadRows?.[0]?.baseload == null ? null : round2(Number(baseloadRows[0].baseload));
      const dowRows = await prisma.$queryRaw<Array<{ weekdaykwh: number; weekendkwh: number }>>(Prisma.sql`
        SELECT COALESCE(SUM(CASE WHEN EXTRACT(DOW FROM "ts") IN (0,6) THEN 0 ELSE "kwh" END)::float, 0) AS weekdaykwh,
               COALESCE(SUM(CASE WHEN EXTRACT(DOW FROM "ts") IN (0,6) THEN "kwh" ELSE 0 END)::float, 0) AS weekendkwh
        FROM (SELECT "ts", MAX(CASE WHEN "kwh" >= 0 THEN "kwh" ELSE 0 END)::float AS kwh FROM "SmtInterval" WHERE "esiid" = ${esiid} AND "ts" >= ${args.cutoff} GROUP BY "ts") iv
      `);
      const weekday = round2(dowRows?.[0]?.weekdaykwh ?? 0);
      const weekend = round2(dowRows?.[0]?.weekendkwh ?? 0);
      return { dailyTotals, monthlyTotals, fifteenMinuteAverages, timeOfDayBuckets, peakDay, peakHour, baseload, weekdayVsWeekend: { weekday, weekend } };
    }
    if (!USAGE_DB_ENABLED) return empty;
    const usageClient = usagePrisma as any;
    const houseId = String(args.houseId ?? "").trim();
    const rawId = String(args.rawId ?? "").trim();
    if (!houseId || !rawId) return empty;
    const dailyRows = (await usageClient.$queryRaw(Prisma.sql`
      SELECT to_char(("timestamp" AT TIME ZONE 'America/Chicago')::date, 'YYYY-MM-DD') AS date, SUM("consumptionKwh")::float AS kwh
      FROM "GreenButtonInterval" WHERE "homeId" = ${houseId} AND "rawId" = ${rawId} AND "timestamp" >= ${args.cutoff}
      GROUP BY 1 ORDER BY 1 ASC
    `)) as Array<{ date: string; kwh: number }>;
    const dailyTotals = dailyRows.map((r) => ({ date: String(r.date), kwh: round2(r.kwh) }));
    const peakDay = dailyTotals.length > 0 ? dailyTotals.reduce((a, b) => (b.kwh > a.kwh ? b : a)) : null;
    const monthlyRows = (await usageClient.$queryRaw(Prisma.sql`
      SELECT to_char(date_trunc('month', "timestamp")::date, 'YYYY-MM') AS month, SUM("consumptionKwh")::float AS kwh
      FROM "GreenButtonInterval" WHERE "homeId" = ${houseId} AND "rawId" = ${rawId} AND "timestamp" >= ${args.cutoff}
      GROUP BY 1 ORDER BY 1 ASC
    `)) as Array<{ month: string; kwh: number }>;
    const monthlyTotals = monthlyRows.map((r) => ({ month: String(r.month), kwh: round2(r.kwh) }));
    const fifteenRows = (await usageClient.$queryRaw(Prisma.sql`
      SELECT to_char("timestamp", 'HH24:MI') AS hhmm, AVG(("consumptionKwh" * 4))::float AS avgkw
      FROM "GreenButtonInterval" WHERE "homeId" = ${houseId} AND "rawId" = ${rawId} AND "timestamp" >= ${args.cutoff}
      GROUP BY 1 ORDER BY 1 ASC
    `)) as Array<{ hhmm: string; avgkw: number }>;
    const fifteenMinuteAverages = fifteenRows.map((r) => ({ hhmm: String(r.hhmm), avgKw: round2(r.avgkw) }));
    const todRows = (await usageClient.$queryRaw(Prisma.sql`
      SELECT key, label, sort, SUM("consumptionKwh")::float AS kwh FROM (
        SELECT CASE WHEN EXTRACT(HOUR FROM ("timestamp" AT TIME ZONE 'America/Chicago')) < 6 THEN 'overnight'
                    WHEN EXTRACT(HOUR FROM ("timestamp" AT TIME ZONE 'America/Chicago')) < 12 THEN 'morning'
                    WHEN EXTRACT(HOUR FROM ("timestamp" AT TIME ZONE 'America/Chicago')) < 18 THEN 'afternoon' ELSE 'evening' END AS key,
               CASE WHEN EXTRACT(HOUR FROM ("timestamp" AT TIME ZONE 'America/Chicago')) < 6 THEN 'Overnight (12am–6am)'
                    WHEN EXTRACT(HOUR FROM ("timestamp" AT TIME ZONE 'America/Chicago')) < 12 THEN 'Morning (6am–12pm)'
                    WHEN EXTRACT(HOUR FROM ("timestamp" AT TIME ZONE 'America/Chicago')) < 18 THEN 'Afternoon (12pm–6pm)' ELSE 'Evening (6pm–12am)' END AS label,
               CASE WHEN EXTRACT(HOUR FROM ("timestamp" AT TIME ZONE 'America/Chicago')) < 6 THEN 1
                    WHEN EXTRACT(HOUR FROM ("timestamp" AT TIME ZONE 'America/Chicago')) < 12 THEN 2
                    WHEN EXTRACT(HOUR FROM ("timestamp" AT TIME ZONE 'America/Chicago')) < 18 THEN 3 ELSE 4 END AS sort,
               "consumptionKwh"
        FROM "GreenButtonInterval" WHERE "homeId" = ${houseId} AND "rawId" = ${rawId} AND "timestamp" >= ${args.cutoff}
      ) t GROUP BY key, label, sort ORDER BY sort ASC
    `)) as Array<{ key: string; label: string; sort: number; kwh: number }>;
    const timeOfDayBuckets = todRows.map((r) => ({ key: String(r.key), label: String(r.label), kwh: round2(r.kwh) }));
    const peakHourRows = (await usageClient.$queryRaw(Prisma.sql`
      SELECT EXTRACT(HOUR FROM "timestamp")::int AS hour, SUM("consumptionKwh")::float AS sumkwh
      FROM "GreenButtonInterval" WHERE "homeId" = ${houseId} AND "rawId" = ${rawId} AND "timestamp" >= ${args.cutoff}
      GROUP BY 1 ORDER BY sumkwh DESC LIMIT 1
    `)) as Array<{ hour: number; sumkwh: number }>;
    const peakHour = peakHourRows?.[0] ? { hour: Number(peakHourRows[0].hour), kw: round2(Number(peakHourRows[0].sumkwh) * 4) } : null;
    const baseloadRows = (await usageClient.$queryRaw(Prisma.sql`
      WITH t AS (SELECT ("consumptionKwh" * 4)::float AS kw FROM "GreenButtonInterval" WHERE "homeId" = ${houseId} AND "rawId" = ${rawId} AND "timestamp" >= ${args.cutoff}),
           p AS (SELECT percentile_cont(0.10) WITHIN GROUP (ORDER BY kw) AS p10 FROM t)
      SELECT AVG(t.kw)::float AS baseload FROM t, p WHERE t.kw <= p.p10
    `)) as Array<{ baseload: number | null }>;
    const baseload = baseloadRows?.[0]?.baseload == null ? null : round2(Number(baseloadRows[0].baseload));
    const dowRows = (await usageClient.$queryRaw(Prisma.sql`
      SELECT COALESCE(SUM(CASE WHEN EXTRACT(DOW FROM "timestamp") IN (0,6) THEN 0 ELSE "consumptionKwh" END)::float, 0) AS weekdaykwh,
             COALESCE(SUM(CASE WHEN EXTRACT(DOW FROM "timestamp") IN (0,6) THEN "consumptionKwh" ELSE 0 END)::float, 0) AS weekendkwh
      FROM "GreenButtonInterval" WHERE "homeId" = ${houseId} AND "rawId" = ${rawId} AND "timestamp" >= ${args.cutoff}
    `)) as Array<{ weekdaykwh: number; weekendkwh: number }>;
    const weekday = round2(dowRows?.[0]?.weekdaykwh ?? 0);
    const weekend = round2(dowRows?.[0]?.weekendkwh ?? 0);
    return { dailyTotals, monthlyTotals, fifteenMinuteAverages, timeOfDayBuckets, peakDay, peakHour, baseload, weekdayVsWeekend: { weekday, weekend } };
  } catch {
    return empty;
  }
}

const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;
function validDateKeys(keys: string[]): string[] {
  return keys.filter((k) => typeof k === "string" && YYYY_MM_DD.test(String(k).trim()));
}

/**
 * Baseload from actual usage excluding given date keys (e.g. travel/vacant days).
 * Used by the simulator for Past/Future so only non-vacant days determine always-on power.
 */
export async function getBaseloadFromActualExcludingDates(args: {
  houseId: string;
  esiid: string | null;
  source: "SMT" | "GREEN_BUTTON";
  latestIso: string;
  excludeDateKeys: string[];
}): Promise<number | null> {
  const latestIso = String(args.latestIso ?? "").trim().slice(0, 10);
  if (!YYYY_MM_DD.test(latestIso)) return null;
  const latest = new Date(latestIso + "T12:00:00.000Z");
  if (!Number.isFinite(latest.getTime())) return null;
  const cutoff = new Date(latest.getTime() - 365 * DAY_MS);
  const excludeDateKeys = validDateKeys(args.excludeDateKeys ?? []);

  try {
    if (args.source === "SMT") {
      const esiid = String(args.esiid ?? "").trim();
      if (!esiid) return null;
      const dateFilter =
        excludeDateKeys.length === 0
          ? Prisma.sql``
          : Prisma.sql` AND to_char((("ts" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago')::date, 'YYYY-MM-DD') NOT IN (${Prisma.join(excludeDateKeys.map((d) => Prisma.sql`${d}`), ", ")})`;
      const baseloadRows = await prisma.$queryRaw<Array<{ baseload: number | null }>>(Prisma.sql`
        WITH iv AS (
          SELECT "ts", MAX(CASE WHEN "kwh" >= 0 THEN "kwh" ELSE 0 END)::float AS kwh
          FROM "SmtInterval" WHERE "esiid" = ${esiid} AND "ts" >= ${cutoff}
          ${dateFilter}
          GROUP BY "ts"
        ),
        t AS (SELECT ("kwh" * 4)::float AS kw FROM iv),
        p AS (SELECT percentile_cont(0.10) WITHIN GROUP (ORDER BY kw) AS p10 FROM t)
        SELECT AVG(t.kw)::float AS baseload FROM t, p WHERE t.kw <= p.p10
      `);
      const baseload = baseloadRows?.[0]?.baseload;
      return baseload != null && Number.isFinite(baseload) ? round2(Number(baseload)) : null;
    }
    if (!USAGE_DB_ENABLED) return null;
    const usageClient = usagePrisma as any;
    const houseId = String(args.houseId ?? "").trim();
    if (!houseId) return null;
    const latestRaw = await usageClient.rawGreenButton.findFirst({
      where: { homeId: houseId },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    const rawId = latestRaw?.id ?? null;
    if (!rawId) return null;
    const dateFilter =
      excludeDateKeys.length === 0
        ? Prisma.sql``
        : Prisma.sql` AND to_char(("timestamp" AT TIME ZONE 'America/Chicago')::date, 'YYYY-MM-DD') NOT IN (${Prisma.join(excludeDateKeys.map((d) => Prisma.sql`${d}`), ", ")})`;
    const baseloadRows = (await usageClient.$queryRaw(Prisma.sql`
      WITH t AS (
        SELECT ("consumptionKwh" * 4)::float AS kw
        FROM "GreenButtonInterval"
        WHERE "homeId" = ${houseId} AND "rawId" = ${rawId} AND "timestamp" >= ${cutoff}
        ${dateFilter}
      ),
      p AS (SELECT percentile_cont(0.10) WITHIN GROUP (ORDER BY kw) AS p10 FROM t)
      SELECT AVG(t.kw)::float AS baseload FROM t, p WHERE t.kw <= p.p10
    `)) as Array<{ baseload: number | null }>;
    const baseload = baseloadRows?.[0]?.baseload;
    return baseload != null && Number.isFinite(baseload) ? round2(Number(baseload)) : null;
  } catch {
    return null;
  }
}

async function getGreenButtonWindow(usageClient: any, houseId: string, rawId: string) {
  const latest = await usageClient.greenButtonInterval.findFirst({
    where: { homeId: houseId, rawId },
    orderBy: { timestamp: "desc" },
    select: { timestamp: true },
  });
  if (!latest?.timestamp) return null;
  const cutoff = new Date(latest.timestamp.getTime() - 365 * DAY_MS);
  return { latest: latest.timestamp, cutoff };
}

async function getSmtWindow(esiid: string) {
  const latest = await prisma.smtInterval.findFirst({
    where: { esiid },
    orderBy: { ts: "desc" },
    select: { ts: true },
  });
  if (!latest?.ts) return null;
  const cutoff = new Date(latest.ts.getTime() - 365 * DAY_MS);
  return { latest: latest.ts, cutoff };
}

function chooseDataset(smt: UsageDatasetResult | null, greenButton: UsageDatasetResult | null): UsageDatasetResult | null {
  const latestMs = (d: UsageDatasetResult | null): number => {
    if (!d?.summary?.latest) return 0;
    const t = new Date(d.summary.latest).getTime();
    return Number.isFinite(t) ? t : 0;
  };
  const smtLatest = latestMs(smt);
  const gbLatest = latestMs(greenButton);
  if (smtLatest === 0 && gbLatest === 0) return null;
  if (smtLatest === gbLatest) return smt ?? greenButton;
  return smtLatest > gbLatest ? smt! : greenButton!;
}

async function fetchSmtDataset(esiid: string | null): Promise<UsageDatasetResult | null> {
  if (!esiid) return null;
  const window = await getSmtWindow(esiid);
  if (!window) return null;
  try {
    const meters = await prisma.smtInterval.findMany({ where: { esiid }, distinct: ["meter"], select: { meter: true }, take: 5 });
    const meterValues = meters.map((m) => String(m.meter ?? "").trim()).filter(Boolean);
    if (meterValues.includes("unknown") && meterValues.some((m) => m !== "unknown")) {
      await prisma.$executeRaw(Prisma.sql`
        DELETE FROM "SmtInterval" u USING "SmtInterval" r
        WHERE u."esiid" = ${esiid} AND u."meter" = 'unknown' AND r."esiid" = u."esiid" AND r."ts" = u."ts" AND r."meter" <> u."meter"
      `);
    }
  } catch {}
  const aggRows = await prisma.$queryRaw<
    Array<{ intervalscount: number; importkwh: number; exportkwh: number; start: Date | null; end: Date | null }>
  >(Prisma.sql`
    WITH iv AS (
      SELECT "ts", MAX(CASE WHEN "kwh" >= 0 THEN "kwh" ELSE 0 END)::float AS importkwh, MAX(CASE WHEN "kwh" < 0 THEN ABS("kwh") ELSE 0 END)::float AS exportkwh
      FROM "SmtInterval" WHERE "esiid" = ${esiid} AND "ts" >= ${window.cutoff} GROUP BY "ts"
    )
    SELECT COUNT(*)::int AS intervalsCount, COALESCE(SUM(importkwh), 0)::float AS importkwh, COALESCE(SUM(exportkwh), 0)::float AS exportkwh, MIN("ts") AS start, MAX("ts") AS end FROM iv
  `);
  const agg = aggRows?.[0] ?? null;
  const count = Number(agg?.intervalscount ?? 0);
  if (count === 0) return null;
  const importKwh = round2(Number(agg?.importkwh ?? 0));
  const exportKwh = round2(Number(agg?.exportkwh ?? 0));
  const totalKwh = round2(importKwh - exportKwh);
  const start = agg?.start ?? null;
  const end = agg?.end ?? null;
  const recentIntervals = await prisma.$queryRaw<Array<{ ts: Date; kwh: number }>>(Prisma.sql`
    SELECT DISTINCT ON ("ts") "ts", GREATEST("kwh", 0)::float AS kwh
    FROM "SmtInterval" WHERE "esiid" = ${esiid} AND "ts" >= ${window.cutoff}
    ORDER BY "ts" DESC, CASE WHEN "meter" = 'unknown' THEN 1 ELSE 0 END ASC, "updatedAt" DESC
    LIMIT 192
  `);
  const intervals15 = recentIntervals.map((row) => ({ timestamp: row.ts.toISOString(), kwh: decimalToNumber(row.kwh) })).reverse();
  const hourlyRows = await prisma.$queryRaw<Array<{ bucket: Date; kwh: number }>>(Prisma.sql`
    WITH iv AS (SELECT "ts", MAX(CASE WHEN "kwh" >= 0 THEN "kwh" ELSE 0 END)::float AS kwh FROM "SmtInterval" WHERE "esiid" = ${esiid} AND "ts" >= ${window.cutoff} AND "ts" >= NOW() - INTERVAL '14 days' GROUP BY "ts")
    SELECT date_trunc('hour', "ts") AS bucket, COALESCE(SUM("kwh"), 0)::float AS kwh FROM iv GROUP BY bucket ORDER BY bucket ASC
  `);
  const dailyRows = await prisma.$queryRaw<Array<{ bucket: Date; kwh: number }>>(Prisma.sql`
    WITH iv AS (SELECT "ts", MAX(CASE WHEN "kwh" >= 0 THEN "kwh" ELSE 0 END)::float AS kwh FROM "SmtInterval" WHERE "esiid" = ${esiid} AND "ts" >= ${window.cutoff} GROUP BY "ts")
    SELECT date_trunc('day', (("ts" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago')) AT TIME ZONE 'America/Chicago' AS bucket, COALESCE(SUM("kwh"), 0)::float AS kwh FROM iv GROUP BY bucket ORDER BY bucket DESC LIMIT 400
  `);
  const monthlyRows = await prisma.$queryRaw<Array<{ bucket: Date; kwh: number }>>(Prisma.sql`
    WITH iv AS (SELECT "ts", MAX(CASE WHEN "kwh" >= 0 THEN "kwh" ELSE 0 END)::float AS kwh FROM "SmtInterval" WHERE "esiid" = ${esiid} AND "ts" >= ${window.cutoff} GROUP BY "ts")
    SELECT date_trunc('month', (("ts" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Chicago')) AT TIME ZONE 'America/Chicago' AS bucket, COALESCE(SUM("kwh"), 0)::float AS kwh FROM iv GROUP BY bucket ORDER BY bucket DESC LIMIT 120
  `);
  const annualRows = await prisma.$queryRaw<Array<{ bucket: Date; kwh: number }>>(Prisma.sql`
    WITH iv AS (SELECT "ts", MAX(CASE WHEN "kwh" >= 0 THEN "kwh" ELSE 0 END)::float AS kwh FROM "SmtInterval" WHERE "esiid" = ${esiid} AND "ts" >= ${window.cutoff} GROUP BY "ts")
    SELECT date_trunc('year', "ts") AS bucket, COALESCE(SUM("kwh"), 0)::float AS kwh FROM iv GROUP BY bucket ORDER BY bucket ASC
  `);
  return {
    summary: { source: "SMT", intervalsCount: count, totalKwh, start: start ? chicagoDateKey(start) : null, end: end ? chicagoDateKey(end) : null, latest: end ? end.toISOString() : null },
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
  if (!USAGE_DB_ENABLED) return null;
  try {
    const usageClient = usagePrisma as any;
    const latestRaw = await usageClient.rawGreenButton.findFirst({ where: { homeId: houseId }, orderBy: { createdAt: "desc" }, select: { id: true } });
    if (!latestRaw) return null;
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
    if (count === 0) return null;
    const totalKwh = decimalToNumber(aggregates._sum?.consumptionKwh ?? 0);
    const start = aggregates._min?.timestamp ?? null;
    const end = aggregates._max?.timestamp ?? null;
    const recentIntervals = (await usageClient.greenButtonInterval.findMany({
      where: { homeId: houseId, rawId: latestRaw.id, timestamp: { gte: window.cutoff } },
      orderBy: { timestamp: "desc" },
      take: 192,
    })) as Array<{ timestamp: Date; consumptionKwh: Prisma.Decimal | number }>;
    const intervals15 = recentIntervals.map((row) => ({ timestamp: row.timestamp.toISOString(), kwh: decimalToNumber(row.consumptionKwh) })).reverse();
    const hourlyRowsRaw = await usageClient.$queryRaw(Prisma.sql`
      SELECT date_trunc('hour', "timestamp") AS bucket, SUM("consumptionKwh")::float AS kwh
      FROM "GreenButtonInterval" WHERE "homeId" = ${houseId} AND "rawId" = ${latestRaw.id} AND "timestamp" >= ${window.cutoff} AND "timestamp" >= NOW() - INTERVAL '14 days'
      GROUP BY bucket ORDER BY bucket ASC
    `);
    const hourlyRows = hourlyRowsRaw as Array<{ bucket: Date; kwh: number }>;
    const dailyRowsRaw = await usageClient.$queryRaw(Prisma.sql`
      SELECT date_trunc('day', "timestamp" AT TIME ZONE 'America/Chicago') AT TIME ZONE 'UTC' AS bucket, SUM("consumptionKwh")::float AS kwh
      FROM "GreenButtonInterval" WHERE "homeId" = ${houseId} AND "rawId" = ${latestRaw.id} AND "timestamp" >= ${window.cutoff}
      GROUP BY bucket ORDER BY bucket DESC LIMIT 400
    `);
    const dailyRows = dailyRowsRaw as Array<{ bucket: Date; kwh: number }>;
    const monthlyRowsRaw = await usageClient.$queryRaw(Prisma.sql`
      SELECT date_trunc('month', "timestamp") AS bucket, SUM("consumptionKwh")::float AS kwh
      FROM "GreenButtonInterval" WHERE "homeId" = ${houseId} AND "rawId" = ${latestRaw.id} AND "timestamp" >= ${window.cutoff}
      GROUP BY bucket ORDER BY bucket DESC LIMIT 120
    `);
    const monthlyRows = monthlyRowsRaw as Array<{ bucket: Date; kwh: number }>;
    const annualRowsRaw = await usageClient.$queryRaw(Prisma.sql`
      SELECT date_trunc('year', "timestamp") AS bucket, SUM("consumptionKwh")::float AS kwh
      FROM "GreenButtonInterval" WHERE "homeId" = ${houseId} AND "rawId" = ${latestRaw.id} AND "timestamp" >= ${window.cutoff}
      GROUP BY bucket ORDER BY bucket ASC
    `);
    const annualRows = annualRowsRaw as Array<{ bucket: Date; kwh: number }>;
    return {
      summary: { source: "GREEN_BUTTON", intervalsCount: count, totalKwh, start: start ? start.toISOString() : null, end: end ? end.toISOString() : null, latest: end ? end.toISOString() : null },
      series: {
        intervals15,
        hourly: toSeriesPoint(hourlyRows),
        daily: fillDailyGaps(toSeriesPoint(dailyRows), start?.toISOString() ?? null, end?.toISOString() ?? null),
        monthly: toSeriesPoint(monthlyRows),
        annual: toSeriesPoint(annualRows),
      },
    };
  } catch {
    return null;
  }
}

/**
 * Returns the actual usage dataset for a single house (same shape and data as the Usage page).
 * Use this when the simulator serves BASELINE with SMT or Green Button so baseline = actual usage.
 */
export async function getActualUsageDatasetForHouse(
  houseId: string,
  esiid: string | null
): Promise<{ dataset: ActualHouseDataset | null; alternatives: { smt: UsageSummary | null; greenButton: UsageSummary | null } }> {
  let smtDataset: UsageDatasetResult | null = null;
  let greenDataset: UsageDatasetResult | null = null;
  try {
    smtDataset = await fetchSmtDataset(esiid);
  } catch {
    smtDataset = null;
  }
  try {
    greenDataset = await fetchGreenButtonDataset(houseId);
  } catch {
    greenDataset = null;
  }
  const selected = chooseDataset(smtDataset, greenDataset);

  let stitchedMonthlyTotals: Array<{ month: string; kwh: number }> | null = null;
  let stitchedMonthMeta: unknown = null;
  try {
    if (selected?.summary?.source === "SMT" && esiid && selected.summary.latest) {
      const latest = new Date(selected.summary.latest);
      if (Number.isFinite(latest.getTime())) {
        const cutoff = new Date(latest.getTime() - 365 * DAY_MS);
        const bucketBuild = await buildUsageBucketsForEstimate({
          homeId: houseId,
          usageSource: "SMT",
          esiid,
          rawId: null,
          windowEnd: latest,
          cutoff,
          requiredBucketKeys: ["kwh.m.all.total"],
          monthsCount: 12,
          maxStepDays: 2,
          stitchMode: "DAILY_OR_INTERVAL",
        });
        stitchedMonthlyTotals = bucketBuild.yearMonths.map((ym) => ({
          month: ym,
          kwh: Number(bucketBuild.usageBucketsByMonth?.[ym]?.["kwh.m.all.total"] ?? 0) || 0,
        }));
        stitchedMonthMeta = bucketBuild.stitchedMonth ?? null;
      }
    }
  } catch {
    stitchedMonthlyTotals = null;
    stitchedMonthMeta = null;
  }

  const emptyInsights = {
    fifteenMinuteAverages: [] as Array<{ hhmm: string; avgKw: number }>,
    timeOfDayBuckets: [] as Array<{ key: string; label: string; kwh: number }>,
    peakDay: null as { date: string; kwh: number } | null,
    peakHour: null as { hour: number; kw: number } | null,
    baseload: null as number | null,
    weekdayVsWeekend: { weekday: 0, weekend: 0 },
  };
  let insights: Record<string, unknown> = { ...emptyInsights };
  let dailyTotals: Array<{ date: string; kwh: number }> = [];
  let monthlyTotals: Array<{ month: string; kwh: number }> = [];
  let totals: ImportExportTotals = { importKwh: 0, exportKwh: 0, netKwh: 0 };
  try {
    const latestIso = selected?.summary?.latest ?? null;
    const latest = latestIso ? new Date(latestIso) : null;
    if (selected?.summary?.source && latest && Number.isFinite(latest.getTime())) {
      const cutoff = new Date(latest.getTime() - 365 * DAY_MS);
      let rawId: string | null = null;
      if (selected.summary.source === "GREEN_BUTTON") {
        const usageClient = usagePrisma as any;
        const latestRaw = await usageClient.rawGreenButton.findFirst({ where: { homeId: houseId }, orderBy: { createdAt: "desc" }, select: { id: true } });
        rawId = latestRaw?.id ?? null;
      }
      const computed = await computeInsightsFromDb({ source: selected.summary.source, esiid, houseId, rawId, cutoff });
      dailyTotals = computed.dailyTotals;
      monthlyTotals = computed.monthlyTotals;
      totals = await computeImportExportTotalsFromDb({ source: selected.summary.source, esiid, houseId, rawId, cutoff });
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
    insights = { ...emptyInsights };
    dailyTotals = [];
    monthlyTotals = [];
    totals = { importKwh: 0, exportKwh: 0, netKwh: 0 };
  }

  const dataset: ActualHouseDataset | null = selected
    ? {
        summary: selected.summary,
        series: selected.series,
        daily: dailyTotals,
        monthly: stitchedMonthlyTotals ?? monthlyTotals,
        insights,
        totals,
      }
    : null;

  return {
    dataset,
    alternatives: {
      smt: smtDataset?.summary ?? null,
      greenButton: greenDataset?.summary ?? null,
    },
  };
}

/** 15-min interval point for the full window. Used by Past stitched curve. */
export type ActualIntervalPoint = { timestamp: string; kwh: number };

/**
 * Fetches all actual 15-min intervals for a house in a date range (inclusive).
 * Used when building Past so unchanged segments use real usage intervals.
 */
export async function getActualIntervalsForRange(args: {
  houseId: string;
  esiid: string | null;
  startDate: string;
  endDate: string;
}): Promise<ActualIntervalPoint[]> {
  const start = new Date(args.startDate + "T00:00:00.000Z");
  const end = new Date(args.endDate + "T23:59:59.999Z");
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start.getTime() > end.getTime()) {
    return [];
  }
  const source = await chooseActualSource({ houseId: args.houseId, esiid: args.esiid });
  if (!source) return [];
  if (source === "SMT") {
    if (!args.esiid) return [];
    try {
      const rows = await prisma.$queryRaw<Array<{ ts: Date; kwh: number }>>(Prisma.sql`
        WITH iv AS (
          SELECT "ts", MAX(CASE WHEN "kwh" >= 0 THEN "kwh" ELSE 0 END)::float AS kwh
          FROM "SmtInterval"
          WHERE "esiid" = ${args.esiid} AND "ts" >= ${start} AND "ts" <= ${end}
          GROUP BY "ts"
        )
        SELECT "ts", kwh FROM iv ORDER BY "ts" ASC
      `);
      return rows.map((r) => ({ timestamp: r.ts.toISOString(), kwh: Number(r.kwh) || 0 }));
    } catch {
      return [];
    }
  }
  if (!USAGE_DB_ENABLED) return [];
  try {
    const usageClient = usagePrisma as any;
    const latestRaw = await usageClient.rawGreenButton.findFirst({
      where: { homeId: args.houseId },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (!latestRaw?.id) return [];
    const rows = (await usageClient.$queryRaw(Prisma.sql`
      SELECT "timestamp" AS ts, "consumptionKwh"::float AS kwh
      FROM "GreenButtonInterval"
      WHERE "homeId" = ${args.houseId} AND "rawId" = ${latestRaw.id}
        AND "timestamp" >= ${start} AND "timestamp" <= ${end}
      ORDER BY "timestamp" ASC
    `)) as Array<{ ts: Date; kwh: number }>;
    return rows.map((r) => ({
      timestamp: (r.ts instanceof Date ? r.ts : new Date(r.ts)).toISOString(),
      kwh: Number(r.kwh) || 0,
    }));
  } catch {
    return [];
  }
}