import { prisma } from "@/lib/db";
import { monthsEndingAt } from "@/modules/onePathSim/manualAnchor";
import { canonicalWindow12Months } from "@/modules/onePathSim/usageSimulator/canonicalWindow";
import { normalizeStoredApplianceProfile } from "@/modules/applianceProfile/validation";
import { getApplianceProfileSimulatedByUserHouse } from "@/modules/applianceProfile/repo";
import { getHomeProfileSimulatedByUserHouse } from "@/modules/homeProfile/repo";
import { buildSimulatorInputs, travelRangesToExcludeDateKeys, type BaseKind, type BuildMode } from "@/modules/onePathSim/usageSimulator/build";
import { computeRequirements, type SimulatorMode } from "@/modules/onePathSim/usageSimulator/requirements";
import { hasActualIntervals, resolveActualUsageSourceAnchor } from "@/modules/realUsageAdapter/actual";
import { SMT_SHAPE_DERIVATION_VERSION } from "@/modules/realUsageAdapter/smt";
import {
  getActualDailyKwhForLocalDateKeys,
  getActualIntervalsForRange,
  getActualUsageDatasetForHouse,
  getIntervalDataFingerprint,
} from "@/lib/usage/actualDatasetForHouse";
import { upsertSimulatedUsageBuckets } from "@/lib/usage/simulatedUsageBuckets";
import { usagePrisma } from "@/lib/db/usageClient";
import {
  buildSimulatedUsageDatasetFromBuildInputs,
  buildSimulatedUsageDatasetFromCurve,
  buildDisplayMonthlyFromIntervalsUtc,
  reconcileRestoredPastDatasetFromDecodedIntervals,
  type SimulatorBuildInputsV1,
} from "@/modules/onePathSim/usageSimulator/dataset";
import { computeBuildInputsHash } from "@/modules/onePathSim/usageSimulator/hash";
import { resolveWindowFromBuildInputsForPastIdentity } from "@/modules/onePathSim/usageSimulator/windowIdentity";
import { INTRADAY_TEMPLATE_VERSION } from "@/modules/onePathSim/simulatedUsage/intradayTemplates";
import { computeMonthlyOverlay, computePastOverlay, computeFutureOverlay } from "@/modules/usageScenario/overlay";
import { listLedgerRows } from "@/modules/upgradesLedger/repo";
import { buildOrderedLedgerEntriesForOverlay } from "@/modules/upgradesLedger/overlayEntries";
import { getHouseAddressForUserHouse, listHouseAddressesForUser, normalizeScenarioKey, upsertSimulatorBuild } from "@/modules/onePathSim/usageSimulator/repo";
import { getLatestUsageShapeProfile } from "@/modules/usageShapeProfile/repo";
import { saveIntervalSeries15m } from "@/lib/usage/intervalSeriesRepo";
import {
  computePastInputHash,
  deleteCachedPastDatasetsForScenario,
  getCachedPastDataset,
  saveCachedPastDataset,
  PAST_ENGINE_VERSION,
  type CachedPastDataset,
  type CanonicalArtifactSimulatedDayTotalsByDate,
} from "@/modules/onePathSim/usageSimulator/pastCache";
import {
  createSimCorrelationId,
  getMemoryRssMb,
  logSimObservabilityEvent,
  logSimPipelineEvent,
} from "@/modules/onePathSim/usageSimulator/simObservability";
import {
  encodeIntervalsV1,
  decodeIntervalsV1,
  INTERVAL_CODEC_V1,
} from "@/modules/onePathSim/usageSimulator/intervalCodec";
import { IntervalSeriesKind } from "@/modules/onePathSim/usageSimulator/kinds";
import { billingPeriodsEndingAt } from "@/modules/onePathSim/manualBillingPeriods";
import {
  buildManualUsageStageOneResolvedSeeds,
  resolveManualUsageStageOnePayloadForMode,
} from "@/modules/onePathSim/manualPrefill";
import { normalizeMonthlyTotals, WEATHER_NORMALIZER_VERSION, type WeatherPreference } from "@/modules/weatherNormalization/normalizer";
import { getHouseWeatherDays } from "@/modules/weather/repo";
import { ensureHouseWeatherBackfill, ensureHouseWeatherNormalAvgBackfill } from "@/modules/weather/backfill";
import { SOURCE_OF_DAY_SIMULATION_CORE } from "@/modules/onePathSim/simulatedUsage/pastDaySimulator";
import type { SimulatedDayResult } from "@/modules/onePathSim/simulatedUsage/pastDaySimulatorTypes";
import { resolveOnePathWeatherGuardDecision, summarizeOnePathWeatherAvailability } from "@/modules/onePathSim/weatherAvailability";
import {
  canonicalIntervalKey,
  dateKeyInTimezone,
  getCandidateDateCoverageForSelection,
  localDateKeysInRange,
} from "@/lib/admin/gapfillLab";
import {
  selectValidationDayKeys,
  normalizeValidationSelectionMode,
  type ValidationDaySelectionMode,
  type ValidationDaySelectionDiagnostics,
} from "@/modules/onePathSim/usageSimulator/validationSelection";
import {
  attachValidationCompareProjection,
  CompareTruthIncompleteError,
  projectBaselineFromCanonicalDataset,
} from "@/modules/onePathSim/usageSimulator/compareProjection";
import {
  buildInitialPastSimLockboxInput,
  buildPastSimPerDayTrace,
  buildPastSimReadContext,
  buildPastSimRunContext,
  computePastSimFullChainHash,
  digestEncodedIntervalsBuffer,
  finalizePastSimLockboxInput,
  type PastSimLockboxInput,
  type PastSimPerRunTrace,
  type PastSimReadContext,
  type PastSimRunContext,
} from "@/modules/onePathSim/usageSimulator/pastSimLockbox";
import { computePastWeatherIdentity } from "@/modules/weather/identity";
import {
  resolveWeatherKindForLogicMode,
  resolveWeatherLogicModeFromBuildInputs,
  type WeatherLogicMode,
} from "@/modules/onePathSim/usageSimulator/pastSimWeatherPolicy";
import { displayProfilesFromModelMeta } from "@/modules/onePathSim/usageSimulator/profileDisplay";
import { classifySimulationFailure, recordSimulationDataAlert } from "@/modules/onePathSim/usageSimulator/simulationDataAlerts";
import { toPublicHouseLabel } from "@/modules/onePathSim/usageSimulator/houseLabel";
import { normalizePastProducerBuildPathKind } from "@/modules/onePathSim/simulatedUsage/pastProducerBuildPath";
import { resolveSharedWeatherSensitivityEnvelope } from "@/modules/onePathSim/weatherSensitivityShared";
import {
  ensureUsageShapeProfileForSharedSimulation,
  simulatePastFullWindowShared,
  simulatePastUsageDataset,
  simulatePastSelectedDaysShared,
  getUsageShapeProfileIdentityForPast,
  loadWeatherForPastWindow,
} from "@/modules/onePathSim/simulatedUsage/simulatePastUsageDataset";
import type { SimulatedCurve } from "@/modules/onePathSim/simulatedUsage/types";
import {
  boundDateKeysToCoverageWindow,
  resolveCanonicalUsage365CoverageWindow,
  resolveReportedCoverageWindow,
  type CoverageWindow,
} from "@/modules/onePathSim/usageSimulator/metadataWindow";
import {
  createFingerprintRecalcContext,
  ensureSimulatorFingerprintsWithContext,
  resolveSimFingerprintWithContext,
} from "@/modules/onePathSim/usageSimulator/fingerprintOrchestration";
import { createRecalcIntervalPreloadContext } from "@/modules/onePathSim/usageSimulator/recalcIntervalPreload";
import {
  attachRunIdentityToEffectiveSimulationVariablesUsed,
  getSimulationVariableOverrides,
  resolveSimulationVariablePolicyForInputType,
  type SimulationVariableInputType,
} from "@/modules/onePathSim/usageSimulator/simulationVariablePolicy";
import {
  applyAdminLabTreatmentToResolvedFingerprint,
  isAdminLabManualConstraintTreatmentMode,
} from "@/modules/onePathSim/usageSimulator/adminLabTreatment";

async function attachSelectedDailyWeatherForDataset(args: {
  dataset: any;
  buildInputs: Record<string, unknown>;
  fallbackHouseId: string;
  fallbackTimezone?: string | null;
  scope: "trusted_simulation_output" | "baseline_passthrough_or_lookup";
}) {
  const dataset = args.dataset;
  if (!dataset || !Array.isArray(dataset.daily) || dataset.daily.length === 0) return;
  if ((dataset as any).dailyWeather) return;
  const dateKeys = dataset.daily
    .map((row: any) => String(row?.date ?? "").slice(0, 10))
    .filter((value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value));
  if (dateKeys.length === 0) return;
  const weatherLogicMode = resolveWeatherLogicModeFromBuildInputs(args.buildInputs);
  const weatherHouseId = String(args.buildInputs.actualContextHouseId ?? args.fallbackHouseId);
  const timezone =
    String(args.buildInputs.timezone ?? args.fallbackTimezone ?? "America/Chicago").trim() ||
    "America/Chicago";
  let skippedLatLng = false;
  if (weatherLogicMode === "LAST_YEAR_ACTUAL_WEATHER") {
    const backfill = await ensureHouseWeatherBackfill({
      houseId: weatherHouseId,
      startDate: dateKeys[0]!,
      endDate: dateKeys[dateKeys.length - 1]!,
      timezone,
    });
    skippedLatLng = backfill.skippedLatLng === true;
  } else if (weatherLogicMode === "LONG_TERM_AVERAGE_WEATHER") {
    const backfill = await ensureHouseWeatherNormalAvgBackfill({
      houseId: weatherHouseId,
      dateKeys,
    });
    skippedLatLng = backfill.skippedLatLng === true;
  }
  const weatherKind = resolveWeatherKindForLogicMode(weatherLogicMode);
  const wxMap = await getHouseWeatherDays({
    houseId: weatherHouseId,
    dateKeys,
    kind: weatherKind,
  });
  const weatherAvailability = summarizeOnePathWeatherAvailability({
    expectedDateKeys: dateKeys,
    wxMap,
    weatherLogicMode,
    skippedLatLng,
  });
  const weatherGuard = resolveOnePathWeatherGuardDecision({
    availability: weatherAvailability,
    scope: args.scope,
  });
  if (!(dataset as any).meta || typeof (dataset as any).meta !== "object") {
    (dataset as any).meta = {};
  }
  (dataset as any).meta.weatherLogicMode = weatherLogicMode;
  (dataset as any).meta.weatherKindUsed = weatherKind;
  (dataset as any).meta.weatherSourceSummary = weatherAvailability.weatherSourceSummary;
  (dataset as any).meta.weatherFallbackReason = weatherAvailability.weatherFallbackReason;
  (dataset as any).meta.weatherProviderName = weatherAvailability.weatherProviderName;
  (dataset as any).meta.weatherCoverageStart = weatherAvailability.weatherCoverageStart;
  (dataset as any).meta.weatherCoverageEnd = weatherAvailability.weatherCoverageEnd;
  (dataset as any).meta.weatherStubRowCount = weatherAvailability.weatherStubRowCount;
  (dataset as any).meta.weatherActualRowCount = weatherAvailability.weatherActualRowCount;
  (dataset as any).meta.weatherMissingDateCount = weatherAvailability.missingDateCount;
  (dataset as any).meta.weatherMissingDateKeys = weatherAvailability.missingDateKeys;
  (dataset as any).meta.weatherTrustStatus = weatherGuard.weatherTrustStatus;
  (dataset as any).meta.weatherCoverageStatus = weatherGuard.weatherCoverageStatus;
  (dataset as any).meta.missingLatestWeatherDay = weatherGuard.missingLatestWeatherDay;
  (dataset as any).meta.partialWeatherCoverage = weatherGuard.partialWeatherCoverage;
  if (weatherGuard.shouldHardStop) {
    throw new Error(
      weatherGuard.failureMessage ??
        "Shared simulation weather guard failed: required real weather coverage is unavailable."
    );
  }
  if (!weatherAvailability.available) return;
  (dataset as any).dailyWeather = Object.fromEntries(
    dateKeys.map((dateKey: string) => {
      const w = wxMap.get(dateKey)!;
      return [
        dateKey,
        {
          tAvgF: Number(w?.tAvgF) || 0,
          tMinF: Number(w?.tMinF) || 0,
          tMaxF: Number(w?.tMaxF) || 0,
          hdd65: Number(w?.hdd65) || 0,
          cdd65: Number(w?.cdd65) || 0,
          source: String(w?.source ?? "").trim() || null,
        },
      ];
    })
  );
}
import {
  buildSourceDerivedMonthlyTargetResolutionFromPayload,
  resolveManualMonthlyAnchorEndDateKey,
  type SourceDerivedMonthlyTargetResolution,
} from "@/modules/onePathSim/usageSimulator/monthlyTargetConstruction";
import type { ResolvedSimFingerprint } from "@/modules/onePathSim/usageSimulator/resolvedSimFingerprintTypes";

type ManualUsagePayloadAny = any;

function cleanupStalePastCacheVariants(args: { houseId: string; scenarioId: string; keepInputHash: string }) {
  void deleteCachedPastDatasetsForScenario({
    houseId: args.houseId,
    scenarioId: args.scenarioId,
    excludeInputHash: args.keepInputHash,
  }).catch(() => undefined);
}

const WORKSPACE_PAST_NAME = "Past (Corrected)";
const WORKSPACE_FUTURE_NAME = "Future (What-if)";
const DEFAULT_SYSTEM_VALIDATION_SELECTION_MODE: ValidationDaySelectionMode = "random_simple";
const DEFAULT_ADMIN_LAB_VALIDATION_SELECTION_MODE: ValidationDaySelectionMode = "stratified_weather_balanced";

export async function getUserDefaultValidationSelectionMode(): Promise<ValidationDaySelectionMode> {
  try {
    const row = await (usagePrisma as any).usageSimulatorSettings.findUnique({
      where: { id: "default" },
      select: { userDefaultValidationSelectionMode: true },
    });
    return (
      normalizeValidationSelectionMode(row?.userDefaultValidationSelectionMode) ??
      DEFAULT_SYSTEM_VALIDATION_SELECTION_MODE
    );
  } catch {
    return DEFAULT_SYSTEM_VALIDATION_SELECTION_MODE;
  }
}

export async function setUserDefaultValidationSelectionMode(
  mode: ValidationDaySelectionMode
): Promise<{ ok: true; mode: ValidationDaySelectionMode } | { ok: false; error: string }> {
  try {
    const normalized = normalizeValidationSelectionMode(mode);
    if (!normalized) return { ok: false, error: "invalid_validation_selection_mode" };
    await (usagePrisma as any).usageSimulatorSettings.upsert({
      where: { id: "default" },
      create: {
        id: "default",
        userDefaultValidationSelectionMode: normalized,
      },
      update: {
        userDefaultValidationSelectionMode: normalized,
      },
    });
    return { ok: true, mode: normalized };
  } catch {
    return { ok: false, error: "usage_simulator_settings_write_failed" };
  }
}

export function getAdminLabDefaultValidationSelectionMode(): ValidationDaySelectionMode {
  return DEFAULT_ADMIN_LAB_VALIDATION_SELECTION_MODE;
}
async function reportSimulationDataIssue(args: {
  source: "GAPFILL_LAB" | "USER_SIMULATION" | "USAGE_DASHBOARD";
  userId: string;
  houseId: string;
  scenarioId?: string | null;
  code?: string | null;
  message?: string | null;
  context?: Record<string, unknown>;
}) {
  const classification = classifySimulationFailure({
    code: args.code ?? null,
    message: args.message ?? null,
  });
  if (!classification.shouldAlert) return;
  await recordSimulationDataAlert({
    source: args.source,
    userId: args.userId,
    houseId: args.houseId,
    scenarioId: args.scenarioId ?? null,
    reasonCode: classification.reasonCode,
    reasonMessage: classification.reasonMessage,
    missingData: classification.missingData,
    context: args.context ?? null,
  });
}

function validateSharedSimQuality(dataset: any): { ok: true } | { ok: false; message: string } {
  const meta = (dataset as any)?.meta ?? {};
  const datasetKind = String(meta?.datasetKind ?? "");
  if (datasetKind !== "SIMULATED") return { ok: true };

  const dayTotalSource = String(meta?.dayTotalSource ?? "");
  const profileReason = String(meta?.usageShapeProfileDiag?.reasonNotUsed ?? "");
  const lowDataShapeAdapterUsed =
    meta?.lowDataShapeAdapterUsed === true || profileReason === "low_data_monthly_shape_adapter";
  const weatherSourceSummary = String(meta?.weatherSourceSummary ?? "");
  const weatherLogicMode = String(
    meta?.weatherLogicMode ??
      meta?.lockboxInput?.sourceContext?.weatherLogicMode ??
      ""
  );

  if (dayTotalSource === "fallback_month_avg") {
    return {
      ok: false,
      message:
        "Shared simulation quality guard failed: usage-shape profile is missing/invalid (fallback_month_avg).",
    };
  }
  if (profileReason && !lowDataShapeAdapterUsed) {
    return {
      ok: false,
      message:
        "Shared simulation quality guard failed: usage-shape profile is missing/invalid (fallback_month_avg).",
    };
  }
  if (weatherLogicMode === "LONG_TERM_AVERAGE_WEATHER") {
    if (
      !weatherSourceSummary ||
      weatherSourceSummary === "none" ||
      weatherSourceSummary === "unknown"
    ) {
      return {
        ok: false,
        message:
          "Shared simulation quality guard failed: long-term-average weather coverage is unavailable for the modeled window.",
      };
    }
    return { ok: true };
  }
  if (weatherSourceSummary && weatherSourceSummary !== "actual_only") {
    return {
      ok: false,
      message:
        "Shared simulation quality guard failed: modeled window is not backed by actual-only weather coverage.",
    };
  }
  return { ok: true };
}

async function getValidationActualDailyByDateForDataset(args: {
  dataset: any;
  fallbackHouseId: string;
  fallbackEsiid: string | null;
}): Promise<Map<string, number> | null> {
  const rawValidationKeys = Array.isArray(args.dataset?.meta?.validationOnlyDateKeysLocal)
    ? (args.dataset.meta.validationOnlyDateKeysLocal as unknown[])
    : [];
  const validationKeys = rawValidationKeys
    .map((v) => String(v ?? "").slice(0, 10))
    .filter((dk) => /^\d{4}-\d{2}-\d{2}$/.test(dk));
  if (validationKeys.length === 0) return null;

  const actualContextHouseId = String(args.dataset?.meta?.actualContextHouseId ?? args.fallbackHouseId);
  let actualContextEsiid: string | null =
    actualContextHouseId === args.fallbackHouseId ? args.fallbackEsiid ?? null : null;
  if (!actualContextEsiid && actualContextHouseId !== args.fallbackHouseId) {
    const actualHouse = await (prisma as any).houseAddress
      .findUnique({
        where: { id: actualContextHouseId },
        select: { esiid: true },
      })
      .catch(() => null);
    actualContextEsiid = actualHouse?.esiid ?? null;
  }

  // Compare-only: fetch actual kWh for validation keys only (no full-year interval load).
  const map = await getActualDailyKwhForLocalDateKeys({
    houseId: actualContextHouseId,
    esiid: actualContextEsiid,
    dateKeysLocal: validationKeys,
  });
  return map.size > 0 ? map : null;
}

type DateRange = { startDate: string; endDate: string };
type IntervalPoint = { timestamp: string; kwh: number };
type ScoredDayWeatherRow = {
  localDate: string;
  avgTempF: number | null;
  minTempF: number | null;
  maxTempF: number | null;
  hdd65: number | null;
  cdd65: number | null;
  weatherBasisUsed: string | null;
  weatherKindUsed: string | null;
  weatherSourceUsed: string | null;
  weatherProviderName: string | null;
  weatherFallbackReason: string | null;
};
type ScoredDayWeatherTruth = {
  availability: "available" | "missing_expected_scored_day_weather";
  reasonCode: "SCORED_DAY_WEATHER_AVAILABLE" | "SCORED_DAY_WEATHER_MISSING";
  explanation: string;
  source: "shared_compare_scored_day_weather";
  scoredDateCount: number;
  weatherRowCount: number;
  missingDateCount: number;
  missingDateSample: string[];
};
type TravelVacantParityRow = {
  localDate: string;
  artifactCanonicalSimDayKwh: number | null;
  freshSharedDayCalcKwh: number | null;
  parityMatch: boolean | null;
  artifactReferenceAvailability: "available" | "missing_canonical_artifact_day_total";
  freshCompareAvailability: "available" | "missing_fresh_shared_compare_output";
  parityReasonCode:
    | "TRAVEL_VACANT_PARITY_MATCH"
    | "TRAVEL_VACANT_PARITY_MISMATCH"
    | "TRAVEL_VACANT_ARTIFACT_REFERENCE_MISSING"
    | "TRAVEL_VACANT_FRESH_COMPARE_OUTPUT_MISSING";
};
type TravelVacantParityMismatchDiagnostic = {
  localDate: string;
  rawArtifactDaySum: number;
  rawFreshDaySum: number;
  normalizedArtifactDaySum: number;
  normalizedFreshDaySum: number;
  artifactFirstLocalTimestamp: string | null;
  artifactLastLocalTimestamp: string | null;
  freshFirstLocalTimestamp: string | null;
  freshLastLocalTimestamp: string | null;
  intervalCountArtifact: number;
  intervalCountFresh: number;
};
type TravelVacantParityTruth = {
  availability:
    | "validated"
    | "mismatch_detected"
    | "missing_artifact_reference"
    | "missing_fresh_compare_output"
    | "not_requested";
  reasonCode:
    | "TRAVEL_VACANT_PARITY_VALIDATED"
    | "TRAVEL_VACANT_PARITY_MISMATCH"
    | "TRAVEL_VACANT_ARTIFACT_REFERENCE_MISSING"
    | "TRAVEL_VACANT_FRESH_COMPARE_OUTPUT_MISSING"
    | "TRAVEL_VACANT_PARITY_NOT_REQUESTED";
  explanation: string;
  source: "db_travel_vacant_ranges";
  comparisonBasis: "canonical_artifact_simulated_day_totals_vs_fresh_shared_compare_daily_totals";
  requestedDateCount: number;
  validatedDateCount: number;
  mismatchCount: number;
  missingArtifactReferenceCount: number;
  missingFreshCompareCount: number;
  requestedDateSample: string[];
  exactProofRequired: boolean;
  exactProofSatisfied: boolean;
  mismatchDiagnosticsSample?: TravelVacantParityMismatchDiagnostic[];
};

function buildScoredDayWeatherPayload(args: {
  scoredDateKeysLocal: Set<string>;
  weatherByDateKey?: Map<string, { tAvgF?: number; tMinF?: number; tMaxF?: number; hdd65?: number; cdd65?: number; source?: string }> | null;
  weatherBasisUsed: string | null;
  weatherKindUsed?: string | null;
  weatherProviderName?: string | null;
  weatherFallbackReason?: string | null;
}): { rows: ScoredDayWeatherRow[]; truth: ScoredDayWeatherTruth } {
  const scoredDates = Array.from(args.scoredDateKeysLocal ?? [])
    .map((dk) => String(dk ?? "").slice(0, 10))
    .filter((dk) => /^\d{4}-\d{2}-\d{2}$/.test(dk))
    .sort();
  const rows: ScoredDayWeatherRow[] = [];
  const missingDateSample: string[] = [];
  for (const localDate of scoredDates) {
    const wx = args.weatherByDateKey?.get(localDate) ?? null;
    if (!wx) {
      if (missingDateSample.length < 10) missingDateSample.push(localDate);
      continue;
    }
    const avgTempF = Number(wx.tAvgF);
    const minTempF = Number(wx.tMinF);
    const maxTempF = Number(wx.tMaxF);
    const hdd65 = Number(wx.hdd65);
    const cdd65 = Number(wx.cdd65);
    rows.push({
      localDate,
      avgTempF: Number.isFinite(avgTempF) ? round2Local(avgTempF) : null,
      minTempF: Number.isFinite(minTempF) ? round2Local(minTempF) : null,
      maxTempF: Number.isFinite(maxTempF) ? round2Local(maxTempF) : null,
      hdd65: Number.isFinite(hdd65) ? round2Local(hdd65) : null,
      cdd65: Number.isFinite(cdd65) ? round2Local(cdd65) : null,
      weatherBasisUsed: args.weatherBasisUsed ?? null,
      weatherKindUsed: args.weatherKindUsed ?? null,
      weatherSourceUsed: String(wx.source ?? "").trim() || null,
      weatherProviderName: args.weatherProviderName ?? null,
      weatherFallbackReason: args.weatherFallbackReason ?? null,
    });
  }
  const missingDateCount = Math.max(0, scoredDates.length - rows.length);
  return {
    rows,
    truth: {
      availability: missingDateCount === 0 ? "available" : "missing_expected_scored_day_weather",
      reasonCode: missingDateCount === 0 ? "SCORED_DAY_WEATHER_AVAILABLE" : "SCORED_DAY_WEATHER_MISSING",
      explanation:
        missingDateCount === 0
          ? "Compact scored-day weather truth is available from the shared compare execution."
          : "Shared compare completed without compact weather truth for one or more scored dates.",
      source: "shared_compare_scored_day_weather",
      scoredDateCount: scoredDates.length,
      weatherRowCount: rows.length,
      missingDateCount,
      missingDateSample,
    },
  };
}

function buildScoredDayWeatherPayloadFromWeatherApiData(args: {
  scoredDateKeysLocal: Set<string>;
  weatherApiData?: unknown;
  weatherBasisUsed: string | null;
  weatherKindUsed?: string | null;
  weatherProviderName?: string | null;
  weatherFallbackReason?: string | null;
}): { rows: ScoredDayWeatherRow[]; truth: ScoredDayWeatherTruth } {
  const weatherByDateKey = new Map<
    string,
    { tAvgF?: number; tMinF?: number; tMaxF?: number; hdd65?: number; cdd65?: number; source?: string }
  >();
  if (Array.isArray(args.weatherApiData)) {
    for (const row of args.weatherApiData) {
      const rec = row as Record<string, unknown>;
      const dateKey = String(rec?.dateKey ?? "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) continue;
      weatherByDateKey.set(dateKey, {
        tAvgF: typeof rec.tAvgF === "number" ? rec.tAvgF : undefined,
        tMinF: typeof rec.tMinF === "number" ? rec.tMinF : undefined,
        tMaxF: typeof rec.tMaxF === "number" ? rec.tMaxF : undefined,
        hdd65: typeof rec.hdd65 === "number" ? rec.hdd65 : undefined,
        cdd65: typeof rec.cdd65 === "number" ? rec.cdd65 : undefined,
        source: typeof rec.source === "string" ? rec.source : undefined,
      });
    }
  }
  return buildScoredDayWeatherPayload({
    scoredDateKeysLocal: args.scoredDateKeysLocal,
    weatherByDateKey,
    weatherBasisUsed: args.weatherBasisUsed,
    weatherKindUsed: args.weatherKindUsed,
    weatherProviderName: args.weatherProviderName,
    weatherFallbackReason: args.weatherFallbackReason,
  });
}

async function resolvePastScenarioIdForHouse(args: {
  userId: string;
  houseId: string;
}): Promise<string | null> {
  const row = await (prisma as any).usageSimulatorScenario
    .findFirst({
      where: {
        userId: args.userId,
        houseId: args.houseId,
        name: WORKSPACE_PAST_NAME,
        archivedAt: null,
      },
      select: { id: true },
    })
    .catch(() => null);
  return row?.id ? String(row.id) : null;
}

export async function getSharedPastCoverageWindowForHouse(args: {
  userId: string;
  houseId: string;
}): Promise<{ startDate: string; endDate: string }> {
  void args;
  return resolveCanonicalUsage365CoverageWindow();
}

/** Same rule as compare_core `needsRebuildForOldCurveVersion` (artifact_ensure must not skip rebuild when this fails). */
function sharedPastArtifactMetaFailsCurveShapingStaleGuard(
  meta: Record<string, unknown> | null | undefined
): boolean {
  const v = String(meta?.curveShapingVersion ?? "");
  return v.length === 0 || v !== "shared_curve_v2";
}

function applyCanonicalCoverageMetadataForNonBaseline(
  dataset: any,
  scenarioKey: string,
  options?: { buildInputs?: unknown; coverageWindow?: CoverageWindow }
): { startDate: string; endDate: string } | null {
  if (scenarioKey === "BASELINE" || !dataset?.summary) return null;
  const canonicalCoverage = options?.coverageWindow ?? resolveCanonicalUsage365CoverageWindow();
  dataset.summary.start = canonicalCoverage.startDate;
  dataset.summary.end = canonicalCoverage.endDate;
  dataset.summary.latest = `${canonicalCoverage.endDate}T23:59:59.999Z`;
  if (!dataset.meta || typeof dataset.meta !== "object") dataset.meta = {};
  dataset.meta.coverageStart = canonicalCoverage.startDate;
  dataset.meta.coverageEnd = canonicalCoverage.endDate;

  let excludedDateKeys: Set<string>;
  if (options?.buildInputs != null) {
    const excludedRanges = travelRangesFromBuildInputs(options.buildInputs);
    excludedDateKeys = new Set(travelRangesToExcludeDateKeys(excludedRanges));
  } else {
    const existingFingerprint = String(dataset.meta.excludedDateKeysFingerprint ?? "");
    const parsed = existingFingerprint
      .split(",")
      .map((dk) => String(dk).trim())
      .filter((dk) => /^\d{4}-\d{2}-\d{2}$/.test(dk));
    excludedDateKeys = new Set(parsed);
  }
  const boundedExcludedDateKeys = boundDateKeysToCoverageWindow(excludedDateKeys, canonicalCoverage);
  dataset.meta.excludedDateKeysCount = boundedExcludedDateKeys.size;
  dataset.meta.excludedDateKeysFingerprint = Array.from(boundedExcludedDateKeys).sort().join(",");
  return canonicalCoverage;
}

function normalizeValidationOnlyDateKeysLocal(
  dateKeys: Set<string> | string[] | null | undefined
): Set<string> {
  const out = new Set<string>();
  if (!dateKeys) return out;
  for (const raw of Array.isArray(dateKeys) ? dateKeys : Array.from(dateKeys)) {
    const dk = String(raw ?? "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(dk)) out.add(dk);
  }
  return out;
}

export async function rebuildGapfillSharedPastArtifact(args: {
  userId: string;
  houseId: string;
}): Promise<
  | {
      ok: true;
      rebuilt: boolean;
      scenarioId: string;
      artifactScenarioId: string;
      requestedInputHash: string | null;
      artifactInputHashUsed: string | null;
      artifactHashMatch: boolean | null;
      artifactSourceMode: "exact_hash_match" | null;
      artifactSourceNote: string | null;
    }
  | { ok: false; error: string; message: string }
> {
  const scenarioId = await resolvePastScenarioIdForHouse(args);
  if (!scenarioId) {
    return {
      ok: false,
      error: "no_past_scenario",
      message: "No Past (Corrected) scenario for this house. Create/rebuild Past first.",
    };
  }
  const resolvedScenarioId = scenarioId;
  const house = await getHouseAddressForUserHouse({
    userId: args.userId,
    houseId: args.houseId,
  }).catch(() => null);
  if (!house) {
    return {
      ok: false,
      error: "house_not_found",
      message: "House not found for user.",
    };
  }
  const houseResolved = house;
  const buildRec = await (prisma as any).usageSimulatorBuild
    ?.findUnique({
      where: { userId_houseId_scenarioKey: { userId: args.userId, houseId: args.houseId, scenarioKey: resolvedScenarioId } },
      select: { buildInputs: true },
    })
    ?.catch(() => null);
  if (!buildRec?.buildInputs) {
    return {
      ok: false,
      error: "past_build_missing",
      message: "Past build inputs are missing. Rebuild Past first.",
    };
  }
  const buildInputs = normalizeLegacyWeatherEfficiencyBuildInputs(
    buildRec.buildInputs as SimulatorBuildInputsV1 & Record<string, unknown>
  ) as SimulatorBuildInputsV1;
  const identityWindow = resolveWindowFromBuildInputsForPastIdentity(buildInputs);
  if (!identityWindow) {
    return {
      ok: false,
      error: "past_build_missing",
      message: "Past identity window is unavailable. Rebuild Past first.",
    };
  }
  const identityWindowResolved = identityWindow;
  const timezone = String((buildInputs as any)?.timezone ?? "America/Chicago");
  const buildTravelRanges = travelRangesFromBuildInputs(buildInputs);
  const ensuredUsageShape = await ensureUsageShapeProfileForSharedSimulation({
    userId: args.userId,
    houseId: args.houseId,
    timezone,
    canonicalMonths: ((buildInputs as any).canonicalMonths ?? []) as string[],
  });
  if (ensuredUsageShape.error) {
    return {
      ok: false,
      error: "usage_shape_profile_required",
      message:
        "Shared Past artifact ensure could not establish a valid usage-shape profile before exact identity resolution.",
    };
  }
  const intervalDataFingerprint = await getIntervalDataFingerprint({
    houseId: args.houseId,
    esiid: houseResolved.esiid ?? null,
    startDate: identityWindowResolved.startDate,
    endDate: identityWindowResolved.endDate,
  });
  const usageShapeProfileIdentity = await getUsageShapeProfileIdentityForPast(args.houseId);
  const sourceHouseIdForWeather = String((buildInputs as any)?.actualContextHouseId ?? args.houseId);
  const weatherIdentity = await computePastWeatherIdentity({
    houseId: sourceHouseIdForWeather,
    startDate: identityWindowResolved.startDate,
    endDate: identityWindowResolved.endDate,
    weatherLogicMode: resolveWeatherLogicModeFromBuildInputs(buildInputs as Record<string, unknown>),
  });
  const exactInputHash = computePastInputHash({
    engineVersion: PAST_ENGINE_VERSION,
    windowStartUtc: identityWindowResolved.startDate,
    windowEndUtc: identityWindowResolved.endDate,
    timezone,
    travelRanges: buildTravelRanges,
    buildInputs: buildInputs as Record<string, unknown>,
    intervalDataFingerprint,
    usageShapeProfileId: usageShapeProfileIdentity.usageShapeProfileId,
    usageShapeProfileVersion: usageShapeProfileIdentity.usageShapeProfileVersion,
    usageShapeProfileDerivedAt: usageShapeProfileIdentity.usageShapeProfileDerivedAt,
    usageShapeProfileSimHash: usageShapeProfileIdentity.usageShapeProfileSimHash,
    weatherIdentity,
  });
  const canonicalCoverage = resolveCanonicalUsage365CoverageWindow();

  async function runVerification(inputHash: string): Promise<{ ok: boolean; dataset: any }> {
    const persisted = await getCachedPastDataset({
      houseId: args.houseId,
      scenarioId: resolvedScenarioId,
      inputHash,
    });
    if (!persisted || persisted.intervalsCodec !== INTERVAL_CODEC_V1) {
      return { ok: false, dataset: null };
    }
    const restored = restoreCachedArtifactDataset({
      cached: persisted,
      useSelectedDaysLightweightArtifactRead: false,
      fallbackEndDate: canonicalCoverage.endDate,
    }).dataset;
    const hasIntervals15 = Array.isArray(restored?.series?.intervals15);
    const hasCanonicalCoverage =
      String(restored?.summary?.start ?? "") === canonicalCoverage.startDate &&
      String(restored?.summary?.end ?? "") === canonicalCoverage.endDate &&
      String(restored?.meta?.coverageStart ?? "") === canonicalCoverage.startDate &&
      String(restored?.meta?.coverageEnd ?? "") === canonicalCoverage.endDate;
    return { ok: Boolean(hasIntervals15 && hasCanonicalCoverage), dataset: restored };
  }

  async function persistRebuiltArtifact(): Promise<
    | { ok: true; artifactSourceNote: string | null }
    | { ok: false; error: string; message: string }
  > {
    const keepRefDateKeysLocal = resolveProducerKeepRefDateKeysFromBuildInputs({
      buildInputs,
      startDate: identityWindowResolved.startDate,
      endDate: identityWindowResolved.endDate,
    });
    const pastResult = await simulatePastUsageDataset({
      userId: args.userId,
      houseId: args.houseId,
      actualContextHouseId: String((buildInputs as any)?.actualContextHouseId ?? args.houseId),
      esiid: houseResolved.esiid ?? null,
      travelRanges: buildTravelRanges,
      buildInputs,
      startDate: identityWindowResolved.startDate,
      endDate: identityWindowResolved.endDate,
      timezone,
      buildPathKind: "recalc",
      forceModeledOutputKeepReferencePoolDateKeysLocal:
        keepRefDateKeysLocal.size > 0 ? keepRefDateKeysLocal : undefined,
      includeSimulatedDayResults: true,
    });
    if (pastResult.dataset === null) {
      return {
        ok: false,
        error: "past_rebuild_failed",
        message: pastResult.error ?? "Failed to build shared Past artifact.",
      };
    }
    const rebuiltDataset: any = {
      ...pastResult.dataset,
      summary: typeof (pastResult.dataset as any)?.summary === "object" && (pastResult.dataset as any).summary !== null
        ? { ...(pastResult.dataset as any).summary }
        : {},
      series: typeof (pastResult.dataset as any)?.series === "object" && (pastResult.dataset as any).series !== null
        ? { ...(pastResult.dataset as any).series }
        : {},
      daily: Array.isArray((pastResult.dataset as any)?.daily) ? [...(pastResult.dataset as any).daily] : [],
      monthly: Array.isArray((pastResult.dataset as any)?.monthly) ? [...(pastResult.dataset as any).monthly] : [],
      totals: typeof (pastResult.dataset as any)?.totals === "object" && (pastResult.dataset as any).totals !== null
        ? { ...(pastResult.dataset as any).totals }
        : {},
      insights: typeof (pastResult.dataset as any)?.insights === "object" && (pastResult.dataset as any).insights !== null
        ? { ...(pastResult.dataset as any).insights }
        : {},
      meta: typeof (pastResult.dataset as any)?.meta === "object" && (pastResult.dataset as any).meta !== null
        ? { ...(pastResult.dataset as any).meta }
        : {},
      usageBucketsByMonth:
        (pastResult.dataset as any)?.usageBucketsByMonth &&
        typeof (pastResult.dataset as any).usageBucketsByMonth === "object"
          ? { ...(pastResult.dataset as any).usageBucketsByMonth }
          : {},
    };
    const intervals15 = (
      Array.isArray((rebuiltDataset as any)?.series?.intervals15) ? rebuiltDataset.series.intervals15 : []
    )
      .map((row: { timestamp?: string; kwh?: number }) => ({
        timestamp: String(row?.timestamp ?? ""),
        kwh: Number(row?.kwh) || 0,
      }))
      .filter((row: { timestamp: string; kwh: number }) => row.timestamp.length > 0);
    if (intervals15.length === 0) {
      return {
        ok: false,
        error: "artifact_read_failed",
        message: "Shared Past artifact build completed, but intervals15 are missing.",
      };
    }
    rebuiltDataset.series = {
      ...(rebuiltDataset.series ?? {}),
      intervals15,
    };
    rebuiltDataset.meta = {
      ...(rebuiltDataset.meta ?? {}),
      usageShapeProfileDiag:
        (rebuiltDataset.meta as any)?.usageShapeProfileDiag ?? ensuredUsageShape.usageShapeProfileDiag,
      profileAutoBuilt:
        (rebuiltDataset.meta as any)?.profileAutoBuilt === true || ensuredUsageShape.profileAutoBuilt === true,
      buildPathKind: "recalc",
      pastBuildIntervalsFetchCount: 1,
      // Must match shared Past simulator + compare_core stale guard (`needsRebuildForOldCurveVersion`).
      curveShapingVersion: "shared_curve_v2",
    };
    applyCanonicalCoverageMetadataForNonBaseline(rebuiltDataset, "gapfill_lab", { buildInputs });
    const canonicalArtifactSimulatedDayTotalsByDate = readCanonicalArtifactSimulatedDayTotalsByDate(rebuiltDataset);
    const { bytes } = encodeIntervalsV1(intervals15);
    const datasetJsonForStorage = {
      ...rebuiltDataset,
      canonicalArtifactSimulatedDayTotalsByDate,
      meta: {
        ...((rebuiltDataset as any)?.meta ?? {}),
        canonicalArtifactSimulatedDayTotalsByDate,
      },
      series: { ...(rebuiltDataset.series ?? {}), intervals15: [] },
    };
    await saveCachedPastDataset({
      houseId: args.houseId,
      scenarioId: resolvedScenarioId,
      inputHash: exactInputHash,
      engineVersion: PAST_ENGINE_VERSION,
      windowStartUtc: identityWindowResolved.startDate,
      windowEndUtc: identityWindowResolved.endDate,
      datasetJson: datasetJsonForStorage as Record<string, unknown>,
      intervalsCodec: INTERVAL_CODEC_V1,
      intervalsCompressed: bytes,
    });
    let verification = await runVerification(exactInputHash);
    if (!verification.ok) {
      await new Promise((r) => setTimeout(r, 800));
      verification = await runVerification(exactInputHash);
    }
    if (!verification.ok) {
      return {
        ok: false,
        error: "artifact_persist_verify_failed",
        message:
          "Shared Past artifact rebuild saved, but readback verification failed for this identity hash. Retry rebuild after cache/database pressure clears.",
      };
    }
    const verificationMeta = (((verification.dataset as any)?.meta ?? {}) as Record<string, unknown>) ?? {};
    return {
      ok: true,
      artifactSourceNote:
        typeof verificationMeta.artifactSourceNote === "string" && String(verificationMeta.artifactSourceNote).trim()
          ? String(verificationMeta.artifactSourceNote)
          : "Artifact source: exact identity match on Past input hash.",
    };
  }

  async function runEnsureAttempt(forceRebuildArtifact: boolean): Promise<
    | {
        ok: true;
        rebuilt: boolean;
        exactInputHash: string;
        artifactSourceNote: string | null;
      }
    | { ok: false; error: string; message: string; retryable: boolean }
  > {
    if (!forceRebuildArtifact) {
      const verification = await runVerification(exactInputHash);
      if (!verification.ok) {
        return {
          ok: false,
          error: "past_rebuild_failed",
          message:
            "Past rebuild completed, but the saved artifact is unavailable or missing canonical coverage metadata for artifact-only reads. Retry rebuild after DB pool pressure clears.",
          retryable: true,
        };
      }
      const verificationMeta = (((verification.dataset as any)?.meta ?? {}) as Record<string, unknown>) ?? {};
      if (sharedPastArtifactMetaFailsCurveShapingStaleGuard(verificationMeta)) {
        return {
          ok: false,
          error: "artifact_stale_rebuild_required",
          message:
            "Saved shared Past artifact predates shared curve-shaping updates. Trigger explicit rebuildArtifact=true before compare.",
          retryable: true,
        };
      }
      return {
        ok: true,
        rebuilt: false,
        exactInputHash,
        artifactSourceNote:
          typeof verificationMeta.artifactSourceNote === "string" && String(verificationMeta.artifactSourceNote).trim()
            ? String(verificationMeta.artifactSourceNote)
            : "Artifact source: exact identity match on Past input hash.",
      };
    }
    const rebuilt = await persistRebuiltArtifact();
    if (!rebuilt.ok) {
      return {
        ok: false,
        error: rebuilt.error,
        message: rebuilt.message,
        retryable: false,
      };
    }
    return {
      ok: true,
      rebuilt: true,
      exactInputHash,
      artifactSourceNote: rebuilt.artifactSourceNote,
    };
  }

  const ensured = await runEnsureAttempt(false);
  if (!ensured.ok) {
    if (!ensured.retryable) {
      return {
        ok: false,
        error: ensured.error,
        message: ensured.message,
      };
    }
    const rebuilt = await runEnsureAttempt(true);
    if (!rebuilt.ok) {
      return {
        ok: false,
        error: rebuilt.error,
        message: rebuilt.message,
      };
    }
    return {
      ok: true,
      rebuilt: rebuilt.rebuilt,
      scenarioId: resolvedScenarioId,
      artifactScenarioId: resolvedScenarioId,
      requestedInputHash: rebuilt.exactInputHash,
      artifactInputHashUsed: rebuilt.exactInputHash,
      artifactHashMatch: true,
      artifactSourceMode: "exact_hash_match",
      artifactSourceNote: rebuilt.artifactSourceNote,
    };
  }
  return {
    ok: true,
    rebuilt: ensured.rebuilt,
    scenarioId: resolvedScenarioId,
    artifactScenarioId: resolvedScenarioId,
    requestedInputHash: ensured.exactInputHash,
    artifactInputHashUsed: ensured.exactInputHash,
    artifactHashMatch: true,
    artifactSourceMode: "exact_hash_match",
    artifactSourceNote: ensured.artifactSourceNote,
  };
}

/** Shared contract for scored-day display vs fresh parity (aggregate + per-row truth in GapFill route). */
export type GapfillScoredDayParityAvailability =
  | "available"
  | "missing_expected_reference"
  | "missing_fresh_compare_sim";

export type GapfillScoredDayParityReasonCode =
  | "ARTIFACT_SIMULATED_REFERENCE_AVAILABLE"
  | "ARTIFACT_SIMULATED_REFERENCE_MISSING"
  | "SCORED_DAY_FRESH_COMPARE_SIM_MISSING";

export type GapfillScoredDayParityDisplayValueKind =
  | "artifact_simulated_day_total"
  | "missing_display_sim_reference"
  | "missing_fresh_compare_sim_day_total";

/** Machine-checkable Gap-Fill scoring source/ownership diagnostics (shared compare). */
export type GapfillScoringDiagnosticsDayRow = {
  selectedDateKey: string;
  inReferencePool: boolean;
  excludedFromReferencePoolReason: "travel_vacant" | null;
  compareOutputSource: "MODELED_SIM" | "MISSING_SIM";
  compareOutputOwnership: "simulator_owned" | "missing";
  compareOutputAuthority: "freshCompareScoredDaySimTotalsByDate";
  actualSource: "actual_usage";
  wasMeterPassthroughPrevented: boolean;
  dayModelingMode:
    | "forced_modeled_scored_day"
    | "travel_vacant_overlap_scored_day"
    | "missing_modeled_output";
  sameSharedRunAsParity: boolean;
};

export type GapfillScoringDiagnosticsRun = {
  scoringMode: "modeled_scored_days";
  referencePoolRuleSummary: string;
  testDaysInReferencePoolCount: number;
  travelVacantExcludedCount: number;
  scoredDaysModeledCount: number;
  scoredDaysMissingModeledCount: number;
  parityDaysValidatedCount: number;
  compareSharedCalcPath: string;
  compareFreshModeUsed: "selected_days" | "full_window" | "artifact_only";
  oneUnionRunUsed: boolean;
  sameSharedRunAsParity: boolean;
  actualAsSimGuardWouldTrigger: boolean;
  sharedRunFingerprint: string;
  gapfillForceModeledKeepRefLocalDateKeys?: string[];
  gapfillForceModeledKeepRefUtcKeyCount?: number;
};

export type GapfillScoringDiagnostics = {
  run: GapfillScoringDiagnosticsRun;
  scoredDays: GapfillScoringDiagnosticsDayRow[];
};

export type GapfillCompareSimSharedResult =
  | {
      ok: true;
      artifactAutoRebuilt: boolean;
      scoringSimulatedSource?:
        | "shared_artifact_simulated_intervals15"
        | "shared_fresh_simulated_intervals15"
        | "shared_selected_days_simulated_intervals15";
      scoringUsedSharedArtifact?: boolean;
      artifactBuildExcludedSource?: "shared_past_travel_vacant_excludedDateKeysFingerprint";
      scoringExcludedSource?: "shared_past_travel_vacant_excludedDateKeysFingerprint";
      artifactUsesTestDaysInIdentity?: boolean;
      artifactUsesTravelDaysInIdentity?: boolean;
      sharedArtifactScenarioId?: string | null;
      sharedArtifactInputHash?: string | null;
      comparePulledFromSharedArtifactOnly?: boolean;
      scoredTestDaysMissingSimulatedOwnershipCount?: number;
      compareSharedCalcPath?: string;
      compareCalculationScope?:
        | "artifact_read_then_scored_day_filter"
        | "full_window_shared_path_then_scored_day_filter"
        | "selected_days_shared_path_only";
      displaySimSource?: "dataset.daily" | "interval_rebucket_fallback";
      compareSimSource?: "shared_fresh_calc" | "shared_artifact_cache" | "shared_selected_days_calc";
      compareFreshModeUsed?: "selected_days" | "full_window" | "artifact_only";
      weatherBasisUsed?: string;
      artifactSimulatedDayReferenceSource?: "canonical_artifact_simulated_day_totals";
      artifactSimulatedDayReferenceRows?: Array<{ date: string; simKwh: number }>;
      travelVacantParityRows?: TravelVacantParityRow[];
      travelVacantParityTruth?: TravelVacantParityTruth;
      scoredDayWeatherRows?: ScoredDayWeatherRow[];
      scoredDayWeatherTruth?: ScoredDayWeatherTruth;
      displayVsFreshParityForScoredDays?: {
        matches: boolean | null;
        mismatchCount: number;
        mismatchSampleDates: string[];
        missingDisplaySimCount?: number;
        missingDisplaySimSampleDates?: string[];
        comparableDateCount?: number;
        complete?: boolean | null;
        availability?: GapfillScoredDayParityAvailability;
        reasonCode?: GapfillScoredDayParityReasonCode;
        missingFreshCompareSimCount?: number;
        missingFreshCompareSimSampleDates?: string[];
        explanation?: string;
        scope: "scored_test_days_local";
        granularity: "daily_kwh_rounded_2dp";
        parityDisplaySourceUsed?: "canonical_artifact_simulated_day_totals";
        parityDisplayValueKind?: GapfillScoredDayParityDisplayValueKind;
        comparisonBasis:
          | "display_shared_artifact_vs_compare_shared_full_window_then_filter"
          | "display_shared_artifact_vs_compare_artifact_filter_only"
          | "display_shared_artifact_vs_compare_selected_days_fresh_calc"
          | "artifact_simulated_display_rows_vs_compare_selected_days_fresh_calc";
      };
      timezoneUsedForScoring: string;
      windowUsedForScoring: { startDate: string; endDate: string };
      scoringTestDateKeysLocal: Set<string>;
      sharedCoverageWindow: { startDate: string; endDate: string };
      boundedTravelDateKeysLocal: Set<string>;
      artifactIntervals: IntervalPoint[];
      simulatedTestIntervals: IntervalPoint[];
      /** Canonical simulator-owned fresh compare day totals for scored dates (GapFill route; do not re-derive from interval sums in selected_days mode). */
      freshCompareScoredDaySimTotalsByDate?: Record<string, number>;
      simulatedChartIntervals: IntervalPoint[];
      simulatedChartDaily: Array<{ date: string; simKwh: number; source: "ACTUAL" | "SIMULATED" }>;
      simulatedChartMonthly: Array<{ month: string; kwh: number }>;
      simulatedChartStitchedMonth: {
        mode: "PRIOR_YEAR_TAIL";
        yearMonth: string;
        haveDaysThrough: number;
        missingDaysFrom: number;
        missingDaysTo: number;
        borrowedFromYearMonth: string;
        completenessRule: string;
      } | null;
      modelAssumptions: any;
      homeProfileFromModel: any | null;
      applianceProfileFromModel: any | null;
      gapfillScoringDiagnostics?: GapfillScoringDiagnostics;
    }
  | {
      ok: false;
      status: number;
      body: Record<string, unknown>;
    };

export type GapfillCompareBuildPhase =
  | "build_shared_compare_start"
  | "build_shared_compare_inputs_ready"
  | "build_shared_compare_weather_ready"
  | "build_shared_compare_sim_ready"
  | "build_shared_compare_scored_actual_rows_ready"
  | "build_shared_compare_scored_sim_rows_ready"
  | "build_shared_compare_scored_row_keys_ready"
  | "build_shared_compare_scored_row_alignment_ready"
  | "build_shared_compare_scored_row_merge_ready"
  | "build_shared_compare_scored_rows_ready"
  | "compact_pre_bounded_exact_parity_decode_start"
  | "compact_pre_bounded_exact_parity_decode_done"
  | "compact_pre_bounded_exact_parity_day_totals_start"
  | "compact_pre_bounded_exact_parity_day_totals_done"
  | "compact_pre_bounded_meta_read_start"
  | "compact_pre_bounded_meta_read_done"
  | "compact_pre_bounded_canonical_build_start"
  | "compact_pre_bounded_canonical_build_done"
  | "compact_pre_bounded_merge_backfill_start"
  | "compact_pre_bounded_merge_backfill_done"
  | "build_shared_compare_compact_bounded_canonical_ready"
  | "compact_pre_bounded_meta_write_start"
  | "compact_pre_bounded_meta_write_done"
  | "build_shared_compare_compact_post_scored_sim_ready"
  | "compact_post_scored_rows_parity_start"
  | "compact_post_scored_rows_parity_rows_ready"
  | "compact_post_scored_rows_parity_truth_ready"
  | "compact_post_scored_rows_parity_done"
  | "compact_post_scored_rows_metrics_start"
  | "compact_post_scored_rows_metrics_done"
  | "compact_post_scored_rows_response_start"
  | "build_shared_compare_parity_ready"
  | "build_shared_compare_metrics_ready"
  | "build_shared_compare_compact_compare_core_memory_reduced"
  | "build_shared_compare_response_ready"
  | "build_shared_compare_finalize_start";

function round2Local(n: number) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function filterIntervalsToLocalDateKeys(
  intervals: Array<{ timestamp: string; kwh: number }>,
  timezone: string,
  localDateKeys: ReadonlySet<string>
): Array<{ timestamp: string; kwh: number }> {
  if (localDateKeys.size === 0 || intervals.length === 0) return [];
  const out: Array<{ timestamp: string; kwh: number }> = [];
  for (const row of intervals) {
    const timestamp = canonicalIntervalKey(String(row?.timestamp ?? "").trim());
    if (!timestamp) continue;
    if (!localDateKeys.has(dateKeyInTimezone(timestamp, timezone))) continue;
    out.push({
      timestamp,
      kwh: Number(row?.kwh) || 0,
    });
  }
  return out;
}

/**
 * When canonical per-day totals are sparse but interval rows exist for bounded keys, fill missing or
 * non-finite map entries from interval sums (simulator-owned truth for those days).
 */
function mergeSparseDailyTotalsFromIntervalsForBoundedKeys(
  totalsByDate: Map<string, number>,
  intervals: Array<{ timestamp: string; kwh: number }>,
  boundedDateKeysLocal: ReadonlySet<string>,
  timezone: string
): void {
  if (intervals.length === 0) return;
  const fromIntervals = new Map<string, number>();
  for (const p of intervals) {
    const dk = dateKeyInTimezone(p.timestamp, timezone);
    if (!boundedDateKeysLocal.has(dk)) continue;
    fromIntervals.set(dk, (fromIntervals.get(dk) ?? 0) + (Number(p.kwh) || 0));
  }
  for (const dk of Array.from(boundedDateKeysLocal)) {
    const iv = fromIntervals.get(dk);
    if (iv === undefined || !Number.isFinite(iv)) continue;
    const existing = totalsByDate.get(dk);
    if (!Number.isFinite(Number(existing))) {
      totalsByDate.set(dk, round2Local(iv));
    }
  }
}

const CANONICAL_ARTIFACT_SIMULATED_DAY_TOTALS_META_KEY = "canonicalArtifactSimulatedDayTotalsByDate";

function readCanonicalArtifactSimulatedDayTotalsByDate(dataset: any): CanonicalArtifactSimulatedDayTotalsByDate {
  const raw =
    (dataset as any)?.meta?.[CANONICAL_ARTIFACT_SIMULATED_DAY_TOTALS_META_KEY] ??
    (dataset as any)?.[CANONICAL_ARTIFACT_SIMULATED_DAY_TOTALS_META_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: CanonicalArtifactSimulatedDayTotalsByDate = {};
  for (const [date, value] of Object.entries(raw as Record<string, unknown>)) {
    const dk = String(date ?? "").slice(0, 10);
    const kwh = Number(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dk) || !Number.isFinite(kwh)) continue;
    out[dk] = round2Local(kwh);
  }
  return out;
}

export function releaseSimulatedDayResultBuffers(results: SimulatedDayResult[] | undefined): {
  releasedDayCount: number;
  releasedIntervalCount: number;
} {
  let releasedDayCount = 0;
  let releasedIntervalCount = 0;
  for (const result of results ?? []) {
    const intervals = Array.isArray(result?.intervals) ? result.intervals : [];
    const intervals15 = Array.isArray(result?.intervals15) ? result.intervals15 : [];
    const shape96Used = Array.isArray((result as any)?.shape96Used) ? (result as any).shape96Used : [];
    if (intervals.length > 0 || intervals15.length > 0 || shape96Used.length > 0) releasedDayCount += 1;
    releasedIntervalCount += intervals.length;
    if (intervals.length > 0) intervals.length = 0;
    if (intervals15.length > 0) intervals15.length = 0;
    if (shape96Used.length > 0) shape96Used.length = 0;
  }
  return { releasedDayCount, releasedIntervalCount };
}

/** Meta read scoped to explicit date keys only (compact compare_core: avoid building a full-year output map). */
function readCanonicalArtifactSimulatedDayTotalsByDateForDateKeys(
  dataset: any,
  dateKeys: Set<string>
): CanonicalArtifactSimulatedDayTotalsByDate {
  const raw =
    (dataset as any)?.meta?.[CANONICAL_ARTIFACT_SIMULATED_DAY_TOTALS_META_KEY] ??
    (dataset as any)?.[CANONICAL_ARTIFACT_SIMULATED_DAY_TOTALS_META_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: CanonicalArtifactSimulatedDayTotalsByDate = {};
  for (const [date, value] of Object.entries(raw as Record<string, unknown>)) {
    const dk = String(date ?? "").slice(0, 10);
    const kwh = Number(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dk) || !Number.isFinite(kwh)) continue;
    if (!dateKeys.has(dk)) continue;
    out[dk] = round2Local(kwh);
  }
  return out;
}

/**
 * When meta omits a bounded date key but the persisted artifact `daily` row is simulator-owned
 * (`source: SIMULATED`), use that row's kWh as the same artifact-side reference authority for
 * scored-day / parity display (no ACTUAL / passthrough rows).
 */
function augmentCanonicalArtifactSimulatedDayTotalsFromArtifactDailySimulated(
  dataset: any,
  base: CanonicalArtifactSimulatedDayTotalsByDate,
  limitDateKeys: Set<string>
): CanonicalArtifactSimulatedDayTotalsByDate {
  if (limitDateKeys.size === 0) return base;
  const out: CanonicalArtifactSimulatedDayTotalsByDate = { ...base };
  const daily = Array.isArray((dataset as any)?.daily)
    ? ((dataset as any).daily as Array<{ date?: string; kwh?: number; source?: string }>)
    : [];
  for (const row of daily) {
    const dk = String(row?.date ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dk) || !limitDateKeys.has(dk)) continue;
    if (out[dk] !== undefined && Number.isFinite(Number(out[dk]))) continue;
    const src = String(row?.source ?? "").trim().toUpperCase();
    if (src !== "SIMULATED") continue;
    const kwh = Number(row?.kwh);
    if (!Number.isFinite(kwh)) continue;
    out[dk] = round2Local(kwh);
  }
  return out;
}

/**
 * Persisted Past cache rows may omit `meta.validationOnlyDateKeysLocal` while `usageSimulatorBuild.buildInputs`
 * still holds the authoritative list. Without keys, `attachValidationCompareProjection` is a no-op (logs success
 * but emits no rows) while daily rows can still show SIMULATED_TEST_DAY. Merge keys from build inputs before
 * baseline projection + attach; back-fill sparse canonical per-day totals from SIMULATED daily rows for those keys only.
 */
function rehydrateValidationCompareMetaFromBuildInputsForRead(args: {
  dataset: any;
  buildInputs: Record<string, unknown> | null | undefined;
}): void {
  const { dataset, buildInputs } = args;
  if (!dataset || typeof dataset !== "object") return;
  const fromBuild =
    buildInputs && typeof buildInputs === "object" && Array.isArray((buildInputs as any).validationOnlyDateKeysLocal)
      ? ((buildInputs as any).validationOnlyDateKeysLocal as unknown[])
          .map((v) => String(v ?? "").slice(0, 10))
          .filter((dk) => /^\d{4}-\d{2}-\d{2}$/.test(dk))
      : [];
  const prevMeta = dataset.meta && typeof dataset.meta === "object" ? { ...(dataset.meta as Record<string, unknown>) } : {};
  const existing =
    Array.isArray((prevMeta as any).validationOnlyDateKeysLocal) &&
    (prevMeta as any).validationOnlyDateKeysLocal.length > 0
      ? ((prevMeta as any).validationOnlyDateKeysLocal as unknown[])
          .map((v) => String(v ?? "").slice(0, 10))
          .filter((dk) => /^\d{4}-\d{2}-\d{2}$/.test(dk))
      : [];
  if (existing.length === 0 && fromBuild.length > 0) {
    (prevMeta as any).validationOnlyDateKeysLocal = fromBuild;
    dataset.meta = prevMeta;
  }

  const rawKeys = Array.isArray((dataset as any)?.meta?.validationOnlyDateKeysLocal)
    ? ((dataset as any).meta.validationOnlyDateKeysLocal as unknown[])
    : [];
  const validationOnlyDateKeysLocal = rawKeys
    .map((v) => String(v ?? "").slice(0, 10))
    .filter((dk) => /^\d{4}-\d{2}-\d{2}$/.test(dk));
  if (validationOnlyDateKeysLocal.length === 0) return;
  const keySet = new Set(validationOnlyDateKeysLocal);
  let base = readCanonicalArtifactSimulatedDayTotalsByDate(dataset);
  base = augmentCanonicalArtifactSimulatedDayTotalsFromArtifactDailySimulated(dataset, base, keySet);
  const mergedMeta = dataset.meta && typeof dataset.meta === "object" ? { ...(dataset.meta as Record<string, unknown>) } : {};
  const prevCanon =
    typeof (mergedMeta as any)[CANONICAL_ARTIFACT_SIMULATED_DAY_TOTALS_META_KEY] === "object" &&
    (mergedMeta as any)[CANONICAL_ARTIFACT_SIMULATED_DAY_TOTALS_META_KEY] !== null &&
    !Array.isArray((mergedMeta as any)[CANONICAL_ARTIFACT_SIMULATED_DAY_TOTALS_META_KEY])
      ? ((mergedMeta as any)[CANONICAL_ARTIFACT_SIMULATED_DAY_TOTALS_META_KEY] as Record<string, number>)
      : {};
  (mergedMeta as any)[CANONICAL_ARTIFACT_SIMULATED_DAY_TOTALS_META_KEY] = { ...prevCanon, ...base };
  dataset.meta = mergedMeta;
  const rootPrev =
    typeof (dataset as any)[CANONICAL_ARTIFACT_SIMULATED_DAY_TOTALS_META_KEY] === "object" &&
    (dataset as any)[CANONICAL_ARTIFACT_SIMULATED_DAY_TOTALS_META_KEY] !== null &&
    !Array.isArray((dataset as any)[CANONICAL_ARTIFACT_SIMULATED_DAY_TOTALS_META_KEY])
      ? ((dataset as any)[CANONICAL_ARTIFACT_SIMULATED_DAY_TOTALS_META_KEY] as Record<string, number>)
      : {};
  (dataset as any)[CANONICAL_ARTIFACT_SIMULATED_DAY_TOTALS_META_KEY] = { ...rootPrev, ...base };
}

function hasLegacyWeatherEfficiencySimulationActivation(value: unknown): boolean {
  return false;
}

function normalizeLegacyWeatherEfficiencyBuildInputs<T extends Record<string, unknown>>(buildInputs: T): T {
  return buildInputs;
}

function restoreCachedArtifactDataset(args: {
  cached: CachedPastDataset;
  useSelectedDaysLightweightArtifactRead: boolean;
  fallbackEndDate: string;
  skipAggregateRecompute?: boolean;
}): {
  dataset: any;
  restoredCanonicalDailyRows: Array<{ date?: string; kwh?: number; source?: string }> | null;
  restoredCanonicalMonthlyRows: Array<{ month?: string; kwh?: number }> | null;
} {
  const {
    cached,
    useSelectedDaysLightweightArtifactRead,
    fallbackEndDate,
    skipAggregateRecompute = false,
  } = args;
  const restoredCanonicalDailyRows = Array.isArray((cached.datasetJson as any)?.daily)
    ? (((cached.datasetJson as any).daily as Array<{ date?: string; kwh?: number; source?: string }>).map((d) => ({
        date: d?.date,
        kwh: d?.kwh,
        source: d?.source,
      })))
    : null;
  const restoredCanonicalMonthlyRows = Array.isArray((cached.datasetJson as any)?.monthly)
    ? (((cached.datasetJson as any).monthly as Array<{ month?: string; kwh?: number }>).map((m) => ({
        month: m?.month,
        kwh: m?.kwh,
      })))
    : null;
  const dataset = {
    ...cached.datasetJson,
    series: {
      ...(typeof (cached.datasetJson as any).series === "object" &&
      (cached.datasetJson as any).series !== null
        ? (cached.datasetJson as any).series
        : {}),
      intervals15: useSelectedDaysLightweightArtifactRead ? [] : decodeIntervalsV1(cached.intervalsCompressed),
    },
  };
  if (!useSelectedDaysLightweightArtifactRead && !skipAggregateRecompute) {
    reconcileRestoredPastDatasetFromDecodedIntervals({
      dataset,
      decodedIntervals: dataset.series.intervals15 as Array<{ timestamp: string; kwh: number }>,
      fallbackEndDate,
    });
  }
  return {
    dataset,
    restoredCanonicalDailyRows,
    restoredCanonicalMonthlyRows,
  };
}

function enumerateDateKeysInclusive(startDate: string, endDate: string): Set<string> {
  const out = new Set<string>();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return out;
  if (endDate < startDate) return out;
  let y = Number(startDate.slice(0, 4));
  let m = Number(startDate.slice(5, 7));
  let d = Number(startDate.slice(8, 10));
  const endY = Number(endDate.slice(0, 4));
  const endM = Number(endDate.slice(5, 7));
  const endD = Number(endDate.slice(8, 10));
  while (true) {
    const key = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    out.add(key);
    if (y === endY && m === endM && d === endD) break;
    const next = new Date(Date.UTC(y, m - 1, d) + 24 * 60 * 60 * 1000);
    y = next.getUTCFullYear();
    m = next.getUTCMonth() + 1;
    d = next.getUTCDate();
  }
  return out;
}

function dateKeysToRanges(dateKeys: Set<string>): DateRange[] {
  const sorted = Array.from(dateKeys).sort();
  if (sorted.length === 0) return [];
  const out: DateRange[] = [];
  let rangeStart = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i];
    const nextOfPrev = new Date(`${prev}T12:00:00.000Z`);
    nextOfPrev.setUTCDate(nextOfPrev.getUTCDate() + 1);
    const expected = nextOfPrev.toISOString().slice(0, 10);
    if (cur !== expected) {
      out.push({ startDate: rangeStart, endDate: prev });
      rangeStart = cur;
    }
    prev = cur;
  }
  out.push({ startDate: rangeStart, endDate: prev });
  return out;
}

function throwIfGapfillCompareAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  const err = new Error("compare_core_build_aborted");
  (err as any).code = "compare_core_build_aborted";
  throw err;
}

export async function buildGapfillCompareSimShared(args: {
  userId: string;
  houseId: string;
  timezone: string;
  canonicalWindow: { startDate: string; endDate: string };
  testDateKeysLocal: Set<string>;
  travelSimulatedDateKeysLocal?: Set<string>;
  rebuildArtifact: boolean;
  autoEnsureArtifact?: boolean;
  compareFreshMode?: "selected_days" | "full_window";
  includeFreshCompareCalc?: boolean;
  selectedDaysLightweightArtifactRead?: boolean;
  artifactExactScenarioId?: string | null;
  artifactExactInputHash?: string | null;
  requireExactArtifactMatch?: boolean;
  artifactIdentitySource?: "same_run_artifact_ensure" | "manual_request" | null;
  /** When false with selected-days lightweight compare, skip heavy chart/monthly display materialization (Gap-Fill compare_core memory). Default true preserves legacy test/caller behavior. */
  includeDiagnostics?: boolean;
  /** When false with selected-days lightweight compare, skip heavy chart/monthly display materialization. Default true preserves legacy test/caller behavior. */
  includeFullReportText?: boolean;
  onPhaseUpdate?: (
    phase: GapfillCompareBuildPhase,
    meta?: Record<string, unknown>
  ) => void | Promise<void>;
  /** When aborted (client disconnect or route deadline), stop work so the serverless invocation can end with the HTTP response. */
  abortSignal?: AbortSignal;
  /**
   * When set, `simulatePastUsageDataset` skips its own `getActualIntervalsForRange` for the identity window.
   * Gap-Fill compare_core should pass the same intervals already loaded in the route (canonical coverage window)
   * to avoid holding two full-year interval arrays during selected-days / full-window fresh sim.
   */
  preloadedIdentityActualIntervals?: Array<{ timestamp: string; kwh: number }>;
  /** Observability: threaded into cold/shared Past sim via `getPastSimulatedDatasetForHouse` → `simulatePastUsageDataset`. */
  correlationId?: string;
}): Promise<GapfillCompareSimSharedResult> {
  const {
    userId,
    houseId,
    timezone: requestTimezone,
    canonicalWindow,
    testDateKeysLocal,
    rebuildArtifact,
    autoEnsureArtifact = false,
    compareFreshMode,
    includeFreshCompareCalc = true,
    selectedDaysLightweightArtifactRead = false,
    artifactExactScenarioId = null,
    artifactExactInputHash = null,
    requireExactArtifactMatch = false,
    artifactIdentitySource = null,
    includeDiagnostics = true,
    includeFullReportText = true,
    onPhaseUpdate,
    abortSignal,
    preloadedIdentityActualIntervals,
    correlationId: compareSharedCorrelationId,
  } = args;
  const actualIntervalsForSharedPastSim =
    preloadedIdentityActualIntervals != null && preloadedIdentityActualIntervals.length > 0
      ? preloadedIdentityActualIntervals
      : undefined;
  const reportPhase = async (
    phase: GapfillCompareBuildPhase,
    meta?: Record<string, unknown>
  ) => {
    throwIfGapfillCompareAborted(abortSignal);
    if (!onPhaseUpdate) return;
    try {
      await onPhaseUpdate(phase, meta);
    } catch {
      // Phase reporting is best-effort observability and must not alter compare behavior.
    }
  };
  // Canonical scored-day fresh totals (see freshDailyTotalsByDate) apply when includeFreshCompareCalc is true.
  // GapFill compare_core always passes true via gapfillCompareCoreContract; explicit false is for tests/opt-out.
  const effectiveCompareFreshMode = compareFreshMode ?? "selected_days";
  let useSelectedDaysLightweightArtifactRead =
    selectedDaysLightweightArtifactRead === true &&
    effectiveCompareFreshMode === "selected_days" &&
    !rebuildArtifact &&
    !autoEnsureArtifact;

  const pastScenarioId = await resolvePastScenarioIdForHouse({ userId, houseId });
  if (!pastScenarioId) {
    return {
      ok: false,
      status: 404,
      body: {
        ok: false,
        error: "no_past_scenario",
        message: "No Past (Corrected) scenario found for this house.",
      },
    };
  }

  const house = await getHouseAddressForUserHouse({ userId, houseId }).catch(() => null);
  if (!house) {
    return {
      ok: false,
      status: 404,
      body: {
        ok: false,
        error: "house_not_found",
        message: "House not found for user.",
      },
    };
  }

  const buildRec = await (prisma as any).usageSimulatorBuild
    ?.findUnique({
      where: { userId_houseId_scenarioKey: { userId, houseId, scenarioKey: pastScenarioId } },
      select: { buildInputs: true },
    })
    ?.catch(() => null);
  if (!buildRec?.buildInputs) {
    return {
      ok: false,
      status: 400,
      body: {
        ok: false,
        error: "past_build_missing",
        message: "Past build inputs are missing. Rebuild Past first.",
        mode: "artifact_only",
        scenarioId: pastScenarioId,
      },
    };
  }
  const buildInputs = buildRec.buildInputs as SimulatorBuildInputsV1;
  const identityWindow = resolveWindowFromBuildInputsForPastIdentity(buildInputs);
  if (!identityWindow) {
    return {
      ok: false,
      status: 409,
      body: {
        ok: false,
        error: "artifact_missing_rebuild_required",
        message: "Past identity window is unavailable. Trigger explicit rebuildArtifact=true before compare.",
        mode: "artifact_only",
        scenarioId: pastScenarioId,
      },
    };
  }
  const identityWindowResolved = identityWindow!;
  const houseResolved = house!;
  const timezone = String((buildInputs as any)?.timezone ?? requestTimezone ?? "America/Chicago");
  const buildTravelRanges = travelRangesFromBuildInputs(buildInputs);
  const sharedCoverageWindow = resolveCanonicalUsage365CoverageWindow();
  const boundedTravelDateKeysLocal = boundDateKeysToCoverageWindow(
    new Set<string>(travelRangesToExcludeDateKeys(buildTravelRanges)),
    sharedCoverageWindow
  );
  // Exact travel/vacant parity now compares saved canonical artifact totals against fresh canonical
  // shared totals, so artifact interval decoding is no longer required as a second truth path.
  const exactTravelParityRequiresIntervalBackedArtifactTruth = false;
  const boundedTestDateKeysLocal = boundDateKeysToCoverageWindow(testDateKeysLocal, sharedCoverageWindow);
  const travelFingerprint = Array.from(boundedTravelDateKeysLocal).sort().join(",");
  const chartDateKeysLocal = enumerateDateKeysInclusive(canonicalWindow.startDate, canonicalWindow.endDate);
  const travelVacantParityDateKeysLocal = Array.from(boundedTravelDateKeysLocal)
    .filter((dk) => chartDateKeysLocal.has(dk))
    .sort((a, b) => (a < b ? -1 : 1));
  const expectedChartIntervalCount = chartDateKeysLocal.size * 96;

  const sharedScenarioCacheId = pastScenarioId;
  const requestedArtifactScenarioId =
    typeof artifactExactScenarioId === "string" && artifactExactScenarioId.trim()
      ? artifactExactScenarioId.trim()
      : sharedScenarioCacheId;
  const requestedArtifactInputHash =
    typeof artifactExactInputHash === "string" && artifactExactInputHash.trim()
      ? artifactExactInputHash.trim()
      : "";
  const exactArtifactIdentityRequested = requestedArtifactInputHash.length > 0;
  const exactArtifactReadRequired = exactArtifactIdentityRequested && requireExactArtifactMatch === true;
  /**
   * Selected-days Gap-Fill compare_core: omit heavy chart/monthly/display materialization when the
   * client requested selected-days lightweight compare (diagnostics/full report off, no rebuild).
   * Intentionally does NOT require `useSelectedDaysLightweightArtifactRead` so exact-identity
   * selected-days compares can keep the lightweight artifact read while still running canonical
   * parity against shared outputs.
   */
  const compareCoreMemoryReducedPath =
    selectedDaysLightweightArtifactRead === true &&
    effectiveCompareFreshMode === "selected_days" &&
    !rebuildArtifact &&
    !autoEnsureArtifact &&
    includeDiagnostics !== true &&
    includeFullReportText !== true;
  let sharedInputHash = exactArtifactIdentityRequested ? requestedArtifactInputHash : "";
  if (!exactArtifactIdentityRequested) {
    const intervalDataFingerprint = await getIntervalDataFingerprint({
      houseId,
      esiid: houseResolved.esiid ?? null,
      startDate: identityWindowResolved.startDate,
      endDate: identityWindowResolved.endDate,
    });
    const usageShapeProfileIdentity = await getUsageShapeProfileIdentityForPast(houseId);
    const sourceHouseIdForWeather = String((buildInputs as any)?.actualContextHouseId ?? houseId);
    const weatherIdentity = await computePastWeatherIdentity({
      houseId: sourceHouseIdForWeather,
      startDate: identityWindowResolved.startDate,
      endDate: identityWindowResolved.endDate,
      weatherLogicMode: resolveWeatherLogicModeFromBuildInputs(buildInputs as Record<string, unknown>),
    });
    sharedInputHash = computePastInputHash({
      engineVersion: PAST_ENGINE_VERSION,
      windowStartUtc: identityWindowResolved.startDate,
      windowEndUtc: identityWindowResolved.endDate,
      timezone,
      travelRanges: buildTravelRanges,
      buildInputs: buildInputs as Record<string, unknown>,
      intervalDataFingerprint,
      usageShapeProfileId: usageShapeProfileIdentity.usageShapeProfileId,
      usageShapeProfileVersion: usageShapeProfileIdentity.usageShapeProfileVersion,
      usageShapeProfileDerivedAt: usageShapeProfileIdentity.usageShapeProfileDerivedAt,
      usageShapeProfileSimHash: usageShapeProfileIdentity.usageShapeProfileSimHash,
      weatherIdentity,
    });
  }
  const artifactIdentitySourceNormalized =
    artifactIdentitySource === "same_run_artifact_ensure" || artifactIdentitySource === "manual_request"
      ? artifactIdentitySource
      : null;
  if (
    useSelectedDaysLightweightArtifactRead &&
    exactArtifactIdentityRequested &&
    requestedArtifactScenarioId !== sharedScenarioCacheId
  ) {
    return {
      ok: false,
      status: 409,
      body: {
        ok: false,
        error: "artifact_exact_identity_mismatch_rebuild_required",
        message:
          "Compare expected an exact shared Past artifact identity from artifact ensure, but the requested scenario does not match the active Past scenario.",
        mode: "artifact_only",
        scenarioId: sharedScenarioCacheId,
        requestedArtifactScenarioId,
        requestedInputHash: requestedArtifactInputHash,
        requireExactArtifactMatch: exactArtifactReadRequired,
        artifactIdentitySource: artifactIdentitySourceNormalized,
        fallbackOccurred: false,
        fallbackReason: "requested_exact_scenario_mismatch",
      },
    };
  }

  let artifactAutoRebuilt = false;
  let dataset: any = null;
  let restoredCanonicalDailyRows:
    | Array<{ date?: string; kwh?: number; source?: string }>
    | null = null;
  let restoredCanonicalMonthlyRows:
    | Array<{ month?: string; kwh?: number }>
    | null = null;
  async function verifyRebuiltArtifactReadable(): Promise<CachedPastDataset | null> {
    const runReadback = async () => {
      const persisted = await getCachedPastDataset({
        houseId,
        scenarioId: sharedScenarioCacheId,
        inputHash: sharedInputHash,
      });
      if (!persisted || persisted.intervalsCodec !== INTERVAL_CODEC_V1) return null;
      try {
        const decoded = decodeIntervalsV1(persisted.intervalsCompressed);
        return Array.isArray(decoded) && decoded.length > 0 ? persisted : null;
      } catch {
        return null;
      }
    };
    let readable = await runReadback();
    if (!readable) {
      await new Promise((r) => setTimeout(r, 800));
      readable = await runReadback();
    }
    return readable;
  }
  async function rebuildSharedArtifactDataset(): Promise<{
    ok: true;
    dataset: any;
  } | {
    ok: false;
    status: number;
    body: Record<string, unknown>;
  }> {
    const keepRefDateKeysLocal = resolveProducerKeepRefDateKeysFromBuildInputs({
      buildInputs,
      startDate: identityWindowResolved.startDate,
      endDate: identityWindowResolved.endDate,
    });
    const pastResult = await getPastSimulatedDatasetForHouse({
      userId,
      houseId,
      esiid: houseResolved.esiid ?? null,
      travelRanges: buildTravelRanges,
      buildInputs,
      startDate: identityWindowResolved.startDate,
      endDate: identityWindowResolved.endDate,
      timezone,
      buildPathKind: "recalc",
      forceModeledOutputKeepReferencePoolDateKeysLocal:
        keepRefDateKeysLocal.size > 0 ? keepRefDateKeysLocal : undefined,
      // Exact artifact parity depends on canonical simulated-day totals from the shared build.
      includeSimulatedDayResults: true,
      correlationId: compareSharedCorrelationId,
    });
    if (pastResult.dataset === null) {
      return {
        ok: false,
        status: 500,
        body: {
          ok: false,
          error: "past_rebuild_failed",
          message: pastResult.error ?? "Failed to build shared Past artifact.",
          mode: "artifact_only",
          scenarioId: sharedScenarioCacheId,
        },
      };
    }
    const rebuiltDataset = pastResult.dataset;
    if (!rebuiltDataset || !Array.isArray(rebuiltDataset?.series?.intervals15)) {
      return {
        ok: false,
        status: 500,
        body: {
          ok: false,
          error: "artifact_read_failed",
          message: "Shared Past artifact build completed, but intervals15 are missing.",
          mode: "artifact_only",
          scenarioId: sharedScenarioCacheId,
        },
      };
    }
    const intervals15 = rebuiltDataset.series.intervals15 as Array<{ timestamp: string; kwh: number }>;
    // Persist canonical shared-window ownership metadata with rebuilt artifacts so compare
    // fallback compatibility checks and scope diagnostics use the same bounded fingerprint.
    applyCanonicalCoverageMetadataForNonBaseline(rebuiltDataset, "gapfill_lab", { buildInputs });
    const canonicalArtifactSimulatedDayTotalsByDate = readCanonicalArtifactSimulatedDayTotalsByDate(rebuiltDataset);
    const { bytes } = encodeIntervalsV1(intervals15);
    const datasetJsonForStorage = {
      ...rebuiltDataset,
      canonicalArtifactSimulatedDayTotalsByDate,
      meta: {
        ...((rebuiltDataset as any)?.meta ?? {}),
        canonicalArtifactSimulatedDayTotalsByDate,
      },
      series: { ...(rebuiltDataset.series ?? {}), intervals15: [] },
    };
    await saveCachedPastDataset({
      houseId,
      scenarioId: sharedScenarioCacheId,
      inputHash: sharedInputHash,
      engineVersion: PAST_ENGINE_VERSION,
      windowStartUtc: identityWindowResolved.startDate,
      windowEndUtc: identityWindowResolved.endDate,
      datasetJson: datasetJsonForStorage as Record<string, unknown>,
      intervalsCodec: INTERVAL_CODEC_V1,
      intervalsCompressed: bytes,
    });
    const persistedExactArtifact = await verifyRebuiltArtifactReadable();
    if (!persistedExactArtifact) {
      return {
        ok: false,
        status: 500,
        body: {
          ok: false,
          error: "artifact_persist_verify_failed",
          message:
            "Shared Past artifact rebuild saved, but readback verification failed for this identity hash. Retry rebuild after cache/database pressure clears.",
          mode: "artifact_only",
          scenarioId: sharedScenarioCacheId,
        },
      };
    }
    return {
      ok: true,
      dataset: restoreCachedArtifactDataset({
        cached: persistedExactArtifact,
        useSelectedDaysLightweightArtifactRead,
        fallbackEndDate: identityWindowResolved.endDate,
      }).dataset,
    };
  }

  let artifactSourceMode: "exact_hash_match" | null = rebuildArtifact ? null : "exact_hash_match";
  let cached = !rebuildArtifact
    ? exactArtifactIdentityRequested
      ? await getCachedPastDataset({
          houseId,
          scenarioId: requestedArtifactScenarioId,
          inputHash: requestedArtifactInputHash,
        })
      : await getCachedPastDataset({
          houseId,
          scenarioId: sharedScenarioCacheId,
          inputHash: sharedInputHash,
        })
    : null;
  if (
    useSelectedDaysLightweightArtifactRead &&
    exactArtifactIdentityRequested &&
    (!cached || cached.intervalsCodec !== INTERVAL_CODEC_V1)
  ) {
    return {
      ok: false,
      status: 409,
      body: {
        ok: false,
        error: "artifact_exact_identity_missing_rebuild_required",
        message:
          "Compare expected the exact shared Past artifact rebuilt earlier in this run, but that scenario/inputHash could not be read. Re-run artifact ensure before compare.",
        mode: "artifact_only",
        scenarioId: sharedScenarioCacheId,
        requestedArtifactScenarioId,
        requestedInputHash: requestedArtifactInputHash,
        requireExactArtifactMatch: exactArtifactReadRequired,
        artifactIdentitySource: artifactIdentitySourceNormalized,
        artifactSourceMode: "exact_hash_match",
        fallbackOccurred: false,
        fallbackReason: "requested_exact_identity_not_found",
      },
    };
  }
  if (cached && cached.intervalsCodec === INTERVAL_CODEC_V1) {
    const restored = restoreCachedArtifactDataset({
      cached,
      useSelectedDaysLightweightArtifactRead,
      fallbackEndDate: identityWindow.endDate,
      // Compact selected-days compare already reads canonical daily/monthly truth from stored
      // artifact rows, so exact-parity interval decode does not need to rebuild aggregates first.
      skipAggregateRecompute: compareCoreMemoryReducedPath,
    });
    restoredCanonicalDailyRows = restored.restoredCanonicalDailyRows;
    restoredCanonicalMonthlyRows = restored.restoredCanonicalMonthlyRows;
    dataset = restored.dataset;
  } else {
    if (!rebuildArtifact && !autoEnsureArtifact) {
      return {
        ok: false,
        status: 409,
        body: {
          ok: false,
          error: "artifact_missing_rebuild_required",
          message:
            "No saved shared Past artifact found for this identity. Trigger explicit rebuildArtifact=true before compare.",
          mode: "artifact_only",
          scenarioId: sharedScenarioCacheId,
        },
      };
    }
    const rebuilt = await rebuildSharedArtifactDataset();
    if (!rebuilt.ok) return rebuilt;
    dataset = rebuilt.dataset;
    artifactAutoRebuilt = true;
    artifactSourceMode = "exact_hash_match";
  }

  if (!dataset?.series?.intervals15) {
    return {
      ok: false,
      status: 500,
      body: {
        ok: false,
        error: "artifact_read_failed",
        message: "Saved shared Past artifact missing intervals15 series.",
        code: "INTERNAL_ERROR",
      },
    };
  }

  let restoredMetaNormalized: Record<string, unknown> = {};
  for (let pass = 0; pass < 2; pass++) {
    // Lightweight selected-days compare reads skip hash recomputation but still
    // need ownership metadata (excluded fingerprint/count) from current travel ranges.
    applyCanonicalCoverageMetadataForNonBaseline(
      dataset,
      "gapfill_lab",
      useSelectedDaysLightweightArtifactRead ? { buildInputs } : undefined
    );
    restoredMetaNormalized = { ...(((dataset as any)?.meta ?? {}) as Record<string, unknown>) };
    const artifactIntervalsRaw = dataset.series.intervals15 as Array<{ timestamp: string; kwh: number }>;
    // Lightweight selected-days compare reads score from fresh selected-day simulation.
    // Full-window artifact interval completeness is not required for this mode.
    const enforceArtifactCompleteness = !useSelectedDaysLightweightArtifactRead;
    const needsRebuildForStaleWindow =
      enforceArtifactCompleteness &&
      !rebuildArtifact &&
      artifactIntervalsRaw.length > 0 &&
      artifactIntervalsRaw.length < expectedChartIntervalCount;
    const needsRebuildForOldCurveVersion =
      !rebuildArtifact && sharedPastArtifactMetaFailsCurveShapingStaleGuard(restoredMetaNormalized);
    const needsRebuildForLegacyWeatherActivation =
      !rebuildArtifact && hasLegacyWeatherEfficiencySimulationActivation(dataset);
    const excludedFingerprintFromMeta = String(restoredMetaNormalized?.excludedDateKeysFingerprint ?? "")
      .split(",")
      .map((dk) => String(dk).trim())
      .filter((dk) => /^\d{4}-\d{2}-\d{2}$/.test(dk));
    const hasOwnershipScopeMismatch = excludedFingerprintFromMeta.join(",") !== travelFingerprint;
    const shouldAutoRebuildNow =
      autoEnsureArtifact &&
      !artifactAutoRebuilt &&
      (
        needsRebuildForStaleWindow ||
        needsRebuildForOldCurveVersion ||
        needsRebuildForLegacyWeatherActivation ||
        hasOwnershipScopeMismatch
      );
    if (shouldAutoRebuildNow) {
      const rebuilt = await rebuildSharedArtifactDataset();
      if (!rebuilt.ok) return rebuilt;
      dataset = rebuilt.dataset;
    artifactAutoRebuilt = true;
    artifactSourceMode = "exact_hash_match";
    continue;
    }
    if (needsRebuildForStaleWindow) {
      return {
        ok: false,
        status: 409,
        body: {
          ok: false,
          error: "artifact_stale_rebuild_required",
          message:
            "Saved shared Past artifact is stale/incomplete for this canonical window. Trigger explicit rebuildArtifact=true before compare.",
          mode: "artifact_only",
          scenarioId: sharedScenarioCacheId,
        },
      };
    }
    if (needsRebuildForOldCurveVersion) {
      return {
        ok: false,
        status: 409,
        body: {
          ok: false,
          error: "artifact_stale_rebuild_required",
          message:
            "Saved shared Past artifact predates shared curve-shaping updates. Trigger explicit rebuildArtifact=true before compare.",
          mode: "artifact_only",
          scenarioId: sharedScenarioCacheId,
        },
      };
    }
    if (needsRebuildForLegacyWeatherActivation) {
      return {
        ok: false,
        status: 409,
        body: {
          ok: false,
          error: "artifact_stale_rebuild_required",
          message:
            "Saved shared Past artifact was written during the reverted weather-efficiency simulation activation window. Trigger explicit rebuildArtifact=true before compare.",
          mode: "artifact_only",
          scenarioId: sharedScenarioCacheId,
        },
      };
    }
    if (hasOwnershipScopeMismatch) {
      return {
        ok: false,
        status: 409,
        body: {
          ok: false,
          error: "artifact_scope_mismatch_rebuild_required",
          message:
            "Saved shared Past artifact travel/vacant ownership metadata does not match shared travel scope. Trigger explicit rebuildArtifact=true before compare.",
          mode: "artifact_only",
          scenarioId: sharedScenarioCacheId,
        },
      };
    }
    break;
  }
  const quality = validateSharedSimQuality(dataset);
  if (!quality.ok) {
    return {
      ok: false,
      status: 500,
      body: {
        ok: false,
        error: "artifact_read_failed",
        message: quality.message,
        code: "INTERNAL_ERROR",
      },
    };
  }

  if (!restoredMetaNormalized || typeof restoredMetaNormalized !== "object") (dataset as any).meta = {};
  const modelAssumptions = (dataset as any)?.meta ?? {};
  const artifactInputHashUsed =
    typeof (cached as any)?.inputHash === "string"
      ? String((cached as any).inputHash)
      : exactArtifactIdentityRequested
        ? null
        : sharedInputHash || null;
  const requestedInputHash = exactArtifactIdentityRequested ? requestedArtifactInputHash : sharedInputHash;
  modelAssumptions.artifactReadMode = "artifact_only";
  modelAssumptions.artifactSource = artifactAutoRebuilt ? "rebuild" : "past_cache";
  modelAssumptions.artifactScenarioId = sharedScenarioCacheId;
  modelAssumptions.artifactInputHash = artifactInputHashUsed;
  modelAssumptions.artifactInputHashUsed = artifactInputHashUsed;
  modelAssumptions.requestedInputHash = requestedInputHash;
  modelAssumptions.artifactHashMatch =
    typeof requestedInputHash === "string" && requestedInputHash.length > 0
      ? artifactInputHashUsed === requestedInputHash
      : null;
  modelAssumptions.artifactRequestedScenarioId = exactArtifactIdentityRequested
    ? requestedArtifactScenarioId
    : null;
  modelAssumptions.artifactExactIdentityRequested = exactArtifactIdentityRequested;
  modelAssumptions.artifactExactIdentityResolved =
    exactArtifactIdentityRequested &&
    String(artifactInputHashUsed ?? "") === requestedArtifactInputHash &&
    requestedArtifactScenarioId === sharedScenarioCacheId;
  modelAssumptions.artifactIdentitySource = artifactIdentitySourceNormalized;
  modelAssumptions.artifactSameRunEnsureIdentity = artifactIdentitySourceNormalized === "same_run_artifact_ensure";
  modelAssumptions.artifactFallbackOccurred = false;
  modelAssumptions.artifactFallbackReason = null;
  modelAssumptions.artifactExactIdentifierUsed =
    artifactInputHashUsed && sharedScenarioCacheId ? `${sharedScenarioCacheId}:${artifactInputHashUsed}` : null;
  const hasContradictoryExactHashTruth =
    artifactSourceMode === "exact_hash_match" &&
    (!artifactInputHashUsed ||
      (typeof requestedInputHash === "string" &&
        requestedInputHash.length > 0 &&
        artifactInputHashUsed !== requestedInputHash) ||
      modelAssumptions.artifactHashMatch !== true);
  const sameRunExactHandoffRequired =
    exactArtifactReadRequired && artifactIdentitySourceNormalized === "same_run_artifact_ensure";
  const sameRunExactHandoffResolved =
    sameRunExactHandoffRequired &&
    artifactSourceMode === "exact_hash_match" &&
    typeof requestedInputHash === "string" &&
    requestedInputHash.length > 0 &&
    artifactInputHashUsed === requestedInputHash &&
    modelAssumptions.artifactHashMatch === true &&
    modelAssumptions.artifactExactIdentityResolved === true;
  if (sameRunExactHandoffRequired && !sameRunExactHandoffResolved) {
    return {
      ok: false,
      status: 409,
      body: {
        ok: false,
        error: "artifact_exact_identity_unresolved",
        message:
          "Compare requires the exact shared Past artifact identity returned by same-run artifact ensure, but that handoff was not proven as an exact hash match.",
        mode: "artifact_only",
        scenarioId: sharedScenarioCacheId,
        requestedArtifactScenarioId,
        requestedInputHash,
        artifactInputHashUsed,
        artifactHashMatch: modelAssumptions.artifactHashMatch,
        artifactSourceMode,
        artifactIdentitySource: artifactIdentitySourceNormalized,
        exactIdentityResolved: modelAssumptions.artifactExactIdentityResolved,
        fallbackOccurred: modelAssumptions.artifactFallbackOccurred,
        fallbackReason: modelAssumptions.artifactFallbackReason,
        reasonCode: "ARTIFACT_ENSURE_EXACT_HANDOFF_FAILED",
      },
    };
  }
  if (exactArtifactReadRequired && modelAssumptions.artifactExactIdentityResolved !== true) {
    return {
      ok: false,
      status: 409,
      body: {
        ok: false,
        error: "artifact_exact_identity_unresolved",
        message:
          "Compare requires an exact shared Past artifact identity, but the resolved artifact truth could not be proven after cache lookup.",
        mode: "artifact_only",
        scenarioId: sharedScenarioCacheId,
        requestedArtifactScenarioId,
        requestedInputHash,
        artifactInputHashUsed,
        artifactHashMatch: modelAssumptions.artifactHashMatch,
        artifactSourceMode,
        artifactIdentitySource: artifactIdentitySourceNormalized,
        exactIdentityResolved: modelAssumptions.artifactExactIdentityResolved,
        fallbackOccurred: modelAssumptions.artifactFallbackOccurred,
        fallbackReason: modelAssumptions.artifactFallbackReason,
        reasonCode: "ARTIFACT_EXACT_IDENTITY_UNRESOLVED",
      },
    };
  }
  if (hasContradictoryExactHashTruth) {
    return {
      ok: false,
      status: exactArtifactReadRequired ? 409 : 500,
      body: {
        ok: false,
        error: "artifact_truth_invariant_failed",
        message:
          "Shared Past artifact truth is contradictory: compare cannot report exact hash match without a resolved artifact input hash and positive hash match.",
        mode: "artifact_only",
        scenarioId: sharedScenarioCacheId,
        requestedArtifactScenarioId,
        requestedInputHash,
        artifactInputHashUsed,
        artifactHashMatch: modelAssumptions.artifactHashMatch,
        artifactSourceMode,
        artifactIdentitySource: artifactIdentitySourceNormalized,
        exactIdentityResolved: modelAssumptions.artifactExactIdentityResolved,
        fallbackOccurred: modelAssumptions.artifactFallbackOccurred,
        fallbackReason: modelAssumptions.artifactFallbackReason,
      },
    };
  }
  const summaryIntervalsCount = Number((dataset as any)?.summary?.intervalsCount);
  if (Number.isFinite(summaryIntervalsCount) && summaryIntervalsCount > 0) {
    modelAssumptions.artifactStoredIntervalCount = Math.trunc(summaryIntervalsCount);
  }
  if (artifactSourceMode) {
    modelAssumptions.artifactSourceMode = artifactSourceMode;
    modelAssumptions.artifactSourceNote = "Artifact source: exact identity match on Past input hash.";
  } else {
    delete modelAssumptions.artifactSourceMode;
    delete modelAssumptions.artifactSourceNote;
  }
  if (!artifactAutoRebuilt && (cached as any)?.updatedAt instanceof Date) {
    modelAssumptions.artifactUpdatedAt = ((cached as any).updatedAt as Date).toISOString();
  }
  // Shared ownership metadata is travel/vacant-only.
  modelAssumptions.excludedDateKeysFingerprint = travelFingerprint;
  modelAssumptions.excludedDateKeysCount = boundedTravelDateKeysLocal.size;

  const artifactIntervalsRaw = (dataset.series.intervals15 as Array<{ timestamp: string; kwh: number }>) ?? [];
  const artifactIntervals = (() => {
    if (!compareCoreMemoryReducedPath) {
      return artifactIntervalsRaw.map((p) => ({
        timestamp: canonicalIntervalKey(String(p?.timestamp ?? "").trim()),
        kwh: Number(p?.kwh) || 0,
      }));
    }
    // Compare join + scored-day paths only need interval points for local dates in the bounded
    // scoring window (full-year interval arrays are a major compare_core memory source on Vercel).
    // Travel/vacant parity uses canonical artifact day totals + fresh parity intervals, not raw
    // artifact interval rows for non-scored travel dates.
    const neededDayKeys = new Set<string>(Array.from(boundedTestDateKeysLocal));
    const out: Array<{ timestamp: string; kwh: number }> = [];
    for (const p of artifactIntervalsRaw) {
      const ts = canonicalIntervalKey(String(p?.timestamp ?? "").trim());
      const dk = dateKeyInTimezone(ts, timezone);
      if (!neededDayKeys.has(dk)) continue;
      out.push({ timestamp: ts, kwh: Number(p?.kwh) || 0 });
    }
    return out;
  })();
  const daySourceFromDataset = (() => {
    const dailyArr = Array.isArray((dataset as any)?.daily) ? ((dataset as any).daily as Array<Record<string, unknown>>) : [];
    if (!compareCoreMemoryReducedPath) {
      const entries = dailyArr
        .map((d: any) =>
          [
            String(d?.date ?? "").slice(0, 10),
            String(d?.source ?? "").toUpperCase() === "SIMULATED" ? ("SIMULATED" as const) : ("ACTUAL" as const),
          ] as const
        )
        .filter((entry) => /^\d{4}-\d{2}-\d{2}$/.test(entry[0]));
      return new Map<string, "ACTUAL" | "SIMULATED">(entries);
    }
    const keysNeeded = new Set<string>([
      ...Array.from(boundedTestDateKeysLocal),
      ...Array.from(boundedTravelDateKeysLocal),
    ]);
    const m = new Map<string, "ACTUAL" | "SIMULATED">();
    for (const d of dailyArr) {
      const dk = String((d as any)?.date ?? "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dk) || !keysNeeded.has(dk)) continue;
      m.set(dk, String((d as any)?.source ?? "").toUpperCase() === "SIMULATED" ? "SIMULATED" : "ACTUAL");
    }
    return m;
  })();
  const scoringExcludedSource = "shared_past_travel_vacant_excludedDateKeysFingerprint";
  const artifactSimulatedTestIntervals = artifactIntervals.filter((p) => {
    const dk = dateKeyInTimezone(p.timestamp, timezone);
    return boundedTestDateKeysLocal.has(dk);
  });
  // Keep selected-days scored-row construction bounded to scored test days only.
  const useSelectedDaysScopedDisplayRows = effectiveCompareFreshMode === "selected_days";
  const displayDateKeysLocal = useSelectedDaysScopedDisplayRows
    ? new Set<string>(Array.from(boundedTestDateKeysLocal))
    : chartDateKeysLocal;
  let simulatedTestIntervals = artifactSimulatedTestIntervals;
  let scoringSimulatedSource:
    | "shared_artifact_simulated_intervals15"
    | "shared_fresh_simulated_intervals15"
    | "shared_selected_days_simulated_intervals15" = "shared_artifact_simulated_intervals15";
  let comparePulledFromSharedArtifactOnly = true;
  let compareSimSource: "shared_fresh_calc" | "shared_artifact_cache" | "shared_selected_days_calc" =
    "shared_artifact_cache";
  let compareCalculationScope:
    | "artifact_read_then_scored_day_filter"
    | "full_window_shared_path_then_scored_day_filter"
    | "selected_days_shared_path_only" = "artifact_read_then_scored_day_filter";
  let compareFreshModeUsed: "selected_days" | "full_window" | "artifact_only" = "artifact_only";
  let compareSharedCalcPath = "artifact_cache_only";
  let weatherBasisUsed = String(
    (modelAssumptions as any)?.weatherSourceSummary ??
    (modelAssumptions as any)?.simulationWeatherSourceOwner ??
    "unknown"
  );
  let scoredDayWeatherRows: ScoredDayWeatherRow[] = [];
  let scoredDayWeatherTruth: ScoredDayWeatherTruth = {
    availability: "missing_expected_scored_day_weather",
    reasonCode: "SCORED_DAY_WEATHER_MISSING",
    explanation: "Shared compare has not yet produced compact scored-day weather truth.",
    source: "shared_compare_scored_day_weather",
    scoredDateCount: boundedTestDateKeysLocal.size,
    weatherRowCount: 0,
    missingDateCount: boundedTestDateKeysLocal.size,
    missingDateSample: Array.from(boundedTestDateKeysLocal).sort().slice(0, 10),
  };
  let travelVacantParityRows: TravelVacantParityRow[] = [];
  let travelVacantParityTruth: TravelVacantParityTruth = {
    availability: travelVacantParityDateKeysLocal.length > 0 ? "missing_fresh_compare_output" : "not_requested",
    reasonCode:
      travelVacantParityDateKeysLocal.length > 0
        ? "TRAVEL_VACANT_FRESH_COMPARE_OUTPUT_MISSING"
        : "TRAVEL_VACANT_PARITY_NOT_REQUESTED",
    explanation:
      travelVacantParityDateKeysLocal.length > 0
        ? "Shared compare has not yet produced travel/vacant parity validation output."
        : "No DB travel/vacant dates were available for parity validation in this coverage window.",
    source: "db_travel_vacant_ranges",
    comparisonBasis: "canonical_artifact_simulated_day_totals_vs_fresh_shared_compare_daily_totals",
    requestedDateCount: travelVacantParityDateKeysLocal.length,
    validatedDateCount: 0,
    mismatchCount: 0,
    missingArtifactReferenceCount: 0,
    missingFreshCompareCount: travelVacantParityDateKeysLocal.length,
    requestedDateSample: travelVacantParityDateKeysLocal.slice(0, 10),
    exactProofRequired: exactArtifactReadRequired,
    exactProofSatisfied: travelVacantParityDateKeysLocal.length === 0,
  };
  let selectedTestDailyTotalsByDate: Map<string, number> | null = null;
  let freshParityCanonicalSimulatedDayTotalsByDate: Record<string, number> = {};
  let freshParityIntervals: IntervalPoint[] = [];
  let lastFreshGapfillKeepRefLocalDateKeys: string[] | undefined;
  let lastFreshGapfillKeepRefUtcKeyCount: number | undefined;

  const needsFreshCompareForParity =
    boundedTestDateKeysLocal.size > 0 || travelVacantParityDateKeysLocal.length > 0;
  await reportPhase("build_shared_compare_inputs_ready", {
    compareFreshMode: effectiveCompareFreshMode,
    boundedTestDateKeysCount: boundedTestDateKeysLocal.size,
    travelVacantParityDateKeysCount: travelVacantParityDateKeysLocal.length,
    needsFreshCompareForParity,
    compactPathEligible: compareCoreMemoryReducedPath,
    compactPathGates: {
      effectiveCompareFreshMode,
      includeDiagnostics,
      includeFullReportText,
      selectedDaysLightweightArtifactRead: selectedDaysLightweightArtifactRead === true,
      useSelectedDaysLightweightArtifactRead,
      exactArtifactReadRequired,
      exactTravelParityRequiresIntervalBackedArtifactTruth,
    },
  });
  if (needsFreshCompareForParity) {
    const runFullWindowFreshExecution = async () => {
      const freshResult = await simulatePastFullWindowShared({
        userId,
        houseId,
        esiid: houseResolved.esiid ?? null,
        travelRanges: buildTravelRanges,
        buildInputs,
        // Use the same identity window the shared artifact path uses.
        startDate: identityWindowResolved.startDate,
        endDate: identityWindowResolved.endDate,
        timezone,
        buildPathKind: "lab_validation",
        includeSimulatedDayResults: true,
        // Same as simulatePastSelectedDaysShared: do not emit passthrough actual intervals for
        // non-simulated days. Full-window compare only filters/scores simulated days; materializing
        // ~365×96 interval rows here was a major compare_core OOM source on Vercel when
        // compareFreshMode === "full_window".
        emitAllIntervals: false,
        forceModeledOutputKeepReferencePoolDateKeysLocal:
          boundedTestDateKeysLocal.size > 0 ? boundedTestDateKeysLocal : undefined,
        ...(actualIntervalsForSharedPastSim != null ? { actualIntervals: actualIntervalsForSharedPastSim } : {}),
      });
      if (freshResult.simulatedIntervals === null) {
        const code = String(freshResult.error ?? "");
        const inv =
          "invariantViolations" in freshResult &&
          Array.isArray((freshResult as { invariantViolations?: unknown }).invariantViolations)
            ? (freshResult as { invariantViolations: unknown }).invariantViolations
            : undefined;
        const message =
          code === "simulated_day_local_date_interval_invariant_violation"
            ? "Simulated day localDate disagrees with interval-derived local date keys (invariant violation). Compare cannot proceed with a second authority."
            : freshResult.error ??
              "Fresh shared compare simulation failed before scoring. Retry and rebuild artifact if needed.";
        return {
          ok: false as const,
          error: message,
          ...(code === "simulated_day_local_date_interval_invariant_violation" && inv != null
            ? { reasonCode: "SIMULATED_DAY_LOCAL_DATE_INTERVAL_INVARIANT_VIOLATION" as const, invariantViolations: inv }
            : {}),
        };
      }
      const freshIntervals = freshResult.simulatedIntervals.map((p) => ({
        timestamp: canonicalIntervalKey(String(p?.timestamp ?? "").trim()),
        kwh: Number(p?.kwh) || 0,
      }));
      return {
        ok: true as const,
        weatherKindUsed: freshResult.weatherKindUsed,
        weatherProviderName: freshResult.weatherProviderName,
        weatherFallbackReason: freshResult.weatherFallbackReason,
          actualWxByDateKey: freshResult.selectedWeatherByDateKey ?? freshResult.actualWxByDateKey ?? null,
        simulatedIntervals: freshIntervals,
        canonicalSimulatedDayTotalsByDate:
          freshResult.canonicalSimulatedDayTotalsByDate ?? {},
        weatherSourceSummary: String(freshResult.weatherSourceSummary ?? weatherBasisUsed) || "unknown",
        gapfillForceModeledKeepRefLocalDateKeys: freshResult.gapfillForceModeledKeepRefLocalDateKeys,
        gapfillForceModeledKeepRefUtcKeyCount: freshResult.gapfillForceModeledKeepRefUtcKeyCount,
      };
    };
    if (effectiveCompareFreshMode === "selected_days") {
      const travelVacantParityDateKeySet = new Set<string>(travelVacantParityDateKeysLocal);
      const selectedAndParityDateKeySet = new Set<string>([
        ...Array.from(boundedTestDateKeysLocal),
        ...travelVacantParityDateKeysLocal,
      ]);
      let freshParityWeatherSourceSummary = weatherBasisUsed;
      // Exact artifact + travel/vacant parity uses the same single union selected-days execution as
      // non-exact compares. A separate full-window sim was redundant, slower, and OOM-prone on Vercel
      // (full-year interval arrays) while parity only needs fresh totals for union(test, parity) keys.
      const runSelectedDaysFreshExecution = async (selectedDateKeysLocal: Set<string>) => {
        if (selectedDateKeysLocal.size === 0) {
          return {
            ok: true as const,
            dataset: null,
            simulatedIntervals: [] as Array<{ timestamp: string; kwh: number }>,
            dailyTotalsByDate: new Map<string, number>(),
            canonicalSimulatedDayTotalsByDate: {} as Record<string, number>,
            actualWxByDateKey: null as Map<
              string,
              { tAvgF?: number; tMinF?: number; tMaxF?: number; hdd65?: number; cdd65?: number; source?: string }
            > | null,
            weatherKindUsed: null as string | null,
            weatherSourceSummary: weatherBasisUsed,
            gapfillForceModeledKeepRefLocalDateKeys: undefined as string[] | undefined,
            gapfillForceModeledKeepRefUtcKeyCount: undefined as number | undefined,
          };
        }
        const selectedDaysResult = await simulatePastSelectedDaysShared({
          userId,
          houseId,
          esiid: houseResolved.esiid ?? null,
          travelRanges: buildTravelRanges,
          buildInputs,
          // Use the same identity window and shared context the artifact path uses.
          startDate: identityWindowResolved.startDate,
          endDate: identityWindowResolved.endDate,
          timezone,
          buildPathKind: "lab_validation",
          selectedDateKeysLocal,
          retainSimulatedDayResultDateKeysLocal: boundedTestDateKeysLocal,
          forceModeledOutputKeepReferencePoolDateKeysLocal:
            boundedTestDateKeysLocal.size > 0 ? boundedTestDateKeysLocal : undefined,
          ...(actualIntervalsForSharedPastSim != null ? { actualIntervals: actualIntervalsForSharedPastSim } : {}),
        });
        if (selectedDaysResult.simulatedIntervals === null) {
          const code = String(selectedDaysResult.error ?? "");
          const inv =
            "invariantViolations" in selectedDaysResult &&
            Array.isArray((selectedDaysResult as { invariantViolations?: unknown }).invariantViolations)
              ? (selectedDaysResult as { invariantViolations: unknown }).invariantViolations
              : undefined;
          const message =
            code === "simulated_day_local_date_interval_invariant_violation"
              ? "Simulated day localDate disagrees with interval-derived local date keys (invariant violation). Compare cannot proceed with a second authority."
              : selectedDaysResult.error ??
                "Selected-day fresh shared compare simulation failed before scoring. Retry and rebuild artifact if needed.";
          return {
            ok: false as const,
            error: message,
            ...(code === "simulated_day_local_date_interval_invariant_violation" && inv != null
              ? { reasonCode: "SIMULATED_DAY_LOCAL_DATE_INTERVAL_INVARIANT_VIOLATION" as const, invariantViolations: inv }
              : {}),
          };
        }
        const simulatedIntervalsNormalized = selectedDaysResult.simulatedIntervals.map((p) => ({
          timestamp: canonicalIntervalKey(String(p?.timestamp ?? "").trim()),
          kwh: Number(p?.kwh) || 0,
        }));
        const canonicalSimulatedDayTotalsByDate = Object.fromEntries(
          Object.entries(selectedDaysResult.canonicalSimulatedDayTotalsByDate ?? {}).filter(([dk, kwh]) => {
            const dateKey = String(dk).slice(0, 10);
            return selectedDateKeysLocal.has(dateKey) && Number.isFinite(Number(kwh));
          })
        );
        const simulatedDayResultDateKeys = new Set<string>(
          Object.keys(canonicalSimulatedDayTotalsByDate).map((dk) => String(dk).slice(0, 10))
        );
        const dailyTotalsByDate = new Map<string, number>(
          Object.entries(canonicalSimulatedDayTotalsByDate).map(([dk, kwh]) => [
            String(dk).slice(0, 10),
            round2Local(Number(kwh) || 0),
          ])
        );
        const simulatorOwnedIntervals = simulatedIntervalsNormalized.filter((p) =>
          simulatedDayResultDateKeys.has(dateKeyInTimezone(p.timestamp, timezone))
        );
        return {
          ok: true as const,
          dataset: null,
          simulatedIntervals: simulatorOwnedIntervals,
          dailyTotalsByDate,
          canonicalSimulatedDayTotalsByDate,
          actualWxByDateKey:
            selectedDaysResult.selectedWeatherByDateKey ??
            selectedDaysResult.actualWxByDateKey ??
            null,
          weatherKindUsed: String(selectedDaysResult.weatherKindUsed ?? "") || null,
          weatherSourceSummary: String(selectedDaysResult.weatherSourceSummary ?? weatherBasisUsed) || "unknown",
          gapfillForceModeledKeepRefLocalDateKeys: selectedDaysResult.gapfillForceModeledKeepRefLocalDateKeys,
          gapfillForceModeledKeepRefUtcKeyCount: selectedDaysResult.gapfillForceModeledKeepRefUtcKeyCount,
        };
      };
      {
        throwIfGapfillCompareAborted(abortSignal);
        const sharedSelectedDaysResult = await runSelectedDaysFreshExecution(selectedAndParityDateKeySet);
        if (!sharedSelectedDaysResult.ok) {
          return {
            ok: false,
            status: 500,
            body: {
              ok: false,
              error: "fresh_compare_simulation_failed",
              message: sharedSelectedDaysResult.error,
              mode: "artifact_only",
              scenarioId: sharedScenarioCacheId,
              ...("reasonCode" in sharedSelectedDaysResult && sharedSelectedDaysResult.reasonCode
                ? { reasonCode: sharedSelectedDaysResult.reasonCode }
                : {}),
              ...("invariantViolations" in sharedSelectedDaysResult &&
              sharedSelectedDaysResult.invariantViolations != null
                ? { invariantViolations: sharedSelectedDaysResult.invariantViolations }
                : {}),
            },
          };
        }
        freshParityWeatherSourceSummary = sharedSelectedDaysResult.weatherSourceSummary;
        if (travelVacantParityDateKeySet.size > 0) {
          // Parity uses the same shared selected-days execution as compare (union of test + travel/vacant keys).
          // Slice intervals and canonical day totals from that single run; do not run a second full-window sim here.
          freshParityIntervals = filterIntervalsToLocalDateKeys(
            sharedSelectedDaysResult.simulatedIntervals,
            timezone,
            travelVacantParityDateKeySet
          );
          freshParityCanonicalSimulatedDayTotalsByDate = Object.fromEntries(
            Object.entries(sharedSelectedDaysResult.canonicalSimulatedDayTotalsByDate ?? {}).filter(([dk]) =>
              travelVacantParityDateKeySet.has(String(dk).slice(0, 10))
            )
          );
        } else {
          freshParityCanonicalSimulatedDayTotalsByDate = {};
          freshParityIntervals = [];
        }
        // Compare truth ownership stays artifact-backed; selected-days fresh output is parity analytics only.
        lastFreshGapfillKeepRefLocalDateKeys = sharedSelectedDaysResult.gapfillForceModeledKeepRefLocalDateKeys;
        lastFreshGapfillKeepRefUtcKeyCount = sharedSelectedDaysResult.gapfillForceModeledKeepRefUtcKeyCount;
        selectedTestDailyTotalsByDate = new Map<string, number>();
        for (const dk of Array.from(boundedTestDateKeysLocal)) {
          const raw = sharedSelectedDaysResult.canonicalSimulatedDayTotalsByDate?.[dk];
          if (raw === undefined) continue;
          const num = Number(raw);
          if (!Number.isFinite(num)) continue;
          selectedTestDailyTotalsByDate.set(dk, round2Local(num));
        }
        if (includeFreshCompareCalc && boundedTestDateKeysLocal.size > 0) {
          const missingCanonicalForScoredTestDays = Array.from(boundedTestDateKeysLocal).filter(
            (dk) => !selectedTestDailyTotalsByDate!.has(dk)
          );
          if (missingCanonicalForScoredTestDays.length > 0) {
            return {
              ok: false,
              status: 500,
              body: {
                ok: false,
                error: "fresh_compare_canonical_totals_missing",
                message:
                  "Fresh selected-days diagnostics require canonical simulator-owned day totals for every scored test day. Missing or non-finite totals for: " +
                  missingCanonicalForScoredTestDays.slice(0, 25).join(", ") +
                  (missingCanonicalForScoredTestDays.length > 25 ? " …" : ""),
                mode: "artifact_only",
                scenarioId: sharedScenarioCacheId,
                reasonCode: "FRESH_COMPARE_CANONICAL_DAY_TOTALS_MISSING" as const,
                missingCanonicalDateKeysLocal: missingCanonicalForScoredTestDays,
              },
            };
          }
        }
        weatherBasisUsed =
          boundedTestDateKeysLocal.size > 0
            ? sharedSelectedDaysResult.weatherSourceSummary
            : freshParityWeatherSourceSummary;
        const selectedWeatherRange = Array.from(boundedTestDateKeysLocal).sort();
        if (selectedWeatherRange.length > 0) {
          const sharedSelectedDaysWeatherByDate = sharedSelectedDaysResult.actualWxByDateKey ?? null;
          const sharedSelectedDaysWeatherComplete =
            sharedSelectedDaysWeatherByDate != null &&
            selectedWeatherRange.every((dk) => sharedSelectedDaysWeatherByDate.has(dk));
          let selectedDaysWeatherBasisUsed = weatherBasisUsed;
          let selectedDaysWeatherByDate = sharedSelectedDaysWeatherByDate;
          let selectedDaysWeatherKindUsed = sharedSelectedDaysResult.weatherKindUsed;
          let selectedDaysWeatherProviderName: string | null = null;
          let selectedDaysWeatherFallbackReason: string | null = null;
          if (!sharedSelectedDaysWeatherComplete) {
            throwIfGapfillCompareAborted(abortSignal);
            const selectedDaysWeather = await loadWeatherForPastWindow({
              houseId,
              startDate: selectedWeatherRange[0]!,
              endDate: selectedWeatherRange[selectedWeatherRange.length - 1]!,
              canonicalDateKeys: selectedWeatherRange,
              weatherLogicMode: resolveWeatherLogicModeFromBuildInputs(
                buildInputs as Record<string, unknown>
              ),
            });
            selectedDaysWeatherByDate =
              selectedDaysWeather.selectedWeatherByDateKey ??
              selectedDaysWeather.actualWxByDateKey;
            selectedDaysWeatherBasisUsed =
              String(selectedDaysWeather.provenance.weatherSourceSummary ?? weatherBasisUsed) || weatherBasisUsed;
            weatherBasisUsed = selectedDaysWeatherBasisUsed;
            selectedDaysWeatherKindUsed = selectedDaysWeather.provenance.weatherKindUsed ?? null;
            selectedDaysWeatherProviderName = selectedDaysWeather.provenance.weatherProviderName ?? null;
            selectedDaysWeatherFallbackReason = selectedDaysWeather.provenance.weatherFallbackReason ?? null;
          }
          const scoredDayWeatherPayload = buildScoredDayWeatherPayload({
            scoredDateKeysLocal: boundedTestDateKeysLocal,
            weatherByDateKey: selectedDaysWeatherByDate ?? new Map(),
            weatherBasisUsed: selectedDaysWeatherBasisUsed,
            weatherKindUsed: selectedDaysWeatherKindUsed,
            weatherProviderName: selectedDaysWeatherProviderName,
            weatherFallbackReason: selectedDaysWeatherFallbackReason,
          });
          scoredDayWeatherRows = scoredDayWeatherPayload.rows;
          scoredDayWeatherTruth = scoredDayWeatherPayload.truth;
        }
      }
      await reportPhase("build_shared_compare_weather_ready", {
        compareFreshModeUsed,
        weatherBasisUsed,
        scoredDayWeatherCount: scoredDayWeatherRows.length,
        weatherAvailability: scoredDayWeatherTruth.availability,
      });
      await reportPhase("build_shared_compare_sim_ready", {
        compareFreshModeUsed,
        compareSimSource,
        reusedSingleSelectedDaysExecution: false,
        selectedAndParityDateKeysCount: selectedAndParityDateKeySet.size,
        simulatedTestIntervalsCount: simulatedTestIntervals.length,
        freshParityIntervalsCount: freshParityIntervals.length,
        parityFreshSource:
          travelVacantParityDateKeySet.size === 0 ? "none_requested" : "shared_selected_days_union_slice",
      });
    } else {
      throwIfGapfillCompareAborted(abortSignal);
      const freshResult = await runFullWindowFreshExecution();
      if (!freshResult.ok) {
        return {
          ok: false,
          status: 500,
          body: {
            ok: false,
            error: "fresh_compare_simulation_failed",
            message: freshResult.error,
            mode: "artifact_only",
            scenarioId: sharedScenarioCacheId,
            ...("reasonCode" in freshResult && freshResult.reasonCode ? { reasonCode: freshResult.reasonCode } : {}),
            ...("invariantViolations" in freshResult && freshResult.invariantViolations != null
              ? { invariantViolations: freshResult.invariantViolations }
              : {}),
          },
        };
      }
      freshParityIntervals = freshResult.simulatedIntervals;
      freshParityCanonicalSimulatedDayTotalsByDate = freshResult.canonicalSimulatedDayTotalsByDate ?? {};
      if (includeFreshCompareCalc && boundedTestDateKeysLocal.size > 0) {
        const missingCanonicalForScoredTestDays = Array.from(boundedTestDateKeysLocal).filter((dk) => {
          const raw = freshParityCanonicalSimulatedDayTotalsByDate[dk];
          return raw === undefined || !Number.isFinite(Number(raw));
        });
        if (missingCanonicalForScoredTestDays.length > 0) {
          return {
            ok: false,
            status: 500,
            body: {
              ok: false,
              error: "fresh_compare_canonical_totals_missing",
              message:
                "Fresh full-window diagnostics require canonical simulator-owned day totals for every scored test day. Missing or non-finite totals for: " +
                missingCanonicalForScoredTestDays.slice(0, 25).join(", ") +
                (missingCanonicalForScoredTestDays.length > 25 ? " …" : ""),
              mode: "artifact_only",
              scenarioId: sharedScenarioCacheId,
              reasonCode: "FRESH_COMPARE_CANONICAL_DAY_TOTALS_MISSING" as const,
              missingCanonicalDateKeysLocal: missingCanonicalForScoredTestDays,
            },
          };
        }
      }
      // Compare truth ownership stays artifact-backed; full-window fresh output is parity analytics only.
      weatherBasisUsed = freshResult.weatherSourceSummary;
      lastFreshGapfillKeepRefLocalDateKeys = freshResult.gapfillForceModeledKeepRefLocalDateKeys;
      lastFreshGapfillKeepRefUtcKeyCount = freshResult.gapfillForceModeledKeepRefUtcKeyCount;
      const scoredDayWeatherPayload = buildScoredDayWeatherPayload({
        scoredDateKeysLocal: boundedTestDateKeysLocal,
        weatherByDateKey: freshResult.actualWxByDateKey,
        weatherBasisUsed,
        weatherKindUsed: String(freshResult.weatherKindUsed ?? "") || null,
        weatherProviderName: String(freshResult.weatherProviderName ?? "") || null,
        weatherFallbackReason: String(freshResult.weatherFallbackReason ?? "") || null,
      });
      scoredDayWeatherRows = scoredDayWeatherPayload.rows;
      scoredDayWeatherTruth = scoredDayWeatherPayload.truth;
      await reportPhase("build_shared_compare_weather_ready", {
        compareFreshModeUsed,
        weatherBasisUsed,
        scoredDayWeatherCount: scoredDayWeatherRows.length,
        weatherAvailability: scoredDayWeatherTruth.availability,
      });
      await reportPhase("build_shared_compare_sim_ready", {
        compareFreshModeUsed,
        compareSimSource,
        simulatedTestIntervalsCount: simulatedTestIntervals.length,
        freshParityIntervalsCount: freshParityIntervals.length,
      });
    }
  } else {
    await reportPhase("build_shared_compare_sim_ready", {
      compareFreshModeUsed,
      compareSimSource,
      simulatedTestIntervalsCount: simulatedTestIntervals.length,
      freshParityIntervalsCount: freshParityIntervals.length,
    });
  }
  const availableTestDateKeysFromSimulated = new Set<string>(
    simulatedTestIntervals
      .map((p) => dateKeyInTimezone(p.timestamp, timezone))
      .filter((dk) => boundedTestDateKeysLocal.has(dk))
  );
  const scoredTestDaysMissingSimulatedOwnershipCount = Array.from(boundedTestDateKeysLocal).filter(
    (dk) => !availableTestDateKeysFromSimulated.has(dk)
  ).length;
  const simulatedChartIntervals = useSelectedDaysLightweightArtifactRead
    ? []
    : artifactIntervals.filter((p) => displayDateKeysLocal.has(dateKeyInTimezone(p.timestamp, timezone)));
  modelAssumptions.intervalCount = simulatedChartIntervals.length;
  const chartMonthKeysLocal = new Set<string>(
    Array.from(displayDateKeysLocal)
      .map((dk) => String(dk).slice(0, 7))
      .filter((ym) => /^\d{4}-\d{2}$/.test(ym))
  );
  const canonicalDailyInputRows = restoredCanonicalDailyRows ?? (Array.isArray((dataset as any)?.daily)
    ? ((dataset as any).daily as Array<{ date?: string; kwh?: number; source?: string }>)
    : []);
  const datasetDailyRows = (() => {
    if (compareCoreMemoryReducedPath) {
      const out: Array<{ date: string; simKwh: number }> = [];
      for (const d of canonicalDailyInputRows) {
        const date = String(d?.date ?? "").slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !displayDateKeysLocal.has(date)) continue;
        out.push({ date, simKwh: round2Local(Number(d?.kwh) || 0) });
      }
      out.sort((a, b) => (a.date < b.date ? -1 : 1));
      return out;
    }
    return canonicalDailyInputRows
      .map((d) => ({
        date: String(d?.date ?? "").slice(0, 10),
        simKwh: round2Local(Number(d?.kwh) || 0),
      }))
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date) && displayDateKeysLocal.has(d.date))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
  })();
  const useDatasetDailyAsCanonical = datasetDailyRows.length > 0;
  await reportPhase("build_shared_compare_scored_actual_rows_ready", {
    compareFreshModeUsed,
    compareCalculationScope,
    displayDateCount: displayDateKeysLocal.size,
    datasetDailyRowsCount: datasetDailyRows.length,
    useDatasetDailyAsCanonical,
  });
  let simulatedChartDaily = useDatasetDailyAsCanonical
    ? datasetDailyRows.map((d) => ({
        date: d.date,
        simKwh: d.simKwh,
        // In artifact-only lab builds, dataset daily rows may all be tagged ACTUAL
        // when simulated day artifacts were omitted at build time. Force source from
        // shared travel/vacant ownership metadata first so chart/table labeling remains truthful.
        source: boundedTravelDateKeysLocal.has(d.date)
          ? "SIMULATED"
          : (daySourceFromDataset.get(d.date) ?? "ACTUAL"),
      }))
    : Array.from(
        simulatedChartIntervals.reduce((acc, p) => {
          const dk = dateKeyInTimezone(p.timestamp, timezone);
          acc.set(dk, (acc.get(dk) ?? 0) + (Number(p.kwh) || 0));
          return acc;
        }, new Map<string, number>())
      )
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([date, simKwh]) => ({
          date,
          simKwh: round2Local(simKwh),
          source: boundedTravelDateKeysLocal.has(date)
            ? "SIMULATED"
            : (daySourceFromDataset.get(date) ?? "ACTUAL"),
        }));

  const canonicalMonthlyInputRows = restoredCanonicalMonthlyRows ?? (Array.isArray((dataset as any)?.monthly)
    ? ((dataset as any).monthly as Array<{ month?: string; kwh?: number }>)
    : []);
  const datasetMonthlyRows = compareCoreMemoryReducedPath
    ? []
    : canonicalMonthlyInputRows
        .map((m) => ({
          month: String(m?.month ?? "").slice(0, 7),
          kwh: round2Local(Number(m?.kwh) || 0),
        }))
        .filter((m) => /^\d{4}-\d{2}$/.test(m.month) && chartMonthKeysLocal.has(m.month))
        .sort((a, b) => (a.month < b.month ? -1 : 1));
  const useDatasetMonthlyAsCanonical = !compareCoreMemoryReducedPath && datasetMonthlyRows.length > 0;
  const monthlyChartBuild =
    compareCoreMemoryReducedPath || useDatasetMonthlyAsCanonical
      ? null
      : buildDisplayMonthlyFromIntervalsUtc(
          simulatedChartIntervals.map((p) => ({
            timestamp: String(p.timestamp ?? ""),
            consumption_kwh: Number(p.kwh) || 0,
          })),
          canonicalWindow.endDate
        );
  let simulatedChartMonthly = compareCoreMemoryReducedPath
    ? []
    : useDatasetMonthlyAsCanonical
      ? datasetMonthlyRows
      : monthlyChartBuild?.monthly ?? [];
  if (compareCoreMemoryReducedPath) {
    await reportPhase("build_shared_compare_compact_compare_core_memory_reduced", {
      compareFreshModeUsed,
      compareCalculationScope,
      artifactIntervalsMaterializedCount: artifactIntervals.length,
      skippedFullDatasetMonthlyScan: true,
      skippedIntervalMonthlyRebucket: true,
      exactTravelParityRequiresIntervalBackedArtifactTruth,
      lightweightArtifactReadOverriddenForExactTravelParity:
        exactTravelParityRequiresIntervalBackedArtifactTruth && selectedDaysLightweightArtifactRead === true,
    });
  }
  await reportPhase("build_shared_compare_scored_sim_rows_ready", {
    compareFreshModeUsed,
    compareCalculationScope,
    simulatedChartIntervalCount: simulatedChartIntervals.length,
    simulatedChartDailyCount: simulatedChartDaily.length,
    simulatedChartMonthlyCount: simulatedChartMonthly.length,
    useDatasetMonthlyAsCanonical,
  });
  const simulatedChartStitchedMonth = compareCoreMemoryReducedPath
    ? null
    : ((((dataset as any)?.insights?.stitchedMonth ?? null) as {
        mode: "PRIOR_YEAR_TAIL";
        yearMonth: string;
        haveDaysThrough: number;
        missingDaysFrom: number;
        missingDaysTo: number;
        borrowedFromYearMonth: string;
        completenessRule: string;
      } | null) ?? monthlyChartBuild?.stitchedMonth ?? null);
  modelAssumptions.gapfillDisplayDailySource = useDatasetDailyAsCanonical
    ? "dataset.daily"
    : "interval_rebucket_fallback";
  modelAssumptions.gapfillDisplayMonthlySource = compareCoreMemoryReducedPath
    ? "compact_compare_core_skipped"
    : useDatasetMonthlyAsCanonical
      ? "dataset.monthly"
      : "interval_rebucket_fallback";
  // Bounded compare_core: canonical totals must cover scored test days ∪ DB travel/vacant parity days.
  const compactCanonicalDateKeys = new Set<string>();
  for (const dk of Array.from(boundedTestDateKeysLocal)) compactCanonicalDateKeys.add(dk);
  for (const dk of travelVacantParityDateKeysLocal) compactCanonicalDateKeys.add(dk);
  if (compareCoreMemoryReducedPath) {
    await reportPhase("compact_pre_bounded_exact_parity_decode_start", {
      exactTravelParityRequiresIntervalBackedArtifactTruth,
      hadSeriesIntervals15InDataset: false,
    });
    await reportPhase("compact_pre_bounded_exact_parity_decode_done", {
      exactParityIntervalCount: 0,
      decodeBufferOwned: false,
    });
    await reportPhase("compact_pre_bounded_exact_parity_day_totals_start", {
      exactParityIntervalCount: 0,
      yieldEvery: 0,
    });
    await reportPhase("compact_pre_bounded_exact_parity_day_totals_done", {
      exactParityDayTotalCount: 0,
    });
  }
  if (compareCoreMemoryReducedPath) {
    await reportPhase("compact_pre_bounded_meta_read_start", {
      boundedTestDateKeyCount: boundedTestDateKeysLocal.size,
    });
  }
  let canonicalArtifactSimulatedDayTotalsByDate = compareCoreMemoryReducedPath
    ? readCanonicalArtifactSimulatedDayTotalsByDateForDateKeys(dataset, compactCanonicalDateKeys)
    : readCanonicalArtifactSimulatedDayTotalsByDate(dataset);
  canonicalArtifactSimulatedDayTotalsByDate = augmentCanonicalArtifactSimulatedDayTotalsFromArtifactDailySimulated(
    dataset,
    canonicalArtifactSimulatedDayTotalsByDate,
    compactCanonicalDateKeys
  );
  if (compareCoreMemoryReducedPath) {
    await reportPhase("compact_pre_bounded_meta_read_done", {
      preservedMetaCanonicalKeyCount: Object.keys(canonicalArtifactSimulatedDayTotalsByDate).length,
    });
    await reportPhase("compact_pre_bounded_canonical_build_start", {
      usesIntervalBackedDataset: false,
    });
  }
  throwIfGapfillCompareAborted(abortSignal);
  if (compareCoreMemoryReducedPath) {
    await reportPhase("compact_pre_bounded_canonical_build_done", {
      canonicalArtifactKeyCount: Object.keys(canonicalArtifactSimulatedDayTotalsByDate).length,
    });
  }
  if (compareCoreMemoryReducedPath) {
    await reportPhase("compact_pre_bounded_merge_backfill_start", {
      mergeBackfillWillRun: false,
    });
    await reportPhase("compact_pre_bounded_merge_backfill_done", {
      canonicalArtifactKeyCountAfterMerge: Object.keys(canonicalArtifactSimulatedDayTotalsByDate).length,
    });
  }
  if (compareCoreMemoryReducedPath) {
    await reportPhase("build_shared_compare_compact_bounded_canonical_ready", {
      boundedCanonicalDateCount: Object.keys(canonicalArtifactSimulatedDayTotalsByDate).length,
      compactCanonicalUnionKeyCount: compactCanonicalDateKeys.size,
      selectedDateKeyCount: boundedTestDateKeysLocal.size,
      parityDateKeyCount: travelVacantParityDateKeysLocal.length,
      usedIntervalBackedExactParityTruth: false,
    });
  }
  if (compareCoreMemoryReducedPath && exactTravelParityRequiresIntervalBackedArtifactTruth) {
    await reportPhase("compact_pre_bounded_meta_write_start", {
      canonicalArtifactKeyCount: Object.keys(canonicalArtifactSimulatedDayTotalsByDate).length,
    });
    await reportPhase("compact_pre_bounded_meta_write_done", {
      wroteCanonicalIntoDatasetMeta: false,
    });
  }
  let artifactSimulatedDayReferenceRows = useSelectedDaysScopedDisplayRows
    ? Array.from(displayDateKeysLocal)
        .sort((a, b) => (a < b ? -1 : 1))
        .flatMap((dk) => {
          const raw = (canonicalArtifactSimulatedDayTotalsByDate as Record<string, unknown>)[dk];
          const simKwh = Number(raw);
          if (!Number.isFinite(simKwh)) return [];
          return [{ date: dk, simKwh: round2Local(simKwh) }];
        })
    : Object.entries(canonicalArtifactSimulatedDayTotalsByDate)
        .map(([date, simKwh]) => ({ date: String(date).slice(0, 10), simKwh: round2Local(Number(simKwh) || 0) }))
        .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date) && displayDateKeysLocal.has(row.date))
        .sort((a, b) => (a.date < b.date ? -1 : 1));
  if (useSelectedDaysScopedDisplayRows) {
    simulatedChartDaily = simulatedChartDaily.filter((row) => displayDateKeysLocal.has(String(row.date ?? "").slice(0, 10)));
    simulatedChartMonthly = simulatedChartMonthly.filter((row) => chartMonthKeysLocal.has(String(row.month ?? "").slice(0, 7)));
    artifactSimulatedDayReferenceRows = artifactSimulatedDayReferenceRows.filter((row) =>
      displayDateKeysLocal.has(String(row.date ?? "").slice(0, 10))
    );
  }
  modelAssumptions.artifactSimulatedDayReferenceSource = "canonical_artifact_simulated_day_totals";
  modelAssumptions.artifactSimulatedDayReferenceCount = Object.keys(canonicalArtifactSimulatedDayTotalsByDate).length;
  modelAssumptions.selectedDaysRequestedCount = boundedTestDateKeysLocal.size;
  modelAssumptions.selectedDaysScoredCount = availableTestDateKeysFromSimulated.size;
  modelAssumptions.freshSimIntervalCountSelectedDays = simulatedTestIntervals.length;
  modelAssumptions.artifactReferenceDayCountUsed = artifactSimulatedDayReferenceRows.filter((row) =>
    boundedTestDateKeysLocal.has(row.date)
  ).length;
  modelAssumptions.travelVacantParityDateCount = travelVacantParityDateKeysLocal.length;
  const simulatedChartDailySourceByDate = new Map<string, "ACTUAL" | "SIMULATED">(
    simulatedChartDaily.map((row) => [String(row.date ?? "").slice(0, 10), row.source] as const)
  );
  await reportPhase("build_shared_compare_scored_row_keys_ready", {
    compareFreshModeUsed,
    compareCalculationScope,
    selectedDateCount: boundedTestDateKeysLocal.size,
    simulatedChartDailyCount: simulatedChartDaily.length,
    artifactReferenceRowCount: artifactSimulatedDayReferenceRows.length,
  });

  const freshDailyTotalsByDate = (() => {
    const totals = new Map<string, number>();
    // Canonical simulator-owned day totals for scored fresh diagnostics (not interval re-sums) when
    // includeFreshCompareCalc is true (GapFill compare_core: always). Explicit false keeps interval-only fallback for narrow tests.
    const useCanonicalFromSelectedDays =
      includeFreshCompareCalc &&
      needsFreshCompareForParity &&
      effectiveCompareFreshMode === "selected_days" &&
      selectedTestDailyTotalsByDate !== null;
    const useCanonicalFromFullWindow =
      includeFreshCompareCalc &&
      needsFreshCompareForParity &&
      effectiveCompareFreshMode === "full_window" &&
      Object.keys(freshParityCanonicalSimulatedDayTotalsByDate).length > 0;
    if (useCanonicalFromSelectedDays) {
      for (const dk of Array.from(boundedTestDateKeysLocal)) {
        const v = selectedTestDailyTotalsByDate!.get(dk);
        if (v !== undefined) totals.set(dk, round2Local(v));
      }
    } else if (useCanonicalFromFullWindow) {
      for (const dk of Array.from(boundedTestDateKeysLocal)) {
        const raw = freshParityCanonicalSimulatedDayTotalsByDate[dk];
        if (raw === undefined) continue;
        const num = Number(raw);
        if (!Number.isFinite(num)) continue;
        totals.set(dk, round2Local(num));
      }
    }
    for (const p of simulatedTestIntervals) {
      const dk = dateKeyInTimezone(p.timestamp, timezone);
      if (!boundedTestDateKeysLocal.has(dk)) continue;
      if ((useCanonicalFromSelectedDays || useCanonicalFromFullWindow) && totals.has(dk)) continue;
      totals.set(dk, (totals.get(dk) ?? 0) + (Number(p.kwh) || 0));
    }
    return totals;
  })();
  const canonicalArtifactDailyByDate = new Map<string, number>(
    Object.entries(canonicalArtifactSimulatedDayTotalsByDate)
      .map(([date, simKwh]) => [String(date).slice(0, 10), round2Local(Number(simKwh) || 0)] as const)
      .filter(([dk]) => /^\d{4}-\d{2}-\d{2}$/.test(dk))
  );
  const parityDisplayDailyByDate = new Map<string, number>();
  const allMissingDisplaySimDates: string[] = [];
  const allMissingFreshScoredDates: string[] = [];
  const allMismatchDates: string[] = [];
  for (const dk of Array.from(boundedTestDateKeysLocal)) {
    if (!canonicalArtifactDailyByDate.has(dk)) {
      allMissingDisplaySimDates.push(dk);
      continue;
    }
    const parityDisplayValue = round2Local(Number(canonicalArtifactDailyByDate.get(dk) ?? 0));
    parityDisplayDailyByDate.set(dk, parityDisplayValue);
    if (!freshDailyTotalsByDate.has(dk)) {
      allMissingFreshScoredDates.push(dk);
      continue;
    }
    if (round2Local(freshDailyTotalsByDate.get(dk) ?? 0) !== parityDisplayValue) {
      allMismatchDates.push(dk);
    }
  }
  const expectedMissingDisplaySimDates = allMissingDisplaySimDates;
  await reportPhase("build_shared_compare_scored_row_alignment_ready", {
    compareFreshModeUsed,
    compareCalculationScope,
    selectedDateKeyCount: boundedTestDateKeysLocal.size,
    selectedDateCount: boundedTestDateKeysLocal.size,
    artifactSimulatedDayReferenceRowCount: artifactSimulatedDayReferenceRows.length,
    comparableDateCount: parityDisplayDailyByDate.size,
    missingDisplaySimCount: expectedMissingDisplaySimDates.length,
    missingFreshCompareSimCount: allMissingFreshScoredDates.length,
    mismatchCount: allMismatchDates.length,
  });
  const comparableDateCount = Math.max(0, boundedTestDateKeysLocal.size - allMissingDisplaySimDates.length);
  const missingDisplaySimSampleDates = expectedMissingDisplaySimDates.slice(0, 10);
  const mismatchSampleDates = allMismatchDates.slice(0, 10);
  const parityComparisonBasis:
    | "display_shared_artifact_vs_compare_shared_full_window_then_filter"
    | "display_shared_artifact_vs_compare_artifact_filter_only"
    | "display_shared_artifact_vs_compare_selected_days_fresh_calc"
    | "artifact_simulated_display_rows_vs_compare_selected_days_fresh_calc" =
    "display_shared_artifact_vs_compare_artifact_filter_only";
  const scoredDayParityAvailability: GapfillScoredDayParityAvailability =
    expectedMissingDisplaySimDates.length === 0
      ? parityDisplayDailyByDate.size > 0
        ? allMissingFreshScoredDates.length > 0
          ? "missing_fresh_compare_sim"
          : "available"
        : boundedTestDateKeysLocal.size > 0
          ? "missing_expected_reference"
          : "available"
      : parityDisplayDailyByDate.size > 0
        ? "available"
        : "missing_expected_reference";
  const parityComparableDatesAligned = parityDisplayDailyByDate.size;
  const displayVsFreshParityForScoredDays = {
    matches:
      scoredDayParityAvailability === "available"
        ? allMismatchDates.length === 0
        : null,
    mismatchCount:
      scoredDayParityAvailability === "available" ? allMismatchDates.length : 0,
    mismatchSampleDates: scoredDayParityAvailability === "available" ? mismatchSampleDates : [],
    missingDisplaySimCount:
      scoredDayParityAvailability === "missing_expected_reference"
        ? expectedMissingDisplaySimDates.length
        : scoredDayParityAvailability === "available" && expectedMissingDisplaySimDates.length > 0
          ? expectedMissingDisplaySimDates.length
          : 0,
    missingDisplaySimSampleDates:
      scoredDayParityAvailability === "missing_expected_reference"
        ? missingDisplaySimSampleDates
        : scoredDayParityAvailability === "available" && expectedMissingDisplaySimDates.length > 0
          ? missingDisplaySimSampleDates
          : [],
    comparableDateCount,
    complete:
      scoredDayParityAvailability === "available"
        ? allMismatchDates.length === 0 &&
          expectedMissingDisplaySimDates.length === 0 &&
          allMissingFreshScoredDates.length === 0
        : null,
    availability: scoredDayParityAvailability,
    reasonCode:
      scoredDayParityAvailability === "available"
        ? ("ARTIFACT_SIMULATED_REFERENCE_AVAILABLE" as const)
        : scoredDayParityAvailability === "missing_fresh_compare_sim"
          ? ("SCORED_DAY_FRESH_COMPARE_SIM_MISSING" as const)
          : ("ARTIFACT_SIMULATED_REFERENCE_MISSING" as const),
    explanation:
      scoredDayParityAvailability === "available"
        ? expectedMissingDisplaySimDates.length > 0
          ? "Artifact-side canonical simulated-day totals are available for scored-day parity for comparable dates; some scored dates still lack a simulated-day reference row."
          : "Artifact-side canonical simulated-day totals are available for scored-day parity."
        : scoredDayParityAvailability === "missing_fresh_compare_sim"
          ? "Artifact-side canonical simulated-day totals match the shared compare path for comparable dates; one or more scored dates lack fresh shared simulated totals for display parity."
          : "Expected artifact simulated-day references were not available for some scored dates.",
    scope: "scored_test_days_local" as const,
    granularity: "daily_kwh_rounded_2dp" as const,
    parityDisplaySourceUsed: "canonical_artifact_simulated_day_totals" as const,
    parityDisplayValueKind:
      scoredDayParityAvailability === "available"
        ? ("artifact_simulated_day_total" as const)
        : scoredDayParityAvailability === "missing_fresh_compare_sim"
          ? ("missing_fresh_compare_sim_day_total" as const)
          : ("missing_display_sim_reference" as const),
    missingFreshCompareSimCount: allMissingFreshScoredDates.length,
    missingFreshCompareSimSampleDates: allMissingFreshScoredDates.slice(0, 10),
    comparisonBasis: parityComparisonBasis,
  };
  await reportPhase("build_shared_compare_scored_row_merge_ready", {
    compareFreshModeUsed,
    compareCalculationScope,
    scoredDayParityAvailability,
    alignedComparableDateCount: parityComparableDatesAligned,
    mergedComparableDateCount: displayVsFreshParityForScoredDays.comparableDateCount,
    preservedComparableHandoff: parityComparableDatesAligned === displayVsFreshParityForScoredDays.comparableDateCount,
    comparableDateCount: displayVsFreshParityForScoredDays.comparableDateCount,
    mismatchCount: displayVsFreshParityForScoredDays.mismatchCount,
    missingDisplaySimCount: displayVsFreshParityForScoredDays.missingDisplaySimCount,
  });
  await reportPhase("build_shared_compare_scored_rows_ready", {
    compareFreshModeUsed,
    compareCalculationScope,
    displayDateCount: displayDateKeysLocal.size,
    simulatedChartDailyCount: simulatedChartDaily.length,
    artifactReferenceRowCount: artifactSimulatedDayReferenceRows.length,
    comparableDateCount: displayVsFreshParityForScoredDays.comparableDateCount,
  });
  if (compareCoreMemoryReducedPath) {
    await reportPhase("compact_post_scored_rows_parity_start", {
      parityRowCount: travelVacantParityDateKeysLocal.length,
      scoredRowCount: boundedTestDateKeysLocal.size,
      alignedComparableDateCount: parityComparableDatesAligned,
      comparableDateCount: displayVsFreshParityForScoredDays.comparableDateCount,
      mismatchCount: displayVsFreshParityForScoredDays.mismatchCount,
      responseAssemblyStarted: false,
    });
  }
  throwIfGapfillCompareAborted(abortSignal);
  const freshParityDailyByDate = new Map<string, number>(
    Object.entries(freshParityCanonicalSimulatedDayTotalsByDate).map(([date, simKwh]) => [
      String(date).slice(0, 10),
      round2Local(Number(simKwh) || 0),
    ])
  );
  throwIfGapfillCompareAborted(abortSignal);
  const parityDateKeysOrdered = travelVacantParityDateKeysLocal;
  const PARITY_ROW_ABORT_STRIDE = 24;
  const travelVacantParityMismatchDiagnosticsSample: TravelVacantParityMismatchDiagnostic[] = [];
  travelVacantParityRows = [];
  for (let i = 0; i < parityDateKeysOrdered.length; i++) {
    if (i % PARITY_ROW_ABORT_STRIDE === 0) throwIfGapfillCompareAborted(abortSignal);
    const dk = parityDateKeysOrdered[i]!;
    const artifactCanonicalSimDayKwh = canonicalArtifactDailyByDate.has(dk)
      ? round2Local(Number(canonicalArtifactDailyByDate.get(dk) ?? 0))
      : null;
    const freshSharedDayCalcKwh = freshParityDailyByDate.has(dk)
      ? round2Local(Number(freshParityDailyByDate.get(dk) ?? 0))
      : null;
    const parityMatch =
      artifactCanonicalSimDayKwh == null || freshSharedDayCalcKwh == null
        ? null
        : round2Local(artifactCanonicalSimDayKwh) === round2Local(freshSharedDayCalcKwh);
    travelVacantParityRows.push({
      localDate: dk,
      artifactCanonicalSimDayKwh,
      freshSharedDayCalcKwh,
      parityMatch,
      artifactReferenceAvailability:
        artifactCanonicalSimDayKwh == null ? "missing_canonical_artifact_day_total" : "available",
      freshCompareAvailability:
        freshSharedDayCalcKwh == null ? "missing_fresh_shared_compare_output" : "available",
      parityReasonCode:
        artifactCanonicalSimDayKwh == null
          ? "TRAVEL_VACANT_ARTIFACT_REFERENCE_MISSING"
          : freshSharedDayCalcKwh == null
            ? "TRAVEL_VACANT_FRESH_COMPARE_OUTPUT_MISSING"
            : parityMatch
              ? "TRAVEL_VACANT_PARITY_MATCH"
              : "TRAVEL_VACANT_PARITY_MISMATCH",
    });
  }
  throwIfGapfillCompareAborted(abortSignal);
  let releasedFreshParityIntervals = false;
  const releasedExactParityArtifactIntervals = false;
  if (compareCoreMemoryReducedPath) {
    await reportPhase("compact_post_scored_rows_parity_rows_ready", {
      parityRowCount: travelVacantParityRows.length,
      truthDateCount: travelVacantParityDateKeysLocal.length,
      usedIndexedIntervalDayTotals: false,
      usedCompactParityTruth: false,
      mismatchCount: displayVsFreshParityForScoredDays.mismatchCount,
      releasedFreshParityIntervals: false,
      releasedExactParityArtifactIntervals: false,
    });
  }
  if (compareCoreMemoryReducedPath) {
    // Interval arrays are only inputs to the travel/vacant parity row map above; release them early on
    // the compact path so later phases (truth objects, DB status writes) do not retain peak heap.
    freshParityIntervals.length = 0;
    releasedFreshParityIntervals = true;
  }
  const travelVacantParityMissingArtifactCount = travelVacantParityRows.filter(
    (row) => row.artifactReferenceAvailability !== "available"
  ).length;
  const travelVacantParityMissingFreshCount = travelVacantParityRows.filter(
    (row) => row.freshCompareAvailability !== "available"
  ).length;
  const travelVacantParityMismatchCount = travelVacantParityRows.filter((row) => row.parityMatch === false).length;
  const travelVacantParityValidatedCount = travelVacantParityRows.filter((row) => row.parityMatch === true).length;
  throwIfGapfillCompareAborted(abortSignal);
  travelVacantParityTruth =
    travelVacantParityDateKeysLocal.length === 0
      ? {
          availability: "not_requested",
          reasonCode: "TRAVEL_VACANT_PARITY_NOT_REQUESTED",
          explanation: "No DB travel/vacant dates were available for parity validation in this coverage window.",
          source: "db_travel_vacant_ranges",
          comparisonBasis: "canonical_artifact_simulated_day_totals_vs_fresh_shared_compare_daily_totals",
          requestedDateCount: 0,
          validatedDateCount: 0,
          mismatchCount: 0,
          missingArtifactReferenceCount: 0,
          missingFreshCompareCount: 0,
          requestedDateSample: [],
          exactProofRequired: exactArtifactReadRequired,
          exactProofSatisfied: true,
        }
      : travelVacantParityMissingFreshCount > 0
        ? {
            availability: "missing_fresh_compare_output",
            reasonCode: "TRAVEL_VACANT_FRESH_COMPARE_OUTPUT_MISSING",
            explanation: "Shared compare did not produce fresh simulated day totals for one or more DB travel/vacant parity dates.",
            source: "db_travel_vacant_ranges",
            comparisonBasis: "canonical_artifact_simulated_day_totals_vs_fresh_shared_compare_daily_totals",
            requestedDateCount: travelVacantParityDateKeysLocal.length,
            validatedDateCount: travelVacantParityValidatedCount,
            mismatchCount: travelVacantParityMismatchCount,
            missingArtifactReferenceCount: travelVacantParityMissingArtifactCount,
            missingFreshCompareCount: travelVacantParityMissingFreshCount,
            requestedDateSample: travelVacantParityDateKeysLocal.slice(0, 10),
            exactProofRequired: exactArtifactReadRequired,
            exactProofSatisfied: false,
          }
        : travelVacantParityMissingArtifactCount > 0
          ? {
              availability: "missing_artifact_reference",
              reasonCode: "TRAVEL_VACANT_ARTIFACT_REFERENCE_MISSING",
              explanation: "Canonical artifact simulated-day totals were missing for one or more DB travel/vacant parity dates.",
              source: "db_travel_vacant_ranges",
              comparisonBasis: "canonical_artifact_simulated_day_totals_vs_fresh_shared_compare_daily_totals",
              requestedDateCount: travelVacantParityDateKeysLocal.length,
              validatedDateCount: travelVacantParityValidatedCount,
              mismatchCount: travelVacantParityMismatchCount,
              missingArtifactReferenceCount: travelVacantParityMissingArtifactCount,
              missingFreshCompareCount: travelVacantParityMissingFreshCount,
              requestedDateSample: travelVacantParityDateKeysLocal.slice(0, 10),
              exactProofRequired: exactArtifactReadRequired,
              exactProofSatisfied: false,
            }
          : travelVacantParityMismatchCount > 0
            ? {
                availability: "mismatch_detected",
                reasonCode: "TRAVEL_VACANT_PARITY_MISMATCH",
                explanation: "DB travel/vacant parity validation found a mismatch between canonical artifact totals and fresh shared compare totals.",
                source: "db_travel_vacant_ranges",
                comparisonBasis: "canonical_artifact_simulated_day_totals_vs_fresh_shared_compare_daily_totals",
                requestedDateCount: travelVacantParityDateKeysLocal.length,
                validatedDateCount: travelVacantParityValidatedCount,
                mismatchCount: travelVacantParityMismatchCount,
                missingArtifactReferenceCount: 0,
                missingFreshCompareCount: 0,
                requestedDateSample: travelVacantParityDateKeysLocal.slice(0, 10),
                exactProofRequired: exactArtifactReadRequired,
                exactProofSatisfied: false,
                mismatchDiagnosticsSample:
                  travelVacantParityMismatchDiagnosticsSample.length > 0
                    ? travelVacantParityMismatchDiagnosticsSample
                    : undefined,
              }
            : {
                availability: "validated",
                reasonCode: "TRAVEL_VACANT_PARITY_VALIDATED",
                explanation: "DB travel/vacant parity validation proved canonical artifact simulated-day totals match fresh shared compare totals for the validated dates.",
                source: "db_travel_vacant_ranges",
                comparisonBasis: "canonical_artifact_simulated_day_totals_vs_fresh_shared_compare_daily_totals",
                requestedDateCount: travelVacantParityDateKeysLocal.length,
                validatedDateCount: travelVacantParityValidatedCount,
                mismatchCount: 0,
                missingArtifactReferenceCount: 0,
                missingFreshCompareCount: 0,
                requestedDateSample: travelVacantParityDateKeysLocal.slice(0, 10),
                exactProofRequired: exactArtifactReadRequired,
                exactProofSatisfied: true,
              };
  throwIfGapfillCompareAborted(abortSignal);
  if (compareCoreMemoryReducedPath) {
    await reportPhase("compact_post_scored_rows_parity_truth_ready", {
      parityRowCount: travelVacantParityRows.length,
      parityTruthRowCount: travelVacantParityDateKeysLocal.length,
      truthAvailability: travelVacantParityTruth.availability,
      usedCompactParityTruth: false,
      releasedFreshParityIntervals,
      releasedExactParityArtifactIntervals,
      mismatchCount: travelVacantParityMismatchCount,
    });
  }
  if (compareCoreMemoryReducedPath) {
    await reportPhase("compact_post_scored_rows_parity_done", {
      parityRowCount: travelVacantParityRows.length,
      scoredRowCount: boundedTestDateKeysLocal.size,
      comparableDateCount: displayVsFreshParityForScoredDays.comparableDateCount,
      mismatchCount: travelVacantParityMismatchCount,
      travelVacantTruthAvailability: travelVacantParityTruth.availability,
      responseAssemblyStarted: false,
    });
  }
  if (compareCoreMemoryReducedPath) {
    await reportPhase("build_shared_compare_compact_post_scored_sim_ready", {
      compactScoredRowCount: boundedTestDateKeysLocal.size,
      compactParityRowCount: travelVacantParityRows.length,
      compactWeatherRowCount: scoredDayWeatherRows.length,
      artifactReferenceRowCount: artifactSimulatedDayReferenceRows.length,
      comparableDateCount: displayVsFreshParityForScoredDays.comparableDateCount,
      missingDisplaySimCount: displayVsFreshParityForScoredDays.missingDisplaySimCount,
    });
  }
  modelAssumptions.travelVacantParityValidatedCount = travelVacantParityValidatedCount;
  modelAssumptions.travelVacantParityMismatchCount = travelVacantParityMismatchCount;
  modelAssumptions.travelVacantParityMissingArtifactReferenceCount = travelVacantParityMissingArtifactCount;
  modelAssumptions.travelVacantParityMissingFreshCompareCount = travelVacantParityMissingFreshCount;
  if (compareCoreMemoryReducedPath) {
    await reportPhase("compact_post_scored_rows_metrics_start", {
      parityRowCount: travelVacantParityRows.length,
      scoredRowCount: boundedTestDateKeysLocal.size,
      comparableDateCount: displayVsFreshParityForScoredDays.comparableDateCount,
      mismatchCount: travelVacantParityMismatchCount,
      responseAssemblyStarted: false,
    });
  }
  await reportPhase("build_shared_compare_parity_ready", {
    compareFreshModeUsed,
    compareCalculationScope,
    travelVacantRequestedDateCount: travelVacantParityDateKeysLocal.length,
    travelVacantValidatedDateCount: travelVacantParityValidatedCount,
    travelVacantMismatchCount: travelVacantParityMismatchCount,
    travelVacantMissingArtifactReferenceCount: travelVacantParityMissingArtifactCount,
    travelVacantMissingFreshCompareCount: travelVacantParityMissingFreshCount,
  });
  await reportPhase("build_shared_compare_metrics_ready", {
    compareFreshModeUsed,
    compareCalculationScope,
    scoredDateCount: boundedTestDateKeysLocal.size,
    travelVacantRequestedDateCount: travelVacantParityDateKeysLocal.length,
    travelVacantValidatedDateCount: travelVacantParityValidatedCount,
    travelVacantMismatchCount: travelVacantParityMismatchCount,
    travelVacantMissingArtifactReferenceCount: travelVacantParityMissingArtifactCount,
    travelVacantMissingFreshCompareCount: travelVacantParityMissingFreshCount,
  });
  if (compareCoreMemoryReducedPath) {
    await reportPhase("compact_post_scored_rows_metrics_done", {
      parityRowCount: travelVacantParityRows.length,
      scoredRowCount: boundedTestDateKeysLocal.size,
      comparableDateCount: displayVsFreshParityForScoredDays.comparableDateCount,
      mismatchCount: travelVacantParityMismatchCount,
      responseAssemblyStarted: false,
    });
  }
  if (exactArtifactReadRequired && travelVacantParityTruth.exactProofSatisfied !== true) {
    return {
      ok: false,
      status: 409,
      body: {
        ok: false,
        error: "travel_vacant_parity_proof_failed",
        message:
          "Compare requires exact shared artifact parity proof, but DB travel/vacant parity could not be proven against fresh shared compare output.",
        mode: "artifact_only",
        scenarioId: sharedScenarioCacheId,
        reasonCode: travelVacantParityTruth.reasonCode,
        travelVacantParityTruth,
        travelVacantParityRows: travelVacantParityRows.slice(0, 25),
      },
    };
  }

  if (compareCoreMemoryReducedPath) {
    await reportPhase("compact_post_scored_rows_response_start", {
      parityRowCount: travelVacantParityRows.length,
      scoredRowCount: boundedTestDateKeysLocal.size,
      comparableDateCount: displayVsFreshParityForScoredDays.comparableDateCount,
      mismatchCount: travelVacantParityMismatchCount,
      responseAssemblyStarted: true,
    });
  }

  const responseModelAssumptions =
    useSelectedDaysLightweightArtifactRead && effectiveCompareFreshMode === "selected_days"
      ? (() => {
          const out: Record<string, unknown> = { ...(modelAssumptions as Record<string, unknown>) };
          const selectedDateKeySet = new Set<string>(
            Array.from(boundedTestDateKeysLocal)
              .map((dk) => String(dk ?? "").slice(0, 10))
              .filter((dk) => /^\d{4}-\d{2}-\d{2}$/.test(dk))
          );
          if (Array.isArray(out.simulatedDayDiagnosticsSample)) {
            const filtered = (out.simulatedDayDiagnosticsSample as Array<Record<string, unknown>>).filter((row) =>
              selectedDateKeySet.has(String((row as any)?.localDate ?? "").slice(0, 10))
            );
            if (filtered.length > 0) out.simulatedDayDiagnosticsSample = filtered;
            else delete out.simulatedDayDiagnosticsSample;
          }
          if (Array.isArray(out.weatherApiData)) {
            const filtered = (out.weatherApiData as Array<Record<string, unknown>>).filter((row) =>
              selectedDateKeySet.has(String((row as any)?.dateKey ?? "").slice(0, 10))
            );
            if (filtered.length > 0) out.weatherApiData = filtered;
            else delete out.weatherApiData;
          }
          return out;
        })()
      : modelAssumptions;
  if (
    boundedTestDateKeysLocal.size > 0 &&
    scoredDayWeatherRows.length === 0 &&
    Array.isArray((responseModelAssumptions as any)?.weatherApiData)
  ) {
    const weatherPayloadFromMeta = buildScoredDayWeatherPayloadFromWeatherApiData({
      scoredDateKeysLocal: boundedTestDateKeysLocal,
      weatherApiData: (responseModelAssumptions as any).weatherApiData,
      weatherBasisUsed:
        weatherBasisUsed ??
        (typeof (responseModelAssumptions as any)?.weatherSourceSummary === "string"
          ? String((responseModelAssumptions as any).weatherSourceSummary)
          : null),
      weatherKindUsed:
        typeof (responseModelAssumptions as any)?.weatherKindUsed === "string"
          ? String((responseModelAssumptions as any).weatherKindUsed)
          : null,
      weatherProviderName:
        typeof (responseModelAssumptions as any)?.weatherProviderName === "string"
          ? String((responseModelAssumptions as any).weatherProviderName)
          : null,
      weatherFallbackReason:
        typeof (responseModelAssumptions as any)?.weatherFallbackReason === "string"
          ? String((responseModelAssumptions as any).weatherFallbackReason)
          : null,
    });
    scoredDayWeatherRows = weatherPayloadFromMeta.rows;
    scoredDayWeatherTruth = weatherPayloadFromMeta.truth;
  }
  const sharedProfiles = displayProfilesFromModelMeta(responseModelAssumptions);
  await reportPhase("build_shared_compare_response_ready", {
    compareFreshModeUsed,
    compareCalculationScope,
    scoredDateCount: boundedTestDateKeysLocal.size,
    scoredDayWeatherCount: scoredDayWeatherRows.length,
    travelVacantParityRowCount: travelVacantParityRows.length,
    modelAssumptionsKeyCount: Object.keys(responseModelAssumptions ?? {}).length,
  });
  await reportPhase("build_shared_compare_finalize_start", {
    compareFreshModeUsed,
    compareCalculationScope,
    scoredDateCount: boundedTestDateKeysLocal.size,
    scoredDayWeatherCount: scoredDayWeatherRows.length,
    travelVacantParityRowCount: travelVacantParityRows.length,
  });

  const freshCompareScoredDaySimTotalsByDate = Object.fromEntries(
    Array.from(freshDailyTotalsByDate.entries()).map(([dk, kwh]) => [dk, round2Local(Number(kwh) || 0)] as const)
  );

  const gapfillScoringDiagnostics: GapfillScoringDiagnostics | undefined = (() => {
    if (!needsFreshCompareForParity) return undefined;
    const keepRefSet = new Set(lastFreshGapfillKeepRefLocalDateKeys ?? []);
    const testDaysInReferencePoolCount = Array.from(boundedTestDateKeysLocal).filter(
      (dk) => !boundedTravelDateKeysLocal.has(dk)
    ).length;
    const sameSharedRunAsParityRun =
      travelVacantParityDateKeysLocal.length === 0 ? true : needsFreshCompareForParity;
    const scoredDays: GapfillScoringDiagnosticsDayRow[] = Array.from(boundedTestDateKeysLocal)
      .sort()
      .map((dk) => {
        const inTravel = boundedTravelDateKeysLocal.has(dk);
        const hasSim = freshDailyTotalsByDate.has(dk);
        const inKeepRefMeta =
          keepRefSet.size > 0 ? keepRefSet.has(dk) : boundedTestDateKeysLocal.has(dk);
        return {
          selectedDateKey: dk,
          inReferencePool: !inTravel,
          excludedFromReferencePoolReason: inTravel ? ("travel_vacant" as const) : null,
          compareOutputSource: hasSim ? ("MODELED_SIM" as const) : ("MISSING_SIM" as const),
          compareOutputOwnership: hasSim ? ("simulator_owned" as const) : ("missing" as const),
          compareOutputAuthority: "freshCompareScoredDaySimTotalsByDate" as const,
          actualSource: "actual_usage" as const,
          wasMeterPassthroughPrevented: Boolean(inKeepRefMeta && hasSim && !inTravel),
          dayModelingMode: !hasSim
            ? ("missing_modeled_output" as const)
            : inTravel
              ? ("travel_vacant_overlap_scored_day" as const)
              : ("forced_modeled_scored_day" as const),
          sameSharedRunAsParity: sameSharedRunAsParityRun,
        };
      });
    const scoredDaysModeledCount = scoredDays.filter((r) => r.compareOutputSource === "MODELED_SIM").length;
    const scoredDaysMissingModeledCount = scoredDays.filter((r) => r.compareOutputSource === "MISSING_SIM").length;
    const unionFp = [
      ...Array.from(boundedTestDateKeysLocal).sort(),
      ...travelVacantParityDateKeysLocal.slice().sort(),
    ].join("|");
    return {
      run: {
        scoringMode: "modeled_scored_days",
        referencePoolRuleSummary:
          "Reference pool excludes only travel/vacant; test-day actuals remain in the pool; compare uses shared modeled totals (keep-ref) for scored dates.",
        testDaysInReferencePoolCount,
        travelVacantExcludedCount: boundedTravelDateKeysLocal.size,
        scoredDaysModeledCount,
        scoredDaysMissingModeledCount,
        parityDaysValidatedCount: travelVacantParityValidatedCount,
        compareSharedCalcPath,
        compareFreshModeUsed,
        oneUnionRunUsed: needsFreshCompareForParity,
        sameSharedRunAsParity: sameSharedRunAsParityRun,
        actualAsSimGuardWouldTrigger: false,
        sharedRunFingerprint: `${effectiveCompareFreshMode}:${compareCalculationScope}:${unionFp}`,
        gapfillForceModeledKeepRefLocalDateKeys: lastFreshGapfillKeepRefLocalDateKeys,
        gapfillForceModeledKeepRefUtcKeyCount: lastFreshGapfillKeepRefUtcKeyCount,
      },
      scoredDays,
    };
  })();
  (modelAssumptions as Record<string, unknown>).gapfillScoringDiagnostics = gapfillScoringDiagnostics;

  return {
    ok: true,
    artifactAutoRebuilt,
    scoringSimulatedSource,
    scoringUsedSharedArtifact: comparePulledFromSharedArtifactOnly,
    artifactBuildExcludedSource: "shared_past_travel_vacant_excludedDateKeysFingerprint",
    scoringExcludedSource,
    artifactUsesTestDaysInIdentity: false,
    artifactUsesTravelDaysInIdentity: true,
    sharedArtifactScenarioId: String(modelAssumptions?.artifactScenarioId ?? sharedScenarioCacheId),
    sharedArtifactInputHash:
      (typeof modelAssumptions?.artifactInputHash === "string" && modelAssumptions.artifactInputHash) ||
      (typeof modelAssumptions?.artifactInputHashUsed === "string" && modelAssumptions.artifactInputHashUsed) ||
      null,
    comparePulledFromSharedArtifactOnly,
    scoredTestDaysMissingSimulatedOwnershipCount,
    compareSharedCalcPath,
    compareCalculationScope,
    displaySimSource: useDatasetDailyAsCanonical ? "dataset.daily" : "interval_rebucket_fallback",
    compareSimSource,
    compareFreshModeUsed,
    weatherBasisUsed,
    artifactSimulatedDayReferenceSource: "canonical_artifact_simulated_day_totals",
    artifactSimulatedDayReferenceRows,
    travelVacantParityRows,
    travelVacantParityTruth,
    scoredDayWeatherRows,
    scoredDayWeatherTruth,
    displayVsFreshParityForScoredDays,
    timezoneUsedForScoring: timezone,
    windowUsedForScoring: sharedCoverageWindow,
    scoringTestDateKeysLocal: boundedTestDateKeysLocal,
    sharedCoverageWindow,
    boundedTravelDateKeysLocal,
    artifactIntervals,
    simulatedTestIntervals,
    freshCompareScoredDaySimTotalsByDate,
    gapfillScoringDiagnostics,
    simulatedChartIntervals,
    simulatedChartDaily,
    simulatedChartMonthly,
    simulatedChartStitchedMonth,
    modelAssumptions: responseModelAssumptions,
    homeProfileFromModel: sharedProfiles.homeProfile,
    applianceProfileFromModel: sharedProfiles.applianceProfile,
  };
}

function normalizeScenarioTravelRanges(
  events: Array<{ kind: string; payloadJson: any }>,
): Array<{ startDate: string; endDate: string }> {
  return (events || [])
    .filter((e) => String(e?.kind ?? "") === "TRAVEL_RANGE")
    .map((e) => {
      const p = (e as any)?.payloadJson ?? {};
      const startDate = typeof p?.startDate === "string" ? String(p.startDate).slice(0, 10) : "";
      const endDate = typeof p?.endDate === "string" ? String(p.endDate).slice(0, 10) : "";
      return { startDate, endDate };
    })
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.startDate) && /^\d{4}-\d{2}-\d{2}$/.test(r.endDate));
}

function serializeTravelRangesForIdentity(
  ranges: Array<{ startDate: string; endDate: string }>
): string {
  return JSON.stringify(
    normalizePreLockboxTravelRanges(ranges).map((range) => ({
      startDate: range.startDate,
      endDate: range.endDate,
    }))
  );
}

function buildScenarioEventsHashRows(
  events: Array<{ id?: string; effectiveMonth?: string; kind?: string; payloadJson?: any }>
): Array<{
  id: string;
  effectiveMonth: string;
  kind: string;
  multiplier: number | null;
  adderKwh: number | null;
  startDate: string | null;
  endDate: string | null;
}> {
  return events
    .map((e) => {
      const p = (e as any)?.payloadJson ?? {};
      const multiplier = typeof p?.multiplier === "number" && Number.isFinite(p.multiplier) ? p.multiplier : null;
      const adderKwh = typeof p?.adderKwh === "number" && Number.isFinite(p.adderKwh) ? p.adderKwh : null;
      const startDate = typeof p?.startDate === "string" ? String(p.startDate).slice(0, 10) : null;
      const endDate = typeof p?.endDate === "string" ? String(p.endDate).slice(0, 10) : null;
      return {
        id: String(e?.id ?? ""),
        effectiveMonth: String(e?.effectiveMonth ?? ""),
        kind: String(e?.kind ?? ""),
        multiplier,
        adderKwh,
        startDate,
        endDate,
      };
    })
    .sort((a, b) => {
      if (a.effectiveMonth !== b.effectiveMonth) return a.effectiveMonth < b.effectiveMonth ? -1 : 1;
      if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
}

function applyMonthlyOverlay(args: { base: number; mult?: unknown; add?: unknown }): number {
  const base = Number(args.base) || 0;
  const multNum = args.mult == null ? NaN : Number(args.mult);
  const mult = Number.isFinite(multNum) ? multNum : 1;
  const addNum = args.add == null ? NaN : Number(args.add);
  const add = Number.isFinite(addNum) ? addNum : 0;
  return Math.max(0, base * mult + add);
}

/** When actual Baseline dataset has empty or inconsistent monthly (e.g. sum << summary.totalKwh), fill from build so the dashboard shows correct monthly breakdown. */
function ensureBaselineMonthlyFromBuild(dataset: any, buildInputs: SimulatorBuildInputsV1): void {
  const canonicalMonths = (buildInputs as any).canonicalMonths as string[] | undefined;
  const byMonth = buildInputs.monthlyTotalsKwhByMonth;
  if (!Array.isArray(canonicalMonths) || canonicalMonths.length === 0 || !byMonth || typeof byMonth !== "object") return;
  const totalKwh = Number(dataset?.summary?.totalKwh) || 0;
  const monthly = Array.isArray(dataset?.monthly) ? dataset.monthly : [];
  const monthlySum = monthly.reduce((s: number, r: { kwh?: number }) => s + (Number(r?.kwh) || 0), 0);
  if (monthly.length > 0 && totalKwh > 0 && monthlySum >= totalKwh * 0.99) return;
  const built = canonicalMonths.map((ym) => ({
    month: String(ym).trim(),
    kwh: Math.round((Number(byMonth[ym]) || 0) * 100) / 100,
  }));
  dataset.monthly = built;
}

/** Canonical window as date range (YYYY-MM-DD) and day count for display and interval count. */
function canonicalWindowDateRange(canonicalMonths: string[]): { start: string; end: string; days: number } | null {
  if (!Array.isArray(canonicalMonths) || canonicalMonths.length === 0) return null;
  const first = String(canonicalMonths[0]).trim();
  const last = String(canonicalMonths[canonicalMonths.length - 1]).trim();
  if (!/^\d{4}-\d{2}$/.test(first) || !/^\d{4}-\d{2}$/.test(last)) return null;
  const start = `${first}-01`;
  const [y, m] = last.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const end = `${last}-${String(lastDay).padStart(2, "0")}`;
  const days = Math.round((new Date(end + "T12:00:00.000Z").getTime() - new Date(start + "T12:00:00.000Z").getTime()) / (24 * 60 * 60 * 1000)) + 1;
  return { start, end, days: Math.max(1, days) };
}

export function resolveSharedPastRecalcWindow(args: {
  mode: "SMT_BASELINE" | "MANUAL_TOTALS" | "NEW_BUILD_ESTIMATE";
  canonicalMonths: string[];
  smtAnchorPeriods?: Array<{ startDate: string; endDate: string }> | undefined;
}): {
  startDate: string;
  endDate: string;
  source: "smt_anchor" | "canonical_month_range" | "canonical_coverage_fallback";
} {
  // Shared producer parity lock:
  // Past simulation window ownership is canonical usage coverage across cold_build/recalc/lab_validation.
  // SMT anchors remain metadata for actual/source context, not producer coverage ownership.
  void args;
  const canonicalCoverage = resolveCanonicalUsage365CoverageWindow();
  return {
    startDate: canonicalCoverage.startDate,
    endDate: canonicalCoverage.endDate,
    source: "canonical_coverage_fallback",
  };
}

export function shouldWarmValidationSelectionPreload(args: {
  mode: "SMT_BASELINE" | "MANUAL_TOTALS" | "NEW_BUILD_ESTIMATE";
  scenarioName: string | null | undefined;
  hasPreloadContext: boolean;
  hasValidationDateKeys: boolean;
  alreadyUsedSelectionPreload: boolean;
}): boolean {
  return (
    args.hasPreloadContext &&
    args.mode === "SMT_BASELINE" &&
    args.scenarioName === WORKSPACE_PAST_NAME &&
    args.hasValidationDateKeys &&
    !args.alreadyUsedSelectionPreload
  );
}

export function emitRecalcPreIntervalStageEvent(args: {
  event: string;
  correlationId?: string;
  houseId: string;
  actualContextHouseId: string;
  scenarioId: string | null;
  mode: SimulatorMode;
  durationMs?: number;
  failureCode?: string;
  failureMessage?: string;
}): void {
  logSimPipelineEvent(args.event, {
    correlationId: args.correlationId,
    houseId: args.houseId,
    sourceHouseId: args.actualContextHouseId !== args.houseId ? args.actualContextHouseId : undefined,
    testHomeId: args.actualContextHouseId !== args.houseId ? args.houseId : undefined,
    scenarioId: args.scenarioId,
    mode: args.mode,
    durationMs: args.durationMs,
    failureCode: args.failureCode,
    failureMessage: args.failureMessage,
    source: "recalcSimulatorBuildImpl",
    memoryRssMb: getMemoryRssMb(),
  });
}

export function shouldEmitRecalcValidationSetupSuccess(args: {
  mode: SimulatorMode;
  validationSetupFailed: boolean;
}): boolean {
  if (args.mode !== "SMT_BASELINE") return true;
  return !args.validationSetupFailed;
}

export function buildSmtAnchorPeriodsFromActualSummary(args: {
  summaryStart: unknown;
  summaryEnd: unknown;
}): Array<{ id: string; startDate: string; endDate: string }> | null {
  const isRealDateKey = (value: string): boolean => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [yRaw, mRaw, dRaw] = value.split("-");
    const y = Number(yRaw);
    const m = Number(mRaw);
    const d = Number(dRaw);
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return false;
    if (m < 1 || m > 12 || d < 1 || d > 31) return false;
    const parsed = new Date(Date.UTC(y, m - 1, d, 12, 0, 0, 0));
    if (!Number.isFinite(parsed.getTime())) return false;
    return (
      parsed.getUTCFullYear() === y &&
      parsed.getUTCMonth() === m - 1 &&
      parsed.getUTCDate() === d
    );
  };
  const start = args.summaryStart ? String(args.summaryStart).slice(0, 10) : null;
  const end = args.summaryEnd ? String(args.summaryEnd).slice(0, 10) : null;
  if (!start || !end) return null;
  if (!isRealDateKey(start) || !isRealDateKey(end)) return null;
  return [{ id: "anchor", startDate: start, endDate: end }];
}

async function resolveCanonicalActualIdentityForBuild(args: {
  userId: string;
  requestHouseId: string;
  requestHouseEsiid: string | null;
  buildInputs: Record<string, unknown>;
}): Promise<{ houseId: string; esiid: string | null }> {
  const buildActualContextHouseId =
    typeof (args.buildInputs as any)?.actualContextHouseId === "string" &&
    String((args.buildInputs as any).actualContextHouseId).trim()
      ? String((args.buildInputs as any).actualContextHouseId).trim()
      : args.requestHouseId;
  if (buildActualContextHouseId === args.requestHouseId) {
    return { houseId: args.requestHouseId, esiid: args.requestHouseEsiid ?? null };
  }
  const actualHouse = await getHouseAddressForUserHouse({
    userId: args.userId,
    houseId: buildActualContextHouseId,
  });
  return {
    houseId: buildActualContextHouseId,
    esiid:
      actualHouse && typeof (actualHouse as any).esiid === "string" && String((actualHouse as any).esiid).trim()
        ? String((actualHouse as any).esiid)
        : args.requestHouseEsiid ?? null,
  };
}

function monthsIntersectingTravelRanges(
  canonicalMonths: string[],
  travelRanges: Array<{ startDate: string; endDate: string }>
): Set<string> {
  const out = new Set<string>();
  const monthSet = new Set((canonicalMonths ?? []).map((m) => String(m)));
  for (const r of travelRanges ?? []) {
    const start = String(r?.startDate ?? "").slice(0, 10);
    const end = String(r?.endDate ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) continue;
    const a = new Date(start + "T12:00:00.000Z");
    const b = new Date(end + "T12:00:00.000Z");
    if (!Number.isFinite(a.getTime()) || !Number.isFinite(b.getTime())) continue;
    const firstMs = Math.min(a.getTime(), b.getTime());
    const lastMs = Math.max(a.getTime(), b.getTime());
    let cur = new Date(firstMs);
    while (cur.getTime() <= lastMs) {
      const ym = cur.toISOString().slice(0, 7);
      if (monthSet.has(ym)) out.add(ym);
      cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1, 12, 0, 0, 0));
    }
  }
  return out;
}

function travelRangesFromBuildInputs(
  buildInputs: unknown
): Array<{ startDate: string; endDate: string }> {
  const b = (buildInputs ?? {}) as Record<string, unknown>;
  const collect = (value: unknown): Array<{ startDate: string; endDate: string }> => {
    if (!Array.isArray(value)) return [];
    return value
      .map((r: any) => ({
        startDate: String(r?.startDate ?? "").slice(0, 10),
        endDate: String(r?.endDate ?? "").slice(0, 10),
      }))
      .filter(
        (r) =>
          /^\d{4}-\d{2}-\d{2}$/.test(r.startDate) &&
          /^\d{4}-\d{2}-\d{2}$/.test(r.endDate)
      );
  };

  const merged = [...collect((b as any).travelRanges)];
  const uniq = new Map<string, { startDate: string; endDate: string }>();
  for (const r of merged) uniq.set(`${r.startDate}__${r.endDate}`, r);
  return Array.from(uniq.values()).sort((a, b) => {
    const left = `${a.startDate}__${a.endDate}`;
    const right = `${b.startDate}__${b.endDate}`;
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

function normalizePreLockboxTravelRanges(
  value: unknown
): Array<{ startDate: string; endDate: string }> {
  if (!Array.isArray(value)) return [];
  const uniq = new Map<string, { startDate: string; endDate: string }>();
  for (const row of value) {
    const startDate = String((row as any)?.startDate ?? "").slice(0, 10);
    const endDate = String((row as any)?.endDate ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) continue;
    uniq.set(`${startDate}__${endDate}`, { startDate, endDate });
  }
  return Array.from(uniq.values());
}

function canonicalMonthsForRecalc(args: { mode: SimulatorMode; manualUsagePayload: ManualUsagePayloadAny | null; now?: Date }) {
  const now = args.now ?? new Date();

  // V1 determinism: derive canonicalMonths from manual anchor when in manual mode, else platform default (last full month Chicago).
  if (args.mode === "MANUAL_TOTALS" && args.manualUsagePayload) {
    const p = args.manualUsagePayload as any;
    if (p?.mode === "MONTHLY") {
      const anchorEndDateKey = typeof p.anchorEndDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.anchorEndDate) ? String(p.anchorEndDate) : null;
      const legacyEndMonth = typeof p.anchorEndMonth === "string" && /^\d{4}-\d{2}$/.test(p.anchorEndMonth) ? String(p.anchorEndMonth) : null;
      const endMonth = anchorEndDateKey
        ? anchorEndDateKey.slice(0, 7)
        : legacyEndMonth
          ? legacyEndMonth
          : null;
      if (endMonth) return { endMonth, months: monthsEndingAt(endMonth, 12) };
    }
    if (p?.mode === "ANNUAL") {
      const endKey =
        typeof p.anchorEndDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.anchorEndDate)
          ? String(p.anchorEndDate)
          : typeof p.endDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.endDate)
            ? String(p.endDate)
            : null;
      if (endKey) {
        const endMonth = endKey.slice(0, 7);
        return { endMonth, months: monthsEndingAt(endMonth, 12) };
      }
    }
  }

  return canonicalWindow12Months(now);
}

function baseKindFromMode(mode: SimulatorMode): BaseKind {
  if (mode === "MANUAL_TOTALS") return "MANUAL";
  if (mode === "NEW_BUILD_ESTIMATE") return "ESTIMATED";
  return "SMT_ACTUAL_BASELINE";
}

function isLeanManualTotalsMode(mode: SimulatorMode): boolean {
  return mode === "MANUAL_TOTALS";
}

function buildLeanManualTotalsResolvedFingerprint(args: {
  houseId: string;
  actualContextHouseId: string;
  manualUsagePayload: unknown;
}): ResolvedSimFingerprint {
  const payload = args.manualUsagePayload as { mode?: unknown } | null;
  const manualTotalsConstraint =
    payload?.mode === "MONTHLY" ? "monthly" : payload?.mode === "ANNUAL" ? "annual" : "none";
  return {
    resolverVersion: "manual_totals_lean_v1",
    resolvedHash: `manual_totals_lean:${args.houseId}:${args.actualContextHouseId}:${manualTotalsConstraint}`,
    blendMode:
      manualTotalsConstraint === "monthly"
        ? "constrained_monthly_totals"
        : manualTotalsConstraint === "annual"
          ? "constrained_annual_total"
          : "insufficient_inputs",
    underlyingSourceMix: "insufficient_inputs",
    manualTotalsConstraint,
    resolutionNotes: [
      "manual_totals_lean_recalc_skips_fingerprint_resolution",
      "manual_totals_readback_loads_richer_diagnostics_from_persisted_artifact",
    ],
    wholeHomeHouseId: args.houseId,
    usageFingerprintHouseId: args.actualContextHouseId,
    wholeHomeFingerprintArtifactId: null,
    usageFingerprintArtifactId: null,
    wholeHomeStatus: null,
    usageStatus: null,
    wholeHomeSourceHash: null,
    usageSourceHash: null,
    usageBlendWeight: 0,
  };
}

export type SimulatorRecalcOk = {
  ok: true;
  houseId: string;
  buildInputsHash: string;
  dataset: any;
  /** Exact canonical artifact hash persisted for this recalc run when available. */
  canonicalArtifactInputHash?: string | null;
  /** Effective shared-chain mode after admin-lab upgrades (e.g. MANUAL_TOTALS for manual constraint treatments). */
  effectiveSimulatorMode?: SimulatorMode;
};

export type SimulatorRecalcErr = {
  ok: false;
  error: string;
  missingItems?: string[];
};

async function recalcSimulatorBuildImpl(args: {
  userId: string;
  houseId: string;
  esiid: string | null;
  /** Optional shared actual-context source house; defaults to houseId. */
  actualContextHouseId?: string;
  mode: SimulatorMode;
  scenarioId?: string | null;
  weatherPreference?: WeatherPreference;
  persistPastSimBaseline?: boolean;
  /**
   * Canonical Gap-Fill validation-only scored days.
   * These keys are simulated in the same shared recalc run and persisted on the same build/artifact family.
   */
  validationOnlyDateKeysLocal?: Set<string> | string[];
  preLockboxTravelRanges?: Array<{ startDate: string; endDate: string }>;
  /** Optional selection mode for auto-picking validation days when explicit keys are not provided. */
  validationDaySelectionMode?: ValidationDaySelectionMode;
  /** Optional count target for auto-picked validation days. */
  validationDayCount?: number;
  /** Correlation id for observability (plan §6); set by wrapper or droplet worker. */
  correlationId?: string;
  now?: Date;
  /** Admin calibration lab only (plan §24): applied after `resolveSimFingerprint`, same shared chain. */
  adminLabTreatmentMode?: import("@/modules/onePathSim/usageSimulator/adminLabTreatment").AdminLabTreatmentMode;
  runContext?: Partial<PastSimRunContext>;
}): Promise<SimulatorRecalcOk | SimulatorRecalcErr> {
  const { userId, houseId, esiid, mode } = args;
  const actualContextHouseId = String(args.actualContextHouseId ?? houseId);
  const scenarioKey = normalizeScenarioKey(args.scenarioId);
  const scenarioId = scenarioKey === "BASELINE" ? null : scenarioKey;
  const isBaselineSyntheticInvariantMode =
    scenarioId == null && (mode === "SMT_BASELINE" || mode === "MANUAL_TOTALS");
  if (isBaselineSyntheticInvariantMode) {
    logSimPipelineEvent("baseline_invariant_violation_synthetic_packaging_attempt", {
      correlationId: args.correlationId,
      userId,
      houseId,
      sourceHouseId: actualContextHouseId !== houseId ? actualContextHouseId : undefined,
      mode,
      scenarioId: null,
      source: "recalcSimulatorBuildImpl",
      memoryRssMb: getMemoryRssMb(),
    });
    return {
      ok: false,
      error: "baseline_passthrough_required",
      missingItems: [
        "Baseline is usage passthrough only. Synthetic packaging is blocked; Past Sim is the first place simulation runs.",
      ],
    };
  }
  const requestedValidationOnlyDateKeysLocal = normalizeValidationOnlyDateKeysLocal(
    args.validationOnlyDateKeysLocal
  );
  const requestedPreLockboxTravelRanges = normalizePreLockboxTravelRanges(args.preLockboxTravelRanges);
  let effectiveValidationSelectionMode =
    normalizeValidationSelectionMode(args.validationDaySelectionMode) ??
    (requestedValidationOnlyDateKeysLocal.size > 0 ? ("manual" as ValidationDaySelectionMode) : null);
  let validationSelectionDiagnostics: ValidationDaySelectionDiagnostics | null = null;
  const runContext = buildPastSimRunContext({
    correlationId: String(args.correlationId ?? ""),
    callerLabel: args.runContext?.callerLabel ?? "user_recalc",
    buildPathKind: args.runContext?.buildPathKind ?? "recalc",
    persistRequested: args.runContext?.persistRequested ?? (args.persistPastSimBaseline === true),
    adminLabTreatmentMode: args.runContext?.adminLabTreatmentMode ?? args.adminLabTreatmentMode ?? undefined,
    asyncMetadata: args.runContext?.asyncMetadata ?? undefined,
  });
  const initialLockboxInput = buildInitialPastSimLockboxInput({
    houseId,
    actualContextHouseId,
    sourceEsiid: esiid ?? null,
    simulatorMode: mode,
    travelRanges: [],
    validationOnlyDateKeysLocal: requestedValidationOnlyDateKeysLocal,
    validationSelectionMode: effectiveValidationSelectionMode,
    adminLabTreatmentMode: args.adminLabTreatmentMode ?? null,
    weatherPreference: args.weatherPreference ?? null,
    weatherLogicMode: resolveWeatherLogicModeFromBuildInputs({
      weatherPreference: args.weatherPreference ?? "LAST_YEAR_WEATHER",
    }),
  });

  const coreContextStartedAt = Date.now();
  emitRecalcPreIntervalStageEvent({
    event: "recalc_pre_interval_core_context_start",
    correlationId: args.correlationId,
    houseId,
    actualContextHouseId,
    scenarioId,
    mode,
  });

  // Manual totals runs under a very small Prisma pool in admin environments, so avoid
  // fan-out here and keep the shared recalc lean before the persisted readback loads richer diagnostics.
  const manualRec = await (prisma as any).manualUsageInput
    .findUnique({ where: { userId_houseId: { userId, houseId } }, select: { payload: true } })
    .catch(() => null);
  const homeRec = await getHomeProfileSimulatedByUserHouse({ userId, houseId });
  const applianceRec = await getApplianceProfileSimulatedByUserHouse({ userId, houseId });

  let manualUsagePayload = (manualRec?.payload as any) ?? null;
  const canonical = canonicalMonthsForRecalc({ mode, manualUsagePayload, now: args.now });

  const applianceProfile = normalizeStoredApplianceProfile((applianceRec?.appliancesJson as any) ?? null);
  const homeProfile = homeRec ? { ...homeRec } : null;

  const actualOk = mode === "SMT_BASELINE"
    ? await hasActualIntervals({
        houseId: actualContextHouseId,
        esiid: esiid ?? null,
        canonicalMonths: canonical.months,
      })
    : false;
  let actualSourceAnchor = {
    source: null as "SMT" | "GREEN_BUTTON" | null,
    anchorEndDate: null as string | null,
    smtAnchorEndDate: null as string | null,
    greenButtonAnchorEndDate: null as string | null,
  };
  if (!isLeanManualTotalsMode(mode)) {
    const resolvedActualSourceAnchor = await resolveActualUsageSourceAnchor({
      houseId: actualContextHouseId,
      esiid: esiid ?? null,
      timezone: "America/Chicago",
    });
    actualSourceAnchor = {
      source: resolvedActualSourceAnchor.source,
      anchorEndDate: resolvedActualSourceAnchor.anchorEndDate,
      smtAnchorEndDate: resolvedActualSourceAnchor.smtAnchorEndDate,
      greenButtonAnchorEndDate: resolvedActualSourceAnchor.greenButtonAnchorEndDate,
    };
  }
  let actualSource = actualSourceAnchor.source;

  // Baseline ladder enforcement (V1): SMT_BASELINE requires actual 15-minute intervals (SMT or Green Button).
  if (mode === "SMT_BASELINE" && !actualOk) {
    return {
      ok: false,
      error: "requirements_unmet",
      missingItems: ["Actual 15-minute interval data required (Smart Meter Texas or Green Button upload)."],
    };
  }

  // Scenario must exist (and be house-scoped) when scenarioId is provided.
  let scenario: { id: string; name: string } | null = null;
  let scenarioEvents: Array<{ id: string; effectiveMonth: string; kind: string; payloadJson: any }> = [];
  if (scenarioId) {
    scenario = await (prisma as any).usageSimulatorScenario
      .findFirst({
        where: { id: scenarioId, userId, houseId, archivedAt: null },
        select: { id: true, name: true },
      })
      .catch(() => null);
    if (!scenario) return { ok: false, error: "scenario_not_found" };

    scenarioEvents = await (prisma as any).usageSimulatorScenarioEvent
      .findMany({
        where: { scenarioId: scenarioId },
        select: { id: true, effectiveMonth: true, kind: true, payloadJson: true },
        orderBy: [{ effectiveMonth: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      })
      .catch(() => []);
  }

  const scenarioTravelRanges =
    requestedPreLockboxTravelRanges.length > 0
      ? requestedPreLockboxTravelRanges
      : scenarioId
        ? normalizeScenarioTravelRanges(scenarioEvents as any)
        : [];

  const isFutureScenario = Boolean(scenarioId) && scenario?.name === WORKSPACE_FUTURE_NAME;
  let pastTravelRanges: Array<{ startDate: string; endDate: string }> = [];
  let pastScenario: { id: string; name: string } | null = null;
  let pastEventsForOverlay: Array<{ id: string; effectiveMonth: string; kind: string; payloadJson: any }> = [];
  let pastOverlay: ReturnType<typeof computeMonthlyOverlay> | null = null;

  if (isFutureScenario) {
    pastScenario = await (prisma as any).usageSimulatorScenario
      .findFirst({
        where: { userId, houseId, name: WORKSPACE_PAST_NAME, archivedAt: null },
        select: { id: true, name: true },
      })
      .catch(() => null);
    if (pastScenario?.id) {
      pastEventsForOverlay = await (prisma as any).usageSimulatorScenarioEvent
        .findMany({
          where: { scenarioId: pastScenario.id },
          select: { id: true, effectiveMonth: true, kind: true, payloadJson: true },
          orderBy: [{ effectiveMonth: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        })
        .catch(() => []);
      pastTravelRanges =
        requestedPreLockboxTravelRanges.length > 0
          ? []
          : normalizeScenarioTravelRanges(pastEventsForOverlay as any);
    }
  }

  const adminLabManualConstraint =
    Boolean(args.adminLabTreatmentMode) && isAdminLabManualConstraintTreatmentMode(args.adminLabTreatmentMode);

  // NEW_BUILD_ESTIMATE completeness enforcement uses existing validators via requirements.
  const req = computeRequirements(
    {
      manualUsagePayload: manualUsagePayload as any,
      homeProfile: homeProfile as any,
      applianceProfile: applianceProfile as any,
      hasActualIntervals: actualOk,
    },
    mode,
  );
  if (!req.canRecalc && !adminLabManualConstraint) {
    return { ok: false, error: "requirements_unmet", missingItems: req.missingItems };
  }

  if (!homeProfile) return { ok: false, error: "homeProfile_required" };
  if (!applianceProfile?.fuelConfiguration) return { ok: false, error: "applianceProfile_required" };

  let weatherSensitivityScore: import("@/modules/onePathSim/weatherSensitivityShared").WeatherSensitivityScore | null = null;
  let weatherEfficiencyDerivedInput: import("@/modules/onePathSim/weatherSensitivityShared").WeatherEfficiencyDerivedInput | null = null;
  const simulationVariableInputType: SimulationVariableInputType =
    mode === "NEW_BUILD_ESTIMATE"
      ? "NEW_BUILD"
      : mode === "MANUAL_TOTALS" && String((manualUsagePayload as any)?.mode ?? "").trim().toUpperCase() === "ANNUAL"
        ? "MANUAL_ANNUAL"
        : mode === "MANUAL_TOTALS"
          ? "MANUAL_MONTHLY"
          : "INTERVAL";
  const simulationVariableOverrides = await getSimulationVariableOverrides();
  const simulationVariableResolution = resolveSimulationVariablePolicyForInputType(
    simulationVariableInputType,
    simulationVariableOverrides
  );
  const simulationVariablePolicy = simulationVariableResolution.effective;
  try {
    const shouldLoadWeatherSensitivityActualDataset =
      typeof actualContextHouseId === "string" && actualContextHouseId.trim().length > 0;
    const weatherSensitivityActualDataset = shouldLoadWeatherSensitivityActualDataset
      ? (await getActualUsageDatasetForHouse(actualContextHouseId, esiid ?? null, { skipFullYearIntervalFetch: true }))?.dataset ?? null
      : null;
    const weatherSensitivityEnvelope = await resolveSharedWeatherSensitivityEnvelope({
      actualDataset: weatherSensitivityActualDataset,
      manualUsagePayload: manualUsagePayload as any,
      homeProfile,
      applianceProfile,
      weatherHouseId: actualContextHouseId,
      simulationVariablePolicy,
    });
    weatherSensitivityScore = weatherSensitivityEnvelope.score;
    weatherEfficiencyDerivedInput = weatherSensitivityEnvelope.derivedInput
      ? {
          ...weatherSensitivityEnvelope.derivedInput,
          simulationActive: true,
        }
      : null;
  } catch (error) {
    console.warn("[usageSimulator] weather sensitivity pre-sim derivation failed", error);
  }

  // When recalc'ing a scenario (Past/Future), use the baseline build's canonical window so scenario and Usage tab stay aligned (e.g. both Mar 2025–Feb 2026).
  let canonicalForBuild = canonical;
  let baselineInputsForRecalc: any = null;
  if (scenarioId) {
    const baselineBuild = await (prisma as any).usageSimulatorBuild
      .findUnique({
        where: { userId_houseId_scenarioKey: { userId, houseId, scenarioKey: "BASELINE" } },
        select: { buildInputs: true },
      })
      .catch(() => null);
    const baselineInputs = baselineBuild?.buildInputs as any;
    baselineInputsForRecalc = baselineInputs;
    if (
      Array.isArray(baselineInputs?.canonicalMonths) &&
      baselineInputs.canonicalMonths.length > 0 &&
      typeof baselineInputs.canonicalEndMonth === "string"
    ) {
      canonicalForBuild = {
        endMonth: baselineInputs.canonicalEndMonth,
        months: baselineInputs.canonicalMonths,
      };
    }
  }

  const travelRangesForBuild = scenarioId ? [...pastTravelRanges, ...scenarioTravelRanges] : undefined;
  emitRecalcPreIntervalStageEvent({
    event: "recalc_pre_interval_core_context_success",
    correlationId: args.correlationId,
    houseId,
    actualContextHouseId,
    scenarioId,
    mode,
    durationMs: Date.now() - coreContextStartedAt,
  });

  let simMode: SimulatorMode = mode;
  let manualMonthlySourceDerivedResolution: SourceDerivedMonthlyTargetResolution | null = null;
  if (adminLabManualConstraint) {
    const adminAdaptationStartedAt = Date.now();
    emitRecalcPreIntervalStageEvent({
      event: "recalc_pre_interval_admin_treatment_adaptation_start",
      correlationId: args.correlationId,
      houseId,
      actualContextHouseId,
      scenarioId,
      mode,
    });
    try {
      const sourceOwner =
        actualContextHouseId && actualContextHouseId !== houseId
          ? await (prisma as any).houseAddress
              .findUnique({
                where: { id: actualContextHouseId },
                select: { userId: true },
              })
              .catch(() => null)
          : { userId };
      const sourceManualRec =
        sourceOwner?.userId && actualContextHouseId
          ? await (prisma as any).manualUsageInput
              .findUnique({
                where: {
                  userId_houseId: {
                    userId: String(sourceOwner.userId),
                    houseId: actualContextHouseId,
                  },
                },
                select: { payload: true },
              })
              .catch(() => null)
          : null;
      const sourceUsageDataset = await getActualUsageDatasetForHouse(actualContextHouseId, esiid ?? null, {
        skipFullYearIntervalFetch: true,
      }).catch(() => ({ dataset: null }));
      if (!actualSource) {
        const sourceFromDataset = String(sourceUsageDataset?.dataset?.summary?.source ?? "").trim().toUpperCase();
        actualSource =
          sourceFromDataset === "SMT" || sourceFromDataset === "GREEN_BUTTON"
            ? (sourceFromDataset as "SMT" | "GREEN_BUTTON")
            : actualSource;
      }
      const desiredManualStageOneMode =
        args.adminLabTreatmentMode === "manual_annual_constrained" ? "ANNUAL" : "MONTHLY";
      const seedSet = buildManualUsageStageOneResolvedSeeds({
        sourcePayload: (sourceManualRec?.payload as any) ?? null,
        actualEndDate:
          String(
            sourceUsageDataset?.dataset?.summary?.end ??
              actualSourceAnchor.anchorEndDate ??
              ""
          ).slice(0, 10) || null,
        travelRanges: travelRangesForBuild ?? [],
        dailyRows: sourceUsageDataset?.dataset?.daily ?? [],
      });
      const resolvedManualStageOne = resolveManualUsageStageOnePayloadForMode({
        mode: desiredManualStageOneMode,
        testHomePayload: manualUsagePayload,
        seedSet,
      });
      manualUsagePayload = resolvedManualStageOne.payload;
      manualMonthlySourceDerivedResolution =
        desiredManualStageOneMode === "MONTHLY" && resolvedManualStageOne.payload?.mode === "MONTHLY"
          ? buildSourceDerivedMonthlyTargetResolutionFromPayload({
              canonicalMonths: canonicalForBuild.months,
              payload: resolvedManualStageOne.payload,
            })
          : null;
    } catch (e) {
      emitRecalcPreIntervalStageEvent({
        event: "recalc_pre_interval_admin_treatment_adaptation_failure",
        correlationId: args.correlationId,
        houseId,
        actualContextHouseId,
        scenarioId,
        mode,
        durationMs: Date.now() - adminAdaptationStartedAt,
        failureCode: "admin_manual_payload_build_failed",
        failureMessage: e instanceof Error ? e.message : String(e),
      });
      return {
        ok: false,
        error: "requirements_unmet",
        missingItems: [
          `Admin lab could not derive manual totals from actual-context usage: ${e instanceof Error ? e.message : String(e)}`,
        ],
      };
    }
    simMode = "MANUAL_TOTALS";
    if (!manualUsagePayload) {
      emitRecalcPreIntervalStageEvent({
        event: "recalc_pre_interval_admin_treatment_adaptation_failure",
        correlationId: args.correlationId,
        houseId,
        actualContextHouseId,
        scenarioId,
        mode,
        durationMs: Date.now() - adminAdaptationStartedAt,
        failureCode: "requirements_unmet",
        failureMessage: "admin_lab_manual_constraints_requirements_unmet",
      });
      return {
        ok: false,
        error: "requirements_unmet",
        missingItems: ["Admin lab manual constraint builder did not produce a valid manual usage payload."],
      };
    }
    emitRecalcPreIntervalStageEvent({
      event: "recalc_pre_interval_admin_treatment_adaptation_success",
      correlationId: args.correlationId,
      houseId,
      actualContextHouseId,
      scenarioId,
      mode: simMode,
      durationMs: Date.now() - adminAdaptationStartedAt,
    });
  }

  const manualTravelVacantDonorPoolMode =
    simMode !== "MANUAL_TOTALS"
      ? null
      : String((manualUsagePayload as { mode?: unknown } | null | undefined)?.mode ?? "").trim() !== "MONTHLY"
        ? null
        : args.adminLabTreatmentMode === "manual_monthly_constrained"
          ? ("source_derived_mode_unchanged" as const)
          : ("same_run_simulated_non_travel_days" as const);

  // Enforce simMode->baseKind mapping (no mismatches). `simMode` may upgrade to MANUAL_TOTALS for admin lab manual treatments.
  const baseKind = baseKindFromMode(simMode);

  const buildInputsStartedAt = Date.now();
  emitRecalcPreIntervalStageEvent({
    event: "recalc_pre_interval_build_inputs_start",
    correlationId: args.correlationId,
    houseId,
    actualContextHouseId,
    scenarioId,
    mode: simMode,
  });
  let built: Awaited<ReturnType<typeof buildSimulatorInputs>>;
  try {
    built = await buildSimulatorInputs({
      mode: simMode as BuildMode,
      manualUsagePayload: manualUsagePayload as any,
      manualMonthlySourceDerivedResolution,
      homeProfile: homeProfile as any,
      applianceProfile: applianceProfile as any,
      esiidForSmt: esiid,
      houseIdForActual: actualContextHouseId,
      baselineHomeProfile: homeProfile,
      baselineApplianceProfile: applianceProfile,
      canonicalMonths: canonicalForBuild.months,
      travelRanges: travelRangesForBuild,
      now: args.now,
    });
  } catch (e) {
    emitRecalcPreIntervalStageEvent({
      event: "recalc_pre_interval_build_inputs_failure",
      correlationId: args.correlationId,
      houseId,
      actualContextHouseId,
      scenarioId,
      mode: simMode,
      durationMs: Date.now() - buildInputsStartedAt,
      failureCode: "build_simulator_inputs_failed",
      failureMessage: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
  emitRecalcPreIntervalStageEvent({
    event: "recalc_pre_interval_build_inputs_success",
    correlationId: args.correlationId,
    houseId,
    actualContextHouseId,
    scenarioId,
    mode: simMode,
    durationMs: Date.now() - buildInputsStartedAt,
  });

  // Safety: built.baseKind must match mode mapping in V1
  if (built.baseKind !== baseKind) {
    return { ok: false, error: "baseKind_mismatch" };
  }

  const monthlyPreparationStartedAt = Date.now();
  emitRecalcPreIntervalStageEvent({
    event: "recalc_pre_interval_monthly_preparation_start",
    correlationId: args.correlationId,
    houseId,
    actualContextHouseId,
    scenarioId,
    mode: simMode,
  });

  // Overlay: source of truth = UpgradeLedger (status ACTIVE); timeline order = scenario events. V1 = delta kWh only (additive).
  let overlay: ReturnType<typeof computeMonthlyOverlay> | null = null;
  if (scenarioId) {
    let ledgerRows: Awaited<ReturnType<typeof listLedgerRows>> = [];
    try {
      ledgerRows = await listLedgerRows(userId, { scenarioId, status: "ACTIVE" });
    } catch (_) {
      // Upgrades DB optional; fall back to event-based overlay
    }
    const entries = buildOrderedLedgerEntriesForOverlay(
      scenarioEvents.map((e) => ({
        id: e.id,
        effectiveMonth: e.effectiveMonth,
        payloadJson: e.payloadJson,
      })),
      ledgerRows
    );
    if (entries.length > 0 && scenario?.name === WORKSPACE_PAST_NAME) {
      overlay = computePastOverlay({
        canonicalMonths: built.canonicalMonths,
        entries,
        baselineMonthlyKwhByMonth: built.monthlyTotalsKwhByMonth,
      });
    } else if (entries.length > 0 && scenario?.name === WORKSPACE_FUTURE_NAME) {
      overlay = computeFutureOverlay({
        canonicalMonths: built.canonicalMonths,
        entries,
        baselineMonthlyKwhByMonth: built.monthlyTotalsKwhByMonth,
      });
    }
    // Fallback: event-based overlay only when no ledger entries. computeMonthlyOverlay applies MONTHLY_ADJUSTMENT only; UPGRADE_ACTION is excluded there, so no split-brain (upgrades never apply month-only here).
    if (overlay == null) {
      overlay = computeMonthlyOverlay({
        canonicalMonths: built.canonicalMonths,
        events: scenarioEvents as any,
      });
    }
  }

  // Past overlay for Future baseline: same rule (ledger ACTIVE, event order); Past = full-year or range (Option 1).
  if (isFutureScenario && pastScenario?.id) {
    let pastLedgerRows: Awaited<ReturnType<typeof listLedgerRows>> = [];
    try {
      pastLedgerRows = await listLedgerRows(userId, { scenarioId: pastScenario.id, status: "ACTIVE" });
    } catch (_) {}
    const pastEntries = buildOrderedLedgerEntriesForOverlay(
      pastEventsForOverlay.map((e) => ({ id: e.id, effectiveMonth: e.effectiveMonth, payloadJson: e.payloadJson })),
      pastLedgerRows
    );
    if (pastEntries.length > 0) {
      pastOverlay = computePastOverlay({
        canonicalMonths: built.canonicalMonths,
        entries: pastEntries,
        baselineMonthlyKwhByMonth: built.monthlyTotalsKwhByMonth,
      });
    } else if (pastEventsForOverlay.some((e) => String(e?.kind ?? "") === "MONTHLY_ADJUSTMENT" || String(e?.kind ?? "") === "TRAVEL_RANGE")) {
      pastOverlay = computeMonthlyOverlay({ canonicalMonths: built.canonicalMonths, events: pastEventsForOverlay as any });
    }
  }

  // Past curve = baseline + any Past adjustments. If Past is never touched, Past curve = baseline. Future always uses the final Past curve as its baseline, then applies Future changes.
  let pastCurveByMonth: Record<string, number> | null = null;
  if (isFutureScenario && pastScenario?.id) {
    const pastBuild = await (prisma as any).usageSimulatorBuild
      .findUnique({
        where: { userId_houseId_scenarioKey: { userId, houseId, scenarioKey: pastScenario.id } },
        select: { buildInputs: true },
      })
      .catch(() => null);
    const pastInputs = pastBuild?.buildInputs as any;
    if (pastInputs?.monthlyTotalsKwhByMonth && typeof pastInputs.monthlyTotalsKwhByMonth === "object") {
      pastCurveByMonth = pastInputs.monthlyTotalsKwhByMonth;
    }
  }

  // Future = Past curve + Future overlay. Always prefer stored Past curve when available (that is baseline + Past adjustments as saved); else baseline + pastOverlay; else baseline.
  let monthlyTotalsKwhByMonth: Record<string, number> = {};
  for (let i = 0; i < built.canonicalMonths.length; i++) {
    const ym = built.canonicalMonths[i];
    const base = Number(built.monthlyTotalsKwhByMonth?.[ym] ?? 0) || 0;
    const storedPastKwh =
      pastCurveByMonth != null && Object.prototype.hasOwnProperty.call(pastCurveByMonth, ym)
        ? Number(pastCurveByMonth[ym])
        : undefined;
    const pastCurve: number =
      Number.isFinite(storedPastKwh)
        ? Math.max(0, storedPastKwh ?? 0)
        : pastOverlay
          ? applyMonthlyOverlay({ base, mult: pastOverlay.monthlyMultipliersByMonth?.[ym], add: pastOverlay.monthlyAddersKwhByMonth?.[ym] })
          : Math.max(0, base);
    const curveForMonth: number = Number.isFinite(pastCurve) ? pastCurve : Math.max(0, base);
    const curveNum = typeof curveForMonth === "number" && Number.isFinite(curveForMonth) ? curveForMonth : 0;
    monthlyTotalsKwhByMonth[ym] = overlay ? applyMonthlyOverlay({ base: curveNum, mult: overlay.monthlyMultipliersByMonth?.[ym], add: overlay.monthlyAddersKwhByMonth?.[ym] }) : curveForMonth;
  }

  const scenarioMergedTravelRanges = scenarioId ? [...pastTravelRanges, ...scenarioTravelRanges] : [];
  const preserveCanonicalTravelTruthForManualMonthly =
    simMode === "MANUAL_TOTALS" && manualMonthlySourceDerivedResolution != null;
  const manualPayloadTravelRanges =
    simMode === "MANUAL_TOTALS"
      ? normalizePreLockboxTravelRanges((manualUsagePayload as any)?.travelRanges)
      : [];
  const manualPayloadTravelIsAuthoritative =
    simMode === "MANUAL_TOTALS" && manualUsagePayload != null;
  const allTravelRanges =
    simMode === "MANUAL_TOTALS"
      ? manualPayloadTravelIsAuthoritative
        ? manualPayloadTravelRanges
        : scenarioMergedTravelRanges
      : simMode === "NEW_BUILD_ESTIMATE"
        ? []
        : scenarioMergedTravelRanges;
  // Month-level uplift for travel exclusions: when travel days exclude usage, uplift remaining days to fill the month.
  // Past SMT patch baseline mode uses day-level patching and must not use month-level travel uplift.
  const isPastSmtPatchMode = scenario?.name === WORKSPACE_PAST_NAME && simMode === "SMT_BASELINE";
  const hasManualBillPeriodConstraints = (built.manualBillPeriods?.length ?? 0) > 0;
  if (
    allTravelRanges.length > 0 &&
    !isPastSmtPatchMode &&
    !preserveCanonicalTravelTruthForManualMonthly &&
    !(simMode === "MANUAL_TOTALS" && hasManualBillPeriodConstraints)
  ) {
    const excludeSet = new Set(travelRangesToExcludeDateKeys(allTravelRanges));
    for (const ym of built.canonicalMonths) {
      const [y, m] = ym.split("-").map(Number);
      if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) continue;
      const daysInMonth = new Date(y, m, 0).getDate();
      let travelDays = 0;
      for (let d = 1; d <= daysInMonth; d++) {
        const key = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        if (excludeSet.has(key)) travelDays++;
      }
      const nonTravelDays = daysInMonth - travelDays;
      if (travelDays > 0 && nonTravelDays <= 0) {
        return { ok: false, error: "travel_exclusions_cover_full_range" };
      }
      const baseMonthKwh = monthlyTotalsKwhByMonth[ym] ?? 0;
      if (baseMonthKwh > 0 && nonTravelDays > 0) {
        const factor = daysInMonth / nonTravelDays;
        monthlyTotalsKwhByMonth[ym] = baseMonthKwh * factor;
      }
    }
  }

  const notes = [...(built.notes ?? [])];
  if (adminLabManualConstraint) {
    notes.push(
      "Admin lab: MANUAL_TOTALS constraints derived from actual-context usage via shared fetchActualCanonicalMonthlyTotals (travel exclusions honored)."
    );
  }
  if (scenarioId) {
    notes.push(`Scenario applied: ${scenario?.name ?? scenarioId}`);
    if ((overlay?.inactiveEventIds?.length ?? 0) > 0) notes.push(`Scenario: ${overlay!.inactiveEventIds.length} inactive event(s).`);
    if ((overlay?.warnings?.length ?? 0) > 0) notes.push(`Scenario: ${overlay!.warnings.length} warning(s).`);
  }
  if (isFutureScenario) {
    if (pastCurveByMonth != null || pastOverlay) {
      notes.push(`Future base: ${WORKSPACE_PAST_NAME} (Past curve = baseline + Past adjustments)`);
      if (pastOverlay) {
        if ((pastOverlay.inactiveEventIds?.length ?? 0) > 0) notes.push(`Past: ${pastOverlay.inactiveEventIds.length} inactive event(s).`);
        if ((pastOverlay.warnings?.length ?? 0) > 0) notes.push(`Past: ${pastOverlay.warnings.length} warning(s).`);
      }
    } else {
      notes.push("Future base: Past curve (= baseline; no Past adjustments)");
    }
  }

  const weatherPreference: WeatherPreference = args.weatherPreference ?? "NONE";
  const weatherNorm = normalizeMonthlyTotals({
    canonicalMonths: built.canonicalMonths,
    monthlyTotalsKwhByMonth,
    preference: weatherPreference,
  });
  monthlyTotalsKwhByMonth = weatherNorm.monthlyTotalsKwhByMonth;
  for (const n of weatherNorm.notes) notes.push(n);

  const versions = {
    estimatorVersion: "v1",
    reshapeCoeffVersion: "v1",
    intradayTemplateVersion: INTRADAY_TEMPLATE_VERSION,
    smtShapeDerivationVersion: SMT_SHAPE_DERIVATION_VERSION,
    weatherNormalizerVersion: WEATHER_NORMALIZER_VERSION,
  };
  emitRecalcPreIntervalStageEvent({
    event: "recalc_pre_interval_monthly_preparation_success",
    correlationId: args.correlationId,
    houseId,
    actualContextHouseId,
    scenarioId,
    mode: simMode,
    durationMs: Date.now() - monthlyPreparationStartedAt,
  });

  const validationSetupStartedAt = Date.now();
  emitRecalcPreIntervalStageEvent({
    event: "recalc_pre_interval_validation_setup_start",
    correlationId: args.correlationId,
    houseId,
    actualContextHouseId,
    scenarioId,
    mode: simMode,
  });
  const manualCanonicalPeriods =
    simMode === "MANUAL_TOTALS" && manualUsagePayload
      ? (() => {
          const manualBillPeriods = built.manualBillPeriods ?? [];
          if (manualBillPeriods.length > 0) {
            return manualBillPeriods
              .filter((period) => period.eligibleForConstraint)
              .map((period) => ({
                id: period.id,
                startDate: period.startDate,
                endDate: period.endDate,
              }));
          }
          const p = manualUsagePayload as any;
          const endKey =
            typeof p.anchorEndDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.anchorEndDate)
              ? String(p.anchorEndDate)
              : typeof p.endDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.endDate)
                ? String(p.endDate)
                : resolveManualMonthlyAnchorEndDateKey(p);
          return endKey ? billingPeriodsEndingAt(endKey, 12) : [];
        })()
      : [];

  // SMT_BASELINE: use actual data's date range (anchor) so Baseline, Past, and Future all show the same dates (e.g. 02/18/2025 – 02/18/2026).
  let smtAnchorPeriods: Array<{ id: string; startDate: string; endDate: string }> | undefined;
  let validationSetupFailed = false;
  if (simMode === "SMT_BASELINE") {
    try {
      const actualResult = await getActualUsageDatasetForHouse(actualContextHouseId, esiid ?? null);
      const start = actualResult?.dataset?.summary?.start ? String(actualResult.dataset.summary.start).slice(0, 10) : null;
      const end = actualResult?.dataset?.summary?.end ? String(actualResult.dataset.summary.end).slice(0, 10) : null;
      if (start && end && /^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end)) {
        smtAnchorPeriods = [{ id: "anchor", startDate: start, endDate: end }];
      }
    } catch (e) {
      smtAnchorPeriods = undefined;
      validationSetupFailed = true;
      emitRecalcPreIntervalStageEvent({
        event: "recalc_pre_interval_validation_setup_failure",
        correlationId: args.correlationId,
        houseId,
        actualContextHouseId,
        scenarioId,
        mode: simMode,
        durationMs: Date.now() - validationSetupStartedAt,
        failureCode: "smt_anchor_load_failed",
        failureMessage: e instanceof Error ? e.message : String(e),
      });
    }
  }
  if (shouldEmitRecalcValidationSetupSuccess({ mode: simMode, validationSetupFailed })) {
    emitRecalcPreIntervalStageEvent({
      event: "recalc_pre_interval_validation_setup_success",
      correlationId: args.correlationId,
      houseId,
      actualContextHouseId,
      scenarioId,
      mode: simMode,
      durationMs: Date.now() - validationSetupStartedAt,
    });
  }

  // Past with actual source: patch baseline by simulating only excluded + leading-missing days.
  /** Timezone for Past sim and stored build; set when building Past so getPastSimulatedDatasetForHouse and cache use same. */
  let timezoneForStoredBuild = (baselineInputsForRecalc as any)?.timezone ?? "America/Chicago";
  const pastSharedSimChainModes: SimulatorBuildInputsV1["mode"][] = ["SMT_BASELINE", "MANUAL_TOTALS", "NEW_BUILD_ESTIMATE"];
  const shouldUseSharedPastProducer = scenario?.name === WORKSPACE_PAST_NAME && pastSharedSimChainModes.includes(simMode);
  const recalcIntervalPreload =
    simMode === "SMT_BASELINE" && scenario?.name === WORKSPACE_PAST_NAME
      ? createRecalcIntervalPreloadContext({
          houseId: actualContextHouseId,
          esiid: esiid ?? null,
          correlationId: args.correlationId,
          source: "recalcSimulatorBuildImpl",
        })
      : null;
  const sharedPastRecalcWindow =
    shouldUseSharedPastProducer
      ? resolveSharedPastRecalcWindow({
          mode: simMode,
          canonicalMonths: built.canonicalMonths,
          smtAnchorPeriods: simMode === "SMT_BASELINE" ? smtAnchorPeriods : undefined,
        })
      : null;
  if (recalcIntervalPreload && sharedPastRecalcWindow) {
    logSimPipelineEvent("recalc_shared_interval_window_selected", {
      correlationId: args.correlationId,
      houseId,
      sourceHouseId: actualContextHouseId !== houseId ? actualContextHouseId : undefined,
      preloadWindowStart: sharedPastRecalcWindow.startDate,
      preloadWindowEnd: sharedPastRecalcWindow.endDate,
      preloadWindowSource: sharedPastRecalcWindow.source,
      source: "recalcSimulatorBuildImpl",
      memoryRssMb: getMemoryRssMb(),
    });
  }
  let validationSelectionUsedSharedPreloadWindow = false;
  let validationSelectionPreloadWindowStart: string | null = null;
  let validationSelectionPreloadWindowEnd: string | null = null;
  let effectiveValidationOnlyDateKeysLocal = new Set<string>(requestedValidationOnlyDateKeysLocal);
  if (
    effectiveValidationOnlyDateKeysLocal.size === 0 &&
    simMode === "SMT_BASELINE" &&
    scenario?.name === WORKSPACE_PAST_NAME
  ) {
    const autoMode =
      effectiveValidationSelectionMode ?? (await getUserDefaultValidationSelectionMode());
    const selectionStart = sharedPastRecalcWindow?.startDate ?? resolveCanonicalUsage365CoverageWindow().startDate;
    const selectionEnd = sharedPastRecalcWindow?.endDate ?? resolveCanonicalUsage365CoverageWindow().endDate;
    const targetCount = Math.max(1, Math.min(365, Math.floor(Number(args.validationDayCount) || 21)));
    const travelDateKeysLocal = new Set<string>(
      (allTravelRanges ?? []).flatMap((r) => localDateKeysInRange(r.startDate, r.endDate, timezoneForStoredBuild))
    );
    try {
      const validationSelectionStartedAt = Date.now();
      const coverageSelection = await getCandidateDateCoverageForSelection({
        houseId: actualContextHouseId,
        scenarioIdentity: `past_shared:${scenarioId ?? "BASELINE"}`,
        windowStart: selectionStart,
        windowEnd: selectionEnd,
        timezone: timezoneForStoredBuild,
        minDayCoveragePct: 0.95,
        stratifyByMonth: true,
        stratifyByWeekend: true,
        loadIntervalsForWindow: async () => {
          if (recalcIntervalPreload) {
            const preloaded = await recalcIntervalPreload.getIntervals({
              startDate: selectionStart,
              endDate: selectionEnd,
            });
            return preloaded.intervals;
          }
          return await getActualIntervalsForRange({
            houseId: actualContextHouseId,
            esiid: esiid ?? null,
            startDate: selectionStart,
            endDate: selectionEnd,
          });
        },
      });
      const selection = selectValidationDayKeys({
        mode: autoMode,
        targetCount,
        candidateDateKeys: coverageSelection.candidateDateKeys,
        travelDateKeysSet: travelDateKeysLocal,
        timezone: timezoneForStoredBuild,
        seed: `${actualContextHouseId}-${selectionEnd}`,
      });
      effectiveValidationOnlyDateKeysLocal = new Set(selection.selectedDateKeys);
      validationSelectionDiagnostics = selection.diagnostics;
      effectiveValidationSelectionMode = autoMode;
      validationSelectionUsedSharedPreloadWindow = Boolean(sharedPastRecalcWindow);
      validationSelectionPreloadWindowStart = selectionStart;
      validationSelectionPreloadWindowEnd = selectionEnd;
      const preloadStats = recalcIntervalPreload?.getStats();
      logSimPipelineEvent("recalc_validation_selection_with_shared_intervals", {
        correlationId: args.correlationId,
        houseId,
        sourceHouseId: actualContextHouseId !== houseId ? actualContextHouseId : undefined,
        preloadWindowStart: selectionStart,
        preloadWindowEnd: selectionEnd,
        preloadWindowSource: sharedPastRecalcWindow?.source ?? "canonical_coverage_fallback",
        validationSelectionUsesSharedPreloadWindow: Boolean(sharedPastRecalcWindow),
        durationMs: Date.now() - validationSelectionStartedAt,
        preloadFetchCount: preloadStats?.fetchCount,
        preloadReuseCount: preloadStats?.reuseCount,
        preloadCachedWindowCount: preloadStats?.cachedWindowCount,
        memoryRssMb: getMemoryRssMb(),
        source: "recalcSimulatorBuildImpl",
      });
    } catch {
      effectiveValidationOnlyDateKeysLocal = new Set<string>();
      validationSelectionDiagnostics = null;
      effectiveValidationSelectionMode = autoMode;
    }
  }
  if (!effectiveValidationSelectionMode && effectiveValidationOnlyDateKeysLocal.size > 0) {
    effectiveValidationSelectionMode = "manual";
  }
  if (
    shouldWarmValidationSelectionPreload({
      mode: simMode,
      scenarioName: scenario?.name,
      hasPreloadContext: Boolean(recalcIntervalPreload),
      hasValidationDateKeys: effectiveValidationOnlyDateKeysLocal.size > 0,
      alreadyUsedSelectionPreload: validationSelectionUsedSharedPreloadWindow,
    })
  ) {
    const warmupWindowStart = sharedPastRecalcWindow?.startDate ?? resolveCanonicalUsage365CoverageWindow().startDate;
    const warmupWindowEnd = sharedPastRecalcWindow?.endDate ?? resolveCanonicalUsage365CoverageWindow().endDate;
    const warmupStartedAt = Date.now();
    const preloaded = await recalcIntervalPreload!.getIntervals({
      startDate: warmupWindowStart,
      endDate: warmupWindowEnd,
    });
    validationSelectionUsedSharedPreloadWindow = true;
    validationSelectionPreloadWindowStart = warmupWindowStart;
    validationSelectionPreloadWindowEnd = warmupWindowEnd;
    const preloadStats = recalcIntervalPreload!.getStats();
    logSimPipelineEvent("recalc_validation_selection_preload_warmup", {
      correlationId: args.correlationId,
      houseId,
      sourceHouseId: actualContextHouseId !== houseId ? actualContextHouseId : undefined,
      preloadWindowStart: warmupWindowStart,
      preloadWindowEnd: warmupWindowEnd,
      preloadWindowSource: sharedPastRecalcWindow?.source ?? "canonical_coverage_fallback",
      reason: "provided_validation_keys",
      cacheHit: preloaded.cacheHit,
      intervalRowCount: preloaded.intervals.length,
      preloadFetchCount: preloadStats.fetchCount,
      preloadReuseCount: preloadStats.reuseCount,
      preloadCachedWindowCount: preloadStats.cachedWindowCount,
      durationMs: Date.now() - warmupStartedAt,
      memoryRssMb: getMemoryRssMb(),
      source: "recalcSimulatorBuildImpl",
    });
  }
  const boundedValidationOnlyDateKeysLocal = boundDateKeysToCoverageWindow(
    effectiveValidationOnlyDateKeysLocal,
    resolveCanonicalUsage365CoverageWindow()
  );

  const canonicalWindowForFp = canonicalWindowDateRange(built.canonicalMonths);
  const fingerprintWindowStart =
    smtAnchorPeriods?.[0]?.startDate ?? canonicalWindowForFp?.start ?? `${built.canonicalMonths[0]}-01`;
  const fingerprintWindowEnd =
    smtAnchorPeriods?.[smtAnchorPeriods.length - 1]?.endDate ??
    canonicalWindowForFp?.end ??
    `${built.canonicalMonths[built.canonicalMonths.length - 1]}-28`;
  const fingerprintContext = createFingerprintRecalcContext({
    houseId,
    actualContextHouseId,
    esiid: esiid ?? null,
    homeProfile: homeProfile as any,
    applianceProfile: applianceProfile as any,
    mode: simMode,
    actualOk,
    windowStart: fingerprintWindowStart,
    windowEnd: fingerprintWindowEnd,
    correlationId: args.correlationId,
  });
  let resolvedSimFingerprint: ResolvedSimFingerprint | undefined;
  if (isLeanManualTotalsMode(simMode)) {
    resolvedSimFingerprint = buildLeanManualTotalsResolvedFingerprint({
      houseId,
      actualContextHouseId,
      manualUsagePayload,
    });
  } else {
    try {
      await ensureSimulatorFingerprintsWithContext(fingerprintContext);
    } catch (e) {
      console.warn("[usageSimulator] ensureSimulatorFingerprintsForRecalc failed", e);
    }
    try {
      resolvedSimFingerprint = await resolveSimFingerprintWithContext(fingerprintContext, {
        manualUsagePayload: simMode === "MANUAL_TOTALS" ? manualUsagePayload : null,
      });
    } catch (e) {
      console.warn("[usageSimulator] resolveSimFingerprint failed", e);
    }
  }
  if (resolvedSimFingerprint && args.adminLabTreatmentMode) {
    resolvedSimFingerprint = applyAdminLabTreatmentToResolvedFingerprint({
      resolved: resolvedSimFingerprint,
      treatmentMode: args.adminLabTreatmentMode,
      simulatorMode: simMode,
    });
  }

  let pastSimulatedMonths: string[] | undefined;
  let pastPatchedCurve: SimulatedCurve | null = null;
  let pastPatchedDataset: ReturnType<typeof buildSimulatedUsageDatasetFromBuildInputs> | null = null;
  let pastSimulatedDayResults: SimulatedDayResult[] | undefined;
  const producerBuildPathKind =
    runContext.buildPathKind === "cache_restore" ? "recalc" : runContext.buildPathKind;
  if (shouldUseSharedPastProducer) {
    try {
      const canonicalWindow = canonicalWindowDateRange(built.canonicalMonths);
      const startDate = sharedPastRecalcWindow?.startDate ?? canonicalWindow?.start ?? `${built.canonicalMonths[0]}-01`;
      const endDate =
        sharedPastRecalcWindow?.endDate ??
        canonicalWindow?.end ??
        `${built.canonicalMonths[built.canonicalMonths.length - 1]}-28`;
      const recalcBuildInputs: SimulatorBuildInputsV1 = {
        version: 1,
        mode: simMode,
        baseKind: built.baseKind,
        canonicalEndMonth: built.canonicalMonths[built.canonicalMonths.length - 1] ?? "",
        canonicalMonths: built.canonicalMonths,
        canonicalPeriods: [
          {
            id: "canonical_usage_365_coverage",
            startDate: startDate,
            endDate: endDate,
          },
        ],
        weatherPreference,
        weatherLogicMode: resolveWeatherLogicModeFromBuildInputs({ weatherPreference }),
        monthlyTotalsKwhByMonth,
        manualAnnualTotalKwh: built.manualAnnualTotalKwh ?? null,
        intradayShape96: built.intradayShape96,
        weekdayWeekendShape96: built.weekdayWeekendShape96,
        travelRanges: allTravelRanges,
        notes: built.notes ?? [],
        filledMonths: built.filledMonths ?? [],
        monthlyTargetConstructionDiagnostics: built.monthlyTargetConstructionDiagnostics ?? null,
        manualMonthlyInputState: built.manualMonthlyInputState ?? null,
        manualTravelVacantDonorPoolMode,
        manualBillPeriods: built.manualBillPeriods ?? [],
        manualBillPeriodTotalsKwhById: built.manualBillPeriodTotalsKwhById ?? null,
        validationOnlyDateKeysLocal: Array.from(boundedValidationOnlyDateKeysLocal).sort(),
        effectiveValidationSelectionMode: effectiveValidationSelectionMode ?? undefined,
        validationSelectionDiagnostics: validationSelectionDiagnostics ?? undefined,
        actualContextHouseId,
        sharedProducerPathUsed: true,
        ...(weatherEfficiencyDerivedInput ? { weatherEfficiencyDerivedInput } : {}),
        snapshots: {
          homeProfile,
          applianceProfile,
          manualUsagePayload,
          weatherSensitivityScore,
          weatherEfficiencyDerivedInput,
        },
        ...(resolvedSimFingerprint ? { resolvedSimFingerprint } : {}),
      };
      let preloadedActualIntervalsForSim: Array<{ timestamp: string; kwh: number }> | undefined;
      let simulationPreloadCacheHit: boolean | undefined;
      if (recalcIntervalPreload && simMode === "SMT_BASELINE") {
        const simIntervalPreloadStartedAt = Date.now();
        const preloaded = await recalcIntervalPreload.getIntervals({ startDate, endDate });
        preloadedActualIntervalsForSim = preloaded.intervals;
        simulationPreloadCacheHit = preloaded.cacheHit;
        const reuseMissReason = preloaded.cacheHit
          ? null
          : !validationSelectionUsedSharedPreloadWindow
            ? "validation_selection_not_preloaded"
            : validationSelectionPreloadWindowStart !== startDate || validationSelectionPreloadWindowEnd !== endDate
              ? "validation_selection_window_mismatch"
              : "cache_miss_unexpected";
        logSimPipelineEvent("recalc_simulation_shared_interval_preload", {
          correlationId: args.correlationId,
          houseId,
          sourceHouseId: actualContextHouseId !== houseId ? actualContextHouseId : undefined,
          startDate,
          endDate,
          preloadWindowSource: sharedPastRecalcWindow?.source ?? "simulation_fallback_range",
          simulationUsesSharedPreloadWindow: Boolean(sharedPastRecalcWindow),
          sharedWindowWithValidationSelection:
            sharedPastRecalcWindow != null &&
            sharedPastRecalcWindow.startDate === startDate &&
            sharedPastRecalcWindow.endDate === endDate,
          cacheHit: preloaded.cacheHit,
          reuseMissReason,
          intervalRowCount: preloaded.intervals.length,
          duplicateIntervalLoadAvoided: preloaded.cacheHit,
          durationMs: Date.now() - simIntervalPreloadStartedAt,
          memoryRssMb: getMemoryRssMb(),
          source: "recalcSimulatorBuildImpl",
        });
      }
      const result = await simulatePastUsageDataset({
        houseId,
        actualContextHouseId,
        userId,
        esiid: esiid ?? null,
        startDate,
        endDate,
        timezone: timezoneForStoredBuild,
        travelRanges: allTravelRanges,
        buildInputs: recalcBuildInputs,
        buildPathKind: producerBuildPathKind,
        forceModeledOutputKeepReferencePoolDateKeysLocal:
          boundedValidationOnlyDateKeysLocal.size > 0 ? boundedValidationOnlyDateKeysLocal : undefined,
        correlationId: args.correlationId,
        ...(preloadedActualIntervalsForSim != null ? { actualIntervals: preloadedActualIntervalsForSim } : {}),
      });
      if (simulationPreloadCacheHit != null) {
        const preloadStats = recalcIntervalPreload?.getStats();
        logSimPipelineEvent("recalc_simulation_shared_interval_preload_summary", {
          correlationId: args.correlationId,
          houseId,
          sourceHouseId: actualContextHouseId !== houseId ? actualContextHouseId : undefined,
          preloadFetchCount: preloadStats?.fetchCount,
          preloadReuseCount: preloadStats?.reuseCount,
          preloadCachedWindowCount: preloadStats?.cachedWindowCount,
          source: "recalcSimulatorBuildImpl",
          memoryRssMb: getMemoryRssMb(),
        });
      }
      if (result.dataset !== null && result.stitchedCurve) {
        logSimPipelineEvent("recalc_shared_post_baseline_handoff_complete", {
          correlationId: args.correlationId,
          houseId,
          sourceHouseId: actualContextHouseId !== houseId ? actualContextHouseId : undefined,
          scenarioId,
          mode: simMode,
          buildPathKind: producerBuildPathKind,
          intervalCount: Array.isArray((result.dataset as any)?.series?.intervals15)
            ? (result.dataset as any).series.intervals15.length
            : 0,
          dayCount: Array.isArray((result.dataset as any)?.daily) ? (result.dataset as any).daily.length : 0,
          monthCount: Array.isArray((result.dataset as any)?.monthly) ? (result.dataset as any).monthly.length : 0,
          simulatedDayResultsCount: Array.isArray(result.simulatedDayResults) ? result.simulatedDayResults.length : 0,
          canonicalMonthCount: Array.isArray(recalcBuildInputs.canonicalMonths) ? recalcBuildInputs.canonicalMonths.length : 0,
          source: "recalcSimulatorBuildImpl",
          memoryRssMb: getMemoryRssMb(),
        });
        pastPatchedDataset = result.dataset as ReturnType<typeof buildSimulatedUsageDatasetFromBuildInputs>;
        pastPatchedCurve = result.stitchedCurve;
        pastSimulatedDayResults = result.simulatedDayResults;
        const byMonth: Record<string, number> = {};
        for (const m of result.stitchedCurve.monthlyTotals) {
          const ym = String(m?.month ?? "").trim();
          if (/^\d{4}-\d{2}$/.test(ym) && typeof m?.kwh === "number" && Number.isFinite(m.kwh)) byMonth[ym] = m.kwh;
        }
        if (Object.keys(byMonth).length > 0) monthlyTotalsKwhByMonth = byMonth;
        pastSimulatedMonths = [];
        notes.push(
          simMode === "MANUAL_TOTALS"
            ? "Manual monthly: shared Past producer built the normalized artifact."
            : "Past: baseline patched for excluded + leading-missing days"
        );
      } else if (simMode === "MANUAL_TOTALS") {
        const producerError =
          "error" in result && typeof result.error === "string"
            ? result.error
            : "Shared MANUAL_TOTALS producer returned no dataset.";
        return {
          ok: false,
          error: "manual_monthly_shared_producer_no_dataset",
          missingItems: [producerError],
        };
      }
    } catch (e) {
      if (simMode === "MANUAL_TOTALS") {
        return {
          ok: false,
          error: "manual_monthly_shared_producer_no_dataset",
          missingItems: [e instanceof Error ? e.message : String(e)],
        };
      }
      console.warn("[usageSimulator] Past stitched curve failed, using monthly curve", e);
    }
  }

  const buildInputs: SimulatorBuildInputsV1 & {
    scenarioKey?: string;
    scenarioId?: string | null;
    versions?: typeof versions;
    pastSimulatedMonths?: string[];
    timezone?: string;
  } = {
    version: 1,
    mode: simMode,
    baseKind,
    canonicalEndMonth: canonicalForBuild.endMonth,
    canonicalMonths: built.canonicalMonths,
    canonicalPeriods:
      shouldUseSharedPastProducer
        ? [
            {
              id: "canonical_usage_365_coverage",
              startDate: sharedPastRecalcWindow?.startDate ?? resolveCanonicalUsage365CoverageWindow().startDate,
              endDate: sharedPastRecalcWindow?.endDate ?? resolveCanonicalUsage365CoverageWindow().endDate,
            },
          ]
        : simMode === "SMT_BASELINE"
          ? undefined
        : manualCanonicalPeriods.length
          ? manualCanonicalPeriods
          : undefined,
    weatherPreference,
    weatherLogicMode: resolveWeatherLogicModeFromBuildInputs({ weatherPreference }),
    weatherNormalizerVersion: WEATHER_NORMALIZER_VERSION,
    monthlyTotalsKwhByMonth,
    intradayShape96: built.intradayShape96,
    weekdayWeekendShape96: built.weekdayWeekendShape96,
    travelRanges:
      simMode === "MANUAL_TOTALS"
        ? allTravelRanges
        : scenarioId
          ? [...pastTravelRanges, ...scenarioTravelRanges]
          : [],
    actualContextHouseId,
    validationOnlyDateKeysLocal: Array.from(boundedValidationOnlyDateKeysLocal).sort(),
    effectiveValidationSelectionMode: effectiveValidationSelectionMode ?? undefined,
    validationSelectionDiagnostics: validationSelectionDiagnostics ?? undefined,
    timezone: timezoneForStoredBuild,
    notes,
    filledMonths: built.filledMonths,
    manualAnnualTotalKwh: built.manualAnnualTotalKwh ?? null,
    monthlyTargetConstructionDiagnostics: built.monthlyTargetConstructionDiagnostics ?? null,
    manualMonthlyInputState: built.manualMonthlyInputState ?? null,
    manualTravelVacantDonorPoolMode,
    manualBillPeriods: built.manualBillPeriods ?? [],
    manualBillPeriodTotalsKwhById: built.manualBillPeriodTotalsKwhById ?? null,
    sharedProducerPathUsed: shouldUseSharedPastProducer,
    simulationVariablePolicy,
    effectiveSimulationVariablesUsed: simulationVariableResolution.effectiveSimulationVariablesUsed,
    ...(weatherEfficiencyDerivedInput ? { weatherEfficiencyDerivedInput } : {}),
    ...(pastSimulatedMonths != null ? { pastSimulatedMonths } : {}),
    snapshots: {
      manualUsagePayload: manualUsagePayload ?? null,
      homeProfile,
      applianceProfile,
      baselineHomeProfile: homeProfile,
      baselineApplianceProfile: applianceProfile,
      actualSource: built.source?.actualSource ?? actualSource ?? undefined,
      actualSourceAnchorEndDate: actualSourceAnchor.anchorEndDate ?? undefined,
      smtAnchorEndDate: actualSourceAnchor.smtAnchorEndDate ?? undefined,
      greenButtonAnchorEndDate: actualSourceAnchor.greenButtonAnchorEndDate ?? undefined,
      actualMonthlyAnchorsByMonth: built.source?.actualMonthlyAnchorsByMonth ?? undefined,
      actualIntradayShape96: built.source?.actualIntradayShape96 ?? undefined,
      smtMonthlyAnchorsByMonth: built.source?.smtMonthlyAnchorsByMonth ?? undefined,
      smtIntradayShape96: built.source?.smtIntradayShape96 ?? undefined,
      weatherSensitivityScore,
      weatherEfficiencyDerivedInput,
      scenario: scenario ? { id: scenario.id, name: scenario.name } : null,
      scenarioEvents: scenarioEvents ?? [],
      scenarioOverlay: overlay ?? null,
      pastScenario: pastOverlay ? pastScenario : null,
      pastScenarioEvents: pastOverlay ? pastEventsForOverlay : [],
      ...(adminLabManualConstraint
        ? {
            adminLabSyntheticManualUsage: true,
            adminLabTreatmentMode: args.adminLabTreatmentMode,
          }
        : {}),
    } as any,
    ...(resolvedSimFingerprint ? { resolvedSimFingerprint } : {}),
    scenarioKey,
    scenarioId,
    versions,
  };

  // V1 hash: stable JSON of a deterministic object.
  const eventsForHash = buildScenarioEventsHashRows(
    pastOverlay ? [...pastEventsForOverlay, ...(scenarioEvents ?? [])] : (scenarioEvents ?? [])
  );

  const buildInputsHash = computeBuildInputsHash({
    canonicalMonths: buildInputs.canonicalMonths,
    mode: buildInputs.mode,
    baseKind: buildInputs.baseKind,
    scenarioKey,
    baseScenarioKey: pastOverlay ? String(pastScenario?.id ?? "") : null,
    scenarioEvents: eventsForHash,
    weatherPreference,
    versions,
  });

  const datasetPackagingPath =
    pastPatchedDataset != null
      ? "reuse_shared_dataset"
      : pastPatchedCurve != null
        ? "reuse_shared_curve"
        : "direct_build_inputs";
  if (datasetPackagingPath === "direct_build_inputs") {
    const directBuilderPeriodStart =
      Array.isArray(buildInputs.canonicalPeriods) && buildInputs.canonicalPeriods.length > 0
        ? String(buildInputs.canonicalPeriods[0]?.startDate ?? "").slice(0, 10) || null
        : null;
    const directBuilderPeriodEnd =
      Array.isArray(buildInputs.canonicalPeriods) && buildInputs.canonicalPeriods.length > 0
        ? String(buildInputs.canonicalPeriods[buildInputs.canonicalPeriods.length - 1]?.endDate ?? "").slice(0, 10) || null
        : null;
    const directBuilderCanonicalWindow = canonicalWindowDateRange(buildInputs.canonicalMonths);
    const directBuilderWindowStart = directBuilderPeriodStart ?? directBuilderCanonicalWindow?.start ?? null;
    const directBuilderWindowEnd = directBuilderPeriodEnd ?? directBuilderCanonicalWindow?.end ?? null;
    const directBuilderWindowSpanDays =
      directBuilderWindowStart && directBuilderWindowEnd
        ? Math.round(
            (new Date(`${directBuilderWindowEnd}T12:00:00.000Z`).getTime() -
              new Date(`${directBuilderWindowStart}T12:00:00.000Z`).getTime()) /
              (24 * 60 * 60 * 1000)
          ) + 1
        : undefined;
    logSimPipelineEvent("recalc_post_baseline_direct_builder_window", {
      correlationId: args.correlationId,
      houseId,
      sourceHouseId: actualContextHouseId !== houseId ? actualContextHouseId : undefined,
      scenarioId,
      mode: simMode,
      buildInputsHash,
      windowSource: directBuilderPeriodStart && directBuilderPeriodEnd ? "canonical_periods" : "canonical_months",
      windowStartDate: directBuilderWindowStart,
      windowEndDate: directBuilderWindowEnd,
      windowSpanDays: directBuilderWindowSpanDays,
      canonicalMonthCount: Array.isArray(buildInputs.canonicalMonths) ? buildInputs.canonicalMonths.length : 0,
      canonicalMonthStart: buildInputs.canonicalMonths[0] ?? null,
      canonicalMonthEnd: buildInputs.canonicalMonths[buildInputs.canonicalMonths.length - 1] ?? null,
      canonicalPeriodCount: Array.isArray(buildInputs.canonicalPeriods) ? buildInputs.canonicalPeriods.length : 0,
      validationOnlyDateCount: Array.isArray(buildInputs.validationOnlyDateKeysLocal)
        ? buildInputs.validationOnlyDateKeysLocal.length
        : 0,
      travelRangeCount: Array.isArray(buildInputs.travelRanges) ? buildInputs.travelRanges.length : 0,
      source: "recalcSimulatorBuildImpl",
      memoryRssMb: getMemoryRssMb(),
    });
  }

  const datasetPackagingStartedAt = Date.now();
  logSimPipelineEvent("recalc_post_baseline_dataset_packaging_start", {
    correlationId: args.correlationId,
    houseId,
    sourceHouseId: actualContextHouseId !== houseId ? actualContextHouseId : undefined,
    scenarioId,
    mode: simMode,
    buildInputsHash,
    datasetPackagingPath,
    reusedSharedDataset: pastPatchedDataset != null,
    reusedSharedCurve: pastPatchedDataset == null && pastPatchedCurve != null,
    source: "recalcSimulatorBuildImpl",
    memoryRssMb: getMemoryRssMb(),
  });
  let dataset:
    | ReturnType<typeof buildSimulatedUsageDatasetFromBuildInputs>
    | ReturnType<typeof buildSimulatedUsageDatasetFromCurve>;
  try {
    dataset =
      pastPatchedDataset != null
        ? pastPatchedDataset
        : pastPatchedCurve != null
        ? buildSimulatedUsageDatasetFromCurve(pastPatchedCurve, {
            baseKind: buildInputs.baseKind,
            mode: buildInputs.mode,
            canonicalEndMonth: buildInputs.canonicalEndMonth,
            notes: buildInputs.notes,
            filledMonths: buildInputs.filledMonths,
            monthlyTargetConstructionDiagnostics: buildInputs.monthlyTargetConstructionDiagnostics ?? null,
            manualMonthlyInputState: buildInputs.manualMonthlyInputState ?? null,
            sharedProducerPathUsed: buildInputs.sharedProducerPathUsed ?? false,
            weatherSensitivityScore: buildInputs.snapshots?.weatherSensitivityScore ?? null,
            weatherEfficiencyDerivedInput: buildInputs.weatherEfficiencyDerivedInput ?? null,
          }, {
            timezone: (buildInputs as any).timezone ?? undefined,
            useUtcMonth: true,
            simulatedDayResults: pastSimulatedDayResults,
          })
        : shouldUseSharedPastProducer && simMode === "MANUAL_TOTALS"
          ? (() => {
              throw new Error("manual_monthly_direct_builder_disabled_for_truth_path");
            })()
          : buildSimulatedUsageDatasetFromBuildInputs(buildInputs);
    logSimPipelineEvent("recalc_post_baseline_dataset_packaging_success", {
      correlationId: args.correlationId,
      houseId,
      sourceHouseId: actualContextHouseId !== houseId ? actualContextHouseId : undefined,
      scenarioId,
      mode: simMode,
      buildInputsHash,
      durationMs: Date.now() - datasetPackagingStartedAt,
      intervalCount: Array.isArray((dataset as any)?.series?.intervals15) ? (dataset as any).series.intervals15.length : 0,
      dayCount: Array.isArray((dataset as any)?.daily) ? (dataset as any).daily.length : 0,
      monthCount: Array.isArray((dataset as any)?.monthly) ? (dataset as any).monthly.length : 0,
      source: "recalcSimulatorBuildImpl",
      memoryRssMb: getMemoryRssMb(),
    });
  } catch (e) {
    logSimPipelineEvent("recalc_post_baseline_dataset_packaging_failure", {
      correlationId: args.correlationId,
      houseId,
      sourceHouseId: actualContextHouseId !== houseId ? actualContextHouseId : undefined,
      scenarioId,
      mode: simMode,
      buildInputsHash,
      durationMs: Date.now() - datasetPackagingStartedAt,
      failureMessage: e instanceof Error ? e.message : String(e),
      source: "recalcSimulatorBuildImpl",
      memoryRssMb: getMemoryRssMb(),
    });
    throw e;
  }
  const sourceDerivedMonthlyTotalsKwhByMonth =
    built.source?.actualMonthlyAnchorsByMonth && typeof built.source.actualMonthlyAnchorsByMonth === "object"
      ? (built.source.actualMonthlyAnchorsByMonth as Record<string, number>)
      : simMode === "MANUAL_TOTALS"
        ? built.sourceDerivedTrustedMonthlyTotalsKwhByMonth ?? null
        : null;
  const sourceDerivedAnnualTotalKwh =
    sourceDerivedMonthlyTotalsKwhByMonth != null
      ? Object.values(sourceDerivedMonthlyTotalsKwhByMonth).reduce((sum, value) => sum + (Number(value) || 0), 0)
      : null;
  const normalizedLockboxInput = finalizePastSimLockboxInput({
    base: {
      ...initialLockboxInput,
      travelRanges: { ranges: allTravelRanges },
      validationKeys: {
        ...initialLockboxInput.validationKeys,
        localDateKeys: Array.from(boundedValidationOnlyDateKeysLocal).sort(),
        selectionMode: effectiveValidationSelectionMode ?? initialLockboxInput.validationKeys.selectionMode,
      },
    },
    window: resolveWindowFromBuildInputsForPastIdentity(buildInputs),
    timezone: timezoneForStoredBuild,
    intervalFingerprint: null,
    weatherLogicMode: resolveWeatherLogicModeFromBuildInputs(buildInputs as Record<string, unknown>),
    weatherIdentity: null,
    sourceDerivedMonthlyTotalsKwhByMonth,
    sourceDerivedAnnualTotalKwh,
    homeProfileSnapshotRef: homeProfile ? `home_profile:${initialLockboxInput.profileContext.profileHouseId}` : null,
    applianceProfileSnapshotRef: applianceProfile ? `appliance_profile:${initialLockboxInput.profileContext.profileHouseId}` : null,
    usageShapeProfileIdentity:
      ((dataset as any)?.meta?.intervalUsageFingerprintIdentity as string | null | undefined) ??
      resolvedSimFingerprint?.usageSourceHash ??
      null,
    validationSelectionMode: effectiveValidationSelectionMode ?? null,
    validationDiagnosticsRef: null,
  });
  const perDayTrace = buildPastSimPerDayTrace(pastSimulatedDayResults);
  const filledSet = new Set<string>((buildInputs.filledMonths ?? []).map(String));
  const monthProvenanceByMonth: Record<string, "ACTUAL" | "SIMULATED"> = {};
  for (const ym of buildInputs.canonicalMonths ?? []) {
    monthProvenanceByMonth[String(ym)] =
      simMode === "SMT_BASELINE" && !scenarioId && !filledSet.has(String(ym)) ? "ACTUAL" : "SIMULATED";
  }
  (dataset as any).meta = {
    ...(dataset.meta ?? {}),
    buildInputsHash,
    lastBuiltAt: new Date().toISOString(),
    scenarioKey,
    scenarioId,
    monthProvenanceByMonth,
    actualSource: built.source?.actualSource ?? actualSource ?? null,
    actualContextHouseId,
    validationOnlyDateKeysLocal: Array.isArray((buildInputs as any).validationOnlyDateKeysLocal)
      ? ((buildInputs as any).validationOnlyDateKeysLocal as string[])
      : [],
    monthlyTargetConstructionDiagnostics: built.monthlyTargetConstructionDiagnostics ?? null,
    manualMonthlyInputState: built.manualMonthlyInputState ?? null,
    manualBillPeriods: built.manualBillPeriods ?? [],
    manualBillPeriodTotalsKwhById: built.manualBillPeriodTotalsKwhById ?? null,
    weatherSensitivityScore: weatherSensitivityScore ?? (dataset as any)?.meta?.weatherSensitivityScore ?? null,
    weatherEfficiencyDerivedInput:
      weatherEfficiencyDerivedInput ?? (dataset as any)?.meta?.weatherEfficiencyDerivedInput ?? null,
    sourceDerivedMonthlyTotalsKwhByMonth,
    sharedProducerPathUsed: buildInputs.sharedProducerPathUsed ?? false,
    lockboxInput: normalizedLockboxInput,
    lockboxRunContext: runContext,
    lockboxPerDayTrace: perDayTrace,
  };
  const releasedSimulatedDayBuffers = releaseSimulatedDayResultBuffers(pastSimulatedDayResults);
  pastSimulatedDayResults = undefined;
  logSimPipelineEvent("recalc_simulated_day_buffer_release", {
    correlationId: args.correlationId,
    houseId,
    sourceHouseId: actualContextHouseId !== houseId ? actualContextHouseId : undefined,
    scenarioId,
    mode: simMode,
    releasedDayCount: releasedSimulatedDayBuffers.releasedDayCount,
    releasedIntervalCount: releasedSimulatedDayBuffers.releasedIntervalCount,
    source: "recalcSimulatorBuildImpl",
    memoryRssMb: getMemoryRssMb(),
  });

  const persistBuildStartedAt = Date.now();
  logSimPipelineEvent("recalc_persist_build_start", {
    correlationId: args.correlationId,
    houseId,
    sourceHouseId: actualContextHouseId !== houseId ? actualContextHouseId : undefined,
    scenarioId,
    mode: simMode,
    buildInputsHash,
    source: "recalcSimulatorBuildImpl",
    memoryRssMb: getMemoryRssMb(),
  });
  try {
    await upsertSimulatorBuild({
      userId,
      houseId,
      scenarioKey,
      mode: simMode,
      baseKind,
      canonicalEndMonth: buildInputs.canonicalEndMonth,
      canonicalMonths: buildInputs.canonicalMonths,
      buildInputs,
      buildInputsHash,
      versions,
      fingerprintRefs:
        resolvedSimFingerprint != null
          ? {
              wholeHomeFingerprintArtifactId: resolvedSimFingerprint.wholeHomeFingerprintArtifactId,
              usageFingerprintArtifactId: resolvedSimFingerprint.usageFingerprintArtifactId,
              fingerprintProvenanceJson: {
                resolverVersion: resolvedSimFingerprint.resolverVersion,
                resolvedHash: resolvedSimFingerprint.resolvedHash,
                blendMode: resolvedSimFingerprint.blendMode,
                wholeHomeSourceHash: resolvedSimFingerprint.wholeHomeSourceHash,
                usageSourceHash: resolvedSimFingerprint.usageSourceHash,
                usageBlendWeight: resolvedSimFingerprint.usageBlendWeight,
                wholeHomeHouseId: resolvedSimFingerprint.wholeHomeHouseId,
                usageFingerprintHouseId: resolvedSimFingerprint.usageFingerprintHouseId,
              },
            }
          : undefined,
    });
    logSimPipelineEvent("recalc_persist_build_success", {
      correlationId: args.correlationId,
      houseId,
      sourceHouseId: actualContextHouseId !== houseId ? actualContextHouseId : undefined,
      scenarioId,
      mode: simMode,
      buildInputsHash,
      durationMs: Date.now() - persistBuildStartedAt,
      source: "recalcSimulatorBuildImpl",
      memoryRssMb: getMemoryRssMb(),
    });
  } catch (e) {
    logSimPipelineEvent("recalc_persist_build_failure", {
      correlationId: args.correlationId,
      houseId,
      sourceHouseId: actualContextHouseId !== houseId ? actualContextHouseId : undefined,
      scenarioId,
      mode: simMode,
      buildInputsHash,
      durationMs: Date.now() - persistBuildStartedAt,
      failureMessage: e instanceof Error ? e.message : String(e),
      source: "recalcSimulatorBuildImpl",
      memoryRssMb: getMemoryRssMb(),
    });
    throw e;
  }

  let canonicalArtifactInputHash: string | null = null;
  const shouldPersistCanonicalPastArtifact =
    args.persistPastSimBaseline === true &&
    scenario?.name === WORKSPACE_PAST_NAME &&
    (simMode === "SMT_BASELINE" || simMode === "MANUAL_TOTALS" || simMode === "NEW_BUILD_ESTIMATE");
  if (shouldPersistCanonicalPastArtifact) {
    const intervals15 = (
      Array.isArray((dataset as any)?.series?.intervals15) ? (dataset as any).series.intervals15 : []
    )
      .map((row: { timestamp?: string; kwh?: number }) => ({
        timestamp: String(row?.timestamp ?? ""),
        kwh: Number(row?.kwh) || 0,
      }))
      .filter((row: { timestamp: string; kwh: number }) => row.timestamp.length > 0);
    if (intervals15.length === 0) {
      logSimPipelineEvent("recalc_artifact_persist_failure", {
        correlationId: args.correlationId,
        houseId,
        sourceHouseId: actualContextHouseId !== houseId ? actualContextHouseId : undefined,
        scenarioId,
        mode: simMode,
        failureMessage: "Canonical artifact persistence requires non-empty intervals15 output.",
        source: "recalcSimulatorBuildImpl",
        memoryRssMb: getMemoryRssMb(),
      });
      return {
        ok: false,
        error: "artifact_persist_failed",
        missingItems: ["Canonical artifact persistence requires non-empty intervals15 output."],
      };
    }

    const identityWindow = resolveWindowFromBuildInputsForPastIdentity(buildInputs);
    if (!identityWindow) {
      logSimPipelineEvent("recalc_artifact_persist_failure", {
        correlationId: args.correlationId,
        houseId,
        sourceHouseId: actualContextHouseId !== houseId ? actualContextHouseId : undefined,
        scenarioId,
        mode: simMode,
        failureMessage: "Canonical artifact persistence could not resolve identity window from recalc build inputs.",
        source: "recalcSimulatorBuildImpl",
        memoryRssMb: getMemoryRssMb(),
      });
      return {
        ok: false,
        error: "artifact_persist_failed",
        missingItems: ["Canonical artifact persistence could not resolve identity window from recalc build inputs."],
      };
    }

    const artifactPersistStartedAt = Date.now();
    logSimPipelineEvent("recalc_artifact_persist_start", {
      correlationId: args.correlationId,
      houseId,
      sourceHouseId: actualContextHouseId !== houseId ? actualContextHouseId : undefined,
      scenarioId,
      mode: simMode,
      windowStartUtc: identityWindow.startDate,
      windowEndUtc: identityWindow.endDate,
      intervalCount: intervals15.length,
      source: "recalcSimulatorBuildImpl",
      memoryRssMb: getMemoryRssMb(),
    });
    try {
      const canonicalActualIdentity = await resolveCanonicalActualIdentityForBuild({
        userId,
        requestHouseId: houseId,
        requestHouseEsiid: esiid ?? null,
        buildInputs: buildInputs as Record<string, unknown>,
      });
      const intervalDataFingerprint = await getIntervalDataFingerprint({
        houseId: canonicalActualIdentity.houseId,
        esiid: canonicalActualIdentity.esiid,
        startDate: identityWindow.startDate,
        endDate: identityWindow.endDate,
      });
      const usageShapeProfileIdentity = isLeanManualTotalsMode(simMode)
        ? {
            usageShapeProfileId: null,
            usageShapeProfileVersion: null,
            usageShapeProfileDerivedAt: null,
            usageShapeProfileSimHash: null,
          }
        : await getUsageShapeProfileIdentityForPast(houseId);
      const weatherIdentity = await computePastWeatherIdentity({
        houseId: canonicalActualIdentity.houseId,
        startDate: identityWindow.startDate,
        endDate: identityWindow.endDate,
        weatherLogicMode: resolveWeatherLogicModeFromBuildInputs(buildInputs as Record<string, unknown>),
      });
      const artifactInputHash = computePastInputHash({
        engineVersion: PAST_ENGINE_VERSION,
        windowStartUtc: identityWindow.startDate,
        windowEndUtc: identityWindow.endDate,
        timezone: String((buildInputs as any)?.timezone ?? "America/Chicago"),
        travelRanges: (Array.isArray((buildInputs as any)?.travelRanges) ? (buildInputs as any).travelRanges : []) as Array<{
          startDate: string;
          endDate: string;
        }>,
        buildInputs: buildInputs as Record<string, unknown>,
        intervalDataFingerprint,
        usageShapeProfileId: usageShapeProfileIdentity.usageShapeProfileId,
        usageShapeProfileVersion: usageShapeProfileIdentity.usageShapeProfileVersion,
        usageShapeProfileDerivedAt: usageShapeProfileIdentity.usageShapeProfileDerivedAt,
        usageShapeProfileSimHash: usageShapeProfileIdentity.usageShapeProfileSimHash,
        weatherIdentity,
      });
      canonicalArtifactInputHash = artifactInputHash;
      applyCanonicalCoverageMetadataForNonBaseline(dataset, scenarioKey, { buildInputs });
      const canonicalArtifactSimulatedDayTotalsByDate = readCanonicalArtifactSimulatedDayTotalsByDate(dataset);
      const { bytes } = encodeIntervalsV1(intervals15);
      const finalizedLockboxInput = finalizePastSimLockboxInput({
        base: normalizedLockboxInput,
        window: identityWindow,
        timezone: String((buildInputs as any)?.timezone ?? "America/Chicago"),
        intervalFingerprint: intervalDataFingerprint,
        weatherIdentity,
        sourceDerivedMonthlyTotalsKwhByMonth,
        sourceDerivedAnnualTotalKwh,
        homeProfileSnapshotRef:
          normalizedLockboxInput.profileContext.homeProfileSnapshotRef ??
          `home_profile:${normalizedLockboxInput.profileContext.profileHouseId}`,
        applianceProfileSnapshotRef:
          normalizedLockboxInput.profileContext.applianceProfileSnapshotRef ??
          `appliance_profile:${normalizedLockboxInput.profileContext.profileHouseId}`,
        usageShapeProfileIdentity: [
          usageShapeProfileIdentity.usageShapeProfileId,
          usageShapeProfileIdentity.usageShapeProfileVersion,
          usageShapeProfileIdentity.usageShapeProfileSimHash,
        ]
          .filter((value) => typeof value === "string" && value.length > 0)
          .join(":"),
        validationSelectionMode: effectiveValidationSelectionMode ?? null,
        validationDiagnosticsRef: null,
      });
      const fullChainHash = computePastSimFullChainHash({
        lockboxInput: finalizedLockboxInput,
        inputHash: artifactInputHash,
        encodedIntervalsDigest: digestEncodedIntervalsBuffer(bytes),
        engineVersion: PAST_ENGINE_VERSION,
      });
      const perRunTrace: PastSimPerRunTrace = {
        lockboxInput: finalizedLockboxInput,
        runContext,
        stageTimingsMs: {
          normalizeLockboxInput: 0,
          requirementsGate: 0,
          fingerprintResolution: 0,
          sourceIntervalLoadOrPreload: 0,
          sourceWeatherLoad: 0,
          postWeatherPrep: 0,
          referencePoolConstructionAndDaySimulation: 0,
          stitchCurveBuild: 0,
          datasetBuild: 0,
          persistencePayloadBuildAndDbCacheWrite: 0,
        },
        inputHash: artifactInputHash,
        fullChainHash,
        sourceHouseId: finalizedLockboxInput.sourceContext.sourceHouseId,
        profileHouseId: finalizedLockboxInput.profileContext.profileHouseId,
        testHomeId: finalizedLockboxInput.profileContext.testHomeId,
      };
      if (!dataset.meta || typeof dataset.meta !== "object") (dataset as any).meta = {};
      (dataset.meta as any).effectiveSimulationVariablesUsed = attachRunIdentityToEffectiveSimulationVariablesUsed(
        simulationVariableResolution.effectiveSimulationVariablesUsed,
        {
          artifactId: null,
          artifactInputHash,
          buildInputsHash,
          engineVersion: PAST_ENGINE_VERSION,
          houseId,
          actualContextHouseId,
          scenarioId,
        }
      );
      (dataset.meta as any).lockboxInput = finalizedLockboxInput;
      (dataset.meta as any).lockboxRunContext = runContext;
      (dataset.meta as any).lockboxPerRunTrace = perRunTrace;
      (dataset.meta as any).lockboxPerDayTrace = perDayTrace;
      (dataset.meta as any).fullChainHash = fullChainHash;
      const datasetJsonForStorage = {
        ...dataset,
        canonicalArtifactSimulatedDayTotalsByDate,
        meta: {
          ...((dataset as any)?.meta ?? {}),
          effectiveSimulationVariablesUsed: (dataset.meta as any).effectiveSimulationVariablesUsed,
          canonicalArtifactSimulatedDayTotalsByDate,
          lockboxInput: finalizedLockboxInput,
          lockboxRunContext: runContext,
          lockboxPerRunTrace: perRunTrace,
          lockboxPerDayTrace: perDayTrace,
          fullChainHash,
        },
        series: { ...((dataset as any)?.series ?? {}), intervals15: [] },
      };
      const scenarioIdForCache = scenarioId ?? "BASELINE";
      logSimPipelineEvent("recalc_artifact_cache_save_start", {
        correlationId: args.correlationId,
        houseId,
        sourceHouseId: actualContextHouseId !== houseId ? actualContextHouseId : undefined,
        scenarioId,
        mode: simMode,
        artifactInputHash,
        intervalCount: intervals15.length,
        source: "recalcSimulatorBuildImpl",
        memoryRssMb: getMemoryRssMb(),
      });
      await saveCachedPastDataset({
        houseId,
        scenarioId: scenarioIdForCache,
        inputHash: artifactInputHash,
        engineVersion: PAST_ENGINE_VERSION,
        windowStartUtc: identityWindow.startDate,
        windowEndUtc: identityWindow.endDate,
        datasetJson: datasetJsonForStorage as Record<string, unknown>,
        intervalsCodec: INTERVAL_CODEC_V1,
        intervalsCompressed: bytes,
      });
      logSimPipelineEvent("recalc_artifact_cache_save_success", {
        correlationId: args.correlationId,
        houseId,
        sourceHouseId: actualContextHouseId !== houseId ? actualContextHouseId : undefined,
        scenarioId,
        mode: simMode,
        artifactInputHash,
        durationMs: Date.now() - artifactPersistStartedAt,
        intervalCount: intervals15.length,
        source: "recalcSimulatorBuildImpl",
        memoryRssMb: getMemoryRssMb(),
      });
      cleanupStalePastCacheVariants({
        houseId,
        scenarioId: scenarioIdForCache,
        keepInputHash: artifactInputHash,
      });
      logSimPipelineEvent("recalc_artifact_readback_start", {
        correlationId: args.correlationId,
        houseId,
        sourceHouseId: actualContextHouseId !== houseId ? actualContextHouseId : undefined,
        scenarioId,
        mode: simMode,
        artifactInputHash,
        source: "recalcSimulatorBuildImpl",
        memoryRssMb: getMemoryRssMb(),
      });
      const persisted = await getCachedPastDataset({
        houseId,
        scenarioId: scenarioIdForCache,
        inputHash: artifactInputHash,
      });
      if (!persisted || persisted.intervalsCodec !== INTERVAL_CODEC_V1) {
        logSimPipelineEvent("recalc_artifact_persist_failure", {
          correlationId: args.correlationId,
          houseId,
          sourceHouseId: actualContextHouseId !== houseId ? actualContextHouseId : undefined,
          scenarioId,
          mode: simMode,
          artifactInputHash,
          durationMs: Date.now() - artifactPersistStartedAt,
          failureMessage: "Canonical artifact persistence readback verification failed after recalc.",
          source: "recalcSimulatorBuildImpl",
          memoryRssMb: getMemoryRssMb(),
        });
        return {
          ok: false,
          error: "artifact_persist_failed",
          missingItems: ["Canonical artifact persistence readback verification failed after recalc."],
        };
      }
      logSimPipelineEvent("recalc_artifact_persist_success", {
        correlationId: args.correlationId,
        houseId,
        sourceHouseId: actualContextHouseId !== houseId ? actualContextHouseId : undefined,
        scenarioId,
        mode: simMode,
        artifactInputHash,
        durationMs: Date.now() - artifactPersistStartedAt,
        intervalCount: intervals15.length,
        source: "recalcSimulatorBuildImpl",
        memoryRssMb: getMemoryRssMb(),
      });
      logSimPipelineEvent("recalc_artifact_ready_for_response", {
        correlationId: args.correlationId,
        houseId,
        sourceHouseId: actualContextHouseId !== houseId ? actualContextHouseId : undefined,
        scenarioId,
        mode: simMode,
        artifactInputHash,
        intervalCount: intervals15.length,
        dayCount: Array.isArray((dataset as any)?.daily) ? (dataset as any).daily.length : 0,
        monthCount: Array.isArray((dataset as any)?.monthly) ? (dataset as any).monthly.length : 0,
        source: "recalcSimulatorBuildImpl",
        memoryRssMb: getMemoryRssMb(),
      });
    } catch (e) {
      logSimPipelineEvent("recalc_artifact_persist_failure", {
        correlationId: args.correlationId,
        houseId,
        sourceHouseId: actualContextHouseId !== houseId ? actualContextHouseId : undefined,
        scenarioId,
        mode: simMode,
        artifactInputHash: canonicalArtifactInputHash,
        durationMs: Date.now() - artifactPersistStartedAt,
        failureMessage: e instanceof Error ? e.message : String(e),
        source: "recalcSimulatorBuildImpl",
        memoryRssMb: getMemoryRssMb(),
      });
      return {
        ok: false,
        error: "artifact_persist_failed",
        missingItems: [e instanceof Error ? e.message : String(e)],
      };
    }
  }

  const runUsageBucketsPersistence = async () => {
    if (
      scenarioKey === "BASELINE" ||
      !dataset?.usageBucketsByMonth ||
      Object.keys(dataset.usageBucketsByMonth).length === 0
    ) {
      return;
    }
    const usageBucketsStartedAt = Date.now();
    logSimPipelineEvent("recalc_usage_buckets_persist_start", {
      correlationId: args.correlationId,
      houseId,
      scenarioId,
      mode: simMode,
      bucketMonthCount: Object.keys(dataset.usageBucketsByMonth).length,
      source: "recalcSimulatorBuildImpl",
      memoryRssMb: getMemoryRssMb(),
    });
    await upsertSimulatedUsageBuckets({
      homeId: houseId,
      scenarioKey,
      scenarioId: scenarioId ?? null,
      usageBucketsByMonth: dataset.usageBucketsByMonth,
    })
      .then(() => {
        logSimPipelineEvent("recalc_usage_buckets_persist_success", {
          correlationId: args.correlationId,
          houseId,
          scenarioId,
          mode: simMode,
          bucketMonthCount: Object.keys(dataset.usageBucketsByMonth).length,
          durationMs: Date.now() - usageBucketsStartedAt,
          source: "recalcSimulatorBuildImpl",
          memoryRssMb: getMemoryRssMb(),
        });
      })
      .catch((e) => {
        logSimPipelineEvent("recalc_usage_buckets_persist_failure", {
          correlationId: args.correlationId,
          houseId,
          scenarioId,
          mode: simMode,
          bucketMonthCount: Object.keys(dataset.usageBucketsByMonth).length,
          durationMs: Date.now() - usageBucketsStartedAt,
          failureMessage: e instanceof Error ? e.message : String(e),
          source: "recalcSimulatorBuildImpl",
          memoryRssMb: getMemoryRssMb(),
        });
      });
  };

  const runIntervalSeriesPersistence = async () => {
    const intervals15 = Array.isArray(dataset?.series?.intervals15) ? dataset.series.intervals15 : [];
    if (intervals15.length === 0) return;
    const validIntervals = intervals15
      .map((row: any) => {
        const tsUtc = String(row?.timestamp ?? "");
        const tsDate = new Date(tsUtc);
        if (!Number.isFinite(tsDate.getTime())) return null;
        return {
          tsUtc,
          tsDate,
          kwh: Number(row?.kwh ?? 0),
        };
      })
      .filter((row: { tsUtc: string; tsDate: Date; kwh: number } | null): row is { tsUtc: string; tsDate: Date; kwh: number } => row != null)
      .sort((a, b) => a.tsDate.getTime() - b.tsDate.getTime());
    if (validIntervals.length === 0) return;
    const derivationVersion = String(
      (buildInputs as any)?.versions?.smtShapeDerivationVersion ??
        (buildInputs as any)?.versions?.intradayTemplateVersion ??
        "v1"
    );
    const intervalSeriesStartedAt = Date.now();
    logSimPipelineEvent("recalc_interval_series_persist_start", {
      correlationId: args.correlationId,
      houseId,
      sourceHouseId: actualContextHouseId !== houseId ? actualContextHouseId : undefined,
      scenarioId,
      mode: simMode,
      buildInputsHash,
      intervalCount: validIntervals.length,
      source: "recalcSimulatorBuildImpl",
      memoryRssMb: getMemoryRssMb(),
    });
    try {
      await saveIntervalSeries15m({
        userId,
        houseId,
        kind: IntervalSeriesKind.PAST_SIM_BASELINE,
        scenarioId,
        anchorStartUtc: validIntervals[0].tsDate,
        anchorEndUtc: validIntervals[validIntervals.length - 1].tsDate,
        derivationVersion,
        buildInputsHash,
        intervals15: validIntervals.map((row) => ({ tsUtc: row.tsUtc, kwh: row.kwh })),
      });
      logSimPipelineEvent("recalc_interval_series_persist_success", {
        correlationId: args.correlationId,
        houseId,
        sourceHouseId: actualContextHouseId !== houseId ? actualContextHouseId : undefined,
        scenarioId,
        mode: simMode,
        buildInputsHash,
        intervalCount: validIntervals.length,
        durationMs: Date.now() - intervalSeriesStartedAt,
        source: "recalcSimulatorBuildImpl",
        memoryRssMb: getMemoryRssMb(),
      });
    } catch (e) {
      logSimPipelineEvent("recalc_interval_series_persist_failure", {
        correlationId: args.correlationId,
        houseId,
        sourceHouseId: actualContextHouseId !== houseId ? actualContextHouseId : undefined,
        scenarioId,
        mode: simMode,
        buildInputsHash,
        intervalCount: validIntervals.length,
        durationMs: Date.now() - intervalSeriesStartedAt,
        failureMessage: e instanceof Error ? e.message : String(e),
        source: "recalcSimulatorBuildImpl",
        memoryRssMb: getMemoryRssMb(),
      });
      console.error("[usageSimulator/service] failed to persist PAST_SIM_BASELINE interval series", {
        userId,
        houseId,
        scenarioId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  };

  // Persist usage buckets for Past/Future so plan costing can use simulated usage.
  const shouldPersistPastSeries =
    args.persistPastSimBaseline === true &&
    scenario?.name === WORKSPACE_PAST_NAME &&
    (simMode === "SMT_BASELINE" || simMode === "MANUAL_TOTALS");
  const shouldDeferManualPostArtifactPersistence =
    isLeanManualTotalsMode(simMode) && canonicalArtifactInputHash != null;
  if (shouldDeferManualPostArtifactPersistence) {
    if (scenarioKey !== "BASELINE" && dataset?.usageBucketsByMonth && Object.keys(dataset.usageBucketsByMonth).length > 0) {
      logSimPipelineEvent("recalc_usage_buckets_persist_deferred", {
        correlationId: args.correlationId,
        houseId,
        scenarioId,
        mode: simMode,
        artifactInputHash: canonicalArtifactInputHash,
        bucketMonthCount: Object.keys(dataset.usageBucketsByMonth).length,
        source: "recalcSimulatorBuildImpl",
        memoryRssMb: getMemoryRssMb(),
      });
      void runUsageBucketsPersistence();
    }
    if (shouldPersistPastSeries) {
      logSimPipelineEvent("recalc_interval_series_persist_deferred", {
        correlationId: args.correlationId,
        houseId,
        sourceHouseId: actualContextHouseId !== houseId ? actualContextHouseId : undefined,
        scenarioId,
        mode: simMode,
        artifactInputHash: canonicalArtifactInputHash,
        source: "recalcSimulatorBuildImpl",
        memoryRssMb: getMemoryRssMb(),
      });
      void runIntervalSeriesPersistence();
    }
  } else {
    await runUsageBucketsPersistence();
    if (shouldPersistPastSeries) {
      await runIntervalSeriesPersistence();
    }
  }

  logSimPipelineEvent("recalc_result_packaging_start", {
    correlationId: args.correlationId,
    houseId,
    sourceHouseId: actualContextHouseId !== houseId ? actualContextHouseId : undefined,
    scenarioId,
    mode: simMode,
    buildInputsHash,
    artifactInputHash: canonicalArtifactInputHash,
    readbackPending: shouldDeferManualPostArtifactPersistence,
    source: "recalcSimulatorBuildImpl",
    memoryRssMb: getMemoryRssMb(),
  });
  logSimPipelineEvent("recalc_result_packaging_success", {
    correlationId: args.correlationId,
    houseId,
    sourceHouseId: actualContextHouseId !== houseId ? actualContextHouseId : undefined,
    scenarioId,
    mode: simMode,
    buildInputsHash,
    artifactInputHash: canonicalArtifactInputHash,
    readbackPending: shouldDeferManualPostArtifactPersistence,
    intervalCount: Array.isArray((dataset as any)?.series?.intervals15) ? (dataset as any).series.intervals15.length : 0,
    dayCount: Array.isArray((dataset as any)?.daily) ? (dataset as any).daily.length : 0,
    monthCount: Array.isArray((dataset as any)?.monthly) ? (dataset as any).monthly.length : 0,
    source: "recalcSimulatorBuildImpl",
    memoryRssMb: getMemoryRssMb(),
  });
  return {
    ok: true,
    houseId,
    buildInputsHash,
    dataset,
    canonicalArtifactInputHash,
    effectiveSimulatorMode: simMode,
  };
}

export type RecalcSimulatorBuildArgs = {
  userId: string;
  houseId: string;
  esiid: string | null;
  actualContextHouseId?: string;
  mode: SimulatorMode;
  scenarioId?: string | null;
  weatherPreference?: WeatherPreference;
  persistPastSimBaseline?: boolean;
  validationOnlyDateKeysLocal?: Set<string> | string[];
  preLockboxTravelRanges?: Array<{ startDate: string; endDate: string }>;
  validationDaySelectionMode?: ValidationDaySelectionMode;
  validationDayCount?: number;
  correlationId?: string;
  now?: Date;
  /** Admin calibration lab only (plan §24). */
  adminLabTreatmentMode?: import("@/modules/onePathSim/usageSimulator/adminLabTreatment").AdminLabTreatmentMode;
  runContext?: Partial<PastSimRunContext>;
};

/**
 * Canonical Past Sim recalc entry. Emits structured recalc lifecycle logs (plan §6).
 */
export async function recalcSimulatorBuild(
  args: RecalcSimulatorBuildArgs
): Promise<SimulatorRecalcOk | SimulatorRecalcErr> {
  const correlationId = args.correlationId ?? createSimCorrelationId();
  const scenarioKeyForLog = normalizeScenarioKey(args.scenarioId);
  const scenarioIdForLog = scenarioKeyForLog === "BASELINE" ? null : scenarioKeyForLog;
  const startedAt = Date.now();
  logSimObservabilityEvent({
    stage: "recalc_start",
    correlationId,
    userId: args.userId,
    houseId: args.houseId,
    mode: String(args.mode),
    scenarioId: scenarioIdForLog,
    source: "recalcSimulatorBuild",
  });
  try {
    const result = await recalcSimulatorBuildImpl({ ...args, correlationId });
    const durationMs = Date.now() - startedAt;
    if (result.ok) {
      logSimObservabilityEvent({
        stage: "recalc_success",
        correlationId,
        durationMs,
        userId: args.userId,
        houseId: args.houseId,
        mode: String(args.mode),
        scenarioId: scenarioIdForLog,
        buildInputsHash: result.buildInputsHash,
        source: "recalcSimulatorBuild",
      });
    } else {
      const failureMessage =
        result.missingItems && result.missingItems.length > 0
          ? `${result.error}: ${result.missingItems.join("; ")}`
          : result.error;
      logSimObservabilityEvent({
        stage: "recalc_failure",
        correlationId,
        durationMs,
        userId: args.userId,
        houseId: args.houseId,
        mode: String(args.mode),
        scenarioId: scenarioIdForLog,
        failureCode: result.error,
        failureMessage,
        source: "recalcSimulatorBuild",
      });
    }
    return result;
  } catch (e: unknown) {
    const durationMs = Date.now() - startedAt;
    logSimObservabilityEvent({
      stage: "recalc_failure",
      correlationId,
      durationMs,
      userId: args.userId,
      houseId: args.houseId,
      mode: String(args.mode),
      scenarioId: scenarioIdForLog,
      failureCode: "exception",
      failureMessage: e instanceof Error ? e.message : String(e),
      source: "recalcSimulatorBuild",
    });
    throw e;
  }
}

export type SimulatedUsageHouseRow = {
  houseId: string;
  label: string | null;
  address: { line1: string; city: string | null; state: string | null };
  esiid: string | null;
  dataset: any | null;
  alternatives: { smt: null; greenButton: null };
  datasetError?: {
    code: string;
    explanation: string;
  } | null;
};

function resolveProducerKeepRefDateKeysFromBuildInputs(args: {
  buildInputs: SimulatorBuildInputsV1;
  startDate: string;
  endDate: string;
}): Set<string> {
  const raw = (args.buildInputs as any)?.validationOnlyDateKeysLocal;
  const normalized = new Set<string>();
  if (Array.isArray(raw)) {
    for (const dk of raw) {
      const key = String(dk ?? "").slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(key)) normalized.add(key);
    }
  } else if (raw instanceof Set) {
    for (const dk of Array.from(raw)) {
      const key = String(dk ?? "").slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(key)) normalized.add(key);
    }
  }
  return boundDateKeysToCoverageWindow(normalized, {
    startDate: args.startDate,
    endDate: args.endDate,
  });
}

/**
 * Builds the same Past stitched dataset that production "Past simulated usage" UI uses.
 * Uses actual intervals for the window and simulated fill only for excluded (travel/vacant) days.
 * Single canonical source for lab parity: lab must call this (not buildSimulatedUsageDatasetFromBuildInputs).
 */
export async function getPastSimulatedDatasetForHouse(args: {
  userId: string;
  houseId: string;
  /** Optional shared actual-context source house; defaults to houseId. */
  actualContextHouseId?: string;
  esiid: string | null;
  travelRanges: Array<{ startDate: string; endDate: string }>;
  buildInputs: SimulatorBuildInputsV1;
  startDate: string;
  endDate: string;
  /** When set, excluded days use weekday/weekend avg from UsageShapeProfile (local timezone). */
  timezone?: string;
  /** Optional producer mode; default stays on shared recalc producer path. */
  buildPathKind?: "cold_build" | "recalc" | "lab_validation";
  /** Optional local test-day keys kept in reference pool while modeled outputs are emitted. */
  forceModeledOutputKeepReferencePoolDateKeysLocal?: Set<string>;
  /** Explicit caller intent; defaults true to preserve current behavior. */
  includeSimulatedDayResults?: boolean;
  /** Observability: threaded into `simulatePastUsageDataset` when set (cold build trace alignment). */
  correlationId?: string;
}): Promise<
  | {
      dataset: Awaited<ReturnType<typeof buildSimulatedUsageDatasetFromCurve>>;
      simulatedDayResults?: SimulatedDayResult[];
      actualWxByDateKey?: Map<string, { tAvgF: number; tMinF: number; tMaxF: number; hdd65: number; cdd65: number; source?: string }>;
      error?: undefined;
    }
  | { dataset: null; error: string }
> {
  const {
    userId,
    houseId,
    actualContextHouseId,
    esiid,
    travelRanges,
    buildInputs,
    startDate,
    endDate,
    timezone,
    buildPathKind = "recalc",
    forceModeledOutputKeepReferencePoolDateKeysLocal,
    includeSimulatedDayResults = true,
    correlationId,
  } = args;
  const normalizedBuildPathKind = normalizePastProducerBuildPathKind(buildPathKind);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return { dataset: null, error: "Invalid startDate or endDate (expect YYYY-MM-DD)." };
  }
  try {
    const result = await simulatePastUsageDataset({
      houseId,
      actualContextHouseId,
      userId,
      esiid,
      startDate,
      endDate,
      timezone,
      travelRanges,
      buildInputs,
      buildPathKind: normalizedBuildPathKind,
      forceModeledOutputKeepReferencePoolDateKeysLocal,
      includeSimulatedDayResults,
      correlationId,
    });
    if (result.dataset === null) {
      return { dataset: null, error: (result as { error: string }).error ?? "simulatePastUsageDataset failed" };
    }
    const dataset = result.dataset;
    // Keep cold build on the stitched saved artifact only; no second overlay pass.
    const selectedWeatherByDateKey = result.selectedWeatherByDateKey ?? result.actualWxByDateKey;
    if (dataset && selectedWeatherByDateKey && selectedWeatherByDateKey.size > 0) {
      (dataset as any).dailyWeather = Object.fromEntries(
        Array.from(selectedWeatherByDateKey.entries()).map(([dateKey, w]) => [
          dateKey,
          {
            tAvgF: w.tAvgF,
            tMinF: w.tMinF,
            tMaxF: w.tMaxF,
            hdd65: w.hdd65,
            cdd65: w.cdd65,
            source: String(w?.source ?? "").trim() || "unknown",
          },
        ])
      );
    }
    return { dataset, simulatedDayResults: result.simulatedDayResults, actualWxByDateKey: selectedWeatherByDateKey };
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    console.warn("[usageSimulator/service] getPastSimulatedDatasetForHouse failed", { houseId, err: e });
    return { dataset: null, error: err.message };
  }
}

export async function getSimulatedUsageForUser(args: {
  userId: string;
}): Promise<{ ok: true; houses: SimulatedUsageHouseRow[] } | { ok: false; error: string }> {
  try {
    const houses = await listHouseAddressesForUser({ userId: args.userId });

    const results: SimulatedUsageHouseRow[] = [];
    for (let i = 0; i < houses.length; i++) {
      const h = houses[i];
      const buildRec = await (prisma as any).usageSimulatorBuild
        .findUnique({
          where: { userId_houseId_scenarioKey: { userId: args.userId, houseId: h.id, scenarioKey: "BASELINE" } },
          select: { buildInputs: true, buildInputsHash: true, lastBuiltAt: true },
        })
        .catch(() => null);

      let dataset: any | null = null;
      let datasetError: { code: string; explanation: string } | null = null;
      if (buildRec?.buildInputs) {
        try {
          const buildInputs = buildRec.buildInputs as SimulatorBuildInputsV1;
          const mode = (buildInputs as any).mode;
          const actualSource = (buildInputs as any)?.snapshots?.actualSource ?? null;
          const useActualBaseline =
            mode === "SMT_BASELINE" &&
            (actualSource === "SMT" || actualSource === "GREEN_BUTTON");

          if (useActualBaseline) {
            const actualResult = await getActualUsageDatasetForHouse(h.id, h.esiid ?? null);
            if (actualResult?.dataset) {
              const filledSet = new Set<string>(((buildInputs as any).filledMonths ?? []).map(String));
              const monthProvenanceByMonth: Record<string, "ACTUAL" | "SIMULATED"> = {};
              const canonicalMonths = (buildInputs as any).canonicalMonths ?? [];
              for (const ym of canonicalMonths) {
                monthProvenanceByMonth[String(ym)] =
                  !filledSet.has(String(ym)) ? "ACTUAL" : "SIMULATED";
              }
              const actualSummary = actualResult.dataset.summary ?? {};
              dataset = {
                ...actualResult.dataset,
                summary: {
                  ...actualSummary,
                  source: "SIMULATED" as const,
                },
                meta: {
                  buildInputsHash: String(buildRec.buildInputsHash ?? ""),
                  lastBuiltAt: buildRec.lastBuiltAt ? new Date(buildRec.lastBuiltAt).toISOString() : null,
                  datasetKind: "SIMULATED" as const,
                  monthProvenanceByMonth,
                  actualSource,
                },
              };
              // Keep actual monthly as source of truth so simulation page Usage matches Usage dashboard.
              // Do not overwrite with build's curve-based monthly (ensureBaselineMonthlyFromBuild).
            }
          }
          if (!dataset) {
            dataset = buildSimulatedUsageDatasetFromBuildInputs(buildInputs);
            const monthProvenanceByMonth: Record<string, "ACTUAL" | "SIMULATED"> = {};
            // This branch always returns simulated data (built curve); mark all months as SIMULATED for correct provenance.
            for (const ym of (buildInputs as any).canonicalMonths ?? []) {
              monthProvenanceByMonth[String(ym)] = "SIMULATED";
            }
            dataset.meta = {
              ...(dataset.meta ?? {}),
              buildInputsHash: String(buildRec.buildInputsHash ?? ""),
              lastBuiltAt: buildRec.lastBuiltAt ? new Date(buildRec.lastBuiltAt).toISOString() : null,
              monthProvenanceByMonth,
              actualSource: (buildInputs as any)?.snapshots?.actualSource ?? null,
            };
          }
        } catch (error) {
          const classification = classifySimulationFailure({
            code: "INTERNAL_ERROR",
            message: String((error as any)?.message ?? "simulated dataset build failed"),
          });
          if (classification.shouldAlert) {
            await recordSimulationDataAlert({
              source: "USER_SIMULATION",
              userId: args.userId,
              houseId: h.id,
              houseLabel: toPublicHouseLabel({
                label: h.label,
                addressLine1: h.addressLine1,
                fallbackId: h.id,
              }),
              reasonCode: classification.reasonCode,
              reasonMessage: classification.reasonMessage,
              missingData: classification.missingData,
              context: { stage: "getSimulatedUsageForUser" },
            });
          }
          datasetError = {
            code: "SIM_BUILD_FAILED",
            explanation:
              "We could not rebuild this simulated dataset because required inputs were unavailable or invalid.",
          };
          dataset = null;
        }
      }

      if (dataset && Array.isArray(dataset.daily) && dataset.daily.length > 0 && !dataset.dailyWeather) {
        try {
          const dateKeys = dataset.daily.map((d: { date: string }) => d.date);
          const wxMap = await getHouseWeatherDays({
            houseId: h.id,
            dateKeys,
            kind: "ACTUAL_LAST_YEAR",
          });
          if (wxMap.size > 0) {
            (dataset as any).dailyWeather = Object.fromEntries(
              Array.from(wxMap.entries()).map(([dateKey, w]) => [
                dateKey,
                { tAvgF: w.tAvgF, tMinF: w.tMinF, tMaxF: w.tMaxF, hdd65: w.hdd65, cdd65: w.cdd65 },
              ])
            );
          }
        } catch {
          // optional: leave dailyWeather unset
        }
      }

      results.push({
        houseId: h.id,
        label: toPublicHouseLabel({
          label: h.label,
          addressLine1: h.addressLine1,
          fallbackId: h.id,
        }),
        address: { line1: h.addressLine1, city: h.addressCity, state: h.addressState },
        esiid: h.esiid,
        dataset,
        alternatives: { smt: null, greenButton: null },
        datasetError,
      });
    }

    return { ok: true, houses: results };
  } catch (e) {
    console.error("[usageSimulator/service] getSimulatedUsageForUser failed", e);
    return { ok: false, error: "Internal error" };
  }
}

export async function getSimulatedUsageForHouseScenario(args: {
  userId: string;
  houseId: string;
  scenarioId?: string | null;
  readMode?: "artifact_only" | "allow_rebuild";
  /** Optional exact artifact identity hash to read (skip recomputing request hash). */
  exactArtifactInputHash?: string | null;
  /** If true with exactArtifactInputHash, do not fallback to latest-by-scenario on miss. */
  requireExactArtifactMatch?: boolean;
  forceRebuildArtifact?: boolean;
  projectionMode?: "baseline" | "raw";
  /** Observability: plan §6 (Slice 2). */
  correlationId?: string;
  readContext?: Partial<PastSimReadContext>;
}): Promise<
  | { ok: true; houseId: string; scenarioKey: string; scenarioId: string | null; dataset: any }
  | {
      ok: false;
      code:
        | "NO_BUILD"
        | "SCENARIO_NOT_FOUND"
        | "HOUSE_NOT_FOUND"
        | "INTERNAL_ERROR"
        | "ARTIFACT_MISSING"
        | "COMPARE_TRUTH_INCOMPLETE";
      message: string;
      inputHash?: string;
      engineVersion?: string;
      missingCanonicalDateKeysLocal?: string[];
    }
> {
  // Canonical simulated read family for user/admin consumers.
  // Gap-Fill accuracy must derive simulated truth from this same saved scenario/artifact family
  // (and /api/user/usage/simulated/house), then apply projection-only filtering.
  try {
    const scenarioKey = normalizeScenarioKey(args.scenarioId);
    const scenarioId = scenarioKey === "BASELINE" ? null : scenarioKey;
    const correlationId = args.correlationId ?? createSimCorrelationId();
    const attachCompareWithObservability = (projectedBaselineAware: any) => {
      const compareStartedAt = Date.now();
      logSimPipelineEvent("compareProjection_start", {
        correlationId,
        houseId: args.houseId,
        scenarioKey,
        scenarioId,
        memoryRssMb: getMemoryRssMb(),
        source: "getSimulatedUsageForHouseScenario",
      });
      try {
        const out = attachValidationCompareProjection(projectedBaselineAware);
        logSimPipelineEvent("compareProjection_success", {
          correlationId,
          houseId: args.houseId,
          scenarioKey,
          scenarioId,
          durationMs: Date.now() - compareStartedAt,
          memoryRssMb: getMemoryRssMb(),
          source: "getSimulatedUsageForHouseScenario",
        });
        return out;
      } catch (e) {
        logSimPipelineEvent("compareProjection_failure", {
          correlationId,
          houseId: args.houseId,
          scenarioKey,
          scenarioId,
          durationMs: Date.now() - compareStartedAt,
          failureMessage: e instanceof Error ? e.message : String(e),
          memoryRssMb: getMemoryRssMb(),
          source: "getSimulatedUsageForHouseScenario",
        });
        throw e;
      }
    };
    const readMode = args.readMode ?? "allow_rebuild";
    const forceRebuildArtifact = args.forceRebuildArtifact === true;
    const projectionMode = args.projectionMode ?? "baseline";
    const readContext = buildPastSimReadContext({
      artifactReadMode: args.readContext?.artifactReadMode ?? readMode,
      projectionMode: args.readContext?.projectionMode ?? projectionMode,
      compareSidecarRequest: args.readContext?.compareSidecarRequest ?? true,
      displayFormattingFlags: args.readContext?.displayFormattingFlags,
    });

    const house = await getHouseAddressForUserHouse({ userId: args.userId, houseId: args.houseId });
    if (!house) return { ok: false, code: "HOUSE_NOT_FOUND", message: "House not found for user" };

    if (readContext.artifactReadMode === "artifact_only") {
      const scenarioIdForCache = scenarioId ?? "BASELINE";
      // Backward-compatible artifact-only support for gapfill_lab, which does not have a usageSimulatorBuild row.
      if (scenarioIdForCache === "gapfill_lab") {
        const requestedHash =
          typeof args.exactArtifactInputHash === "string" && args.exactArtifactInputHash.trim()
            ? args.exactArtifactInputHash.trim()
            : null;
        if (!requestedHash) {
          return {
            ok: false,
            code: "ARTIFACT_MISSING",
            message:
              "gapfill_lab artifact_only reads require exactArtifactInputHash (provable Past cache identity).",
            engineVersion: PAST_ENGINE_VERSION,
          };
        }
        const exactCached = await getCachedPastDataset({
          houseId: args.houseId,
          scenarioId: scenarioIdForCache,
          inputHash: requestedHash,
        });
        if (!exactCached || exactCached.intervalsCodec !== INTERVAL_CODEC_V1) {
          return {
            ok: false,
            code: "ARTIFACT_MISSING",
            message: "Persisted artifact not found for this house/scenario/input hash.",
            inputHash: requestedHash,
            engineVersion: PAST_ENGINE_VERSION,
          };
        }
        const decoded = decodeIntervalsV1(exactCached.intervalsCompressed);
        const restored = {
          ...exactCached.datasetJson,
          series: {
            ...(typeof (exactCached.datasetJson as any).series === "object" &&
            (exactCached.datasetJson as any).series !== null
              ? (exactCached.datasetJson as any).series
              : {}),
            intervals15: decoded,
          },
        };
        reconcileRestoredPastDatasetFromDecodedIntervals({
          dataset: restored,
          decodedIntervals: decoded,
          fallbackEndDate: String((exactCached.datasetJson as any)?.summary?.end ?? "").slice(0, 10),
        });
        const restoredAny = restored as any;
        if (!restoredAny.meta || typeof restoredAny.meta !== "object") restoredAny.meta = {};
        restoredAny.meta.artifactReadMode = "artifact_only";
        restoredAny.meta.artifactSource = "past_cache";
        restoredAny.meta.artifactInputHash = exactCached.inputHash;
        restoredAny.meta.artifactUpdatedAt = exactCached.updatedAt ? exactCached.updatedAt.toISOString() : null;
        restoredAny.meta.artifactRecomputed = false;
        restoredAny.meta.artifactScenarioId = scenarioIdForCache;
        restoredAny.meta.requestedInputHash = requestedHash;
        restoredAny.meta.artifactInputHashUsed = exactCached.inputHash;
        restoredAny.meta.artifactHashMatch = String(exactCached.inputHash ?? "") === String(requestedHash);
        restoredAny.meta.artifactSourceMode = "exact_hash_match";
        restoredAny.meta.artifactCreatedAt = null;
        restoredAny.meta.artifactSourceNote = "Artifact source: exact identity match on Past input hash (gapfill_lab).";
        applyCanonicalCoverageMetadataForNonBaseline(restoredAny, scenarioKey);
        const quality = validateSharedSimQuality(restored);
        if (!quality.ok) {
          await reportSimulationDataIssue({
            source: "GAPFILL_LAB",
            userId: args.userId,
            houseId: args.houseId,
            scenarioId,
            code: "INTERNAL_ERROR",
            message: quality.message,
            context: { readMode: "artifact_only" },
          });
              return { ok: false, code: "INTERNAL_ERROR", message: quality.message };
        }
        const projectedBaselineAware =
          readContext.projectionMode === "baseline"
            ? projectBaselineFromCanonicalDataset(
                restored,
                String((restored as any)?.meta?.timezone ?? "America/Chicago"),
                await getValidationActualDailyByDateForDataset({
                  dataset: restored,
                  fallbackHouseId: args.houseId,
                  fallbackEsiid: house.esiid ?? null,
                })
              )
            : restored;
        if (!restoredAny.meta || typeof restoredAny.meta !== "object") restoredAny.meta = {};
        (restoredAny.meta as any).lockboxReadContext = readContext;
        const projected = readContext.compareSidecarRequest
          ? attachCompareWithObservability(projectedBaselineAware)
          : projectedBaselineAware;
        return { ok: true, houseId: args.houseId, scenarioKey, scenarioId, dataset: projected };
      }

      const buildRec = await (prisma as any).usageSimulatorBuild
        .findUnique({
          where: { userId_houseId_scenarioKey: { userId: args.userId, houseId: args.houseId, scenarioKey } },
          select: { buildInputs: true },
        })
        .catch(() => null);
      if (!buildRec?.buildInputs) {
        return {
          ok: false,
          code: "ARTIFACT_MISSING",
          message: "Persisted artifact not found for this house/scenario identity. Run explicit rebuild first.",
          engineVersion: PAST_ENGINE_VERSION,
        };
      }

      const buildInputs = normalizeLegacyWeatherEfficiencyBuildInputs(
        buildRec.buildInputs as Record<string, unknown>
      );
      const window = resolveWindowFromBuildInputsForPastIdentity(buildInputs);
      if (!window) {
        return {
          ok: false,
          code: "ARTIFACT_MISSING",
          message: "Persisted artifact identity window is unavailable for this house/scenario.",
          engineVersion: PAST_ENGINE_VERSION,
        };
      }
      const travelRanges = (Array.isArray((buildInputs as any)?.travelRanges) ? (buildInputs as any).travelRanges : []) as Array<{ startDate: string; endDate: string }>;
      const timezone = String((buildInputs as any)?.timezone ?? "America/Chicago");
      const sharedCoverageWindow = resolveCanonicalUsage365CoverageWindow();
      const canonicalActualIdentity = await resolveCanonicalActualIdentityForBuild({
        userId: args.userId,
        requestHouseId: args.houseId,
        requestHouseEsiid: house.esiid ?? null,
        buildInputs,
      });
      const requestedExactArtifactInputHash =
        typeof args.exactArtifactInputHash === "string" && args.exactArtifactInputHash.trim()
          ? args.exactArtifactInputHash.trim()
          : null;
      const requireExactArtifactMatch = args.requireExactArtifactMatch === true;
      let resolvedInputHash = requestedExactArtifactInputHash ?? "";
      if (!resolvedInputHash) {
        const intervalDataFingerprint = await getIntervalDataFingerprint({
          houseId: canonicalActualIdentity.houseId,
          esiid: canonicalActualIdentity.esiid,
          startDate: window.startDate,
          endDate: window.endDate,
        });
        const usageShapeProfileIdentity = await getUsageShapeProfileIdentityForPast(args.houseId);
        const weatherIdentity = await computePastWeatherIdentity({
          houseId: canonicalActualIdentity.houseId,
          startDate: window.startDate,
          endDate: window.endDate,
          weatherLogicMode: resolveWeatherLogicModeFromBuildInputs(buildInputs as Record<string, unknown>),
        });
        resolvedInputHash = computePastInputHash({
          engineVersion: PAST_ENGINE_VERSION,
          windowStartUtc: window.startDate,
          windowEndUtc: window.endDate,
          timezone,
          travelRanges,
          buildInputs: buildInputs as Record<string, unknown>,
          intervalDataFingerprint,
          usageShapeProfileId: usageShapeProfileIdentity.usageShapeProfileId,
          usageShapeProfileVersion: usageShapeProfileIdentity.usageShapeProfileVersion,
          usageShapeProfileDerivedAt: usageShapeProfileIdentity.usageShapeProfileDerivedAt,
          usageShapeProfileSimHash: usageShapeProfileIdentity.usageShapeProfileSimHash,
          weatherIdentity,
        });
      }

      let exactCached = await getCachedPastDataset({
        houseId: args.houseId,
        scenarioId: scenarioIdForCache,
        inputHash: resolvedInputHash,
      });
      const exactCachedLegacyWeatherActivation =
        !!exactCached && hasLegacyWeatherEfficiencySimulationActivation(exactCached.datasetJson);
      if (exactCachedLegacyWeatherActivation) exactCached = null;
      if (exactCached && exactCached.intervalsCodec === INTERVAL_CODEC_V1) {
        logSimPipelineEvent("artifact_cache_hit", {
          correlationId,
          houseId: args.houseId,
          scenarioId: scenarioIdForCache,
          inputHash: resolvedInputHash,
          artifactInputHash: String((exactCached as any).inputHash ?? ""),
          source: "getSimulatedUsageForHouseScenario",
        });
      } else {
        logSimPipelineEvent("artifact_cache_miss", {
          correlationId,
          houseId: args.houseId,
          scenarioId: scenarioIdForCache,
          inputHash: resolvedInputHash,
          source: "getSimulatedUsageForHouseScenario",
        });
      }
      if ((!exactCached || exactCached.intervalsCodec !== INTERVAL_CODEC_V1) && requestedExactArtifactInputHash && requireExactArtifactMatch) {
        return {
          ok: false,
          code: "ARTIFACT_MISSING",
          message:
            exactCachedLegacyWeatherActivation
              ? "Exact persisted artifact was written during the reverted weather-efficiency simulation activation window. Re-run canonical recalc."
              : "Exact persisted artifact not found for this house/scenario/input hash. Re-run canonical recalc.",
          inputHash: resolvedInputHash,
          engineVersion: PAST_ENGINE_VERSION,
        };
      }
      const artifactSourceMode: "exact_hash_match" = "exact_hash_match";
      if (!exactCached || exactCached.intervalsCodec !== INTERVAL_CODEC_V1) {
        return {
          ok: false,
          code: "ARTIFACT_MISSING",
          message: "Persisted artifact not found for this house/scenario identity. Run explicit rebuild first.",
          inputHash: resolvedInputHash,
          engineVersion: PAST_ENGINE_VERSION,
        };
      }
      const decoded = decodeIntervalsV1(exactCached.intervalsCompressed);
      const restored = {
        ...exactCached.datasetJson,
        series: {
          ...(typeof (exactCached.datasetJson as any).series === "object" &&
          (exactCached.datasetJson as any).series !== null
            ? (exactCached.datasetJson as any).series
            : {}),
          intervals15: decoded,
        },
      };
      reconcileRestoredPastDatasetFromDecodedIntervals({
        dataset: restored,
        decodedIntervals: decoded,
        fallbackEndDate: window.endDate,
      });
      const restoredAny = restored as any;
      if (!restoredAny.meta || typeof restoredAny.meta !== "object") restoredAny.meta = {};
      restoredAny.meta.artifactReadMode = "artifact_only";
      restoredAny.meta.artifactSource = "past_cache";
      restoredAny.meta.artifactInputHash = (exactCached as any).inputHash ?? resolvedInputHash;
      restoredAny.meta.artifactRecomputed = false;
      restoredAny.meta.artifactScenarioId = scenarioIdForCache;
      restoredAny.meta.requestedInputHash = resolvedInputHash;
      restoredAny.meta.artifactInputHashUsed = (exactCached as any).inputHash ?? resolvedInputHash;
      restoredAny.meta.artifactHashMatch =
        String(restoredAny.meta.artifactInputHashUsed ?? "") === String(resolvedInputHash ?? "");
      restoredAny.meta.artifactSourceMode = artifactSourceMode;
      restoredAny.meta.artifactCreatedAt = null;
      // best-effort propagation; present when coming from latest-by-scenario helper
      if ((exactCached as any).updatedAt instanceof Date) {
        restoredAny.meta.artifactUpdatedAt = (exactCached as any).updatedAt.toISOString();
      }
      restoredAny.meta.artifactSourceNote = "Artifact source: exact identity match on Past input hash.";
      applyCanonicalCoverageMetadataForNonBaseline(restoredAny, scenarioKey, {
        buildInputs,
        coverageWindow: sharedCoverageWindow,
      });
      await attachSelectedDailyWeatherForDataset({
        dataset: restored,
        buildInputs,
        fallbackHouseId: args.houseId,
        fallbackTimezone: String((buildInputs as any)?.timezone ?? "America/Chicago"),
        scope: scenarioKey === "BASELINE" ? "baseline_passthrough_or_lookup" : "trusted_simulation_output",
      });
      const quality = validateSharedSimQuality(restored);
      if (!quality.ok) {
        await reportSimulationDataIssue({
          source: "USER_SIMULATION",
          userId: args.userId,
          houseId: args.houseId,
          scenarioId,
          code: "INTERNAL_ERROR",
          message: quality.message,
          context: { readMode: readContext.artifactReadMode },
        });
        return { ok: false, code: "INTERNAL_ERROR", message: quality.message };
      }
      rehydrateValidationCompareMetaFromBuildInputsForRead({ dataset: restored, buildInputs });
      const projectedBaselineAware =
        readContext.projectionMode === "baseline"
          ? projectBaselineFromCanonicalDataset(
              restored,
              String((buildInputs as any)?.timezone ?? "America/Chicago"),
              await getValidationActualDailyByDateForDataset({
                dataset: restored,
                fallbackHouseId: args.houseId,
                fallbackEsiid: house.esiid ?? null,
              })
            )
          : restored;
      (restoredAny.meta as any).lockboxReadContext = readContext;
      const projected = readContext.compareSidecarRequest
        ? attachCompareWithObservability(projectedBaselineAware)
        : projectedBaselineAware;
      return { ok: true, houseId: args.houseId, scenarioKey, scenarioId, dataset: projected };
    }

    let scenarioRow: { id: string; name: string } | null = null;
    if (scenarioId) {
      scenarioRow = await (prisma as any).usageSimulatorScenario
        .findFirst({
          where: { id: scenarioId, userId: args.userId, houseId: args.houseId, archivedAt: null },
          select: { id: true, name: true },
        })
        .catch(() => null);
      if (!scenarioRow) return { ok: false, code: "SCENARIO_NOT_FOUND", message: "Scenario not found for user/house" };
    }

    // Future always recomputed from current Past (or Baseline when no Past): no cache. Every time Future is opened we recalc so it uses the latest Past curve.
    const isFutureScenarioForRecalc = Boolean(scenarioId) && scenarioRow?.name === WORKSPACE_FUTURE_NAME;
    if (isFutureScenarioForRecalc) {
      const baselineBuild = await (prisma as any).usageSimulatorBuild
        .findUnique({
          where: { userId_houseId_scenarioKey: { userId: args.userId, houseId: args.houseId, scenarioKey: "BASELINE" } },
          select: { buildInputs: true },
        })
        .catch(() => null);
      let mode = (baselineBuild?.buildInputs as any)?.mode;
      let weatherPreference = (baselineBuild?.buildInputs as any)?.weatherPreference ?? "NONE";
      if (!mode) {
        const existingFuture = await (prisma as any).usageSimulatorBuild
          .findUnique({
            where: { userId_houseId_scenarioKey: { userId: args.userId, houseId: args.houseId, scenarioKey } },
            select: { buildInputs: true },
          })
          .catch(() => null);
        mode = (existingFuture?.buildInputs as any)?.mode;
        if ((existingFuture?.buildInputs as any)?.weatherPreference != null) weatherPreference = (existingFuture.buildInputs as any).weatherPreference;
      }
      if (mode) {
        const recalcResult = await recalcSimulatorBuild({
          userId: args.userId,
          houseId: args.houseId,
          esiid: house.esiid ?? null,
          mode,
          scenarioId,
          weatherPreference,
          runContext: {
            callerLabel: "user_future_refresh",
            buildPathKind: "recalc",
            persistRequested: false,
          },
        });
        if (!recalcResult.ok) {
          return {
            ok: false,
            code: "INTERNAL_ERROR",
            message: recalcResult.error ?? "Failed to update Future from latest Past.",
          };
        }
      }
    }

    let buildRec = await (prisma as any).usageSimulatorBuild
      .findUnique({
        where: { userId_houseId_scenarioKey: { userId: args.userId, houseId: args.houseId, scenarioKey } },
        select: { buildInputs: true, buildInputsHash: true, lastBuiltAt: true },
      })
      .catch(() => null);
    if (!buildRec?.buildInputs) {
      return { ok: false, code: "NO_BUILD", message: "Recalculate to generate this scenario." };
    }

    let buildInputs = normalizeLegacyWeatherEfficiencyBuildInputs(
      buildRec.buildInputs as SimulatorBuildInputsV1 & Record<string, unknown>
    ) as SimulatorBuildInputsV1;
    let effectiveBuildInputsHash = String(buildRec.buildInputsHash ?? "");
    // Backfill validation-day compare support on first read for older Past builds
    // that predate validation-key persistence.
    const buildValidationKeys = Array.isArray((buildInputs as any)?.validationOnlyDateKeysLocal)
      ? ((buildInputs as any).validationOnlyDateKeysLocal as unknown[])
          .map((v) => String(v ?? "").slice(0, 10))
          .filter((dk) => /^\d{4}-\d{2}-\d{2}$/.test(dk))
      : [];
    const isPastScenarioForValidationBackfill =
      Boolean(scenarioId) &&
      scenarioRow?.name === WORKSPACE_PAST_NAME &&
      String((buildInputs as any)?.mode ?? "") === "SMT_BASELINE" &&
      buildValidationKeys.length === 0;
    if (isPastScenarioForValidationBackfill) {
      const weatherPreferenceRaw = String((buildInputs as any)?.weatherPreference ?? "NONE");
      const weatherPreference: WeatherPreference =
        weatherPreferenceRaw === "NONE" ||
        weatherPreferenceRaw === "LAST_YEAR_WEATHER" ||
        weatherPreferenceRaw === "LONG_TERM_AVERAGE"
          ? (weatherPreferenceRaw as WeatherPreference)
          : "NONE";
      const defaultValidationMode = await getUserDefaultValidationSelectionMode();
      const backfillRecalc = await recalcSimulatorBuild({
        userId: args.userId,
        houseId: args.houseId,
        esiid: house.esiid ?? null,
        mode: "SMT_BASELINE",
        scenarioId,
        weatherPreference,
        persistPastSimBaseline: true,
        validationDaySelectionMode: defaultValidationMode,
        validationDayCount: 21,
        runContext: {
          callerLabel: "validation_backfill",
          buildPathKind: "recalc",
          persistRequested: true,
        },
      });
      if (!backfillRecalc.ok) {
        return {
          ok: false,
          code: "INTERNAL_ERROR",
          message: backfillRecalc.error ?? "Failed to backfill validation-day compare for Past scenario.",
        };
      }
      buildRec = await (prisma as any).usageSimulatorBuild
        .findUnique({
          where: { userId_houseId_scenarioKey: { userId: args.userId, houseId: args.houseId, scenarioKey } },
          select: { buildInputs: true, buildInputsHash: true, lastBuiltAt: true },
        })
        .catch(() => null);
      if (!buildRec?.buildInputs) {
        return { ok: false, code: "NO_BUILD", message: "Recalculate to generate this scenario." };
      }
      buildInputs = normalizeLegacyWeatherEfficiencyBuildInputs(
        buildRec.buildInputs as SimulatorBuildInputsV1 & Record<string, unknown>
      ) as SimulatorBuildInputsV1;
    }
    const mode = (buildInputs as any).mode;
    const timezone = String((buildInputs as any)?.timezone ?? "").trim();
    const actualSource = (buildInputs as any)?.snapshots?.actualSource ?? null;
    const snapshotScenarioName = String((buildInputs as any)?.snapshots?.scenario?.name ?? "");
    const isSmtBaselineMode = mode === "SMT_BASELINE";
    const isFutureWorkspaceScenario =
      Boolean(scenarioId) &&
      (scenarioRow?.name === WORKSPACE_FUTURE_NAME || snapshotScenarioName === WORKSPACE_FUTURE_NAME);
    // Treat any non-baseline, non-future scenario as Past to avoid brittle name-only gating.
    const isPastScenario = Boolean(scenarioId) && !isFutureWorkspaceScenario;
    if (isPastScenario) {
      const liveScenarioEvents = await (prisma as any).usageSimulatorScenarioEvent
        .findMany({
          where: { scenarioId },
          select: { id: true, effectiveMonth: true, kind: true, payloadJson: true },
          orderBy: [{ effectiveMonth: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        })
        .catch(() => []);
      const liveTravelRanges = normalizeScenarioTravelRanges(liveScenarioEvents as any);
      const storedTravelRanges = normalizePreLockboxTravelRanges((buildInputs as any)?.travelRanges);
      if (serializeTravelRangesForIdentity(storedTravelRanges) !== serializeTravelRangesForIdentity(liveTravelRanges)) {
        const existingSnapshots =
          (buildInputs as any)?.snapshots && typeof (buildInputs as any).snapshots === "object"
            ? ((buildInputs as any).snapshots as Record<string, unknown>)
            : {};
        buildInputs = {
          ...buildInputs,
          travelRanges: liveTravelRanges,
          snapshots: {
            ...existingSnapshots,
            scenario: scenarioRow ? { id: scenarioRow.id, name: scenarioRow.name } : existingSnapshots.scenario ?? null,
            scenarioEvents: liveScenarioEvents,
          },
        } as SimulatorBuildInputsV1;
        effectiveBuildInputsHash = computeBuildInputsHash({
          canonicalMonths: Array.isArray((buildInputs as any)?.canonicalMonths)
            ? ((buildInputs as any).canonicalMonths as string[])
            : [],
          mode: String((buildInputs as any)?.mode ?? ""),
          baseKind: String((buildInputs as any)?.baseKind ?? ""),
          scenarioKey,
          baseScenarioKey: null,
          scenarioEvents: buildScenarioEventsHashRows(liveScenarioEvents as any),
          weatherPreference: String((buildInputs as any)?.weatherPreference ?? ""),
          versions: (buildInputs as any)?.versions,
        });
      }
    }
    const useActualBaseline =
      scenarioKey === "BASELINE" &&
      isSmtBaselineMode;

    // Backfill house weather for the usage window (e.g. 366 days) when missing; runs on every simulated fetch.
    const canonicalMonthsForWx = (buildInputs as any).canonicalMonths ?? [];
    const windowForWx = canonicalMonthsForWx.length > 0 ? canonicalWindowDateRange(canonicalMonthsForWx) : null;
    if (windowForWx?.start && windowForWx?.end) {
      const weatherLogicModeForPrefetch = resolveWeatherLogicModeFromBuildInputs(buildInputs as Record<string, unknown>);
      if (weatherLogicModeForPrefetch === "LONG_TERM_AVERAGE_WEATHER") {
        ensureHouseWeatherNormalAvgBackfill({
          houseId: args.houseId,
          dateKeys: localDateKeysInRange(windowForWx.start, windowForWx.end, timezone ?? "America/Chicago"),
        }).catch(() => {});
      } else {
        ensureHouseWeatherBackfill({
          houseId: args.houseId,
          startDate: windowForWx.start,
          endDate: windowForWx.end,
          timezone: timezone ?? undefined,
        }).catch(() => {});
      }
    }

    let dataset: any;
    if (useActualBaseline) {
      const actualResult = await getActualUsageDatasetForHouse(args.houseId, house.esiid ?? null);
      if (actualResult?.dataset) {
        const filledSet = new Set<string>(((buildInputs as any).filledMonths ?? []).map(String));
        const monthProvenanceByMonth: Record<string, "ACTUAL" | "SIMULATED"> = {};
        const canonicalMonths = (buildInputs as any).canonicalMonths ?? [];
        for (const ym of canonicalMonths) {
          monthProvenanceByMonth[String(ym)] = !filledSet.has(String(ym)) ? "ACTUAL" : "SIMULATED";
        }
        const actualSummary = actualResult.dataset.summary ?? {};
        const summarySource = actualSummary.source === "SMT" || actualSummary.source === "GREEN_BUTTON" ? actualSummary.source : (actualSource === "SMT" || actualSource === "GREEN_BUTTON" ? actualSource : "SIMULATED");
        dataset = {
          ...actualResult.dataset,
          summary: {
            ...actualSummary,
            source: summarySource as "SMT" | "GREEN_BUTTON" | "SIMULATED",
          },
          meta: {
            buildInputsHash: effectiveBuildInputsHash,
            lastBuiltAt: buildRec.lastBuiltAt ? new Date(buildRec.lastBuiltAt).toISOString() : null,
            datasetKind: summarySource === "SIMULATED" ? ("SIMULATED" as const) : ("ACTUAL" as const),
            scenarioKey,
            scenarioId,
            monthProvenanceByMonth,
            actualSource,
          },
        };
        // Keep actual monthly as source of truth so simulation page Usage matches Usage dashboard.
        // Do not call ensureBaselineMonthlyFromBuild when we have actual data.
      } else {
        // Actual fetch failed; for SMT_BASELINE BASELINE, use filledSet: unfilled ACTUAL, filled SIMULATED (aligns with else-branch).
        dataset = buildSimulatedUsageDatasetFromBuildInputs(buildInputs);
        const filledSet = new Set<string>(((buildInputs as any).filledMonths ?? []).map(String));
        const monthProvenanceByMonth: Record<string, "ACTUAL" | "SIMULATED"> = {};
        for (const ym of (buildInputs as any).canonicalMonths ?? []) {
          monthProvenanceByMonth[String(ym)] =
            mode === "SMT_BASELINE" && scenarioKey === "BASELINE" && !filledSet.has(String(ym)) ? "ACTUAL" : "SIMULATED";
        }
        dataset.meta = {
          ...(dataset.meta ?? {}),
          buildInputsHash: effectiveBuildInputsHash,
          lastBuiltAt: buildRec.lastBuiltAt ? new Date(buildRec.lastBuiltAt).toISOString() : null,
          scenarioKey,
          scenarioId,
          monthProvenanceByMonth,
          actualSource,
        };
      }
    } else {
      const pastSimulatedList = (buildInputs as any).pastSimulatedMonths;
      // Never return raw actual for Past + SMT/GB so completeActualIntervalsV1 always runs (Travel/Vacant + missing intervals fill).
      const pastHasNoEvents =
        isPastScenario &&
        (pastSimulatedList == null || !Array.isArray(pastSimulatedList) || pastSimulatedList.length === 0) &&
        !isSmtBaselineMode;
      if (pastHasNoEvents) {
        const actualResult = await getActualUsageDatasetForHouse(args.houseId, house.esiid ?? null, {
          skipFullYearIntervalFetch: true,
        });
        if (actualResult?.dataset) {
          const filledSet = new Set<string>(((buildInputs as any).filledMonths ?? []).map(String));
          const monthProvenanceByMonth: Record<string, "ACTUAL" | "SIMULATED"> = {};
          for (const ym of (buildInputs as any).canonicalMonths ?? []) {
            monthProvenanceByMonth[String(ym)] = !filledSet.has(String(ym)) ? "ACTUAL" : "SIMULATED";
          }
          const actualSummary = actualResult.dataset.summary ?? {};
          const summarySource = actualSummary.source === "SMT" || actualSummary.source === "GREEN_BUTTON" ? actualSummary.source : (actualSource === "SMT" || actualSource === "GREEN_BUTTON" ? actualSource : "SIMULATED");
          dataset = {
            ...actualResult.dataset,
            summary: {
              ...actualSummary,
              source: summarySource as "SMT" | "GREEN_BUTTON" | "SIMULATED",
            },
            meta: {
              buildInputsHash: String(buildRec.buildInputsHash ?? ""),
              lastBuiltAt: buildRec.lastBuiltAt ? new Date(buildRec.lastBuiltAt).toISOString() : null,
              datasetKind: summarySource === "SIMULATED" ? ("SIMULATED" as const) : ("ACTUAL" as const),
              scenarioKey,
              scenarioId,
              monthProvenanceByMonth,
              actualSource,
            },
          };
          ensureBaselineMonthlyFromBuild(dataset, buildInputs);
        }
      }
      // Build through the shared producer when the authoritative runtime path owns truth there.
      const shouldUseSharedProducerRead =
        !dataset &&
        (mode === "MANUAL_TOTALS" || (isPastScenario && isSmtBaselineMode));
      if (shouldUseSharedProducerRead) {
        // Use buildInputs.canonicalMonths for window so we avoid getActualUsageDatasetForHouse (and its full-year
        // getActualIntervalsForRange) before the cache check. One full-year fetch in getPastSimulatedDatasetForHouse is enough.
        let canonicalMonths = (buildInputs as any).canonicalMonths ?? [];
        let canonicalEndMonthForMeta = buildInputs.canonicalEndMonth;
        let periodsForStitch: Array<{ id: string; startDate: string; endDate: string }> | undefined =
          Array.isArray((buildInputs as any).canonicalPeriods) &&
          (buildInputs as any).canonicalPeriods.length > 0
            ? ((buildInputs as any).canonicalPeriods as Array<{ id?: string; startDate?: string; endDate?: string }>)
                .map((p, idx) => ({
                  id: String(p?.id ?? `p${idx + 1}`),
                  startDate: String(p?.startDate ?? "").slice(0, 10),
                  endDate: String(p?.endDate ?? "").slice(0, 10),
                }))
                .filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.startDate) && /^\d{4}-\d{2}-\d{2}$/.test(p.endDate))
            : undefined;
        if (canonicalMonths.length === 0 && scenarioKey !== "BASELINE") {
          const baselineBuild = await (prisma as any).usageSimulatorBuild
            .findUnique({
              where: { userId_houseId_scenarioKey: { userId: args.userId, houseId: args.houseId, scenarioKey: "BASELINE" } },
              select: { buildInputs: true },
            })
            .catch(() => null);
          const baselineInputs = baselineBuild?.buildInputs as any;
          if (Array.isArray(baselineInputs?.canonicalMonths) && baselineInputs.canonicalMonths.length > 0) {
            canonicalMonths = baselineInputs.canonicalMonths;
            if (typeof baselineInputs.canonicalEndMonth === "string") {
              canonicalEndMonthForMeta = baselineInputs.canonicalEndMonth;
            }
          }
        }
        if (canonicalMonths.length === 0) {
          try {
            const actualResult = await getActualUsageDatasetForHouse(args.houseId, house.esiid ?? null, { skipFullYearIntervalFetch: true });
            const summaryStart = String(actualResult?.dataset?.summary?.start ?? "").slice(0, 10);
            const summaryEnd = String(actualResult?.dataset?.summary?.end ?? "").slice(0, 10);
            if (/^\d{4}-\d{2}-\d{2}$/.test(summaryStart) && /^\d{4}-\d{2}-\d{2}$/.test(summaryEnd)) {
              periodsForStitch = [{ id: "anchor", startDate: summaryStart, endDate: summaryEnd }];
            }
            const actualMonths = Array.isArray(actualResult?.dataset?.monthly)
              ? (actualResult!.dataset.monthly as Array<{ month?: string }>)
                  .map((m) => String(m?.month ?? "").trim())
                  .filter((ym) => /^\d{4}-\d{2}$/.test(ym))
              : [];
            if (actualMonths.length > 0) {
              canonicalMonths = Array.from(new Set(actualMonths)).sort((a, b) => (a < b ? -1 : 1));
              canonicalEndMonthForMeta = canonicalMonths[canonicalMonths.length - 1] ?? canonicalEndMonthForMeta;
            }
          } catch {
            /* keep canonicalMonths from build or baseline */
          }
        }
        const window = canonicalWindowDateRange(canonicalMonths);
        const parityWindow = resolveSharedPastRecalcWindow({
          mode: mode === "MANUAL_TOTALS" ? "MANUAL_TOTALS" : "SMT_BASELINE",
          canonicalMonths,
          smtAnchorPeriods: periodsForStitch,
        });
        const startDate = parityWindow.startDate ?? periodsForStitch?.[0]?.startDate ?? window?.start;
        const endDate = parityWindow.endDate ?? periodsForStitch?.[periodsForStitch.length - 1]?.endDate ?? window?.end;
        const pastWindowDiag = {
          canonicalMonthsLen: canonicalMonths.length,
          firstMonth: canonicalMonths[0] ?? null,
          lastMonth: canonicalMonths.length > 0 ? canonicalMonths[canonicalMonths.length - 1] ?? null : null,
          windowStartUtc: startDate ?? null,
          windowEndUtc: endDate ?? null,
          sourceOfWindow: parityWindow.source,
        };
        if (startDate && endDate) {
          const travelRanges = ((buildInputs as any).travelRanges ?? []) as Array<{ startDate: string; endDate: string }>;
          const timezone = (buildInputs as any).timezone ?? "America/Chicago";
          const usageShapeProfileIdentity = await getUsageShapeProfileIdentityForPast(args.houseId);
          const sourceHouseIdForWeather = String((buildInputs as any)?.actualContextHouseId ?? args.houseId);
          const weatherIdentity = await computePastWeatherIdentity({
            houseId: sourceHouseIdForWeather,
            startDate,
            endDate,
            weatherLogicMode: resolveWeatherLogicModeFromBuildInputs(buildInputs as Record<string, unknown>),
          });
          const intervalDataFingerprint = await getIntervalDataFingerprint({
            houseId: args.houseId,
            esiid: house.esiid ?? null,
            startDate,
            endDate,
          });
          const inputHash = computePastInputHash({
            engineVersion: PAST_ENGINE_VERSION,
            windowStartUtc: startDate,
            windowEndUtc: endDate,
            timezone,
            travelRanges,
            buildInputs: buildInputs as Record<string, unknown>,
            intervalDataFingerprint,
            usageShapeProfileId: usageShapeProfileIdentity.usageShapeProfileId,
            usageShapeProfileVersion: usageShapeProfileIdentity.usageShapeProfileVersion,
            usageShapeProfileDerivedAt: usageShapeProfileIdentity.usageShapeProfileDerivedAt,
            usageShapeProfileSimHash: usageShapeProfileIdentity.usageShapeProfileSimHash,
            weatherIdentity,
          });
          const scenarioIdForCache = scenarioId ?? "BASELINE";
          const cacheKeyDiag = {
            inputHash,
            engineVersion: PAST_ENGINE_VERSION,
            intervalDataFingerprint,
            usageShapeProfileId: usageShapeProfileIdentity.usageShapeProfileId,
            usageShapeProfileVersion: usageShapeProfileIdentity.usageShapeProfileVersion,
            scenarioId: scenarioIdForCache,
          };
          const cached = forceRebuildArtifact
            ? null
            : await getCachedPastDataset({
                houseId: args.houseId,
                scenarioId: scenarioIdForCache,
                inputHash,
              });
          const usableCached =
            cached && !hasLegacyWeatherEfficiencySimulationActivation(cached.datasetJson) ? cached : null;
          if (usableCached && usableCached.intervalsCodec === INTERVAL_CODEC_V1) {
            const decoded = decodeIntervalsV1(usableCached.intervalsCompressed);
            const restored = {
              ...usableCached.datasetJson,
              series: {
                ...(typeof (usableCached.datasetJson as any).series === "object" && (usableCached.datasetJson as any).series !== null
                  ? (usableCached.datasetJson as any).series
                  : {}),
                intervals15: decoded,
              },
            };
            dataset = restored;
            reconcileRestoredPastDatasetFromDecodedIntervals({
              dataset,
              decodedIntervals: decoded,
              fallbackEndDate: endDate,
            });
            // Keep cache restore on the saved stitched artifact only; no second overlay pass.
            if (!dataset.meta || typeof dataset.meta !== "object") (dataset as any).meta = {};
            (dataset.meta as any).pastWindowDiag = pastWindowDiag;
            (dataset.meta as any).pastBuildIntervalsFetchCount = 0;
            (dataset.meta as any).cacheKeyDiag = cacheKeyDiag;
            (dataset.meta as any).sourceOfDaySimulationCore = SOURCE_OF_DAY_SIMULATION_CORE;
            (dataset.meta as any).buildPathKind = "cache_restore";
            (dataset.meta as any).artifactReadMode = "allow_rebuild";
            (dataset.meta as any).artifactSource = "past_cache";
            (dataset.meta as any).artifactInputHash = inputHash;
            (dataset.meta as any).artifactInputHashUsed = inputHash;
            (dataset.meta as any).requestedInputHash = inputHash;
            (dataset.meta as any).artifactHashMatch = true;
            (dataset.meta as any).artifactScenarioId = scenarioIdForCache;
            (dataset.meta as any).artifactSourceMode = "exact_hash_match";
            (dataset.meta as any).artifactSourceNote = "Artifact source: exact identity match on Past input hash.";
            (dataset.meta as any).artifactRecomputed = false;
            if ((dataset.meta as any).weatherSourceSummary == null || (dataset.meta as any).weatherSourceSummary === "") {
              (dataset.meta as any).weatherSourceSummary = "unknown";
            }
            if ((dataset.meta as any).weatherFallbackReason == null || (dataset.meta as any).weatherFallbackReason === "") {
              (dataset.meta as any).weatherFallbackReason =
                (dataset.meta as any).weatherSourceSummary === "actual_only" ? null : "unknown";
            }
            (dataset.meta as any).dailyRowCount = Array.isArray(dataset.daily) ? dataset.daily.length : 0;
            (dataset.meta as any).intervalCount = Array.isArray(dataset?.series?.intervals15) ? dataset.series.intervals15.length : 0;
            (dataset.meta as any).coverageStart = dataset?.summary?.start ?? startDate;
            (dataset.meta as any).coverageEnd = dataset?.summary?.end ?? endDate;
          } else {
            const keepRefDateKeysLocal = resolveProducerKeepRefDateKeysFromBuildInputs({
              buildInputs,
              startDate,
              endDate,
            });
            const pastResult = await getPastSimulatedDatasetForHouse({
              userId: args.userId,
              houseId: args.houseId,
              esiid: house.esiid ?? null,
              travelRanges,
              buildInputs,
              startDate,
              endDate,
              timezone,
              buildPathKind: "recalc",
              forceModeledOutputKeepReferencePoolDateKeysLocal:
                keepRefDateKeysLocal.size > 0 ? keepRefDateKeysLocal : undefined,
              correlationId: args.correlationId,
            });
            if (pastResult.dataset === null) {
              await reportSimulationDataIssue({
                source: scenarioId === "gapfill_lab" ? "GAPFILL_LAB" : "USER_SIMULATION",
                userId: args.userId,
                houseId: args.houseId,
                scenarioId,
                code: "INTERNAL_ERROR",
                message: pastResult.error ?? "past_sim_build_failed",
                context: { stage: "past_sim_build" },
              });
              return {
                ok: false,
                code: "INTERNAL_ERROR",
                message: pastResult.error ?? "past_sim_build_failed",
                inputHash,
                engineVersion: PAST_ENGINE_VERSION,
              };
            }
            dataset = pastResult.dataset;
            if (dataset) {
              if (!dataset.meta || typeof dataset.meta !== "object") (dataset as any).meta = {};
              // Persist canonical shared-window ownership metadata with the rebuilt artifact so
              // later scenario-level fallback compatibility checks can trust the saved fingerprint.
              if (scenarioKey !== "BASELINE") {
                applyCanonicalCoverageMetadataForNonBaseline(dataset, scenarioKey, { buildInputs });
              }
              (dataset.meta as any).pastWindowDiag = pastWindowDiag;
              (dataset.meta as any).pastBuildIntervalsFetchCount = 1;
              (dataset.meta as any).cacheKeyDiag = cacheKeyDiag;
              (dataset.meta as any).sourceOfDaySimulationCore = SOURCE_OF_DAY_SIMULATION_CORE;
              (dataset.meta as any).dailyRowCount = Array.isArray(dataset.daily) ? dataset.daily.length : 0;
              (dataset.meta as any).intervalCount = Array.isArray(dataset?.series?.intervals15) ? dataset.series.intervals15.length : 0;
              (dataset.meta as any).coverageStart = dataset?.summary?.start ?? startDate;
              (dataset.meta as any).coverageEnd = dataset?.summary?.end ?? endDate;
            }
            const intervals15 = Array.isArray(dataset?.series?.intervals15) ? dataset.series.intervals15 : [];
            const { bytes } = encodeIntervalsV1(intervals15);
            const canonicalArtifactSimulatedDayTotalsByDate = readCanonicalArtifactSimulatedDayTotalsByDate(dataset);
            const datasetJsonForStorage = {
              ...dataset,
              canonicalArtifactSimulatedDayTotalsByDate,
              meta: {
                ...((dataset as any)?.meta ?? {}),
                canonicalArtifactSimulatedDayTotalsByDate,
              },
              series: { ...(dataset.series ?? {}), intervals15: [] },
            };
            logSimPipelineEvent("allow_rebuild_artifact_cache_save_start", {
              correlationId: args.correlationId,
              houseId: args.houseId,
              scenarioId,
              artifactInputHash: inputHash,
              intervalCount: intervals15.length,
              source: "getSimulatedUsageForHouseScenario",
              memoryRssMb: getMemoryRssMb(),
            });
            await saveCachedPastDataset({
              houseId: args.houseId,
              scenarioId: scenarioIdForCache,
              inputHash,
              engineVersion: PAST_ENGINE_VERSION,
              windowStartUtc: startDate,
              windowEndUtc: endDate,
              datasetJson: datasetJsonForStorage as Record<string, unknown>,
              intervalsCodec: INTERVAL_CODEC_V1,
              intervalsCompressed: bytes,
            });
            logSimPipelineEvent("allow_rebuild_artifact_cache_save_success", {
              correlationId: args.correlationId,
              houseId: args.houseId,
              scenarioId,
              artifactInputHash: inputHash,
              intervalCount: intervals15.length,
              source: "getSimulatedUsageForHouseScenario",
              memoryRssMb: getMemoryRssMb(),
            });
            cleanupStalePastCacheVariants({
              houseId: args.houseId,
              scenarioId: scenarioIdForCache,
              keepInputHash: inputHash,
            });
            if (!dataset.meta || typeof dataset.meta !== "object") (dataset as any).meta = {};
            (dataset.meta as any).artifactReadMode = "allow_rebuild";
            (dataset.meta as any).artifactSource = "rebuild";
            (dataset.meta as any).artifactInputHash = inputHash;
            (dataset.meta as any).artifactInputHashUsed = inputHash;
            (dataset.meta as any).requestedInputHash = inputHash;
            (dataset.meta as any).artifactHashMatch = true;
            (dataset.meta as any).artifactScenarioId = scenarioIdForCache;
            (dataset.meta as any).artifactSourceMode = "exact_hash_match";
            (dataset.meta as any).artifactSourceNote = "Artifact source: exact identity match on Past input hash.";
            (dataset.meta as any).artifactRecomputed = true;
          }
        }
      }
      if (!dataset && mode === "MANUAL_TOTALS") {
        return {
          ok: false,
          code: "INTERNAL_ERROR",
          message: "manual_monthly_shared_producer_required",
        };
      }
      if (!dataset) {
        dataset = buildSimulatedUsageDatasetFromBuildInputs(buildInputs);
      }
      const filledSet = new Set<string>(((buildInputs as any).filledMonths ?? []).map(String));
      const pastSimulatedSet = new Set<string>((buildInputs as any).pastSimulatedMonths ?? []);
      const travelMonths = monthsIntersectingTravelRanges(
        ((buildInputs as any).canonicalMonths ?? []) as string[],
        ((buildInputs as any).travelRanges ?? []) as Array<{ startDate: string; endDate: string }>
      );
      for (const ym of Array.from(travelMonths)) pastSimulatedSet.delete(ym);
      const monthProvenanceByMonth: Record<string, "ACTUAL" | "SIMULATED"> = {};
      for (const ym of (buildInputs as any).canonicalMonths ?? []) {
        const key = String(ym);
        monthProvenanceByMonth[key] =
          pastSimulatedSet.size > 0 && pastSimulatedSet.has(key)
            ? "SIMULATED"
            : pastSimulatedSet.size > 0
              ? "ACTUAL" // Past stitched: not in pastSimulatedSet = uses actual 15-min intervals
              : scenarioKey === "BASELINE" && !filledSet.has(key)
                ? "ACTUAL"
                : "SIMULATED";
      }
      dataset.meta = {
        ...(dataset.meta ?? {}),
        buildInputsHash: effectiveBuildInputsHash,
        lastBuiltAt: buildRec.lastBuiltAt ? new Date(buildRec.lastBuiltAt).toISOString() : null,
        scenarioKey,
        scenarioId,
        monthProvenanceByMonth,
        actualSource: (buildInputs as any)?.snapshots?.actualSource ?? null,
        manualMonthlyInputState: (buildInputs as any)?.manualMonthlyInputState ?? null,
        sharedProducerPathUsed: (buildInputs as any)?.sharedProducerPathUsed ?? false,
      };
    }

    // Non-baseline scenario metadata window must match the shared Usage dashboard 365-day canonical window.
    if (scenarioKey !== "BASELINE" && dataset?.summary) {
      const canonicalCoverage =
        applyCanonicalCoverageMetadataForNonBaseline(dataset, scenarioKey, { buildInputs }) ??
        resolveCanonicalUsage365CoverageWindow();
      void canonicalCoverage;
    }

    await attachSelectedDailyWeatherForDataset({
      dataset,
      buildInputs: buildInputs as Record<string, unknown>,
      fallbackHouseId: args.houseId,
      fallbackTimezone: String((buildInputs as any)?.timezone ?? "America/Chicago"),
      scope: scenarioKey === "BASELINE" ? "baseline_passthrough_or_lookup" : "trusted_simulation_output",
    });

    // Past and Future baseload come from the built curve (buildSimulatedUsageDatasetFromBuildInputs), which already
    // computes baseload from curve.intervals after overlay/upgrades/vacant fill; no overwrite from actual usage.

    const quality = validateSharedSimQuality(dataset);
    if (!quality.ok) {
      await reportSimulationDataIssue({
        source: scenarioId === "gapfill_lab" ? "GAPFILL_LAB" : "USER_SIMULATION",
        userId: args.userId,
        houseId: args.houseId,
        scenarioId,
        code: "INTERNAL_ERROR",
        message: quality.message,
          context: { readMode: readContext.artifactReadMode },
      });
      return { ok: false, code: "INTERNAL_ERROR", message: quality.message };
    }
    rehydrateValidationCompareMetaFromBuildInputsForRead({ dataset, buildInputs });
    const projectedBaselineAware =
      readContext.projectionMode === "baseline"
        ? projectBaselineFromCanonicalDataset(
            dataset,
            String((buildInputs as any)?.timezone ?? "America/Chicago"),
            await getValidationActualDailyByDateForDataset({
              dataset,
              fallbackHouseId: args.houseId,
              fallbackEsiid: house.esiid ?? null,
            })
          )
        : dataset;
    if (!dataset.meta || typeof dataset.meta !== "object") (dataset as any).meta = {};
    (dataset.meta as any).lockboxReadContext = readContext;
    const projected = readContext.compareSidecarRequest
      ? attachCompareWithObservability(projectedBaselineAware)
      : projectedBaselineAware;
    return { ok: true, houseId: args.houseId, scenarioKey, scenarioId, dataset: projected };
  } catch (e) {
    if (e instanceof CompareTruthIncompleteError) {
      return {
        ok: false,
        code: "COMPARE_TRUTH_INCOMPLETE",
        message: e.message,
        missingCanonicalDateKeysLocal: e.missingDateKeysLocal,
      };
    }
    console.error("[usageSimulator/service] getSimulatedUsageForHouseScenario failed", e);
    return { ok: false, code: "INTERNAL_ERROR", message: "Internal error" };
  }
}

export async function listSimulatedBuildAvailability(args: {
  userId: string;
  houseId: string;
}): Promise<
  | {
      ok: true;
      houseId: string;
      builds: Array<{
        scenarioKey: string;
        scenarioId: string | null;
        scenarioName: string;
        mode: string;
        baseKind: string;
        buildInputsHash: string;
        lastBuiltAt: string | null;
        canonicalEndMonth: string;
        weatherPreference?: string | null;
      }>;
    }
  | { ok: false; error: string }
> {
  const house = await getHouseAddressForUserHouse({ userId: args.userId, houseId: args.houseId }).catch(() => null);
  if (!house) return { ok: false, error: "house_not_found" };

  const rows = await (prisma as any).usageSimulatorBuild
    .findMany({
      where: { userId: args.userId, houseId: args.houseId },
      select: {
        scenarioKey: true,
        mode: true,
        baseKind: true,
        buildInputsHash: true,
        lastBuiltAt: true,
        canonicalEndMonth: true,
        buildInputs: true,
      },
      orderBy: [{ lastBuiltAt: "desc" }, { updatedAt: "desc" }],
    })
    .catch(() => []);

  const scenarioIds = rows.map((r: any) => String(r?.scenarioKey ?? "")).filter((k: string) => k && k !== "BASELINE");
  const scenarioNameById = new Map<string, string>();
  if (scenarioIds.length) {
    const scenRows = await (prisma as any).usageSimulatorScenario
      .findMany({
        where: { id: { in: scenarioIds }, userId: args.userId, houseId: args.houseId },
        select: { id: true, name: true },
      })
      .catch(() => []);
    for (const s of scenRows) scenarioNameById.set(String(s.id), String(s.name ?? ""));
  }

  const builds = rows.map((r: any) => {
    const scenarioKey = String(r?.scenarioKey ?? "BASELINE");
    const scenarioId = scenarioKey === "BASELINE" ? null : scenarioKey;
    return {
      scenarioKey,
      scenarioId,
      scenarioName: scenarioKey === "BASELINE" ? "Baseline" : scenarioNameById.get(scenarioKey) ?? "Scenario",
      mode: String(r?.mode ?? ""),
      baseKind: String(r?.baseKind ?? ""),
      buildInputsHash: String(r?.buildInputsHash ?? ""),
      lastBuiltAt: r?.lastBuiltAt ? new Date(r.lastBuiltAt).toISOString() : null,
      canonicalEndMonth: String(r?.canonicalEndMonth ?? ""),
      weatherPreference: (r as any)?.buildInputs?.weatherPreference ?? null,
    };
  });

  return { ok: true, houseId: args.houseId, builds };
}

function isYearMonth(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}$/.test(s.trim());
}

async function requireHouseForUser(args: { userId: string; houseId: string }) {
  const h = await getHouseAddressForUserHouse({ userId: args.userId, houseId: args.houseId });
  return h ?? null;
}

export async function listScenarios(args: { userId: string; houseId: string }) {
  const house = await requireHouseForUser(args);
  if (!house) return { ok: false as const, error: "house_not_found" };
  const scenarios = await (prisma as any).usageSimulatorScenario
    .findMany({
      where: { userId: args.userId, houseId: args.houseId, archivedAt: null },
      select: { id: true, name: true, createdAt: true, updatedAt: true },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    })
    .catch(() => []);
  return { ok: true as const, scenarios };
}

export async function createScenario(args: { userId: string; houseId: string; name: string }) {
  const house = await requireHouseForUser(args);
  if (!house) return { ok: false as const, error: "house_not_found" };
  const name = String(args.name ?? "").trim();
  if (!name) return { ok: false as const, error: "name_required" };

  const scenario = await (prisma as any).usageSimulatorScenario
    .create({
      data: { userId: args.userId, houseId: args.houseId, name },
      select: { id: true, name: true, createdAt: true, updatedAt: true },
    })
    .catch((e: any) => {
      // Unique constraint on (userId, houseId, name)
      if (String(e?.code ?? "") === "P2002") return null;
      throw e;
    });
  if (!scenario) return { ok: false as const, error: "name_not_unique" };
  return { ok: true as const, scenario };
}

export async function renameScenario(args: { userId: string; houseId: string; scenarioId: string; name: string }) {
  const house = await requireHouseForUser(args);
  if (!house) return { ok: false as const, error: "house_not_found" };
  const name = String(args.name ?? "").trim();
  if (!name) return { ok: false as const, error: "name_required" };

  const existing = await (prisma as any).usageSimulatorScenario
    .findFirst({ where: { id: args.scenarioId, userId: args.userId, houseId: args.houseId, archivedAt: null }, select: { id: true } })
    .catch(() => null);
  if (!existing) return { ok: false as const, error: "scenario_not_found" };

  const scenario = await (prisma as any).usageSimulatorScenario
    .update({
      where: { id: args.scenarioId },
      data: { name },
      select: { id: true, name: true, createdAt: true, updatedAt: true },
    })
    .catch((e: any) => {
      if (String(e?.code ?? "") === "P2002") return null;
      throw e;
    });
  if (!scenario) return { ok: false as const, error: "name_not_unique" };
  return { ok: true as const, scenario };
}

export async function archiveScenario(args: { userId: string; houseId: string; scenarioId: string }) {
  const house = await requireHouseForUser(args);
  if (!house) return { ok: false as const, error: "house_not_found" };

  const existing = await (prisma as any).usageSimulatorScenario
    .findFirst({ where: { id: args.scenarioId, userId: args.userId, houseId: args.houseId, archivedAt: null }, select: { id: true } })
    .catch(() => null);
  if (!existing) return { ok: false as const, error: "scenario_not_found" };

  await (prisma as any).usageSimulatorScenario.update({ where: { id: args.scenarioId }, data: { archivedAt: new Date() } }).catch(() => null);
  return { ok: true as const };
}

function eventSortKey(e: { effectiveMonth: string; kind: string; payloadJson: any; id: string }): string {
  const p = e?.payloadJson ?? {};
  const effectiveDate = typeof p.effectiveDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.effectiveDate) ? p.effectiveDate : null;
  const ym = effectiveDate ? effectiveDate.slice(0, 7) : String(e?.effectiveMonth ?? "");
  return `${ym}-${effectiveDate ?? e?.effectiveMonth ?? ""}-${e?.id ?? ""}`;
}

export async function listScenarioEvents(args: { userId: string; houseId: string; scenarioId: string }) {
  const scenario = await (prisma as any).usageSimulatorScenario
    .findFirst({ where: { id: args.scenarioId, userId: args.userId, houseId: args.houseId, archivedAt: null }, select: { id: true } })
    .catch(() => null);
  if (!scenario) return { ok: false as const, error: "scenario_not_found" };

  const raw = await (prisma as any).usageSimulatorScenarioEvent
    .findMany({
      where: { scenarioId: args.scenarioId },
      select: { id: true, scenarioId: true, effectiveMonth: true, kind: true, payloadJson: true, createdAt: true, updatedAt: true },
      orderBy: [{ effectiveMonth: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    })
    .catch(() => []);
  const events = (raw as any[]).slice().sort((a, b) => eventSortKey(a).localeCompare(eventSortKey(b)));
  return { ok: true as const, events };
}

export async function addScenarioEvent(args: {
  userId: string;
  houseId: string;
  scenarioId: string;
  effectiveMonth: string;
  kind: string;
  payloadJson: any;
}) {
  const scenario = await (prisma as any).usageSimulatorScenario
    .findFirst({ where: { id: args.scenarioId, userId: args.userId, houseId: args.houseId, archivedAt: null }, select: { id: true } })
    .catch(() => null);
  if (!scenario) return { ok: false as const, error: "scenario_not_found" };

  const effectiveMonth = String(args.effectiveMonth ?? "").trim();
  if (!isYearMonth(effectiveMonth)) return { ok: false as const, error: "effectiveMonth_invalid" };

  const kind = String(args.kind ?? "").trim() || "MONTHLY_ADJUSTMENT";
  const payloadJson = args.payloadJson ?? {};

  let event: any = null;
  try {
    const sanitizedPayload =
      payloadJson != null && typeof payloadJson === "object"
        ? JSON.parse(JSON.stringify(payloadJson))
        : {};
    event = await (prisma as any).usageSimulatorScenarioEvent.create({
      data: { scenarioId: args.scenarioId, effectiveMonth, kind, payloadJson: sanitizedPayload },
      select: { id: true, scenarioId: true, effectiveMonth: true, kind: true, payloadJson: true, createdAt: true, updatedAt: true },
    });
  } catch (err) {
    console.error("[usageSimulator] addScenarioEvent create failed", err);
  }
  if (!event) return { ok: false as const, error: "event_create_failed" };
  return { ok: true as const, event };
}

export async function updateScenarioEvent(args: {
  userId: string;
  houseId: string;
  scenarioId: string;
  eventId: string;
  effectiveMonth?: string;
  kind?: string;
  payloadJson?: any;
}) {
  const scenario = await (prisma as any).usageSimulatorScenario
    .findFirst({ where: { id: args.scenarioId, userId: args.userId, houseId: args.houseId, archivedAt: null }, select: { id: true } })
    .catch(() => null);
  if (!scenario) return { ok: false as const, error: "scenario_not_found" };

  const data: any = {};
  if (args.effectiveMonth !== undefined) {
    const effectiveMonth = String(args.effectiveMonth ?? "").trim();
    if (!isYearMonth(effectiveMonth)) return { ok: false as const, error: "effectiveMonth_invalid" };
    data.effectiveMonth = effectiveMonth;
  }
  if (args.kind !== undefined) data.kind = String(args.kind ?? "").trim() || "MONTHLY_ADJUSTMENT";
  if (args.payloadJson !== undefined) data.payloadJson = args.payloadJson ?? {};

  const event = await (prisma as any).usageSimulatorScenarioEvent
    .update({
      where: { id: String(args.eventId ?? "") },
      data,
      select: { id: true, scenarioId: true, effectiveMonth: true, kind: true, payloadJson: true, createdAt: true, updatedAt: true },
    })
    .catch(() => null);
  if (!event || String(event.scenarioId) !== args.scenarioId) return { ok: false as const, error: "event_not_found" };
  return { ok: true as const, event };
}

export async function deleteScenarioEvent(args: { userId: string; houseId: string; scenarioId: string; eventId: string }) {
  const scenario = await (prisma as any).usageSimulatorScenario
    .findFirst({ where: { id: args.scenarioId, userId: args.userId, houseId: args.houseId, archivedAt: null }, select: { id: true } })
    .catch(() => null);
  if (!scenario) return { ok: false as const, error: "scenario_not_found" };

  const event = await (prisma as any).usageSimulatorScenarioEvent
    .delete({ where: { id: String(args.eventId ?? "") }, select: { id: true, scenarioId: true } })
    .catch(() => null);
  if (!event || String(event.scenarioId) !== args.scenarioId) return { ok: false as const, error: "event_not_found" };
  return { ok: true as const };
}

export async function getSimulatorRequirements(args: { userId: string; houseId: string; mode: SimulatorMode; now?: Date }) {
  const house = await getHouseAddressForUserHouse({ userId: args.userId, houseId: args.houseId }).catch(() => null);
  if (!house) return { ok: false as const, error: "house_not_found" };

  const [manualRec, homeRec, applianceRec] = await Promise.all([
    (prisma as any).manualUsageInput
      .findUnique({ where: { userId_houseId: { userId: args.userId, houseId: args.houseId } }, select: { payload: true } })
      .catch(() => null),
    getHomeProfileSimulatedByUserHouse({ userId: args.userId, houseId: args.houseId }),
    getApplianceProfileSimulatedByUserHouse({ userId: args.userId, houseId: args.houseId }),
  ]);

  const manualUsagePayload = (manualRec?.payload as any) ?? null;
  const canonical = canonicalMonthsForRecalc({ mode: args.mode, manualUsagePayload, now: args.now });

  const applianceProfile = normalizeStoredApplianceProfile((applianceRec?.appliancesJson as any) ?? null);
  const homeProfile = homeRec ? { ...homeRec } : null;

  const hasActual = await hasActualIntervals({ houseId: args.houseId, esiid: house.esiid ?? null, canonicalMonths: canonical.months });
  const actualSourceAnchor = await resolveActualUsageSourceAnchor({
    houseId: args.houseId,
    esiid: house.esiid ?? null,
    timezone: "America/Chicago",
  });
  const actualSource = actualSourceAnchor.source;
  const req = computeRequirements(
    { manualUsagePayload: manualUsagePayload as any, homeProfile: homeProfile as any, applianceProfile: applianceProfile as any, hasActualIntervals: hasActual },
    args.mode,
  );

  return {
    ok: true as const,
    canRecalc: req.canRecalc,
    missingItems: req.missingItems,
    hasActualIntervals: hasActual,
    actualSource,
    actualSourceAnchorEndDate: actualSourceAnchor.anchorEndDate,
    smtAnchorEndDate: actualSourceAnchor.smtAnchorEndDate,
    greenButtonAnchorEndDate: actualSourceAnchor.greenButtonAnchorEndDate,
    canonicalEndMonth: canonical.endMonth,
  };
}
