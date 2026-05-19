import { dateKeyInTimezone } from "@/lib/admin/gapfillLab";
import { buildUserUsageDashboardViewModel } from "@/lib/usage/userUsageDashboardViewModel";
import { dailyRowFieldsFromSourceRow } from "@/modules/usageSimulator/dailyRowFieldsFromDisplay";
import type { ValidationCompareProjectionSidecar } from "@/modules/usageSimulator/compareProjection";
import type { WeatherSensitivityScore } from "@/modules/weatherSensitivity/shared";
import { redistributeGreenButtonGridZeroSamples } from "@/modules/onePathSim/greenButtonIntervalCorrections";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asDateKey(value: unknown): string | null {
  const text = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function hhmmInTimezone(timestamp: string, timezone: string): string | null {
  try {
    const ts = new Date(timestamp);
    if (!Number.isFinite(ts.getTime())) return null;
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      hourCycle: "h23",
    });
    const parts = formatter.formatToParts(ts);
    const hour = parts.find((part) => part.type === "hour")?.value ?? "";
    const minute = parts.find((part) => part.type === "minute")?.value ?? "";
    const hhmm = `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
    return /^\d{2}:\d{2}$/.test(hhmm) ? hhmm : null;
  } catch {
    return null;
  }
}

function hhmmFromUtcGridTimestamp(timestamp: string): string | null {
  const ts = new Date(timestamp);
  if (!Number.isFinite(ts.getTime())) return null;
  const hhmm = `${String(ts.getUTCHours()).padStart(2, "0")}:${String(ts.getUTCMinutes()).padStart(2, "0")}`;
  return /^\d{2}:\d{2}$/.test(hhmm) ? hhmm : null;
}

function dateKeyFromUtcGridTimestamp(timestamp: string): string | null {
  const ts = new Date(timestamp);
  if (!Number.isFinite(ts.getTime())) return null;
  return ts.toISOString().slice(0, 10);
}

function resolveIntervalTimestampMode(meta: Record<string, unknown> | null): "timezone" | "utcDayGrid" {
  if (meta?.greenButtonIntervalTimestampMode === "utcDayGrid") return "utcDayGrid";
  if (
    meta?.greenButtonSourceDateByTargetDate &&
    typeof meta.greenButtonSourceDateByTargetDate === "object" &&
    !Array.isArray(meta.greenButtonSourceDateByTargetDate) &&
    (meta.actualSource === "GREEN_BUTTON" || typeof meta.greenButtonCoverageIntervalCount === "number")
  ) {
    return "utcDayGrid";
  }
  return "timezone";
}

function asStitchedMonthRecord(
  value: unknown
):
  | {
      mode: "PRIOR_YEAR_TAIL";
      yearMonth: string;
      haveDaysThrough: number;
      missingDaysFrom: number;
      missingDaysTo: number;
      borrowedFromYearMonth: string;
      completenessRule: string;
    }
  | null {
  const item = asRecord(value);
  const yearMonth = String(item?.yearMonth ?? "").slice(0, 7);
  const borrowedFromYearMonth = String(item?.borrowedFromYearMonth ?? "").slice(0, 7);
  const haveDaysThrough = Number(item?.haveDaysThrough);
  const missingDaysFrom = Number(item?.missingDaysFrom);
  const missingDaysTo = Number(item?.missingDaysTo);
  if (
    item?.mode !== "PRIOR_YEAR_TAIL" ||
    !/^\d{4}-\d{2}$/.test(yearMonth) ||
    !/^\d{4}-\d{2}$/.test(borrowedFromYearMonth) ||
    !Number.isFinite(haveDaysThrough) ||
    !Number.isFinite(missingDaysFrom) ||
    !Number.isFinite(missingDaysTo)
  ) {
    return null;
  }
  return {
    mode: "PRIOR_YEAR_TAIL",
    yearMonth,
    haveDaysThrough,
    missingDaysFrom,
    missingDaysTo,
    borrowedFromYearMonth,
    completenessRule: String(item?.completenessRule ?? ""),
  };
}

function buildFifteenMinuteAveragesFromIntervals15(
  value: unknown,
  timezone: string,
  timestampMode: "timezone" | "utcDayGrid" = "timezone",
  options?: { redistributeZeroKwhSamples?: boolean }
): Array<{ hhmm: string; avgKw: number }> {
  const buckets = new Map<string, { sumKw: number; count: number }>();
  const rows = asArray<Record<string, unknown>>(value)
    .map((row) => {
      const timestamp = String(row.timestamp ?? "");
      const kwh = Number(row.kwh ?? row.consumption_kwh);
      return timestamp && Number.isFinite(kwh) ? { timestamp, kwh } : null;
    })
    .filter((row): row is { timestamp: string; kwh: number } => row != null);
  const rowsForAverage =
    options?.redistributeZeroKwhSamples && timestampMode === "utcDayGrid"
      ? redistributeGreenButtonGridZeroSamples(rows).intervals
      : rows;

  for (const row of rowsForAverage) {
    const timestamp = row.timestamp;
    const hhmm =
      timestampMode === "utcDayGrid" ? hhmmFromUtcGridTimestamp(timestamp) : hhmmInTimezone(timestamp, timezone);
    if (!hhmm) continue;
    const kwh = row.kwh;
    const current = buckets.get(hhmm) ?? { sumKw: 0, count: 0 };
    current.sumKw += kwh * 4;
    current.count += 1;
    buckets.set(hhmm, current);
  }
  return Array.from(buckets.entries())
    .map(([hhmm, bucket]) => ({
      hhmm,
      avgKw: bucket.count > 0 ? round2(bucket.sumKw / bucket.count) : 0,
    }))
    .sort((left, right) => (left.hhmm < right.hhmm ? -1 : left.hhmm > right.hhmm ? 1 : 0));
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
    displayWindowNote: string | null;
    intervalsCount: number | null;
    weatherBasisLabel: string | null;
    dailyUsageDisclosureNote: string | null;
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
  dailyRows: Array<ReturnType<typeof dailyRowFieldsFromSourceRow>>;
  dailyWeather: Record<string, { tAvgF: number; tMinF: number; tMaxF: number; hdd65: number; cdd65: number; source?: string }> | null;
  fifteenMinuteAverages: Array<{ hhmm: string; avgKw: number }>;
  fifteenMinuteCurveSourceOwner: string;
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

function buildDisplayDailyRows(value: unknown): Array<ReturnType<typeof dailyRowFieldsFromSourceRow>> {
  return asArray<Record<string, unknown>>(value)
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
    .filter((row): row is ReturnType<typeof dailyRowFieldsFromSourceRow> => row != null);
}

function buildLocalDailyRowsFromIntervals15(args: {
  intervals15: unknown;
  timezone: string;
  timestampMode?: "timezone" | "utcDayGrid";
  coverageStart: string | null;
  coverageEnd: string | null;
  existingRows: Array<ReturnType<typeof dailyRowFieldsFromSourceRow>>;
  simulatedSourceDetailByDate?: Record<string, string> | null;
}): Array<ReturnType<typeof dailyRowFieldsFromSourceRow>> {
  const coverageStart = asDateKey(args.coverageStart);
  const coverageEnd = asDateKey(args.coverageEnd);
  if (!args.timezone.trim()) return [];
  const sumsByDate = new Map<string, number>();
  for (const row of asArray<Record<string, unknown>>(args.intervals15)) {
    const timestamp = String(row?.timestamp ?? "");
    if (!timestamp) continue;
    const date = asDateKey(
      args.timestampMode === "utcDayGrid" ? dateKeyFromUtcGridTimestamp(timestamp) : dateKeyInTimezone(timestamp, args.timezone)
    );
    if (!date) continue;
    if (coverageStart && date < coverageStart) continue;
    if (coverageEnd && date > coverageEnd) continue;
    sumsByDate.set(date, (sumsByDate.get(date) ?? 0) + (Number(row?.kwh ?? row?.consumption_kwh) || 0));
  }
  if (sumsByDate.size === 0) return [];
  const existingByDate = new Map(args.existingRows.map((row) => [row.date, row] as const));
  return Array.from(sumsByDate.entries())
    .sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))
    .map(([date, kwh]) => {
      const existing = existingByDate.get(date);
      const simulatedSourceDetail = args.simulatedSourceDetailByDate?.[date];
      return dailyRowFieldsFromSourceRow({
        date,
        kwh: round2(kwh),
        source: existing?.source ?? (simulatedSourceDetail ? "SIMULATED" : "ACTUAL"),
        sourceDetail: existing?.sourceDetail ?? simulatedSourceDetail ?? "ACTUAL",
      });
    });
}

function asCompareRows(value: unknown): ValidationCompareProjectionSidecar["rows"] {
  const rows = asArray<Record<string, unknown>>(value)
    .map((row): ValidationCompareProjectionSidecar["rows"][number] | null => {
      const localDate = String(row.localDate ?? row.date ?? "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) return null;
      const dayType: "weekday" | "weekend" = row.dayType === "weekend" ? "weekend" : "weekday";
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
  return rows;
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
  const sharedDiagnostics = asRecord(readModel.sharedDiagnostics) ?? {};
  const datasetInsights = asRecord(dataset.insights) ?? {};
  const manualDisplayWindowStitch =
    meta?.manualDisplayWindowStitch &&
    typeof meta.manualDisplayWindowStitch === "object" &&
    !Array.isArray(meta.manualDisplayWindowStitch)
      ? (meta.manualDisplayWindowStitch as Record<string, unknown>)
      : null;
  const hasManualDisplayWindowStitch =
    manualDisplayWindowStitch != null && Object.keys(manualDisplayWindowStitch).length > 0;
  const stitchedMonth =
    asStitchedMonthRecord(datasetInsights.stitchedMonth) ??
    (hasManualDisplayWindowStitch ? null : asStitchedMonthRecord(sharedDiagnostics.simulatedChartStitchedMonth));
  const datasetForDisplay =
    stitchedMonth && !asStitchedMonthRecord(datasetInsights.stitchedMonth)
      ? {
          ...dataset,
          insights: {
            ...datasetInsights,
            stitchedMonth,
          },
        }
      : dataset;
  const weatherScore = (meta?.weatherSensitivityScore as WeatherSensitivityScore | null | undefined) ?? null;
  const viewModel = buildUserUsageDashboardViewModel({
    dataset: datasetForDisplay,
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
  const datasetDailyRows = buildDisplayDailyRows(dataset.daily);
  const timezone = typeof meta?.timezone === "string" && meta.timezone.trim() ? meta.timezone : "America/Chicago";
  const intervalTimestampMode = resolveIntervalTimestampMode(meta);
  const intervalBackedLocalDailyRows = buildLocalDailyRowsFromIntervals15({
    intervals15: asRecord(dataset.series)?.intervals15,
    timezone,
    timestampMode: intervalTimestampMode,
    coverageStart: viewModel.coverage.start,
    coverageEnd: viewModel.coverage.end,
    existingRows: datasetDailyRows,
    simulatedSourceDetailByDate:
      meta?.simulatedSourceDetailByDate &&
      typeof meta.simulatedSourceDetailByDate === "object" &&
      !Array.isArray(meta.simulatedSourceDetailByDate)
        ? (meta.simulatedSourceDetailByDate as Record<string, string>)
        : null,
  });
  const datasetDailyEnd = datasetDailyRows.length > 0 ? datasetDailyRows[datasetDailyRows.length - 1]?.date ?? null : null;
  const localDailyEnd =
    intervalBackedLocalDailyRows.length > 0
      ? intervalBackedLocalDailyRows[intervalBackedLocalDailyRows.length - 1]?.date ?? null
      : null;
  const shouldPreferIntervalBackedLocalDailyRows =
    intervalBackedLocalDailyRows.length > 0 &&
    (datasetDailyRows.length === 0 ||
      intervalBackedLocalDailyRows.length > datasetDailyRows.length ||
      (viewModel.coverage.end != null && localDailyEnd === viewModel.coverage.end && datasetDailyEnd !== viewModel.coverage.end));
  const dailyRows = shouldPreferIntervalBackedLocalDailyRows
    ? intervalBackedLocalDailyRows
    : datasetDailyRows.length > 0
      ? datasetDailyRows
      : viewModel.derived.daily;
  const compareProjection = asRecord(readModel.compareProjection) ?? {};
  const tuningSummary = asRecord(readModel.tuningSummary) ?? {};
  const compareRowsPrimary = asCompareRows(compareProjection.rows);
  const selectedValidationRows = asArray<Record<string, unknown>>(tuningSummary.selectedValidationRows);
  const compareRows = compareRowsPrimary.length ? compareRowsPrimary : asCompareRows(selectedValidationRows);
  const shouldIgnoreGreenButtonGridZeroSamples =
    intervalTimestampMode === "utcDayGrid" &&
    Number(meta?.greenButtonPaddedIntervalCount ?? 0) > 0 &&
    Number(meta?.greenButtonZeroRedistributedIntervalCount ?? 0) <= 0;
  const rebuiltFifteenMinuteAverages = buildFifteenMinuteAveragesFromIntervals15(
    asRecord(dataset.series)?.intervals15,
    timezone,
    intervalTimestampMode,
    { redistributeZeroKwhSamples: shouldIgnoreGreenButtonGridZeroSamples }
  );
  const fifteenMinuteAverages = rebuiltFifteenMinuteAverages.length
    ? rebuiltFifteenMinuteAverages
    : viewModel.derived.fifteenCurve;
  const fifteenMinuteCurveSourceOwner = rebuiltFifteenMinuteAverages.length
      ? "buildOnePathRunReadOnlyView(...).dataset.series.intervals15"
      : "buildUserUsageDashboardViewModel(...).derived.fifteenCurve";
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
      displayWindowNote:
        typeof meta?.manualDisplayWindowNote === "string" && meta.manualDisplayWindowNote.trim().length > 0
          ? meta.manualDisplayWindowNote
          : typeof meta?.displayWindowNote === "string" && meta.displayWindowNote.trim().length > 0
            ? meta.displayWindowNote
          : null,
      intervalsCount: viewModel.coverage.intervalsCount,
      weatherBasisLabel: viewModel.coverage.weatherBasisLabel,
      dailyUsageDisclosureNote: viewModel.coverage.dailyUsageDisclosureNote,
      sourceOfDaySimulationCore: viewModel.coverage.sourceOfDaySimulationCore,
      hasSimulatedFill: Boolean(viewModel.coverage.hasSimulatedFill),
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
    fifteenMinuteAverages,
    fifteenMinuteCurveSourceOwner,
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
