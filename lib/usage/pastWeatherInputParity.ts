import { sha256DigestBase64Url } from "@/lib/crypto/sha256Base64Url";
import {
  buildResolvedSimFingerprintCrossSurfaceAudit,
  type ResolvedSimFingerprintCrossSurfaceAudit,
} from "@/lib/usage/pastCrossSurfaceResolvedSimFingerprintPolicy";
import { readPastValidationPolicyRevisionFromMeta } from "@/lib/usage/pastSimulationCoreLabel";
import { readGreenButtonTrustedHomeDateKeysFromPastMeta } from "@/lib/usage/greenButtonPastTrustedPool";
import {
  PAST_DISPLAY_WEATHER_META_FIELD,
  scoreCardValues,
  WEATHER_SCORER_MODULE,
} from "@/lib/usage/weatherScoringOwnership";
import {
  WEATHER_CALCULATION_VERSION,
  WEATHER_SCORE_VERSION,
} from "@/modules/weatherSensitivity/shared";

const PAST_DISPLAY_WEATHER_FINALIZE_VERSION = "past_display_weather_finalize_v2";

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
  return sha256DigestBase64Url(JSON.stringify(value), 22);
}

function readPastCoverageWindow(dataset: Record<string, unknown>): { start: string | null; end: string | null } {
  const meta = asRecord(dataset.meta);
  const summary = asRecord(dataset.summary);
  return {
    start: asDateKey(meta.coverageStart ?? summary.start),
    end: asDateKey(meta.coverageEnd ?? summary.end),
  };
}

/** Canonical 365-day display window only — exclude raw boundary rows outside coverage. */
function dailyRowsInPastCoverageWindow(
  dataset: Record<string, unknown>
): Array<{ date?: unknown; kwh?: unknown; source?: unknown; sourceDetail?: unknown }> {
  const daily = Array.isArray(dataset.daily)
    ? (dataset.daily as Array<{ date?: unknown; kwh?: unknown; source?: unknown; sourceDetail?: unknown }>)
    : [];
  const { start, end } = readPastCoverageWindow(dataset);
  if (!start || !end) return daily;
  return daily.filter((row) => {
    const dateKey = asDateKey(row.date);
    return dateKey != null && dateKey >= start && dateKey <= end;
  });
}

function computePastDisplayTruthRevision(args: {
  dataset: Record<string, unknown>;
  weatherHouseId?: string | null;
}): string {
  const meta = asRecord(args.dataset.meta);
  const daily = dailyRowsInPastCoverageWindow(args.dataset);
  const dailyFingerprint = daily
    .map((row) => {
      const date = String(row.date ?? "").slice(0, 10);
      const kwh = round2(Number(row.kwh) || 0);
      const source = String(row.source ?? "").trim().toUpperCase();
      return `${date}|${kwh}|${source}`;
    })
    .sort()
    .join(";");

  const trustedKeys = Array.from(readGreenButtonTrustedHomeDateKeysFromPastMeta(meta)).sort().join(",");
  const coverageStart = String(meta.coverageStart ?? asRecord(args.dataset.summary).start ?? "").slice(0, 10);
  const coverageEnd = String(meta.coverageEnd ?? asRecord(args.dataset.summary).end ?? "").slice(0, 10);
  const weatherHouseId = String(args.weatherHouseId ?? meta.actualContextHouseId ?? "").trim();
  const validationRevision = readPastValidationPolicyRevisionFromMeta(meta) ?? "";
  const dailyWeatherKeys = Object.keys(asRecord(args.dataset.dailyWeather ?? meta.dailyWeatherByDateKey))
    .sort()
    .join(",");

  const canonical = [
    PAST_DISPLAY_WEATHER_FINALIZE_VERSION,
    dailyFingerprint,
    trustedKeys,
    coverageStart,
    coverageEnd,
    weatherHouseId,
    validationRevision,
    dailyWeatherKeys,
  ].join("\n");

  return sha256DigestBase64Url(canonical, 22);
}

function readArtifactInputHash(meta: Record<string, unknown>): string | null {
  return (
    String(meta.artifactInputHash ?? meta.inputHash ?? meta.fullChainHash ?? "").trim() || null
  );
}

function hashFinalizedDailyRows(dataset: Record<string, unknown>): string {
  const daily = dailyRowsInPastCoverageWindow(dataset);
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
  const travelRangesContainer = asRecord(lockbox.travelRanges);
  const travelRanges = Array.isArray(travelRangesContainer.ranges)
    ? (travelRangesContainer.ranges as Array<{ startDate?: unknown; endDate?: unknown }>)
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
  forceComputedDisplayTruthRevision?: boolean;
}): PastWeatherInputFingerprint {
  const meta = asRecord(args.dataset.meta);
  const lockbox = asRecord(meta.lockboxInput);
  const profileContext = asRecord(lockbox.profileContext);
  const sourceContext = asRecord(lockbox.sourceContext);
  const lockboxRunContext = asRecord(meta.lockboxRunContext);
  const weatherHouseId =
    String(args.weatherHouseId ?? meta.actualContextHouseId ?? lockboxRunContext.actualContextHouseId ?? "").trim() ||
    null;
  const daily = dailyRowsInPastCoverageWindow(args.dataset);
  const netKwhDailySum = daily.length > 0 ? round2(daily.reduce((sum, row) => sum + (Number(row.kwh) || 0), 0)) : null;

  return {
    artifactInputHash: readArtifactInputHash(meta),
    fullChainHash: String(meta.fullChainHash ?? "").trim() || null,
    displayTruthRevision: args.forceComputedDisplayTruthRevision
      ? computePastDisplayTruthRevision({ dataset: args.dataset, weatherHouseId })
      : String(meta.pastDisplayWeatherDisplayTruthRevision ?? "").trim() ||
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
  /** Present in dual-run cross-surface mode — mismatch is informational, not a waiver. */
  resolvedSimFingerprint?: ResolvedSimFingerprintCrossSurfaceAudit;
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
  /**
   * Dual-run cross-surface: compare canonical display/weather truth (see
   * `pastCrossSurfaceResolvedSimFingerprintPolicy`). House-local resolvedSimFingerprint
   * is reported but not required to match; artifactInputHash likewise.
   */
  crossSurfaceWeatherInputsOnly?: boolean;
}): PastWeatherInputParityResult {
  const crossSurfaceOnly = args.crossSurfaceWeatherInputsOnly === true;
  const user = buildPastWeatherInputFingerprint({
    dataset: args.userDataset,
    weatherHouseId: args.userWeatherHouseId,
    profileFingerprint: args.userProfileFingerprints?.homeProfile ?? null,
    applianceProfileFingerprint: args.userProfileFingerprints?.applianceProfile ?? null,
    forceComputedDisplayTruthRevision: crossSurfaceOnly,
  });
  const admin = buildPastWeatherInputFingerprint({
    dataset: args.adminDataset,
    weatherHouseId: args.adminWeatherHouseId,
    profileFingerprint: args.adminProfileFingerprints?.homeProfile ?? null,
    applianceProfileFingerprint: args.adminProfileFingerprints?.applianceProfile ?? null,
    forceComputedDisplayTruthRevision: crossSurfaceOnly,
  });
  const violations: string[] = [];

  if (!crossSurfaceOnly) {
    compareField(violations, "artifactInputHash", user.artifactInputHash, admin.artifactInputHash);
  }
  compareField(violations, "displayTruthRevision", user.displayTruthRevision, admin.displayTruthRevision);
  compareField(violations, "finalizedDailyRowsHash", user.finalizedDailyRowsHash, admin.finalizedDailyRowsHash);
  compareField(violations, "dailyWeatherHash", user.dailyWeatherHash, admin.dailyWeatherHash);
  compareField(violations, "usageShapeProfileIdentity", user.usageShapeProfileIdentity, admin.usageShapeProfileIdentity);
  compareField(violations, "profileHouseId", user.profileHouseId, admin.profileHouseId);
  compareField(violations, "intervalDataFingerprint", user.intervalDataFingerprint, admin.intervalDataFingerprint);
  compareField(violations, "greenButtonTrustedDateKeys", user.greenButtonTrustedDateKeys, admin.greenButtonTrustedDateKeys);
  if (crossSurfaceOnly) {
    // Informational only — canonical truth gates above still fail closed on divergence.
  } else {
    compareField(violations, "resolvedSimFingerprint", user.resolvedSimFingerprint, admin.resolvedSimFingerprint);
    compareField(violations, "usageFingerprint", user.usageFingerprint, admin.usageFingerprint);
    compareField(violations, "weatherIdentity", user.weatherIdentity, admin.weatherIdentity);
    compareField(violations, "simulationVariableVersion", user.simulationVariableVersion, admin.simulationVariableVersion);
    compareField(violations, "simVersion", user.simVersion, admin.simVersion);
  }
  compareField(violations, "validationKeys", user.validationKeys, admin.validationKeys);
  compareField(violations, "travelVacantFingerprint", user.travelVacantFingerprint, admin.travelVacantFingerprint);
  compareField(violations, "scorerVersion", user.scorerVersion, admin.scorerVersion);
  compareField(violations, "calculationVersion", user.calculationVersion, admin.calculationVersion);
  compareField(violations, "finalizeVersion", user.finalizeVersion, admin.finalizeVersion);

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

  const resolvedSimFingerprint = crossSurfaceOnly
    ? buildResolvedSimFingerprintCrossSurfaceAudit({
        user: user.resolvedSimFingerprint,
        admin: admin.resolvedSimFingerprint,
      })
    : undefined;

  return {
    ok: violations.length === 0,
    violations,
    user,
    admin,
    resolvedSimFingerprint,
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
  return sha256DigestBase64Url(canonical, 16);
}

function bundleCValuesEqual(
  left: ReturnType<typeof scoreCardValues>,
  right: ReturnType<typeof scoreCardValues>
): boolean {
  return (
    left.weatherEfficiency === right.weatherEfficiency &&
    left.cooling === right.cooling &&
    left.heating === right.heating &&
    left.confidence === right.confidence
  );
}

export function buildPastWeatherCrossSurfaceAcceptanceProof(args: {
  inputParity: PastWeatherInputParityResult;
  userVisibleBundleC: ReturnType<typeof scoreCardValues> | null;
  adminVisibleBundleC: ReturnType<typeof scoreCardValues> | null;
}): {
  ok: boolean;
  profileFingerprintsMatch: boolean;
  profileHouseIdMatch: boolean;
  usageShapeProfileIdentityMatch: boolean;
  displayTruthRevisionMatch: boolean;
  finalizedDailyRowsHashMatch: boolean;
  dailyWeatherHashMatch: boolean;
  intervalDataFingerprintMatch: boolean;
  trustedDateKeysMatch: boolean;
  validationKeysMatch: boolean;
  travelVacantFingerprintMatch: boolean;
  scorerVersionMatch: boolean;
  calculationVersionMatch: boolean;
  userVisibleEqualsUserBundleC: boolean;
  adminVisibleEqualsAdminBundleC: boolean;
  userBundleCEqualsAdminBundleC: boolean;
  resolvedSimFingerprint: ResolvedSimFingerprintCrossSurfaceAudit | null;
  violations: string[];
  user: PastWeatherInputFingerprint;
  admin: PastWeatherInputFingerprint;
  profileFingerprints: PastWeatherInputParityResult["profileFingerprints"];
} {
  const { user, admin, profileFingerprints } = args.inputParity;
  const userVisible = args.userVisibleBundleC ?? user.bundleC;
  const adminVisible = args.adminVisibleBundleC ?? admin.bundleC;
  const resolvedSimFingerprint =
    args.inputParity.resolvedSimFingerprint ??
    buildResolvedSimFingerprintCrossSurfaceAudit({
      user: user.resolvedSimFingerprint,
      admin: admin.resolvedSimFingerprint,
    });
  const proof = {
    profileFingerprintsMatch: profileFingerprints.homeProfilesMatch === true,
    profileHouseIdMatch:
      user.profileHouseId != null &&
      admin.profileHouseId != null &&
      user.profileHouseId === admin.profileHouseId,
    usageShapeProfileIdentityMatch: user.usageShapeProfileIdentity === admin.usageShapeProfileIdentity,
    displayTruthRevisionMatch: user.displayTruthRevision === admin.displayTruthRevision,
    finalizedDailyRowsHashMatch: user.finalizedDailyRowsHash === admin.finalizedDailyRowsHash,
    dailyWeatherHashMatch: user.dailyWeatherHash === admin.dailyWeatherHash,
    intervalDataFingerprintMatch: user.intervalDataFingerprint === admin.intervalDataFingerprint,
    trustedDateKeysMatch: user.greenButtonTrustedDateKeys === admin.greenButtonTrustedDateKeys,
    validationKeysMatch: JSON.stringify(user.validationKeys) === JSON.stringify(admin.validationKeys),
    travelVacantFingerprintMatch: user.travelVacantFingerprint === admin.travelVacantFingerprint,
    scorerVersionMatch: user.scorerVersion === admin.scorerVersion,
    calculationVersionMatch: user.calculationVersion === admin.calculationVersion,
    userVisibleEqualsUserBundleC: bundleCValuesEqual(userVisible, user.bundleC),
    adminVisibleEqualsAdminBundleC: bundleCValuesEqual(adminVisible, admin.bundleC),
    userBundleCEqualsAdminBundleC: bundleCValuesEqual(user.bundleC, admin.bundleC),
  };
  const violations = [...args.inputParity.violations];
  if (!proof.userVisibleEqualsUserBundleC) {
    violations.push("user visible weather != user meta.pastDisplayWeatherSensitivityScore");
  }
  if (!proof.adminVisibleEqualsAdminBundleC) {
    violations.push("admin visible weather != admin meta.pastDisplayWeatherSensitivityScore");
  }
  const ok =
    proof.profileFingerprintsMatch &&
    proof.profileHouseIdMatch &&
    proof.usageShapeProfileIdentityMatch &&
    proof.displayTruthRevisionMatch &&
    proof.finalizedDailyRowsHashMatch &&
    proof.dailyWeatherHashMatch &&
    proof.intervalDataFingerprintMatch &&
    proof.trustedDateKeysMatch &&
    proof.validationKeysMatch &&
    proof.travelVacantFingerprintMatch &&
    proof.scorerVersionMatch &&
    proof.calculationVersionMatch &&
    proof.userVisibleEqualsUserBundleC &&
    proof.adminVisibleEqualsAdminBundleC &&
    proof.userBundleCEqualsAdminBundleC;
  return {
    ok,
    ...proof,
    resolvedSimFingerprint,
    violations: Array.from(new Set(violations)),
    user,
    admin,
    profileFingerprints,
  };
}
