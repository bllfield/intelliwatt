import { extractValidationDayKeysFromCompareProjection } from "@/lib/admin/aiTuningBundleHelpers";
import { smtCoverageDateKey } from "@/lib/time/chicago";
import {
  getActualIntervalsForRange,
  type ActualIntervalPoint,
} from "@/lib/usage/actualDatasetForHouse";
import type { ActualUsageSource } from "@/modules/realUsageAdapter/actual";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizeChicagoDateKeys(dateKeys: Iterable<unknown>): string[] {
  return Array.from(
    new Set(
      Array.from(dateKeys)
        .map((date) => String(date).slice(0, 10))
        .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
    )
  ).sort();
}

function readValidationDateKeysFromArtifactMeta(meta: Record<string, unknown> | null | undefined): string[] {
  if (!meta) return [];
  return normalizeChicagoDateKeys([
    ...asArray(meta.selectedValidationDateKeys),
    ...asArray(meta.validationOnlyDateKeysLocal),
    ...asArray(asRecord(meta.validationSelectionDiagnostics).selectedValidationDateKeys),
  ]);
}

function resolvePosthocTopMissDayKeysFromCompareProjection(
  compareProjection: unknown,
  posthocTopMissDayCount: number
): string[] {
  const rows = asArray(asRecord(compareProjection).rows);
  return rows
    .map((row) => {
      const record = asRecord(row);
      const date = String(record.localDate ?? record.date ?? "").slice(0, 10);
      const delta = Number(record.errorKwh ?? record.deltaKwh ?? record.dailyDeltaKwh ?? Number.NaN);
      return { date, absDelta: Math.abs(delta) };
    })
    .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date) && Number.isFinite(row.absDelta))
    .sort((a, b) => b.absDelta - a.absDelta)
    .slice(0, posthocTopMissDayCount)
    .map((row) => row.date);
}

/** Compare/export only: validation (+ optional posthoc) local date keys for compact actual interval loads. */
export function resolveCompareDiagnosticsDateKeys(args: {
  compareProjection?: unknown;
  includePosthocTopMissIntervalCurves?: boolean;
  posthocTopMissDayCount?: number;
  artifactMeta?: Record<string, unknown> | null;
}): string[] {
  const fromMeta = readValidationDateKeysFromArtifactMeta(args.artifactMeta);
  const validationKeys =
    fromMeta.length > 0 ? fromMeta : extractValidationDayKeysFromCompareProjection(args.compareProjection);
  const posthocKeys =
    args.includePosthocTopMissIntervalCurves === true
      ? resolvePosthocTopMissDayKeysFromCompareProjection(
          args.compareProjection,
          args.posthocTopMissDayCount ?? 5
        )
      : [];
  return normalizeChicagoDateKeys([...validationKeys, ...posthocKeys]);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function asChicagoDateKey(value: unknown): string | null {
  const text = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function filterIntervalRowsToChicagoDateKeys(
  rows: unknown[],
  dateKeySet: Set<string>,
  timezone: string
): Array<{ timestamp: string; kwh: number }> {
  const out: Array<{ timestamp: string; kwh: number }> = [];
  for (const row of rows) {
    const record = asRecord(row);
    const timestamp = String(record.timestamp ?? "").trim();
    const kwh = Number(record.kwh ?? Number.NaN);
    if (!timestamp || !Number.isFinite(kwh)) continue;

    const homeDateKey = asChicagoDateKey(record.homeDateKey);
    if (homeDateKey && dateKeySet.has(homeDateKey)) {
      out.push({ timestamp, kwh });
      continue;
    }

    const ts = new Date(timestamp);
    if (!Number.isFinite(ts.getTime())) continue;
    const localDate =
      timezone === "America/Chicago" ? smtCoverageDateKey(ts) : asChicagoDateKey(timestamp);
    if (localDate && dateKeySet.has(localDate)) {
      out.push({ timestamp, kwh });
    }
  }
  return out;
}

/**
 * Compare/export only: keep full simulated daily/meta rows but slice interval series to
 * validation/posthoc days so admin readback does not scan a full-year interval payload.
 */
export function sliceSimulatedDatasetIntervalsForCompareDiagnostics(args: {
  simulatedDataset?: Record<string, unknown> | null;
  compareProjection?: unknown;
  includePosthocTopMissIntervalCurves?: boolean;
  posthocTopMissDayCount?: number;
  artifactMeta?: Record<string, unknown> | null;
}): Record<string, unknown> | null {
  const dataset = asRecord(args.simulatedDataset);
  if (!Object.keys(dataset).length) return null;

  const dateKeys = resolveCompareDiagnosticsDateKeys(args);
  if (dateKeys.length === 0) return dataset;

  const meta = asRecord(dataset.meta);
  if (meta.compareDiagnosticsSimulatedCompactSlice === true) {
    return dataset;
  }

  const series = asRecord(dataset.series);
  const allIntervals = asArray(series.intervals15);
  if (allIntervals.length === 0) return dataset;

  const timezone = String(meta.timezone ?? "America/Chicago").trim() || "America/Chicago";
  const dateKeySet = new Set(dateKeys);
  const filtered = filterIntervalRowsToChicagoDateKeys(allIntervals, dateKeySet, timezone);
  if (filtered.length === 0 || filtered.length === allIntervals.length) {
    return dataset;
  }

  return {
    ...dataset,
    meta: {
      ...meta,
      compareDiagnosticsSimulatedCompactSlice: true,
      compareDiagnosticsCompactSliceDateKeys: dateKeys,
    },
    series: {
      ...series,
      intervals15: filtered,
    },
  };
}

function buildDailyRowsFromIntervalPoints(
  dateKeys: string[],
  intervals: ActualIntervalPoint[]
): Array<{ date: string; kwh: number }> {
  const totals = new Map<string, number>();
  for (const point of intervals) {
    const date = String(point.homeDateKey ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    totals.set(date, round2((totals.get(date) ?? 0) + point.kwh));
  }
  return dateKeys.map((date) => ({ date, kwh: totals.get(date) ?? 0 }));
}

/**
 * Compare/export only: load persisted actual intervals for selected validation/posthoc days.
 * Does not mutate persisted rows, simulator inputs, or admin response embedding of full-year truth.
 */
export async function loadCompactActualDatasetForCompareDiagnostics(args: {
  userId: string;
  actualContextHouseId: string;
  esiid?: string | null;
  preferredActualSource?: ActualUsageSource | null;
  compareProjection?: unknown;
  includePosthocTopMissIntervalCurves?: boolean;
  posthocTopMissDayCount?: number;
  artifactMeta?: Record<string, unknown> | null;
  homeTimezone?: string;
}): Promise<Record<string, unknown> | null> {
  const houseId = String(args.actualContextHouseId ?? "").trim();
  if (!houseId) return null;

  const dateKeys = resolveCompareDiagnosticsDateKeys(args);
  if (dateKeys.length === 0) return null;

  const timezone = String(args.homeTimezone ?? "America/Chicago").trim() || "America/Chicago";
  const intervals: ActualIntervalPoint[] = [];
  for (const dateKey of dateKeys) {
    const dayIntervals = await getActualIntervalsForRange({
      houseId,
      esiid: args.esiid ?? null,
      startDate: dateKey,
      endDate: dateKey,
      preferredSource: args.preferredActualSource ?? null,
      homeTimezone: timezone,
    });
    intervals.push(...dayIntervals);
  }

  const source: ActualUsageSource =
    args.preferredActualSource === "GREEN_BUTTON" ? "GREEN_BUTTON" : "SMT";

  return {
    meta: {
      timezone,
      source,
      compareDiagnosticsCompactSlice: true,
      compactSliceDateKeys: dateKeys,
      actualContextHouseId: houseId,
      actualContextUserId: String(args.userId ?? "").trim() || null,
    },
    daily: buildDailyRowsFromIntervalPoints(dateKeys, intervals),
    series: {
      intervals15: intervals.map((point) => ({
        timestamp: point.timestamp,
        kwh: point.kwh,
      })),
    },
  };
}

/**
 * Compare/export only: load full persisted actual intervals for the source house.
 * Does not mutate persisted rows or affect simulator inputs.
 */
export async function loadActualIntervalsDatasetForCompareDiagnostics(args: {
  userId: string;
  actualContextHouseId: string;
  esiid?: string | null;
  preferredActualSource?: ActualUsageSource | null;
}): Promise<Record<string, unknown> | null> {
  const userId = String(args.userId ?? "").trim();
  const houseId = String(args.actualContextHouseId ?? "").trim();
  if (!userId || !houseId) return null;

  const { getActualUsageDatasetForHouse } = await import("@/lib/usage/actualDatasetForHouse");
  const loaded = await getActualUsageDatasetForHouse(houseId, args.esiid ?? null, {
    userId,
    preferredSource: args.preferredActualSource ?? undefined,
    skipFullYearIntervalFetch: false,
    skipLightweightInsightRecompute: true,
  }).catch(() => null);

  const dataset = loaded?.dataset;
  return dataset && typeof dataset === "object" ? (dataset as Record<string, unknown>) : null;
}

/** Merge full interval rows onto a lightweight daily dataset for compare diagnostics only. */
export function enrichDatasetWithCompareActualIntervals(args: {
  baseDataset: unknown;
  compareIntervalDataset: unknown;
}): Record<string, unknown> | null {
  const base = asRecord(args.baseDataset);
  if (!Object.keys(base).length && !args.compareIntervalDataset) return null;
  const compare = asRecord(args.compareIntervalDataset);
  const compareSeries = asRecord(compare.series);
  const intervals15 = asArray(compareSeries.intervals15);
  if (intervals15.length === 0) {
    return Object.keys(base).length ? base : compare;
  }
  const baseSeries = asRecord(base.series);
  return {
    ...base,
    series: {
      ...baseSeries,
      intervals15,
    },
  };
}

export async function resolveActualDatasetForCompareDiagnostics(args: {
  userId: string;
  actualContextHouseId: string;
  esiid?: string | null;
  preferredActualSource?: ActualUsageSource | null;
  baseDataset?: unknown;
}): Promise<Record<string, unknown> | null> {
  const fullIntervalDataset = await loadActualIntervalsDatasetForCompareDiagnostics(args);
  if (args.baseDataset) {
    return enrichDatasetWithCompareActualIntervals({
      baseDataset: args.baseDataset,
      compareIntervalDataset: fullIntervalDataset,
    });
  }
  return fullIntervalDataset;
}
