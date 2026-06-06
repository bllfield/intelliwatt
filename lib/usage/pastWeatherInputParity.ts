import { createHash } from "crypto";

import {
  computePastDisplayTruthRevision,
  PAST_DISPLAY_WEATHER_FINALIZE_VERSION,
} from "@/lib/usage/pastDisplayWeatherFinalizeGuard";
import { readGreenButtonTrustedHomeDateKeysFromPastMeta } from "@/lib/usage/greenButtonPastTrustedPool";
import { auditUserAdminPastReadModelParity } from "@/lib/usage/intervalReadModelInvariants";
import {
  PAST_DISPLAY_WEATHER_META_FIELD,
  scoreCardValues,
  WEATHER_SCORER_MODULE,
} from "@/lib/usage/weatherScoringOwnership";
import {
  WEATHER_CALCULATION_VERSION,
  WEATHER_SCORE_VERSION,
} from "@/modules/weatherSensitivity/shared";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asDateKey(value: unknown): string | null {
  const text = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("base64url").slice(0, 22);
}

function readArtifactInputHash(meta: Record<string, unknown>): string | null {
  return (
    String(meta.artifactInputHash ?? meta.inputHash ?? meta.fullChainHash ?? "").trim() || null
  );
}

function hashFinalizedDailyRows(dataset: Record<string, unknown>): string {
  const daily = Array.isArray(dataset.daily)
    ? (dataset.daily as Array<{ date?: unknown; kwh?: unknown; source?: unknown; sourceDetail?: unknown }>)
    : [];
  const fingerprint = daily
    .map((row) => {
      const date = String(row.date ?? "").slice(0, 10);
      const kwh = round2(Number(row.kwh) || 0);
      const source = String(row.source ?? "").trim().toUpperCase();
      const sourceDetail = String(row.sourceDetail ?? row.source ?? "").trim().toUpperCase();
      return `${date}|${kwh}|${source}|${sourceDetail}`;
    })
    .sort()
    .join(";");
  return stableHash(fingerprint);
}

function hashDailyWeather(dataset: Record<string, unknown>, meta: Record<string, unknown>): string {
  const dailyWeather = asRecord(dataset.dailyWeather ?? meta.dailyWeatherByDateKey);
  const canonical = Object.keys(dailyWeather)
    .sort()
    .map((dateKey) => {
      const row = asRecord(dailyWeather[dateKey]);
      return `${dateKey}|${round2(Number(row.meanTempF) || 0)}|${round2(Number(row.hdd) || 0)}|${round2(Number(row.cdd) || 0)}`;
    })
    .join(";");
  return stableHash(canonical);
}

function readValidationKeys(meta: Record<string, unknown>): string[] {
  const lockbox = asRecord(meta.lockboxInput);
  const validationKeys = asRecord(lockbox.validationKeys);
  const fromLockbox = Array.isArray(validationKeys.localDateKeys)
    ? validationKeys.localDateKeys.map((value) => asDateKey(value)).filter((value): value is string => Boolean(value))
    : [];
  if (fromLockbox.length > 0) return fromLockbox.sort();
  const fromMeta = Array.isArray(meta.validationSelectedDateKeys)
    ? meta.validationSelectedDateKeys.map((value) => asDateKey(value)).filter((value): value is string => Boolean(value))
    : [];
  return fromMeta.sort();
}

function readTravelVacantFingerprint(meta: Record<string, unknown>): string {
  const lockbox = asRecord(meta.lockboxInput);
  const travelRanges = Array.isArray(lockbox.travelRanges?.ranges)
    ? (lockbox.travelRanges.ranges as Array<{ startDate?: unknown; endDate?: unknown }>)
    : Array.isArray(lockbox.travelRanges)
      ? (lockbox.travelRanges as Array<{ startDate?: unknown; endDate?: unknown }>)
      : [];
  const canonical = travelRanges
    .map((range) => `${asDateKey(range.startDate) ?? ""}:${asDateKey(range.endDate) ?? ""}`)
    .sort()
    .join(";");
  return stableHash(canonical);
}

export type PastWeatherInputFingerprint = {
  artifactInputHash: string | null;
  fullChainHash: string | null;
  displayTruthRevision: string | null;
  finalizedDailyRowsHash: string;
  dailyWeatherHash: string;
  greenButtonTrustedDateKeys: string;
  profileHouseId: string | null;
  usageShapeProfileIdentity: string | null;
  resolvedSimFingerprint: string | null;
  intervalDataFingerprint: string | null;
  usageFingerprint: string | null;
  weatherIdentity: string | null;
  validationKeys: string[];
  travelVacantFingerprint: string;
  simulationVariableVersion: string | null;
  simVersion: string | null;
  scorerVersion: string;
  calculationVersion: string;
  finalizeVersion: string | null;
  bundleC: ReturnType<typeof scoreCardValues>;
  bundleB: ReturnType<typeof scoreCardValues>;
  netKwhDailySum: number | null;
};

export function buildPastWeatherInputFingerprint(args: {
  dataset: Record<string, unknown>;
  weatherHouseId?: string | null;
  profileFingerprint?: string | null;
  applianceProfileFingerprint?: string | null;
}): PastWeatherInputFingerprint {
  const meta = asRecord(args.dataset.meta);
  const lockbox = asRecord(meta.lockboxInput);
  const profileContext = asRecord(lockbox.profileContext);
  const sourceContext = asRecord(lockbox.sourceContext);
  const lockboxRunContext = asRecord(meta.lockboxRunContext);
  const weatherHouseId =
    String(args.weatherHouseId ?? meta.actualContextHouseId ?? lockboxRunContext.actualContextHouseId ?? "").trim() ||
    null;
  const daily = Array.isArray(args.dataset.daily) ? (args.dataset.daily as Array<{ kwh?: unknown }>) : [];
  const netKwhDailySum = daily.length > 0 ? round2(daily.reduce((sum, row) => sum + (Number(row.kwh) || 0), 0)) : null;

  return {
    artifactInputHash: readArtifactInputHash(meta),
    fullChainHash: String(meta.fullChainHash ?? "").trim() || null,
    displayTruthRevision:
      String(meta.pastDisplayWeatherDisplayTruthRevision ?? "").trim() ||
      computePastDisplayTruthRevision({ dataset: args.dataset, weatherHouseId }),
    finalizedDailyRowsHash: hashFinalizedDailyRows(args.dataset),
    dailyWeatherHash: hashDailyWeather(args.dataset, meta),
    greenButtonTrustedDateKeys: Array.from(readGreenButtonTrustedHomeDateKeysFromPastMeta(meta)).sort().join(","),
    profileHouseId:
      String(profileContext.profileHouseId ?? sourceContext.sourceHouseId ?? weatherHouseId ?? "").trim() || null,
    usageShapeProfileIdentity:
      String(profileContext.usageShapeProfileIdentity ?? meta.intervalUsageFingerprintIdentity ?? "").trim() || null,
    resolvedSimFingerprint: stableHash(meta.resolvedSimFingerprint ?? lockbox.resolvedSimFingerprint ?? null),
    intervalDataFingerprint:
      String(
        sourceContext.intervalFingerprint ??
          meta.intervalDataFingerprint ??
          lockbox.intervalFingerprint ??
          ""
      ).trim() || null,
    usageFingerprint:
      String(meta.usageFingerprint ?? sourceContext.usageFingerprint ?? lockbox.usageFingerprint ?? "").trim() ||
      null,
    weatherIdentity: String(sourceContext.weatherIdentity ?? meta.weatherIdentity ?? "").trim() || null,
    validationKeys: readValidationKeys(meta),
    travelVacantFingerprint: readTravelVacantFingerprint(meta),
    simulationVariableVersion:
      String(meta.simulationVariableVersion ?? meta.simulationVariablePolicyVersion ?? "").trim() || null,
    simVersion: String(meta.simVersion ?? meta.derivationVersion ?? "").trim() || null,
    scorerVersion: WEATHER_SCORE_VERSION,
    calculationVersion: WEATHER_CALCULATION_VERSION,
    finalizeVersion: String(meta.pastDisplayWeatherFinalizeVersion ?? PAST_DISPLAY_WEATHER_FINALIZE_VERSION).trim(),
    bundleC: scoreCardValues(asRecord(meta.pastDisplayWeatherSensitivityScore)),
    bundleB: scoreCardValues(asRecord(meta.weatherSensitivityScore)),
    netKwhDailySum,
  };
}

export type PastWeatherInputParityResult = {
  ok: boolean;
  violations: string[];
  user: PastWeatherInputFingerprint;
  admin: PastWeatherInputFingerprint;
  profileFingerprints: {
    userHomeProfile: string | null;
    userApplianceProfile: string | null;
    adminHomeProfile: string | null;
    adminApplianceProfile: string | null;
    homeProfilesMatch: boolean | null;
    applianceProfilesMatch: boolean | null;
  };
};

function compareField(
  violations: string[],
  label: string,
  left: unknown,
  right: unknown,
  opts?: { hardFail?: boolean }
) {
  if (left == null && right == null) return;
  if (JSON.stringify(left) !== JSON.stringify(right)) {
    violations.push(`${label}: user=${JSON.stringify(left)} admin=${JSON.stringify(right)}`);
    if (opts?.hardFail !== false) {
      // caller treats all violations as hard fail
    }
  }
}

export function auditPastWeatherInputParity(args: {
  userDataset: Record<string, unknown>;
  adminDataset: Record<string, unknown>;
  userWeatherHouseId?: string | null;
  adminWeatherHouseId?: string | null;
  userProfileFingerprints?: { homeProfile?: string | null; applianceProfile?: string | null };
  adminProfileFingerprints?: { homeProfile?: string | null; applianceProfile?: string | null };
}): PastWeatherInputParityResult {
  const user = buildPastWeatherInputFingerprint({
    dataset: args.userDataset,
    weatherHouseId: args.userWeatherHouseId,
    profileFingerprint: args.userProfileFingerprints?.homeProfile ?? null,
    applianceProfileFingerprint: args.userProfileFingerprints?.applianceProfile ?? null,
  });
  const admin = buildPastWeatherInputFingerprint({
    dataset: args.adminDataset,
    weatherHouseId: args.adminWeatherHouseId,
    profileFingerprint: args.adminProfileFingerprints?.homeProfile ?? null,
    applianceProfileFingerprint: args.adminProfileFingerprints?.applianceProfile ?? null,
  });
  const violations: string[] = [];

  compareField(violations, "artifactInputHash", user.artifactInputHash, admin.artifactInputHash);
  compareField(violations, "displayTruthRevision", user.displayTruthRevision, admin.displayTruthRevision);
  compareField(violations, "finalizedDailyRowsHash", user.finalizedDailyRowsHash, admin.finalizedDailyRowsHash);
  compareField(violations, "dailyWeatherHash", user.dailyWeatherHash, admin.dailyWeatherHash);
  compareField(violations, "usageShapeProfileIdentity", user.usageShapeProfileIdentity, admin.usageShapeProfileIdentity);
  compareField(violations, "resolvedSimFingerprint", user.resolvedSimFingerprint, admin.resolvedSimFingerprint);
  compareField(violations, "intervalDataFingerprint", user.intervalDataFingerprint, admin.intervalDataFingerprint);
  compareField(violations, "usageFingerprint", user.usageFingerprint, admin.usageFingerprint);
  compareField(violations, "weatherIdentity", user.weatherIdentity, admin.weatherIdentity);
  compareField(violations, "validationKeys", user.validationKeys, admin.validationKeys);
  compareField(violations, "travelVacantFingerprint", user.travelVacantFingerprint, admin.travelVacantFingerprint);
  compareField(violations, "simulationVariableVersion", user.simulationVariableVersion, admin.simulationVariableVersion);
  compareField(violations, "simVersion", user.simVersion, admin.simVersion);
  compareField(violations, "scorerVersion", user.scorerVersion, admin.scorerVersion);
  compareField(violations, "calculationVersion", user.calculationVersion, admin.calculationVersion);
  compareField(violations, "finalizeVersion", user.finalizeVersion, admin.finalizeVersion);
  compareField(violations, "greenButtonTrustedDateKeys", user.greenButtonTrustedDateKeys, admin.greenButtonTrustedDateKeys);

  const homeProfilesMatch =
    args.userProfileFingerprints?.homeProfile != null && args.adminProfileFingerprints?.homeProfile != null
      ? args.userProfileFingerprints.homeProfile === args.adminProfileFingerprints.homeProfile
      : null;
  const applianceProfilesMatch =
    args.userProfileFingerprints?.applianceProfile != null && args.adminProfileFingerprints?.applianceProfile != null
      ? args.userProfileFingerprints.applianceProfile === args.adminProfileFingerprints.applianceProfile
      : null;

  if (homeProfilesMatch === false) {
    violations.push(
      `homeProfileFingerprint: user=${args.userProfileFingerprints?.homeProfile} admin=${args.adminProfileFingerprints?.homeProfile}`
    );
  }
  if (applianceProfilesMatch === false) {
    violations.push(
      `applianceProfileFingerprint: user=${args.userProfileFingerprints?.applianceProfile} admin=${args.adminProfileFingerprints?.applianceProfile}`
    );
  }

  if (
    user.finalizedDailyRowsHash !== admin.finalizedDailyRowsHash &&
    user.netKwhDailySum != null &&
    admin.netKwhDailySum != null &&
    Math.abs(user.netKwhDailySum - admin.netKwhDailySum) <= 0.1
  ) {
    violations.push(
      `dailyRows differ with matching totals (${user.netKwhDailySum} kWh) — weather parity blocked`
    );
  }

  const bundleCMatch =
    user.bundleC.weatherEfficiency === admin.bundleC.weatherEfficiency &&
    user.bundleC.cooling === admin.bundleC.cooling &&
    user.bundleC.heating === admin.bundleC.heating &&
    user.bundleC.confidence === admin.bundleC.confidence;
  if (!bundleCMatch && violations.length === 0) {
    violations.push(
      `${PAST_DISPLAY_WEATHER_META_FIELD}: user=${JSON.stringify(user.bundleC)} admin=${JSON.stringify(admin.bundleC)}`
    );
  } else if (!bundleCMatch) {
    violations.push(
      `${PAST_DISPLAY_WEATHER_META_FIELD} mismatch likely caused by input divergence (${WEATHER_SCORER_MODULE})`
    );
  }

  return {
    ok: violations.length === 0,
    violations,
    user,
    admin,
    profileFingerprints: {
      userHomeProfile: args.userProfileFingerprints?.homeProfile ?? null,
      userApplianceProfile: args.userProfileFingerprints?.applianceProfile ?? null,
      adminHomeProfile: args.adminProfileFingerprints?.homeProfile ?? null,
      adminApplianceProfile: args.adminProfileFingerprints?.applianceProfile ?? null,
      homeProfilesMatch,
      applianceProfilesMatch,
    },
  };
}

export function computeSimulatedProfileFingerprint(args: {
  homeProfile: unknown;
  applianceProfileJson: unknown;
}): string {
  const canonical = JSON.stringify({
    home: args.homeProfile ?? null,
    appliancesJson: args.applianceProfileJson ?? null,
  });
  return createHash("sha256").update(canonical, "utf8").digest("base64url").slice(0, 16);
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
  inputParity: PastWeatherInputParityResult | null;
  readModelParity: ReturnType<typeof auditUserAdminPastReadModelParity> | null;
}> {
  const { getCachedPastDataset } = await import("@/modules/onePathSim/usageSimulator/pastCache");
  const { getHomeProfileSimulatedByUserHouse } = await import("@/modules/homeProfile/repo");
  const { getApplianceProfileSimulatedByUserHouse } = await import("@/modules/applianceProfile/repo");

  const adminMeta = asRecord(args.adminDataset.meta);
  const requestedSourceHash =
    String(args.sourceArtifactInputHash ?? "").trim() ||
    String(asRecord(adminMeta.lockboxInput).sourceContext?.intervalFingerprint ?? "").trim() ||
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
  const userProfiles = {
    homeProfile: computeSimulatedProfileFingerprint({ homeProfile: userHome, applianceProfileJson: null }),
    applianceProfile: computeSimulatedProfileFingerprint({
      homeProfile: null,
      applianceProfileJson: userApp?.appliancesJson ?? null,
    }),
  };
  const adminProfiles = {
    homeProfile: computeSimulatedProfileFingerprint({ homeProfile: adminHome, applianceProfileJson: null }),
    applianceProfile: computeSimulatedProfileFingerprint({
      homeProfile: null,
      applianceProfileJson: adminApp?.appliancesJson ?? null,
    }),
  };
  const userCombined = computeSimulatedProfileFingerprint({
    homeProfile: userHome,
    applianceProfileJson: userApp?.appliancesJson ?? null,
  });
  const adminCombined = computeSimulatedProfileFingerprint({
    homeProfile: adminHome,
    applianceProfileJson: adminApp?.appliancesJson ?? null,
  });

  const inputParity = auditPastWeatherInputParity({
    userDataset,
    adminDataset: args.adminDataset,
    userProfileFingerprints: {
      homeProfile: userCombined,
      applianceProfile: userProfiles.applianceProfile,
    },
    adminProfileFingerprints: {
      homeProfile: adminCombined,
      applianceProfile: adminProfiles.applianceProfile,
    },
  });
  const readModelParity = auditUserAdminPastReadModelParity({
    userDataset,
    adminDataset: args.adminDataset,
    userProfileFingerprints: {
      homeProfile: userCombined,
      applianceProfile: userProfiles.applianceProfile,
    },
    adminProfileFingerprints: {
      homeProfile: adminCombined,
      applianceProfile: adminProfiles.applianceProfile,
    },
  });

  const violations = [...inputParity.violations];
  if (!readModelParity.ok) {
    violations.push(...readModelParity.violations);
  }

  return {
    ok: inputParity.ok && readModelParity.ok,
    violations: [...new Set(violations)],
    sourceArtifactLoaded: true,
    sourceArtifactInputHash: sourceHash,
    inputParity,
    readModelParity,
  };
}
