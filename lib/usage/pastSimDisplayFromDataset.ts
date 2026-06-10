/**
 * Single entry for Past / simulated-fill 15-minute load curves on every surface.
 * User Usage, One Path read-only, and any future reader must call
 * `resolvePastSimFifteenMinuteCurveFromDataset` — not rebuild curves locally.
 */

import { fillCanonicalDailyTotals, resolveCanonicalUsage365CoverageWindow } from "@/lib/usage/canonicalMetadataWindow";
import {
  isManualPastSimDisplayDataset,
  labelManualPastZeroFillDailyRow,
} from "@/lib/usage/manualPastDisplayPolicy";
import {
  resolvePastSimDisplayFifteenMinuteCurve,
  type PastSimDisplayFifteenMinuteCurveResult,
} from "@/lib/usage/pastSimDisplayFifteenMinuteCurve";
import { dailyRowFieldsFromSourceRow } from "@/modules/usageSimulator/dailyRowFieldsFromDisplay";

export type PastSimDisplayDatasetLike = {
  meta?: Record<string, unknown> | null;
  summary?: { start?: unknown; end?: unknown; source?: unknown } | null;
  daily?: Array<{ date?: unknown; kwh?: unknown; source?: unknown; sourceDetail?: unknown }> | null;
  series?: {
    intervals15?: Array<{ timestamp?: string; kwh?: number; consumption_kwh?: number }> | null;
    daily?: Array<{ timestamp?: string; kwh?: number; source?: string; sourceDetail?: string }> | null;
  } | null;
  insights?: { fifteenMinuteAverages?: Array<{ hhmm?: string; avgKw?: number }> } | null;
};

export type PastSimDisplayDailyRow = ReturnType<typeof dailyRowFieldsFromSourceRow>;

export type PastSimDisplayFifteenMinuteFromDatasetResult = PastSimDisplayFifteenMinuteCurveResult & {
  hasSimulatedFill: boolean;
  coverageStart: string | null;
  coverageEnd: string | null;
  timezone: string;
  displayDaily: PastSimDisplayDailyRow[];
};

function asDateKey(value: unknown): string | null {
  const text = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function toDateKeyFromTimestamp(timestamp: string): string {
  return timestamp.slice(0, 10);
}

function isGreenButtonActualDataset(
  datasetKind: unknown,
  summarySource: unknown,
  meta: Record<string, unknown>
): boolean {
  if (datasetKind !== "ACTUAL") return false;
  const source = String(summarySource ?? meta.actualSource ?? "")
    .trim()
    .toUpperCase();
  return source === "GREEN_BUTTON";
}

function resolveDashboardCoverageWindow(args: {
  datasetKind: unknown;
  meta: Record<string, unknown>;
  summary: { start?: unknown; end?: unknown; source?: unknown };
  canonicalWindow: { startDate: string; endDate: string };
}): { startDate: string; endDate: string } {
  const summaryStart = asDateKey(args.summary?.start);
  const summaryEnd = asDateKey(args.summary?.end);
  const metaStart = asDateKey(args.meta.coverageStart);
  const metaEnd = asDateKey(args.meta.coverageEnd);
  if (isGreenButtonActualDataset(args.datasetKind, args.summary?.source, args.meta)) {
    return {
      startDate: metaStart ?? summaryStart ?? args.canonicalWindow.startDate,
      endDate: metaEnd ?? summaryEnd ?? args.canonicalWindow.endDate,
    };
  }
  if (args.datasetKind === "ACTUAL") {
    return args.canonicalWindow;
  }
  return {
    startDate: metaStart ?? args.canonicalWindow.startDate,
    endDate: metaEnd ?? args.canonicalWindow.endDate,
  };
}

function buildDisplayDailyForPastSimFifteenMinuteCurve(args: {
  dataset: PastSimDisplayDatasetLike;
  coverageStart: string | null;
  coverageEnd: string | null;
  greenButtonActual: boolean;
  manualPastDisplay: boolean;
}): PastSimDisplayDailyRow[] {
  const daily = args.dataset.daily ?? [];
  const fallbackDailyRaw = (daily.length ? daily : (args.dataset.series?.daily ?? [])).map((row) => {
    const date =
      daily.length > 0
        ? String((row as { date?: unknown }).date ?? "").slice(0, 10)
        : toDateKeyFromTimestamp(String((row as { timestamp?: string }).timestamp ?? ""));
    return dailyRowFieldsFromSourceRow({
      date,
      kwh: (row as { kwh?: unknown }).kwh,
      source: typeof (row as { source?: unknown }).source === "string" ? (row as { source: string }).source : undefined,
      sourceDetail:
        typeof (row as { sourceDetail?: unknown }).sourceDetail === "string"
          ? (row as { sourceDetail: string }).sourceDetail
          : undefined,
    });
  });
  const dateInRange = (date: string) =>
    (!args.coverageStart || date >= args.coverageStart) && (!args.coverageEnd || date <= args.coverageEnd);
  const seen = new Set<string>();
  const fallbackDaily = fallbackDailyRaw
    .filter((row) => {
      const date = String(row.date).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
      if (seen.has(date)) return false;
      seen.add(date);
      return dateInRange(date);
    })
    .sort((left, right) => (left.date < right.date ? -1 : 1));

  if (args.greenButtonActual && args.coverageStart && args.coverageEnd) {
    const dailyByDate = new Map(fallbackDaily.map((row) => [row.date, row] as const));
    return fillCanonicalDailyTotals(
      fallbackDaily.map((row) => ({ date: row.date, kwh: row.kwh })),
      { startDate: args.coverageStart, endDate: args.coverageEnd }
    ).map((row) => {
      const existing = dailyByDate.get(row.date);
      if (args.manualPastDisplay) {
        return dailyRowFieldsFromSourceRow(
          labelManualPastZeroFillDailyRow(row, existing ?? null)
        );
      }
      return dailyRowFieldsFromSourceRow({
        date: row.date,
        kwh: row.kwh,
        source: existing?.source ?? "ACTUAL",
        sourceDetail: existing?.sourceDetail,
      });
    });
  }
  if (args.manualPastDisplay && args.coverageStart && args.coverageEnd) {
    const dailyByDate = new Map(fallbackDaily.map((row) => [row.date, row] as const));
    return fillCanonicalDailyTotals(
      fallbackDaily.map((row) => ({ date: row.date, kwh: row.kwh })),
      { startDate: args.coverageStart, endDate: args.coverageEnd }
    ).map((row) => {
      const existing = dailyByDate.get(row.date);
      return dailyRowFieldsFromSourceRow(
        labelManualPastZeroFillDailyRow(row, existing ?? null)
      );
    });
  }
  return fallbackDaily;
}

/** Shared Past-sim fill detection (Usage dashboard + One Path). */
export function readPastSimHasSimulatedFillFromDataset(dataset: PastSimDisplayDatasetLike): boolean {
  const meta = (dataset.meta ?? {}) as Record<string, unknown>;
  const datasetKind = meta.datasetKind ?? null;
  const provenance = meta.monthProvenanceByMonth as Record<string, string> | undefined;
  const actualSource = meta.actualSource as string | undefined;
  return Boolean(
    datasetKind === "SIMULATED" &&
      actualSource &&
      provenance &&
      Object.values(provenance).some((value) => value === "SIMULATED")
  );
}

/**
 * Authoritative 15-minute load curve for a Past / simulated-fill dataset artifact.
 * Does not accept sage upstream intervals — artifact `series.intervals15` only.
 */
export function resolvePastSimFifteenMinuteCurveFromDataset(
  dataset: PastSimDisplayDatasetLike
): PastSimDisplayFifteenMinuteFromDatasetResult {
  const meta = (dataset.meta ?? {}) as Record<string, unknown>;
  const datasetKind = meta.datasetKind ?? null;
  const canonicalWindow = resolveCanonicalUsage365CoverageWindow();
  const { startDate: coverageStart, endDate: coverageEnd } = resolveDashboardCoverageWindow({
    datasetKind,
    meta,
    summary: {
      start: dataset.summary?.start,
      end: dataset.summary?.end,
      source: dataset.summary?.source,
    },
    canonicalWindow,
  });
  const greenButtonActual = isGreenButtonActualDataset(datasetKind, dataset.summary?.source, meta);
  const manualPastDisplay = isManualPastSimDisplayDataset(meta);
  const timezone = typeof meta.timezone === "string" ? meta.timezone : "America/Chicago";
  const hasSimulatedFill = readPastSimHasSimulatedFillFromDataset(dataset);
  const displayDaily = buildDisplayDailyForPastSimFifteenMinuteCurve({
    dataset,
    coverageStart,
    coverageEnd,
    greenButtonActual,
    manualPastDisplay,
  });
  const curve = resolvePastSimDisplayFifteenMinuteCurve({
    insightsFifteenMinuteAverages: dataset.insights?.fifteenMinuteAverages,
    intervals15: dataset.series?.intervals15,
    hasSimulatedFill,
    displayDaily,
    timezone,
    coverageStart,
    coverageEnd,
    meta,
  });
  return {
    ...curve,
    hasSimulatedFill,
    coverageStart,
    coverageEnd,
    timezone,
    displayDaily,
  };
}

/** Shared display daily rows (same owner as the 15-minute curve). */
export function buildPastSimDisplayDailyRowsFromDataset(
  dataset: PastSimDisplayDatasetLike
): { displayDaily: PastSimDisplayDailyRow[]; coverageStart: string | null; coverageEnd: string | null } {
  const meta = (dataset.meta ?? {}) as Record<string, unknown>;
  const datasetKind = meta.datasetKind ?? null;
  const canonicalWindow = resolveCanonicalUsage365CoverageWindow();
  const { startDate: coverageStart, endDate: coverageEnd } = resolveDashboardCoverageWindow({
    datasetKind,
    meta,
    summary: {
      start: dataset.summary?.start,
      end: dataset.summary?.end,
      source: dataset.summary?.source,
    },
    canonicalWindow,
  });
  const greenButtonActual = isGreenButtonActualDataset(datasetKind, dataset.summary?.source, meta);
  const manualPastDisplay = isManualPastSimDisplayDataset(meta);
  const displayDaily = buildDisplayDailyForPastSimFifteenMinuteCurve({
    dataset,
    coverageStart,
    coverageEnd,
    greenButtonActual,
    manualPastDisplay,
  });
  return { displayDaily, coverageStart, coverageEnd };
}
