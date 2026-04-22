import { buildUserUsageDashboardViewModel } from "@/lib/usage/userUsageDashboardViewModel";
import type { UserUsageHouseContract } from "@/lib/usage/userUsageHouseContract";
import type { OnePathBaselineParityAudit } from "@/modules/onePathSim/baselineParityAudit";
import type { WeatherSensitivityScore } from "@/modules/onePathSim/weatherSensitivityShared";

export type OnePathBaselineReadOnlyView = {
  summary: {
    source: string | null;
    coverageStart: string | null;
    coverageEnd: string | null;
    intervalsCount: number | null;
    weatherBasisLabel: string | null;
    sourceOfDaySimulationCore: string | null;
    totals: { importKwh: number; exportKwh: number; netKwh: number };
    avgDailyKwh: number;
    baseload: number | null;
    baseloadDaily: number | null;
    baseloadMonthly: number | null;
    peakDay: { date: string; kwh: number } | null;
    peakHour: { hour: number; kw: number } | null;
    weekdayKwh: number;
    weekendKwh: number;
    timeOfDayBuckets: Array<{ key: string; label: string; kwh: number }>;
  };
  monthlyRows: Array<{ month: string; kwh: number }>;
  dailyRows: Array<{ date: string; kwh: number; source?: string; sourceDetail?: string }>;
  dailyWeather: Record<string, { tAvgF: number; tMinF: number; tMaxF: number; hdd65: number; cdd65: number; source?: string }> | null;
  fifteenMinuteAverages: Array<{ hhmm: string; avgKw: number }>;
  stitchedMonth: {
    mode: "PRIOR_YEAR_TAIL";
    yearMonth: string;
    haveDaysThrough: number;
    missingDaysFrom: number;
    missingDaysTo: number;
    borrowedFromYearMonth: string;
    completenessRule: string;
  } | null;
  weatherScore: WeatherSensitivityScore | null;
  parityAudit: OnePathBaselineParityAudit | null;
};

export function buildOnePathBaselineReadOnlyView(args: {
  houseContract?: UserUsageHouseContract | null;
  parityAudit?: OnePathBaselineParityAudit | null;
}): OnePathBaselineReadOnlyView | null {
  const viewModel = buildUserUsageDashboardViewModel(args.houseContract ?? null);
  if (!viewModel) return null;

  return {
    summary: {
      source: viewModel.coverage.source,
      coverageStart: viewModel.coverage.start,
      coverageEnd: viewModel.coverage.end,
      intervalsCount: viewModel.coverage.intervalsCount,
      weatherBasisLabel: viewModel.coverage.weatherBasisLabel,
      sourceOfDaySimulationCore: viewModel.coverage.sourceOfDaySimulationCore,
      totals: viewModel.derived.totals,
      avgDailyKwh: viewModel.derived.avgDailyKwh,
      baseload: viewModel.derived.baseload,
      baseloadDaily: viewModel.derived.baseloadDaily,
      baseloadMonthly: viewModel.derived.baseloadMonthly,
      peakDay: viewModel.derived.peakDay,
      peakHour: viewModel.derived.peakHour,
      weekdayKwh: viewModel.derived.weekdayKwh,
      weekendKwh: viewModel.derived.weekendKwh,
      timeOfDayBuckets: viewModel.derived.timeOfDayBuckets,
    },
    monthlyRows: viewModel.derived.monthly,
    dailyRows: viewModel.derived.daily,
    dailyWeather: (viewModel.derived.dailyWeather as OnePathBaselineReadOnlyView["dailyWeather"]) ?? null,
    fifteenMinuteAverages: viewModel.derived.fifteenCurve,
    stitchedMonth: viewModel.derived.stitchedMonth,
    weatherScore: (args.houseContract?.weatherSensitivityScore as WeatherSensitivityScore | null | undefined) ?? null,
    parityAudit: args.parityAudit ?? null,
  };
}
