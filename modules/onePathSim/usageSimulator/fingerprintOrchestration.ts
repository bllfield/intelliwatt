/**
 * Shared orchestration: same `ensureSimulatorFingerprintsForRecalc` entrypoint for inline recalc
 * and future background/prebuild callers (Phase 2b / Section 11).
 */

import type { SimulatorMode } from "@/modules/onePathSim/usageSimulator/requirements";
import { buildAndPersistUsageFingerprint } from "@/modules/onePathSim/usageSimulator/usageFingerprintBuilder";
import { buildAndPersistWholeHomeFingerprint } from "@/modules/onePathSim/usageSimulator/wholeHomeFingerprintBuilder";
import {
  createFingerprintRecalcContext,
  type FingerprintRecalcContext,
} from "@/modules/onePathSim/usageSimulator/fingerprintRecalcContext";
import type { ResolvedSimFingerprint } from "@/modules/onePathSim/usageSimulator/resolvedSimFingerprintTypes";
import { getMemoryRssMb, logSimPipelineEvent } from "@/modules/onePathSim/usageSimulator/simObservability";

export type EnsureSimulatorFingerprintsArgs = {
  houseId: string;
  actualContextHouseId: string;
  esiid: string | null;
  homeProfile: Record<string, unknown> | null | undefined;
  applianceProfile: Record<string, unknown> | null | undefined;
  mode: SimulatorMode;
  /** From recalc ladder: actual 15m intervals available for SMT_BASELINE. */
  actualOk: boolean;
  windowStart: string;
  windowEnd: string;
  correlationId?: string;
};

/**
 * Ensures WholeHome fingerprint is refreshed; Usage fingerprint when SMT_BASELINE + actual data.
 * Callers: `recalcSimulatorBuild` (inline) and future prebuild jobs (same function).
 */
export async function ensureSimulatorFingerprintsForRecalc(args: EnsureSimulatorFingerprintsArgs): Promise<void> {
  const context = createFingerprintRecalcContext(args);
  await ensureSimulatorFingerprintsWithContext(context);
}

export async function ensureSimulatorFingerprintsWithContext(
  context: FingerprintRecalcContext
): Promise<void> {
  const wholeHomePolicy = await context.getWholeHomePolicy();
  if (wholeHomePolicy.decision.action === "rebuild") {
    await buildAndPersistWholeHomeFingerprint({
      houseId: context.houseId,
      homeProfile: context.homeProfile,
      applianceProfile: context.applianceProfile,
      correlationId: context.correlationId,
      prepared: wholeHomePolicy.prepared,
      priorArtifact: wholeHomePolicy.currentArtifact,
    });
  }

  const usagePolicy = await context.getUsagePolicy();
  if (usagePolicy && usagePolicy.decision.action === "rebuild") {
    const usageBuildStartedAt = Date.now();
    logSimPipelineEvent("usage_fingerprint_build_from_prepared_start", {
      correlationId: context.correlationId,
      houseId: context.actualContextHouseId,
      source: "ensureSimulatorFingerprintsWithContext",
      memoryRssMb: getMemoryRssMb(),
    });
    try {
      await buildAndPersistUsageFingerprint({
        houseId: context.actualContextHouseId,
        esiid: context.esiid,
        startDate: context.windowStart,
        endDate: context.windowEnd,
        correlationId: context.correlationId,
        prepared: usagePolicy.prepared,
        priorArtifact: usagePolicy.currentArtifact,
      });
      logSimPipelineEvent("usage_fingerprint_build_from_prepared_success", {
        correlationId: context.correlationId,
        houseId: context.actualContextHouseId,
        source: "ensureSimulatorFingerprintsWithContext",
        durationMs: Date.now() - usageBuildStartedAt,
        memoryRssMb: getMemoryRssMb(),
      });
    } catch (e) {
      logSimPipelineEvent("usage_fingerprint_build_from_prepared_failure", {
        correlationId: context.correlationId,
        houseId: context.actualContextHouseId,
        source: "ensureSimulatorFingerprintsWithContext",
        durationMs: Date.now() - usageBuildStartedAt,
        memoryRssMb: getMemoryRssMb(),
        failureMessage: e instanceof Error ? e.message : String(e),
      });
      throw e;
    }
  }
}

export async function resolveSimFingerprintForRecalc(args: EnsureSimulatorFingerprintsArgs & {
  manualUsagePayload?: unknown | null;
}): Promise<ResolvedSimFingerprint> {
  const contextStartedAt = Date.now();
  const context = createFingerprintRecalcContext(args);
  logSimPipelineEvent("fingerprint_context_setup", {
    correlationId: args.correlationId,
    houseId: args.houseId,
    sourceHouseId: args.actualContextHouseId !== args.houseId ? args.actualContextHouseId : undefined,
    source: "resolveSimFingerprintForRecalc",
    durationMs: Date.now() - contextStartedAt,
    memoryRssMb: getMemoryRssMb(),
  });
  return context.resolveResolvedFingerprint({
    manualUsagePayload: args.manualUsagePayload ?? null,
  });
}

export async function resolveSimFingerprintWithContext(
  context: FingerprintRecalcContext,
  args?: { manualUsagePayload?: unknown | null }
): Promise<ResolvedSimFingerprint> {
  return context.resolveResolvedFingerprint({
    manualUsagePayload: args?.manualUsagePayload ?? null,
  });
}

export async function ensureAndResolveSimFingerprintForRecalc(
  args: EnsureSimulatorFingerprintsArgs & { manualUsagePayload?: unknown | null }
): Promise<ResolvedSimFingerprint> {
  const contextStartedAt = Date.now();
  const context = createFingerprintRecalcContext(args);
  logSimPipelineEvent("fingerprint_context_setup", {
    correlationId: args.correlationId,
    houseId: args.houseId,
    sourceHouseId: args.actualContextHouseId !== args.houseId ? args.actualContextHouseId : undefined,
    source: "ensureAndResolveSimFingerprintForRecalc",
    durationMs: Date.now() - contextStartedAt,
    memoryRssMb: getMemoryRssMb(),
  });
  await ensureSimulatorFingerprintsWithContext(context);
  return context.resolveResolvedFingerprint({
    manualUsagePayload: args.manualUsagePayload ?? null,
  });
}

/** Explicit alias for background/prebuild orchestration (same implementation as recalc). */
export const prebuildSimulatorFingerprints = ensureSimulatorFingerprintsForRecalc;
export { createFingerprintRecalcContext, type FingerprintRecalcContext };

