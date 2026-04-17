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
    totals: { importKwh: number; exportKwh: number; netKwh: number };
    baseload: number | null;
    peakDay: { date: string; kwh: number } | null;
    peakHour: { hour: number; kw: number } | null;
    weekdayKwh: number;
    weekendKwh: number;
    timeOfDayBuckets: Array<{ key: string; label: string; kwh: number }>;
  };
  monthlyRows: Array<{ month: string; kwh: number }>;
  dailyRows: Array<{ date: string; kwh: number; source?: string; sourceDetail?: string }>;
  fifteenMinuteAverages: Array<{ hhmm: string; avgKw: number }>;
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
      totals: viewModel.derived.totals,
      baseload: viewModel.derived.baseload,
      peakDay: viewModel.derived.peakDay,
      peakHour: viewModel.derived.peakHour,
      weekdayKwh: viewModel.derived.weekdayKwh,
      weekendKwh: viewModel.derived.weekendKwh,
      timeOfDayBuckets: viewModel.derived.timeOfDayBuckets,
    },
    monthlyRows: viewModel.derived.monthly,
    dailyRows: viewModel.derived.daily,
    fifteenMinuteAverages: viewModel.derived.fifteenCurve,
    weatherScore: (args.houseContract?.weatherSensitivityScore as WeatherSensitivityScore | null | undefined) ?? null,
    parityAudit: args.parityAudit ?? null,
  };
}
