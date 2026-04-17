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
  const canonicalWindow = resolveCanonicalUsage365CoverageWindow();
  const coverageStart = canonicalWindow.startDate;
  const coverageEnd = canonicalWindow.endDate;
  const provenance = meta.monthProvenanceByMonth as Record<string, string> | undefined;
  const actualSource = meta.actualSource as string | undefined;
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
      weekdayKwh: dataset?.insights?.weekdayVsWeekend?.weekday ?? 0,
      weekendKwh: dataset?.insights?.weekdayVsWeekend?.weekend ?? 0,
      timeOfDayBuckets: (dataset?.insights?.timeOfDayBuckets ?? []).map((bucket: any) => ({
        key: bucket.key,
        label: bucket.label,
        kwh: bucket.kwh,
      })),
      peakDay: dataset?.insights?.peakDay ?? null,
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
