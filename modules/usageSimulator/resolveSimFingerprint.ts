/**
 * Single shared ResolvedSimFingerprint resolver (Phase 2c). Same function for recalc, future prebuild, and any cache layer.
 */

import { SimulatorFingerprintStatus } from "@/.prisma/usage-client";
import {
  getLatestUsageFingerprintByHouseId,
  getLatestWholeHomeFingerprintByHouseId,
} from "@/modules/usageSimulator/fingerprintArtifactsRepo";
import { sha256HexUtf8, stableStringify } from "@/modules/usageSimulator/fingerprintHash";
import type {
  ResolvedSimFingerprint,
  ResolvedSimFingerprintBlendMode,
} from "@/modules/usageSimulator/resolvedSimFingerprintTypes";
import type { SimulatorMode } from "@/modules/usageSimulator/requirements";

export const RESOLVED_SIM_FINGERPRINT_VERSION = "resolved_sim_fp_v1";

function isReadyStatus(status: string | null | undefined): boolean {
  return status === SimulatorFingerprintStatus.ready;
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
}): Promise<ResolvedSimFingerprint> {
  const wholeHomeHouseId = args.houseId;
  const usageFingerprintHouseId = String(args.actualContextHouseId ?? args.houseId);

  const [wh, us] = await Promise.all([
    getLatestWholeHomeFingerprintByHouseId(wholeHomeHouseId),
    getLatestUsageFingerprintByHouseId(usageFingerprintHouseId),
  ]);

  const whReady = Boolean(wh && isReadyStatus(wh.status));
  const usReady = Boolean(us && isReadyStatus(us.status));

  let blendMode: ResolvedSimFingerprintBlendMode;
  let usageBlendWeight: number;

  if (usReady && whReady) {
    blendMode = "blended";
    usageBlendWeight = 0.5;
  } else if (usReady) {
    blendMode = "usage_only";
    usageBlendWeight = 1;
  } else if (whReady) {
    blendMode = "whole_home_only";
    usageBlendWeight = 0;
  } else {
    blendMode = "insufficient_inputs";
    usageBlendWeight = 0;
  }

  const resolvedHash = sha256HexUtf8(
    stableStringify({
      version: RESOLVED_SIM_FINGERPRINT_VERSION,
      wholeHomeHouseId,
      usageFingerprintHouseId,
      mode: args.mode,
      blendMode,
      usageBlendWeight,
      wholeHomeSourceHash: wh?.sourceHash ?? null,
      usageSourceHash: us?.sourceHash ?? null,
      wholeHomeFingerprintArtifactId: wh?.id ?? null,
      usageFingerprintArtifactId: us?.id ?? null,
    })
  );

  return {
    resolverVersion: RESOLVED_SIM_FINGERPRINT_VERSION,
    resolvedHash,
    blendMode,
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
}
