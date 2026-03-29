import { randomUUID } from "crypto";

/** Correlation id for Past Sim / unified fingerprint pipeline (plan §6). */
export function createSimCorrelationId(): string {
  return randomUUID();
}

export type RecalcLifecycleStage = "recalc_start" | "recalc_success" | "recalc_failure";

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
