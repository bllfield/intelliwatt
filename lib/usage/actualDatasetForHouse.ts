/**
 * Shared logic to get the actual usage dataset for a single house (SMT or Green Button).
 * Used by the Usage API and by the simulator when serving BASELINE with actual data,
 * so the baseline shows the exact same data as the Usage page.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { usagePrisma } from "@/lib/db/usageClient";
import { buildUsageBucketsForEstimate } from "@/lib/usage/buildUsageBucketsForEstimate";
import { getHouseWeatherDays } from "@/modules/weather/repo";
import { ensureHouseWeatherBackfill } from "@/modules/weather/backfill";
import { WEATHER_STUB_SOURCE, WEATHER_STUB_VERSION } from "@/modules/weather/types";
import { chooseActualSource, type ActualUsageSource } from "@/modules/realUsageAdapter/actual";
import {
  getLatestGreenButtonFullDayDateKey,
  getLatestUsableRawGreenButtonIdForHouse,
} from "@/modules/realUsageAdapter/greenButton";
import { CANONICAL_COVERAGE_TOTAL_DAYS } from "@/lib/usage/canonicalCoverageConfig";
import { applySmtLedgerToActualDataset } from "@/lib/usage/smtDayCoverageLedger";
import {
  canonicalCoverageWindowUtcBounds,
  fillCanonicalDailyTotals,
  coverageWindowEndingOnDateKey,
  resolveCanonicalUsage365CoverageWindow,
} from "@/lib/usage/canonicalMetadataWindow";
import {
  buildUtcRangeForChicagoLocalDateRange,
  resolveGreenButtonBaselineCoverageWindow,
} from "@/lib/usage/greenButtonCoverage";
import { chicagoDateKey, dateTimePartsInTimezone, enumerateDateKeysInclusive, prevCalendarDayDateKey } from "@/lib/time/chicago";
import { homeProjectedIntervalFromRecord } from "@/lib/time/actualIntervalCalendar";
import {
  convertGreenButtonPersistedRowsToHome,
  greenButtonHomeIntervalCalendar,
  homeDailyToUsageSeriesPoints as greenButtonHomeDailyToUsageSeriesPoints,
  tailHomeIntervals,
} from "@/lib/time/greenButtonPersistedIntervalConvert";
import {
  convertSmtPersistedRowsToHome,
  homeDailyToUsageSeriesPoints,
  tailIntervals15,
} from "@/lib/time/smtPersistedIntervalConvert";
import { loadHomeTimezoneForHouseId } from "@/lib/time/loadHouseTimezone";
import { resolveHomeTimezone } from "@/lib/time/resolveHomeTimezone";
import { computeHomeBaseloadKw } from "@/lib/usage/computeHomeBaseloadKw";
import { buildDisplayedMonthlyRows } from "@/modules/usageSimulator/monthlyCompareRows";

const DAY_MS = 24 * 60 * 60 * 1000;
const USAGE_DB_ENABLED = Boolean((process.env.USAGE_DATABASE_URL ?? "").trim());

function sqlIanaTimezoneLiteral(homeTz: string): string {
  const resolved = resolveHomeTimezone({ timezone: homeTz });
  if (!/^[A-Za-z0-9_+\-/]+$/.test(resolved)) throw new Error("invalid_home_timezone");
  return resolved.replace(/'/g, "''");
}

function prismaSmtLocalTs(homeTz: string): Prisma.Sql {
  return Prisma.raw(`(("ts" AT TIME ZONE 'UTC') AT TIME ZONE '${sqlIanaTimezoneLiteral(homeTz)}')`);
}

function prismaGbLocalTs(homeTz: string): Prisma.Sql {
  return Prisma.raw(`("timestamp" AT TIME ZONE '${sqlIanaTimezoneLiteral(homeTz)}')`);
}

function normalizeDateKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  if (!Number.isFinite(parsed.getTime())) return null;
  return chicagoDateKey(parsed);
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
  insights?: {
    timeOfDayBuckets?: Array<{ key: string; label: string; kwh: number }>;
  } | null;
};

export type ImportExportTotals = { importKwh: number; exportKwh: number; netKwh: number };

type ActualHouseBaseloadMethod = "FILTERED_NORMAL_LIFE_V1" | "FALLBACK_V1" | "SQL_P10_V1";

export type ActualHouseStitchedMonth = {
  mode: "PRIOR_YEAR_TAIL";
  yearMonth: string;
  haveDaysThrough: number;
  missingDaysFrom: number;
  missingDaysTo: number;
  borrowedFromYearMonth: string;
  completenessRule: string;
};

export type ActualHouseInsights = Record<string, unknown> & {
  fifteenMinuteAverages: Array<{ hhmm: string; avgKw: number }>;
  timeOfDayBuckets: Array<{ key: string; label: string; kwh: number }>;
  stitchedMonth?: ActualHouseStitchedMonth | null;
  peakDay: { date: string; kwh: number } | null;
  peakHour: { hour: number; kw: number } | null;
  baseload: number | null;
  baseloadMethod?: ActualHouseBaseloadMethod;
  baseloadFallbackUsed?: boolean;
  baseloadDebugNote?: string | null;
  baseloadDaily: number | null;
  baseloadMonthly: number | null;
  weekdayVsWeekend: { weekday: number; weekend: number };
};

/** Same shape as one house's dataset in GET /api/user/usage */
export type ActualHouseDataset = {
  summary: UsageSummary;
  series: UsageDatasetResult["series"];
  daily: Array<{ date: string; kwh: number }>;
  monthly: Array<{ month: string; kwh: number }>;
  insights: ActualHouseInsights | null;
  totals: ImportExportTotals;
  meta?: Record<string, unknown> | null;
  /** When set, daily usage table shows Avg °F, Min °F, Max °F, HDD65, CDD65. */
  dailyWeather?: Record<string, { tAvgF: number; tMinF: number; tMaxF: number; hdd65: number; cdd65: number; source?: string }> | null;
};

function decimalToNumber(value: Prisma.Decimal | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  return Number(value);
}

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function low10Average(values: number[]): number | null {
  const finite = (values ?? []).filter((v) => Number.isFinite(v));
  if (!finite.length) return null;
  const positive = finite.filter((v) => v > 1e-6).sort((a, b) => a - b);
  const count10 = Math.max(1, Math.floor((positive.length || finite.length) * 0.1));
  const slice =
    positive.length >= count10
      ? positive.slice(0, count10)
      : finite.sort((a, b) => a - b).slice(0, Math.max(1, Math.floor(finite.length * 0.1)));
  if (!slice.length) return null;
  const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
  return Number.isFinite(avg) ? round2(avg) : null;
}

/** Same monthly series Usage dashboard charts use (stitched tail month merged). */
function baseloadMonthlyFromDisplayedMonthly(
  monthlyTotals: Array<{ month: string; kwh: number }>,
  stitchedMonth: ActualHouseStitchedMonth | null,
): number | null {
  const displayed = buildDisplayedMonthlyRows({
    monthly: monthlyTotals,
    insights: { stitchedMonth },
  });
  return low10Average(displayed.map((row) => Number(row.kwh) || 0));
}

function percentileCont(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  const w = idx - lo;
  return sorted[lo]! * (1 - w) + sorted[hi]! * w;
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
  const startKey = startIso ? String(startIso).slice(0, 10) : null;
  const endKey = endIso ? String(endIso).slice(0, 10) : null;
  if (!startKey || !endKey || !YYYY_MM_DD.test(startKey) || !YYYY_MM_DD.test(endKey) || endKey < startKey) {
    return points;
  }
  const map = new Map<string, number>();
  for (const p of points) {
    const date = String(p.timestamp ?? "").slice(0, 10);
    if (YYYY_MM_DD.test(date)) map.set(date, p.kwh);
  }
  return enumerateDateKeysInclusive(startKey, endKey).map((date) => ({
    timestamp: `${date}T00:00:00.000Z`,
    kwh: map.get(date) ?? 0,
  }));
}

function homeYearMonth(d: Date, homeTimezone: string): string {
  return dateTimePartsInTimezone(d, homeTimezone)?.yearMonth ?? d.toISOString().slice(0, 7);
}

function deriveDailyTotalsFromSeries(points: UsageSeriesPoint[]): Array<{ date: string; kwh: number }> {
  const byDate = new Map<string, number>();
  for (const point of points) {
    const date =
      typeof point.timestamp === "string" && /^\d{4}-\d{2}-\d{2}/.test(point.timestamp)
        ? point.timestamp.slice(0, 10)
        : normalizeDateKey(point.timestamp);
    if (!date) continue;
    byDate.set(date, round2(Number(point.kwh) || 0));
  }
  return Array.from(byDate.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, kwh]) => ({ date, kwh }));
}

function deriveMonthlyTotalsFromSeries(points: UsageSeriesPoint[]): Array<{ month: string; kwh: number }> {
  const byMonth = new Map<string, number>();
  for (const point of points) {
    const month =
      typeof point.timestamp === "string" && /^\d{4}-\d{2}/.test(point.timestamp)
        ? point.timestamp.slice(0, 7)
        : (() => {
            const dk = normalizeDateKey(point.timestamp);
            return dk ? dk.slice(0, 7) : null;
          })();
    if (!month) continue;
    byMonth.set(month, round2(Number(point.kwh) || 0));
  }
  return Array.from(byMonth.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([month, kwh]) => ({ month, kwh }));
}

function deriveMonthlyTotalsFromDailyTotals(
  dailyTotals: Array<{ date: string; kwh: number }>
): Array<{ month: string; kwh: number }> {
  const byMonth = new Map<string, number>();
  for (const row of dailyTotals) {
    const month = String(row.date ?? "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) continue;
    byMonth.set(month, round2((byMonth.get(month) ?? 0) + (Number(row.kwh) || 0)));
  }
  return Array.from(byMonth.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([month, kwh]) => ({ month, kwh }));
}

async function hydrateActualUsageDailyWeather(args: {
  houseId: string;
  dataset: ActualHouseDataset | null;
}): Promise<void> {
  const dataset = args.dataset;
  if (!dataset || !Array.isArray(dataset.daily) || dataset.daily.length === 0) return;

  const dateKeys = dataset.daily
    .map((row) => String(row?.date ?? "").slice(0, 10))
    .filter((dateKey, index, all) => YYYY_MM_DD.test(dateKey) && all.indexOf(dateKey) === index)
    .sort();
  const firstDateKey = dateKeys[0] ?? null;
  const lastDateKey = dateKeys[dateKeys.length - 1] ?? null;
  if (!firstDateKey || !lastDateKey) return;

  let fallbackReason: "missing_lat_lng" | "api_failure_or_no_data" | "partial_coverage" | null = null;
  try {
    const backfill = await ensureHouseWeatherBackfill({
      houseId: args.houseId,
      startDate: firstDateKey,
      endDate: lastDateKey,
      allowOutsideCanonicalCoverage: true,
    });
    if (backfill.skippedLatLng) fallbackReason = "missing_lat_lng";
  } catch {
    fallbackReason = "api_failure_or_no_data";
  }

  const wxMap = await getHouseWeatherDays({
    houseId: args.houseId,
    dateKeys,
    kind: "ACTUAL_LAST_YEAR",
    version: WEATHER_STUB_VERSION,
  }).catch(() => new Map());

  let weatherActualRowCount = 0;
  let weatherStubRowCount = 0;
  if (wxMap.size > 0) {
    dataset.dailyWeather = Object.fromEntries(
      Array.from(wxMap.entries()).map(([dateKey, w]) => {
        const source = String(w.source ?? "");
        if (source && source !== WEATHER_STUB_SOURCE) weatherActualRowCount += 1;
        else weatherStubRowCount += 1;
        return [
          dateKey,
          {
            tAvgF: w.tAvgF,
            tMinF: w.tMinF,
            tMaxF: w.tMaxF,
            hdd65: w.hdd65,
            cdd65: w.cdd65,
            source,
          },
        ];
      })
    );
  }

  const missingDateCount = Math.max(0, dateKeys.length - wxMap.size);
  if (!fallbackReason && missingDateCount > 0) fallbackReason = "partial_coverage";
  const weatherSourceSummary =
    wxMap.size === 0
      ? "none"
      : weatherActualRowCount > 0 && weatherStubRowCount === 0
        ? "actual_only"
        : weatherActualRowCount === 0 && weatherStubRowCount > 0
          ? "stub_only"
          : "mixed_actual_and_stub";

  dataset.meta = {
    ...(dataset.meta ?? {}),
    weatherSourceSummary,
    weatherFallbackReason: fallbackReason,
    weatherCoverageStart: firstDateKey,
    weatherCoverageEnd: lastDateKey,
    weatherActualRowCount,
    weatherStubRowCount,
    weatherMissingDateCount: missingDateCount,
  };
}

function daysInMonthFromYearMonth(yearMonth: string): number | null {
  const match = String(yearMonth ?? "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null;
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function buildDisplayStitchedMonthMeta(args: {
  monthlyTotals: Array<{ month: string; kwh: number }>;
  coverageEndDateKey: string | null;
}): ActualHouseStitchedMonth | null {
  const coverageEndDateKey = String(args.coverageEndDateKey ?? "").slice(0, 10);
  if (!YYYY_MM_DD.test(coverageEndDateKey)) return null;
  const yearMonth = coverageEndDateKey.slice(0, 7);
  const haveDaysThrough = Number(coverageEndDateKey.slice(8, 10));
  const missingDaysTo = daysInMonthFromYearMonth(yearMonth);
  if (!Number.isFinite(haveDaysThrough) || !Number.isFinite(missingDaysTo) || haveDaysThrough >= (missingDaysTo ?? 0)) {
    return null;
  }
  const year = Number(yearMonth.slice(0, 4));
  const month = yearMonth.slice(5, 7);
  const borrowedFromYearMonth = `${String(year - 1)}-${month}`;
  const months = new Set((args.monthlyTotals ?? []).map((row) => String(row.month ?? "").slice(0, 7)));
  if (!months.has(yearMonth) || !months.has(borrowedFromYearMonth)) return null;
  return {
    mode: "PRIOR_YEAR_TAIL",
    yearMonth,
    haveDaysThrough,
    missingDaysFrom: haveDaysThrough + 1,
    missingDaysTo: missingDaysTo ?? haveDaysThrough,
    borrowedFromYearMonth,
    completenessRule: "ACTUAL_USAGE_WINDOW",
  };
}

function buildDisplayCanonicalMonths(args: {
  monthlyTotals: Array<{ month: string; kwh: number }>;
  stitchedMonth: ActualHouseStitchedMonth | null;
}): string[] {
  const months = Array.from(
    new Set(
      (args.monthlyTotals ?? [])
        .map((row) => String(row.month ?? "").slice(0, 7))
        .filter((month) => /^\d{4}-\d{2}$/.test(month))
    )
  ).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (!args.stitchedMonth) return months;
  return months.filter((month) => month !== args.stitchedMonth?.borrowedFromYearMonth);
}

function deriveWeekdayWeekendFromDailyTotals(dailyTotals: Array<{ date: string; kwh: number }>): { weekday: number; weekend: number } {
  let weekday = 0;
  let weekend = 0;
  for (const row of dailyTotals) {
    const parsed = new Date(`${row.date}T12:00:00.000Z`);
    const day = parsed.getUTCDay();
    if (day === 0 || day === 6) weekend += Number(row.kwh) || 0;
    else weekday += Number(row.kwh) || 0;
  }
  return { weekday: round2(weekday), weekend: round2(weekend) };
}

async function computeImportExportTotalsFromDb(args: {
  source: "SMT" | "GREEN_BUTTON";
  esiid?: string | null;
  houseId?: string | null;
  rawId?: string | null;
  cutoff: Date;
  end: Date;
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
          WHERE "esiid" = ${esiid} AND "ts" >= ${args.cutoff} AND "ts" <= ${args.end}
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
      WHERE "homeId" = ${houseId} AND "rawId" = ${rawId} AND "timestamp" >= ${args.cutoff} AND "timestamp" <= ${args.end}
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
  end: Date;
  homeTimezone: string;
  precomputedDailyTotals?: Array<{ date: string; kwh: number }>;
  precomputedMonthlyTotals?: Array<{ month: string; kwh: number }>;
}): Promise<{
  dailyTotals: Array<{ date: string; kwh: number }>;
  monthlyTotals: Array<{ month: string; kwh: number }>;
  fifteenMinuteAverages: Array<{ hhmm: string; avgKw: number }>;
  timeOfDayBuckets: Array<{ key: string; label: string; kwh: number }>;
  peakDay: { date: string; kwh: number } | null;
  peakHour: { hour: number; kw: number } | null;
  baseload: number | null;
  baseloadMethod?: ActualHouseBaseloadMethod;
  baseloadFallbackUsed?: boolean;
  baseloadDebugNote?: string | null;
  baseloadDaily: number | null;
  baseloadMonthly: number | null;
  weekdayVsWeekend: { weekday: number; weekend: number };
}> {
  const smtLoc = prismaSmtLocalTs(args.homeTimezone);
  const gbLoc = prismaGbLocalTs(args.homeTimezone);
  const empty = {
    dailyTotals: [] as Array<{ date: string; kwh: number }>,
    monthlyTotals: [] as Array<{ month: string; kwh: number }>,
    fifteenMinuteAverages: [] as Array<{ hhmm: string; avgKw: number }>,
    timeOfDayBuckets: [] as Array<{ key: string; label: string; kwh: number }>,
    peakDay: null as { date: string; kwh: number } | null,
    peakHour: null as { hour: number; kw: number } | null,
    baseload: null as number | null,
    baseloadDaily: null as number | null,
    baseloadMonthly: null as number | null,
    weekdayVsWeekend: { weekday: 0, weekend: 0 },
  };
  try {
    if (args.source === "SMT") {
      const esiid = String(args.esiid ?? "").trim();
      if (!esiid) return empty;
      const dailyRows = await prisma.$queryRaw<Array<{ date: string; kwh: number }>>(Prisma.sql`
        WITH iv AS (
          SELECT "ts", MAX(CASE WHEN "kwh" >= 0 THEN "kwh" ELSE 0 END)::float AS kwh
          FROM "SmtInterval" WHERE "esiid" = ${esiid} AND "ts" >= ${args.cutoff} AND "ts" <= ${args.end}
          GROUP BY "ts"
        )
        SELECT to_char((${smtLoc})::date, 'YYYY-MM-DD') AS date, COALESCE(SUM("kwh"), 0)::float AS kwh
        FROM iv GROUP BY 1 ORDER BY 1 ASC
      `);
      const dailyTotals = dailyRows.map((r) => ({ date: String(r.date), kwh: round2(r.kwh) }));
      const peakDay = dailyTotals.length > 0 ? dailyTotals.reduce((a, b) => (b.kwh > a.kwh ? b : a)) : null;
      const monthlyRows = await prisma.$queryRaw<Array<{ month: string; kwh: number }>>(Prisma.sql`
        WITH iv AS (
          SELECT "ts", MAX(CASE WHEN "kwh" >= 0 THEN "kwh" ELSE 0 END)::float AS kwh
          FROM "SmtInterval" WHERE "esiid" = ${esiid} AND "ts" >= ${args.cutoff} AND "ts" <= ${args.end}
          GROUP BY "ts"
        )
        SELECT to_char(date_trunc('month', ${smtLoc})::date, 'YYYY-MM') AS month, COALESCE(SUM("kwh"), 0)::float AS kwh
        FROM iv GROUP BY 1 ORDER BY 1 ASC
      `);
      const monthlyTotals = monthlyRows.map((r) => ({ month: String(r.month), kwh: round2(r.kwh) }));
      const fifteenRows = await prisma.$queryRaw<Array<{ hhmm: string; avgkw: number }>>(Prisma.sql`
        WITH iv AS (
          SELECT "ts", MAX(CASE WHEN "kwh" >= 0 THEN "kwh" ELSE 0 END)::float AS kwh
          FROM "SmtInterval" WHERE "esiid" = ${esiid} AND "ts" >= ${args.cutoff} AND "ts" <= ${args.end}
          GROUP BY "ts"
        )
        SELECT to_char(${smtLoc}, 'HH24:MI') AS hhmm, AVG(("kwh" * 4))::float AS avgkw
        FROM iv GROUP BY 1 ORDER BY 1 ASC
      `);
      const fifteenMinuteAverages = fifteenRows.map((r) => ({ hhmm: String(r.hhmm), avgKw: round2(r.avgkw) }));
      const todRows = await prisma.$queryRaw<Array<{ key: string; label: string; sort: number; kwh: number }>>(
        Prisma.sql`
        SELECT key, label, sort, SUM("kwh")::float AS kwh FROM (
          SELECT
            CASE WHEN EXTRACT(HOUR FROM ${smtLoc}) < 6 THEN 'overnight'
                 WHEN EXTRACT(HOUR FROM ${smtLoc}) < 12 THEN 'morning'
                 WHEN EXTRACT(HOUR FROM ${smtLoc}) < 18 THEN 'afternoon'
                 ELSE 'evening' END AS key,
            CASE WHEN EXTRACT(HOUR FROM ${smtLoc}) < 6 THEN 'Overnight (12am–6am)'
                 WHEN EXTRACT(HOUR FROM ${smtLoc}) < 12 THEN 'Morning (6am–12pm)'
                 WHEN EXTRACT(HOUR FROM ${smtLoc}) < 18 THEN 'Afternoon (12pm–6pm)'
                 ELSE 'Evening (6pm–12am)' END AS label,
            CASE WHEN EXTRACT(HOUR FROM ${smtLoc}) < 6 THEN 1
                 WHEN EXTRACT(HOUR FROM ${smtLoc}) < 12 THEN 2
                 WHEN EXTRACT(HOUR FROM ${smtLoc}) < 18 THEN 3 ELSE 4 END AS sort,
            "kwh"
          FROM (SELECT "ts", MAX(CASE WHEN "kwh" >= 0 THEN "kwh" ELSE 0 END)::float AS kwh FROM "SmtInterval" WHERE "esiid" = ${esiid} AND "ts" >= ${args.cutoff} AND "ts" <= ${args.end} GROUP BY "ts") iv
        ) t GROUP BY key, label, sort ORDER BY sort ASC
      `
      );
      const timeOfDayBuckets = todRows.map((r) => ({ key: String(r.key), label: String(r.label), kwh: round2(r.kwh) }));
      const peakHourRows = await prisma.$queryRaw<Array<{ hour: number; avgkw: number }>>(Prisma.sql`
        SELECT EXTRACT(HOUR FROM ${smtLoc})::int AS hour,
               AVG(("kwh" * 4))::float AS avgkw
        FROM (SELECT "ts", MAX(CASE WHEN "kwh" >= 0 THEN "kwh" ELSE 0 END)::float AS kwh FROM "SmtInterval" WHERE "esiid" = ${esiid} AND "ts" >= ${args.cutoff} AND "ts" <= ${args.end} GROUP BY "ts") iv
        GROUP BY 1 ORDER BY avgkw DESC LIMIT 1
      `);
      const peakHour = peakHourRows?.[0] ? { hour: Number(peakHourRows[0].hour), kw: round2(Number(peakHourRows[0].avgkw)) } : null;
      const baseloadRows = await prisma.$queryRaw<Array<{ baseload: number | null }>>(Prisma.sql`
        WITH t AS (SELECT kwh::float AS kwh FROM (SELECT "ts", MAX(CASE WHEN "kwh" >= 0 THEN "kwh" ELSE 0 END)::float AS kwh FROM "SmtInterval" WHERE "esiid" = ${esiid} AND "ts" >= ${args.cutoff} AND "ts" <= ${args.end} GROUP BY "ts") iv),
             p AS (SELECT percentile_cont(0.10) WITHIN GROUP (ORDER BY kwh) AS p10 FROM t WHERE kwh > 0)
        SELECT AVG(t.kwh)::float AS baseload FROM t, p WHERE t.kwh > 0 AND t.kwh <= p.p10
      `);
      const baseload =
        baseloadRows?.[0]?.baseload == null ? null : round2(Number(baseloadRows[0].baseload) * 4);
      const baseloadDaily = low10Average(dailyTotals.map((d) => Number(d.kwh) || 0));
      const baseloadMonthly = low10Average(monthlyTotals.map((m) => Number(m.kwh) || 0));
      const dowRows = await prisma.$queryRaw<Array<{ weekdaykwh: number; weekendkwh: number }>>(Prisma.sql`
        SELECT COALESCE(SUM(CASE WHEN EXTRACT(DOW FROM "ts") IN (0,6) THEN 0 ELSE "kwh" END)::float, 0) AS weekdaykwh,
               COALESCE(SUM(CASE WHEN EXTRACT(DOW FROM "ts") IN (0,6) THEN "kwh" ELSE 0 END)::float, 0) AS weekendkwh
        FROM (SELECT "ts", MAX(CASE WHEN "kwh" >= 0 THEN "kwh" ELSE 0 END)::float AS kwh FROM "SmtInterval" WHERE "esiid" = ${esiid} AND "ts" >= ${args.cutoff} AND "ts" <= ${args.end} GROUP BY "ts") iv
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
        baseloadMethod: "SQL_P10_V1",
        baseloadFallbackUsed: false,
        baseloadDebugNote: null,
        baseloadDaily,
        baseloadMonthly,
        weekdayVsWeekend: { weekday, weekend },
      };
    }
    if (!USAGE_DB_ENABLED) return empty;
    const usageClient = usagePrisma as any;
    const houseId = String(args.houseId ?? "").trim();
    const rawId = String(args.rawId ?? "").trim();
    if (!houseId || !rawId) return empty;
    const dailyTotals = Array.isArray(args.precomputedDailyTotals)
      ? args.precomputedDailyTotals.map((row) => ({
          date: String(row.date).slice(0, 10),
          kwh: round2(Number(row.kwh) || 0),
        }))
      : (
          (await usageClient.$queryRaw(Prisma.sql`
      SELECT to_char((${gbLoc})::date, 'YYYY-MM-DD') AS date, SUM("consumptionKwh")::float AS kwh
      FROM "GreenButtonInterval" WHERE "homeId" = ${houseId} AND "rawId" = ${rawId} AND "timestamp" >= ${args.cutoff} AND "timestamp" <= ${args.end}
      GROUP BY 1 ORDER BY 1 ASC
    `)) as Array<{ date: string; kwh: number }>
        ).map((r) => ({ date: String(r.date), kwh: round2(r.kwh) }));
    const peakDay = dailyTotals.length > 0 ? dailyTotals.reduce((a, b) => (b.kwh > a.kwh ? b : a)) : null;
    const monthlyTotals = Array.isArray(args.precomputedMonthlyTotals)
      ? args.precomputedMonthlyTotals.map((row) => ({
          month: String(row.month).slice(0, 7),
          kwh: round2(Number(row.kwh) || 0),
        }))
      : (
          (await usageClient.$queryRaw(Prisma.sql`
      SELECT to_char(date_trunc('month', ${gbLoc})::date, 'YYYY-MM') AS month, SUM("consumptionKwh")::float AS kwh
      FROM "GreenButtonInterval" WHERE "homeId" = ${houseId} AND "rawId" = ${rawId} AND "timestamp" >= ${args.cutoff} AND "timestamp" <= ${args.end}
      GROUP BY 1 ORDER BY 1 ASC
    `)) as Array<{ month: string; kwh: number }>
        ).map((r) => ({ month: String(r.month), kwh: round2(r.kwh) }));
    const fifteenRows = (await usageClient.$queryRaw(Prisma.sql`
      SELECT to_char(${gbLoc}, 'HH24:MI') AS hhmm, AVG(("consumptionKwh" * 4))::float AS avgkw
      FROM "GreenButtonInterval" WHERE "homeId" = ${houseId} AND "rawId" = ${rawId} AND "timestamp" >= ${args.cutoff} AND "timestamp" <= ${args.end}
      GROUP BY 1 ORDER BY 1 ASC
    `)) as Array<{ hhmm: string; avgkw: number }>;
    const fifteenMinuteAverages = fifteenRows.map((r) => ({ hhmm: String(r.hhmm), avgKw: round2(r.avgkw) }));
    const todRows = (await usageClient.$queryRaw(Prisma.sql`
      SELECT key, label, sort, SUM("consumptionKwh")::float AS kwh FROM (
        SELECT CASE WHEN EXTRACT(HOUR FROM ${gbLoc}) < 6 THEN 'overnight'
                    WHEN EXTRACT(HOUR FROM ${gbLoc}) < 12 THEN 'morning'
                    WHEN EXTRACT(HOUR FROM ${gbLoc}) < 18 THEN 'afternoon' ELSE 'evening' END AS key,
               CASE WHEN EXTRACT(HOUR FROM ${gbLoc}) < 6 THEN 'Overnight (12am–6am)'
                    WHEN EXTRACT(HOUR FROM ${gbLoc}) < 12 THEN 'Morning (6am–12pm)'
                    WHEN EXTRACT(HOUR FROM ${gbLoc}) < 18 THEN 'Afternoon (12pm–6pm)' ELSE 'Evening (6pm–12am)' END AS label,
               CASE WHEN EXTRACT(HOUR FROM ${gbLoc}) < 6 THEN 1
                    WHEN EXTRACT(HOUR FROM ${gbLoc}) < 12 THEN 2
                    WHEN EXTRACT(HOUR FROM ${gbLoc}) < 18 THEN 3 ELSE 4 END AS sort,
               "consumptionKwh"
        FROM "GreenButtonInterval" WHERE "homeId" = ${houseId} AND "rawId" = ${rawId} AND "timestamp" >= ${args.cutoff} AND "timestamp" <= ${args.end}
      ) t GROUP BY key, label, sort ORDER BY sort ASC
    `)) as Array<{ key: string; label: string; sort: number; kwh: number }>;
    const timeOfDayBuckets = todRows.map((r) => ({ key: String(r.key), label: String(r.label), kwh: round2(r.kwh) }));
    const peakHourRows = (await usageClient.$queryRaw(Prisma.sql`
      SELECT EXTRACT(HOUR FROM ${gbLoc})::int AS hour, AVG(("consumptionKwh" * 4))::float AS avgkw
      FROM "GreenButtonInterval" WHERE "homeId" = ${houseId} AND "rawId" = ${rawId} AND "timestamp" >= ${args.cutoff} AND "timestamp" <= ${args.end}
      GROUP BY 1 ORDER BY avgkw DESC LIMIT 1
    `)) as Array<{ hour: number; avgkw: number }>;
    const peakHour = peakHourRows?.[0] ? { hour: Number(peakHourRows[0].hour), kw: round2(Number(peakHourRows[0].avgkw)) } : null;
    const baseloadRows = (await usageClient.$queryRaw(Prisma.sql`
      WITH t AS (SELECT "consumptionKwh"::float AS kwh FROM "GreenButtonInterval" WHERE "homeId" = ${houseId} AND "rawId" = ${rawId} AND "timestamp" >= ${args.cutoff} AND "timestamp" <= ${args.end}),
           p AS (SELECT percentile_cont(0.10) WITHIN GROUP (ORDER BY kwh) AS p10 FROM t WHERE kwh > 0)
      SELECT AVG(t.kwh)::float AS baseload FROM t, p WHERE t.kwh > 0 AND t.kwh <= p.p10
    `)) as Array<{ baseload: number | null }>;
    const baseload =
      baseloadRows?.[0]?.baseload == null ? null : round2(Number(baseloadRows[0].baseload) * 4);
    const baseloadDaily = low10Average(dailyTotals.map((d) => Number(d.kwh) || 0));
    const baseloadMonthly = low10Average(monthlyTotals.map((m) => Number(m.kwh) || 0));
    const dowRows = (await usageClient.$queryRaw(Prisma.sql`
      SELECT COALESCE(SUM(CASE WHEN EXTRACT(DOW FROM ${gbLoc}) IN (0,6) THEN 0 ELSE "consumptionKwh" END)::float, 0) AS weekdaykwh,
             COALESCE(SUM(CASE WHEN EXTRACT(DOW FROM ${gbLoc}) IN (0,6) THEN "consumptionKwh" ELSE 0 END)::float, 0) AS weekendkwh
      FROM "GreenButtonInterval" WHERE "homeId" = ${houseId} AND "rawId" = ${rawId} AND "timestamp" >= ${args.cutoff} AND "timestamp" <= ${args.end}
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
      baseloadMethod: "SQL_P10_V1",
      baseloadFallbackUsed: false,
      baseloadDebugNote: null,
      baseloadDaily,
      baseloadMonthly,
      weekdayVsWeekend: { weekday, weekend },
    };
  } catch {
    return empty;
  }
}

export async function hydrateGreenButtonInsightsForCoverageWindow(args: {
  houseId: string;
  coverageStart: string | null | undefined;
  coverageEnd: string | null | undefined;
  dailyTotals?: Array<{ date: string; kwh: number }>;
  monthlyTotals?: Array<{ month: string; kwh: number }>;
}) {
  const houseId = String(args.houseId ?? "").trim();
  const coverageStart = String(args.coverageStart ?? "").slice(0, 10);
  const coverageEnd = String(args.coverageEnd ?? "").slice(0, 10);
  if (!houseId || !YYYY_MM_DD.test(coverageStart) || !YYYY_MM_DD.test(coverageEnd)) return null;
  if (!USAGE_DB_ENABLED) return null;

  const rawId = await getLatestUsableRawGreenButtonIdForHouse(houseId);
  if (!rawId) return null;

  const range = buildUtcRangeForChicagoLocalDateRange({
    startDateKey: coverageStart,
    endDateKey: coverageEnd,
  });
  if (!range) return null;

  const homeTimezone = await loadHomeTimezoneForHouseId(houseId, { preferredActualSource: "GREEN_BUTTON" });
  return computeInsightsFromDb({
    source: "GREEN_BUTTON",
    houseId,
    rawId,
    cutoff: range.startInclusive,
    end: range.endInclusive,
    homeTimezone,
    precomputedDailyTotals: args.dailyTotals,
    precomputedMonthlyTotals: args.monthlyTotals,
  });
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
  const homeTimezone = await loadHomeTimezoneForHouseId(args.houseId, {
    preferredActualSource: args.source,
  });
  const window = resolveCanonicalUsage365CoverageWindow();
  const intervalRows = await getActualIntervalsForRange({
    houseId: args.houseId,
    esiid: args.esiid,
    startDate: window.startDate,
    endDate: window.endDate,
    preferredSource: args.source,
    homeTimezone,
  });
  const baseloadFiltered = computeHomeBaseloadKw(
    intervalRows.map((r) => ({
      tsIso: String(r.timestamp ?? ""),
      kwh: Number(r.kwh) || 0,
      homeDateKey: r.homeDateKey ?? null,
    })),
    homeTimezone,
    { excludedDateKeys: new Set(validDateKeys(args.excludeDateKeys ?? [])) },
  );
  return baseloadFiltered.baseloadKw;
}

async function getGreenButtonWindow(usageClient: any, houseId: string, rawId: string) {
  const greenButtonAnchorEndDate = await getLatestGreenButtonFullDayDateKey({ houseId });
  if (typeof greenButtonAnchorEndDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(greenButtonAnchorEndDate)) {
    return null;
  }
  const greenButtonWindowSpan =
    coverageWindowEndingOnDateKey(greenButtonAnchorEndDate, CANONICAL_COVERAGE_TOTAL_DAYS) ?? null;
  const greenButtonStartDate = greenButtonWindowSpan?.startDate ?? null;
  if (!greenButtonStartDate) return null;
  const range = buildUtcRangeForChicagoLocalDateRange({
    startDateKey: greenButtonStartDate,
    endDateKey: greenButtonAnchorEndDate,
  });
  if (!range) return null;
  const anchoredRows = await usageClient.greenButtonInterval.findFirst({
    where: { homeId: houseId, rawId, timestamp: { gte: range.startInclusive, lte: range.endInclusive } },
    orderBy: { timestamp: "desc" },
    select: { timestamp: true },
  });
  if (!anchoredRows?.timestamp) return null;
  return { cutoff: range.startInclusive, end: range.endInclusive };
}

type SmtFetchWindow = {
  cutoff: Date;
  end: Date;
  startDate: string;
  endDate: string;
};

async function getSmtWindow(esiid: string): Promise<SmtFetchWindow | null> {
  const { startDate, endDate } = resolveCanonicalUsage365CoverageWindow();
  const range = buildUtcRangeForChicagoLocalDateRange({
    startDateKey: startDate,
    endDateKey: endDate,
  });
  if (!range) return null;
  const cutoff = range.startInclusive;
  const end = range.endInclusive;
  const hasRows = await prisma.smtInterval.findFirst({
    where: { esiid, ts: { gte: cutoff, lte: end } },
    orderBy: { ts: "desc" },
    select: { ts: true },
  });
  if (!hasRows?.ts) return null;
  return { cutoff, end, startDate, endDate };
}

/** True when any SMT interval exists in the shared canonical 365-day window. */
export async function hasSmtIntervalsInCanonicalWindow(esiid: string | null | undefined): Promise<boolean> {
  const normalized = String(esiid ?? "").trim();
  if (!normalized) return false;
  return (await getSmtWindow(normalized)) != null;
}

function applyCanonicalCoverageToUsageSummary(
  summary: UsageSummary,
  window: { startDate: string; endDate: string },
): UsageSummary {
  return {
    ...summary,
    start: window.startDate,
    end: window.endDate,
  };
}

function isHomeDateKeyInCoverageWindow(
  dateKey: string,
  window: { startDate: string; endDate: string },
): boolean {
  return dateKey >= window.startDate && dateKey <= window.endDate;
}

function chooseDataset(
  smt: UsageDatasetResult | null,
  greenButton: UsageDatasetResult | null,
  preferredSource?: ActualUsageSource | null
): UsageDatasetResult | null {
  if (preferredSource === "SMT" && smt) return smt;
  if (preferredSource === "GREEN_BUTTON" && greenButton) return greenButton;
  if (smt) return smt;
  if (greenButton) return greenButton;
  return null;
}

async function fetchSmtDataset(
  esiid: string | null,
  homeTimezone: string,
  options?: { skipFullIntervalRowLoad?: boolean },
): Promise<UsageDatasetResult | null> {
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
      FROM "SmtInterval" WHERE "esiid" = ${esiid} AND "ts" >= ${window.cutoff} AND "ts" <= ${window.end} GROUP BY "ts"
    )
    SELECT COUNT(*)::int AS intervalsCount, COALESCE(SUM(importkwh), 0)::float AS importkwh, COALESCE(SUM(exportkwh), 0)::float AS exportkwh, MIN("ts") AS start, MAX("ts") AS end FROM iv
  `);
  const agg = aggRows?.[0] ?? null;
  const count = Number(agg?.intervalscount ?? 0);
  if (count === 0) return null;
  const importKwh = round2(Number(agg?.importkwh ?? 0));
  const exportKwh = round2(Number(agg?.exportkwh ?? 0));
  const totalKwh = round2(importKwh - exportKwh);
  const latestTs = agg?.end ?? null;
  const skipFullIntervalRowLoad = options?.skipFullIntervalRowLoad === true;
  const canonicalCoverage = { startDate: window.startDate, endDate: window.endDate };
  let intervalsInWindow: ReturnType<typeof convertSmtPersistedRowsToHome>["intervals"] = [];
  let intervals15: Array<{ timestamp: string; kwh: number }> = [];
  let smtConverted: ReturnType<typeof convertSmtPersistedRowsToHome> | null = null;
  if (!skipFullIntervalRowLoad) {
    const intervalRows = await prisma.$queryRaw<Array<{ ts: Date; kwh: number }>>(Prisma.sql`
      SELECT DISTINCT ON ("ts") "ts", GREATEST("kwh", 0)::float AS kwh
      FROM "SmtInterval" WHERE "esiid" = ${esiid} AND "ts" >= ${window.cutoff} AND "ts" <= ${window.end}
      ORDER BY "ts" ASC, CASE WHEN "meter" = 'unknown' THEN 1 ELSE 0 END ASC, "updatedAt" DESC
    `);
    smtConverted = convertSmtPersistedRowsToHome(
      intervalRows.map((row) => ({ ts: row.ts, kwh: decimalToNumber(row.kwh) })),
      homeTimezone,
    );
    intervalsInWindow = smtConverted.intervals.filter((row) =>
      isHomeDateKeyInCoverageWindow(row.homeDateKey, canonicalCoverage),
    );
    intervals15 = tailIntervals15(intervalsInWindow, 192);
  }
  const smtLoc = prismaSmtLocalTs(homeTimezone);
  const intervalsCountInWindow = skipFullIntervalRowLoad ? count : intervalsInWindow.length;
  const hourlyRows = await prisma.$queryRaw<Array<{ bucket: Date; kwh: number }>>(Prisma.sql`
    WITH iv AS (SELECT "ts", MAX(CASE WHEN "kwh" >= 0 THEN "kwh" ELSE 0 END)::float AS kwh FROM "SmtInterval" WHERE "esiid" = ${esiid} AND "ts" >= ${window.cutoff} AND "ts" <= ${window.end} AND "ts" >= NOW() - INTERVAL '14 days' GROUP BY "ts")
    SELECT date_trunc('hour', "ts") AS bucket, COALESCE(SUM("kwh"), 0)::float AS kwh FROM iv GROUP BY bucket ORDER BY bucket ASC
  `);
  const dailyRows = skipFullIntervalRowLoad
    ? (
        (await prisma.$queryRaw(Prisma.sql`
          WITH iv AS (
            SELECT "ts", MAX(CASE WHEN "kwh" >= 0 THEN "kwh" ELSE 0 END)::float AS kwh
            FROM "SmtInterval" WHERE "esiid" = ${esiid} AND "ts" >= ${window.cutoff} AND "ts" <= ${window.end}
            GROUP BY "ts"
          )
          SELECT to_char((${smtLoc})::date, 'YYYY-MM-DD') AS date, COALESCE(SUM("kwh"), 0)::float AS kwh
          FROM iv GROUP BY 1 ORDER BY 1 DESC LIMIT 400
        `)) as Array<{ date: string; kwh: number }>
      ).map((row) => ({
        bucket: new Date(`${String(row.date).slice(0, 10)}T00:00:00.000Z`),
        kwh: round2(row.kwh),
      }))
    : homeDailyToUsageSeriesPoints({
        ...smtConverted!,
        daily: smtConverted!.daily.filter((row) =>
          isHomeDateKeyInCoverageWindow(row.homeDateKey, canonicalCoverage),
        ),
      })
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 400)
        .map((row) => ({
          bucket: new Date(row.timestamp),
          kwh: row.kwh,
        }));
  const monthlyRows = await prisma.$queryRaw<Array<{ bucket: Date; kwh: number }>>(Prisma.sql`
    WITH iv AS (SELECT "ts", MAX(CASE WHEN "kwh" >= 0 THEN "kwh" ELSE 0 END)::float AS kwh FROM "SmtInterval" WHERE "esiid" = ${esiid} AND "ts" >= ${window.cutoff} AND "ts" <= ${window.end} GROUP BY "ts")
    SELECT date_trunc('month', ${prismaSmtLocalTs(homeTimezone)}) AS bucket, COALESCE(SUM("kwh"), 0)::float AS kwh FROM iv GROUP BY bucket ORDER BY bucket DESC LIMIT 120
  `);
  const annualRows = await prisma.$queryRaw<Array<{ bucket: Date; kwh: number }>>(Prisma.sql`
    WITH iv AS (SELECT "ts", MAX(CASE WHEN "kwh" >= 0 THEN "kwh" ELSE 0 END)::float AS kwh FROM "SmtInterval" WHERE "esiid" = ${esiid} AND "ts" >= ${window.cutoff} AND "ts" <= ${window.end} GROUP BY "ts")
    SELECT date_trunc('year', "ts") AS bucket, COALESCE(SUM("kwh"), 0)::float AS kwh FROM iv GROUP BY bucket ORDER BY bucket ASC
  `);
  return {
    summary: applyCanonicalCoverageToUsageSummary(
      {
        source: "SMT",
        intervalsCount: intervalsCountInWindow,
        totalKwh,
        start: window.startDate,
        end: window.endDate,
        latest: latestTs ? latestTs.toISOString() : null,
      },
      canonicalCoverage,
    ),
    series: {
      intervals15,
      hourly: toSeriesPoint(hourlyRows),
      daily: fillDailyGaps(
        toSeriesPoint(dailyRows),
        `${window.startDate}T00:00:00.000Z`,
        `${window.endDate}T00:00:00.000Z`,
      ),
      monthly: toSeriesPoint(monthlyRows),
      annual: toSeriesPoint(annualRows),
    },
  };
}

async function fetchGreenButtonDataset(
  houseId: string,
  options?: { lightweight?: boolean; rawId?: string | null; homeTimezone?: string },
): Promise<UsageDatasetResult | null> {
  const homeTimezone = resolveHomeTimezone({
    timezone: options?.homeTimezone,
    preferredActualSource: "GREEN_BUTTON",
  });
  const gbLoc = prismaGbLocalTs(homeTimezone);
  if (!USAGE_DB_ENABLED) return null;
  try {
    const usageClient = usagePrisma as any;
    const rawId = typeof options?.rawId === "string" && options.rawId.trim() ? options.rawId.trim() : await getLatestUsableRawGreenButtonIdForHouse(houseId);
    if (!rawId) return null;
    const window = await getGreenButtonWindow(usageClient, houseId, rawId);
    if (!window) return null;
    const aggregates = await usageClient.greenButtonInterval.aggregate({
      where: { homeId: houseId, rawId, timestamp: { gte: window.cutoff, lte: window.end } },
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
    const lightweight = options?.lightweight === true;
    const intervalRows = lightweight
      ? []
      : ((await usageClient.greenButtonInterval.findMany({
          where: { homeId: houseId, rawId, timestamp: { gte: window.cutoff, lte: window.end } },
          orderBy: { timestamp: "asc" },
          select: { timestamp: true, consumptionKwh: true },
        })) as Array<{ timestamp: Date; consumptionKwh: Prisma.Decimal | number }>);
    const gbConverted = convertGreenButtonPersistedRowsToHome(
      intervalRows.map((row) => ({
        timestamp: row.timestamp,
        consumptionKwh: decimalToNumber(row.consumptionKwh),
      })),
      homeTimezone,
    );
    const intervals15 = lightweight ? [] : tailHomeIntervals(gbConverted.intervals, 192);
    const hourlyRows = lightweight
      ? []
      : ((await usageClient.$queryRaw(Prisma.sql`
      SELECT date_trunc('hour', "timestamp") AS bucket, SUM("consumptionKwh")::float AS kwh
      FROM "GreenButtonInterval" WHERE "homeId" = ${houseId} AND "rawId" = ${rawId} AND "timestamp" >= ${window.cutoff} AND "timestamp" <= ${window.end} AND "timestamp" >= NOW() - INTERVAL '14 days'
      GROUP BY bucket ORDER BY bucket ASC
    `)) as Array<{ bucket: Date; kwh: number }>);
    const dailyFromCalendar = greenButtonHomeDailyToUsageSeriesPoints(gbConverted).sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
    const dailyRows = lightweight
      ? ((await usageClient.$queryRaw(Prisma.sql`
      SELECT date_trunc('day', ${gbLoc}) AT TIME ZONE 'UTC' AS bucket, SUM("consumptionKwh")::float AS kwh
      FROM "GreenButtonInterval" WHERE "homeId" = ${houseId} AND "rawId" = ${rawId} AND "timestamp" >= ${window.cutoff} AND "timestamp" <= ${window.end}
      GROUP BY bucket ORDER BY bucket DESC LIMIT 400
    `)) as Array<{ bucket: Date; kwh: number }>)
      : dailyFromCalendar.slice(0, 400).map((row) => ({
          bucket: new Date(row.timestamp),
          kwh: row.kwh,
        }));
    const monthlyRowsRaw = await usageClient.$queryRaw(Prisma.sql`
      SELECT date_trunc('month', ${gbLoc}) AT TIME ZONE 'UTC' AS bucket, SUM("consumptionKwh")::float AS kwh
      FROM "GreenButtonInterval" WHERE "homeId" = ${houseId} AND "rawId" = ${rawId} AND "timestamp" >= ${window.cutoff} AND "timestamp" <= ${window.end}
      GROUP BY bucket ORDER BY bucket DESC LIMIT 120
    `);
    const monthlyRows = monthlyRowsRaw as Array<{ bucket: Date; kwh: number }>;
    const timeOfDayBuckets = lightweight
      ? ((await usageClient.$queryRaw(Prisma.sql`
      SELECT key, label, sort, SUM("consumptionKwh")::float AS kwh FROM (
        SELECT CASE WHEN EXTRACT(HOUR FROM ${gbLoc}) < 6 THEN 'overnight'
                    WHEN EXTRACT(HOUR FROM ${gbLoc}) < 12 THEN 'morning'
                    WHEN EXTRACT(HOUR FROM ${gbLoc}) < 18 THEN 'afternoon' ELSE 'evening' END AS key,
               CASE WHEN EXTRACT(HOUR FROM ${gbLoc}) < 6 THEN 'Overnight (12am–6am)'
                    WHEN EXTRACT(HOUR FROM ${gbLoc}) < 12 THEN 'Morning (6am–12pm)'
                    WHEN EXTRACT(HOUR FROM ${gbLoc}) < 18 THEN 'Afternoon (12pm–6pm)' ELSE 'Evening (6pm–12am)' END AS label,
               CASE WHEN EXTRACT(HOUR FROM ${gbLoc}) < 6 THEN 1
                    WHEN EXTRACT(HOUR FROM ${gbLoc}) < 12 THEN 2
                    WHEN EXTRACT(HOUR FROM ${gbLoc}) < 18 THEN 3 ELSE 4 END AS sort,
               "consumptionKwh"
        FROM "GreenButtonInterval" WHERE "homeId" = ${houseId} AND "rawId" = ${rawId} AND "timestamp" >= ${window.cutoff} AND "timestamp" <= ${window.end}
      ) t GROUP BY key, label, sort ORDER BY sort ASC
    `)) as Array<{ key: string; label: string; sort: number; kwh: number }>).map((row) => ({
          key: String(row.key),
          label: String(row.label),
          kwh: round2(row.kwh),
        }))
      : [];
    const annualRows = lightweight
      ? []
      : ((await usageClient.$queryRaw(Prisma.sql`
      SELECT date_trunc('year', ${gbLoc}) AT TIME ZONE 'UTC' AS bucket, SUM("consumptionKwh")::float AS kwh
      FROM "GreenButtonInterval" WHERE "homeId" = ${houseId} AND "rawId" = ${rawId} AND "timestamp" >= ${window.cutoff} AND "timestamp" <= ${window.end}
      GROUP BY bucket ORDER BY bucket ASC
    `)) as Array<{ bucket: Date; kwh: number }>);
    return {
      summary: {
        source: "GREEN_BUTTON",
        intervalsCount: count,
        totalKwh,
        start: gbConverted.homeCoverageStart ?? (start ? chicagoDateKey(start) : null),
        end: gbConverted.homeCoverageEnd ?? (end ? chicagoDateKey(end) : null),
        latest: gbConverted.lastTsUtc ?? (end ? end.toISOString() : null),
      },
      series: {
        intervals15,
        hourly: toSeriesPoint(hourlyRows),
        daily: fillDailyGaps(toSeriesPoint(dailyRows), start?.toISOString() ?? null, end?.toISOString() ?? null),
        monthly: toSeriesPoint(monthlyRows),
        annual: toSeriesPoint(annualRows),
      },
      insights: timeOfDayBuckets.length > 0 ? { timeOfDayBuckets } : null,
    };
  } catch {
    return null;
  }
}

/**
 * Daily actual kWh for specific local calendar keys only (YYYY-MM-DD). Resolves SMT vs Green Button the same
 * way as `chooseActualSource` — without loading full-year 15‑minute intervals or running full Usage insights.
 * Used only for Past validation/compare (baseline overlay + compare rows), not for changing Past sim output.
 */
export async function getActualDailyKwhForLocalDateKeys(args: {
  houseId: string;
  esiid: string | null;
  dateKeysLocal: string[];
  preferredSource?: ActualUsageSource | null;
}): Promise<Map<string, number>> {
  const keys = Array.from(
    new Set(
      args.dateKeysLocal
        .map((v) => String(v ?? "").slice(0, 10))
        .filter((dk) => /^\d{4}-\d{2}-\d{2}$/.test(dk))
    )
  ).sort();
  if (keys.length === 0) return new Map();

  const homeTimezone = await loadHomeTimezoneForHouseId(args.houseId, {
    preferredActualSource: args.preferredSource ?? null,
  });
  const smtLoc = prismaSmtLocalTs(homeTimezone);
  const gbLoc = prismaGbLocalTs(homeTimezone);

  const source = await chooseActualSource({
    houseId: args.houseId,
    esiid: args.esiid ?? null,
    preferredSource: args.preferredSource ?? null,
  });
  if (!source) return new Map();

  if (source === "SMT") {
    const esiid = String(args.esiid ?? "").trim();
    if (!esiid) return new Map();
    try {
      const dateInList = Prisma.join(
        keys.map((d) => Prisma.sql`${d}`),
        ", "
      );
      const dailyRows = await prisma.$queryRaw<Array<{ date: string; kwh: number }>>(Prisma.sql`
        WITH iv AS (
          SELECT "ts", MAX(CASE WHEN "kwh" >= 0 THEN "kwh" ELSE 0 END)::float AS kwh
          FROM "SmtInterval"
          WHERE "esiid" = ${esiid}
            AND to_char((${smtLoc})::date, 'YYYY-MM-DD') IN (${dateInList})
          GROUP BY "ts"
        )
        SELECT to_char((${smtLoc})::date, 'YYYY-MM-DD') AS date,
               COALESCE(SUM("kwh"), 0)::float AS kwh
        FROM iv
        GROUP BY 1
        ORDER BY 1 ASC
      `);
      const map = new Map<string, number>();
      for (const r of dailyRows) {
        map.set(String(r.date).slice(0, 10), round2(Number(r.kwh) || 0));
      }
      return map;
    } catch {
      return new Map();
    }
  }

  if (!USAGE_DB_ENABLED) return new Map();
  try {
    const usageClient = usagePrisma as any;
    const rawId = await getLatestUsableRawGreenButtonIdForHouse(args.houseId);
    if (!rawId) return new Map();
    const dateInList = Prisma.join(
      keys.map((d) => Prisma.sql`${d}`),
      ", "
    );
    const dailyRows = (await usageClient.$queryRaw(Prisma.sql`
      SELECT to_char((${gbLoc})::date, 'YYYY-MM-DD') AS date,
             SUM("consumptionKwh")::float AS kwh
      FROM "GreenButtonInterval"
      WHERE "homeId" = ${args.houseId} AND "rawId" = ${rawId}
        AND to_char((${gbLoc})::date, 'YYYY-MM-DD') IN (${dateInList})
      GROUP BY 1
      ORDER BY 1 ASC
    `)) as Array<{ date: string; kwh: number }>;
    const map = new Map<string, number>();
    for (const r of dailyRows) {
      map.set(String(r.date).slice(0, 10), round2(Number(r.kwh) || 0));
    }
    return map;
  } catch {
    return new Map();
  }
}

/**
 * Returns the actual usage dataset for a single house (same shape and data as the Usage page).
 * Use this when the simulator serves BASELINE with SMT or Green Button so baseline = actual usage.
 */
export async function getActualUsageDatasetForHouse(
  houseId: string,
  esiid: string | null,
  args?: {
    cutoff?: Date;
    excludedDateKeys?: Set<string>;
    preferredSource?: ActualUsageSource | null;
    /** When true, skip full-year getActualIntervalsForRange (e.g. lab only needs window). Production never passes this. */
    skipFullYearIntervalFetch?: boolean;
    /** When true, keep lightweight reads on the cheap aggregate path and skip extra DB insight recompute. */
    skipLightweightInsightRecompute?: boolean;
    /**
     * User Usage / sim baseline read: SQL aggregates + insights only (no full-year interval row load or baseload rescan).
     */
    userUsageDashboardLoad?: boolean;
  }
): Promise<{
  dataset: ActualHouseDataset | null;
  alternatives: { smt: UsageSummary | null; greenButton: UsageSummary | null };
  /** True when skipFullYearIntervalFetch was true and we did not call getActualIntervalsForRange. */
  skippedFullYearIntervalFetch?: boolean;
}> {
  const homeTimezone = await loadHomeTimezoneForHouseId(houseId, {
    preferredActualSource: args?.preferredSource ?? null,
  });
  const skippedFullYearIntervalFetch = Boolean(args?.skipFullYearIntervalFetch);
  const skipLightweightInsightRecompute = Boolean(args?.skipLightweightInsightRecompute);
  const userUsageDashboardLoad = Boolean(args?.userUsageDashboardLoad);
  const preferredSource = args?.preferredSource ?? null;
  const fetchOnlyPreferredSource =
    skippedFullYearIntervalFetch && (preferredSource === "SMT" || preferredSource === "GREEN_BUTTON");
  let smtDataset: UsageDatasetResult | null = null;
  let greenDataset: UsageDatasetResult | null = null;
  let greenButtonRawId: string | null = null;
  if (!fetchOnlyPreferredSource || preferredSource === "SMT") {
    try {
      smtDataset = await fetchSmtDataset(esiid, homeTimezone, {
        skipFullIntervalRowLoad: userUsageDashboardLoad,
      });
    } catch {
      smtDataset = null;
    }
  }
  if (!fetchOnlyPreferredSource || preferredSource === "GREEN_BUTTON") {
    try {
      if (fetchOnlyPreferredSource && preferredSource === "GREEN_BUTTON" && USAGE_DB_ENABLED) {
        greenButtonRawId = await getLatestUsableRawGreenButtonIdForHouse(houseId);
      }
      greenDataset = await fetchGreenButtonDataset(houseId, {
        lightweight: skippedFullYearIntervalFetch && preferredSource === "GREEN_BUTTON",
        rawId: greenButtonRawId,
        homeTimezone,
      });
    } catch {
      greenDataset = null;
    }
  }
  const canonicalWindow = resolveCanonicalUsage365CoverageWindow();
  if (
    userUsageDashboardLoad &&
    preferredSource !== "GREEN_BUTTON" &&
    esiid &&
    !smtDataset &&
    greenDataset &&
    (await hasSmtIntervalsInCanonicalWindow(esiid))
  ) {
    try {
      smtDataset = await fetchSmtDataset(esiid, homeTimezone, {
        skipFullIntervalRowLoad: true,
      });
    } catch {
      smtDataset = null;
    }
  }
  let selected = chooseDataset(smtDataset, greenDataset, preferredSource);
  if (
    userUsageDashboardLoad &&
    preferredSource !== "GREEN_BUTTON" &&
    selected?.summary?.source === "GREEN_BUTTON" &&
    esiid &&
    (await hasSmtIntervalsInCanonicalWindow(esiid))
  ) {
    if (!smtDataset) {
      try {
        smtDataset = await fetchSmtDataset(esiid, homeTimezone, {
          skipFullIntervalRowLoad: userUsageDashboardLoad,
        });
      } catch {
        smtDataset = null;
      }
    }
    selected = chooseDataset(smtDataset, greenDataset, "SMT");
  }
  const greenButtonBaselineWindow =
    selected?.summary?.source === "GREEN_BUTTON"
      ? await resolveGreenButtonBaselineCoverageWindow(houseId)
      : null;
  const displayCoverageWindow =
    selected?.summary?.source === "GREEN_BUTTON" && greenButtonBaselineWindow
      ? greenButtonBaselineWindow
      : canonicalWindow;
  const displayUtcBounds = canonicalCoverageWindowUtcBounds(displayCoverageWindow);
  const canonicalUtcBounds = canonicalCoverageWindowUtcBounds(canonicalWindow);
  const canonicalCutoff = canonicalUtcBounds.rangeStart;
  const canonicalEnd = canonicalUtcBounds.rangeEndInclusive;
  const selectedWindowStartDate = displayCoverageWindow.startDate;
  const selectedWindowEndDate = displayCoverageWindow.endDate;

  const emptyInsights: ActualHouseInsights = {
    fifteenMinuteAverages: [] as Array<{ hhmm: string; avgKw: number }>,
    timeOfDayBuckets: [] as Array<{ key: string; label: string; kwh: number }>,
    peakDay: null as { date: string; kwh: number } | null,
    peakHour: null as { hour: number; kw: number } | null,
    baseload: null as number | null,
    baseloadDaily: null as number | null,
    baseloadMonthly: null as number | null,
    weekdayVsWeekend: { weekday: 0, weekend: 0 },
  };

  if (selected && skippedFullYearIntervalFetch) {
    let dailyTotals = deriveDailyTotalsFromSeries(Array.isArray(selected.series?.daily) ? selected.series.daily : []);
    let monthlyTotals =
      dailyTotals.length > 0
        ? deriveMonthlyTotalsFromDailyTotals(dailyTotals)
        : deriveMonthlyTotalsFromSeries(Array.isArray(selected.series?.monthly) ? selected.series.monthly : []);
    let totalFromMonthly = round2(monthlyTotals.reduce((sum, row) => sum + (Number(row.kwh) || 0), 0));
    let totalKwh = monthlyTotals.length > 0 ? totalFromMonthly : round2(Number(selected.summary.totalKwh) || 0);
    let peakDay =
      dailyTotals.length > 0
        ? dailyTotals.reduce((current, row) => (row.kwh > current.kwh ? row : current))
        : null;
    let weekdayVsWeekend = deriveWeekdayWeekendFromDailyTotals(dailyTotals);
    const selectedTimeOfDayBuckets = Array.isArray(selected.insights?.timeOfDayBuckets)
      ? selected.insights.timeOfDayBuckets
          .map((row) => ({
            key: String(row?.key ?? ""),
            label: String(row?.label ?? ""),
            kwh: round2(Number(row?.kwh) || 0),
          }))
          .filter((row) => row.key.length > 0 && row.label.length > 0)
      : [];
    let insights: ActualHouseInsights = {
      ...emptyInsights,
      timeOfDayBuckets: selectedTimeOfDayBuckets,
      peakDay,
      baseloadMonthly: low10Average(monthlyTotals.map((row) => Number(row.kwh) || 0)),
      weekdayVsWeekend,
    };
    const lightweightRangeStart = selectedWindowStartDate ?? canonicalWindow.startDate;
    const lightweightRangeEnd = selectedWindowEndDate ?? canonicalWindow.endDate;
    const shouldQueryGreenButtonDbInsights =
      selected.summary.source === "GREEN_BUTTON" &&
      YYYY_MM_DD.test(lightweightRangeStart) &&
      YYYY_MM_DD.test(lightweightRangeEnd) &&
      !skipLightweightInsightRecompute;
    if (
      shouldQueryGreenButtonDbInsights
    ) {
      try {
        const rawId =
          greenButtonRawId ??
          (fetchOnlyPreferredSource && preferredSource === "GREEN_BUTTON"
            ? null
            : await getLatestUsableRawGreenButtonIdForHouse(houseId));
        const lightweightRange =
          buildUtcRangeForChicagoLocalDateRange({
            startDateKey: lightweightRangeStart,
            endDateKey: lightweightRangeEnd,
          }) ?? null;
        const computed =
          rawId != null
            ? await computeInsightsFromDb({
                source: "GREEN_BUTTON",
                houseId,
                rawId,
                cutoff: lightweightRange?.startInclusive ?? new Date(`${lightweightRangeStart}T00:00:00.000Z`),
                end: lightweightRange?.endInclusive ?? new Date(`${lightweightRangeEnd}T23:59:59.999Z`),
                homeTimezone,
                precomputedDailyTotals: dailyTotals.length > 0 ? dailyTotals : undefined,
                precomputedMonthlyTotals: monthlyTotals.length > 0 ? monthlyTotals : undefined,
              })
            : null;
        if (computed) {
          dailyTotals = computed.dailyTotals;
          monthlyTotals = computed.monthlyTotals;
          totalFromMonthly = round2(monthlyTotals.reduce((sum, row) => sum + (Number(row.kwh) || 0), 0));
          totalKwh = monthlyTotals.length > 0 ? totalFromMonthly : round2(Number(selected.summary.totalKwh) || 0);
          peakDay = computed.peakDay;
          weekdayVsWeekend = computed.weekdayVsWeekend;
          insights = {
            fifteenMinuteAverages: computed.fifteenMinuteAverages,
            timeOfDayBuckets: computed.timeOfDayBuckets,
            peakDay: computed.peakDay,
            peakHour: computed.peakHour,
            baseload: computed.baseload ?? null,
            baseloadMethod: computed.baseloadMethod ?? "SQL_P10_V1",
            baseloadFallbackUsed: computed.baseloadFallbackUsed ?? false,
            baseloadDebugNote: computed.baseloadDebugNote ?? null,
            baseloadDaily: computed.baseloadDaily,
            baseloadMonthly: computed.baseloadMonthly,
            weekdayVsWeekend: computed.weekdayVsWeekend,
          };
        }
      } catch {
        // Fall back to series-derived monthly/daily rows when the lightweight aggregate read fails.
      }
    }
    const shouldQuerySmtDbInsights =
      selected.summary.source === "SMT" &&
      Boolean(esiid) &&
      YYYY_MM_DD.test(lightweightRangeStart) &&
      YYYY_MM_DD.test(lightweightRangeEnd);
    if (shouldQuerySmtDbInsights && esiid) {
      try {
        const lightweightRange =
          buildUtcRangeForChicagoLocalDateRange({
            startDateKey: lightweightRangeStart,
            endDateKey: lightweightRangeEnd,
          }) ?? null;
        const computed = await computeInsightsFromDb({
          source: "SMT",
          esiid,
          cutoff: lightweightRange?.startInclusive ?? new Date(`${lightweightRangeStart}T00:00:00.000Z`),
          end: lightweightRange?.endInclusive ?? new Date(`${lightweightRangeEnd}T23:59:59.999Z`),
          homeTimezone,
          precomputedDailyTotals: dailyTotals.length > 0 ? dailyTotals : undefined,
          precomputedMonthlyTotals: monthlyTotals.length > 0 ? monthlyTotals : undefined,
        });
        dailyTotals = computed.dailyTotals;
        monthlyTotals = computed.monthlyTotals;
        totalFromMonthly = round2(monthlyTotals.reduce((sum, row) => sum + (Number(row.kwh) || 0), 0));
        totalKwh = monthlyTotals.length > 0 ? totalFromMonthly : round2(Number(selected.summary.totalKwh) || 0);
        peakDay = computed.peakDay;
        weekdayVsWeekend = computed.weekdayVsWeekend;
        insights = {
          fifteenMinuteAverages: computed.fifteenMinuteAverages,
          timeOfDayBuckets: computed.timeOfDayBuckets,
          peakDay: computed.peakDay,
          peakHour: computed.peakHour,
          baseload: computed.baseload ?? null,
          baseloadMethod: computed.baseloadMethod ?? "SQL_P10_V1",
          baseloadFallbackUsed: computed.baseloadFallbackUsed ?? false,
          baseloadDebugNote: computed.baseloadDebugNote ?? null,
          baseloadDaily: computed.baseloadDaily,
          baseloadMonthly: computed.baseloadMonthly,
          weekdayVsWeekend: computed.weekdayVsWeekend,
        };
      } catch {
        // Keep series-derived totals when the lightweight SMT insight read fails.
      }
    }
    const stitchedMonth = buildDisplayStitchedMonthMeta({
      monthlyTotals,
      coverageEndDateKey: selectedWindowEndDate,
    });
    if (stitchedMonth) {
      insights = {
        ...insights,
        stitchedMonth,
      };
    }
    const canonicalMonths = buildDisplayCanonicalMonths({
      monthlyTotals,
      stitchedMonth,
    });
    const dailyTotalsForDataset = fillCanonicalDailyTotals(dailyTotals, displayCoverageWindow);
    insights = await (async () => {
      const baseloadFiltered = computeHomeBaseloadKw(
        (
          await getActualIntervalsForRange({
            houseId,
            esiid,
            startDate: lightweightRangeStart,
            endDate: lightweightRangeEnd,
            preferredSource,
            homeTimezone,
          })
        ).map((r) => ({
          tsIso: String(r.timestamp ?? ""),
          kwh: Number(r.kwh) || 0,
          homeDateKey: r.homeDateKey ?? null,
        })),
        homeTimezone,
        { excludedDateKeys: args?.excludedDateKeys },
      );
      if (baseloadFiltered.baseloadKw == null) return insights;
      return {
        ...insights,
        baseload: baseloadFiltered.baseloadKw,
        baseloadMethod: baseloadFiltered.fallbackUsed ? "FALLBACK_V1" : "FILTERED_NORMAL_LIFE_V1",
        baseloadFallbackUsed: baseloadFiltered.fallbackUsed,
        baseloadDebugNote: baseloadFiltered.debugNote,
      };
    })();
    const monthlyForDisplay = buildDisplayedMonthlyRows({
      monthly: monthlyTotals,
      insights: { stitchedMonth: insights.stitchedMonth ?? stitchedMonth ?? null },
    });
    const baseloadMonthlyForDisplay = baseloadMonthlyFromDisplayedMonthly(
      monthlyTotals,
      insights.stitchedMonth ?? stitchedMonth ?? null,
    );
    if (baseloadMonthlyForDisplay != null) {
      insights = { ...insights, baseloadMonthly: baseloadMonthlyForDisplay };
    }
    const dataset: ActualHouseDataset = {
      summary: applyCanonicalCoverageToUsageSummary(
        {
          ...selected.summary,
          totalKwh,
        },
        displayCoverageWindow,
      ),
      series: {
        ...selected.series,
        annual: selected.series?.annual?.length
          ? [{ ...selected.series.annual[0], kwh: totalKwh }]
          : selected.series.annual,
      },
      daily: dailyTotalsForDataset,
      monthly: monthlyForDisplay,
      insights,
      totals: { importKwh: totalKwh, exportKwh: 0, netKwh: totalKwh },
      meta: {
        datasetKind: "ACTUAL",
        actualSource: selected.summary.source,
        timezone: homeTimezone,
        coverageStart: displayCoverageWindow.startDate,
        coverageEnd: displayCoverageWindow.endDate,
        canonicalMonths,
        canonicalEndMonth: canonicalMonths.length > 0 ? canonicalMonths[canonicalMonths.length - 1] ?? null : null,
      },
    };
    await hydrateActualUsageDailyWeather({ houseId, dataset });
    if (selected.summary.source === "SMT" && esiid) {
      await applySmtLedgerToActualDataset({ dataset, esiid, reconcile: true }).catch(() => null);
    }
    return {
      dataset,
      alternatives: {
        smt: smtDataset?.summary
          ? applyCanonicalCoverageToUsageSummary(smtDataset.summary, canonicalWindow)
          : null,
        greenButton: greenDataset?.summary ?? null,
      },
      skippedFullYearIntervalFetch: true,
    };
  }

  let stitchedMonthlyTotals: Array<{ month: string; kwh: number }> | null = null;
  let stitchedMonthMeta: ActualHouseStitchedMonth | null = null;
  try {
    const bucketBuildGreenButtonRawId =
      selected?.summary?.source === "GREEN_BUTTON"
        ? (greenButtonRawId ?? (await getLatestUsableRawGreenButtonIdForHouse(houseId).catch(() => null)))
        : null;
    if (
      !userUsageDashboardLoad &&
      ((selected?.summary?.source === "SMT" && esiid) ||
        (selected?.summary?.source === "GREEN_BUTTON" && bucketBuildGreenButtonRawId))
    ) {
      const bucketWindowEnd =
        selected.summary.source === "GREEN_BUTTON" ? displayUtcBounds.rangeEndInclusive : canonicalEnd;
      const bucketWindowCutoff =
        selected.summary.source === "GREEN_BUTTON" ? displayUtcBounds.rangeStart : canonicalCutoff;
      if (Number.isFinite(bucketWindowEnd.getTime())) {
        const bucketBuild = await buildUsageBucketsForEstimate({
          homeId: houseId,
          usageSource: selected.summary.source,
          esiid: selected.summary.source === "SMT" ? esiid : null,
          rawId: selected.summary.source === "GREEN_BUTTON" ? bucketBuildGreenButtonRawId : null,
          windowEnd: bucketWindowEnd,
          cutoff: bucketWindowCutoff,
          requiredBucketKeys: ["kwh.m.all.total"],
          monthsCount: 12,
          maxStepDays: 2,
          stitchMode: "DAILY_OR_INTERVAL",
          homeTimezone,
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

  let insights: ActualHouseInsights = { ...emptyInsights };
  let dailyTotals: Array<{ date: string; kwh: number }> = [];
  let monthlyTotals: Array<{ month: string; kwh: number }> = [];
  let totals: ImportExportTotals = { importKwh: 0, exportKwh: 0, netKwh: 0 };
  try {
    const latestIso = selected?.summary?.latest ?? null;
    const latest = latestIso ? new Date(latestIso) : null;
    if (selected?.summary?.source && latest && Number.isFinite(latest.getTime())) {
      const insightWindowStartDate = selectedWindowStartDate ?? canonicalWindow.startDate;
      const insightWindowEndDate = selectedWindowEndDate ?? canonicalWindow.endDate;
      const insightUtcBounds = canonicalCoverageWindowUtcBounds({
        startDate: insightWindowStartDate,
        endDate: insightWindowEndDate,
      });
      const cutoff =
        args?.cutoff && Number.isFinite(args.cutoff.getTime())
          ? new Date(args.cutoff.getTime())
          : insightUtcBounds.rangeStart;
      const end = insightUtcBounds.rangeEndInclusive;
      let rawId: string | null = null;
      if (selected.summary.source === "GREEN_BUTTON") {
        rawId = await getLatestUsableRawGreenButtonIdForHouse(houseId);
      }
      const computed = await computeInsightsFromDb({
        source: selected.summary.source,
        esiid,
        houseId,
        rawId,
        cutoff,
        end,
        homeTimezone,
      });
      const rangeStart = selectedWindowStartDate ?? canonicalWindow.startDate;
      const rangeEnd = selectedWindowEndDate ?? canonicalWindow.endDate;
      const useIntervalBaseloadForDashboardSmt =
        userUsageDashboardLoad && selected.summary.source === "SMT" && Boolean(esiid);
      const baseloadFiltered = useIntervalBaseloadForDashboardSmt
        ? computeHomeBaseloadKw(
            (
              await getActualIntervalsForRange({
                houseId,
                esiid,
                startDate: rangeStart,
                endDate: rangeEnd,
                preferredSource: args?.preferredSource ?? null,
                homeTimezone,
              })
            ).map((r) => ({
              tsIso: String(r.timestamp ?? ""),
              kwh: Number(r.kwh) || 0,
              homeDateKey: r.homeDateKey ?? null,
            })),
            homeTimezone,
            { excludedDateKeys: args?.excludedDateKeys },
          )
        : userUsageDashboardLoad
          ? {
              baseloadKw: computed.baseload ?? null,
              fallbackUsed: false,
              debugNote: null as string | null,
            }
          : computeHomeBaseloadKw(
              (
                await getActualIntervalsForRange({
                  houseId,
                  esiid,
                  startDate: rangeStart,
                  endDate: rangeEnd,
                  preferredSource: args?.preferredSource ?? null,
                  homeTimezone,
                })
              ).map((r) => ({
                tsIso: String(r.timestamp ?? ""),
                kwh: Number(r.kwh) || 0,
                homeDateKey: r.homeDateKey ?? null,
              })),
              homeTimezone,
              { excludedDateKeys: args?.excludedDateKeys },
            );
      const baseload = baseloadFiltered.baseloadKw ?? computed.baseload;
      const baseloadMethod: ActualHouseBaseloadMethod = useIntervalBaseloadForDashboardSmt
        ? baseloadFiltered.fallbackUsed
          ? "FALLBACK_V1"
          : "FILTERED_NORMAL_LIFE_V1"
        : userUsageDashboardLoad
          ? (computed.baseloadMethod ?? "SQL_P10_V1")
          : baseloadFiltered.baseloadKw == null
            ? (computed.baseloadMethod ?? "SQL_P10_V1")
            : baseloadFiltered.fallbackUsed
              ? "FALLBACK_V1"
              : "FILTERED_NORMAL_LIFE_V1";
      dailyTotals = computed.dailyTotals;
      monthlyTotals = computed.monthlyTotals;
      totals = await computeImportExportTotalsFromDb({ source: selected.summary.source, esiid, houseId, rawId, cutoff, end });
      const effectiveStitchedMonthMeta =
        stitchedMonthMeta ??
        buildDisplayStitchedMonthMeta({
          monthlyTotals,
          coverageEndDateKey: selectedWindowEndDate,
        });
      insights = {
        fifteenMinuteAverages: computed.fifteenMinuteAverages,
        timeOfDayBuckets: computed.timeOfDayBuckets,
        ...(effectiveStitchedMonthMeta ? { stitchedMonth: effectiveStitchedMonthMeta } : {}),
        peakDay: computed.peakDay,
        peakHour: computed.peakHour,
        baseload,
        baseloadMethod,
        baseloadFallbackUsed: baseloadFiltered.fallbackUsed,
        baseloadDebugNote: baseloadFiltered.debugNote,
        baseloadDaily: computed.baseloadDaily,
        baseloadMonthly: computed.baseloadMonthly,
        weekdayVsWeekend: computed.weekdayVsWeekend,
      };
    }
  } catch {
    insights = { ...emptyInsights };
    dailyTotals = [];
    monthlyTotals = [];
    totals = { importKwh: 0, exportKwh: 0, netKwh: 0 };
  }

  // Prefer stitched monthly only when it has comparable coverage to DB monthly totals.
  // HomeMonthlyUsageBucket is often populated only for the current month, so stitched can
  // return 12 rows with 11 zeros and one non-zero; in that case use direct SMT monthly aggregation.
  const stitched = stitchedMonthlyTotals ?? [];
  const fromDb = monthlyTotals ?? [];
  const stitchedSum = stitched.reduce((s, m) => s + (Number(m?.kwh) || 0), 0);
  const dbSum = fromDb.reduce((s, m) => s + (Number(m?.kwh) || 0), 0);
  const stitchedNonZeroMonths = stitched.filter((m) => (Number(m?.kwh) || 0) > 1e-3).length;
  const useStitched =
    stitched.length > 0 &&
    (stitchedNonZeroMonths >= 2 || (dbSum <= 1e-3) || (stitchedSum >= dbSum * 0.5));
  const monthlyForDataset = useStitched ? stitched : fromDb;
  const stitchedMonthForDataset =
    stitchedMonthMeta ??
    buildDisplayStitchedMonthMeta({
      monthlyTotals: monthlyForDataset,
      coverageEndDateKey: selectedWindowEndDate,
    });
  const canonicalMonthsForDataset = buildDisplayCanonicalMonths({
    monthlyTotals: monthlyForDataset,
    stitchedMonth: stitchedMonthForDataset,
  });
  const baseloadMonthlyFromDataset = baseloadMonthlyFromDisplayedMonthly(
    monthlyForDataset,
    stitchedMonthForDataset,
  );
  if (insights && typeof insights === "object") {
    (insights as any).baseloadMonthly = baseloadMonthlyFromDataset;
    if (stitchedMonthForDataset) {
      (insights as any).stitchedMonth = stitchedMonthForDataset;
    }
  }
  const totalFromMonthly = round2(
    (monthlyForDataset ?? []).reduce((s, m) => s + (Number(m?.kwh) || 0), 0)
  );
  const totalsForDataset: ImportExportTotals =
    monthlyForDataset.length > 0
      ? { importKwh: totalFromMonthly, exportKwh: 0, netKwh: totalFromMonthly }
      : totals;
  const dailyTotalsForDataset = fillCanonicalDailyTotals(dailyTotals, displayCoverageWindow);

  const dataset: ActualHouseDataset | null = selected
    ? {
        summary: applyCanonicalCoverageToUsageSummary(
          {
            ...selected.summary,
            totalKwh: monthlyForDataset.length > 0 ? totalFromMonthly : selected.summary.totalKwh,
          },
          displayCoverageWindow,
        ),
        series: {
          ...selected.series,
          annual: selected.series?.annual?.length
            ? [{ ...selected.series.annual[0], kwh: monthlyForDataset.length > 0 ? totalFromMonthly : selected.series.annual[0].kwh }]
            : selected.series.annual,
        },
        daily: dailyTotalsForDataset,
        monthly: monthlyForDataset,
        insights,
        totals: totalsForDataset,
        meta: {
          datasetKind: "ACTUAL",
          actualSource: selected.summary.source,
          timezone: homeTimezone,
          coverageStart: displayCoverageWindow.startDate,
          coverageEnd: displayCoverageWindow.endDate,
          canonicalMonths: canonicalMonthsForDataset,
          canonicalEndMonth:
            canonicalMonthsForDataset.length > 0 ? canonicalMonthsForDataset[canonicalMonthsForDataset.length - 1] ?? null : null,
        },
      }
    : null;

  await hydrateActualUsageDailyWeather({ houseId, dataset });
  if (dataset && selected?.summary?.source === "SMT" && esiid) {
    await applySmtLedgerToActualDataset({ dataset, esiid, reconcile: true }).catch(() => null);
  }

  return {
    dataset,
    alternatives: {
      smt: smtDataset?.summary
        ? applyCanonicalCoverageToUsageSummary(smtDataset.summary, canonicalWindow)
        : null,
      greenButton: greenDataset?.summary ?? null,
    },
    ...(skippedFullYearIntervalFetch ? { skippedFullYearIntervalFetch: true } : {}),
  };
}

/** 15-min interval point for the full window. Used by Past stitched curve. */
export type ActualIntervalPoint = {
  timestamp: string;
  kwh: number;
  homeDateKey?: string;
  homeSlot?: number;
  homeSlotsExpected?: number;
};

/**
 * Fetches all actual 15-min intervals for a house in a date range (inclusive).
 * Used when building Past so unchanged segments use real usage intervals.
 */
export async function getActualIntervalsForRangeWithSource(args: {
  houseId: string;
  esiid: string | null;
  startDate: string;
  endDate: string;
  preferredSource?: ActualUsageSource | null;
  homeTimezone?: string;
}): Promise<{ source: "SMT" | "GREEN_BUTTON" | null; intervals: ActualIntervalPoint[] }> {
  const homeTimezone =
    args.homeTimezone?.trim() ||
    (await loadHomeTimezoneForHouseId(args.houseId, {
      preferredActualSource: args.preferredSource === "SMT" ? "SMT" : "GREEN_BUTTON",
    }));
  const startDateKey = normalizeDateKey(args.startDate);
  const endDateKey = normalizeDateKey(args.endDate);
  if (!startDateKey || !endDateKey || startDateKey > endDateKey) {
    return { source: null, intervals: [] };
  }
  const rangeBounds = canonicalCoverageWindowUtcBounds({ startDate: startDateKey, endDate: endDateKey });
  const start = rangeBounds.rangeStart;
  const end = rangeBounds.rangeEndInclusive;
  const source = await chooseActualSource({
    houseId: args.houseId,
    esiid: args.esiid,
    preferredSource: args.preferredSource ?? null,
  });
  if (!source) return { source: null, intervals: [] };
  if (source === "SMT") {
    if (!args.esiid) return { source: "SMT", intervals: [] };
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
      const smtConverted = convertSmtPersistedRowsToHome(
        rows.map((row) => ({ ts: row.ts, kwh: decimalToNumber(row.kwh) })),
        homeTimezone,
      );
      return {
        source: "SMT",
        intervals: smtConverted.intervals.map(homeProjectedIntervalFromRecord),
      };
    } catch {
      return { source: "SMT", intervals: [] };
    }
  }
  if (!USAGE_DB_ENABLED) return { source: "GREEN_BUTTON", intervals: [] };
  try {
    const usageClient = usagePrisma as any;
    const rawId = await getLatestUsableRawGreenButtonIdForHouse(args.houseId);
    if (!rawId) return { source: "GREEN_BUTTON", intervals: [] };
    const rows = (await usageClient.$queryRaw(Prisma.sql`
      SELECT "timestamp" AS ts, "consumptionKwh"::float AS kwh
      FROM "GreenButtonInterval"
      WHERE "homeId" = ${args.houseId} AND "rawId" = ${rawId}
        AND "timestamp" >= ${start} AND "timestamp" <= ${end}
      ORDER BY "timestamp" ASC
    `)) as Array<{ ts: Date; kwh: number }>;
    const gbConverted = convertGreenButtonPersistedRowsToHome(
      rows.map((row) => ({
        timestamp: row.ts instanceof Date ? row.ts : new Date(row.ts),
        consumptionKwh: Number(row.kwh) || 0,
      })),
      homeTimezone,
    );
    return {
      source: "GREEN_BUTTON",
      intervals: gbConverted.intervals.map(homeProjectedIntervalFromRecord),
    };
  } catch {
    return { source: "GREEN_BUTTON", intervals: [] };
  }
}

export async function getActualIntervalsForRange(args: {
  houseId: string;
  esiid: string | null;
  startDate: string;
  endDate: string;
  preferredSource?: ActualUsageSource | null;
  homeTimezone?: string;
}): Promise<ActualIntervalPoint[]> {
  const out = await getActualIntervalsForRangeWithSource(args);
  return out.intervals;
}

/**
 * Fingerprint of actual interval data for a house in a date range.
 * Includes count, latest timestamp, and a value-sensitive checksum so same-timestamp kWh edits
 * invalidate cache even when count and max timestamp are unchanged.
 */
export async function getIntervalDataFingerprint(args: {
  houseId: string;
  esiid: string | null;
  startDate: string;
  endDate: string;
  preferredSource?: ActualUsageSource | null;
}): Promise<string> {
  const startDateKey = normalizeDateKey(args.startDate);
  const endDateKey = normalizeDateKey(args.endDate);
  if (!startDateKey || !endDateKey || startDateKey > endDateKey) {
    return "";
  }
  const rangeBounds = canonicalCoverageWindowUtcBounds({ startDate: startDateKey, endDate: endDateKey });
  const start = rangeBounds.rangeStart;
  const end = rangeBounds.rangeEndInclusive;
  const source = await chooseActualSource({
    houseId: args.houseId,
    esiid: args.esiid,
    preferredSource: args.preferredSource ?? null,
  });
  if (!source) return "";
  try {
    if (source === "SMT") {
      if (!args.esiid) return "";
      const rows = await prisma.$queryRaw<Array<{ count: string; max_ts: Date | null; value_hash: string | null }>>(Prisma.sql`
        WITH iv AS (
          SELECT "ts", MAX(CASE WHEN "kwh" >= 0 THEN "kwh" ELSE 0 END)::float AS kwh
          FROM "SmtInterval"
          WHERE "esiid" = ${args.esiid} AND "ts" >= ${start} AND "ts" <= ${end}
          GROUP BY "ts"
        )
        SELECT
          COUNT(*)::text AS count,
          MAX("ts") AS max_ts,
          md5(
            COALESCE(COUNT(*)::text, '0') || ':' ||
            COALESCE(SUM(hashtextextended(to_char("ts", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') || ':' || to_char(kwh, 'FM9999999990.000000'), 0)::numeric)::text, '0') || ':' ||
            COALESCE(MIN(hashtextextended(to_char("ts", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') || ':' || to_char(kwh, 'FM9999999990.000000'), 0)::bigint)::text, '0') || ':' ||
            COALESCE(MAX(hashtextextended(to_char("ts", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') || ':' || to_char(kwh, 'FM9999999990.000000'), 0)::bigint)::text, '0')
          ) AS value_hash
        FROM iv
      `);
      const r = rows?.[0];
      const count = r?.count ?? "0";
      const maxTs = r?.max_ts ? String((r.max_ts instanceof Date ? r.max_ts : new Date(r.max_ts)).getTime()) : "";
      const valueHash = String(r?.value_hash ?? "");
      return `${count}:${maxTs}:${valueHash}`;
    }
    if (!USAGE_DB_ENABLED) return "";
    const usageClient = usagePrisma as any;
    const rawId = await getLatestUsableRawGreenButtonIdForHouse(args.houseId);
    if (!rawId) return "";
    const rows = (await usageClient.$queryRaw(Prisma.sql`
      SELECT
        COUNT(*)::text AS count,
        MAX("timestamp") AS max_ts,
        md5(
          COALESCE(COUNT(*)::text, '0') || ':' ||
          COALESCE(SUM(hashtextextended(to_char("timestamp", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') || ':' || to_char("consumptionKwh"::float, 'FM9999999990.000000'), 0)::numeric)::text, '0') || ':' ||
          COALESCE(MIN(hashtextextended(to_char("timestamp", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') || ':' || to_char("consumptionKwh"::float, 'FM9999999990.000000'), 0)::bigint)::text, '0') || ':' ||
          COALESCE(MAX(hashtextextended(to_char("timestamp", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') || ':' || to_char("consumptionKwh"::float, 'FM9999999990.000000'), 0)::bigint)::text, '0')
        ) AS value_hash
      FROM "GreenButtonInterval"
      WHERE "homeId" = ${args.houseId} AND "rawId" = ${rawId}
        AND "timestamp" >= ${start} AND "timestamp" <= ${end}
    `)) as Array<{ count: string; max_ts: Date | null; value_hash: string | null }>;
    const r = rows?.[0];
    const count = r?.count ?? "0";
    const maxTs = r?.max_ts ? String((r.max_ts instanceof Date ? r.max_ts : new Date(r.max_ts)).getTime()) : "";
    const valueHash = String(r?.value_hash ?? "");
    return `${count}:${maxTs}:${valueHash}`;
  } catch {
    return "";
  }
}