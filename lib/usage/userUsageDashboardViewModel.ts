import { dailyRowFieldsFromSourceRow } from "@/modules/usageSimulator/dailyRowFieldsFromDisplay";
import { resolveCanonicalUsage365CoverageWindow } from "@/modules/usageSimulator/metadataWindow";
import { buildDisplayedMonthlyRows } from "@/modules/usageSimulator/monthlyCompareRows";
import type { UserUsageHouseContract } from "@/lib/usage/userUsageHouseContract";

type UserUsageDashboardHouseLike = Pick<UserUsageHouseContract, "dataset"> & {
  weatherSensitivityScore?: UserUsageHouseContract["weatherSensitivityScore"];
  datasetError?: { code?: string; explanation?: string } | null;
};

type DailyRow = {
  date: string;
  kwh: number;
  source?: string;
  sourceDetail?: string;
};

function getWeatherBasisLabel(meta: Record<string, unknown>): string | null {
  const summary = meta.weatherSourceSummary as string | undefined;
  const reason = meta.weatherFallbackReason as string | undefined;
  const reasonSuffix =
    reason === "missing_lat_lng"
      ? " (no coordinates)"
      : reason === "partial_coverage"
        ? " (partial coverage)"
        : reason === "api_failure_or_no_data"
          ? " (API unavailable)"
          : "";
  if (summary === "stub_only") return "Weather basis: stub/test weather data" + reasonSuffix;
  if (summary === "actual_only") return "Weather basis: actual cached weather data";
  if (summary === "mixed_actual_and_stub") return "Weather basis: mixed actual + stub weather data" + reasonSuffix;
  if (summary === "unknown" || (summary && summary !== "none")) {
    return "Weather basis: " + (reason ? reason.replace(/_/g, " ") : "unknown");
  }
  return null;
}

function deriveTotalsFromRows(rows: Array<{ kwh: number }>) {
  let importKwh = 0;
  let exportKwh = 0;
  for (const row of rows) {
    if (row.kwh >= 0) importKwh += row.kwh;
    else exportKwh += Math.abs(row.kwh);
  }
  return {
    importKwh,
    exportKwh,
    netKwh: importKwh - exportKwh,
  };
}

function toDateKeyFromTimestamp(timestamp: string): string {
  return timestamp.slice(0, 10);
}

function asDateKey(value: unknown): string | null {
  const text = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function chicagoHour(timestamp: string, timezone: string): number | null {
  try {
    const ts = new Date(timestamp);
    if (!Number.isFinite(ts.getTime())) return null;
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
    });
    const parts = fmt.formatToParts(ts);
    const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "");
    return Number.isFinite(hour) && hour >= 0 && hour <= 23 ? hour : null;
  } catch {
    return null;
  }
}

function deriveWeekdayWeekendFromDaily(rows: DailyRow[]) {
  let weekday = 0;
  let weekend = 0;
  for (const row of rows) {
    const ts = new Date(`${row.date}T00:00:00.000Z`);
    const day = ts.getUTCDay();
    if (day === 0 || day === 6) weekend += Number(row.kwh) || 0;
    else weekday += Number(row.kwh) || 0;
  }
  return {
    weekday: Number(weekday.toFixed(2)),
    weekend: Number(weekend.toFixed(2)),
  };
}

function deriveTimeOfDayBucketsFromIntervals(
  rows: Array<{ timestamp?: unknown; kwh?: unknown; consumption_kwh?: unknown }>,
  options?: { start?: string | null; end?: string | null; timezone?: string }
) {
  const timezone = options?.timezone?.trim() ? options.timezone.trim() : "America/Chicago";
  const sums = { overnight: 0, morning: 0, afternoon: 0, evening: 0 };
  for (const row of rows) {
    const timestamp = String(row?.timestamp ?? "");
    const dateKey = asDateKey(timestamp);
    if (!dateKey) continue;
    if (options?.start && dateKey < options.start) continue;
    if (options?.end && dateKey > options.end) continue;
    const hour = chicagoHour(timestamp, timezone);
    if (hour == null) continue;
    const kwh = Number(row?.kwh ?? row?.consumption_kwh ?? 0) || 0;
    if (hour < 6) sums.overnight += kwh;
    else if (hour < 12) sums.morning += kwh;
    else if (hour < 18) sums.afternoon += kwh;
    else sums.evening += kwh;
  }
  return [
    { key: "overnight", label: "Overnight (12am–6am)", kwh: Number(sums.overnight.toFixed(2)) },
    { key: "morning", label: "Morning (6am–12pm)", kwh: Number(sums.morning.toFixed(2)) },
    { key: "afternoon", label: "Afternoon (12pm–6pm)", kwh: Number(sums.afternoon.toFixed(2)) },
    { key: "evening", label: "Evening (6pm–12am)", kwh: Number(sums.evening.toFixed(2)) },
  ];
}

function low10AverageKwh(values: number[]): number | null {
  const finite = values.filter((value) => Number.isFinite(value));
  if (!finite.length) return null;
  const positive = finite.filter((value) => value > 1e-6).sort((left, right) => left - right);
  const count10 = Math.max(1, Math.floor((positive.length || finite.length) * 0.1));
  const slice =
    positive.length >= count10
      ? positive.slice(0, count10)
      : finite.sort((left, right) => left - right).slice(0, Math.max(1, Math.floor(finite.length * 0.1)));
  if (!slice.length) return null;
  const average = slice.reduce((sum, value) => sum + value, 0) / slice.length;
  return Number.isFinite(average) ? average : null;
}

export function buildUserUsageDashboardViewModel(house: UserUsageDashboardHouseLike | null | undefined) {
  if (!house?.dataset) return null;

  const dataset = house.dataset as any;
  const meta = ((dataset as any)?.meta ?? {}) as Record<string, unknown>;
  const datasetKind = meta.datasetKind ?? null;
  const hasManualDisplayWindowStitch =
    meta.manualDisplayWindowStitch != null &&
    typeof meta.manualDisplayWindowStitch === "object" &&
    !Array.isArray(meta.manualDisplayWindowStitch);
  const canonicalWindow = resolveCanonicalUsage365CoverageWindow();
  const coverageStart =
    asDateKey(meta.coverageStart) ?? canonicalWindow.startDate;
  const coverageEnd =
    asDateKey(meta.coverageEnd) ?? canonicalWindow.endDate;
  const provenance = meta.monthProvenanceByMonth as Record<string, string> | undefined;
  const actualSource = meta.actualSource as string | undefined;
  const timezone = typeof meta.timezone === "string" ? meta.timezone : "America/Chicago";
  const hasSimulatedFill =
    datasetKind === "SIMULATED" &&
    actualSource &&
    provenance &&
    Object.values(provenance).some((value) => value === "SIMULATED");
  const coverage = {
    source:
      hasSimulatedFill && actualSource
        ? `${actualSource} with simulated fill for Travel/Vacant`
        : datasetKind === "SIMULATED"
          ? "SIMULATED"
          : dataset?.summary?.source ?? null,
    start: coverageStart,
    end: coverageEnd,
    intervalsCount: dataset?.summary?.intervalsCount ?? null,
    hasSimulatedFill,
    weatherBasisLabel: getWeatherBasisLabel(meta),
    sourceOfDaySimulationCore: (meta.sourceOfDaySimulationCore as string) || null,
  };

  const monthly = dataset?.monthly ?? dataset?.insights?.monthlyTotals ?? [];
  const daily = dataset?.daily ?? [];
  const fallbackDailyRaw = daily.length
    ? daily
    : (dataset?.series?.daily ?? []).map((row: any) =>
        dailyRowFieldsFromSourceRow({
          date: toDateKeyFromTimestamp(row.timestamp),
          kwh: row.kwh,
          source: row.source,
          sourceDetail: row.sourceDetail,
        })
      );
  const dateInRange = (date: string) => (!coverageStart || date >= coverageStart) && (!coverageEnd || date <= coverageEnd);
  const seen = new Set<string>();
  const fallbackDaily = fallbackDailyRaw
    .filter((row: any) => {
      const date = String(row?.date ?? "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
      if (seen.has(date)) return false;
      seen.add(date);
      return dateInRange(date);
    })
    .map(
      (row: any): DailyRow =>
        dailyRowFieldsFromSourceRow({
          date: String(row.date),
          kwh: row.kwh,
          source: row.source,
          sourceDetail: row.sourceDetail,
        })
    )
    .sort((left: DailyRow, right: DailyRow) => (left.date < right.date ? -1 : 1));

  const intervals = dataset?.intervals ?? [];
  const fifteenCurve = (dataset?.insights?.fifteenMinuteAverages ?? []).slice().sort((left: any, right: any) => {
    const toMinutes = (hhmm: string) => {
      const [hour, minute] = hhmm.split(":").map(Number);
      return hour * 60 + minute;
    };
    return toMinutes(left.hhmm) - toMinutes(right.hhmm);
  });
  const totalsFromApi = dataset?.totals;
  const totalsFromSeries =
    fallbackDaily.length
      ? deriveTotalsFromRows(fallbackDaily)
      : intervals.length
        ? deriveTotalsFromRows(intervals.map((row: any) => ({ kwh: row.kwh })))
        : { importKwh: 0, exportKwh: 0, netKwh: 0 };
  const totalsFromMonthly = monthly.length
    ? deriveTotalsFromRows(monthly.map((row: any) => ({ kwh: Number(row?.kwh) || 0 })))
    : null;
  const totals =
    totalsFromApi != null
      ? totalsFromMonthly != null && Math.abs((Number(totalsFromApi?.netKwh) || 0) - totalsFromMonthly.netKwh) > 0.05
        ? totalsFromMonthly
        : totalsFromApi
      : totalsFromMonthly ?? totalsFromSeries;
  const totalKwh = totals.netKwh;
  const recentDaily = fallbackDaily
    .slice()
    .sort((left: DailyRow, right: DailyRow) => (left.date < right.date ? -1 : 1));
  const monthlySorted = buildDisplayedMonthlyRows(dataset);
  const weekdayWeekend = hasManualDisplayWindowStitch ? deriveWeekdayWeekendFromDaily(recentDaily) : null;
  const timeOfDayBuckets = hasManualDisplayWindowStitch
    ? deriveTimeOfDayBucketsFromIntervals(dataset?.series?.intervals15 ?? [], {
        start: coverageStart,
        end: coverageEnd,
        timezone,
      })
    : null;
  const peakDay = hasManualDisplayWindowStitch
    ? recentDaily.length > 0
      ? recentDaily.reduce(
          (current: DailyRow, row: DailyRow) => ((Number(row.kwh) || 0) > (Number(current.kwh) || 0) ? row : current)
        )
      : null
    : null;

  return {
    coverage,
    derived: {
      monthly: monthlySorted,
      stitchedMonth: dataset?.insights?.stitchedMonth ?? null,
      daily: recentDaily,
      dailyWeather: dataset?.dailyWeather ?? null,
      fifteenCurve,
      totalKwh,
      totals,
      avgDailyKwh: fallbackDaily.length ? totalKwh / fallbackDaily.length : 0,
      weekdayKwh: weekdayWeekend?.weekday ?? dataset?.insights?.weekdayVsWeekend?.weekday ?? 0,
      weekendKwh: weekdayWeekend?.weekend ?? dataset?.insights?.weekdayVsWeekend?.weekend ?? 0,
      timeOfDayBuckets: timeOfDayBuckets && timeOfDayBuckets.length
        ? timeOfDayBuckets
        : (dataset?.insights?.timeOfDayBuckets ?? []).map((bucket: any) => ({
        key: bucket.key,
        label: bucket.label,
        kwh: bucket.kwh,
      })),
      peakDay: peakDay ?? dataset?.insights?.peakDay ?? null,
      peakHour: dataset?.insights?.peakHour ?? null,
      baseload: dataset?.insights?.baseload ?? null,
      baseloadDaily:
        dataset?.insights?.baseloadDaily ??
        (() => {
          const value = low10AverageKwh(recentDaily.map((row: DailyRow) => Number(row.kwh) || 0));
          return value != null ? Number(value.toFixed(2)) : null;
        })(),
      baseloadMonthly:
        dataset?.insights?.baseloadMonthly ??
        (() => {
          const value = low10AverageKwh(monthlySorted.map((row: { month: string; kwh: number }) => Number(row.kwh) || 0));
          return value != null ? Number(value.toFixed(2)) : null;
        })(),
    },
  };
}
