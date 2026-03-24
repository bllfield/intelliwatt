import { prisma } from "@/lib/db";
import { anchorEndDateUtc, monthsEndingAt } from "@/modules/manualUsage/anchor";
import { canonicalWindow12Months } from "@/modules/usageSimulator/canonicalWindow";
import { normalizeStoredApplianceProfile } from "@/modules/applianceProfile/validation";
import { getApplianceProfileSimulatedByUserHouse } from "@/modules/applianceProfile/repo";
import { getHomeProfileSimulatedByUserHouse } from "@/modules/homeProfile/repo";
import { buildSimulatorInputs, travelRangesToExcludeDateKeys, type BaseKind, type BuildMode } from "@/modules/usageSimulator/build";
import { computeRequirements, type SimulatorMode } from "@/modules/usageSimulator/requirements";
import { chooseActualSource, hasActualIntervals } from "@/modules/realUsageAdapter/actual";
import { SMT_SHAPE_DERIVATION_VERSION } from "@/modules/realUsageAdapter/smt";
import { getActualUsageDatasetForHouse, getIntervalDataFingerprint } from "@/lib/usage/actualDatasetForHouse";
import { upsertSimulatedUsageBuckets } from "@/lib/usage/simulatedUsageBuckets";
import {
  buildSimulatedUsageDatasetFromBuildInputs,
  buildSimulatedUsageDatasetFromCurve,
  buildDisplayMonthlyFromIntervalsUtc,
  recomputePastAggregatesFromIntervals,
  type SimulatorBuildInputsV1,
} from "@/modules/usageSimulator/dataset";
import { computeBuildInputsHash } from "@/modules/usageSimulator/hash";
import { resolveWindowFromBuildInputsForPastIdentity } from "@/modules/usageSimulator/windowIdentity";
import { INTRADAY_TEMPLATE_VERSION } from "@/modules/simulatedUsage/intradayTemplates";
import { computeMonthlyOverlay, computePastOverlay, computeFutureOverlay } from "@/modules/usageScenario/overlay";
import { listLedgerRows } from "@/modules/upgradesLedger/repo";
import { buildOrderedLedgerEntriesForOverlay } from "@/modules/upgradesLedger/overlayEntries";
import { getHouseAddressForUserHouse, listHouseAddressesForUser, normalizeScenarioKey, upsertSimulatorBuild } from "@/modules/usageSimulator/repo";
import { getLatestUsageShapeProfile } from "@/modules/usageShapeProfile/repo";
import { saveIntervalSeries15m } from "@/lib/usage/intervalSeriesRepo";
import {
  computePastInputHash,
  getCachedPastDataset,
  getLatestCachedPastDatasetByScenario,
  saveCachedPastDataset,
  PAST_ENGINE_VERSION,
  type CachedPastDataset,
  type CanonicalArtifactSimulatedDayTotalsByDate,
} from "@/modules/usageSimulator/pastCache";
import { encodeIntervalsV1, decodeIntervalsV1, INTERVAL_CODEC_V1 } from "@/modules/usageSimulator/intervalCodec";
import { IntervalSeriesKind } from "@/modules/usageSimulator/kinds";
import { billingPeriodsEndingAt } from "@/modules/manualUsage/billingPeriods";
import { normalizeMonthlyTotals, WEATHER_NORMALIZER_VERSION, type WeatherPreference } from "@/modules/weatherNormalization/normalizer";
import { ensureHouseWeatherStubbed } from "@/modules/weather/stubs";
import { getHouseWeatherDays } from "@/modules/weather/repo";
import { ensureHouseWeatherBackfill } from "@/modules/weather/backfill";
import { SOURCE_OF_DAY_SIMULATION_CORE } from "@/modules/simulatedUsage/pastDaySimulator";
import type { SimulatedDayResult } from "@/modules/simulatedUsage/pastDaySimulatorTypes";
import { canonicalIntervalKey, dateKeyInTimezone } from "@/lib/admin/gapfillLab";
import { computePastWeatherIdentity } from "@/modules/weather/identity";
import { displayProfilesFromModelMeta } from "@/modules/usageSimulator/profileDisplay";
import { classifySimulationFailure, recordSimulationDataAlert } from "@/modules/usageSimulator/simulationDataAlerts";
import {
  simulatePastFullWindowShared,
  simulatePastUsageDataset,
  simulatePastSelectedDaysShared,
  getUsageShapeProfileIdentityForPast,
  loadWeatherForPastWindow,
} from "@/modules/simulatedUsage/simulatePastUsageDataset";
import type { SimulatedCurve } from "@/modules/simulatedUsage/types";
import {
  boundDateKeysToCoverageWindow,
  resolveCanonicalUsage365CoverageWindow,
  resolveReportedCoverageWindow,
} from "@/modules/usageSimulator/metadataWindow";

type ManualUsagePayloadAny = any;

const WORKSPACE_PAST_NAME = "Past (Corrected)";
const WORKSPACE_FUTURE_NAME = "Future (What-if)";
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
  const weatherSourceSummary = String(meta?.weatherSourceSummary ?? "");

  if (dayTotalSource === "fallback_month_avg" || profileReason) {
    return {
      ok: false,
      message:
        "Shared simulation quality guard failed: usage-shape profile is missing/invalid (fallback_month_avg).",
    };
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
  options?: { buildInputs?: unknown }
): { startDate: string; endDate: string } | null {
  if (scenarioKey === "BASELINE" || !dataset?.summary) return null;
  const canonicalCoverage = resolveCanonicalUsage365CoverageWindow();
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
      artifactSourceMode: "exact_hash_match" | "latest_by_scenario_fallback" | null;
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
  const buildInputs = buildRec.buildInputs as SimulatorBuildInputsV1;
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
  const intervalDataFingerprint = await getIntervalDataFingerprint({
    houseId: args.houseId,
    esiid: houseResolved.esiid ?? null,
    startDate: identityWindowResolved.startDate,
    endDate: identityWindowResolved.endDate,
  });
  const usageShapeProfileIdentity = await getUsageShapeProfileIdentityForPast(args.houseId);
  const weatherIdentity = await computePastWeatherIdentity({
    houseId: args.houseId,
    startDate: identityWindowResolved.startDate,
    endDate: identityWindowResolved.endDate,
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
    const pastResult = await simulatePastFullWindowShared({
      userId: args.userId,
      houseId: args.houseId,
      esiid: houseResolved.esiid ?? null,
      travelRanges: buildTravelRanges,
      buildInputs,
      startDate: identityWindowResolved.startDate,
      endDate: identityWindowResolved.endDate,
      timezone,
      buildPathKind: "lab_validation",
      includeSimulatedDayResults: false,
    });
    if (pastResult.simulatedIntervals === null) {
      return {
        ok: false,
        error: "past_rebuild_failed",
        message: pastResult.error ?? "Failed to build shared Past artifact.",
      };
    }
    const intervals15 = (pastResult.simulatedIntervals ?? [])
      .map((row) => ({
        timestamp: String(row?.timestamp ?? ""),
        kwh: Number(row?.kwh) || 0,
      }))
      .filter((row) => row.timestamp.length > 0);
    if (intervals15.length === 0) {
      return {
        ok: false,
        error: "artifact_read_failed",
        message: "Shared Past artifact build completed, but intervals15 are missing.",
      };
    }
    const simulatedDateKeys = boundDateKeysToCoverageWindow(
      new Set<string>(travelRangesToExcludeDateKeys(buildTravelRanges)),
      canonicalCoverage
    );
    const recomputed = recomputePastAggregatesFromIntervals({
      intervals: intervals15,
      curveEndDate: canonicalCoverage.endDate,
      simulatedDateKeys,
    });
    const rebuiltDataset: any = {
      summary: {
        source: "SIMULATED",
        intervalsCount: recomputed.intervalCount,
        totalKwh: recomputed.intervalSumKwh,
        start: canonicalCoverage.startDate,
        end: canonicalCoverage.endDate,
        latest: `${canonicalCoverage.endDate}T23:59:59.999Z`,
      },
      series: {
        intervals15,
        hourly: [],
        daily: recomputed.daily.map((d) => ({ timestamp: `${d.date}T00:00:00.000Z`, kwh: Number(d.kwh) || 0 })),
        monthly: recomputed.monthly.map((m) => ({ timestamp: `${m.month}-01T00:00:00.000Z`, kwh: Number(m.kwh) || 0 })),
        annual: [
          {
            timestamp: `${canonicalCoverage.endDate.slice(0, 4)}-01-01T00:00:00.000Z`,
            kwh: recomputed.monthlySumKwh,
          },
        ],
      },
      daily: recomputed.daily,
      monthly: recomputed.monthly,
      totals: {
        importKwh: recomputed.intervalSumKwh,
        exportKwh: 0,
        netKwh: recomputed.intervalSumKwh,
      },
      insights: {
        stitchedMonth: recomputed.stitchedMonth,
      },
      meta: {
        datasetKind: "SIMULATED",
        baseKind: (buildInputs as any)?.baseKind ?? null,
        mode: (buildInputs as any)?.mode ?? null,
        canonicalEndMonth: (buildInputs as any)?.canonicalEndMonth ?? null,
        notes: Array.isArray((buildInputs as any)?.notes) ? (buildInputs as any).notes : [],
        filledMonths: Array.isArray((buildInputs as any)?.filledMonths) ? (buildInputs as any).filledMonths : [],
        excludedDays: Array.from(simulatedDateKeys).sort(),
        renormalized: false,
        dayTotalSource: "usage_shape_profile",
        usageShapeProfileDiag: { reasonNotUsed: null },
        weatherSourceSummary: String(pastResult.weatherSourceSummary ?? "unknown"),
        weatherKindUsed: pastResult.weatherKindUsed ?? null,
        weatherProviderName: pastResult.weatherProviderName ?? null,
        weatherFallbackReason: pastResult.weatherFallbackReason ?? null,
        sourceOfDaySimulationCore: SOURCE_OF_DAY_SIMULATION_CORE,
        buildPathKind: "lab_validation",
        pastBuildIntervalsFetchCount: 1,
        dailyRowCount: recomputed.daily.length,
        intervalCount: recomputed.intervalCount,
        coverageStart: canonicalCoverage.startDate,
        coverageEnd: canonicalCoverage.endDate,
        // Must match shared Past simulator + compare_core stale guard (`needsRebuildForOldCurveVersion`).
        curveShapingVersion: "shared_curve_v2",
      },
      usageBucketsByMonth: recomputed.usageBucketsByMonth,
    };
    applyCanonicalCoverageMetadataForNonBaseline(rebuiltDataset, "gapfill_lab", { buildInputs });
    const canonicalArtifactSimulatedDayTotalsByDate = attachCanonicalArtifactSimulatedDayTotalsByDate(
      rebuiltDataset,
      timezone
    );
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
        availability?:
          | "available"
          | "not_applicable_scored_actual_days"
          | "missing_expected_reference";
        reasonCode?:
          | "ARTIFACT_SIMULATED_REFERENCE_AVAILABLE"
          | "SCORED_DAYS_USE_ACTUAL_ARTIFACT_ROWS"
          | "ARTIFACT_SIMULATED_REFERENCE_MISSING";
        explanation?: string;
        scope: "scored_test_days_local";
        granularity: "daily_kwh_rounded_2dp";
        parityDisplaySourceUsed?: "canonical_artifact_simulated_day_totals";
        parityDisplayValueKind?: "artifact_simulated_day_total" | "not_applicable_scored_actual_day";
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
  | "build_shared_compare_parity_ready"
  | "build_shared_compare_metrics_ready"
  | "build_shared_compare_compact_compare_core_memory_reduced"
  | "build_shared_compare_response_ready"
  | "build_shared_compare_finalize_start";

function round2Local(n: number) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Sum 15m interval kWh for one local calendar date, then round to 2 dp — same finalization as
 * buildCanonicalArtifactSimulatedDayTotalsByDateFromDataset (interval branch). Used for travel/vacant
 * parity so artifact and fresh sides share one aggregation path and avoid 0.01-ish float drift from
 * mixing meta/daily-rounded totals with raw float sums.
 *
 * Returns `null` when no interval row falls on `dateKey` in `timezone` (missing coverage), so callers
 * can distinguish that from a real zero-kWh day (intervals present that sum to 0).
 */
function canonicalDayKwhFromIntervals15ForLocalDateKey(
  intervals: Array<{ timestamp: string; kwh: number }>,
  timezone: string,
  dateKey: string
): number | null {
  let sum = 0;
  let sawMatchingInterval = false;
  for (const row of intervals) {
    const timestamp = String(row?.timestamp ?? "").trim();
    if (!timestamp) continue;
    if (dateKeyInTimezone(timestamp, timezone) !== dateKey) continue;
    sawMatchingInterval = true;
    sum += Number(row.kwh) || 0;
  }
  if (!sawMatchingInterval) return null;
  return round2Local(sum);
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

/** Meta read scoped to explicit date keys only (compact compare_core: avoid materializing full-year maps). */
function readCanonicalArtifactSimulatedDayTotalsByDateForDateKeys(
  dataset: any,
  dateKeys: Set<string>
): CanonicalArtifactSimulatedDayTotalsByDate {
  const raw =
    (dataset as any)?.meta?.[CANONICAL_ARTIFACT_SIMULATED_DAY_TOTALS_META_KEY] ??
    (dataset as any)?.[CANONICAL_ARTIFACT_SIMULATED_DAY_TOTALS_META_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: CanonicalArtifactSimulatedDayTotalsByDate = {};
  for (const dk of Array.from(dateKeys)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dk)) continue;
    const value = (raw as Record<string, unknown>)[dk];
    if (value === undefined) continue;
    const kwh = Number(value);
    if (!Number.isFinite(kwh)) continue;
    out[dk] = round2Local(kwh);
  }
  return out;
}

/**
 * Same rules as buildCanonicalArtifactSimulatedDayTotalsByDateFromDataset but only materializes totals
 * for `dateKeys` (bounded compare_core — avoids full-year output object + full Map in the interval pass).
 */
function buildBoundedCanonicalArtifactSimulatedDayTotalsFromDatasetForDateKeys(
  dataset: any,
  timezone: string | null | undefined,
  dateKeys: Set<string>
): CanonicalArtifactSimulatedDayTotalsByDate {
  const out: CanonicalArtifactSimulatedDayTotalsByDate = {};
  const dailyRows = Array.isArray((dataset as any)?.daily) ? ((dataset as any).daily as Array<Record<string, unknown>>) : [];
  const simulatedOwnershipDates = new Set<string>(
    String((dataset as any)?.meta?.excludedDateKeysFingerprint ?? "")
      .split(",")
      .map((dk) => String(dk ?? "").trim())
      .filter((dk) => /^\d{4}-\d{2}-\d{2}$/.test(dk))
  );
  for (const row of dailyRows) {
    const dk = String((row as any)?.date ?? "").slice(0, 10);
    const source = String((row as any)?.source ?? "").toUpperCase();
    if (/^\d{4}-\d{2}-\d{2}$/.test(dk) && source === "SIMULATED") simulatedOwnershipDates.add(dk);
  }
  const timezoneResolved = typeof timezone === "string" && timezone.trim().length > 0 ? timezone.trim() : null;
  const intervals15 = Array.isArray((dataset as any)?.series?.intervals15)
    ? ((dataset as any).series.intervals15 as Array<Record<string, unknown>>)
    : [];
  if (timezoneResolved && simulatedOwnershipDates.size > 0 && intervals15.length > 0) {
    const intervalSumsByLocalDate = new Map<string, number>();
    for (const row of intervals15) {
      const timestamp = String((row as any)?.timestamp ?? "").trim();
      if (!timestamp) continue;
      const dk = dateKeyInTimezone(timestamp, timezoneResolved);
      if (!dateKeys.has(dk) || !simulatedOwnershipDates.has(dk)) continue;
      intervalSumsByLocalDate.set(dk, (intervalSumsByLocalDate.get(dk) ?? 0) + (Number((row as any)?.kwh) || 0));
    }
    if (intervalSumsByLocalDate.size > 0) {
      for (const [dk, kwh] of Array.from(intervalSumsByLocalDate.entries())) out[dk] = round2Local(kwh);
      for (const row of dailyRows) {
        const dk = String((row as any)?.date ?? "").slice(0, 10);
        if (!dateKeys.has(dk)) continue;
        const source = String((row as any)?.source ?? "").toUpperCase();
        const kwh = Number((row as any)?.kwh);
        const isSimulatorOwnedDay = source === "SIMULATED" || simulatedOwnershipDates.has(dk);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dk) || !isSimulatorOwnedDay || !Number.isFinite(kwh) || dk in out) continue;
        out[dk] = round2Local(kwh);
      }
      return out;
    }
  }
  for (const row of dailyRows) {
    const dk = String((row as any)?.date ?? "").slice(0, 10);
    if (!dateKeys.has(dk)) continue;
    const source = String((row as any)?.source ?? "").toUpperCase();
    const kwh = Number((row as any)?.kwh);
    const isSimulatorOwnedDay = source === "SIMULATED" || simulatedOwnershipDates.has(dk);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dk) || !isSimulatorOwnedDay || !Number.isFinite(kwh)) continue;
    out[dk] = round2Local(kwh);
  }
  return out;
}

/** Compact compare_core: keep only interval points for local dates needed for bounded canonical + parity (drops full-year decode peak). */
function filterExactParityArtifactIntervalsToCompactDateKeys(
  intervals: Array<{ timestamp: string; kwh: number }>,
  timezone: string,
  dateKeys: Set<string>
): Array<{ timestamp: string; kwh: number }> {
  const out: Array<{ timestamp: string; kwh: number }> = [];
  for (const p of intervals) {
    const ts = canonicalIntervalKey(String(p?.timestamp ?? "").trim());
    if (!ts) continue;
    const dk = dateKeyInTimezone(ts, timezone);
    if (!dateKeys.has(dk)) continue;
    out.push({ timestamp: ts, kwh: Number(p?.kwh) || 0 });
  }
  return out;
}

function buildCanonicalArtifactSimulatedDayTotalsByDateFromDataset(
  dataset: any,
  timezone?: string | null
): CanonicalArtifactSimulatedDayTotalsByDate {
  const out: CanonicalArtifactSimulatedDayTotalsByDate = {};
  const dailyRows = Array.isArray((dataset as any)?.daily) ? ((dataset as any).daily as Array<Record<string, unknown>>) : [];
  const simulatedOwnershipDates = new Set<string>(
    String((dataset as any)?.meta?.excludedDateKeysFingerprint ?? "")
      .split(",")
      .map((dk) => String(dk ?? "").trim())
      .filter((dk) => /^\d{4}-\d{2}-\d{2}$/.test(dk))
  );
  for (const row of dailyRows) {
    const dk = String((row as any)?.date ?? "").slice(0, 10);
    const source = String((row as any)?.source ?? "").toUpperCase();
    if (/^\d{4}-\d{2}-\d{2}$/.test(dk) && source === "SIMULATED") simulatedOwnershipDates.add(dk);
  }
  const timezoneResolved = typeof timezone === "string" && timezone.trim().length > 0 ? timezone.trim() : null;
  const intervals15 = Array.isArray((dataset as any)?.series?.intervals15)
    ? ((dataset as any).series.intervals15 as Array<Record<string, unknown>>)
    : [];
  if (timezoneResolved && simulatedOwnershipDates.size > 0 && intervals15.length > 0) {
    const intervalSumsByLocalDate = new Map<string, number>();
    for (const row of intervals15) {
      const timestamp = String((row as any)?.timestamp ?? "").trim();
      if (!timestamp) continue;
      const dk = dateKeyInTimezone(timestamp, timezoneResolved);
      if (!simulatedOwnershipDates.has(dk)) continue;
      intervalSumsByLocalDate.set(dk, (intervalSumsByLocalDate.get(dk) ?? 0) + (Number((row as any)?.kwh) || 0));
    }
    if (intervalSumsByLocalDate.size > 0) {
      for (const [dk, kwh] of Array.from(intervalSumsByLocalDate.entries())) out[dk] = round2Local(kwh);
      for (const row of dailyRows) {
        const dk = String((row as any)?.date ?? "").slice(0, 10);
        const source = String((row as any)?.source ?? "").toUpperCase();
        const kwh = Number((row as any)?.kwh);
        const isSimulatorOwnedDay = source === "SIMULATED" || simulatedOwnershipDates.has(dk);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dk) || !isSimulatorOwnedDay || !Number.isFinite(kwh) || dk in out) continue;
        out[dk] = round2Local(kwh);
      }
      return out;
    }
  }
  for (const row of dailyRows) {
    const dk = String((row as any)?.date ?? "").slice(0, 10);
    const source = String((row as any)?.source ?? "").toUpperCase();
    const kwh = Number((row as any)?.kwh);
    const isSimulatorOwnedDay = source === "SIMULATED" || simulatedOwnershipDates.has(dk);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dk) || !isSimulatorOwnedDay || !Number.isFinite(kwh)) continue;
    out[dk] = round2Local(kwh);
  }
  return out;
}

function attachCanonicalArtifactSimulatedDayTotalsByDate(
  dataset: any,
  timezone?: string | null
): CanonicalArtifactSimulatedDayTotalsByDate {
  if (!dataset || typeof dataset !== "object") return {};
  if (!(dataset as any).meta || typeof (dataset as any).meta !== "object") (dataset as any).meta = {};
  const existing = readCanonicalArtifactSimulatedDayTotalsByDate(dataset);
  if (Object.keys(existing).length > 0 || CANONICAL_ARTIFACT_SIMULATED_DAY_TOTALS_META_KEY in ((dataset as any).meta ?? {})) {
    (dataset as any).meta[CANONICAL_ARTIFACT_SIMULATED_DAY_TOTALS_META_KEY] = existing;
    (dataset as any)[CANONICAL_ARTIFACT_SIMULATED_DAY_TOTALS_META_KEY] = existing;
    return existing;
  }
  const built = buildCanonicalArtifactSimulatedDayTotalsByDateFromDataset(dataset, timezone);
  (dataset as any).meta[CANONICAL_ARTIFACT_SIMULATED_DAY_TOTALS_META_KEY] = built;
  (dataset as any)[CANONICAL_ARTIFACT_SIMULATED_DAY_TOTALS_META_KEY] = built;
  return built;
}

function restoreCachedArtifactDataset(args: {
  cached: CachedPastDataset;
  useSelectedDaysLightweightArtifactRead: boolean;
  fallbackEndDate: string;
}): {
  dataset: any;
  restoredCanonicalDailyRows: Array<{ date?: string; kwh?: number; source?: string }> | null;
  restoredCanonicalMonthlyRows: Array<{ month?: string; kwh?: number }> | null;
} {
  const { cached, useSelectedDaysLightweightArtifactRead, fallbackEndDate } = args;
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
  if (!useSelectedDaysLightweightArtifactRead) {
    reconcileRestoredDatasetFromDecodedIntervals({
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

function reconcileRestoredDatasetFromDecodedIntervals(args: {
  dataset: any;
  decodedIntervals: Array<{ timestamp: string; kwh: number }>;
  fallbackEndDate: string;
}) {
  const { dataset, decodedIntervals, fallbackEndDate } = args;
  if (!dataset || typeof dataset !== "object" || !Array.isArray(decodedIntervals) || decodedIntervals.length === 0) {
    return;
  }
  const lastDecodedTs = decodedIntervals[decodedIntervals.length - 1]?.timestamp;
  const curveEnd =
    (lastDecodedTs && String(lastDecodedTs).slice(0, 10)) ||
    String((dataset as any)?.summary?.end ?? fallbackEndDate).slice(0, 10);

  const simDateKeys = new Set<string>(
    (Array.isArray((dataset as any)?.daily) ? (dataset as any).daily : [])
      .filter((d: any) => String(d?.source ?? "").toUpperCase() === "SIMULATED")
      .map((d: any) => String(d?.date ?? "").slice(0, 10))
      .filter((dk: string) => /^\d{4}-\d{2}-\d{2}$/.test(dk))
  );
  const recomputed = recomputePastAggregatesFromIntervals({
    intervals: decodedIntervals,
    curveEndDate: curveEnd,
    simulatedDateKeys: simDateKeys,
  });
  (dataset as any).daily = recomputed.daily;
  if (recomputed.monthly.length > 0) {
    (dataset as any).monthly = recomputed.monthly;
    (dataset as any).usageBucketsByMonth = recomputed.usageBucketsByMonth;
  }

  if (!dataset.summary || typeof dataset.summary !== "object") (dataset as any).summary = {};
  (dataset.summary as any).totalKwh = recomputed.intervalSumKwh;
  if ((dataset.summary as any).intervalsCount == null) {
    (dataset.summary as any).intervalsCount = recomputed.intervalCount;
  }
  if (!dataset.totals || typeof dataset.totals !== "object") (dataset as any).totals = {};
  (dataset.totals as any).importKwh = recomputed.intervalSumKwh;
  (dataset.totals as any).netKwh = recomputed.intervalSumKwh;
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
  } = args;
  const reportPhase = async (
    phase: GapfillCompareBuildPhase,
    meta?: Record<string, unknown>
  ) => {
    if (!onPhaseUpdate) return;
    try {
      await onPhaseUpdate(phase, meta);
    } catch {
      // Phase reporting is best-effort observability and must not alter compare behavior.
    }
  };
  // Keep the request flag for backward-compatible payloads, but default compare scoring
  // mode stays selected-days unless the caller explicitly asks for full_window.
  void includeFreshCompareCalc;
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
  const exactTravelParityRequiresIntervalBackedArtifactTruth =
    requireExactArtifactMatch && boundedTravelDateKeysLocal.size > 0;
  if (exactTravelParityRequiresIntervalBackedArtifactTruth) {
    // Exact travel/vacant parity must preserve full-year artifact identity ownership rather than
    // allowing selected-days lightweight reads to change how the artifact is selected.
    useSelectedDaysLightweightArtifactRead = false;
  }
  const boundedTestDateKeysLocal = boundDateKeysToCoverageWindow(testDateKeysLocal, sharedCoverageWindow);
  const travelFingerprint = Array.from(boundedTravelDateKeysLocal).sort().join(",");
  const chartDateKeysLocal = enumerateDateKeysInclusive(canonicalWindow.startDate, canonicalWindow.endDate);
  const travelVacantParityDateKeysLocal = Array.from(boundedTravelDateKeysLocal)
    .filter((dk) => chartDateKeysLocal.has(dk))
    .sort((a, b) => (a < b ? -1 : 1));
  const expectedChartIntervalCount = chartDateKeysLocal.size * 96;

  // Cheap pre-read: if scenario has no artifact rows at all, short-circuit before identity/fingerprint work.
  if (!rebuildArtifact && !autoEnsureArtifact) {
    let latestScenarioArtifact: any;
    try {
      latestScenarioArtifact = await getLatestCachedPastDatasetByScenario({
        houseId,
        scenarioId: pastScenarioId,
      });
    } catch {
      latestScenarioArtifact = undefined;
    }
    if (latestScenarioArtifact === null) {
      return {
        ok: false,
        status: 409,
        body: {
          ok: false,
          error: "artifact_missing_rebuild_required",
          message:
            "No saved shared Past artifact found for this identity. Trigger explicit rebuildArtifact=true before compare.",
          mode: "artifact_only",
          scenarioId: pastScenarioId,
        },
      };
    }
  }

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
   * Intentionally does NOT require `useSelectedDaysLightweightArtifactRead` — that flag is cleared
   * when exact interval-backed travel/vacant parity forces non-lightweight artifact *selection*,
   * but we still skip broad display/monthly materialization in that case (Vercel OOM mitigation).
   */
  const compareCoreMemoryReducedPath =
    selectedDaysLightweightArtifactRead === true &&
    effectiveCompareFreshMode === "selected_days" &&
    !rebuildArtifact &&
    !autoEnsureArtifact &&
    includeDiagnostics !== true &&
    includeFullReportText !== true;
  let sharedInputHash = exactArtifactIdentityRequested ? requestedArtifactInputHash : "";
  if (!useSelectedDaysLightweightArtifactRead && !exactArtifactIdentityRequested) {
    const intervalDataFingerprint = await getIntervalDataFingerprint({
      houseId,
      esiid: houseResolved.esiid ?? null,
      startDate: identityWindowResolved.startDate,
      endDate: identityWindowResolved.endDate,
    });
    const usageShapeProfileIdentity = await getUsageShapeProfileIdentityForPast(houseId);
    const weatherIdentity = await computePastWeatherIdentity({
      houseId,
      startDate: identityWindowResolved.startDate,
      endDate: identityWindowResolved.endDate,
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
    const pastResult = await getPastSimulatedDatasetForHouse({
      userId,
      houseId,
      esiid: houseResolved.esiid ?? null,
      travelRanges: buildTravelRanges,
      buildInputs,
      startDate: identityWindowResolved.startDate,
      endDate: identityWindowResolved.endDate,
      timezone,
      buildPathKind: "lab_validation",
      // Keep inline ensure/rebuild memory-light so compare can finish in one request.
      includeSimulatedDayResults: false,
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
    const canonicalArtifactSimulatedDayTotalsByDate = attachCanonicalArtifactSimulatedDayTotalsByDate(rebuiltDataset, timezone);
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

  let artifactSourceMode: "exact_hash_match" | "latest_by_scenario_fallback" | null =
    rebuildArtifact
      ? null
      : useSelectedDaysLightweightArtifactRead
        ? exactArtifactIdentityRequested
          ? "exact_hash_match"
          : "latest_by_scenario_fallback"
        : "exact_hash_match";
  let artifactFallbackReason: string | null =
    !rebuildArtifact && useSelectedDaysLightweightArtifactRead && !exactArtifactIdentityRequested
      ? "lightweight_compare_without_exact_identity_uses_latest_scenario_artifact"
      : null;
  let cached = !rebuildArtifact
    ? exactArtifactIdentityRequested
      ? await getCachedPastDataset({
          houseId,
          scenarioId: requestedArtifactScenarioId,
          inputHash: requestedArtifactInputHash,
        })
      : useSelectedDaysLightweightArtifactRead
        ? await getLatestCachedPastDatasetByScenario({
            houseId,
            scenarioId: sharedScenarioCacheId,
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
    if (exactArtifactReadRequired) {
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
          requireExactArtifactMatch: true,
          artifactIdentitySource: artifactIdentitySourceNormalized,
          artifactSourceMode: "exact_hash_match",
          fallbackOccurred: false,
          fallbackReason: "requested_exact_identity_not_found",
        },
      };
    }
    cached = await getLatestCachedPastDatasetByScenario({
      houseId,
      scenarioId: sharedScenarioCacheId,
    });
    if (cached) {
      artifactSourceMode = "latest_by_scenario_fallback";
      artifactFallbackReason = "requested_exact_identity_not_found_fell_back_to_latest_by_scenario";
    }
  }
  // If exact identity hash misses, fall back to latest scenario artifact when ownership scope
  // is compatible so compare can read the same shared Past output that rebuild just produced.
  if (!useSelectedDaysLightweightArtifactRead && !rebuildArtifact && (!cached || cached.intervalsCodec !== INTERVAL_CODEC_V1)) {
    const latestCached = await getLatestCachedPastDatasetByScenario({
      houseId,
      scenarioId: sharedScenarioCacheId,
    });
    const latestMeta = (((latestCached as any)?.datasetJson?.meta ?? {}) as Record<string, unknown>) ?? {};
    const latestExcludedFingerprint = String(latestMeta?.excludedDateKeysFingerprint ?? "");
    const latestIsFallbackCompatible =
      latestCached != null &&
      latestCached.intervalsCodec === INTERVAL_CODEC_V1 &&
      latestExcludedFingerprint === travelFingerprint;
    if (latestIsFallbackCompatible) {
      cached = latestCached as any;
      artifactSourceMode = "latest_by_scenario_fallback";
      artifactFallbackReason = "exact_hash_miss_fell_back_to_latest_by_scenario";
    }
  }
  if (cached && cached.intervalsCodec === INTERVAL_CODEC_V1) {
    const restored = restoreCachedArtifactDataset({
      cached,
      useSelectedDaysLightweightArtifactRead,
      fallbackEndDate: identityWindow.endDate,
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
    artifactSourceMode =
      useSelectedDaysLightweightArtifactRead && !exactArtifactIdentityRequested ? null : "exact_hash_match";
    artifactFallbackReason = null;
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
    const excludedFingerprintFromMeta = String(restoredMetaNormalized?.excludedDateKeysFingerprint ?? "")
      .split(",")
      .map((dk) => String(dk).trim())
      .filter((dk) => /^\d{4}-\d{2}-\d{2}$/.test(dk));
    const hasOwnershipScopeMismatch = excludedFingerprintFromMeta.join(",") !== travelFingerprint;
    const shouldAutoRebuildNow =
      autoEnsureArtifact &&
      !artifactAutoRebuilt &&
      (needsRebuildForStaleWindow || needsRebuildForOldCurveVersion || hasOwnershipScopeMismatch);
    if (shouldAutoRebuildNow) {
      const rebuilt = await rebuildSharedArtifactDataset();
      if (!rebuilt.ok) return rebuilt;
      dataset = rebuilt.dataset;
      artifactAutoRebuilt = true;
      artifactSourceMode =
        useSelectedDaysLightweightArtifactRead && !exactArtifactIdentityRequested ? null : "exact_hash_match";
      artifactFallbackReason = null;
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
  const requestedInputHash = exactArtifactIdentityRequested
    ? requestedArtifactInputHash
    : useSelectedDaysLightweightArtifactRead
      ? null
      : sharedInputHash;
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
  modelAssumptions.artifactFallbackOccurred = artifactSourceMode === "latest_by_scenario_fallback";
  modelAssumptions.artifactFallbackReason =
    artifactSourceMode === "latest_by_scenario_fallback" ? artifactFallbackReason : null;
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
    modelAssumptions.artifactSourceNote =
      artifactSourceMode === "exact_hash_match"
        ? "Artifact source: exact identity match on Past input hash."
        : "Artifact source: latest cached Past scenario artifact (fallback from exact hash miss).";
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
  let freshParityIntervals: IntervalPoint[] = [];

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
        includeSimulatedDayResults: false,
      });
      if (freshResult.simulatedIntervals === null) {
        return {
          ok: false as const,
          error:
            freshResult.error ??
            "Fresh shared compare simulation failed before scoring. Retry and rebuild artifact if needed.",
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
        actualWxByDateKey: freshResult.actualWxByDateKey ?? null,
        simulatedIntervals: freshIntervals,
        weatherSourceSummary: String(freshResult.weatherSourceSummary ?? weatherBasisUsed) || "unknown",
      };
    };
    if (effectiveCompareFreshMode === "selected_days") {
      const runSelectedDaysFreshExecution = async (selectedDateKeysLocal: Set<string>) => {
        if (selectedDateKeysLocal.size === 0) {
          return {
            ok: true as const,
            dataset: null,
            simulatedIntervals: [] as Array<{ timestamp: string; kwh: number }>,
            dailyTotalsByDate: new Map<string, number>(),
            weatherSourceSummary: weatherBasisUsed,
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
        });
        if (selectedDaysResult.simulatedIntervals === null) {
          return {
            ok: false as const,
            error:
              selectedDaysResult.error ??
              "Selected-day fresh shared compare simulation failed before scoring. Retry and rebuild artifact if needed.",
          };
        }
        const simulatedIntervalsNormalized = selectedDaysResult.simulatedIntervals.map((p) => ({
          timestamp: canonicalIntervalKey(String(p?.timestamp ?? "").trim()),
          kwh: Number(p?.kwh) || 0,
        }));
        const dailyTotalsByDate = new Map<string, number>();
        const dailyTotalsFromSimulatedDayResults = new Set<string>();
        for (const row of selectedDaysResult.simulatedDayResults ?? []) {
          const dk = String((row as any)?.localDate ?? "").slice(0, 10);
          if (!selectedDateKeysLocal.has(dk)) continue;
          const dayKwh = Number((row as any)?.intervalSumKwh ?? (row as any)?.finalDayKwh);
          if (!Number.isFinite(dayKwh)) continue;
          dailyTotalsByDate.set(dk, round2Local(dayKwh));
          dailyTotalsFromSimulatedDayResults.add(dk);
        }
        if (dailyTotalsByDate.size < selectedDateKeysLocal.size) {
          for (const p of simulatedIntervalsNormalized) {
            const dk = dateKeyInTimezone(p.timestamp, timezone);
            if (!selectedDateKeysLocal.has(dk)) continue;
            // Keep simulator-owned daily totals authoritative when already provided.
            // Interval fallback should only fill dates that were missing day totals.
            if (dailyTotalsFromSimulatedDayResults.has(dk)) continue;
            dailyTotalsByDate.set(dk, (dailyTotalsByDate.get(dk) ?? 0) + (Number(p.kwh) || 0));
          }
          for (const [dk, kwh] of Array.from(dailyTotalsByDate.entries())) {
            dailyTotalsByDate.set(dk, round2Local(kwh));
          }
        }
        return {
          ok: true as const,
          dataset: null,
          simulatedIntervals: simulatedIntervalsNormalized,
          dailyTotalsByDate,
          weatherSourceSummary: String(selectedDaysResult.weatherSourceSummary ?? weatherBasisUsed) || "unknown",
        };
      };
      const selectedTestDaysResult = await runSelectedDaysFreshExecution(boundedTestDateKeysLocal);
      if (!selectedTestDaysResult.ok) {
        return {
          ok: false,
          status: 500,
          body: {
            ok: false,
            error: "fresh_compare_simulation_failed",
            message: selectedTestDaysResult.error,
            mode: "artifact_only",
            scenarioId: sharedScenarioCacheId,
          },
        };
      }
      simulatedTestIntervals = selectedTestDaysResult.simulatedIntervals;
      selectedTestDailyTotalsByDate = selectedTestDaysResult.dailyTotalsByDate;
      const selectedTravelParityResult = await runSelectedDaysFreshExecution(new Set<string>(travelVacantParityDateKeysLocal));
      if (!selectedTravelParityResult.ok) {
        return {
          ok: false,
          status: 500,
          body: {
            ok: false,
            error: "fresh_compare_simulation_failed",
            message: selectedTravelParityResult.error,
            mode: "artifact_only",
            scenarioId: sharedScenarioCacheId,
          },
        };
      }
      freshParityIntervals = selectedTravelParityResult.simulatedIntervals;
      scoringSimulatedSource = "shared_selected_days_simulated_intervals15";
      comparePulledFromSharedArtifactOnly = false;
      compareSimSource = "shared_selected_days_calc";
      compareCalculationScope = "selected_days_shared_path_only";
      compareFreshModeUsed = "selected_days";
      compareSharedCalcPath =
        "simulatePastSelectedDaysShared(buildPastSimulatedBaselineV1->simulatePastDay)->buildGapfillCompareSimShared";
      weatherBasisUsed =
        boundedTestDateKeysLocal.size > 0
          ? selectedTestDaysResult.weatherSourceSummary
          : selectedTravelParityResult.weatherSourceSummary;
      const selectedWeatherRange = Array.from(boundedTestDateKeysLocal).sort();
      if (selectedWeatherRange.length > 0) {
        const selectedDaysWeather = await loadWeatherForPastWindow({
          houseId,
          startDate: selectedWeatherRange[0]!,
          endDate: selectedWeatherRange[selectedWeatherRange.length - 1]!,
          canonicalDateKeys: selectedWeatherRange,
        });
        const selectedDaysWeatherBasisUsed =
          String(selectedDaysWeather.provenance.weatherSourceSummary ?? weatherBasisUsed) || weatherBasisUsed;
        weatherBasisUsed = selectedDaysWeatherBasisUsed;
        const scoredDayWeatherPayload = buildScoredDayWeatherPayload({
          scoredDateKeysLocal: boundedTestDateKeysLocal,
          weatherByDateKey: selectedDaysWeather.actualWxByDateKey,
          weatherBasisUsed: selectedDaysWeatherBasisUsed,
          weatherKindUsed: selectedDaysWeather.provenance.weatherKindUsed ?? null,
          weatherProviderName: selectedDaysWeather.provenance.weatherProviderName ?? null,
          weatherFallbackReason: selectedDaysWeather.provenance.weatherFallbackReason ?? null,
        });
        scoredDayWeatherRows = scoredDayWeatherPayload.rows;
        scoredDayWeatherTruth = scoredDayWeatherPayload.truth;
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
        simulatedTestIntervalsCount: simulatedTestIntervals.length,
        freshParityIntervalsCount: freshParityIntervals.length,
      });
    } else {
      const freshResult = await runFullWindowFreshExecution();
      if (!freshResult.ok) {
        return {
          ok: false,
          status: 500,
          body: {
            ok: false,
            error: "fresh_compare_simulation_failed",
            message:
              freshResult.error,
            mode: "artifact_only",
            scenarioId: sharedScenarioCacheId,
          },
        };
      }
      freshParityIntervals = freshResult.simulatedIntervals;
      simulatedTestIntervals = freshResult.simulatedIntervals.filter((p) =>
        boundedTestDateKeysLocal.has(dateKeyInTimezone(p.timestamp, timezone))
      );
      scoringSimulatedSource = "shared_fresh_simulated_intervals15";
      comparePulledFromSharedArtifactOnly = false;
      compareSimSource = "shared_fresh_calc";
      compareCalculationScope = "full_window_shared_path_then_scored_day_filter";
      compareFreshModeUsed = "full_window";
      compareSharedCalcPath =
        "simulatePastFullWindowShared(buildPastSimulatedBaselineV1->simulatePastDay)->buildGapfillCompareSimShared";
      weatherBasisUsed = freshResult.weatherSourceSummary;
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
  const availableTestDateKeysFromSimulated =
    compareFreshModeUsed === "selected_days" && selectedTestDailyTotalsByDate
      ? new Set<string>(
          Array.from(selectedTestDailyTotalsByDate.keys()).filter((dk) => boundedTestDateKeysLocal.has(dk))
        )
      : new Set<string>(
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
  const compactCanonicalDateKeys = new Set<string>([
    ...Array.from(boundedTestDateKeysLocal),
    ...Array.from(travelVacantParityDateKeysLocal),
  ]);
  if (compareCoreMemoryReducedPath) {
    await reportPhase("compact_pre_bounded_exact_parity_decode_start", {
      exactTravelParityRequiresIntervalBackedArtifactTruth,
      hadSeriesIntervals15InDataset: Boolean(
        Array.isArray((dataset as any)?.series?.intervals15) && (dataset as any).series.intervals15.length > 0
      ),
    });
  }
  const exactParityArtifactIntervalsDecodeBufferOwned =
    exactTravelParityRequiresIntervalBackedArtifactTruth &&
    !(
      Array.isArray((dataset as any)?.series?.intervals15) && (dataset as any).series.intervals15.length > 0
    ) &&
    Boolean(cached?.intervalsCodec === INTERVAL_CODEC_V1);
  let exactParityArtifactIntervals: Array<{ timestamp: string; kwh: number }> =
    exactTravelParityRequiresIntervalBackedArtifactTruth
      ? Array.isArray((dataset as any)?.series?.intervals15) && (dataset as any).series.intervals15.length > 0
        ? ((dataset as any).series.intervals15 as Array<{ timestamp: string; kwh: number }>)
        : cached && cached.intervalsCodec === INTERVAL_CODEC_V1
          ? decodeIntervalsV1(cached.intervalsCompressed)
          : []
      : [];
  if (
    compareCoreMemoryReducedPath &&
    exactTravelParityRequiresIntervalBackedArtifactTruth &&
    exactParityArtifactIntervals.length > 0
  ) {
    exactParityArtifactIntervals = filterExactParityArtifactIntervalsToCompactDateKeys(
      exactParityArtifactIntervals,
      timezone,
      compactCanonicalDateKeys
    );
  }
  if (compareCoreMemoryReducedPath) {
    await reportPhase("compact_pre_bounded_exact_parity_decode_done", {
      exactParityIntervalCount: exactParityArtifactIntervals.length,
      decodeBufferOwned: exactParityArtifactIntervalsDecodeBufferOwned,
    });
  }
  const artifactDatasetForExactParity =
    exactTravelParityRequiresIntervalBackedArtifactTruth && exactParityArtifactIntervals.length > 0
      ? compareCoreMemoryReducedPath
        ? {
            meta: (dataset as any).meta,
            daily: (dataset as any).daily,
            // Compact path: only intervals15 is read by bounded canonical — avoid copying full series (codec refs, etc.).
            series: {
              intervals15: exactParityArtifactIntervals,
            },
          }
        : {
            ...dataset,
            series: {
              ...(typeof (dataset as any)?.series === "object" && (dataset as any).series !== null
                ? (dataset as any).series
                : {}),
              intervals15: exactParityArtifactIntervals,
            },
          }
      : dataset;
  if (compareCoreMemoryReducedPath) {
    await reportPhase("compact_pre_bounded_meta_read_start", {
      boundedTestDateKeyCount: boundedTestDateKeysLocal.size,
    });
  }
  const preservedMetaCanonicalTotals = compareCoreMemoryReducedPath
    ? readCanonicalArtifactSimulatedDayTotalsByDateForDateKeys(dataset, boundedTestDateKeysLocal)
    : readCanonicalArtifactSimulatedDayTotalsByDate(dataset);
  if (compareCoreMemoryReducedPath) {
    await reportPhase("compact_pre_bounded_meta_read_done", {
      preservedMetaCanonicalKeyCount: Object.keys(preservedMetaCanonicalTotals).length,
    });
  }
  if (compareCoreMemoryReducedPath) {
    await reportPhase("compact_pre_bounded_canonical_build_start", {
      usesIntervalBackedDataset: exactTravelParityRequiresIntervalBackedArtifactTruth && exactParityArtifactIntervals.length > 0,
    });
  }
  let canonicalArtifactSimulatedDayTotalsByDate: CanonicalArtifactSimulatedDayTotalsByDate;
  if (compareCoreMemoryReducedPath) {
    if (exactTravelParityRequiresIntervalBackedArtifactTruth && exactParityArtifactIntervals.length > 0) {
      canonicalArtifactSimulatedDayTotalsByDate = buildBoundedCanonicalArtifactSimulatedDayTotalsFromDatasetForDateKeys(
        artifactDatasetForExactParity,
        timezone,
        compactCanonicalDateKeys
      );
    } else {
      canonicalArtifactSimulatedDayTotalsByDate = readCanonicalArtifactSimulatedDayTotalsByDateForDateKeys(
        dataset,
        compactCanonicalDateKeys
      );
    }
  } else {
    canonicalArtifactSimulatedDayTotalsByDate =
      exactTravelParityRequiresIntervalBackedArtifactTruth && exactParityArtifactIntervals.length > 0
        ? buildCanonicalArtifactSimulatedDayTotalsByDateFromDataset(artifactDatasetForExactParity, timezone)
        : readCanonicalArtifactSimulatedDayTotalsByDate(dataset);
  }
  if (compareCoreMemoryReducedPath) {
    await reportPhase("compact_pre_bounded_canonical_build_done", {
      canonicalArtifactKeyCount: Object.keys(canonicalArtifactSimulatedDayTotalsByDate).length,
    });
  }
  // Selected-days scored alignment: buildCanonical… ownership filters can omit non-travel test dates.
  // Backfill each bounded test date from interval truth (exact parity blob or compact-filtered raw series)
  // so reference rows / parityDisplayDailyByDate match fresh selected-day totals on the same keys.
  if (compareCoreMemoryReducedPath) {
    await reportPhase("compact_pre_bounded_merge_backfill_start", {
      mergeBackfillWillRun: useSelectedDaysScopedDisplayRows && boundedTestDateKeysLocal.size > 0,
    });
  }
  if (useSelectedDaysScopedDisplayRows && boundedTestDateKeysLocal.size > 0) {
    const merged: Record<string, number> = { ...(canonicalArtifactSimulatedDayTotalsByDate as Record<string, number>) };
    const intervalSourceForBackfill = (() => {
      if (exactParityArtifactIntervals.length > 0) return exactParityArtifactIntervals;
      if (compareCoreMemoryReducedPath && artifactIntervalsRaw.length > 0) {
        return filterExactParityArtifactIntervalsToCompactDateKeys(
          artifactIntervalsRaw,
          timezone,
          compactCanonicalDateKeys
        );
      }
      return artifactIntervalsRaw;
    })();
    for (const dk of Array.from(boundedTestDateKeysLocal)) {
      const cur = merged[dk];
      if (cur !== undefined && Number.isFinite(Number(cur))) continue;
      // Do not synthesize simulated-day totals from intervals when the artifact daily row for this
      // scored date is ACTUAL — parity stays "not applicable" for those days (see scored-day tests).
      if (daySourceFromDataset.get(dk) === "ACTUAL") continue;
      if (intervalSourceForBackfill.length > 0) {
        const fromIntervals = canonicalDayKwhFromIntervals15ForLocalDateKey(intervalSourceForBackfill, timezone, dk);
        if (fromIntervals !== null) {
          merged[dk] = fromIntervals;
        } else if (preservedMetaCanonicalTotals[dk] !== undefined && Number.isFinite(Number(preservedMetaCanonicalTotals[dk]))) {
          merged[dk] = round2Local(Number(preservedMetaCanonicalTotals[dk]));
        }
      } else if (preservedMetaCanonicalTotals[dk] !== undefined && Number.isFinite(Number(preservedMetaCanonicalTotals[dk]))) {
        merged[dk] = round2Local(Number(preservedMetaCanonicalTotals[dk]));
      }
    }
    canonicalArtifactSimulatedDayTotalsByDate = merged as CanonicalArtifactSimulatedDayTotalsByDate;
  }
  if (compareCoreMemoryReducedPath) {
    await reportPhase("compact_pre_bounded_merge_backfill_done", {
      canonicalArtifactKeyCountAfterMerge: Object.keys(canonicalArtifactSimulatedDayTotalsByDate).length,
    });
  }
  if (compareCoreMemoryReducedPath) {
    await reportPhase("build_shared_compare_compact_bounded_canonical_ready", {
      boundedCanonicalDateCount: Object.keys(canonicalArtifactSimulatedDayTotalsByDate).length,
      selectedDateKeyCount: boundedTestDateKeysLocal.size,
      parityDateKeyCount: travelVacantParityDateKeysLocal.length,
      usedIntervalBackedExactParityTruth:
        exactTravelParityRequiresIntervalBackedArtifactTruth && exactParityArtifactIntervals.length > 0,
    });
  }
  if (compareCoreMemoryReducedPath && exactTravelParityRequiresIntervalBackedArtifactTruth) {
    await reportPhase("compact_pre_bounded_meta_write_start", {
      canonicalArtifactKeyCount: Object.keys(canonicalArtifactSimulatedDayTotalsByDate).length,
    });
  }
  if (exactTravelParityRequiresIntervalBackedArtifactTruth) {
    if (!(dataset as any).meta || typeof (dataset as any).meta !== "object") (dataset as any).meta = {};
    (dataset as any).meta[CANONICAL_ARTIFACT_SIMULATED_DAY_TOTALS_META_KEY] = canonicalArtifactSimulatedDayTotalsByDate;
    (dataset as any)[CANONICAL_ARTIFACT_SIMULATED_DAY_TOTALS_META_KEY] = canonicalArtifactSimulatedDayTotalsByDate;
  }
  if (compareCoreMemoryReducedPath && exactTravelParityRequiresIntervalBackedArtifactTruth) {
    await reportPhase("compact_pre_bounded_meta_write_done", {
      wroteCanonicalIntoDatasetMeta: true,
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

  const freshDailyTotalsByDate =
    compareFreshModeUsed === "selected_days" && selectedTestDailyTotalsByDate
      ? new Map<string, number>(
          Array.from(selectedTestDailyTotalsByDate.entries())
            .filter(([dk]) => boundedTestDateKeysLocal.has(dk))
            .map(([dk, kwh]) => [dk, round2Local(Number(kwh) || 0)] as const)
        )
      : (() => {
          const totals = new Map<string, number>();
          for (const p of simulatedTestIntervals) {
            const dk = dateKeyInTimezone(p.timestamp, timezone);
            if (!boundedTestDateKeysLocal.has(dk)) continue;
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
  const missingDisplaySimDatesBackedByActualArtifactRows: string[] = [];
  const allMismatchDates: string[] = [];
  for (const dk of Array.from(boundedTestDateKeysLocal)) {
    if (!canonicalArtifactDailyByDate.has(dk)) {
      allMissingDisplaySimDates.push(dk);
      if ((simulatedChartDailySourceByDate.get(dk) ?? null) === "ACTUAL") {
        missingDisplaySimDatesBackedByActualArtifactRows.push(dk);
      }
      continue;
    }
    const parityDisplayValue = round2Local(Number(canonicalArtifactDailyByDate.get(dk) ?? 0));
    parityDisplayDailyByDate.set(dk, parityDisplayValue);
    if (round2Local(freshDailyTotalsByDate.get(dk) ?? 0) !== parityDisplayValue) {
      allMismatchDates.push(dk);
    }
  }
  await reportPhase("build_shared_compare_scored_row_alignment_ready", {
    compareFreshModeUsed,
    compareCalculationScope,
    selectedDateKeyCount: boundedTestDateKeysLocal.size,
    selectedDateCount: boundedTestDateKeysLocal.size,
    artifactSimulatedDayReferenceRowCount: artifactSimulatedDayReferenceRows.length,
    comparableDateCount: parityDisplayDailyByDate.size,
    missingDisplaySimCount: allMissingDisplaySimDates.length,
    mismatchCount: allMismatchDates.length,
  });
  const comparableDateCount = Math.max(0, boundedTestDateKeysLocal.size - allMissingDisplaySimDates.length);
  const missingDisplaySimSampleDates = allMissingDisplaySimDates.slice(0, 10);
  const mismatchSampleDates = allMismatchDates.slice(0, 10);
  const parityComparisonBasis:
    | "display_shared_artifact_vs_compare_shared_full_window_then_filter"
    | "display_shared_artifact_vs_compare_artifact_filter_only"
    | "display_shared_artifact_vs_compare_selected_days_fresh_calc"
    | "artifact_simulated_display_rows_vs_compare_selected_days_fresh_calc" =
    compareCalculationScope === "full_window_shared_path_then_scored_day_filter"
      ? "display_shared_artifact_vs_compare_shared_full_window_then_filter"
      : compareCalculationScope === "selected_days_shared_path_only"
        ? "artifact_simulated_display_rows_vs_compare_selected_days_fresh_calc"
        : "display_shared_artifact_vs_compare_artifact_filter_only";
  const scoredDayParityAvailability =
    allMissingDisplaySimDates.length === 0
      ? ("available" as const)
      : compareCalculationScope === "selected_days_shared_path_only" &&
          missingDisplaySimDatesBackedByActualArtifactRows.length === allMissingDisplaySimDates.length
        ? ("not_applicable_scored_actual_days" as const)
        : ("missing_expected_reference" as const);
  const displayVsFreshParityForScoredDays = {
    matches:
      scoredDayParityAvailability === "available"
        ? allMismatchDates.length === 0
        : null,
    mismatchCount: scoredDayParityAvailability === "available" ? allMismatchDates.length : 0,
    mismatchSampleDates: scoredDayParityAvailability === "available" ? mismatchSampleDates : [],
    missingDisplaySimCount:
      scoredDayParityAvailability === "missing_expected_reference" ? allMissingDisplaySimDates.length : 0,
    missingDisplaySimSampleDates:
      scoredDayParityAvailability === "missing_expected_reference" ? missingDisplaySimSampleDates : [],
    comparableDateCount: scoredDayParityAvailability === "available" ? comparableDateCount : 0,
    complete:
      scoredDayParityAvailability === "available"
        ? allMismatchDates.length === 0 && allMissingDisplaySimDates.length === 0
        : null,
    availability: scoredDayParityAvailability,
    reasonCode:
      scoredDayParityAvailability === "available"
        ? ("ARTIFACT_SIMULATED_REFERENCE_AVAILABLE" as const)
        : scoredDayParityAvailability === "not_applicable_scored_actual_days"
          ? ("SCORED_DAYS_USE_ACTUAL_ARTIFACT_ROWS" as const)
          : ("ARTIFACT_SIMULATED_REFERENCE_MISSING" as const),
    explanation:
      scoredDayParityAvailability === "available"
        ? "Artifact-side canonical simulated-day totals are available for scored-day parity."
        : scoredDayParityAvailability === "not_applicable_scored_actual_days"
          ? "Selected scored days are actual artifact rows, so artifact simulated-day parity is not applicable for those dates."
          : "Expected artifact simulated-day references were not available for some scored dates.",
    scope: "scored_test_days_local" as const,
    granularity: "daily_kwh_rounded_2dp" as const,
    parityDisplaySourceUsed: "canonical_artifact_simulated_day_totals" as const,
    parityDisplayValueKind:
      scoredDayParityAvailability === "available"
        ? ("artifact_simulated_day_total" as const)
        : ("not_applicable_scored_actual_day" as const),
    comparisonBasis: parityComparisonBasis,
  };
  await reportPhase("build_shared_compare_scored_row_merge_ready", {
    compareFreshModeUsed,
    compareCalculationScope,
    scoredDayParityAvailability,
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
  // Keep travel/vacant proof on canonical interval-summed day totals so
  // artifact-side and fresh-side parity compare the same aggregation basis.
  const freshParityDailyByDate = (() => {
    const totals = new Map<string, number>();
    for (const p of freshParityIntervals) {
      const dk = dateKeyInTimezone(p.timestamp, timezone);
      totals.set(dk, (totals.get(dk) ?? 0) + (Number(p.kwh) || 0));
    }
    return totals;
  })();
  const useIntervalBackedTravelVacantParityTotals =
    exactParityArtifactIntervals.length > 0 && freshParityIntervals.length > 0;
  travelVacantParityRows = travelVacantParityDateKeysLocal.map((dk) => {
    const artifactCanonicalSimDayKwh = useIntervalBackedTravelVacantParityTotals
      ? canonicalDayKwhFromIntervals15ForLocalDateKey(exactParityArtifactIntervals, timezone, dk)
      : canonicalArtifactDailyByDate.has(dk)
        ? round2Local(Number(canonicalArtifactDailyByDate.get(dk) ?? 0))
        : null;
    const freshSharedDayCalcKwh = useIntervalBackedTravelVacantParityTotals
      ? canonicalDayKwhFromIntervals15ForLocalDateKey(freshParityIntervals, timezone, dk)
      : freshParityDailyByDate.has(dk)
        ? round2Local(Number(freshParityDailyByDate.get(dk) ?? 0))
        : null;
    const parityMatch =
      artifactCanonicalSimDayKwh == null || freshSharedDayCalcKwh == null
        ? null
        : round2Local(artifactCanonicalSimDayKwh) === round2Local(freshSharedDayCalcKwh);
    return {
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
    };
  });
  const travelVacantParityMissingArtifactCount = travelVacantParityRows.filter(
    (row) => row.artifactReferenceAvailability !== "available"
  ).length;
  const travelVacantParityMissingFreshCount = travelVacantParityRows.filter(
    (row) => row.freshCompareAvailability !== "available"
  ).length;
  const travelVacantParityMismatchCount = travelVacantParityRows.filter((row) => row.parityMatch === false).length;
  const travelVacantParityValidatedCount = travelVacantParityRows.filter((row) => row.parityMatch === true).length;
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
  if (compareCoreMemoryReducedPath) {
    if (exactParityArtifactIntervalsDecodeBufferOwned && exactParityArtifactIntervals.length > 0) {
      exactParityArtifactIntervals.length = 0;
    }
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
  const sharedProfiles = displayProfilesFromModelMeta(modelAssumptions);
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
      const legacyBillEndDay = typeof p.billEndDay === "number" && Number.isFinite(p.billEndDay) ? Math.trunc(p.billEndDay) : 15;
      const endMonth = anchorEndDateKey
        ? anchorEndDateKey.slice(0, 7)
        : legacyEndMonth
          ? (anchorEndDateUtc(legacyEndMonth, legacyBillEndDay)?.toISOString().slice(0, 7) ?? legacyEndMonth)
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

export type SimulatorRecalcOk = {
  ok: true;
  houseId: string;
  buildInputsHash: string;
  dataset: any;
};

export type SimulatorRecalcErr = {
  ok: false;
  error: string;
  missingItems?: string[];
};

export async function recalcSimulatorBuild(args: {
  userId: string;
  houseId: string;
  esiid: string | null;
  mode: SimulatorMode;
  scenarioId?: string | null;
  weatherPreference?: WeatherPreference;
  persistPastSimBaseline?: boolean;
  now?: Date;
}): Promise<SimulatorRecalcOk | SimulatorRecalcErr> {
  const { userId, houseId, esiid, mode } = args;
  const scenarioKey = normalizeScenarioKey(args.scenarioId);
  const scenarioId = scenarioKey === "BASELINE" ? null : scenarioKey;

  // Load persisted baseline inputs
  const [manualRec, homeRec, applianceRec] = await Promise.all([
    (prisma as any).manualUsageInput
      .findUnique({ where: { userId_houseId: { userId, houseId } }, select: { payload: true } })
      .catch(() => null),
    getHomeProfileSimulatedByUserHouse({ userId, houseId }),
    getApplianceProfileSimulatedByUserHouse({ userId, houseId }),
  ]);

  const manualUsagePayload = (manualRec?.payload as any) ?? null;
  const canonical = canonicalMonthsForRecalc({ mode, manualUsagePayload, now: args.now });

  const applianceProfile = normalizeStoredApplianceProfile((applianceRec?.appliancesJson as any) ?? null);
  const homeProfile = homeRec ? { ...homeRec } : null;

  const actualOk = await hasActualIntervals({ houseId, esiid: esiid ?? null, canonicalMonths: canonical.months });
  const actualSource = await chooseActualSource({ houseId, esiid: esiid ?? null });

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

  const scenarioTravelRanges = scenarioId ? normalizeScenarioTravelRanges(scenarioEvents as any) : [];

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
      pastTravelRanges = normalizeScenarioTravelRanges(pastEventsForOverlay as any);
    }
  }

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
  if (!req.canRecalc) return { ok: false, error: "requirements_unmet", missingItems: req.missingItems };

  if (!homeProfile) return { ok: false, error: "homeProfile_required" };
  if (!applianceProfile?.fuelConfiguration) return { ok: false, error: "applianceProfile_required" };

  // Enforce mode->baseKind mapping (no mismatches)
  const baseKind = baseKindFromMode(mode);

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
  const built = await buildSimulatorInputs({
    mode: mode as BuildMode,
    manualUsagePayload: manualUsagePayload as any,
    homeProfile: homeProfile as any,
    applianceProfile: applianceProfile as any,
    esiidForSmt: esiid,
    houseIdForActual: houseId,
    baselineHomeProfile: homeProfile,
    baselineApplianceProfile: applianceProfile,
    canonicalMonths: canonicalForBuild.months,
    travelRanges: travelRangesForBuild,
    now: args.now,
  });

  // Safety: built.baseKind must match mode mapping in V1
  if (built.baseKind !== baseKind) {
    return { ok: false, error: "baseKind_mismatch" };
  }

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

  // Month-level uplift for travel exclusions: when travel days exclude usage, uplift remaining days to fill the month.
  // Past SMT patch baseline mode uses day-level patching and must not use month-level travel uplift.
  const allTravelRanges = scenarioId ? [...pastTravelRanges, ...scenarioTravelRanges] : [];
  const isPastSmtPatchMode = scenario?.name === WORKSPACE_PAST_NAME && mode === "SMT_BASELINE";
  if (allTravelRanges.length > 0 && !isPastSmtPatchMode) {
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

  const manualCanonicalPeriods =
    mode === "MANUAL_TOTALS" && manualUsagePayload
      ? (() => {
          const p = manualUsagePayload as any;
          const endKey =
            typeof p.anchorEndDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.anchorEndDate)
              ? String(p.anchorEndDate)
              : typeof p.endDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.endDate)
                ? String(p.endDate)
                : typeof p.anchorEndMonth === "string" && /^\d{4}-\d{2}$/.test(p.anchorEndMonth)
                  ? (anchorEndDateUtc(String(p.anchorEndMonth), Number(p.billEndDay) || 15)?.toISOString().slice(0, 10) ?? null)
                  : null;
          return endKey ? billingPeriodsEndingAt(endKey, 12) : [];
        })()
      : [];

  // SMT_BASELINE: use actual data's date range (anchor) so Baseline, Past, and Future all show the same dates (e.g. 02/18/2025 – 02/18/2026).
  let smtAnchorPeriods: Array<{ id: string; startDate: string; endDate: string }> | undefined;
  if (mode === "SMT_BASELINE") {
    try {
      const actualResult = await getActualUsageDatasetForHouse(houseId, esiid ?? null);
      const start = actualResult?.dataset?.summary?.start ? String(actualResult.dataset.summary.start).slice(0, 10) : null;
      const end = actualResult?.dataset?.summary?.end ? String(actualResult.dataset.summary.end).slice(0, 10) : null;
      if (start && end && /^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end)) {
        smtAnchorPeriods = [{ id: "anchor", startDate: start, endDate: end }];
      }
    } catch {
      smtAnchorPeriods = undefined;
    }
  }

  // Past with actual source: patch baseline by simulating only excluded + leading-missing days.
  /** Timezone for Past sim and stored build; set when building Past so getPastSimulatedDatasetForHouse and cache use same. */
  let timezoneForStoredBuild = (baselineInputsForRecalc as any)?.timezone ?? "America/Chicago";
  let pastSimulatedMonths: string[] | undefined;
  let pastPatchedCurve: SimulatedCurve | null = null;
  let pastSimulatedDayResults: SimulatedDayResult[] | undefined;
  if (
    scenario?.name === WORKSPACE_PAST_NAME &&
    mode === "SMT_BASELINE"
  ) {
    try {
      const canonicalWindow = canonicalWindowDateRange(built.canonicalMonths);
      const startDate = smtAnchorPeriods?.[0]?.startDate ?? canonicalWindow?.start ?? `${built.canonicalMonths[0]}-01`;
      const endDate =
        smtAnchorPeriods?.[smtAnchorPeriods.length - 1]?.endDate ??
        canonicalWindow?.end ??
        `${built.canonicalMonths[built.canonicalMonths.length - 1]}-28`;
      const recalcBuildInputs: SimulatorBuildInputsV1 = {
        version: 1,
        mode,
        baseKind: built.baseKind,
        canonicalEndMonth: built.canonicalMonths[built.canonicalMonths.length - 1] ?? "",
        canonicalMonths: built.canonicalMonths,
        monthlyTotalsKwhByMonth: built.monthlyTotalsKwhByMonth,
        intradayShape96: built.intradayShape96,
        notes: built.notes ?? [],
        filledMonths: built.filledMonths ?? [],
        snapshots: { homeProfile, applianceProfile },
      };
      const result = await simulatePastUsageDataset({
        houseId,
        userId,
        esiid: esiid ?? null,
        startDate,
        endDate,
        timezone: timezoneForStoredBuild,
        travelRanges: allTravelRanges,
        buildInputs: recalcBuildInputs,
        buildPathKind: "recalc",
      });
      if (result.dataset !== null && result.stitchedCurve) {
        pastPatchedCurve = result.stitchedCurve;
        pastSimulatedDayResults = result.simulatedDayResults;
        const byMonth: Record<string, number> = {};
        for (const m of result.stitchedCurve.monthlyTotals) {
          const ym = String(m?.month ?? "").trim();
          if (/^\d{4}-\d{2}$/.test(ym) && typeof m?.kwh === "number" && Number.isFinite(m.kwh)) byMonth[ym] = m.kwh;
        }
        if (Object.keys(byMonth).length > 0) monthlyTotalsKwhByMonth = byMonth;
        pastSimulatedMonths = [];
        notes.push("Past: baseline patched for excluded + leading-missing days");
      }
    } catch (e) {
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
    mode,
    baseKind,
    canonicalEndMonth: canonicalForBuild.endMonth,
    canonicalMonths: built.canonicalMonths,
    canonicalPeriods: manualCanonicalPeriods.length ? manualCanonicalPeriods : smtAnchorPeriods ?? undefined,
    weatherPreference,
    weatherNormalizerVersion: WEATHER_NORMALIZER_VERSION,
    monthlyTotalsKwhByMonth,
    intradayShape96: built.intradayShape96,
    weekdayWeekendShape96: built.weekdayWeekendShape96,
    travelRanges: scenarioId ? [...pastTravelRanges, ...scenarioTravelRanges] : [],
    timezone: timezoneForStoredBuild,
    notes,
    filledMonths: built.filledMonths,
    ...(pastSimulatedMonths != null ? { pastSimulatedMonths } : {}),
    snapshots: {
      manualUsagePayload: manualUsagePayload ?? null,
      homeProfile,
      applianceProfile,
      baselineHomeProfile: homeProfile,
      baselineApplianceProfile: applianceProfile,
      actualSource: built.source?.actualSource ?? actualSource ?? undefined,
      actualMonthlyAnchorsByMonth: built.source?.actualMonthlyAnchorsByMonth ?? undefined,
      actualIntradayShape96: built.source?.actualIntradayShape96 ?? undefined,
      smtMonthlyAnchorsByMonth: built.source?.smtMonthlyAnchorsByMonth ?? undefined,
      smtIntradayShape96: built.source?.smtIntradayShape96 ?? undefined,
      scenario: scenario ? { id: scenario.id, name: scenario.name } : null,
      scenarioEvents: scenarioEvents ?? [],
      scenarioOverlay: overlay ?? null,
      pastScenario: pastOverlay ? pastScenario : null,
      pastScenarioEvents: pastOverlay ? pastEventsForOverlay : [],
    } as any,
    scenarioKey,
    scenarioId,
    versions,
  };

  // V1 hash: stable JSON of a deterministic object.
  const eventsForHash = (pastOverlay ? [...pastEventsForOverlay, ...(scenarioEvents ?? [])] : (scenarioEvents ?? []))
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

  const dataset =
    pastPatchedCurve != null
      ? buildSimulatedUsageDatasetFromCurve(pastPatchedCurve, {
          baseKind: buildInputs.baseKind,
          mode: buildInputs.mode,
          canonicalEndMonth: buildInputs.canonicalEndMonth,
          notes: buildInputs.notes,
          filledMonths: buildInputs.filledMonths,
        }, {
          timezone: (buildInputs as any).timezone ?? undefined,
          useUtcMonth: true,
          simulatedDayResults: pastSimulatedDayResults,
        })
      : buildSimulatedUsageDatasetFromBuildInputs(buildInputs);
  const filledSet = new Set<string>((buildInputs.filledMonths ?? []).map(String));
  const monthProvenanceByMonth: Record<string, "ACTUAL" | "SIMULATED"> = {};
  for (const ym of buildInputs.canonicalMonths ?? []) {
    monthProvenanceByMonth[String(ym)] =
      mode === "SMT_BASELINE" && !scenarioId && !filledSet.has(String(ym)) ? "ACTUAL" : "SIMULATED";
  }
  dataset.meta = {
    ...(dataset.meta ?? {}),
    buildInputsHash,
    lastBuiltAt: new Date().toISOString(),
    scenarioKey,
    scenarioId,
    monthProvenanceByMonth,
    actualSource: built.source?.actualSource ?? actualSource ?? null,
  };

  await upsertSimulatorBuild({
    userId,
    houseId,
    scenarioKey,
    mode,
    baseKind,
    canonicalEndMonth: buildInputs.canonicalEndMonth,
    canonicalMonths: buildInputs.canonicalMonths,
    buildInputs,
    buildInputsHash,
    versions,
  });

  // Persist usage buckets for Past/Future so plan costing can use simulated usage.
  if (
    scenarioKey !== "BASELINE" &&
    dataset?.usageBucketsByMonth &&
    Object.keys(dataset.usageBucketsByMonth).length > 0
  ) {
    await upsertSimulatedUsageBuckets({
      homeId: houseId,
      scenarioKey,
      scenarioId: scenarioId ?? null,
      usageBucketsByMonth: dataset.usageBucketsByMonth,
    }).catch(() => {});
  }

  const shouldPersistPastSeries =
    args.persistPastSimBaseline === true &&
    mode === "SMT_BASELINE" &&
    scenario?.name === WORKSPACE_PAST_NAME;
  if (shouldPersistPastSeries) {
    const intervals15 = Array.isArray(dataset?.series?.intervals15) ? dataset.series.intervals15 : [];
    if (intervals15.length > 0) {
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
      if (validIntervals.length > 0) {
        const derivationVersion = String(
          (buildInputs as any)?.versions?.smtShapeDerivationVersion ??
            (buildInputs as any)?.versions?.intradayTemplateVersion ??
            "v1"
        );
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
        } catch (e) {
          // Persistence of derived interval artifacts must not block recalc responses.
          console.error("[usageSimulator/service] failed to persist PAST_SIM_BASELINE interval series", {
            userId,
            houseId,
            scenarioId,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }
  }

  return { ok: true, houseId, buildInputsHash, dataset };
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

/**
 * Builds the same Past stitched dataset that production "Past simulated usage" UI uses.
 * Uses actual intervals for the window and simulated fill only for excluded (travel/vacant) days.
 * Single canonical source for lab parity: lab must call this (not buildSimulatedUsageDatasetFromBuildInputs).
 */
export async function getPastSimulatedDatasetForHouse(args: {
  userId: string;
  houseId: string;
  esiid: string | null;
  travelRanges: Array<{ startDate: string; endDate: string }>;
  buildInputs: SimulatorBuildInputsV1;
  startDate: string;
  endDate: string;
  /** When set, excluded days use weekday/weekend avg from UsageShapeProfile (local timezone). */
  timezone?: string;
  /** Optional: cold_build (default), recalc, or lab_validation. */
  buildPathKind?: "cold_build" | "recalc" | "lab_validation";
  /** Explicit caller intent; defaults true to preserve current behavior. */
  includeSimulatedDayResults?: boolean;
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
    esiid,
    travelRanges,
    buildInputs,
    startDate,
    endDate,
    timezone,
    buildPathKind = "cold_build",
    includeSimulatedDayResults = true,
  } = args;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return { dataset: null, error: "Invalid startDate or endDate (expect YYYY-MM-DD)." };
  }
  try {
    const result = await simulatePastUsageDataset({
      houseId,
      userId,
      esiid,
      startDate,
      endDate,
      timezone,
      travelRanges,
      buildInputs,
      buildPathKind,
      includeSimulatedDayResults,
    });
    if (result.dataset === null) {
      return { dataset: null, error: (result as { error: string }).error ?? "simulatePastUsageDataset failed" };
    }
    const dataset = result.dataset;
    // Keep cold build on the stitched saved artifact only; no second overlay pass.
    const actualWxByDateKey = result.actualWxByDateKey;
    if (dataset && actualWxByDateKey && actualWxByDateKey.size > 0) {
      (dataset as any).dailyWeather = Object.fromEntries(
        Array.from(actualWxByDateKey.entries()).map(([dateKey, w]) => [
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
    return { dataset, simulatedDayResults: result.simulatedDayResults, actualWxByDateKey };
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
              houseLabel: h.label || h.addressLine1 || h.id,
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
        label: h.label || h.addressLine1,
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
  forceRebuildArtifact?: boolean;
}): Promise<
  | { ok: true; houseId: string; scenarioKey: string; scenarioId: string | null; dataset: any }
  | {
      ok: false;
      code: "NO_BUILD" | "SCENARIO_NOT_FOUND" | "HOUSE_NOT_FOUND" | "INTERNAL_ERROR" | "ARTIFACT_MISSING";
      message: string;
      inputHash?: string;
      engineVersion?: string;
    }
> {
  try {
    const scenarioKey = normalizeScenarioKey(args.scenarioId);
    const scenarioId = scenarioKey === "BASELINE" ? null : scenarioKey;
    const readMode = args.readMode ?? "allow_rebuild";
    const forceRebuildArtifact = args.forceRebuildArtifact === true;

    const house = await getHouseAddressForUserHouse({ userId: args.userId, houseId: args.houseId });
    if (!house) return { ok: false, code: "HOUSE_NOT_FOUND", message: "House not found for user" };

    if (readMode === "artifact_only") {
      const scenarioIdForCache = scenarioId ?? "BASELINE";
      // Backward-compatible artifact-only support for gapfill_lab, which does not have a usageSimulatorBuild row.
      if (scenarioIdForCache === "gapfill_lab") {
        const latestCached = await getLatestCachedPastDatasetByScenario({
          houseId: args.houseId,
          scenarioId: scenarioIdForCache,
        });
        if (!latestCached || latestCached.intervalsCodec !== INTERVAL_CODEC_V1) {
          return {
            ok: false,
            code: "ARTIFACT_MISSING",
            message: "Persisted artifact not found for this house/scenario. Run explicit rebuild first.",
            engineVersion: PAST_ENGINE_VERSION,
          };
        }
        const decoded = decodeIntervalsV1(latestCached.intervalsCompressed);
        const restored = {
          ...latestCached.datasetJson,
          series: {
            ...(typeof (latestCached.datasetJson as any).series === "object" &&
            (latestCached.datasetJson as any).series !== null
              ? (latestCached.datasetJson as any).series
              : {}),
            intervals15: decoded,
          },
        };
        reconcileRestoredDatasetFromDecodedIntervals({
          dataset: restored,
          decodedIntervals: decoded,
          fallbackEndDate: String((latestCached.datasetJson as any)?.summary?.end ?? "").slice(0, 10),
        });
        const restoredAny = restored as any;
        if (!restoredAny.meta || typeof restoredAny.meta !== "object") restoredAny.meta = {};
        restoredAny.meta.artifactReadMode = "artifact_only";
        restoredAny.meta.artifactSource = "past_cache";
        restoredAny.meta.artifactInputHash = latestCached.inputHash;
        restoredAny.meta.artifactUpdatedAt = latestCached.updatedAt
          ? latestCached.updatedAt.toISOString()
          : null;
        restoredAny.meta.artifactRecomputed = false;
        restoredAny.meta.artifactScenarioId = scenarioIdForCache;
        restoredAny.meta.requestedInputHash = null;
        restoredAny.meta.artifactInputHashUsed = latestCached.inputHash;
        restoredAny.meta.artifactHashMatch = false;
        restoredAny.meta.artifactSourceMode = "latest_by_scenario_fallback";
        restoredAny.meta.artifactCreatedAt = null;
        restoredAny.meta.artifactSourceNote =
          "Artifact source: latest cached Past scenario artifact for gapfill_lab (no build identity row).";
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
        return { ok: true, houseId: args.houseId, scenarioKey, scenarioId, dataset: restored };
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

      const buildInputs = buildRec.buildInputs as Record<string, unknown>;
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
      const expectedExcludedFingerprintForFallback = Array.from(
        boundDateKeysToCoverageWindow(
          new Set<string>(travelRangesToExcludeDateKeys(travelRanges)),
          { startDate: window.startDate, endDate: window.endDate }
        )
      )
        .sort()
        .join(",");
      const intervalDataFingerprint = await getIntervalDataFingerprint({
        houseId: args.houseId,
        esiid: house.esiid ?? null,
        startDate: window.startDate,
        endDate: window.endDate,
      });
      const usageShapeProfileIdentity = await getUsageShapeProfileIdentityForPast(args.houseId);
      const weatherIdentity = await computePastWeatherIdentity({
        houseId: args.houseId,
        startDate: window.startDate,
        endDate: window.endDate,
      });
      const inputHash = computePastInputHash({
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

      let exactCached = await getCachedPastDataset({
        houseId: args.houseId,
        scenarioId: scenarioIdForCache,
        inputHash,
      });
      // Shared artifact: Sim Past and gapfill-lab both use the same Past scenario (CUID) and same cache.
      // If exact inputHash miss (e.g. fingerprint drifted), use latest cached artifact for this scenario
      // so gapfill can see what Sim Past (or rebuild) produced.
      let artifactSourceMode: "exact_hash_match" | "latest_by_scenario_fallback" = "exact_hash_match";
      if (!exactCached || exactCached.intervalsCodec !== INTERVAL_CODEC_V1) {
        const latestCached = await getLatestCachedPastDatasetByScenario({
          houseId: args.houseId,
          scenarioId: scenarioIdForCache,
        });
        const latestMeta = ((latestCached as any)?.datasetJson?.meta ?? {}) as Record<string, unknown>;
        const latestExcludedFingerprint = String(latestMeta?.excludedDateKeysFingerprint ?? "");
        const latestIsFallbackCompatible =
          latestCached != null &&
          latestCached.intervalsCodec === INTERVAL_CODEC_V1 &&
          latestExcludedFingerprint === expectedExcludedFingerprintForFallback;
        if (latestIsFallbackCompatible) {
          exactCached = latestCached;
          artifactSourceMode = "latest_by_scenario_fallback";
        }
      }
      if (!exactCached || exactCached.intervalsCodec !== INTERVAL_CODEC_V1) {
        return {
          ok: false,
          code: "ARTIFACT_MISSING",
          message: "Persisted artifact not found for this house/scenario identity. Run explicit rebuild first.",
          inputHash,
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
      reconcileRestoredDatasetFromDecodedIntervals({
        dataset: restored,
        decodedIntervals: decoded,
        fallbackEndDate: window.endDate,
      });
      const restoredAny = restored as any;
      if (!restoredAny.meta || typeof restoredAny.meta !== "object") restoredAny.meta = {};
      restoredAny.meta.artifactReadMode = "artifact_only";
      restoredAny.meta.artifactSource = "past_cache";
      restoredAny.meta.artifactInputHash = (exactCached as any).inputHash ?? inputHash;
      restoredAny.meta.artifactRecomputed = false;
      restoredAny.meta.artifactScenarioId = scenarioIdForCache;
      restoredAny.meta.requestedInputHash = inputHash;
      restoredAny.meta.artifactInputHashUsed = (exactCached as any).inputHash ?? inputHash;
      restoredAny.meta.artifactHashMatch =
        String(restoredAny.meta.artifactInputHashUsed ?? "") === String(inputHash ?? "");
      restoredAny.meta.artifactSourceMode = artifactSourceMode;
      restoredAny.meta.artifactCreatedAt = null;
      // best-effort propagation; present when coming from latest-by-scenario helper
      if ((exactCached as any).updatedAt instanceof Date) {
        restoredAny.meta.artifactUpdatedAt = (exactCached as any).updatedAt.toISOString();
      }
      restoredAny.meta.artifactSourceNote =
        artifactSourceMode === "exact_hash_match"
          ? "Artifact source: exact identity match on Past input hash."
          : "Artifact source: latest cached Past scenario artifact (fallback from exact hash miss).";
      applyCanonicalCoverageMetadataForNonBaseline(restoredAny, scenarioKey, { buildInputs });
      const quality = validateSharedSimQuality(restored);
      if (!quality.ok) {
        await reportSimulationDataIssue({
          source: "USER_SIMULATION",
          userId: args.userId,
          houseId: args.houseId,
          scenarioId,
          code: "INTERNAL_ERROR",
          message: quality.message,
          context: { readMode: "artifact_only" },
        });
        return { ok: false, code: "INTERNAL_ERROR", message: quality.message };
      }
      return { ok: true, houseId: args.houseId, scenarioKey, scenarioId, dataset: restored };
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

    const buildRec = await (prisma as any).usageSimulatorBuild
      .findUnique({
        where: { userId_houseId_scenarioKey: { userId: args.userId, houseId: args.houseId, scenarioKey } },
        select: { buildInputs: true, buildInputsHash: true, lastBuiltAt: true },
      })
      .catch(() => null);
    if (!buildRec?.buildInputs) {
      return { ok: false, code: "NO_BUILD", message: "Recalculate to generate this scenario." };
    }

    const buildInputs = buildRec.buildInputs as SimulatorBuildInputsV1;
    const mode = (buildInputs as any).mode;
    const actualSource = (buildInputs as any)?.snapshots?.actualSource ?? null;
    const snapshotScenarioName = String((buildInputs as any)?.snapshots?.scenario?.name ?? "");
    const isSmtBaselineMode = mode === "SMT_BASELINE";
    const isFutureWorkspaceScenario =
      Boolean(scenarioId) &&
      (scenarioRow?.name === WORKSPACE_FUTURE_NAME || snapshotScenarioName === WORKSPACE_FUTURE_NAME);
    // Treat any non-baseline, non-future scenario as Past to avoid brittle name-only gating.
    const isPastScenario = Boolean(scenarioId) && !isFutureWorkspaceScenario;
    const useActualBaseline =
      scenarioKey === "BASELINE" &&
      isSmtBaselineMode;

    // Backfill house weather for the usage window (e.g. 366 days) when missing; runs on every simulated fetch.
    const canonicalMonthsForWx = (buildInputs as any).canonicalMonths ?? [];
    const windowForWx = canonicalMonthsForWx.length > 0 ? canonicalWindowDateRange(canonicalMonthsForWx) : null;
    if (windowForWx?.start && windowForWx?.end) {
      ensureHouseWeatherBackfill({
        houseId: args.houseId,
        startDate: windowForWx.start,
        endDate: windowForWx.end,
      }).catch(() => {});
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
            buildInputsHash: String(buildRec.buildInputsHash ?? ""),
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
          buildInputsHash: String(buildRec.buildInputsHash ?? ""),
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
      // Always build stitched curve for Past + SMT/GB so Travel/Vacant and missing/incomplete intervals are filled.
      const isPastStitched =
        !dataset &&
        isPastScenario &&
        isSmtBaselineMode;
      if (isPastStitched) {
        // Use buildInputs.canonicalMonths for window so we avoid getActualUsageDatasetForHouse (and its full-year
        // getActualIntervalsForRange) before the cache check. One full-year fetch in getPastSimulatedDatasetForHouse is enough.
        let canonicalMonths = (buildInputs as any).canonicalMonths ?? [];
        let canonicalEndMonthForMeta = buildInputs.canonicalEndMonth;
        let sourceOfWindow: "buildInputs" | "baselineBuild" | "actualSummaryFallback" = "buildInputs";
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
            sourceOfWindow = "baselineBuild";
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
              sourceOfWindow = "actualSummaryFallback";
            }
          } catch {
            /* keep canonicalMonths from build or baseline */
          }
        }
        const window = canonicalWindowDateRange(canonicalMonths);
        let startDate = periodsForStitch?.[0]?.startDate ?? window?.start;
        let endDate = periodsForStitch?.[periodsForStitch.length - 1]?.endDate ?? window?.end;
        // Align 12-month display to end with actual data (e.g. March 2026) so chart/table show Apr..Mar, not Mar..Feb.
        if (startDate && endDate && window?.end) {
          try {
            const actualForWindow = await getActualUsageDatasetForHouse(args.houseId, house.esiid ?? null, { skipFullYearIntervalFetch: true });
            const actualEnd = actualForWindow?.dataset?.summary?.end;
            const actualStart = actualForWindow?.dataset?.summary?.start;
            if (typeof actualEnd === "string" && /^\d{4}-\d{2}-\d{2}$/.test(actualEnd.slice(0, 10))) {
              const actualEndDate = actualEnd.slice(0, 10);
              if (actualEndDate > endDate) endDate = actualEndDate;
            }
            if (typeof actualStart === "string" && /^\d{4}-\d{2}-\d{2}$/.test(actualStart.slice(0, 10))) {
              const actualStartDate = actualStart.slice(0, 10);
              if (actualStartDate < startDate) startDate = actualStartDate;
            }
          } catch {
            /* keep window-based start/end */
          }
        }
        const pastWindowDiag = {
          canonicalMonthsLen: canonicalMonths.length,
          firstMonth: canonicalMonths[0] ?? null,
          lastMonth: canonicalMonths.length > 0 ? canonicalMonths[canonicalMonths.length - 1] ?? null : null,
          windowStartUtc: startDate ?? null,
          windowEndUtc: endDate ?? null,
          sourceOfWindow,
        };
        if (startDate && endDate) {
          const travelRanges = ((buildInputs as any).travelRanges ?? []) as Array<{ startDate: string; endDate: string }>;
          const timezone = (buildInputs as any).timezone ?? "America/Chicago";
          const usageShapeProfileIdentity = await getUsageShapeProfileIdentityForPast(args.houseId);
          const weatherIdentity = await computePastWeatherIdentity({
            houseId: args.houseId,
            startDate,
            endDate,
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
          if (cached && cached.intervalsCodec === INTERVAL_CODEC_V1) {
            const decoded = decodeIntervalsV1(cached.intervalsCompressed);
            const restored = {
              ...cached.datasetJson,
              series: {
                ...(typeof (cached.datasetJson as any).series === "object" && (cached.datasetJson as any).series !== null
                  ? (cached.datasetJson as any).series
                  : {}),
                intervals15: decoded,
              },
            };
            dataset = restored;
            reconcileRestoredDatasetFromDecodedIntervals({
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
            const pastResult = await getPastSimulatedDatasetForHouse({
              userId: args.userId,
              houseId: args.houseId,
              esiid: house.esiid ?? null,
              travelRanges,
              buildInputs,
              startDate,
              endDate,
              timezone,
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
              attachCanonicalArtifactSimulatedDayTotalsByDate(dataset, timezone);
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
            const canonicalArtifactSimulatedDayTotalsByDate = attachCanonicalArtifactSimulatedDayTotalsByDate(dataset, timezone);
            const datasetJsonForStorage = {
              ...dataset,
              canonicalArtifactSimulatedDayTotalsByDate,
              meta: {
                ...((dataset as any)?.meta ?? {}),
                canonicalArtifactSimulatedDayTotalsByDate,
              },
              series: { ...(dataset.series ?? {}), intervals15: [] },
            };
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
        buildInputsHash: String(buildRec.buildInputsHash ?? ""),
        lastBuiltAt: buildRec.lastBuiltAt ? new Date(buildRec.lastBuiltAt).toISOString() : null,
        scenarioKey,
        scenarioId,
        monthProvenanceByMonth,
        actualSource: (buildInputs as any)?.snapshots?.actualSource ?? null,
      };
    }

    // Non-baseline scenario metadata window must match the shared Usage dashboard 365-day canonical window.
    if (scenarioKey !== "BASELINE" && dataset?.summary) {
      const canonicalCoverage =
        applyCanonicalCoverageMetadataForNonBaseline(dataset, scenarioKey, { buildInputs }) ??
        resolveCanonicalUsage365CoverageWindow();
      void canonicalCoverage;
    }

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
        context: { readMode: "allow_rebuild" },
      });
      return { ok: false, code: "INTERNAL_ERROR", message: quality.message };
    }
    return { ok: true, houseId: args.houseId, scenarioKey, scenarioId, dataset };
  } catch (e) {
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
  const actualSource = await chooseActualSource({ houseId: args.houseId, esiid: house.esiid ?? null });
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
    canonicalEndMonth: canonical.endMonth,
  };
}