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
  readPastDisplayWeatherFinalizeOutcomeFromMeta,
  type PastDisplayWeatherFinalizeOutcome,
} from "@/lib/usage/pastDisplayWeatherFinalizeGuard";
import { resolveStaleIncompleteMeterSlotCompleteDateKeys } from "@/lib/usage/pastSimStaleIncompleteMeter";
import {
  resolvePastProfileLoadContext,
  resolvePastWeatherHouseIdFromDataset,
  resolvePreferredActualSourceFromDataset,
} from "@/lib/usage/pastVisibleWeatherReadDiagnostics";
import { readGreenButtonTrustedHomeDateKeysFromPastMeta } from "@/lib/usage/greenButtonPastTrustedPool";
import { resolveUserPastVisibleWeatherSensitivityScore } from "@/lib/usage/userPastVisibleWeather";
import { scoreCardValues } from "@/lib/usage/weatherScoringOwnership";
import { getHomeProfileSimulatedByUserHouse } from "@/modules/homeProfile/repo";
import { getApplianceProfileSimulatedByUserHouse } from "@/modules/applianceProfile/repo";
import { normalizeStoredApplianceProfile } from "@/modules/applianceProfile/validation";
import { resolvePastCachedDatasetForUserRead } from "@/lib/usage/resolvePastCachedDatasetForUserRead";
import { resolveOnePathUpstreamUsageTruthForSimulation } from "@/modules/onePathSim/runtime";
import { getHouseAddressForUserHouse } from "@/modules/onePathSim/usageSimulator/repo";
import type { CachedPastDataset } from "@/modules/onePathSim/usageSimulator/pastCache";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

async function finalizeSourceDatasetForCrossSurfaceParity(args: {
  sourceUserId: string;
  sourceHouseId: string;
  sourceScenarioId: string;
  dataset: Record<string, unknown>;
}): Promise<{ dataset: Record<string, unknown>; finalizeOutcome: PastDisplayWeatherFinalizeOutcome | null }> {
  const dataset = structuredClone(args.dataset);
  const meta = asRecord(dataset.meta);
  const profileLoad = resolvePastProfileLoadContext({
    dataset,
    requestUserId: args.sourceUserId,
    requestHouseId: args.sourceHouseId,
    sourceUserId: args.sourceUserId,
  });
  const preferredActualSource = resolvePreferredActualSourceFromDataset(dataset);
  const sourceHouse = await getHouseAddressForUserHouse({
    userId: args.sourceUserId,
    houseId: args.sourceHouseId,
  });
  const [homeProfile, applianceProfileRec, sageTruth, smtSlotCompleteDateKeys] = await Promise.all([
    getHomeProfileSimulatedByUserHouse({
      userId: profileLoad.profileUserId,
      houseId: profileLoad.profileHouseId,
    }),
    getApplianceProfileSimulatedByUserHouse({
      userId: profileLoad.profileUserId,
      houseId: profileLoad.profileHouseId,
    }),
    resolveOnePathUpstreamUsageTruthForSimulation({
      userId: args.sourceUserId,
      houseId: args.sourceHouseId,
      actualContextHouseId: profileLoad.profileHouseId,
      smtSourceEsiid: sourceHouse?.esiid ?? null,
      seedIfMissing: false,
      preferredActualSource: preferredActualSource ?? null,
      greenButtonFullYearIntervalsForDisplay: preferredActualSource === "GREEN_BUTTON",
    }).catch(() => null),
    resolveStaleIncompleteMeterSlotCompleteDateKeys({
      esiid: sourceHouse?.esiid ?? null,
      meta,
    }),
  ]);
  const applianceProfile = normalizeStoredApplianceProfile((applianceProfileRec?.appliancesJson as any) ?? null);
  const greenButtonTrustedHomeDateKeys = readGreenButtonTrustedHomeDateKeysFromPastMeta(meta);
  const finalizeOutcome = await finalizePastDatasetDisplayReadModel({
    dataset,
    sageActualDataset: sageTruth?.dataset ?? null,
    smtSlotCompleteDateKeys,
    weatherHouseId: profileLoad.profileHouseId,
    fallbackHouseId: args.sourceHouseId,
    scenarioId: args.sourceScenarioId,
    homeProfile,
    applianceProfile,
    greenButtonTrustedHomeDateKeys:
      greenButtonTrustedHomeDateKeys.size > 0 ? greenButtonTrustedHomeDateKeys : undefined,
    persistDisplayWeatherToCache: false,
  });
  return { dataset, finalizeOutcome };
}

async function finalizeAdminDatasetForCrossSurfaceParity(args: {
  sourceUserId: string;
  adminUserId: string;
  adminHouseId: string;
  sourceHouseId: string;
  adminScenarioId: string;
  dataset: Record<string, unknown>;
}): Promise<{ dataset: Record<string, unknown>; finalizeOutcome: PastDisplayWeatherFinalizeOutcome | null }> {
  const dataset = structuredClone(args.dataset);
  const meta = asRecord(dataset.meta);
  const profileLoad = resolvePastProfileLoadContext({
    dataset,
    requestUserId: args.adminUserId,
    requestHouseId: args.adminHouseId,
    sourceUserId: args.sourceUserId,
  });
  const effectiveProfileLoad = { profileUserId: args.sourceUserId, profileHouseId: args.sourceHouseId };
  const preferredActualSource = resolvePreferredActualSourceFromDataset(dataset);
  const sourceHouse = await getHouseAddressForUserHouse({
    userId: args.sourceUserId,
    houseId: args.sourceHouseId,
  });
  const [homeProfile, applianceProfileRec, sageTruth, smtSlotCompleteDateKeys] = await Promise.all([
    getHomeProfileSimulatedByUserHouse({
      userId: effectiveProfileLoad.profileUserId,
      houseId: effectiveProfileLoad.profileHouseId,
    }),
    getApplianceProfileSimulatedByUserHouse({
      userId: effectiveProfileLoad.profileUserId,
      houseId: effectiveProfileLoad.profileHouseId,
    }),
    resolveOnePathUpstreamUsageTruthForSimulation({
      userId: args.sourceUserId,
      houseId: args.sourceHouseId,
      actualContextHouseId: effectiveProfileLoad.profileHouseId,
      smtSourceEsiid: sourceHouse?.esiid ?? null,
      seedIfMissing: false,
      preferredActualSource: preferredActualSource ?? null,
      greenButtonFullYearIntervalsForDisplay: preferredActualSource === "GREEN_BUTTON",
    }).catch(() => null),
    resolveStaleIncompleteMeterSlotCompleteDateKeys({
      esiid: sourceHouse?.esiid ?? null,
      meta,
    }),
  ]);
  const applianceProfile = normalizeStoredApplianceProfile((applianceProfileRec?.appliancesJson as any) ?? null);
  const greenButtonTrustedHomeDateKeys = readGreenButtonTrustedHomeDateKeysFromPastMeta(meta);
  const finalizeOutcome = await finalizePastDatasetDisplayReadModel({
    dataset,
    sageActualDataset: sageTruth?.dataset ?? null,
    smtSlotCompleteDateKeys,
    weatherHouseId: effectiveProfileLoad.profileHouseId,
    fallbackHouseId: args.adminHouseId,
    scenarioId: args.adminScenarioId,
    homeProfile,
    applianceProfile,
    greenButtonTrustedHomeDateKeys:
      greenButtonTrustedHomeDateKeys.size > 0 ? greenButtonTrustedHomeDateKeys : undefined,
    persistDisplayWeatherToCache: false,
  });
  return { dataset, finalizeOutcome };
}

export type PastWeatherCrossSurfaceArtifactSelection = {
  sourceHouseId: string;
  labHouseId: string;
  userPastScenarioId: string;
  adminPastScenarioId: string | null;
  userArtifactInputHash: string | null;
  adminArtifactInputHash: string | null;
  userArtifactUpdatedAt: string | null;
  adminArtifactUpdatedAt: string | null;
  userDisplayTruthRevision: string | null;
  adminDisplayTruthRevision: string | null;
  userFinalizedDailyRowsHash: string | null;
  adminFinalizedDailyRowsHash: string | null;
  userBundleC: ReturnType<typeof scoreCardValues>;
  adminBundleC: ReturnType<typeof scoreCardValues>;
  userVisibleBundleC: ReturnType<typeof scoreCardValues> | null;
  adminVisibleBundleC: ReturnType<typeof scoreCardValues> | null;
  userReadPath: string;
  adminReadPath: string;
};

/** Dual-run cross-surface Past weather acceptance — see `PAST_CROSS_SURFACE_RESOLVED_SIM_FINGERPRINT_RULE`. */
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
  sourceReadPath: string;
  adminReadPath: string | null;
  artifactSelection: PastWeatherCrossSurfaceArtifactSelection | null;
  inputParity: ReturnType<typeof auditPastWeatherInputParity> | null;
  readModelParity: ReturnType<typeof auditUserAdminPastReadModelParity> | null;
  acceptanceProof: ReturnType<typeof buildPastWeatherCrossSurfaceAcceptanceProof> | null;
}> {
  const { getCachedPastDataset, getLatestCachedPastDatasetByScenario } = await import(
    "@/modules/onePathSim/usageSimulator/pastCache"
  );
  const { resolvePastArtifactIdentity } = await import("@/lib/usage/pastArtifactIdentity");
  const { loadPastSimBuildInputsForRead } = await import("@/lib/usage/loadPastSimBuildInputsForRead");

  const adminMeta = asRecord(args.adminDataset.meta);
  const requestedSourceHash =
    String(args.sourceArtifactInputHash ?? "").trim() ||
    String(asRecord(asRecord(adminMeta.lockboxInput).sourceContext).intervalFingerprint ?? "").trim() ||
    null;

  const sourceResolved = await resolvePastCachedDatasetForUserRead({
    userId: args.sourceUserId,
    houseId: args.sourceHouseId,
    scenarioId: args.sourceScenarioId,
    requestedInputHash: requestedSourceHash,
  });
  const sourceCached = sourceResolved.cached;
  const sourceHash = sourceResolved.resolvedInputHash;
  const sourceReadPath = sourceResolved.readPath;

  if (!sourceCached?.datasetJson || sourceReadPath === "artifact_missing") {
    return {
      ok: false,
      violations: [
        `source Past artifact missing for cross-surface weather parity (house=${args.sourceHouseId} identityHash=${sourceResolved.identityInputHash ?? "unknown"} resolvedHash=${sourceHash ?? "unknown"} readPath=${sourceReadPath})`,
      ],
      sourceArtifactLoaded: false,
      sourceArtifactInputHash: sourceHash,
      sourceReadPath,
      adminReadPath: null,
      artifactSelection: null,
      inputParity: null,
      readModelParity: null,
      acceptanceProof: null,
    };
  }

  const userRawDataset = sourceCached.datasetJson as Record<string, unknown>;
  const userFinalize = await finalizeSourceDatasetForCrossSurfaceParity({
    sourceUserId: args.sourceUserId,
    sourceHouseId: args.sourceHouseId,
    sourceScenarioId: args.sourceScenarioId,
    dataset: userRawDataset,
  });
  const userDataset = userFinalize.dataset;
  const profileHouseId = resolvePastWeatherHouseIdFromDataset({
    dataset: userDataset,
    fallbackHouseId: args.sourceHouseId,
  });
  const userDailyFingerprint = buildPastWeatherInputFingerprint({
    dataset: userDataset,
    weatherHouseId: profileHouseId,
    forceComputedDisplayTruthRevision: true,
  });

  let adminCached: CachedPastDataset | null = null;
  let adminDatasetForParity = args.adminDataset;
  let adminFinalizeOutcome: PastDisplayWeatherFinalizeOutcome | null = null;
  let adminReadPath: string | null = null;
  if (args.adminScenarioId) {
    const adminResolved = await resolvePastCachedDatasetForUserRead({
      userId: args.adminUserId,
      houseId: args.adminHouseId,
      scenarioId: args.adminScenarioId,
    });
    if (adminResolved.cached?.datasetJson && adminResolved.readPath !== "artifact_missing") {
      const resolvedProfileHouseId = resolvePastWeatherHouseIdFromDataset({
        dataset: adminResolved.cached.datasetJson as Record<string, unknown>,
        fallbackHouseId: args.adminHouseId,
      });
      if (resolvedProfileHouseId === args.sourceHouseId) {
        adminCached = adminResolved.cached;
        adminReadPath = adminResolved.readPath;
      }
    }

    const adminCandidates: CachedPastDataset[] = [];
    const seenHashes = new Set<string>();
    const pushCandidate = (row: CachedPastDataset | null | undefined) => {
      if (!row?.datasetJson) return;
      const hash = String(row.inputHash ?? "").trim();
      if (hash && seenHashes.has(hash)) return;
      if (hash) seenHashes.add(hash);
      adminCandidates.push(row);
    };
    if (adminCached) pushCandidate(adminCached);

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

    const scoreAdminCandidate = (row: CachedPastDataset | null | undefined) => {
      if (!row?.datasetJson) return -1;
      const dataset = row.datasetJson as Record<string, unknown>;
      const lockboxProfileHouseId = resolvePastWeatherHouseIdFromDataset({
        dataset,
        fallbackHouseId: args.adminHouseId,
      });
      const adminDailyFingerprint = buildPastWeatherInputFingerprint({
        dataset,
        weatherHouseId: profileHouseId,
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

    if (!adminCached?.datasetJson) {
      adminCached =
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
      adminReadPath = adminCached ? "admin_scored_candidate" : adminReadPath;
    }

    if (adminCached?.datasetJson) {
      const adminFinalize = await finalizeAdminDatasetForCrossSurfaceParity({
        sourceUserId: args.sourceUserId,
        adminUserId: args.adminUserId,
        adminHouseId: args.adminHouseId,
        sourceHouseId: args.sourceHouseId,
        adminScenarioId: args.adminScenarioId,
        dataset: adminCached.datasetJson as Record<string, unknown>,
      });
      adminDatasetForParity = adminFinalize.dataset;
      adminFinalizeOutcome = adminFinalize.finalizeOutcome;
      adminReadPath = adminFinalizeOutcome?.weatherReadPath ?? "admin_identity_or_latest_cache";
    }
  }

  const userInputDataset = userDataset;
  const adminInputDataset = adminDatasetForParity;
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
  const userVisible = resolveUserPastVisibleWeatherSensitivityScore({ dataset: userDataset, scenarioName: "Past (Corrected)" });
  const adminVisible = resolveUserPastVisibleWeatherSensitivityScore({
    dataset: adminDatasetForParity,
    scenarioName: "Past (Corrected)",
  });
  const userVisibleBundleC = scoreCardValues(userVisible.score);
  const adminVisibleBundleC = scoreCardValues(
    adminVisible.score ?? asRecord(asRecord(adminDatasetForParity.meta).pastDisplayWeatherSensitivityScore)
  );
  const acceptanceProof = buildPastWeatherCrossSurfaceAcceptanceProof({
    inputParity,
    userVisibleBundleC,
    adminVisibleBundleC,
  });

  const violations = [...acceptanceProof.violations];
  if (!readModelParity.ok) {
    violations.push(...readModelParity.violations);
  }

  const userFinalizeMeta = asRecord(userDataset.meta);
  const adminFinalizeMeta = asRecord(adminDatasetForParity.meta);
  const userFinalizeFromMeta = readPastDisplayWeatherFinalizeOutcomeFromMeta(userFinalizeMeta);
  const adminFinalizeFromMeta = readPastDisplayWeatherFinalizeOutcomeFromMeta(adminFinalizeMeta);
  const userFingerprint = buildPastWeatherInputFingerprint({
    dataset: userDataset,
    weatherHouseId: profileHouseId,
    forceComputedDisplayTruthRevision: true,
  });
  const adminFingerprint = buildPastWeatherInputFingerprint({
    dataset: adminDatasetForParity,
    weatherHouseId: profileHouseId,
    forceComputedDisplayTruthRevision: true,
  });

  return {
    ok: acceptanceProof.ok && readModelParity.ok,
    violations: Array.from(new Set(violations)),
    sourceArtifactLoaded: true,
    sourceArtifactInputHash: sourceHash,
    sourceReadPath: userFinalize.finalizeOutcome?.weatherReadPath ?? userFinalizeFromMeta.weatherReadPath ?? sourceReadPath,
    adminReadPath,
    artifactSelection: {
      sourceHouseId: args.sourceHouseId,
      labHouseId: args.adminHouseId,
      userPastScenarioId: args.sourceScenarioId,
      adminPastScenarioId: args.adminScenarioId ?? null,
      userArtifactInputHash: sourceHash,
      adminArtifactInputHash: adminCached?.inputHash ?? null,
      userArtifactUpdatedAt: sourceCached.updatedAt ? new Date(sourceCached.updatedAt).toISOString() : null,
      adminArtifactUpdatedAt: adminCached?.updatedAt ? new Date(adminCached.updatedAt).toISOString() : null,
      userDisplayTruthRevision:
        userFinalize.finalizeOutcome?.displayTruthRevision ?? userFingerprint.displayTruthRevision,
      adminDisplayTruthRevision:
        adminFinalizeOutcome?.displayTruthRevision ?? adminFingerprint.displayTruthRevision,
      userFinalizedDailyRowsHash: userFingerprint.finalizedDailyRowsHash,
      adminFinalizedDailyRowsHash: adminFingerprint.finalizedDailyRowsHash,
      userBundleC: userFingerprint.bundleC,
      adminBundleC: adminFingerprint.bundleC,
      userVisibleBundleC,
      adminVisibleBundleC,
      userReadPath:
        userFinalize.finalizeOutcome?.weatherReadPath ?? userFinalizeFromMeta.weatherReadPath ?? sourceReadPath,
      adminReadPath: adminReadPath ?? adminFinalizeFromMeta.weatherReadPath ?? "admin_not_loaded",
    },
    inputParity,
    readModelParity,
    acceptanceProof,
  };
}
