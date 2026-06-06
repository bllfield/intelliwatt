import "server-only";

import {
  auditPastWeatherInputParity,
  computeSimulatedProfileFingerprint,
} from "@/lib/usage/pastWeatherInputParity";
import { auditUserAdminPastReadModelParity } from "@/lib/usage/intervalReadModelInvariants";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export async function auditPastWeatherCrossSurfaceParity(args: {
  sourceUserId: string;
  sourceHouseId: string;
  sourceScenarioId: string;
  adminDataset: Record<string, unknown>;
  adminUserId: string;
  adminHouseId: string;
  sourceArtifactInputHash?: string | null;
}): Promise<{
  ok: boolean;
  violations: string[];
  sourceArtifactLoaded: boolean;
  sourceArtifactInputHash: string | null;
  inputParity: ReturnType<typeof auditPastWeatherInputParity> | null;
  readModelParity: ReturnType<typeof auditUserAdminPastReadModelParity> | null;
}> {
  const { getCachedPastDataset } = await import("@/modules/onePathSim/usageSimulator/pastCache");
  const { getHomeProfileSimulatedByUserHouse } = await import("@/modules/homeProfile/repo");
  const { getApplianceProfileSimulatedByUserHouse } = await import("@/modules/applianceProfile/repo");

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
    return {
      ok: false,
      violations: [
        `source Past artifact missing for cross-surface weather parity (house=${args.sourceHouseId} hash=${sourceHash ?? "unknown"})`,
      ],
      sourceArtifactLoaded: false,
      sourceArtifactInputHash: sourceHash,
      inputParity: null,
      readModelParity: null,
    };
  }

  const userDataset = sourceCached.datasetJson as Record<string, unknown>;
  const [userHome, userApp, adminHome, adminApp] = await Promise.all([
    getHomeProfileSimulatedByUserHouse({ userId: args.sourceUserId, houseId: args.sourceHouseId }),
    getApplianceProfileSimulatedByUserHouse({ userId: args.sourceUserId, houseId: args.sourceHouseId }),
    getHomeProfileSimulatedByUserHouse({ userId: args.adminUserId, houseId: args.adminHouseId }),
    getApplianceProfileSimulatedByUserHouse({ userId: args.adminUserId, houseId: args.adminHouseId }),
  ]);
  const userCombined = computeSimulatedProfileFingerprint({
    homeProfile: userHome,
    applianceProfileJson: userApp?.appliancesJson ?? null,
  });
  const adminCombined = computeSimulatedProfileFingerprint({
    homeProfile: adminHome,
    applianceProfileJson: adminApp?.appliancesJson ?? null,
  });
  const userApplianceFp = computeSimulatedProfileFingerprint({
    homeProfile: null,
    applianceProfileJson: userApp?.appliancesJson ?? null,
  });
  const adminApplianceFp = computeSimulatedProfileFingerprint({
    homeProfile: null,
    applianceProfileJson: adminApp?.appliancesJson ?? null,
  });

  const inputParity = auditPastWeatherInputParity({
    userDataset,
    adminDataset: args.adminDataset,
    userProfileFingerprints: {
      homeProfile: userCombined,
      applianceProfile: userApplianceFp,
    },
    adminProfileFingerprints: {
      homeProfile: adminCombined,
      applianceProfile: adminApplianceFp,
    },
  });
  const readModelParity = auditUserAdminPastReadModelParity({
    userDataset,
    adminDataset: args.adminDataset,
    userProfileFingerprints: {
      homeProfile: userCombined,
      applianceProfile: userApplianceFp,
    },
    adminProfileFingerprints: {
      homeProfile: adminCombined,
      applianceProfile: adminApplianceFp,
    },
  });

  const violations = [...inputParity.violations];
  if (!readModelParity.ok) {
    violations.push(...readModelParity.violations);
  }

  return {
    ok: inputParity.ok && readModelParity.ok,
    violations: Array.from(new Set(violations)),
    sourceArtifactLoaded: true,
    sourceArtifactInputHash: sourceHash,
    inputParity,
    readModelParity,
  };
}
