import { SimulatorFingerprintStatus } from "@/.prisma/usage-client";
import {
  getLatestUsageFingerprintByHouseId,
  getLatestWholeHomeFingerprintByHouseId,
} from "@/modules/onePathSim/usageSimulator/fingerprintArtifactsRepo";
import {
  prepareWholeHomeFingerprintBuild,
  WHOLE_HOME_FINGERPRINT_ALGORITHM_VERSION,
  type PreparedWholeHomeFingerprintBuild,
} from "@/modules/onePathSim/usageSimulator/wholeHomeFingerprintBuilder";
import {
  prepareUsageFingerprintBuild,
  USAGE_FINGERPRINT_ALGORITHM_VERSION,
  type PreparedUsageFingerprintBuild,
} from "@/modules/onePathSim/usageSimulator/usageFingerprintBuilder";

type ArtifactSnapshot = {
  status?: string | null;
  algorithmVersion?: string | null;
  sourceHash?: string | null;
  staleReason?: string | null;
} | null;

export type FingerprintPolicyDecision = {
  action: "reuse" | "rebuild";
  reason:
    | "artifact_missing"
    | "artifact_not_ready"
    | "algorithm_version_mismatch"
    | "source_hash_mismatch"
    | "ready_source_hash_match";
  currentStatus: string | null;
  currentSourceHash: string | null;
  expectedSourceHash: string;
  staleReason: string | null;
};

function decideReuseVsRebuild(args: {
  artifact: ArtifactSnapshot;
  expectedSourceHash: string;
  expectedAlgorithmVersion: string;
}): FingerprintPolicyDecision {
  const artifact = args.artifact;
  if (!artifact) {
    return {
      action: "rebuild",
      reason: "artifact_missing",
      currentStatus: null,
      currentSourceHash: null,
      expectedSourceHash: args.expectedSourceHash,
      staleReason: "artifact_missing",
    };
  }
  if (artifact.status !== SimulatorFingerprintStatus.ready) {
    return {
      action: "rebuild",
      reason: "artifact_not_ready",
      currentStatus: artifact.status ?? null,
      currentSourceHash: artifact.sourceHash ?? null,
      expectedSourceHash: args.expectedSourceHash,
      staleReason: artifact.staleReason ?? `status_${String(artifact.status ?? "unknown")}`,
    };
  }
  if (artifact.algorithmVersion !== args.expectedAlgorithmVersion) {
    return {
      action: "rebuild",
      reason: "algorithm_version_mismatch",
      currentStatus: artifact.status ?? null,
      currentSourceHash: artifact.sourceHash ?? null,
      expectedSourceHash: args.expectedSourceHash,
      staleReason: "algorithm_version_mismatch",
    };
  }
  if (artifact.sourceHash !== args.expectedSourceHash) {
    return {
      action: "rebuild",
      reason: "source_hash_mismatch",
      currentStatus: artifact.status ?? null,
      currentSourceHash: artifact.sourceHash ?? null,
      expectedSourceHash: args.expectedSourceHash,
      staleReason: "source_hash_mismatch",
    };
  }
  return {
    action: "reuse",
    reason: "ready_source_hash_match",
    currentStatus: artifact.status ?? null,
    currentSourceHash: artifact.sourceHash ?? null,
    expectedSourceHash: args.expectedSourceHash,
    staleReason: null,
  };
}

export async function evaluateWholeHomeFingerprintPolicy(args: {
  houseId: string;
  homeProfile: Record<string, unknown> | null | undefined;
  applianceProfile: Record<string, unknown> | null | undefined;
}): Promise<{
  currentArtifact: Awaited<ReturnType<typeof getLatestWholeHomeFingerprintByHouseId>>;
  prepared: PreparedWholeHomeFingerprintBuild;
  decision: FingerprintPolicyDecision;
}> {
  const [currentArtifact, prepared] = await Promise.all([
    getLatestWholeHomeFingerprintByHouseId(args.houseId).catch(() => null),
    Promise.resolve(
      prepareWholeHomeFingerprintBuild({
        homeProfile: args.homeProfile,
        applianceProfile: args.applianceProfile,
      })
    ),
  ]);
  const decision = decideReuseVsRebuild({
    artifact: currentArtifact,
    expectedSourceHash: prepared.sourceHash,
    expectedAlgorithmVersion: WHOLE_HOME_FINGERPRINT_ALGORITHM_VERSION,
  });
  return { currentArtifact, prepared, decision };
}

export async function evaluateUsageFingerprintPolicy(args: {
  houseId: string;
  esiid: string | null;
  startDate: string;
  endDate: string;
}): Promise<{
  currentArtifact: Awaited<ReturnType<typeof getLatestUsageFingerprintByHouseId>>;
  prepared: PreparedUsageFingerprintBuild;
  decision: FingerprintPolicyDecision;
}> {
  const [currentArtifact, prepared] = await Promise.all([
    getLatestUsageFingerprintByHouseId(args.houseId).catch(() => null),
    prepareUsageFingerprintBuild({
      houseId: args.houseId,
      esiid: args.esiid,
      startDate: args.startDate,
      endDate: args.endDate,
    }),
  ]);
  const decision = decideReuseVsRebuild({
    artifact: currentArtifact,
    expectedSourceHash: prepared.sourceHash,
    expectedAlgorithmVersion: USAGE_FINGERPRINT_ALGORITHM_VERSION,
  });
  return { currentArtifact, prepared, decision };
}


