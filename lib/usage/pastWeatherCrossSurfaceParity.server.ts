import "server-only";

import {
  auditPastWeatherInputParity,
  buildPastWeatherCrossSurfaceAcceptanceProof,
  buildPastWeatherInputFingerprint,
  computeSimulatedProfileFingerprint,
} from "@/lib/usage/pastWeatherInputParity";
import { auditUserAdminPastReadModelParity } from "@/lib/usage/intervalReadModelInvariants";
import { finalizePastDatasetDisplayReadModel } from "@/lib/usage/finalizePastDatasetDisplayReadModel";
import {
  resolvePastProfileLoadContext,
  resolvePastWeatherHouseIdFromDataset,
} from "@/lib/usage/pastVisibleWeatherReadDiagnostics";
import { readGreenButtonTrustedHomeDateKeysFromPastMeta } from "@/lib/usage/greenButtonPastTrustedPool";
import { resolveUserPastVisibleWeatherSensitivityScore } from "@/lib/usage/userPastVisibleWeather";
import { scoreCardValues } from "@/lib/usage/weatherScoringOwnership";
import { getHomeProfileSimulatedByUserHouse } from "@/modules/homeProfile/repo";
import { getApplianceProfileSimulatedByUserHouse } from "@/modules/applianceProfile/repo";
import { normalizeStoredApplianceProfile } from "@/modules/applianceProfile/validation";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

async function finalizeSourceDatasetForCrossSurfaceParity(args: {
  sourceUserId: string;
  sourceHouseId: string;
  sourceScenarioId: string;
  dataset: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const dataset = structuredClone(args.dataset);
  const meta = asRecord(dataset.meta);
  const profileLoad = resolvePastProfileLoadContext({
    dataset,
    requestUserId: args.sourceUserId,
    requestHouseId: args.sourceHouseId,
    sourceUserId: args.sourceUserId,
  });
  const [homeProfile, applianceProfileRec] = await Promise.all([
    getHomeProfileSimulatedByUserHouse({
      userId: profileLoad.profileUserId,
      houseId: profileLoad.profileHouseId,
    }),
    getApplianceProfileSimulatedByUserHouse({
      userId: profileLoad.profileUserId,
      houseId: profileLoad.profileHouseId,
    }),
  ]);
  const applianceProfile = normalizeStoredApplianceProfile((applianceProfileRec?.appliancesJson as any) ?? null);
  const greenButtonTrustedHomeDateKeys = readGreenButtonTrustedHomeDateKeysFromPastMeta(meta);
  await finalizePastDatasetDisplayReadModel({
    dataset,
    weatherHouseId: profileLoad.profileHouseId,
    fallbackHouseId: args.sourceHouseId,
    scenarioId: args.sourceScenarioId,
    homeProfile,
    applianceProfile,
    greenButtonTrustedHomeDateKeys:
      greenButtonTrustedHomeDateKeys.size > 0 ? greenButtonTrustedHomeDateKeys : undefined,
    persistDisplayWeatherToCache: false,
  });
  return dataset;
}

async function finalizeAdminDatasetForCrossSurfaceParity(args: {
  sourceUserId: string;
  adminUserId: string;
  adminHouseId: string;
  sourceHouseId: string;
  adminScenarioId: string;
  dataset: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const dataset = structuredClone(args.dataset);
  const meta = asRecord(dataset.meta);
  const profileLoad = resolvePastProfileLoadContext({
    dataset,
    requestUserId: args.adminUserId,
    requestHouseId: args.adminHouseId,
    sourceUserId: args.sourceUserId,
  });
  const effectiveProfileLoad =
    profileLoad.profileHouseId === args.adminHouseId
      ? { profileUserId: args.sourceUserId, profileHouseId: args.sourceHouseId }
      : profileLoad;
  const [homeProfile, applianceProfileRec] = await Promise.all([
    getHomeProfileSimulatedByUserHouse({
      userId: effectiveProfileLoad.profileUserId,
      houseId: effectiveProfileLoad.profileHouseId,
    }),
    getApplianceProfileSimulatedByUserHouse({
      userId: effectiveProfileLoad.profileUserId,
      houseId: effectiveProfileLoad.profileHouseId,
    }),
  ]);
  const applianceProfile = normalizeStoredApplianceProfile((applianceProfileRec?.appliancesJson as any) ?? null);
  const greenButtonTrustedHomeDateKeys = readGreenButtonTrustedHomeDateKeysFromPastMeta(meta);
  await finalizePastDatasetDisplayReadModel({
    dataset,
    weatherHouseId: effectiveProfileLoad.profileHouseId,
    fallbackHouseId: args.adminHouseId,
    scenarioId: args.adminScenarioId,
    homeProfile,
    applianceProfile,
    greenButtonTrustedHomeDateKeys:
      greenButtonTrustedHomeDateKeys.size > 0 ? greenButtonTrustedHomeDateKeys : undefined,
    persistDisplayWeatherToCache: false,
  });
  return dataset;
}

export async function auditPastWeatherCrossSurfaceParity(args: {
  sourceUserId: string;
  sourceHouseId: string;
  sourceScenarioId: string;
  adminDataset: Record<string, unknown>;
  adminUserId: string;
  adminHouseId: string;
  adminScenarioId?: string | null;
  sourceArtifactInputHash?: string | null;
}): Promise<{
  ok: boolean;
  violations: string[];
  sourceArtifactLoaded: boolean;
  sourceArtifactInputHash: string | null;
  inputParity: ReturnType<typeof auditPastWeatherInputParity> | null;
  readModelParity: ReturnType<typeof auditUserAdminPastReadModelParity> | null;
  acceptanceProof: ReturnType<typeof buildPastWeatherCrossSurfaceAcceptanceProof> | null;
}> {
  const { getCachedPastDataset, getLatestCachedPastDatasetByScenario } = await import(
    "@/modules/onePathSim/usageSimulator/pastCache"
  );

  const adminMeta = asRecord(args.adminDataset.meta);
  const requestedSourceHash =
    String(args.sourceArtifactInputHash ?? "").trim() ||
    String(asRecord(asRecord(adminMeta.lockboxInput).sourceContext).intervalFingerprint ?? "").trim() ||
    null;

  let sourceHash = requestedSourceHash;
  let sourceCached = sourceHash
    ? await getCachedPastDataset({
        houseId: args.sourceHouseId,
        scenarioId: args.sourceScenarioId,
        inputHash: sourceHash,
      })
    : null;

  if (!sourceCached) {
    const { resolvePastArtifactIdentity } = await import("@/lib/usage/pastArtifactIdentity");
    const { loadPastSimBuildInputsForRead } = await import("@/lib/usage/loadPastSimBuildInputsForRead");
    const { getHouseAddressForUserHouse } = await import("@/modules/onePathSim/usageSimulator/repo");
    const buildInputs = await loadPastSimBuildInputsForRead({
      userId: args.sourceUserId,
      houseId: args.sourceHouseId,
      scenarioId: args.sourceScenarioId,
    });
    const house = await getHouseAddressForUserHouse({
      userId: args.sourceUserId,
      houseId: args.sourceHouseId,
    });
    if (buildInputs && house) {
      const identity = await resolvePastArtifactIdentity({
        userId: args.sourceUserId,
        requestHouseId: args.sourceHouseId,
        requestHouseEsiid: house.esiid ?? null,
        buildInputs,
      });
      if (identity?.inputHash) {
        sourceHash = identity.inputHash;
        sourceCached = await getCachedPastDataset({
          houseId: args.sourceHouseId,
          scenarioId: args.sourceScenarioId,
          inputHash: sourceHash,
        });
      }
    }
  }

  if (!sourceCached?.datasetJson) {
    sourceCached = await getLatestCachedPastDatasetByScenario({
      houseId: args.sourceHouseId,
      scenarioId: args.sourceScenarioId,
    });
    sourceHash = sourceCached?.inputHash ?? sourceHash;
  }

  if (!sourceCached?.datasetJson) {
    return {
      ok: false,
      violations: [
        `source Past artifact missing for cross-surface weather parity (house=${args.sourceHouseId} hash=${sourceHash ?? "unknown"})`,
      ],
      sourceArtifactLoaded: false,
      sourceArtifactInputHash: sourceHash,
      inputParity: null,
      readModelParity: null,
      acceptanceProof: null,
    };
  }

  const userRawDataset = sourceCached.datasetJson as Record<string, unknown>;
  const userInputDataset = userRawDataset;
  const userDailyFingerprint = buildPastWeatherInputFingerprint({
    dataset: userInputDataset,
    weatherHouseId: args.sourceHouseId,
    forceComputedDisplayTruthRevision: true,
  });
  let adminRawDataset: Record<string, unknown> | null = null;
  let adminDatasetForParity = args.adminDataset;
  if (args.adminScenarioId) {
    const adminCandidates: Array<Awaited<ReturnType<typeof getLatestCachedPastDatasetByScenario>>> = [];
    const seenHashes = new Set<string>();
    const pushCandidate = (row: Awaited<ReturnType<typeof getLatestCachedPastDatasetByScenario>>) => {
      if (!row?.datasetJson) return;
      const hash = String(row.inputHash ?? "").trim();
      if (hash && seenHashes.has(hash)) return;
      if (hash) seenHashes.add(hash);
      adminCandidates.push(row);
    };
    const { loadPastSimBuildInputsForRead } = await import("@/lib/usage/loadPastSimBuildInputsForRead");
    const { resolvePastArtifactIdentity } = await import("@/lib/usage/pastArtifactIdentity");
    const { getHouseAddressForUserHouse } = await import("@/modules/onePathSim/usageSimulator/repo");
    const adminBuildInputs = await loadPastSimBuildInputsForRead({
      userId: args.adminUserId,
      houseId: args.adminHouseId,
      scenarioId: args.adminScenarioId,
    });
    const adminHouse = await getHouseAddressForUserHouse({
      userId: args.adminUserId,
      houseId: args.adminHouseId,
    });
    if (adminBuildInputs && adminHouse) {
      const adminIdentity = await resolvePastArtifactIdentity({
        userId: args.adminUserId,
        requestHouseId: args.adminHouseId,
        requestHouseEsiid: adminHouse.esiid ?? null,
        buildInputs: adminBuildInputs,
      });
      if (adminIdentity?.inputHash) {
        const byIdentity = await getCachedPastDataset({
          houseId: args.adminHouseId,
          scenarioId: args.adminScenarioId,
          inputHash: adminIdentity.inputHash,
        });
        if (byIdentity) pushCandidate(byIdentity);
      }
    }
    const latest = await getLatestCachedPastDatasetByScenario({
      houseId: args.adminHouseId,
      scenarioId: args.adminScenarioId,
    });
    if (latest) pushCandidate(latest);

    const scoreAdminCandidate = (
      row: Awaited<ReturnType<typeof getLatestCachedPastDatasetByScenario>> | null | undefined
    ) => {
      if (!row?.datasetJson) return -1;
      const dataset = row.datasetJson as Record<string, unknown>;
      const lockboxProfileHouseId = resolvePastWeatherHouseIdFromDataset({
        dataset,
        fallbackHouseId: args.adminHouseId,
      });
      const adminDailyFingerprint = buildPastWeatherInputFingerprint({
        dataset,
        weatherHouseId: args.sourceHouseId,
        forceComputedDisplayTruthRevision: true,
      });
      let score = 0;
      if (lockboxProfileHouseId === args.sourceHouseId) score += 4;
      if (adminDailyFingerprint.finalizedDailyRowsHash === userDailyFingerprint.finalizedDailyRowsHash) score += 2;
      if (
        adminDailyFingerprint.usageShapeProfileIdentity === userDailyFingerprint.usageShapeProfileIdentity
      ) {
        score += 1;
      }
      return score;
    };

    const adminCached =
      adminCandidates
        .slice()
        .sort((left, right) => scoreAdminCandidate(right) - scoreAdminCandidate(left))
        .find((row) => scoreAdminCandidate(row) >= 6) ??
      adminCandidates
        .slice()
        .sort((left, right) => scoreAdminCandidate(right) - scoreAdminCandidate(left))
        .find((row) => scoreAdminCandidate(row) >= 2) ??
      adminCandidates.find((row) => Boolean(row?.datasetJson)) ??
      null;

    if (adminCached?.datasetJson) {
      adminRawDataset = adminCached.datasetJson as Record<string, unknown>;
      adminDatasetForParity = await finalizeAdminDatasetForCrossSurfaceParity({
        sourceUserId: args.sourceUserId,
        adminUserId: args.adminUserId,
        adminHouseId: args.adminHouseId,
        sourceHouseId: args.sourceHouseId,
        adminScenarioId: args.adminScenarioId,
        dataset: adminRawDataset,
      });
    }
  }
  const adminInputDataset = adminRawDataset ?? adminDatasetForParity;
  const userDataset = await finalizeSourceDatasetForCrossSurfaceParity({
    sourceUserId: args.sourceUserId,
    sourceHouseId: args.sourceHouseId,
    sourceScenarioId: args.sourceScenarioId,
    dataset: userRawDataset,
  });
  const profileHouseId = resolvePastWeatherHouseIdFromDataset({
    dataset: userRawDataset,
    fallbackHouseId: args.sourceHouseId,
  });
  const profileLoad = resolvePastProfileLoadContext({
    dataset: userDataset,
    requestUserId: args.sourceUserId,
    requestHouseId: args.sourceHouseId,
    sourceUserId: args.sourceUserId,
  });
  const [userHome, userApp] = await Promise.all([
    getHomeProfileSimulatedByUserHouse({
      userId: profileLoad.profileUserId,
      houseId: profileLoad.profileHouseId,
    }),
    getApplianceProfileSimulatedByUserHouse({
      userId: profileLoad.profileUserId,
      houseId: profileLoad.profileHouseId,
    }),
  ]);
  const userCombined = computeSimulatedProfileFingerprint({
    homeProfile: userHome,
    applianceProfileJson: userApp?.appliancesJson ?? null,
  });
  const userApplianceFp = computeSimulatedProfileFingerprint({
    homeProfile: null,
    applianceProfileJson: userApp?.appliancesJson ?? null,
  });

  const inputParity = auditPastWeatherInputParity({
    userDataset: userInputDataset,
    adminDataset: adminInputDataset,
    userWeatherHouseId: profileHouseId,
    adminWeatherHouseId: profileHouseId,
    userProfileFingerprints: {
      homeProfile: userCombined,
      applianceProfile: userApplianceFp,
    },
    adminProfileFingerprints: {
      homeProfile: userCombined,
      applianceProfile: userApplianceFp,
    },
    crossSurfaceWeatherInputsOnly: true,
  });
  const readModelParity = auditUserAdminPastReadModelParity({
    userDataset: userInputDataset,
    adminDataset: adminInputDataset,
    userProfileFingerprints: {
      homeProfile: userCombined,
      applianceProfile: userApplianceFp,
    },
    adminProfileFingerprints: {
      homeProfile: userCombined,
      applianceProfile: userApplianceFp,
    },
    crossSurfaceWeatherInputsOnly: true,
  });
  const userVisible = resolveUserPastVisibleWeatherSensitivityScore({ dataset: userDataset, scenarioName: "Past (Corrected)" });
  const adminVisible = resolveUserPastVisibleWeatherSensitivityScore({
    dataset: adminDatasetForParity,
    scenarioName: "Past (Corrected)",
  });
  const acceptanceProof = buildPastWeatherCrossSurfaceAcceptanceProof({
    inputParity,
    userVisibleBundleC: scoreCardValues(userVisible.score),
    adminVisibleBundleC: scoreCardValues(
      adminVisible.score ?? asRecord(asRecord(adminDatasetForParity.meta).pastDisplayWeatherSensitivityScore)
    ),
  });

  const violations = [...acceptanceProof.violations];
  if (!readModelParity.ok) {
    violations.push(...readModelParity.violations);
  }

  return {
    ok: acceptanceProof.ok && readModelParity.ok,
    violations: Array.from(new Set(violations)),
    sourceArtifactLoaded: true,
    sourceArtifactInputHash: sourceHash,
    inputParity,
    readModelParity,
    acceptanceProof,
  };
}
