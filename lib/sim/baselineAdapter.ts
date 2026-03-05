/**
 * Sim Platform Contract — adapters to expose past_baseline_raw and baseline_corrected
 * as IntervalDataset from existing point arrays. No DB access; pure conversion only.
 * See docs/SIM_PLATFORM_CONTRACT.md and Phase 2 Baseline Builder plan.
 */

import type { IntervalDataset, DatasetMeta } from "./contract/types";
import {
  DATASET_KIND_PAST_BASELINE_RAW,
  DATASET_KIND_BASELINE_CORRECTED,
} from "./contract/types";
import { fromTimestamp } from "./contract/dataset";

/** Input point shape used by existing code (e.g. getActualIntervalsForRange, curve.intervals). */
export type LegacyIntervalPoint = { timestamp: string; kwh: number };

export type ToPastBaselineRawDatasetArgs = {
  points: LegacyIntervalPoint[];
  windowStartUtc: string;
  windowEndUtc: string;
  inputHash?: string | null;
};

export type ToCorrectedBaselineDatasetArgs = {
  points: LegacyIntervalPoint[];
  windowStartUtc: string;
  windowEndUtc: string;
  inputHash?: string | null;
};

function buildMeta(
  windowStartUtc: string,
  windowEndUtc: string,
  inputHash: string | null | undefined,
  sourceLabel: string
): DatasetMeta {
  const meta: DatasetMeta = {
    windowStartUtc,
    windowEndUtc,
    sourceLabel,
    inputHash: inputHash ?? null,
  };
  return meta;
}

/**
 * Expose raw actual intervals as IntervalDataset (kind past_baseline_raw).
 * Caller supplies points (e.g. from getActualIntervalsForRange). No sorting or coverage enforcement.
 */
export function toPastBaselineRawDataset(args: ToPastBaselineRawDatasetArgs): IntervalDataset {
  const points = (args.points ?? []).map((p) => fromTimestamp(p));
  return {
    kind: DATASET_KIND_PAST_BASELINE_RAW,
    points,
    meta: buildMeta(
      args.windowStartUtc,
      args.windowEndUtc,
      args.inputHash,
      "baselineAdapter.past_baseline_raw"
    ),
  };
}

/**
 * Expose corrected baseline (stitched actual + simulated) as IntervalDataset (kind baseline_corrected).
 * Caller supplies points (e.g. from curve.intervals or dataset.series.intervals15). No sorting or coverage enforcement.
 */
export function toCorrectedBaselineDataset(args: ToCorrectedBaselineDatasetArgs): IntervalDataset {
  const points = (args.points ?? []).map((p) => fromTimestamp(p));
  return {
    kind: DATASET_KIND_BASELINE_CORRECTED,
    points,
    meta: buildMeta(
      args.windowStartUtc,
      args.windowEndUtc,
      args.inputHash,
      "baselineAdapter.baseline_corrected"
    ),
  };
}
