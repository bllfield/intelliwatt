import { getActualUsageDatasetForHouse } from "@/lib/usage/actualDatasetForHouse";
import type { ActualUsageSource } from "@/modules/realUsageAdapter/actual";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
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
