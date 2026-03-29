import { randomUUID } from "crypto";

/** Correlation id for Past Sim / unified fingerprint pipeline (plan §6). */
export function createSimCorrelationId(): string {
  return randomUUID();
}

/** Lightweight RSS snapshot for Phase 3 measurement (plan §12 / §16). Node `process.memoryUsage()` only. */
export function getMemoryRssMb(): number {
  try {
    const rss = process.memoryUsage?.()?.rss;
    if (typeof rss !== "number" || !Number.isFinite(rss)) return 0;
    return Math.round((rss / (1024 * 1024)) * 1000) / 1000;
  } catch {
    return 0;
  }
}

/** Wall-clock ceiling for `dispatchPastSimRecalc` inline path (before droplet queue). Plan §6 (A) `recalc_timeout`. */
export const USER_PAST_SIM_RECALC_INLINE_TIMEOUT_MS = 90_000;

export type RecalcLifecycleStage = "recalc_start" | "recalc_success" | "recalc_failure";

/**
 * Plan §6 (B) fingerprint pipeline event names. Builders (Slices 9–10) should emit these via
 * `logSimPipelineEvent` (or future dedicated helpers). Exported for type-safe wiring.
 */
export const FINGERPRINT_PIPELINE_EVENT = {
  wholeHomeFingerprintBuildStart: "whole_home_fingerprint_build_start",
  wholeHomeFingerprintBuildSuccess: "whole_home_fingerprint_build_success",
  wholeHomeFingerprintBuildFailure: "whole_home_fingerprint_build_failure",
  usageFingerprintBuildStart: "usage_fingerprint_build_start",
  usageFingerprintBuildSuccess: "usage_fingerprint_build_success",
  usageFingerprintBuildFailure: "usage_fingerprint_build_failure",
  resolvedSimFingerprintResolutionStart: "resolved_sim_fingerprint_resolution_start",
  resolvedSimFingerprintResolutionSuccess: "resolved_sim_fingerprint_resolution_success",
  resolvedSimFingerprintResolutionFailure: "resolved_sim_fingerprint_resolution_failure",
} as const;

export type FingerprintPipelineEventName =
  (typeof FINGERPRINT_PIPELINE_EVENT)[keyof typeof FINGERPRINT_PIPELINE_EVENT];

/**
 * Deprecated no-op: fingerprint builders emit via `logSimPipelineEvent` + `FINGERPRINT_PIPELINE_EVENT` (Slice 11).
 * @deprecated
 */
export function logFingerprintPipelineStub(
  _event: FingerprintPipelineEventName,
  _fields?: Record<string, string | number | boolean | null | undefined>
): void {
  // Intentionally empty — retained for backward compatibility with any stale imports.
}

export type SimObservabilityRecalcPayload = {
  stage: RecalcLifecycleStage;
  correlationId: string;
  durationMs?: number;
  userId?: string;
  houseId?: string;
  mode?: string;
  scenarioId?: string | null;
  buildInputsHash?: string;
  failureCode?: string;
  failureMessage?: string;
  /** "recalcSimulatorBuild" | "pastSimRecalcQueuedWorker" | etc. */
  source?: string;
};

/**
 * Single-line JSON logs for log drains (plan §6). Do not log secrets or raw intervals.
 */
export function logSimObservabilityEvent(payload: SimObservabilityRecalcPayload): void {
  try {
    // eslint-disable-next-line no-console
    console.log(`[simObservability] ${JSON.stringify(payload)}`);
  } catch {
    // ignore
  }
}

/** Slice 2: day simulation, stitch, compare attach, artifact cache (plan §6 C/D). */
export function logSimPipelineEvent(
  event: string,
  fields: Record<string, string | number | boolean | null | undefined>
): void {
  try {
    // eslint-disable-next-line no-console
    console.log(`[simObservability] ${JSON.stringify({ event, ...fields })}`);
  } catch {
    // ignore
  }
}
