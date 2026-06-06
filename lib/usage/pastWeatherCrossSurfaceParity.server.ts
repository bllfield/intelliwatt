import "server-only";

import {
  auditPastWeatherInputParity,
  buildPastWeatherCrossSurfaceAcceptanceProof,
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
  const meta = asRecord(args.dataset.meta);
  const profileLoad = resolvePastProfileLoadContext({
    dataset: args.dataset,
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
  const finalized = await finalizePastDatasetDisplayReadModel({
    dataset: structuredClone(args.dataset),
    weatherHouseId: profileLoad.profileHouseId,
    fallbackHouseId: args.sourceHouseId,
    scenarioId: args.sourceScenarioId,
    homeProfile,
    applianceProfile,
    greenButtonTrustedHomeDateKeys:
      greenButtonTrustedHomeDateKeys.size > 0 ? greenButtonTrustedHomeDateKeys : undefined,
    persistDisplayWeatherToCache: false,
  });
  return asRecord(finalized?.dataset ?? args.dataset);
}

async function finalizeAdminDatasetForCrossSurfaceParity(args: {
  sourceUserId: string;
  adminUserId: string;
  adminHouseId: string;
  sourceHouseId: string;
  adminScenarioId: string;
  dataset: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const meta = asRecord(args.dataset.meta);
  const profileLoad = resolvePastProfileLoadContext({
    dataset: args.dataset,
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
  const finalized = await finalizePastDatasetDisplayReadModel({
    dataset: structuredClone(args.dataset),
    weatherHouseId: effectiveProfileLoad.profileHouseId,
    fallbackHouseId: args.adminHouseId,
    scenarioId: args.adminScenarioId,
    homeProfile,
    applianceProfile,
    greenButtonTrustedHomeDateKeys:
      greenButtonTrustedHomeDateKeys.size > 0 ? greenButtonTrustedHomeDateKeys : undefined,
    persistDisplayWeatherToCache: false,
  });
  return asRecord(finalized?.dataset ?? args.dataset);
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

  const userDataset = await finalizeSourceDatasetForCrossSurfaceParity({
    sourceUserId: args.sourceUserId,
    sourceHouseId: args.sourceHouseId,
    sourceScenarioId: args.sourceScenarioId,
    dataset: sourceCached.datasetJson as Record<string, unknown>,
  });
  const profileHouseId = resolvePastWeatherHouseIdFromDataset({
    dataset: userDataset,
    fallbackHouseId: args.sourceHouseId,
  });
  let adminRawDataset: Record<string, unknown> | null = null;
  let adminDatasetForParity = args.adminDataset;
  if (args.adminScenarioId) {
    const adminCandidates: Array<Awaited<ReturnType<typeof getLatestCachedPastDatasetByScenario>>> = [];
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
        if (byIdentity) adminCandidates.push(byIdentity);
      }
    }
    const latest = await getLatestCachedPastDatasetByScenario({
      houseId: args.adminHouseId,
      scenarioId: args.adminScenarioId,
    });
    if (latest) adminCandidates.push(latest);

    const adminCached =
      adminCandidates.find((row) => {
        if (!row?.datasetJson) return false;
        const lockboxProfileHouseId = resolvePastWeatherHouseIdFromDataset({
          dataset: row.datasetJson as Record<string, unknown>,
          fallbackHouseId: args.adminHouseId,
        });
        return lockboxProfileHouseId === args.sourceHouseId;
      }) ??
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
  const userRawDataset = sourceCached.datasetJson as Record<string, unknown>;
  const userInputDataset = userRawDataset;
  const adminInputDataset = adminRawDataset ?? adminDatasetForParity;
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
