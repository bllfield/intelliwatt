import { buildDailyFromIntervals } from "@/modules/onePathSim/usageSimulator/dataset";
import { resolveCanonicalUsage365CoverageWindow } from "@/modules/onePathSim/usageSimulator/metadataWindow";

function asDateKey(value: unknown): string | null {
  const text = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function addDays(dateKey: string, days: number): string {
  const dt = new Date(`${dateKey}T00:00:00.000Z`);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function enumerateDateKeysInclusive(startDate: string, endDate: string): string[] {
  const start = asDateKey(startDate);
  const end = asDateKey(endDate);
  if (!start || !end || end < start) return [];
  const out: string[] = [];
  for (let current = start; current <= end; current = addDays(current, 1)) out.push(current);
  return out;
}

function remapDatePrefix(timestamp: string, dateMap: Map<string, string>): string {
  const sourceDate = timestamp.slice(0, 10);
  const targetDate = dateMap.get(sourceDate);
  if (!targetDate) return timestamp;
  return `${targetDate}${timestamp.slice(10)}`;
}

function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function lastNYearMonthsFrom(year: number, month1: number, n: number): string[] {
  const out: string[] = [];
  const count = Math.max(1, Math.floor(n));
  for (let i = count - 1; i >= 0; i -= 1) {
    const idx = month1 - i;
    const normalizedYear = idx >= 1 ? year : year - Math.ceil((1 - idx) / 12);
    const normalizedMonth = ((idx - 1) % 12 + 12) % 12 + 1;
    out.push(`${String(normalizedYear)}-${String(normalizedMonth).padStart(2, "0")}`);
  }
  return out;
}

function buildManualDisplayMonthly(args: {
  intervals15: Array<{ timestamp?: unknown; consumption_kwh?: unknown; kwh?: unknown }>;
  displayStart: string;
  displayEnd: string;
}) {
  const monthTotals = new Map<string, number>();
  for (const row of args.intervals15) {
    const timestamp = String(row?.timestamp ?? "");
    const dateKey = timestamp.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) continue;
    if (dateKey < args.displayStart || dateKey > args.displayEnd) continue;
    const yearMonth = dateKey.slice(0, 7);
    const kwh = Number(row?.consumption_kwh ?? row?.kwh ?? 0) || 0;
    monthTotals.set(yearMonth, (monthTotals.get(yearMonth) ?? 0) + kwh);
  }

  const displayEndDate = new Date(`${args.displayEnd}T00:00:00.000Z`);
  const endYear = displayEndDate.getUTCFullYear();
  const endMonth = displayEndDate.getUTCMonth() + 1;
  const yearMonths = lastNYearMonthsFrom(endYear, endMonth, 12);
  const monthlyTotals = new Map<string, number>();
  for (const yearMonth of yearMonths) {
    monthlyTotals.set(yearMonth, monthTotals.get(yearMonth) ?? 0);
  }

  const leadingYearMonth = args.displayStart.slice(0, 7);
  if (/^\d{4}-\d{2}$/.test(leadingYearMonth) && !yearMonths.includes(leadingYearMonth)) {
    const trailingYearMonth = yearMonths[yearMonths.length - 1]!;
    monthlyTotals.set(
      trailingYearMonth,
      (monthlyTotals.get(trailingYearMonth) ?? 0) + (monthTotals.get(leadingYearMonth) ?? 0)
    );
  }

  return yearMonths.map((month) => ({
    month,
    kwh: round2(monthlyTotals.get(month) ?? 0),
  }));
}

function buildDisplayNote(args: {
  simulationWindowStart: string;
  simulationWindowEnd: string;
  displayWindowStart: string;
  displayWindowEnd: string;
  stitchedTailDayCount: number;
}) {
  return (
    `Manual simulation ran on the original bill-date weather window ` +
    `${args.simulationWindowStart}..${args.simulationWindowEnd}. ` +
    `To match the standard customer view, the chart is re-dated to ` +
    `${args.displayWindowStart}..${args.displayWindowEnd}` +
    (args.stitchedTailDayCount > 0
      ? ` and the post-anchor ${args.stitchedTailDayCount} day tail uses those prior-year simulated/weather days.`
      : ".")
  );
}

export function remapManualDisplayDatasetToCanonicalWindow(args: {
  dataset: any;
  usageInputMode?: string | null;
  displayWindowEndDate?: string | null;
}) {
  const usageInputMode = String(args.usageInputMode ?? "").trim().toUpperCase();
  if (usageInputMode !== "MANUAL_MONTHLY" && usageInputMode !== "MANUAL_ANNUAL") {
    return args.dataset;
  }
  const dataset = args.dataset;
  const summaryStart = asDateKey(dataset?.summary?.start);
  const summaryEnd = asDateKey(dataset?.summary?.end);
  if (!summaryStart || !summaryEnd || summaryEnd < summaryStart) return dataset;

  const sourceDateKeys = enumerateDateKeysInclusive(summaryStart, summaryEnd);
  if (sourceDateKeys.length === 0) return dataset;

  const displayEnd = asDateKey(args.displayWindowEndDate) ?? resolveCanonicalUsage365CoverageWindow().endDate;
  const displayStart = addDays(displayEnd, -(sourceDateKeys.length - 1));
  const targetDateKeys = enumerateDateKeysInclusive(displayStart, displayEnd);
  if (targetDateKeys.length !== sourceDateKeys.length) return dataset;

  const dateMap = new Map(sourceDateKeys.map((dateKey, index) => [dateKey, targetDateKeys[index]!]));
  const stitchedTailDayCount = sourceDateKeys.reduce((count, sourceDate) => {
    const targetDate = dateMap.get(sourceDate);
    return targetDate != null && targetDate > summaryEnd ? count + 1 : count;
  }, 0);

  const sourceIntervals15 = Array.isArray(dataset?.series?.intervals15) ? dataset.series.intervals15 : [];
  const remappedIntervals15 = sourceIntervals15.map((row: any) => ({
    ...row,
    timestamp: remapDatePrefix(String(row?.timestamp ?? ""), dateMap),
  }));
  const remappedDaily =
    Array.isArray(dataset?.daily) && dataset.daily.length > 0
      ? dataset.daily.map((row: any) => {
          const sourceDate = asDateKey(row?.date);
          return {
            ...row,
            date: sourceDate ? dateMap.get(sourceDate) ?? sourceDate : row?.date,
          };
        })
      : buildDailyFromIntervals(remappedIntervals15);
  const remappedSeriesDaily = Array.isArray(dataset?.series?.daily)
    ? dataset.series.daily.map((row: any) => ({
        ...row,
        timestamp: remapDatePrefix(String(row?.timestamp ?? ""), dateMap),
      }))
    : dataset?.series?.daily;
  const remappedIntervalRows = remappedIntervals15.map((row: any) => ({
    timestamp: String(row?.timestamp ?? ""),
    consumption_kwh: Number(row?.consumption_kwh ?? row?.kwh ?? 0) || 0,
  }));
  const manualDisplayMonthly = buildManualDisplayMonthly({
    intervals15: remappedIntervalRows,
    displayStart,
    displayEnd,
  });
  const remappedTotalKwh = round2(remappedIntervalRows.reduce((sum, row) => sum + (Number(row?.consumption_kwh) || 0), 0));
  const remappedDailyWeather =
    dataset?.dailyWeather && typeof dataset.dailyWeather === "object"
      ? Object.fromEntries(
          Object.entries(dataset.dailyWeather as Record<string, unknown>).map(([dateKey, weather]) => [
            dateMap.get(dateKey) ?? dateKey,
            weather,
          ])
        )
      : dataset?.dailyWeather;
  const displayNote = buildDisplayNote({
    simulationWindowStart: summaryStart,
    simulationWindowEnd: summaryEnd,
    displayWindowStart: displayStart,
    displayWindowEnd: displayEnd,
    stitchedTailDayCount,
  });

  return {
    ...dataset,
    summary: {
      ...(dataset?.summary ?? {}),
      start: displayStart,
      end: displayEnd,
      totalKwh:
        typeof dataset?.summary?.totalKwh === "number" ? dataset.summary.totalKwh : remappedTotalKwh,
    },
    meta: {
      ...(dataset?.meta ?? {}),
      coverageStart: displayStart,
      coverageEnd: displayEnd,
      manualDisplayWindowStitch: {
        simulationWindowStart: summaryStart,
        simulationWindowEnd: summaryEnd,
        displayWindowStart: displayStart,
        displayWindowEnd: displayEnd,
        remappedDayCount: sourceDateKeys.length,
        stitchedTailDayCount,
      },
      manualDisplayWindowNote: displayNote,
      weatherNote:
        typeof dataset?.meta?.weatherNote === "string" && String(dataset.meta.weatherNote).trim().length > 0
          ? `${String(dataset.meta.weatherNote).trim()} ${displayNote}`
          : displayNote,
    },
    monthly: manualDisplayMonthly,
    daily: remappedDaily,
    dailyWeather: remappedDailyWeather,
    totals: {
      ...(dataset?.totals ?? {}),
      importKwh:
        typeof dataset?.totals?.importKwh === "number"
          ? dataset.totals.importKwh
          : remappedTotalKwh,
      exportKwh: typeof dataset?.totals?.exportKwh === "number" ? dataset.totals.exportKwh : 0,
      netKwh:
        typeof dataset?.totals?.netKwh === "number"
          ? dataset.totals.netKwh
          : remappedTotalKwh,
    },
    insights: {
      ...(dataset?.insights ?? {}),
      // Manual display-window remap already carries the dropped leading days into the
      // trailing displayed month, so the generic latest-month stitch metadata is misleading.
      stitchedMonth: null,
    },
    series: {
      ...(dataset?.series ?? {}),
      intervals15: remappedIntervals15,
      daily: remappedSeriesDaily,
    },
  };
}
