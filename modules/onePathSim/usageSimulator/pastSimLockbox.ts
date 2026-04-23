import { createHash } from "crypto";
import type { SimulatorMode } from "@/modules/onePathSim/usageSimulator/requirements";
import type { WeatherLogicMode } from "@/modules/onePathSim/usageSimulator/pastSimWeatherPolicy";
import type { WeatherPreference } from "@/modules/weatherNormalization/normalizer";
import type { ValidationDaySelectionMode } from "@/modules/onePathSim/usageSimulator/validationSelection";
import type { SimulatedDayResult } from "@/modules/onePathSim/simulatedUsage/pastDaySimulatorTypes";

export type PastSimLockboxMode =
  | "ACTUAL_INTERVAL_BASELINE"
  | "MANUAL_MONTHLY"
  | "MANUAL_ANNUAL"
  | "PROFILE_ONLY_NEW_BUILD";

export type PastSimSourceContext = {
  sourceHouseId: string;
  sourceEsiid: string | null;
  window: { startDate: string; endDate: string } | null;
  timezone: string | null;
  intervalFingerprint: string | null;
  weatherLogicMode: WeatherLogicMode | null;
  weatherIdentity: string | null;
  sourceDerivedMonthlyTotalsKwhByMonth: Record<string, number> | null;
  sourceDerivedAnnualTotalKwh: number | null;
};

export type PastSimProfileContext = {
  profileHouseId: string;
  testHomeId: string | null;
  homeProfileSnapshotRef: string | null;
  applianceProfileSnapshotRef: string | null;
  usageShapeProfileIdentity: string | null;
};

export type PastSimTravelRanges = {
  ranges: Array<{ startDate: string; endDate: string }>;
};

export type PastSimValidationKeys = {
  localDateKeys: string[];
  selectionMode: ValidationDaySelectionMode | "manual" | null;
  diagnosticsRef: string | null;
};

export type PastSimLockboxTruthOverrides = Record<string, never>;

export type PastSimLockboxInput = {
  sourceContext: PastSimSourceContext;
  profileContext: PastSimProfileContext;
  mode: PastSimLockboxMode;
  travelRanges: PastSimTravelRanges;
  validationKeys: PastSimValidationKeys;
  overrides: PastSimLockboxTruthOverrides;
};

export type PastSimRunContext = {
  correlationId: string;
  callerLabel: string;
  buildPathKind: "recalc" | "cold_build" | "lab_validation" | "cache_restore";
  persistRequested: boolean;
  adminLabTreatmentMode?: string;
  preferredActualSource?: "SMT" | "GREEN_BUTTON";
  asyncMetadata?: { jobId?: string; queueFlags?: Record<string, unknown> };
};

export type PastSimReadContext = {
  artifactReadMode: "artifact_only" | "allow_rebuild";
  projectionMode: "baseline" | "raw";
  compareSidecarRequest: boolean;
  displayFormattingFlags?: Record<string, unknown>;
};

export type PastSimPerRunTrace = {
  lockboxInput: PastSimLockboxInput;
  runContext: PastSimRunContext;
  stageTimingsMs: Record<string, number>;
  inputHash: string | null;
  fullChainHash: string | null;
  sourceHouseId: string;
  profileHouseId: string;
  testHomeId: string | null;
};

export type PastSimPerDayTrace = {
  localDate: string;
  simulatedReasonCode:
    | "TRAVEL_VACANT"
    | "TEST_MODELED_KEEP_REF"
    | "MANUAL_CONSTRAINED_DAY"
    | "MONTHLY_CONSTRAINED_NON_TRAVEL_DAY"
    | "FORCED_SELECTED_DAY"
    | "INCOMPLETE_METER_DAY"
    | "LEADING_MISSING_DAY"
    | null;
  fallbackLevel: string | null;
  clampApplied: boolean;
  dayClassification: string | null;
  weatherSeverityMultiplier: number | null;
  weatherModeUsed: string | null;
  finalDayKwh: number | null;
  displayDayKwh: number | null;
  intervalSumKwh: number | null;
  shapeVariantUsed: string | null;
  donorSelectionModeUsed: string | null;
  donorCandidatePoolSize: number | null;
  selectedDonorLocalDates: string[];
  selectedDonorWeights: Array<{ localDate: string; weight: number; distance: number; dayKwh: number }>;
  donorWeatherRegimeUsed: string | null;
  donorMonthKeyUsed: string | null;
  thermalDistanceScore: number | null;
  broadFallbackUsed: boolean;
  sameRegimeDonorPoolAvailable: boolean;
  donorPoolBlendStrategy: string | null;
  donorPoolKwhSpread: number | null;
  donorPoolKwhVariance: number | null;
  donorPoolMedianKwh: number | null;
  donorVarianceGuardrailTriggered: boolean;
  weatherAdjustmentModeUsed: string | null;
  postDonorAdjustmentCoefficient: number | null;
  shape96Hash: string | null;
  templateSelectionKind: string | null;
  selectedFingerprintBucketMonth: string | null;
  selectedFingerprintBucketDayType: string | null;
  selectedFingerprintWeatherBucket: string | null;
  selectedFingerprintIdentity: string | null;
  selectedReferencePoolCount: number | null;
  weatherScalingCoefficientUsed: number | null;
  dayTotalBeforeWeatherScale: number | null;
  dayTotalAfterWeatherScale: number | null;
  intervalShapeScalingMethod: string | null;
};

type InferLockboxModeArgs = {
  simulatorMode: SimulatorMode;
  manualUsagePayload?: unknown;
  adminLabTreatmentMode?: string | null;
};

export function inferPastSimLockboxMode(args: InferLockboxModeArgs): PastSimLockboxMode {
  if (args.simulatorMode === "SMT_BASELINE") return "ACTUAL_INTERVAL_BASELINE";
  if (args.simulatorMode === "NEW_BUILD_ESTIMATE") return "PROFILE_ONLY_NEW_BUILD";

  const treatment = String(args.adminLabTreatmentMode ?? "").trim();
  if (treatment === "manual_monthly_constrained") return "MANUAL_MONTHLY";
  if (treatment === "manual_annual_constrained") return "MANUAL_ANNUAL";

  const payload = args.manualUsagePayload as { mode?: unknown } | null | undefined;
  const payloadMode = String(payload?.mode ?? "").trim();
  if (payloadMode === "MONTHLY") return "MANUAL_MONTHLY";
  if (payloadMode === "ANNUAL") return "MANUAL_ANNUAL";

  return "MANUAL_MONTHLY";
}

export function toSimulatorModeFromLockboxMode(mode: PastSimLockboxMode): SimulatorMode {
  if (mode === "ACTUAL_INTERVAL_BASELINE") return "SMT_BASELINE";
  if (mode === "PROFILE_ONLY_NEW_BUILD") return "NEW_BUILD_ESTIMATE";
  return "MANUAL_TOTALS";
}

export function buildPastSimRunContext(args: {
  correlationId: string;
  callerLabel?: string | null;
  buildPathKind?: "recalc" | "cold_build" | "lab_validation" | "cache_restore";
  persistRequested?: boolean;
  adminLabTreatmentMode?: string | null;
  preferredActualSource?: "SMT" | "GREEN_BUTTON" | null;
  asyncMetadata?: { jobId?: string; queueFlags?: Record<string, unknown> } | null;
}): PastSimRunContext {
  return {
    correlationId: String(args.correlationId ?? "").trim(),
    callerLabel: String(args.callerLabel ?? "user_recalc").trim() || "user_recalc",
    buildPathKind: args.buildPathKind ?? "recalc",
    persistRequested: args.persistRequested === true,
    ...(args.adminLabTreatmentMode ? { adminLabTreatmentMode: String(args.adminLabTreatmentMode) } : {}),
    ...(args.preferredActualSource ? { preferredActualSource: args.preferredActualSource } : {}),
    ...(args.asyncMetadata ? { asyncMetadata: args.asyncMetadata } : {}),
  };
}

export function buildPastSimReadContext(args: {
  artifactReadMode?: "artifact_only" | "allow_rebuild";
  projectionMode?: "baseline" | "raw";
  compareSidecarRequest?: boolean;
  displayFormattingFlags?: Record<string, unknown>;
}): PastSimReadContext {
  return {
    artifactReadMode: args.artifactReadMode ?? "allow_rebuild",
    projectionMode: args.projectionMode ?? "baseline",
    compareSidecarRequest: args.compareSidecarRequest !== false,
    ...(args.displayFormattingFlags ? { displayFormattingFlags: args.displayFormattingFlags } : {}),
  };
}

export function buildInitialPastSimLockboxInput(args: {
  houseId: string;
  actualContextHouseId?: string | null;
  sourceEsiid: string | null;
  simulatorMode: SimulatorMode;
  manualUsagePayload?: unknown;
  adminLabTreatmentMode?: string | null;
  travelRanges?: Array<{ startDate: string; endDate: string }>;
  validationOnlyDateKeysLocal?: Iterable<string>;
  validationSelectionMode?: ValidationDaySelectionMode | "manual" | null;
  testHomeId?: string | null;
  weatherPreference?: WeatherPreference | null;
  weatherLogicMode?: WeatherLogicMode | null;
}): PastSimLockboxInput {
  const sourceHouseId = String(args.actualContextHouseId ?? args.houseId);
  const testHomeId = String(args.testHomeId ?? args.houseId);
  const mode = inferPastSimLockboxMode({
    simulatorMode: args.simulatorMode,
    manualUsagePayload: args.manualUsagePayload,
    adminLabTreatmentMode: args.adminLabTreatmentMode,
  });
  const profileHouseId = sourceHouseId === testHomeId ? sourceHouseId : testHomeId;

  void args.weatherPreference;

  return {
    sourceContext: {
      sourceHouseId,
      sourceEsiid: args.sourceEsiid,
      window: null,
      timezone: null,
      intervalFingerprint: null,
      weatherLogicMode: args.weatherLogicMode ?? null,
      weatherIdentity: null,
      sourceDerivedMonthlyTotalsKwhByMonth: null,
      sourceDerivedAnnualTotalKwh: null,
    },
    profileContext: {
      profileHouseId,
      testHomeId,
      homeProfileSnapshotRef: null,
      applianceProfileSnapshotRef: null,
      usageShapeProfileIdentity: null,
    },
    mode,
    travelRanges: {
      ranges: Array.isArray(args.travelRanges)
        ? args.travelRanges.map((range) => ({
            startDate: String(range.startDate ?? "").slice(0, 10),
            endDate: String(range.endDate ?? "").slice(0, 10),
          }))
        : [],
    },
    validationKeys: {
      localDateKeys: Array.from(args.validationOnlyDateKeysLocal ?? [])
        .map((value) => String(value ?? "").slice(0, 10))
        .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
        .sort((a, b) => (a < b ? -1 : 1)),
      selectionMode: args.validationSelectionMode ?? null,
      diagnosticsRef: null,
    },
    overrides: {},
  };
}

export function finalizePastSimLockboxInput(args: {
  base: PastSimLockboxInput;
  window: { startDate: string; endDate: string } | null;
  timezone: string | null;
  intervalFingerprint: string | null;
  weatherLogicMode?: WeatherLogicMode | null;
  weatherIdentity: string | null;
  sourceDerivedMonthlyTotalsKwhByMonth: Record<string, number> | null;
  sourceDerivedAnnualTotalKwh: number | null;
  homeProfileSnapshotRef: string | null;
  applianceProfileSnapshotRef: string | null;
  usageShapeProfileIdentity: string | null;
  validationSelectionMode?: ValidationDaySelectionMode | "manual" | null;
  validationDiagnosticsRef?: string | null;
}): PastSimLockboxInput {
  return {
    ...args.base,
    sourceContext: {
      ...args.base.sourceContext,
      window: args.window,
      timezone: args.timezone,
      intervalFingerprint: args.intervalFingerprint,
      weatherLogicMode: args.weatherLogicMode ?? args.base.sourceContext.weatherLogicMode,
      weatherIdentity: args.weatherIdentity,
      sourceDerivedMonthlyTotalsKwhByMonth: args.sourceDerivedMonthlyTotalsKwhByMonth,
      sourceDerivedAnnualTotalKwh: args.sourceDerivedAnnualTotalKwh,
    },
    profileContext: {
      ...args.base.profileContext,
      homeProfileSnapshotRef: args.homeProfileSnapshotRef,
      applianceProfileSnapshotRef: args.applianceProfileSnapshotRef,
      usageShapeProfileIdentity: args.usageShapeProfileIdentity,
    },
    validationKeys: {
      ...args.base.validationKeys,
      selectionMode: args.validationSelectionMode ?? args.base.validationKeys.selectionMode,
      diagnosticsRef: args.validationDiagnosticsRef ?? args.base.validationKeys.diagnosticsRef,
    },
  };
}

function stableCanonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => stableCanonicalize(entry));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = stableCanonicalize((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

export function computePastSimFullChainHash(args: {
  lockboxInput: PastSimLockboxInput;
  inputHash: string;
  encodedIntervalsDigest: string;
  engineVersion: string;
}): string {
  const canonicalJson = JSON.stringify(stableCanonicalize(args.lockboxInput));
  return createHash("sha256")
    .update(canonicalJson, "utf8")
    .update("|", "utf8")
    .update(args.inputHash, "utf8")
    .update("|", "utf8")
    .update(args.encodedIntervalsDigest, "utf8")
    .update("|", "utf8")
    .update(args.engineVersion, "utf8")
    .digest("base64url")
    .slice(0, 44);
}

export function digestEncodedIntervalsBuffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("base64url").slice(0, 44);
}

export function buildPastSimPerDayTrace(results: SimulatedDayResult[] | undefined): PastSimPerDayTrace[] {
  return (results ?? []).map((result) => ({
    localDate: String(result.localDate ?? "").slice(0, 10),
    simulatedReasonCode: result.simulatedReasonCode ?? null,
    fallbackLevel: result.fallbackLevel ?? null,
    clampApplied: result.clampApplied === true,
    dayClassification: result.dayClassification ?? null,
    weatherSeverityMultiplier:
      typeof result.weatherSeverityMultiplier === "number" ? result.weatherSeverityMultiplier : null,
    weatherModeUsed: result.weatherModeUsed ?? null,
    finalDayKwh: typeof result.finalDayKwh === "number" ? result.finalDayKwh : null,
    displayDayKwh: typeof result.displayDayKwh === "number" ? result.displayDayKwh : null,
    intervalSumKwh: typeof result.intervalSumKwh === "number" ? result.intervalSumKwh : null,
    shapeVariantUsed: result.shapeVariantUsed ?? null,
    donorSelectionModeUsed: result.donorSelectionModeUsed ?? null,
    donorCandidatePoolSize: typeof result.donorCandidatePoolSize === "number" ? result.donorCandidatePoolSize : null,
    selectedDonorLocalDates: Array.isArray(result.selectedDonorLocalDates)
      ? result.selectedDonorLocalDates.map((value) => String(value ?? "").slice(0, 10)).filter((value) => value.length > 0)
      : [],
    selectedDonorWeights: Array.isArray(result.selectedDonorWeights)
      ? result.selectedDonorWeights
          .map((entry) => ({
            localDate: String(entry?.localDate ?? "").slice(0, 10),
            weight: typeof entry?.weight === "number" ? entry.weight : 0,
            distance: typeof entry?.distance === "number" ? entry.distance : 0,
            dayKwh: typeof entry?.dayKwh === "number" ? entry.dayKwh : 0,
          }))
          .filter((entry) => entry.localDate.length > 0)
      : [],
    donorWeatherRegimeUsed: result.donorWeatherRegimeUsed ?? null,
    donorMonthKeyUsed: result.donorMonthKeyUsed ?? null,
    thermalDistanceScore: typeof result.thermalDistanceScore === "number" ? result.thermalDistanceScore : null,
    broadFallbackUsed: result.broadFallbackUsed === true,
    sameRegimeDonorPoolAvailable: result.sameRegimeDonorPoolAvailable === true,
    donorPoolBlendStrategy: result.donorPoolBlendStrategy ?? null,
    donorPoolKwhSpread: typeof result.donorPoolKwhSpread === "number" ? result.donorPoolKwhSpread : null,
    donorPoolKwhVariance: typeof result.donorPoolKwhVariance === "number" ? result.donorPoolKwhVariance : null,
    donorPoolMedianKwh: typeof result.donorPoolMedianKwh === "number" ? result.donorPoolMedianKwh : null,
    donorVarianceGuardrailTriggered: result.donorVarianceGuardrailTriggered === true,
    weatherAdjustmentModeUsed: result.weatherAdjustmentModeUsed ?? null,
    postDonorAdjustmentCoefficient:
      typeof result.postDonorAdjustmentCoefficient === "number" ? result.postDonorAdjustmentCoefficient : null,
    shape96Hash: Array.isArray(result.shape96Used)
      ? createHash("sha256")
          .update(JSON.stringify(result.shape96Used), "utf8")
          .digest("base64url")
          .slice(0, 24)
      : null,
    templateSelectionKind: result.templateSelectionKind ?? null,
    selectedFingerprintBucketMonth: result.selectedFingerprintBucketMonth ?? null,
    selectedFingerprintBucketDayType: result.selectedFingerprintBucketDayType ?? null,
    selectedFingerprintWeatherBucket: result.selectedFingerprintWeatherBucket ?? null,
    selectedFingerprintIdentity: result.selectedFingerprintIdentity ?? null,
    selectedReferencePoolCount:
      typeof result.selectedReferencePoolCount === "number" ? result.selectedReferencePoolCount : null,
    weatherScalingCoefficientUsed:
      typeof result.weatherScalingCoefficientUsed === "number" ? result.weatherScalingCoefficientUsed : null,
    dayTotalBeforeWeatherScale:
      typeof result.dayTotalBeforeWeatherScale === "number" ? result.dayTotalBeforeWeatherScale : null,
    dayTotalAfterWeatherScale:
      typeof result.dayTotalAfterWeatherScale === "number" ? result.dayTotalAfterWeatherScale : null,
    intervalShapeScalingMethod: result.intervalShapeScalingMethod ?? null,
  }));
}

