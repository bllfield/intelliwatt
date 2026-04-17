import { buildUserUsageDashboardViewModel } from "@/lib/usage/userUsageDashboardViewModel";
import { dailyRowFieldsFromSourceRow } from "@/modules/usageSimulator/dailyRowFieldsFromDisplay";
import type { ValidationCompareProjectionSidecar } from "@/modules/usageSimulator/compareProjection";
import type { WeatherSensitivityScore } from "@/modules/weatherSensitivity/shared";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asDateKey(value: unknown): string | null {
  const text = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

export type OnePathPastScenarioVariable = {
  kind: string;
  effectiveMonth?: string;
  payloadJson?: Record<string, unknown>;
};

export type OnePathRunReadOnlyView = {
  summary: {
    source: string | null;
    coverageStart: string | null;
    coverageEnd: string | null;
    intervalsCount: number | null;
    weatherBasisLabel: string | null;
    sourceOfDaySimulationCore: string | null;
    hasSimulatedFill: boolean;
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
  pastVariables: OnePathPastScenarioVariable[];
  compare: {
    rows: ValidationCompareProjectionSidecar["rows"];
    metrics: Record<string, unknown> | null;
    selectedValidationRows: Array<Record<string, unknown>>;
  };
};

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function asCompareRows(value: unknown): ValidationCompareProjectionSidecar["rows"] {
  return asArray<Record<string, unknown>>(value)
    .map((row) => {
      const localDate = String(row.localDate ?? row.date ?? "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) return null;
      const dayType = row.dayType === "weekend" ? "weekend" : "weekday";
      const actualDayKwh = Number(row.actualDayKwh ?? row.actualKwh);
      const simulatedDayKwh = Number(row.simulatedDayKwh ?? row.simKwh);
      const errorKwh = Number(row.errorKwh ?? row.error);
      const percentErrorRaw = row.percentError ?? row.percentErrorPct;
      const percentError =
        percentErrorRaw == null || !Number.isFinite(Number(percentErrorRaw)) ? null : Number(percentErrorRaw);
      const weather = asRecord(row.weather);
      return {
        localDate,
        dayType,
        actualDayKwh: Number.isFinite(actualDayKwh) ? actualDayKwh : 0,
        simulatedDayKwh: Number.isFinite(simulatedDayKwh) ? simulatedDayKwh : 0,
        errorKwh: Number.isFinite(errorKwh) ? errorKwh : 0,
        percentError,
        weather:
          weather && Object.keys(weather).length
            ? {
                tAvgF: Number.isFinite(Number(weather.tAvgF)) ? Number(weather.tAvgF) : null,
                tMinF: Number.isFinite(Number(weather.tMinF)) ? Number(weather.tMinF) : null,
                tMaxF: Number.isFinite(Number(weather.tMaxF)) ? Number(weather.tMaxF) : null,
                hdd65: Number.isFinite(Number(weather.hdd65)) ? Number(weather.hdd65) : null,
                cdd65: Number.isFinite(Number(weather.cdd65)) ? Number(weather.cdd65) : null,
                source: typeof weather.source === "string" ? weather.source : null,
                weatherMissing: weather.weatherMissing === true,
              }
            : undefined,
      };
    })
    .filter((row): row is ValidationCompareProjectionSidecar["rows"][number] => row != null);
}

export function buildOnePathRunReadOnlyView(args: {
  dataset?: Record<string, unknown> | null;
  engineInput?: Record<string, unknown> | null;
  readModel?: Record<string, unknown> | null;
}): OnePathRunReadOnlyView | null {
  const dataset = asRecord(args.dataset);
  if (!dataset) return null;

  const meta = asRecord(dataset.meta);
  const engineInput = asRecord(args.engineInput);
  const readModel = asRecord(args.readModel) ?? {};
  const weatherScore = (meta?.weatherSensitivityScore as WeatherSensitivityScore | null | undefined) ?? null;
  const viewModel = buildUserUsageDashboardViewModel({
    dataset,
    weatherSensitivityScore: weatherScore,
  });
  if (!viewModel) return null;

  const pastVariables = Array.isArray(engineInput?.travelRanges)
    ? engineInput.travelRanges
        .map((value) => asRecord(value))
        .filter((value): value is Record<string, unknown> => value != null)
        .map((range) => ({
          kind: "TRAVEL_RANGE",
          payloadJson: {
            startDate: String(range.startDate ?? "").slice(0, 10),
            endDate: String(range.endDate ?? "").slice(0, 10),
          },
        }))
        .filter((value) => value.payloadJson.startDate && value.payloadJson.endDate)
    : [];
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
  const compareProjection = asRecord(readModel.compareProjection) ?? {};
  const tuningSummary = asRecord(readModel.tuningSummary) ?? {};
  const compareRowsPrimary = asCompareRows(compareProjection.rows);
  const selectedValidationRows = asArray<Record<string, unknown>>(tuningSummary.selectedValidationRows);
  const compareRows = compareRowsPrimary.length ? compareRowsPrimary : asCompareRows(selectedValidationRows);
  const compareMetrics =
    compareProjection.metrics && typeof compareProjection.metrics === "object"
      ? (compareProjection.metrics as Record<string, unknown>)
      : tuningSummary.validationMetricsSummary && typeof tuningSummary.validationMetricsSummary === "object"
        ? (tuningSummary.validationMetricsSummary as Record<string, unknown>)
        : null;

  return {
    summary: {
      source: viewModel.coverage.source,
      coverageStart: viewModel.coverage.start,
      coverageEnd: viewModel.coverage.end,
      intervalsCount: viewModel.coverage.intervalsCount,
      weatherBasisLabel: viewModel.coverage.weatherBasisLabel,
      sourceOfDaySimulationCore: viewModel.coverage.sourceOfDaySimulationCore,
      hasSimulatedFill: viewModel.coverage.hasSimulatedFill,
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
    dailyRows,
    dailyWeather: (viewModel.derived.dailyWeather as OnePathRunReadOnlyView["dailyWeather"]) ?? null,
    fifteenMinuteAverages: viewModel.derived.fifteenCurve,
    stitchedMonth: viewModel.derived.stitchedMonth,
    weatherScore,
    pastVariables,
    compare: {
      rows: compareRows,
      metrics: compareMetrics,
      selectedValidationRows,
    },
  };
}
