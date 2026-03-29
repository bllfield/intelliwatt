/**
 * Single shared ResolvedSimFingerprint resolver (Phase 2c). Same function for recalc, future prebuild, and any cache layer.
 */

import { SimulatorFingerprintStatus } from "@/.prisma/usage-client";
import {
  getLatestUsageFingerprintByHouseId,
  getLatestWholeHomeFingerprintByHouseId,
} from "@/modules/usageSimulator/fingerprintArtifactsRepo";
import { inferManualTotalsConstraintKind } from "@/modules/usageSimulator/manualUsageConstraint";
import { sha256HexUtf8, stableStringify } from "@/modules/usageSimulator/fingerprintHash";
import type {
  ResolvedSimFingerprint,
  ResolvedSimFingerprintBlendMode,
  ResolvedSimFingerprintUnderlyingMix,
} from "@/modules/usageSimulator/resolvedSimFingerprintTypes";
import type { SimulatorMode } from "@/modules/usageSimulator/requirements";
import {
  FINGERPRINT_PIPELINE_EVENT,
  getMemoryRssMb,
  logSimPipelineEvent,
} from "@/modules/usageSimulator/simObservability";

export const RESOLVED_SIM_FINGERPRINT_VERSION = "resolved_sim_fp_v2";

function isReadyStatus(status: string | null | undefined): boolean {
  return status === SimulatorFingerprintStatus.ready;
}

function computeBaseMix(whReady: boolean, usReady: boolean): {
  underlying: ResolvedSimFingerprintUnderlyingMix;
  usageBlendWeight: number;
} {
  if (usReady && whReady) return { underlying: "blended", usageBlendWeight: 0.5 };
  if (usReady) return { underlying: "usage_only", usageBlendWeight: 1 };
  if (whReady) return { underlying: "whole_home_only", usageBlendWeight: 0 };
  return { underlying: "insufficient_inputs", usageBlendWeight: 0 };
}

/**
 * Canonical resolver: reads persisted WholeHome + Usage fingerprint rows and produces one resolved contract.
 * No alternate implementation — cache wrappers must call this function.
 */
export async function resolveSimFingerprint(args: {
  houseId: string;
  /** Defaults to `houseId`; UsageFingerprint rows follow Slice 9 actual-context house id. */
  actualContextHouseId?: string;
  mode: SimulatorMode;
  correlationId?: string;
  /** When mode is MANUAL_TOTALS, used to distinguish monthly vs annual constraint surfaces (plan §17). */
  manualUsagePayload?: unknown | null;
}): Promise<ResolvedSimFingerprint> {
  const startedAt = Date.now();
  const correlationId = args.correlationId;
  const wholeHomeHouseId = args.houseId;
  const usageFingerprintHouseId = String(args.actualContextHouseId ?? args.houseId);

  logSimPipelineEvent(FINGERPRINT_PIPELINE_EVENT.resolvedSimFingerprintResolutionStart, {
    correlationId,
    houseId: wholeHomeHouseId,
    sourceHouseId: usageFingerprintHouseId !== wholeHomeHouseId ? usageFingerprintHouseId : undefined,
    mode: String(args.mode),
    memoryRssMb: getMemoryRssMb(),
    source: "resolveSimFingerprint",
  });

  try {
    const [wh, us] = await Promise.all([
      getLatestWholeHomeFingerprintByHouseId(wholeHomeHouseId),
      getLatestUsageFingerprintByHouseId(usageFingerprintHouseId),
    ]);

    const whReady = Boolean(wh && isReadyStatus(wh.status));
    const usReady = Boolean(us && isReadyStatus(us.status));

    const base = computeBaseMix(whReady, usReady);
    const resolutionNotes: string[] = [];

    let blendMode: ResolvedSimFingerprintBlendMode;
    let underlyingSourceMix: ResolvedSimFingerprintUnderlyingMix = base.underlying;
    let usageBlendWeight = base.usageBlendWeight;

    const manualKind =
      args.mode === "MANUAL_TOTALS" ? inferManualTotalsConstraintKind(args.manualUsagePayload ?? null) : null;
    const manualTotalsConstraint: "none" | "monthly" | "annual" =
      manualKind === "monthly" || manualKind === "annual" ? manualKind : "none";

    if (args.mode === "NEW_BUILD_ESTIMATE") {
      if (!whReady) {
        blendMode = "insufficient_inputs";
        underlyingSourceMix = "insufficient_inputs";
        usageBlendWeight = 0;
        resolutionNotes.push("new_build_requires_ready_whole_home_fingerprint");
      } else {
        blendMode = "whole_home_only";
        underlyingSourceMix = "whole_home_only";
        usageBlendWeight = 0;
        resolutionNotes.push("new_build_whole_home_cohort_path");
      }
    } else if (args.mode === "MANUAL_TOTALS" && (manualKind === "monthly" || manualKind === "annual")) {
      if (!whReady) {
        blendMode = "insufficient_inputs";
        underlyingSourceMix = "insufficient_inputs";
        usageBlendWeight = 0;
        resolutionNotes.push("manual_totals_requires_ready_whole_home_fingerprint");
      } else {
        blendMode = manualKind === "monthly" ? "constrained_monthly_totals" : "constrained_annual_total";
        underlyingSourceMix = base.underlying;
        usageBlendWeight = base.usageBlendWeight;
      }
    } else {
      if (args.mode === "MANUAL_TOTALS" && manualTotalsConstraint === "none") {
        resolutionNotes.push("manual_totals_constraint_unspecified_using_usage_blend_surface");
      }
      blendMode = base.underlying;
      underlyingSourceMix = base.underlying;
      usageBlendWeight = base.usageBlendWeight;
    }

    const resolvedHash = sha256HexUtf8(
      stableStringify({
        version: RESOLVED_SIM_FINGERPRINT_VERSION,
        wholeHomeHouseId,
        usageFingerprintHouseId,
        mode: args.mode,
        blendMode,
        underlyingSourceMix,
        manualTotalsConstraint,
        resolutionNotes: [...resolutionNotes].sort(),
        usageBlendWeight,
        wholeHomeSourceHash: wh?.sourceHash ?? null,
        usageSourceHash: us?.sourceHash ?? null,
        wholeHomeFingerprintArtifactId: wh?.id ?? null,
        usageFingerprintArtifactId: us?.id ?? null,
      })
    );

    const result: ResolvedSimFingerprint = {
      resolverVersion: RESOLVED_SIM_FINGERPRINT_VERSION,
      resolvedHash,
      blendMode,
      underlyingSourceMix,
      manualTotalsConstraint,
      resolutionNotes,
      wholeHomeHouseId,
      usageFingerprintHouseId,
      wholeHomeFingerprintArtifactId: wh?.id ?? null,
      usageFingerprintArtifactId: us?.id ?? null,
      wholeHomeStatus: wh?.status ?? null,
      usageStatus: us?.status ?? null,
      wholeHomeSourceHash: wh?.sourceHash ?? null,
      usageSourceHash: us?.sourceHash ?? null,
      usageBlendWeight,
    };

    logSimPipelineEvent(FINGERPRINT_PIPELINE_EVENT.resolvedSimFingerprintResolutionSuccess, {
      correlationId,
      houseId: wholeHomeHouseId,
      sourceHouseId: usageFingerprintHouseId !== wholeHomeHouseId ? usageFingerprintHouseId : undefined,
      mode: String(args.mode),
      blendMode: result.blendMode,
      underlyingSourceMix: result.underlyingSourceMix,
      manualTotalsConstraint: result.manualTotalsConstraint,
      durationMs: Date.now() - startedAt,
      memoryRssMb: getMemoryRssMb(),
      wholeHomeFingerprintArtifactId: result.wholeHomeFingerprintArtifactId,
      usageFingerprintArtifactId: result.usageFingerprintArtifactId,
      source: "resolveSimFingerprint",
    });

    return result;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logSimPipelineEvent(FINGERPRINT_PIPELINE_EVENT.resolvedSimFingerprintResolutionFailure, {
      correlationId,
      houseId: wholeHomeHouseId,
      sourceHouseId: usageFingerprintHouseId !== wholeHomeHouseId ? usageFingerprintHouseId : undefined,
      mode: String(args.mode),
      durationMs: Date.now() - startedAt,
      failureMessage: msg,
      memoryRssMb: getMemoryRssMb(),
      source: "resolveSimFingerprint",
    });
    throw e;
  }
}
