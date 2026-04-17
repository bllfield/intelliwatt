import { buildUserUsageDashboardViewModel } from "@/lib/usage/userUsageDashboardViewModel";
import { dailyRowFieldsFromSourceRow } from "@/modules/usageSimulator/dailyRowFieldsFromDisplay";
import { buildDisplayedMonthlyRows } from "@/modules/usageSimulator/monthlyCompareRows";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asDateKey(value: unknown): string | null {
  const text = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

export type OnePathRunReadOnlyView = {
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
};

export function buildOnePathRunReadOnlyView(args: {
  dataset?: Record<string, unknown> | null;
}): OnePathRunReadOnlyView | null {
  const dataset = asRecord(args.dataset);
  if (!dataset) return null;

  const viewModel = buildUserUsageDashboardViewModel({ dataset });
  if (!viewModel) return null;

  const summary = asRecord(dataset.summary);
  const meta = asRecord(dataset.meta);
  const insights = asRecord(dataset.insights);
  const dailyRows = Array.isArray(dataset.daily)
    ? dataset.daily
        .map((row) => {
          const item = asRecord(row);
          const date = asDateKey(item?.date);
          if (!date) return null;
          return dailyRowFieldsFromSourceRow({
            date,
            kwh: item?.kwh,
            source: typeof item?.source === "string" ? item.source : undefined,
            sourceDetail: typeof item?.sourceDetail === "string" ? item.sourceDetail : undefined,
          });
        })
        .filter((row): row is ReturnType<typeof dailyRowFieldsFromSourceRow> => row != null)
    : viewModel.derived.daily;
  const fifteenMinuteAverages = Array.isArray(insights?.fifteenMinuteAverages)
    ? (insights.fifteenMinuteAverages as Array<Record<string, unknown>>)
        .map((row) => ({
          hhmm: String(row.hhmm ?? ""),
          avgKw: Number(row.avgKw ?? 0),
        }))
        .filter((row) => /^\d{2}:\d{2}$/.test(row.hhmm) && Number.isFinite(row.avgKw))
        .sort((left, right) => left.hhmm.localeCompare(right.hhmm))
    : viewModel.derived.fifteenCurve;

  return {
    summary: {
      source: viewModel.coverage.source,
      coverageStart: asDateKey(summary?.start) ?? asDateKey(meta?.coverageStart) ?? viewModel.coverage.start,
      coverageEnd: asDateKey(summary?.end) ?? asDateKey(meta?.coverageEnd) ?? viewModel.coverage.end,
      intervalsCount:
        typeof summary?.intervalsCount === "number" && Number.isFinite(summary.intervalsCount)
          ? (summary.intervalsCount as number)
          : viewModel.coverage.intervalsCount,
      totals: viewModel.derived.totals,
      baseload: viewModel.derived.baseload,
      peakDay: viewModel.derived.peakDay,
      peakHour: viewModel.derived.peakHour,
      weekdayKwh: viewModel.derived.weekdayKwh,
      weekendKwh: viewModel.derived.weekendKwh,
      timeOfDayBuckets: viewModel.derived.timeOfDayBuckets,
    },
    monthlyRows: buildDisplayedMonthlyRows(dataset),
    dailyRows,
    fifteenMinuteAverages,
  };
}
