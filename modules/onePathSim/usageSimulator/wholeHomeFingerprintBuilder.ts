/**
 * Single shared WholeHomeFingerprint builder (Phase 2b). Same entrypoint for recalc and future prebuild.
 */

import type { Prisma } from "@/.prisma/usage-client";
import { SimulatorFingerprintStatus } from "@/.prisma/usage-client";
import { buildCohortPriorV1 } from "@/modules/onePathSim/usageSimulator/cohortPriorBuilder";
import {
  getLatestWholeHomeFingerprintByHouseId,
  upsertWholeHomeFingerprintArtifact,
} from "@/modules/onePathSim/usageSimulator/fingerprintArtifactsRepo";
import { sha256HexUtf8 } from "@/modules/onePathSim/usageSimulator/fingerprintHash";
import {
  FINGERPRINT_PIPELINE_EVENT,
  getMemoryRssMb,
  logSimPipelineEvent,
} from "@/modules/onePathSim/usageSimulator/simObservability";
import {
  computeWholeHomeSourceHashWithCohort,
  pickWholeHomeFingerprintInputs,
  WHOLE_HOME_FINGERPRINT_ALGORITHM_VERSION,
  computeWholeHomeSourceHashFromInputs,
} from "@/modules/onePathSim/usageSimulator/wholeHomeFingerprintInputs";

export { WHOLE_HOME_FINGERPRINT_ALGORITHM_VERSION, pickWholeHomeFingerprintInputs, computeWholeHomeSourceHashFromInputs };
export { computeWholeHomeSourceHashWithCohort } from "@/modules/onePathSim/usageSimulator/wholeHomeFingerprintInputs";

export type PreparedWholeHomeFingerprintBuild = {
  sourceHash: string;
  payloadJson: Prisma.InputJsonValue;
};

export function prepareWholeHomeFingerprintBuild(args: {
  homeProfile: Record<string, unknown> | null | undefined;
  applianceProfile: Record<string, unknown> | null | undefined;
}): PreparedWholeHomeFingerprintBuild {
  const picked = pickWholeHomeFingerprintInputs({
    homeProfile: args.homeProfile,
    applianceProfile: args.applianceProfile,
  });
  const cohortPrior = buildCohortPriorV1({
    homeProfile: args.homeProfile,
    applianceProfile: args.applianceProfile,
  });
  const sourceHash = computeWholeHomeSourceHashWithCohort({ inputs: picked, cohortPrior });
  const payloadJson = {
    version: WHOLE_HOME_FINGERPRINT_ALGORITHM_VERSION,
    features: JSON.parse(JSON.stringify(picked)) as Prisma.InputJsonValue,
    cohortPrior,
    cohortProvenance: {
      incorporated: true,
      cohortPriorVersion: cohortPrior.cohortPriorVersion,
      similarityFeatureVectorVersion: cohortPrior.similarityFeatureVectorVersion,
      confidence: cohortPrior.confidence,
    },
  } satisfies Prisma.InputJsonValue;
  return { sourceHash, payloadJson };
}

export async function buildAndPersistWholeHomeFingerprint(args: {
  houseId: string;
  homeProfile: Record<string, unknown> | null | undefined;
  applianceProfile: Record<string, unknown> | null | undefined;
  correlationId?: string;
  prepared?: PreparedWholeHomeFingerprintBuild;
  priorArtifact?: { sourceHash?: string | null; status?: string | null } | null;
}): Promise<{ ok: true; sourceHash: string } | { ok: false; error: string }> {
  const { houseId, homeProfile, applianceProfile, correlationId } = args;
  const startedAt = Date.now();
  logSimPipelineEvent(FINGERPRINT_PIPELINE_EVENT.wholeHomeFingerprintBuildStart, {
    correlationId,
    houseId,
    source: "buildAndPersistWholeHomeFingerprint",
    memoryRssMb: getMemoryRssMb(),
  });
  const prior = args.priorArtifact ?? (await getLatestWholeHomeFingerprintByHouseId(houseId).catch(() => null));
  const pendingHash = prior?.sourceHash ?? "pending";

  try {
    await upsertWholeHomeFingerprintArtifact({
      houseId,
      status: SimulatorFingerprintStatus.building,
      algorithmVersion: WHOLE_HOME_FINGERPRINT_ALGORITHM_VERSION,
      sourceHash: pendingHash,
      staleReason: null,
      builtAt: null,
      payloadJson: { phase: "building", priorStatus: prior?.status ?? null },
    });

    const prepared =
      args.prepared ??
      prepareWholeHomeFingerprintBuild({
        homeProfile,
        applianceProfile,
      });
    const sourceHash = prepared.sourceHash;
    const payloadJson = prepared.payloadJson;

    await upsertWholeHomeFingerprintArtifact({
      houseId,
      status: SimulatorFingerprintStatus.ready,
      algorithmVersion: WHOLE_HOME_FINGERPRINT_ALGORITHM_VERSION,
      sourceHash,
      staleReason: null,
      builtAt: new Date(),
      payloadJson,
    });
    logSimPipelineEvent(FINGERPRINT_PIPELINE_EVENT.wholeHomeFingerprintBuildSuccess, {
      correlationId,
      houseId,
      durationMs: Date.now() - startedAt,
      memoryRssMb: getMemoryRssMb(),
      source: "buildAndPersistWholeHomeFingerprint",
    });
    return { ok: true, sourceHash };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    await upsertWholeHomeFingerprintArtifact({
      houseId,
      status: SimulatorFingerprintStatus.failed,
      algorithmVersion: WHOLE_HOME_FINGERPRINT_ALGORITHM_VERSION,
      sourceHash: pendingHash === "pending" ? sha256HexUtf8(`failed:${houseId}:${Date.now()}`) : pendingHash,
      staleReason: msg,
      builtAt: null,
      payloadJson: { error: msg, phase: "failed" },
    }).catch(() => {});
    logSimPipelineEvent(FINGERPRINT_PIPELINE_EVENT.wholeHomeFingerprintBuildFailure, {
      correlationId,
      houseId,
      durationMs: Date.now() - startedAt,
      failureMessage: msg,
      memoryRssMb: getMemoryRssMb(),
      source: "buildAndPersistWholeHomeFingerprint",
    });
    return { ok: false, error: msg };
  }
}

