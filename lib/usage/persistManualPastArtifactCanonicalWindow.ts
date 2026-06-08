import { buildDailyFromIntervals } from "@/modules/onePathSim/usageSimulator/dataset";
import {
  resolveCanonicalUsage365CoverageWindow,
  type CoverageWindow,
} from "@/lib/usage/canonicalMetadataWindow";
import { buildLoadCurveInsightsFromIntervalRows } from "@/lib/usage/fifteenMinuteLoadCurve";

export const MANUAL_CANONICAL_ARTIFACT_WINDOW_VERSION = "manual_canonical_artifact_v1";

const DEFAULT_MANUAL_TIMEZONE = "America/Chicago";

export class UnsupportedManualPastDatasetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedManualPastDatasetError";
  }
}

export type ProjectManualPastDatasetToCanonicalWindowOptions = {
  usageInputMode?: string | null;
  now?: Date;
  timezone?: string | null;
  strict?: boolean;
};

export type ManualPastDatasetDateRemapArgs = {
  dataset: any;
  simulationWindowStart: string;
  simulationWindowEnd: string;
  displayStart: string;
  displayEnd: string;
  timezone?: string | null;
  recomputeLoadCurveInsights?: boolean;
};

export type ManualPastDatasetDateRemapResult = {
  displayStart: string;
  displayEnd: string;
  simulationWindowStart: string;
  simulationWindowEnd: string;
  remappedDayCount: number;
  stitchedTailDayCount: number;
  remappedTotalKwh: number;
  manualDisplayMonthly: Array<{ month: string; kwh: number }>;
  remappedDaily: any[];
  remappedDailyWeather: unknown;
  displayIntervals15: any[];
  remappedSeriesDaily: unknown;
  loadCurveInsights: ReturnType<typeof buildLoadCurveInsightsFromIntervalRows> | null;
};

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

export function buildManualDisplayMonthlyFromIntervals(args: {
  intervals15: Array<{ timestamp?: unknown; consumption_kwh?: unknown; kwh?: unknown }>;
}) {
  const monthTotals = new Map<string, number>();
  for (const row of args.intervals15) {
    const timestamp = String(row?.timestamp ?? "");
    const dateKey = timestamp.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) continue;
    const yearMonth = dateKey.slice(0, 7);
    const kwh = Number(row?.consumption_kwh ?? row?.kwh ?? 0) || 0;
    monthTotals.set(yearMonth, (monthTotals.get(yearMonth) ?? 0) + kwh);
  }

  const latestDateKey = args.intervals15.reduce<string>((latest, row) => {
    const timestamp = String(row?.timestamp ?? "");
    const dateKey = timestamp.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(dateKey) && dateKey > latest ? dateKey : latest;
  }, "");
  const earliestDateKey = args.intervals15.reduce<string>((earliest, row) => {
    const timestamp = String(row?.timestamp ?? "");
    const dateKey = timestamp.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return earliest;
    return !earliest || dateKey < earliest ? dateKey : earliest;
  }, "");
  if (!latestDateKey) return [];

  const displayEndDate = new Date(`${latestDateKey}T00:00:00.000Z`);
  const endYear = displayEndDate.getUTCFullYear();
  const endMonth = displayEndDate.getUTCMonth() + 1;
  const yearMonths = lastNYearMonthsFrom(endYear, endMonth, 12);
  const monthlyTotals = new Map<string, number>();
  for (const yearMonth of yearMonths) {
    monthlyTotals.set(yearMonth, monthTotals.get(yearMonth) ?? 0);
  }
  const leadingYearMonth = earliestDateKey.slice(0, 7);
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

export function buildManualDisplayWindowNote(args: {
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

export function resolveManualPastUsageInputMode(
  dataset: any,
  usageInputMode?: string | null
): "MANUAL_MONTHLY" | "MANUAL_ANNUAL" | null {
  const explicit = String(usageInputMode ?? dataset?.meta?.usageInputMode ?? "").trim().toUpperCase();
  if (explicit === "MANUAL_MONTHLY" || explicit === "MANUAL_ANNUAL") {
    return explicit;
  }
  const lockboxMode = String(dataset?.meta?.lockboxInput?.mode ?? "").trim().toUpperCase();
  if (lockboxMode === "MANUAL_MONTHLY" || lockboxMode === "MANUAL_ANNUAL") {
    return lockboxMode;
  }
  return null;
}

export function isCanonicalManualPastArtifact(dataset: any): boolean {
  return (
    String(dataset?.meta?.manualCanonicalArtifactWindowVersion ?? "").trim() ===
    MANUAL_CANONICAL_ARTIFACT_WINDOW_VERSION
  );
}

export type ManualArtifactCoverageClass = "canonical" | "legacy" | "non_manual";

export function resolveManualArtifactCoverageClass(
  dataset: any,
  usageInputMode?: string | null
): ManualArtifactCoverageClass {
  if (!resolveManualPastUsageInputMode(dataset, usageInputMode ?? null)) {
    return "non_manual";
  }
  return isCanonicalManualPastArtifact(dataset) ? "canonical" : "legacy";
}

/** Keep persisted canonical manual coverage on artifact read; do not re-derive from lockbox/buildInputs. */
export function preserveCanonicalManualPastArtifactCoverageForRead(
  dataset: any
): { startDate: string; endDate: string } | null {
  if (!isCanonicalManualPastArtifact(dataset)) return null;
  const start = asDateKey(dataset?.meta?.coverageStart ?? dataset?.summary?.start);
  const end = asDateKey(dataset?.meta?.coverageEnd ?? dataset?.summary?.end);
  if (!start || !end) return null;
  if (!dataset.summary || typeof dataset.summary !== "object") dataset.summary = {};
  if (!dataset.meta || typeof dataset.meta !== "object") dataset.meta = {};
  dataset.summary.start = start;
  dataset.summary.end = end;
  dataset.summary.latest = `${end}T23:59:59.999Z`;
  dataset.meta.coverageStart = start;
  dataset.meta.coverageEnd = end;
  return { startDate: start, endDate: end };
}

export function resolveManualPastDatasetSimulationWindow(dataset: any): {
  startDate: string;
  endDate: string;
} | null {
  const summaryStart = asDateKey(dataset?.summary?.start);
  const summaryEnd = asDateKey(dataset?.summary?.end);
  if (!summaryStart || !summaryEnd || summaryEnd < summaryStart) return null;
  return { startDate: summaryStart, endDate: summaryEnd };
}

export function resolveManualPastDisplayWindowFromSourceWindow(args: {
  simulationWindowStart: string;
  simulationWindowEnd: string;
  displayWindowEndDate: string;
}): { displayStart: string; displayEnd: string } | null {
  const sourceDateKeys = enumerateDateKeysInclusive(args.simulationWindowStart, args.simulationWindowEnd);
  if (sourceDateKeys.length === 0) return null;
  const displayEnd = asDateKey(args.displayWindowEndDate);
  if (!displayEnd) return null;
  const displayStart = addDays(displayEnd, -(sourceDateKeys.length - 1));
  const targetDateKeys = enumerateDateKeysInclusive(displayStart, displayEnd);
  if (targetDateKeys.length !== sourceDateKeys.length) return null;
  return { displayStart, displayEnd };
}

export function remapManualPastDatasetDatesToDisplayWindow(
  args: ManualPastDatasetDateRemapArgs
): ManualPastDatasetDateRemapResult | null {
  const simulationWindowStart = asDateKey(args.simulationWindowStart);
  const simulationWindowEnd = asDateKey(args.simulationWindowEnd);
  const displayStart = asDateKey(args.displayStart);
  const displayEnd = asDateKey(args.displayEnd);
  if (!simulationWindowStart || !simulationWindowEnd || !displayStart || !displayEnd) return null;

  const sourceDateKeys = enumerateDateKeysInclusive(simulationWindowStart, simulationWindowEnd);
  if (sourceDateKeys.length === 0) return null;
  const targetDateKeys = enumerateDateKeysInclusive(displayStart, displayEnd);
  if (targetDateKeys.length !== sourceDateKeys.length) return null;

  const dateMap = new Map(sourceDateKeys.map((dateKey, index) => [dateKey, targetDateKeys[index]!]));
  const stitchedTailDayCount = sourceDateKeys.reduce((count, sourceDate) => {
    const targetDate = dateMap.get(sourceDate);
    return targetDate != null && targetDate > simulationWindowEnd ? count + 1 : count;
  }, 0);

  const dataset = args.dataset;
  const sourceIntervals15 = Array.isArray(dataset?.series?.intervals15) ? dataset.series.intervals15 : [];
  const remappedIntervals15 = sourceIntervals15.map((row: any) => ({
    ...row,
    timestamp: remapDatePrefix(String(row?.timestamp ?? ""), dateMap),
  }));
  const displayIntervals15 = remappedIntervals15.filter((row: any) => {
    const dateKey = String(row?.timestamp ?? "").slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(dateKey) && dateKey >= displayStart && dateKey <= displayEnd;
  });
  const remappedDailySource =
    Array.isArray(dataset?.daily) && dataset.daily.length > 0
      ? dataset.daily.map((row: any) => {
          const sourceDate = asDateKey(row?.date);
          return {
            ...row,
            date: sourceDate ? dateMap.get(sourceDate) ?? sourceDate : row?.date,
          };
        })
      : buildDailyFromIntervals(displayIntervals15);
  const remappedDaily = remappedDailySource.filter((row: any) => {
    const dateKey = asDateKey(row?.date);
    return dateKey != null && dateKey >= displayStart && dateKey <= displayEnd;
  });
  const remappedSeriesDaily = Array.isArray(dataset?.series?.daily)
    ? dataset.series.daily
        .map((row: any) => ({
          ...row,
          timestamp: remapDatePrefix(String(row?.timestamp ?? ""), dateMap),
        }))
        .filter((row: any) => {
          const dateKey = String(row?.timestamp ?? "").slice(0, 10);
          return /^\d{4}-\d{2}-\d{2}$/.test(dateKey) && dateKey >= displayStart && dateKey <= displayEnd;
        })
    : dataset?.series?.daily;
  const remappedIntervalRows = displayIntervals15.map((row: any) => ({
    timestamp: String(row?.timestamp ?? ""),
    consumption_kwh: Number(row?.consumption_kwh ?? row?.kwh ?? 0) || 0,
  }));
  const manualDisplayMonthly = buildManualDisplayMonthlyFromIntervals({
    intervals15: remappedIntervalRows,
  });
  const remappedTotalKwh = round2(
    remappedIntervalRows.reduce(
      (sum: number, row: { consumption_kwh: number }) => sum + (Number(row.consumption_kwh) || 0),
      0
    )
  );
  const remappedDailyWeather =
    dataset?.dailyWeather && typeof dataset.dailyWeather === "object"
      ? (() => {
          const remappedWeatherEntries: Array<[string, unknown]> = Object.entries(
            dataset.dailyWeather as Record<string, unknown>
          ).map(([dateKey, weather]) => [dateMap.get(dateKey) ?? dateKey, weather]);
          return Object.fromEntries(
            remappedWeatherEntries.filter(([dateKey]) => dateKey >= displayStart && dateKey <= displayEnd)
          );
        })()
      : dataset?.dailyWeather;

  const timezone = String(args.timezone ?? dataset?.meta?.timezone ?? DEFAULT_MANUAL_TIMEZONE).trim() || DEFAULT_MANUAL_TIMEZONE;
  const loadCurveInsights = args.recomputeLoadCurveInsights
    ? buildLoadCurveInsightsFromIntervalRows(displayIntervals15, timezone)
    : null;

  return {
    displayStart,
    displayEnd,
    simulationWindowStart,
    simulationWindowEnd,
    remappedDayCount: sourceDateKeys.length,
    stitchedTailDayCount,
    remappedTotalKwh,
    manualDisplayMonthly,
    remappedDaily,
    remappedDailyWeather,
    displayIntervals15,
    remappedSeriesDaily,
    loadCurveInsights,
  };
}

function resolveExistingManualBillPeriodWindow(dataset: any): Record<string, unknown> | null {
  const existing = dataset?.meta?.manualBillPeriodWindow;
  if (!existing || typeof existing !== "object") return null;
  return existing as Record<string, unknown>;
}

function buildManualBillPeriodWindowDiagnostics(args: {
  dataset: any;
  simulationWindowStart: string;
  simulationWindowEnd: string;
}): Record<string, unknown> {
  const existing = resolveExistingManualBillPeriodWindow(args.dataset);
  const anchorEndDate =
    asDateKey(existing?.anchorEndDate) ??
    asDateKey(args.dataset?.meta?.anchorEndDate) ??
    asDateKey(args.dataset?.meta?.manualAnchorEndDate) ??
    null;
  return {
    ...(existing ?? {}),
    startDate: asDateKey(existing?.startDate) ?? args.simulationWindowStart,
    endDate: asDateKey(existing?.endDate) ?? args.simulationWindowEnd,
    simulationWindowStart: args.simulationWindowStart,
    simulationWindowEnd: args.simulationWindowEnd,
    source: String(existing?.source ?? "bill_period_input"),
    ...(anchorEndDate ? { anchorEndDate } : {}),
  };
}

function buildManualDisplayWindowStitch(args: {
  simulationWindowStart: string;
  simulationWindowEnd: string;
  displayStart: string;
  displayEnd: string;
  remappedDayCount: number;
  stitchedTailDayCount: number;
  existing?: unknown;
}): Record<string, unknown> {
  const stitch = {
    simulationWindowStart: args.simulationWindowStart,
    simulationWindowEnd: args.simulationWindowEnd,
    displayWindowStart: args.displayStart,
    displayWindowEnd: args.displayEnd,
    remappedDayCount: args.remappedDayCount,
    stitchedTailDayCount: args.stitchedTailDayCount,
  };
  if (args.existing && typeof args.existing === "object") {
    return {
      ...(args.existing as Record<string, unknown>),
      ...stitch,
    };
  }
  return stitch;
}

function applyManualPastDatasetDateRemapToDataset(args: {
  dataset: any;
  remap: ManualPastDatasetDateRemapResult;
  metaExtras?: Record<string, unknown>;
  summaryExtras?: Record<string, unknown>;
  includeDisplayNotes?: boolean;
}): any {
  const { dataset, remap } = args;
  const displayNote = buildManualDisplayWindowNote({
    simulationWindowStart: remap.simulationWindowStart,
    simulationWindowEnd: remap.simulationWindowEnd,
    displayWindowStart: remap.displayStart,
    displayWindowEnd: remap.displayEnd,
    stitchedTailDayCount: remap.stitchedTailDayCount,
  });
  const existingInsights =
    dataset?.insights && typeof dataset.insights === "object" ? { ...dataset.insights } : {};
  const insights = {
    ...existingInsights,
    ...(remap.loadCurveInsights
      ? {
          timeOfDayBuckets: remap.loadCurveInsights.timeOfDayBuckets,
          fifteenMinuteAverages: remap.loadCurveInsights.fifteenMinuteAverages,
        }
      : {}),
    stitchedMonth: null,
  };

  return {
    ...dataset,
    summary: {
      ...(dataset?.summary ?? {}),
      start: remap.displayStart,
      end: remap.displayEnd,
      coverageStart: remap.displayStart,
      coverageEnd: remap.displayEnd,
      latest: `${remap.displayEnd}T23:59:59.999Z`,
      totalKwh: remap.remappedTotalKwh,
      ...(args.summaryExtras ?? {}),
    },
    meta: {
      ...(dataset?.meta ?? {}),
      coverageStart: remap.displayStart,
      coverageEnd: remap.displayEnd,
      manualDisplayWindowStitch: buildManualDisplayWindowStitch({
        simulationWindowStart: remap.simulationWindowStart,
        simulationWindowEnd: remap.simulationWindowEnd,
        displayStart: remap.displayStart,
        displayEnd: remap.displayEnd,
        remappedDayCount: remap.remappedDayCount,
        stitchedTailDayCount: remap.stitchedTailDayCount,
        existing: dataset?.meta?.manualDisplayWindowStitch,
      }),
      ...(args.includeDisplayNotes
        ? {
            manualDisplayWindowNote: displayNote,
            weatherNote:
              typeof dataset?.meta?.weatherNote === "string" && String(dataset.meta.weatherNote).trim().length > 0
                ? `${String(dataset.meta.weatherNote).trim()} ${displayNote}`
                : displayNote,
          }
        : {}),
      ...(args.metaExtras ?? {}),
    },
    monthly: remap.manualDisplayMonthly,
    daily: remap.remappedDaily,
    dailyWeather: remap.remappedDailyWeather,
    totals: {
      ...(dataset?.totals ?? {}),
      importKwh: remap.remappedTotalKwh,
      exportKwh: 0,
      netKwh: remap.remappedTotalKwh,
    },
    insights,
    series: {
      ...(dataset?.series ?? {}),
      intervals15: remap.displayIntervals15,
      daily: remap.remappedSeriesDaily,
    },
  };
}

export function projectManualPastDatasetToCanonicalWindow(
  dataset: any,
  options: ProjectManualPastDatasetToCanonicalWindowOptions = {}
): any {
  if (isCanonicalManualPastArtifact(dataset)) {
    return dataset;
  }

  const usageInputMode = resolveManualPastUsageInputMode(dataset, options.usageInputMode);
  if (!usageInputMode) {
    if (options.strict) {
      throw new UnsupportedManualPastDatasetError(
        "projectManualPastDatasetToCanonicalWindow requires MANUAL_MONTHLY or MANUAL_ANNUAL datasets"
      );
    }
    return dataset;
  }

  const simulationWindow = resolveManualPastDatasetSimulationWindow(dataset);
  if (!simulationWindow) {
    if (options.strict) {
      throw new UnsupportedManualPastDatasetError("manual Past dataset is missing a valid summary start/end window");
    }
    return dataset;
  }

  const canonicalCoverage: CoverageWindow = resolveCanonicalUsage365CoverageWindow(options.now);
  const displayWindow = resolveManualPastDisplayWindowFromSourceWindow({
    simulationWindowStart: simulationWindow.startDate,
    simulationWindowEnd: simulationWindow.endDate,
    displayWindowEndDate: canonicalCoverage.endDate,
  });
  if (!displayWindow) {
    if (options.strict) {
      throw new UnsupportedManualPastDatasetError(
        "manual Past dataset could not be aligned to the canonical coverage window"
      );
    }
    return dataset;
  }

  const remap = remapManualPastDatasetDatesToDisplayWindow({
    dataset,
    simulationWindowStart: simulationWindow.startDate,
    simulationWindowEnd: simulationWindow.endDate,
    displayStart: displayWindow.displayStart,
    displayEnd: displayWindow.displayEnd,
    timezone: options.timezone,
    recomputeLoadCurveInsights: true,
  });
  if (!remap) {
    if (options.strict) {
      throw new UnsupportedManualPastDatasetError(
        "manual Past dataset date remap failed for the canonical coverage window"
      );
    }
    return dataset;
  }

  return applyManualPastDatasetDateRemapToDataset({
    dataset,
    remap,
    metaExtras: {
      manualCanonicalArtifactWindowVersion: MANUAL_CANONICAL_ARTIFACT_WINDOW_VERSION,
      manualBillPeriodWindow: buildManualBillPeriodWindowDiagnostics({
        dataset,
        simulationWindowStart: simulationWindow.startDate,
        simulationWindowEnd: simulationWindow.endDate,
      }),
    },
  });
}

export function remapManualPastDatasetForDisplayWindow(args: {
  dataset: any;
  usageInputMode?: string | null;
  displayWindowEndDate?: string | null;
}): any {
  if (isCanonicalManualPastArtifact(args.dataset)) {
    preserveCanonicalManualPastArtifactCoverageForRead(args.dataset);
    return args.dataset;
  }

  const usageInputMode = resolveManualPastUsageInputMode(args.dataset, args.usageInputMode);
  if (!usageInputMode) {
    return args.dataset;
  }

  const simulationWindow = resolveManualPastDatasetSimulationWindow(args.dataset);
  if (!simulationWindow) return args.dataset;

  const displayEnd =
    asDateKey(args.displayWindowEndDate) ?? resolveCanonicalUsage365CoverageWindow().endDate;
  const displayWindow = resolveManualPastDisplayWindowFromSourceWindow({
    simulationWindowStart: simulationWindow.startDate,
    simulationWindowEnd: simulationWindow.endDate,
    displayWindowEndDate: displayEnd,
  });
  if (!displayWindow) return args.dataset;

  const remap = remapManualPastDatasetDatesToDisplayWindow({
    dataset: args.dataset,
    simulationWindowStart: simulationWindow.startDate,
    simulationWindowEnd: simulationWindow.endDate,
    displayStart: displayWindow.displayStart,
    displayEnd: displayWindow.displayEnd,
    recomputeLoadCurveInsights: false,
  });
  if (!remap) return args.dataset;

  return applyManualPastDatasetDateRemapToDataset({
    dataset: args.dataset,
    remap,
    includeDisplayNotes: true,
    metaExtras: {
      legacyManualDisplayRemapApplied: true,
    },
  });
}

export function resolveManualDisplayDatasetForRead(args: {
  dataset: any;
  usageInputMode?: string | null;
  displayWindowEndDate?: string | null;
}): any {
  return remapManualPastDatasetForDisplayWindow(args);
}
