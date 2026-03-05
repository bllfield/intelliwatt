/**
 * Sim Platform Contract — canonical types for datasets and overlays.
 * All simulator code must conform to these types (see docs/SIM_PLATFORM_CONTRACT.md).
 */

/** Expected 15-min intervals per local day. */
export const INTERVALS_PER_DAY = 96;

/** Canonical dataset kind (4-layer stack). */
export type DatasetKind =
  | "past_baseline_raw"
  | "baseline_corrected"
  | "baseline_current_state"
  | "usage_projected";

export const DATASET_KIND_PAST_BASELINE_RAW: DatasetKind = "past_baseline_raw";
export const DATASET_KIND_BASELINE_CORRECTED: DatasetKind = "baseline_corrected";
export const DATASET_KIND_BASELINE_CURRENT_STATE: DatasetKind = "baseline_current_state";
export const DATASET_KIND_USAGE_PROJECTED: DatasetKind = "usage_projected";

/** Single interval point: absolute kWh. Joinable by tsIso (exact string equality). */
export type IntervalPoint = { tsIso: string; kwh: number };

/** Metadata for a dataset (window + optional diagnostics). */
export type DatasetMeta = {
  windowStartUtc: string;
  windowEndUtc: string;
  coveragePct?: number | null;
  inputHash?: string | null;
  [key: string]: unknown;
};

/** Dataset: absolute kWh per interval with kind and meta. */
export type IntervalDataset = {
  kind: DatasetKind;
  points: IntervalPoint[];
  meta: DatasetMeta;
};

/** Overlay class: applied (past changes) vs scenario (what-if). */
export type OverlayClass = "applied" | "scenario";

/** Single overlay delta: delta kWh per interval. */
export type OverlayDelta = { tsIso: string; deltaKwh: number };

/** Result of an overlay computation (delta curve aligned to base timestamps). */
export type OverlayResult = {
  overlayId: string;
  overlayClass: OverlayClass;
  overlayType?: string;
  inputs?: unknown;
  windowStartUtc: string;
  windowEndUtc: string;
  deltas: OverlayDelta[];
  meta?: Record<string, unknown>;
};
