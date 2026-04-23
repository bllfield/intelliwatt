import { buildDailyFromIntervals, buildDisplayMonthlyFromIntervalsUtc } from "@/modules/onePathSim/usageSimulator/dataset";
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
  const monthlyBuild = buildDisplayMonthlyFromIntervalsUtc(
    remappedIntervals15.map((row: any) => ({
      timestamp: String(row?.timestamp ?? ""),
      consumption_kwh: Number(row?.consumption_kwh ?? row?.kwh ?? 0) || 0,
    })),
    displayEnd
  );
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
    monthly: monthlyBuild.monthly,
    daily: remappedDaily,
    dailyWeather: remappedDailyWeather,
    totals: {
      ...(dataset?.totals ?? {}),
      importKwh:
        typeof dataset?.totals?.importKwh === "number"
          ? dataset.totals.importKwh
          : monthlyBuild.monthly.reduce((sum, row) => sum + (Number(row?.kwh) || 0), 0),
      exportKwh: typeof dataset?.totals?.exportKwh === "number" ? dataset.totals.exportKwh : 0,
      netKwh:
        typeof dataset?.totals?.netKwh === "number"
          ? dataset.totals.netKwh
          : monthlyBuild.monthly.reduce((sum, row) => sum + (Number(row?.kwh) || 0), 0),
    },
    insights: {
      ...(dataset?.insights ?? {}),
      stitchedMonth: monthlyBuild.stitchedMonth,
    },
    series: {
      ...(dataset?.series ?? {}),
      intervals15: remappedIntervals15,
      daily: remappedSeriesDaily,
    },
  };
}
