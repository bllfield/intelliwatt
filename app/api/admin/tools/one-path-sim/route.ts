import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { finalizePastDatasetDisplayReadModel } from "@/lib/usage/finalizePastDatasetDisplayReadModel";
import type { PastDisplayWeatherFinalizeOutcome } from "@/lib/usage/pastDisplayWeatherFinalizeGuard";
import { readGreenButtonTrustedHomeDateKeysFromPastMeta } from "@/lib/usage/greenButtonPastTrustedPool";
import {
  applyFinalizedPastVisibleWeatherToRunDisplayView,
  buildAdminPastWeatherApiFields,
  resolvePastVisibleWeatherScore,
} from "@/lib/usage/resolvePastVisibleWeatherScore";
import {
  resolvePastProfileLoadContext,
  resolvePastWeatherHouseIdFromDataset,
} from "@/lib/usage/pastVisibleWeatherReadDiagnostics";
import { resolveStaleIncompleteMeterSlotCompleteDateKeys } from "@/lib/usage/pastSimStaleIncompleteMeter";
import { resolveActualDatasetForCompareDiagnostics } from "@/lib/usage/compareDiagnosticsActualIntervals";
import { travelRangeIsActiveForCoverageWindow } from "@/lib/usage/pastSimTravelRanges";
import { sageActualDailyRowsFromDataset } from "@/lib/usage/sageActualDailyTruth";
import { buildUserUsageHouseContract } from "@/lib/usage/userUsageHouseContract";
import {
  ensureSmtCoverageForHouse,
  type EnsureSmtCoverageResult,
} from "@/lib/usage/ensureSmtCoverage";
import { resolveHouseCommittedUsageSource } from "@/lib/usage/houseCommittedUsageSource";
import type { UsageRefreshResult } from "@/lib/usage/userUsageRefresh";
import { usagePrisma } from "@/lib/db/usageClient";
import { getHomeProfileReadOnlyByUserHouse, getHomeProfileSimulatedByUserHouse } from "@/modules/homeProfile/repo";
import {
  adaptGreenButtonRawInput,
  adaptIntervalRawInput,
  adaptManualAnnualRawInput,
  adaptManualMonthlyRawInput,
  adaptNewBuildRawInput,
  buildIntervalLikeBaselinePassthroughDataset,
  buildSharedSimulationReadModel,
  runSharedSimulation,
  SharedSimulationRunError,
  UpstreamUsageTruthMissingError,
  type CanonicalSimulationEngineInput,
  type CanonicalSimulationInputType,
} from "@/modules/onePathSim/onePathSim";
import { listOnePathScenarioEvents, readOnePathSimulatedUsageScenario } from "@/modules/onePathSim/serviceBridge";
import { dispatchPastSimRecalc } from "@/modules/usageSimulator/pastSimRecalcDispatch";
import { resolveGlobalValidationDayKeysForPastSim } from "@/lib/usage/validationDayPolicy";
import { resolveOnePathGbPastCachedArtifactInputHash } from "@/lib/usage/onePathGbPastArtifactRun";
import { findPastScenarioId } from "@/lib/usage/onePathPastUserSiteParity";
import {
  assertOnePathGreenButtonPersistedUsage,
  greenButtonUploadHasPersistedUsage,
} from "@/lib/usage/onePathGreenButtonUsageGate";
import {
  greenButtonRehydrateUserMessage,
  rehydrateGreenButtonIntervalsFromRawForHouse,
} from "@/lib/usage/rehydrateGreenButtonIntervalsFromRaw";
import type { TravelRange } from "@/modules/simulatedUsage/types";
import { getApplianceProfileSimulatedByUserHouse } from "@/modules/applianceProfile/repo";
import { normalizeStoredApplianceProfile } from "@/modules/applianceProfile/validation";
import {
  gateOnePathSimAdmin,
  requireOnePathWritableContext,
  resolveOnePathSimOwnerUserId,
  resolveOnePathSimUserSelection,
} from "./_helpers";
import { resolveOnePathTestHomeState } from "@/modules/onePathSim/testHomeState";
import {
  ONE_PATH_LAB_TEST_HOME_LABEL,
  replaceGlobalOnePathLabTestHomeFromSource,
  syncOnePathMissingProfilesFromSource,
} from "@/modules/usageSimulator/labTestHome";
import {
  getOnePathManualUsageInput,
  getOnePathSimulationVariablePolicy,
  getOnePathTravelRangesFromDb,
  resolveOnePathUpstreamUsageTruthForSimulation,
  resolveOnePathWeatherSensitivityEnvelope,
  saveOnePathManualUsageInput,
  type SimulationVariableInputType,
  type SimulationVariablePolicy,
} from "@/modules/onePathSim/runtime";
import { buildOnePathBaselineParityAudit } from "@/modules/onePathSim/baselineParityAudit";
import { runFullWindowSmtReingestForHouse } from "@/lib/usage/fullWindowSmtReingest";
import { buildBaselineParityReport } from "@/modules/onePathSim/baselineParityReport";
import {
  buildOnePathBaselineReadOnlyView,
  buildOnePathRunReadOnlyViewFromBaselineContract,
} from "@/modules/onePathSim/baselineReadOnlyView";
import { buildGreenButtonUserSiteParityContract } from "@/lib/usage/greenButtonUserSiteBaseline";
import {
  resolveGreenButtonDisplayWindow,
  resolveGreenButtonUploadRecordDateRange,
} from "@/lib/usage/greenButtonCoverage";
import { getLatestGreenButtonFullDayDateKey } from "@/modules/realUsageAdapter/greenButton";
import { ensureWorkspaceScenariosForHouse } from "@/lib/usage/ensureWorkspaceScenarios";
import { buildKnownHouseScenarioPrereqStatus } from "@/modules/onePathSim/knownHouseScenarioPrereqs";
import {
  hasUsableAnnualPayload,
  hasUsableMonthlyPayload,
  reanchorGapfillManualStageOnePayload,
  resolveGapfillSyntheticAnchorEndDate,
  resolveSharedManualStageOneContract,
} from "@/modules/onePathSim/manualPrefill";
import { buildOnePathManualUsagePastSimReadResult } from "@/modules/onePathSim/manualPastSimReadResult";
import { buildOnePathManualStageOnePreview, buildOnePathManualStageOneView } from "@/modules/onePathSim/manualStageView";
import { buildOnePathRunReadOnlyView } from "@/modules/onePathSim/runReadOnlyView";
import { buildOnePathIntervalDiagnosticsForPastResponse } from "@/modules/onePathSim/onePathIntervalCompareDiagnosticsV1";
import type { ManualUsagePayload } from "@/modules/onePathSim/simulatedUsage/types";
import { hashManualGapfillSavedSeedPayload } from "@/modules/manualUsage/manualGapfillSeed";
import { loadPastSimBuildInputsForRead } from "@/lib/usage/loadPastSimBuildInputsForRead";
import { buildImmutablePastArtifactKey } from "@/lib/usage/pastArtifactIdentity";
import {
  resolvePastSimPreferredActualSource,
  resolveValidationCompareProjectionForRead,
} from "@/lib/usage/pastSimValidationCompareRead";
import { buildValidationCompareProjectionSidecar } from "@/lib/usage/validationCompareProjection";
import { getPersistedPastArtifactRowMeta } from "@/modules/onePathSim/usageSimulator/pastCache";
import { createSimCorrelationId, getMemoryRssMb, logSimPipelineEvent } from "@/modules/onePathSim/usageSimulator/simObservability";
import { resolveCanonicalUsage365CoverageWindow } from "@/modules/onePathSim/usageSimulator/metadataWindow";
import { chicagoPullDateKey } from "@/lib/usage/smtDayCoverageLedger";
import {
  loadSmtTailCoverage,
  normalizeDateKeys,
  ONE_PATH_ADMIN_SMT_TAIL_WAIT_TIMEOUT_MS,
  SMT_TAIL_WAIT_INTERVAL_MS,
  waitForSmtTailCoverage,
} from "@/lib/usage/smtTailCoverage";
import { resolveSmtPersistedCoverageSpan } from "@/lib/usage/smtWindowStatus";
import { buildRuntimeEnvParityTrace } from "@/modules/onePathSim/runtimeEnvParityTrace";
import { listScenarios } from "@/modules/usageSimulator/service";
import { buildPerformanceAuditSnapshot } from "@/lib/usage/usageParityAudit";
import { isEsiidUniqueConstraintError } from "@/lib/house/syncIdentifiers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const GREEN_BUTTON_ROUTE_STAGE_TIMEOUT_MS = 120_000;
/** Same heal profile as POST /api/user/usage/refresh. */
/** Lookup/load must wait for full canonical SMT coverage (admin waits), not the short user-session tail budget. */
const ONE_PATH_SMT_HEAL_PROFILE = "admin_sim" as const;

function onePathEsiidSiblingConflictResponse(error: unknown): NextResponse | null {
  if (!isEsiidUniqueConstraintError(error)) return null;
  return NextResponse.json(
    {
      ok: false,
      error: "esiid_already_on_sibling_house",
      message:
        "This meter ESIID is already linked to the source home. One Path lab test homes stay without their own ESIID; SMT heal runs on the linked source house.",
    },
    { status: 409 }
  );
}

function withRunPerformanceAudit(args: {
  readModel: Record<string, unknown> | null | undefined;
  stageTimingsMs: Record<string, number>;
  routeStartedAt: number;
}): Record<string, unknown> | null {
  if (!args.readModel) return null;
  const performanceAudit = buildPerformanceAuditSnapshot({
    readModel: args.readModel,
    stageTimingsMs: args.stageTimingsMs,
    routeTotalDurationMs: Date.now() - args.routeStartedAt,
  });
  return { ...args.readModel, performanceAudit };
}

class AdminRouteStageTimeoutError extends Error {
  code = "one_path_admin_timeout" as const;
  stage: string;
  correlationId: string;
  timeoutMs: number;
  elapsedMs: number;

  constructor(args: { stage: string; correlationId: string; timeoutMs: number; elapsedMs: number }) {
    super(`Admin one-path route timed out during ${args.stage} after ${args.elapsedMs}ms.`);
    this.name = "AdminRouteStageTimeoutError";
    this.stage = args.stage;
    this.correlationId = args.correlationId;
    this.timeoutMs = args.timeoutMs;
    this.elapsedMs = args.elapsedMs;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function isAdminRouteStageTimeoutFailure(error: unknown): error is AdminRouteStageTimeoutError {
  return error instanceof AdminRouteStageTimeoutError;
}

async function withAdminRouteStageTimeout<T>(args: {
  stage: string;
  correlationId: string;
  timeoutMs: number;
  mode: CanonicalSimulationInputType;
  houseId: string;
  stageTimingsMs: Record<string, number>;
  promise: Promise<T>;
}): Promise<T> {
  const startedAt = Date.now();
  logSimPipelineEvent("one_path_admin_stage_start", {
    stage: args.stage,
    correlationId: args.correlationId,
    timeoutMs: args.timeoutMs,
    mode: args.mode,
    houseId: args.houseId,
    memoryRssMb: getMemoryRssMb(),
  });
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const result = await Promise.race<T>([
      args.promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new AdminRouteStageTimeoutError({
              stage: args.stage,
              correlationId: args.correlationId,
              timeoutMs: args.timeoutMs,
              elapsedMs: Date.now() - startedAt,
            })
          );
        }, args.timeoutMs);
      }),
    ]);
    const durationMs = Date.now() - startedAt;
    args.stageTimingsMs[args.stage] = durationMs;
    logSimPipelineEvent("one_path_admin_stage_success", {
      stage: args.stage,
      correlationId: args.correlationId,
      durationMs,
      mode: args.mode,
      houseId: args.houseId,
      memoryRssMb: getMemoryRssMb(),
    });
    return result;
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    args.stageTimingsMs[args.stage] = durationMs;
    logSimPipelineEvent("one_path_admin_stage_failure", {
      stage: args.stage,
      correlationId: args.correlationId,
      durationMs,
      timeoutMs: isAdminRouteStageTimeoutFailure(error) ? error.timeoutMs : undefined,
      failureMessage: error instanceof Error ? error.message : "unknown_error",
      mode: args.mode,
      houseId: args.houseId,
      memoryRssMb: getMemoryRssMb(),
    });
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isUpstreamUsageTruthMissingFailure(
  error: unknown
): error is {
  code: "usage_truth_missing";
  usageTruthSource: unknown;
  seedResult: unknown;
  upstreamUsageTruth: unknown;
  message: string;
} {
  if (error instanceof UpstreamUsageTruthMissingError) return true;
  if (!error || typeof error !== "object") return false;
  return (error as { code?: unknown }).code === "usage_truth_missing";
}

function isSharedSimulationRunFailure(
  error: unknown
): error is {
  code: string;
  missingItems?: string[];
  message?: string;
} {
  if (error instanceof SharedSimulationRunError) return true;
  if (error instanceof Error && error.message === "requirements_unmet") return true;
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  const message = (error as { message?: unknown }).message;
  return typeof code === "string" || message === "requirements_unmet";
}

function normalizeMode(value: unknown): CanonicalSimulationInputType {
  switch (String(value ?? "").trim().toUpperCase()) {
    case "INTERVAL":
      return "INTERVAL";
    case "GREEN_BUTTON":
      return "GREEN_BUTTON";
    case "MANUAL_ANNUAL":
      return "MANUAL_ANNUAL";
    case "NEW_BUILD":
      return "NEW_BUILD";
    default:
      return "MANUAL_MONTHLY";
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function buildSlimAdminEngineInput(engineInput: CanonicalSimulationEngineInput | null | undefined) {
  if (!engineInput) return null;
  const weatherDaysReference = asRecord(engineInput.weatherDaysReference);
  const prefetchedUsageTruth = asRecord(engineInput.prefetchedBaselineUpstreamUsageTruth);
  const displaySimulatorMode = engineInput.inputType === "GREEN_BUTTON" ? "GREEN_BUTTON" : engineInput.simulatorMode;
  return {
    ...engineInput,
    simulatorMode: displaySimulatorMode,
    actualIntervalsReference: {
      omittedForAdminResponse: true,
      rowsCount: Array.isArray(engineInput.actualIntervalsReference) ? engineInput.actualIntervalsReference.length : 0,
    },
    actualDailyReference: {
      omittedForAdminResponse: true,
      rowsCount: Array.isArray(engineInput.actualDailyReference) ? engineInput.actualDailyReference.length : 0,
    },
    weatherDaysReference:
      weatherDaysReference != null
        ? {
            omittedForAdminResponse: true,
            rowsCount: Object.keys(weatherDaysReference).length,
          }
        : null,
    prefetchedBaselineUpstreamUsageTruth:
      prefetchedUsageTruth != null
        ? {
            usageTruthSource: prefetchedUsageTruth.usageTruthSource ?? null,
            seedResult: prefetchedUsageTruth.seedResult ?? null,
            summary: prefetchedUsageTruth.summary ?? null,
          }
        : null,
    runtime:
      engineInput.runtime && typeof engineInput.runtime === "object"
        ? {
            ...engineInput.runtime,
            mode: displaySimulatorMode,
          }
        : engineInput.runtime,
  };
}

function buildCompactRunReadModelDataset(args: {
  artifactDataset: Record<string, unknown> | null;
  artifactDatasetMeta: Record<string, unknown> | null;
  runDisplayView: Record<string, unknown> | null;
  forceBaselinePassthrough?: boolean;
}) {
  const summary = asRecord(args.artifactDataset?.summary);
  const viewSummary = asRecord(args.runDisplayView?.summary);
  return {
    summary: {
      ...(summary ?? {}),
      source: viewSummary?.source ?? summary?.source ?? null,
      totalKwh: asRecord(viewSummary?.totals)?.netKwh ?? summary?.totalKwh ?? null,
      start: viewSummary?.coverageStart ?? summary?.start ?? null,
      end: viewSummary?.coverageEnd ?? summary?.end ?? null,
      latest: summary?.latest ?? viewSummary?.coverageEnd ?? null,
    },
    daily: Array.isArray(args.runDisplayView?.dailyRows)
      ? args.runDisplayView?.dailyRows
      : Array.isArray(args.artifactDataset?.daily)
        ? args.artifactDataset.daily
        : [],
    monthly: Array.isArray(args.runDisplayView?.monthlyRows)
      ? args.runDisplayView?.monthlyRows
      : Array.isArray(args.artifactDataset?.monthly)
        ? args.artifactDataset.monthly
        : [],
    dailyWeather: args.runDisplayView?.dailyWeather ?? null,
    totals: asRecord(viewSummary?.totals) ?? null,
    insights: {
      fifteenMinuteAverages: Array.isArray(args.runDisplayView?.fifteenMinuteAverages)
        ? args.runDisplayView?.fifteenMinuteAverages
        : [],
      stitchedMonth: args.runDisplayView?.stitchedMonth ?? null,
      weekdayVsWeekend:
        typeof viewSummary?.weekdayKwh === "number" || typeof viewSummary?.weekendKwh === "number"
          ? {
              weekday: Number(viewSummary?.weekdayKwh ?? 0),
              weekend: Number(viewSummary?.weekendKwh ?? 0),
            }
          : null,
      timeOfDayBuckets: Array.isArray(viewSummary?.timeOfDayBuckets) ? viewSummary.timeOfDayBuckets : [],
      peakDay: viewSummary?.peakDay ?? null,
      peakHour: viewSummary?.peakHour ?? null,
      baseload: typeof viewSummary?.baseload === "number" ? viewSummary.baseload : null,
      baseloadDaily: typeof viewSummary?.baseloadDaily === "number" ? viewSummary.baseloadDaily : null,
      baseloadMonthly: typeof viewSummary?.baseloadMonthly === "number" ? viewSummary.baseloadMonthly : null,
    },
    series: {
      intervals15: [],
    },
    meta: {
      // Always prefer live artifact meta after display-truth finalize; artifactDatasetMeta can be a stale snapshot.
      ...(asRecord(args.artifactDataset?.meta) ?? args.artifactDatasetMeta ?? {}),
      ...(args.forceBaselinePassthrough ? { baselinePassthrough: true } : {}),
    },
  };
}

function buildCompactArtifactSummary(artifact: Record<string, unknown> | null) {
  return artifact
    ? {
        artifactId: artifact.artifactId ?? null,
        buildRowId: artifact.buildRowId ?? null,
        immutableArtifactKey: artifact.immutableArtifactKey ?? null,
        artifactInputHash: artifact.artifactInputHash ?? null,
        buildInputsHash: artifact.buildInputsHash ?? null,
        engineVersion: artifact.engineVersion ?? null,
        inputType: artifact.inputType ?? null,
        simulatorMode: artifact.simulatorMode ?? null,
        houseId: artifact.houseId ?? null,
        scenarioId: artifact.scenarioId ?? null,
        actualContextHouseId: artifact.actualContextHouseId ?? null,
        createdAt: artifact.createdAt ?? null,
        updatedAt: artifact.updatedAt ?? null,
      }
    : null;
}

function buildCompactSimulationReadModel(args: {
  artifact: Record<string, unknown> | null;
  artifactDataset: Record<string, unknown> | null;
  artifactDatasetMeta: Record<string, unknown> | null;
  runDisplayView: Record<string, unknown> | null;
  compareProjection?: unknown;
  forceBaselinePassthrough?: boolean;
}) {
  if (!args.artifactDataset && !args.runDisplayView) return null;
  const artifact = args.artifact ?? {};
  return {
    compactResponseReadModel: true,
    compactResponseReason: "admin_response_keeps_display_small_but_preserves_ai_copy_diagnostics",
    runIdentity: null,
    dataset: buildCompactRunReadModelDataset({
      artifactDataset: args.artifactDataset,
      artifactDatasetMeta: args.artifactDatasetMeta,
      runDisplayView: args.runDisplayView,
      forceBaselinePassthrough: args.forceBaselinePassthrough,
    }),
    compareProjection: args.compareProjection ?? null,
    manualMonthlyReconciliation: artifact.manualMonthlyReconciliation ?? null,
    manualParitySummary: artifact.manualParitySummary ?? null,
    manualStageOneView: artifact.manualStageOneView ?? null,
    sharedDiagnostics: artifact.sharedDiagnostics ?? null,
    tuningSummary: artifact.tuningSummary ?? null,
    dailyShapeTuning: artifact.dailyShapeTuning ?? null,
    sourceOfTruthSummary: artifact.sourceOfTruthSummary ?? null,
    effectiveSimulationVariablesUsed: artifact.effectiveSimulationVariablesUsed ?? null,
    compactArtifactSummary: buildCompactArtifactSummary(args.artifact),
  };
}

function includeDebugDiagnosticsByDefault(value: unknown): boolean {
  return value === true;
}

function needsManualSeedForMode(
  mode: CanonicalSimulationInputType,
  payload: ManualUsagePayload | null | undefined
): boolean {
  if (mode === "MANUAL_MONTHLY") return !hasUsableMonthlyPayload(payload);
  if (mode === "MANUAL_ANNUAL") return !hasUsableAnnualPayload(payload);
  return false;
}

function normalizeActiveTravelRanges(args: {
  overrideTravelRanges?: unknown;
  payload?: ManualUsagePayload | null;
  dbTravelRanges?: unknown;
}): Array<{ startDate: string; endDate: string }> {
  if (Array.isArray(args.overrideTravelRanges)) {
    return args.overrideTravelRanges as Array<{ startDate: string; endDate: string }>;
  }
  if (Array.isArray(args.payload?.travelRanges) && args.payload.travelRanges.length > 0) {
    return args.payload.travelRanges;
  }
  if (Array.isArray(args.dbTravelRanges) && args.dbTravelRanges.length > 0) {
    return args.dbTravelRanges as Array<{ startDate: string; endDate: string }>;
  }
  return [];
}

function applyExplicitTravelRangesToManualPayload(
  payload: ManualUsagePayload | null,
  overrideTravelRanges?: unknown
): ManualUsagePayload | null {
  if (!payload || !Array.isArray(overrideTravelRanges)) return payload;
  return {
    ...payload,
    travelRanges: overrideTravelRanges as Array<{ startDate: string; endDate: string }>,
  };
}

function buildMonthlyKwhByMonth(
  payload: ManualUsagePayload | null | undefined
): Map<string, number | null> {
  if (payload?.mode !== "MONTHLY" || !Array.isArray(payload.monthlyKwh)) return new Map();
  return new Map(
    payload.monthlyKwh
      .map((row) => {
        const month = String(row?.month ?? "").slice(0, 7);
        const kwh = typeof row?.kwh === "number" && Number.isFinite(row.kwh) ? row.kwh : null;
        return /^\d{4}-\d{2}$/.test(month) ? ([month, kwh] as const) : null;
      })
      .filter((entry): entry is readonly [string, number | null] => entry != null)
  );
}

function shouldPreferActualDerivedAdminMonthlyPayload(args: {
  savedPayload: ManualUsagePayload | null | undefined;
  actualDerivedPayload: ManualUsagePayload | null | undefined;
}): boolean {
  if (args.savedPayload?.mode !== "MONTHLY" || args.actualDerivedPayload?.mode !== "MONTHLY") return false;
  if (args.savedPayload.dateSourceMode !== "AUTO_DATES") return false;
  const savedByMonth = buildMonthlyKwhByMonth(args.savedPayload);
  for (const row of args.actualDerivedPayload.monthlyKwh) {
    const month = String(row?.month ?? "").slice(0, 7);
    const actualKwh = typeof row?.kwh === "number" && Number.isFinite(row.kwh) ? row.kwh : null;
    if (!/^\d{4}-\d{2}$/.test(month) || actualKwh == null || actualKwh <= 0) continue;
    const savedKwh = savedByMonth.get(month);
    if (savedKwh == null || savedKwh === 0) return true;
  }
  return false;
}

async function buildOnePathAdminManualSeeds(args: {
  userId: string;
  houseId: string;
  actualContextHouseId: string;
  sourceHouseId?: string | null;
  smtSourceEsiid?: string | null;
  payload: ManualUsagePayload | null;
  overrideTravelRanges?: unknown;
  dbTravelRanges?: unknown;
  forceActualDerivedManualPayload?: boolean;
}) {
  const usageTruth = await resolveOnePathUpstreamUsageTruthForSimulation({
    userId: args.userId,
    houseId: args.houseId,
    actualContextHouseId: args.actualContextHouseId,
    smtSourceEsiid: args.smtSourceEsiid ?? null,
    seedIfMissing: false,
  }).catch(() => null);
  const actualEndDate = String(usageTruth?.dataset?.summary?.end ?? "").slice(0, 10) || null;
  const syntheticAnchorEndDate = resolveGapfillSyntheticAnchorEndDate(actualEndDate);
  const activeTravelRanges = normalizeActiveTravelRanges({
    overrideTravelRanges: args.overrideTravelRanges,
    payload: args.payload,
    dbTravelRanges: args.dbTravelRanges,
  });
  const actualDerivedMonthlyResolved = resolveSharedManualStageOneContract({
    mode: "MONTHLY",
    sourcePayload: null,
    actualEndDate: syntheticAnchorEndDate,
    travelRanges: activeTravelRanges,
    dailyRows: usageTruth?.dataset?.daily ?? [],
  });
  const actualDerivedMonthlyPayload =
    actualDerivedMonthlyResolved.payload?.mode === "MONTHLY" ? actualDerivedMonthlyResolved.payload : null;
  const refreshedAutoDateMonthlyPayload =
    actualDerivedMonthlyPayload != null
      ? {
          ...actualDerivedMonthlyPayload,
          dateSourceMode: "AUTO_DATES" as const,
          travelRanges: activeTravelRanges.length > 0 ? activeTravelRanges : actualDerivedMonthlyPayload.travelRanges,
        }
      : null;
  const preferredSourcePayload = args.forceActualDerivedManualPayload
    ? null
    : shouldPreferActualDerivedAdminMonthlyPayload({
        savedPayload: args.payload,
        actualDerivedPayload: actualDerivedMonthlyPayload,
      })
      ? refreshedAutoDateMonthlyPayload
      : args.payload;
  const monthlyResolved = resolveSharedManualStageOneContract({
    mode: "MONTHLY",
    sourcePayload: preferredSourcePayload,
    actualEndDate: syntheticAnchorEndDate,
    travelRanges: activeTravelRanges,
    dailyRows: usageTruth?.dataset?.daily ?? [],
  });
  const annualResolved = resolveSharedManualStageOneContract({
    mode: "ANNUAL",
    sourcePayload: preferredSourcePayload,
    actualEndDate: syntheticAnchorEndDate,
    travelRanges: activeTravelRanges,
    dailyRows: usageTruth?.dataset?.daily ?? [],
  });
  const monthlySeed =
    monthlyResolved.payload?.mode === "MONTHLY"
      ? monthlyResolved.payloadSource === "actual_derived_seed"
        ? reanchorGapfillManualStageOnePayload({
            payload: {
              ...monthlyResolved.payload,
              dateSourceMode: "AUTO_DATES",
              travelRanges: activeTravelRanges.length > 0 ? activeTravelRanges : monthlyResolved.payload.travelRanges,
            },
            anchorEndDate: syntheticAnchorEndDate,
          })
        : monthlyResolved.payload
      : null;
  const annualSeed =
    annualResolved.payload?.mode === "ANNUAL"
      ? annualResolved.payloadSource === "actual_derived_seed"
        ? reanchorGapfillManualStageOnePayload({
            payload: {
              ...annualResolved.payload,
              travelRanges: activeTravelRanges.length > 0 ? activeTravelRanges : annualResolved.payload.travelRanges,
            },
            anchorEndDate: syntheticAnchorEndDate,
          })
        : annualResolved.payload
      : null;
  const derivedMonthlyTotalKwh =
    monthlySeed?.monthlyKwh?.reduce((sum, row) => {
      const kwh = typeof row?.kwh === "number" && Number.isFinite(row.kwh) ? row.kwh : 0;
      return sum + kwh;
    }, 0) ?? null;
  const derivedAnnualTotalKwh =
    typeof annualSeed?.annualKwh === "number" && Number.isFinite(annualSeed.annualKwh)
      ? annualSeed.annualKwh
      : null;
  const effectiveMonthlyPayload = monthlySeed;
  const effectiveAnnualPayload = annualSeed;
  return {
    usageTruth,
    activeTravelRanges,
    seed: {
      sourceMode: monthlyResolved.seedSet.sourceMode ?? annualResolved.seedSet.sourceMode ?? null,
      monthly: monthlySeed,
      annual: annualSeed,
    },
    payloadForMode: {
      MANUAL_MONTHLY: monthlySeed,
      MANUAL_ANNUAL: annualSeed,
    } as const,
    provenance: {
      sourceHouseId: String(args.sourceHouseId ?? args.actualContextHouseId ?? "").trim() || null,
      labHouseId: args.houseId,
      actualContextHouseId: args.actualContextHouseId,
      forceActualDerivedManualPayload: Boolean(args.forceActualDerivedManualPayload),
      savedLabPayloadPresent: Boolean(args.payload),
      savedLabPayloadIgnored: Boolean(args.forceActualDerivedManualPayload && args.payload),
      monthlyPayloadSource: monthlyResolved.payloadSource,
      annualPayloadSource: annualResolved.payloadSource,
      payloadFreshlyDerived:
        monthlyResolved.payloadSource === "actual_derived_seed" ||
        annualResolved.payloadSource === "actual_derived_seed",
      manualPayloadHashMonthly: effectiveMonthlyPayload
        ? hashManualGapfillSavedSeedPayload(effectiveMonthlyPayload)
        : null,
      manualPayloadHashAnnual: effectiveAnnualPayload
        ? hashManualGapfillSavedSeedPayload(effectiveAnnualPayload)
        : null,
      derivedMonthlyTotalKwh,
      derivedAnnualTotalKwh,
    },
  };
}

function asScenarioVariable(value: unknown): {
  kind: string;
  effectiveMonth?: string;
  payloadJson?: Record<string, unknown>;
} | null {
  const item = asRecord(value);
  if (!item) return null;
  const kind = String(item.kind ?? "").trim();
  if (!kind) return null;
  const effectiveMonth = String(item.effectiveMonth ?? "").slice(0, 7);
  return {
    kind,
    effectiveMonth: /^\d{4}-\d{2}$/.test(effectiveMonth) ? effectiveMonth : undefined,
    payloadJson: asRecord(item.payloadJson) ?? undefined,
  };
}

type PastSimReadbackSmtHealingArgs = {
  mode: CanonicalSimulationInputType;
  preferredActualSource?: "SMT" | "GREEN_BUTTON" | null;
  sourceUserId: string;
  sourceHouseId: string;
  sourceEsiid: string | null;
  effectiveHouseId: string;
  actualContextHouseId: string;
  onePathTestHomeState: {
    isPinned: boolean;
    linkedSourceHouseId: string | null;
    linkedSourceUserId: string | null;
  };
};

async function resolveSageActualTruthForRunDisplay(args: {
  userId: string;
  houseId: string;
  actualContextHouseId?: string | null;
  actualContextUserId?: string | null;
  smtSourceEsiid?: string | null;
  preferredActualSource?: "SMT" | "GREEN_BUTTON" | null;
  greenButtonFullYearIntervalsForDisplay?: boolean;
}) {
  return resolveOnePathUpstreamUsageTruthForSimulation({
    userId: args.userId,
    houseId: args.houseId,
    actualContextHouseId: args.actualContextHouseId ?? args.houseId,
    actualContextUserId: args.actualContextUserId ?? null,
    smtSourceEsiid: args.smtSourceEsiid ?? null,
    seedIfMissing: false,
    preferredActualSource: args.preferredActualSource ?? null,
    greenButtonFullYearIntervalsForDisplay: args.greenButtonFullYearIntervalsForDisplay === true,
  }).catch(() => null);
}

async function buildPastReadbackArtifactSummary(args: {
  userId: string;
  houseId: string;
  scenarioId: string;
  exactArtifactInputHash?: string | null;
  actualContextHouseId?: string | null;
  datasetMeta?: Record<string, unknown> | null;
  datasetSummary?: Record<string, unknown> | null;
}) {
  const scenarioId = String(args.scenarioId ?? "").trim();
  const summary = args.datasetSummary ?? {};
  const summaryTotals = asRecord(summary.totals);
  const totalKwhRaw = summary.totalKwh ?? summaryTotals.netKwh ?? null;
  const totalKwh = typeof totalKwhRaw === "number" && Number.isFinite(totalKwhRaw) ? totalKwhRaw : null;
  const coverageStart =
    (typeof summary.coverageStart === "string" && summary.coverageStart) ||
    (typeof summary.start === "string" && summary.start) ||
    null;
  const coverageEnd =
    (typeof summary.coverageEnd === "string" && summary.coverageEnd) ||
    (typeof summary.end === "string" && summary.end) ||
    null;
  const artifactInputHash =
    String(
      args.exactArtifactInputHash ??
        args.datasetMeta?.artifactInputHash ??
        args.datasetMeta?.artifactInputHashUsed ??
        ""
    ).trim() || null;
  const [cacheMeta, buildRec] = await Promise.all([
    artifactInputHash && scenarioId
      ? getPersistedPastArtifactRowMeta({
          houseId: args.houseId,
          scenarioId,
          inputHash: artifactInputHash,
        }).catch(() => null)
      : Promise.resolve(null),
    scenarioId
      ? (prisma as any).usageSimulatorBuild
          .findUnique({
            where: {
              userId_houseId_scenarioKey: {
                userId: args.userId,
                houseId: args.houseId,
                scenarioKey: scenarioId,
              },
            },
            select: { id: true, buildInputsHash: true, createdAt: true, updatedAt: true },
          })
          .catch(() => null)
      : Promise.resolve(null),
  ]);
  return {
    artifactId: cacheMeta?.id ?? (buildRec?.id ? String(buildRec.id) : null),
    buildRowId: buildRec?.id ? String(buildRec.id) : null,
    immutableArtifactKey: buildImmutablePastArtifactKey({ scenarioId, artifactInputHash }),
    artifactInputHash,
    buildInputsHash: buildRec?.buildInputsHash ? String(buildRec.buildInputsHash) : null,
    engineVersion:
      typeof args.datasetMeta?.engineVersion === "string"
        ? String(args.datasetMeta.engineVersion)
        : typeof args.datasetMeta?.simVersion === "string"
          ? String(args.datasetMeta.simVersion)
          : null,
    scenarioId,
    houseId: args.houseId,
    actualContextHouseId: args.actualContextHouseId ?? args.houseId,
    totalKwh,
    coverageStart,
    coverageEnd,
    createdAt:
      cacheMeta?.createdAt?.toISOString() ??
      (buildRec?.createdAt ? new Date(buildRec.createdAt).toISOString() : null),
    updatedAt:
      cacheMeta?.updatedAt?.toISOString() ??
      (buildRec?.updatedAt ? new Date(buildRec.updatedAt).toISOString() : null),
  };
}

/** Reuse adapt-time upstream truth for baseline passthrough runs instead of reloading intervals. */
function resolveSageDatasetForRunDisplay(args: {
  engineInput: CanonicalSimulationEngineInput;
  scenarioId?: string | null;
  isManualMode: boolean;
  preferredActualSource?: "SMT" | "GREEN_BUTTON" | null;
  greenButtonFullYearIntervalsForDisplay?: boolean;
  reloadSageTruth: () => Promise<Awaited<ReturnType<typeof resolveSageActualTruthForRunDisplay>>>;
}) {
  const needsFreshSageTruth =
    Boolean(args.scenarioId) ||
    args.isManualMode ||
    args.greenButtonFullYearIntervalsForDisplay === true;
  if (needsFreshSageTruth) {
    return args.reloadSageTruth();
  }
  const prefetched = args.engineInput.prefetchedBaselineUpstreamUsageTruth?.dataset ?? null;
  if (prefetched) {
    return Promise.resolve({ dataset: prefetched } as Awaited<ReturnType<typeof resolveSageActualTruthForRunDisplay>>);
  }
  return args.reloadSageTruth();
}

function sageDisplayViewArgsFromDataset(dataset: unknown): {
  sageActualDataset: Record<string, unknown> | null;
  sageActualDaily: ReturnType<typeof sageActualDailyRowsFromDataset>;
} {
  return {
    sageActualDataset: dataset && typeof dataset === "object" ? (dataset as Record<string, unknown>) : null,
    sageActualDaily: sageActualDailyRowsFromDataset(dataset),
  };
}

function sageRunDisplayViewArgsFromTruth(
  truth: Awaited<ReturnType<typeof resolveSageActualTruthForRunDisplay>>
): {
  sageActualDataset: Record<string, unknown> | null;
  sageActualDaily: ReturnType<typeof sageActualDailyRowsFromDataset>;
} {
  return sageDisplayViewArgsFromDataset(truth?.dataset);
}

async function preparePastArtifactDatasetForDisplay(args: {
  userId: string;
  houseId: string;
  scenarioId?: string | null;
  dataset: Record<string, unknown> | null | undefined;
  sageActualDataset?: Record<string, unknown> | null;
  smtSlotCompleteDateKeys?: ReadonlySet<string>;
  linkedSourceUserId?: string | null;
  persistDisplayWeatherToCache?: boolean;
}): Promise<PastDisplayWeatherFinalizeOutcome | null> {
  if (!args.dataset) return null;
  const meta = asRecord(args.dataset.meta) ?? {};
  const profileLoad = resolvePastProfileLoadContext({
    dataset: args.dataset,
    requestUserId: args.userId,
    requestHouseId: args.houseId,
    sourceUserId: args.linkedSourceUserId,
  });
  const weatherHouseId = profileLoad.profileHouseId;
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
  return finalizePastDatasetDisplayReadModel({
    dataset: args.dataset,
    sageActualDataset: args.sageActualDataset ?? null,
    smtSlotCompleteDateKeys: args.smtSlotCompleteDateKeys,
    greenButtonTrustedHomeDateKeys:
      greenButtonTrustedHomeDateKeys.size > 0 ? greenButtonTrustedHomeDateKeys : undefined,
    homeProfile,
    applianceProfile,
    weatherHouseId,
    fallbackHouseId: args.houseId,
    scenarioId: String(args.scenarioId ?? meta.scenarioId ?? meta.artifactScenarioId ?? "").trim() || undefined,
    persistDisplayWeatherToCache: args.persistDisplayWeatherToCache === true,
  });
}

function resolveAdminPastWeatherResponse(args: {
  dataset: Record<string, unknown>;
  houseId: string;
  scenarioId: string;
  scenarioName?: string | null;
  compareProjection?: Record<string, unknown> | null;
  finalizeOutcome?: PastDisplayWeatherFinalizeOutcome | null;
}) {
  const weatherHouseId = resolvePastWeatherHouseIdFromDataset({
    dataset: args.dataset,
    fallbackHouseId: args.houseId,
  });
  return resolvePastVisibleWeatherScore({
    finalizedDataset: args.dataset,
    routeOwner: "app/api/admin/tools/one-path-sim/route.ts",
    scenarioName: args.scenarioName ?? "Past (Corrected)",
    scenarioId: args.scenarioId,
    requestedHouseId: args.houseId,
    weatherHouseId,
    compareProjection: args.compareProjection ?? null,
    finalizeOutcome: args.finalizeOutcome ?? null,
  });
}

async function sageAndStaleIncompleteDisplayArgs(args: {
  sageDataset: unknown;
  datasetForMeta: Record<string, unknown> | null | undefined;
  smtSourceEsiid: string | null | undefined;
  preferredActualSource?: "SMT" | "GREEN_BUTTON" | null;
}) {
  const sageDisplayArgs = sageDisplayViewArgsFromDataset(args.sageDataset);
  if (args.preferredActualSource === "GREEN_BUTTON") {
    return { ...sageDisplayArgs, smtSlotCompleteDateKeys: undefined };
  }
  const smtSlotCompleteDateKeys = await resolveStaleIncompleteMeterSlotCompleteDateKeys({
    esiid: args.smtSourceEsiid,
    meta: asRecord(args.datasetForMeta)?.meta ?? args.datasetForMeta,
  });
  return { ...sageDisplayArgs, smtSlotCompleteDateKeys };
}

function resolveSkipSageTruthReloadDecision(args: {
  exactArtifactInputHash?: string | null;
  embeddedCompareRowCount: number;
  needsFullYearActualIntervalsForDiagnostics: boolean;
}): { canSkip: boolean; reason: string } {
  if (args.needsFullYearActualIntervalsForDiagnostics) {
    return { canSkip: false, reason: "posthoc_top_miss_interval_curves_requested" };
  }
  if (!String(args.exactArtifactInputHash ?? "").trim()) {
    return { canSkip: false, reason: "missing_exact_artifact_input_hash" };
  }
  if (args.embeddedCompareRowCount <= 0) {
    return { canSkip: false, reason: "missing_embedded_validation_compare_rows" };
  }
  return { canSkip: true, reason: "exact_hash_with_embedded_validation_compare_rows" };
}

async function buildPastSimRunReadbackResponse(args: {
  userId: string;
  houseId: string;
  scenarioId: string;
  correlationId?: string | null;
  readMode?: "artifact_only" | "allow_rebuild";
  exactArtifactInputHash?: string | null;
  smtPostSimHealing?: PastSimReadbackSmtHealingArgs | null;
  actualContextHouseId?: string | null;
  preferredActualSource?: "SMT" | "GREEN_BUTTON" | null;
  smtSourceEsiid?: string | null;
  linkedSourceUserId?: string | null;
  linkedSourceHouseId?: string | null;
  linkedSourceScenarioId?: string | null;
  includePosthocTopMissIntervalCurves?: boolean;
  disableArtifactRebuildFallback?: boolean;
}) {
  const startedAt = Date.now();
  const preserveLabDualRunActualContext =
    typeof args.actualContextHouseId === "string" &&
    args.actualContextHouseId.trim().length > 0 &&
    args.actualContextHouseId.trim() !== args.houseId;
  const readScenarioDataset = (
    mode: "artifact_only" | "allow_rebuild",
    forceRebuildArtifact = false
  ) =>
    readOnePathSimulatedUsageScenario({
      userId: args.userId,
      houseId: args.houseId,
      scenarioId: args.scenarioId,
      readMode: mode,
      forceRebuildArtifact,
      exactArtifactInputHash: args.exactArtifactInputHash ?? undefined,
      requireExactArtifactMatch: Boolean(args.exactArtifactInputHash),
      projectionMode: "baseline",
      readContext: {
        artifactReadMode: mode,
        projectionMode: "baseline",
        compareSidecarRequest: true,
        // One Path dual-run: test home sim reads mirrored build inputs whose actualContextHouseId
        // points at the source house. User-site isolation would reset that anchor and break identity.
        userSiteIsolation: !preserveLabDualRunActualContext,
      },
    });

  let readModeUsed: "artifact_only" | "allow_rebuild" = args.readMode ?? "artifact_only";
  logSimPipelineEvent("one_path_admin_past_readback_start", {
    correlationId: args.correlationId ?? null,
    houseId: args.houseId,
    scenarioId: args.scenarioId,
    readMode: readModeUsed,
    source: "buildPastSimRunReadbackResponse",
    memoryRssMb: getMemoryRssMb(),
  });

  let readback = await readScenarioDataset(readModeUsed);
  if (
    !readback.ok &&
    readback.code === "ARTIFACT_MISSING" &&
    readModeUsed === "artifact_only" &&
    args.disableArtifactRebuildFallback !== true
  ) {
    readModeUsed = "allow_rebuild";
    readback = await readScenarioDataset("allow_rebuild");
  }
  if (!readback.ok) {
    logSimPipelineEvent("one_path_admin_past_readback_failure", {
      correlationId: args.correlationId ?? null,
      houseId: args.houseId,
      scenarioId: args.scenarioId,
      readMode: readModeUsed,
      code: readback.code,
      durationMs: Date.now() - startedAt,
      source: "buildPastSimRunReadbackResponse",
      memoryRssMb: getMemoryRssMb(),
    });
    return {
      ok: false as const,
      code: readback.code,
      message: readback.message,
    };
  }

  logSimPipelineEvent("one_path_admin_past_readback_success", {
    correlationId: args.correlationId ?? null,
    houseId: args.houseId,
    scenarioId: args.scenarioId,
    readMode: readModeUsed,
    durationMs: Date.now() - startedAt,
    source: "buildPastSimRunReadbackResponse",
    memoryRssMb: getMemoryRssMb(),
  });
  const sidecarStartedAt = Date.now();
  const artifactDataset = asRecord(readback.dataset) ?? {};
  const artifactMeta = asRecord(artifactDataset.meta) ?? {};
  const buildInputsForCompare = await loadPastSimBuildInputsForRead({
    userId: args.userId,
    houseId: args.houseId,
    scenarioId: args.scenarioId,
  });
  const preferredActualSourceForCompare = resolvePastSimPreferredActualSource({
    preferredActualSource:
      args.preferredActualSource ?? args.smtPostSimHealing?.preferredActualSource ?? null,
    dataset: readback.dataset,
    buildInputs: buildInputsForCompare,
  });
  const sageGbFullIntervals =
    preferredActualSourceForCompare === "GREEN_BUTTON";
  const needsFullYearActualIntervalsForDiagnostics = args.includePosthocTopMissIntervalCurves === true;
  const embeddedCompareRows = Array.isArray(artifactMeta.validationCompareRows)
    ? artifactMeta.validationCompareRows
    : [];
  const canReuseEmbeddedCompareSidecar =
    embeddedCompareRows.length > 0 && !needsFullYearActualIntervalsForDiagnostics;
  const skipSageTruthReloadDecision = resolveSkipSageTruthReloadDecision({
    exactArtifactInputHash: args.exactArtifactInputHash,
    embeddedCompareRowCount: embeddedCompareRows.length,
    needsFullYearActualIntervalsForDiagnostics,
  });
  const canSkipSageTruthReload = skipSageTruthReloadDecision.canSkip;
  const skipSageTruthReloadReason = skipSageTruthReloadDecision.reason;
  logSimPipelineEvent("one_path_admin_past_compare_sidecar_start", {
    correlationId: args.correlationId ?? null,
    houseId: args.houseId,
    scenarioId: args.scenarioId,
    includePosthocTopMissIntervalCurves: needsFullYearActualIntervalsForDiagnostics,
    skipFullYearActualIntervalReload: !needsFullYearActualIntervalsForDiagnostics,
    reuseEmbeddedCompareSidecar: canReuseEmbeddedCompareSidecar,
    skipSageTruthReload: canSkipSageTruthReload,
    skipSageTruthReloadReason,
    source: "buildPastSimRunReadbackResponse",
    memoryRssMb: getMemoryRssMb(),
  });
  const actualContextHouseIdForCompare =
    args.actualContextHouseId ?? args.smtPostSimHealing?.actualContextHouseId ?? args.houseId;
  const sourceTruthReloadStartedAt = Date.now();
  const sageTruthForCompare = canSkipSageTruthReload
    ? null
    : await resolveSageActualTruthForRunDisplay({
        userId: args.userId,
        houseId: args.houseId,
        actualContextHouseId: actualContextHouseIdForCompare,
        actualContextUserId: args.linkedSourceUserId ?? null,
        smtSourceEsiid: args.smtSourceEsiid ?? args.smtPostSimHealing?.sourceEsiid ?? null,
        preferredActualSource: preferredActualSourceForCompare,
        greenButtonFullYearIntervalsForDisplay: sageGbFullIntervals,
      });
  const sourceTruthReloadDurationMs = canSkipSageTruthReload ? 0 : Date.now() - sourceTruthReloadStartedAt;
  const actualDatasetForIntervalCompare = needsFullYearActualIntervalsForDiagnostics
    ? await resolveActualDatasetForCompareDiagnostics({
        userId: args.linkedSourceUserId ?? args.userId,
        actualContextHouseId: actualContextHouseIdForCompare,
        esiid: args.smtSourceEsiid ?? args.smtPostSimHealing?.sourceEsiid ?? null,
        preferredActualSource: preferredActualSourceForCompare,
        baseDataset: sageTruthForCompare?.dataset ?? null,
      })
    : canSkipSageTruthReload
      ? null
      : sageTruthForCompare?.dataset && typeof sageTruthForCompare.dataset === "object"
        ? (sageTruthForCompare.dataset as Record<string, unknown>)
        : null;
  const compareProjection = canReuseEmbeddedCompareSidecar
    ? buildValidationCompareProjectionSidecar(artifactDataset)
    : resolveValidationCompareProjectionForRead({
        dataset: readback.dataset,
        actualDataset: sageTruthForCompare?.dataset ?? null,
        displayDataset: readback.dataset,
        buildInputs: buildInputsForCompare,
      });
  logSimPipelineEvent("one_path_admin_past_compare_sidecar_success", {
    correlationId: args.correlationId ?? null,
    houseId: args.houseId,
    scenarioId: args.scenarioId,
    rowCount: Array.isArray(compareProjection.rows) ? compareProjection.rows.length : 0,
    durationMs: Date.now() - sidecarStartedAt,
    reuseEmbeddedCompareSidecar: canReuseEmbeddedCompareSidecar,
    skipSageTruthReload: canSkipSageTruthReload,
    skipSageTruthReloadReason,
    sourceTruthReloadDurationMs,
    source: "buildPastSimRunReadbackResponse",
    memoryRssMb: getMemoryRssMb(),
  });
  const scenarioEventsStartedAt = Date.now();
  const scenarioEvents = await listOnePathScenarioEvents({
    userId: args.userId,
    houseId: args.houseId,
    scenarioId: args.scenarioId,
  }).catch(() => ({ ok: false as const, events: [] as unknown[] }));
  logSimPipelineEvent("one_path_admin_past_scenario_events_success", {
    correlationId: args.correlationId ?? null,
    houseId: args.houseId,
    scenarioId: args.scenarioId,
    ok: scenarioEvents.ok,
    eventCount: scenarioEvents.ok && Array.isArray(scenarioEvents.events) ? scenarioEvents.events.length : 0,
    durationMs: Date.now() - scenarioEventsStartedAt,
    source: "buildPastSimRunReadbackResponse",
    memoryRssMb: getMemoryRssMb(),
  });
  const displayViewStartedAt = Date.now();
  const sageTruth = sageTruthForCompare;
  const sageDisplayArgs = await sageAndStaleIncompleteDisplayArgs({
    sageDataset: sageTruth?.dataset,
    datasetForMeta: asRecord(readback.dataset),
    smtSourceEsiid: args.smtSourceEsiid ?? args.smtPostSimHealing?.sourceEsiid ?? null,
    preferredActualSource: preferredActualSourceForCompare,
  });
  const finalizeOutcome = await preparePastArtifactDatasetForDisplay({
    userId: args.userId,
    houseId: args.houseId,
    scenarioId: args.scenarioId,
    dataset: artifactDataset,
    sageActualDataset: canSkipSageTruthReload ? null : asRecord(sageTruth?.dataset),
    smtSlotCompleteDateKeys: sageDisplayArgs.smtSlotCompleteDateKeys,
    linkedSourceUserId: args.linkedSourceUserId,
    persistDisplayWeatherToCache: false,
  });
  const pastWeather = resolveAdminPastWeatherResponse({
    dataset: artifactDataset,
    houseId: args.houseId,
    scenarioId: args.scenarioId,
    compareProjection,
    finalizeOutcome,
  });
  const runDisplayViewBase = applyFinalizedPastVisibleWeatherToRunDisplayView(
    buildOnePathRunReadOnlyView({
      dataset: artifactDataset,
      readModel: { compareProjection },
      ...sageDisplayArgs,
    }) ?? null,
    pastWeather
  );
  logSimPipelineEvent("one_path_admin_past_display_view_success", {
    correlationId: args.correlationId ?? null,
    houseId: args.houseId,
    scenarioId: args.scenarioId,
    hasDisplayView: runDisplayViewBase != null,
    durationMs: Date.now() - displayViewStartedAt,
    source: "buildPastSimRunReadbackResponse",
    memoryRssMb: getMemoryRssMb(),
  });
  const travelCoverageWindow = resolveCanonicalUsage365CoverageWindow();
  const pastVariables =
    scenarioEvents.ok && Array.isArray(scenarioEvents.events)
      ? scenarioEvents.events
          .map((event) => asScenarioVariable(event))
          .filter((event): event is NonNullable<ReturnType<typeof asScenarioVariable>> => {
            if (!event) return false;
            if (event.kind !== "TRAVEL_RANGE") return true;
            const payload = event.payloadJson ?? {};
            return travelRangeIsActiveForCoverageWindow(
              {
                startDate: payload.startDate,
                endDate: payload.endDate,
              },
              travelCoverageWindow
            );
          })
      : [];

  const compactRunDisplayView =
    runDisplayViewBase != null
      ? {
          ...runDisplayViewBase,
          pastVariables,
        }
      : null;
  const pastWeatherApiFields = buildAdminPastWeatherApiFields(pastWeather);
  const skipCrossSurfaceWeatherAudit = Boolean(args.exactArtifactInputHash);
  const pastWeatherCrossSurfaceParity =
    !skipCrossSurfaceWeatherAudit &&
    args.linkedSourceUserId &&
    args.linkedSourceHouseId &&
    args.linkedSourceScenarioId &&
    artifactDataset
      ? await (
          await import("@/lib/usage/pastWeatherCrossSurfaceParity.server")
        ).auditPastWeatherCrossSurfaceParity({
          sourceUserId: args.linkedSourceUserId,
          sourceHouseId: args.linkedSourceHouseId,
          sourceScenarioId: args.linkedSourceScenarioId,
          sourceArtifactInputHash: null,
          adminDataset: artifactDataset,
          adminUserId: args.userId,
          adminHouseId: args.houseId,
        })
      : null;
  const artifactDatasetSummary = asRecord(artifactDataset.summary);
  const readbackArtifact = await buildPastReadbackArtifactSummary({
    userId: args.userId,
    houseId: args.houseId,
    scenarioId: args.scenarioId,
    exactArtifactInputHash: args.exactArtifactInputHash,
    actualContextHouseId: actualContextHouseIdForCompare,
    datasetMeta: artifactMeta,
    datasetSummary: artifactDatasetSummary,
  });
  const responseBuildDurationMs = Date.now() - startedAt;
  const pastReadbackPerformance = {
    skipSageTruthReload: canSkipSageTruthReload,
    skipSageTruthReloadReason,
    sourceTruthReloadDurationMs,
    responseBuildDurationMs,
    responseApproxSizeKb: null as number | null,
  };
  const responsePayload = {
    ok: true as const,
    debugDiagnosticsIncluded: false,
    executionMode: args.exactArtifactInputHash ? ("past_recalc_readback" as const) : ("artifact_readback" as const),
    readbackPending: false,
    runType: "PAST_SIM" as const,
    correlationId: args.correlationId ?? null,
    engineInput: {
      scenarioId: args.scenarioId,
      houseId: args.houseId,
      actualContextHouseId: actualContextHouseIdForCompare,
    },
    manualStageOneView: null,
    runDisplayView: compactRunDisplayView,
    ...pastWeatherApiFields,
    pastWeatherCrossSurfaceParity,
    artifact: readbackArtifact,
    onePathIntervalDiagnosticsV1: buildOnePathIntervalDiagnosticsForPastResponse({
      mode: preferredActualSourceForCompare === "GREEN_BUTTON" ? "GREEN_BUTTON" : "INTERVAL",
      preferredActualSource: preferredActualSourceForCompare,
      actualDataset: actualDatasetForIntervalCompare ?? sageTruthForCompare?.dataset ?? null,
      simulatedDataset: artifactDataset,
      compareProjection,
      pastVariables,
      includePosthocTopMissIntervalCurves: args.includePosthocTopMissIntervalCurves === true,
    }),
    readModel: {
      ...buildCompactSimulationReadModel({
        artifact: readbackArtifact,
        artifactDataset,
        artifactDatasetMeta: artifactMeta,
        runDisplayView: compactRunDisplayView,
        compareProjection,
      }),
      sageActualDataset: null,
      sageActualDaily: sageDisplayArgs.sageActualDaily ?? null,
    },
    pastReadbackPerformance,
  };
  try {
    pastReadbackPerformance.responseApproxSizeKb = Math.round(
      Buffer.byteLength(JSON.stringify(responsePayload), "utf8") / 1024
    );
  } catch {
    pastReadbackPerformance.responseApproxSizeKb = null;
  }
  logSimPipelineEvent("one_path_admin_past_response_ready", {
    correlationId: args.correlationId ?? null,
    houseId: args.houseId,
    scenarioId: args.scenarioId,
    pastVariableCount: pastVariables.length,
    durationMs: responseBuildDurationMs,
    skipSageTruthReload: canSkipSageTruthReload,
    skipSageTruthReloadReason,
    sourceTruthReloadDurationMs,
    responseBuildDurationMs,
    responseApproxSizeKb: pastReadbackPerformance.responseApproxSizeKb,
    source: "buildPastSimRunReadbackResponse",
    memoryRssMb: getMemoryRssMb(),
  });
  return responsePayload;
}

function buildEnvironmentVisibility() {
  return {
    homeDetails: {
      envVarName: "HOME_DETAILS_DATABASE_URL",
      envVarPresent: Boolean(process.env.HOME_DETAILS_DATABASE_URL),
      owner: "lib/db/homeDetailsClient.ts -> @prisma/home-details-client",
    },
    appliances: {
      envVarName: "APPLIANCES_DATABASE_URL",
      envVarPresent: Boolean(process.env.APPLIANCES_DATABASE_URL),
      owner: "lib/db/appliancesClient.ts -> @prisma/appliances-client",
    },
    usage: {
      envVarName: "USAGE_DATABASE_URL",
      envVarPresent: Boolean(process.env.USAGE_DATABASE_URL),
      owner: "lib/db/usageClient.ts -> .prisma/usage-client",
    },
  };
}

function usageDbUnavailableResponse(args: {
  usageTruthSource: unknown;
  seedResult: unknown;
  upstreamUsageTruth: unknown;
  message?: string;
}) {
  const environmentVisibility = buildEnvironmentVisibility();
  const runtimeEnvParityTrace = buildRuntimeEnvParityTrace({
    environmentVisibility,
  });
  return NextResponse.json(
    {
      ok: false,
      error: "usage_db_unavailable",
      usageTruthSource: args.usageTruthSource,
      seedResult: args.seedResult,
      upstreamUsageTruth: args.upstreamUsageTruth,
      environmentVisibility,
      runtimeEnvParityTrace,
      message:
        args.message ??
        "The shared usage database is unavailable in this runtime, so persisted usage truth cannot be read.",
    },
    { status: 503 }
  );
}

async function loadGreenButtonUploadSummary(houseId: string | null | undefined) {
  if (!houseId) return null;
  const prismaAny = prisma as any;
  const latestUpload = await prismaAny.greenButtonUpload
    .findFirst({
      where: { houseId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        createdAt: true,
        updatedAt: true,
        parseStatus: true,
        parseMessage: true,
        dateRangeStart: true,
        dateRangeEnd: true,
        intervalMinutes: true,
        fileName: true,
        fileSizeBytes: true,
      },
    })
    .catch(() => null);

  const coverage = await (usagePrisma as any)?.greenButtonInterval
    ?.aggregate({
      where: { homeId: houseId },
      _count: { _all: true },
      _min: { timestamp: true },
      _max: { timestamp: true },
    })
    .catch(() => null);

  const derivedCoverage =
    coverage && (coverage._count?._all ?? 0) > 0
      ? {
          start: coverage._min?.timestamp ?? null,
          end: coverage._max?.timestamp ?? null,
          count: coverage._count?._all ?? 0,
        }
      : null;

  const anchorEndDateKey = await getLatestGreenButtonFullDayDateKey({ houseId }).catch(() => null);
  const displayDateRange =
    anchorEndDateKey != null
      ? resolveGreenButtonUploadRecordDateRange({
          endDateKey: anchorEndDateKey,
          fallbackStart: derivedCoverage?.start ?? latestUpload?.dateRangeStart ?? null,
          fallbackEnd: derivedCoverage?.end ?? latestUpload?.dateRangeEnd ?? null,
        })
      : null;

  const displayWindow = anchorEndDateKey != null ? resolveGreenButtonDisplayWindow(anchorEndDateKey) : null;

  if (latestUpload) {
    return {
      ...latestUpload,
      dateRangeStart:
        displayDateRange?.dateRangeStart ??
        derivedCoverage?.start ??
        latestUpload.dateRangeStart ??
        null,
      dateRangeEnd:
        displayDateRange?.dateRangeEnd ?? derivedCoverage?.end ?? latestUpload.dateRangeEnd ?? null,
      intervalCount: derivedCoverage?.count ?? 0,
      hasPersistedUsageIntervals: Boolean(derivedCoverage),
      latestCompleteLocalDay: anchorEndDateKey,
      baselineWindowStartKey: displayWindow?.startDate ?? null,
      baselineWindowEndKey: displayWindow?.endDate ?? null,
    };
  }

  if (!derivedCoverage) return null;
  return {
    id: "derived-coverage",
    createdAt: derivedCoverage.start ?? null,
    updatedAt: derivedCoverage.end ?? null,
    parseStatus: "complete",
    parseMessage: null,
    dateRangeStart: displayDateRange?.dateRangeStart ?? derivedCoverage.start,
    dateRangeEnd: displayDateRange?.dateRangeEnd ?? derivedCoverage.end,
    intervalMinutes: 15,
    fileName: "derived",
    fileSizeBytes: null,
    intervalCount: derivedCoverage.count,
    hasPersistedUsageIntervals: true,
    latestCompleteLocalDay: anchorEndDateKey,
    baselineWindowStartKey: displayWindow?.startDate ?? null,
    baselineWindowEndKey: displayWindow?.endDate ?? null,
  };
}

function jsonForLog(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

async function waitForOnePathSmtTailCoverage(args: {
  esiid: string;
  targetEndDate: string;
  correlationId: string;
  effectiveHouseId: string;
  actualContextHouseId: string;
  sourceUserId: string;
}) {
  const waitResult = await waitForSmtTailCoverage({
    esiid: args.esiid,
    targetEndDate: args.targetEndDate,
    timeoutMs: ONE_PATH_ADMIN_SMT_TAIL_WAIT_TIMEOUT_MS,
    intervalMs: SMT_TAIL_WAIT_INTERVAL_MS,
  });
  const latest = waitResult;
  const durationMs = waitResult.durationMs;
  const attempts = waitResult.attempts;
  logSimPipelineEvent("one_path_smt_tail_backfill_wait_complete", {
    correlationId: args.correlationId,
    houseId: args.effectiveHouseId,
    sourceHouseId: args.actualContextHouseId !== args.effectiveHouseId ? args.actualContextHouseId : undefined,
    sourceUserId: args.sourceUserId,
    sourceEsiid: args.esiid,
    durationMs,
    attempts,
    targetEndDate: args.targetEndDate,
    coverageStartDate: latest.coverageStartDate,
    coverageEndDate: latest.coverageEndDate,
    coverageStartUtcDate: latest.coverageStartUtcDate,
    coverageEndUtcDate: latest.coverageEndUtcDate,
    tailStartDate: latest.tailStartDate,
    tailReady: latest.tailReady,
    incompleteTailDateKeys: latest.incompleteTailDateKeys.join(","),
    tailCountsByDate: jsonForLog(latest.tailCountsByDate),
    timedOut: !latest.tailReady,
    source: "one-path-admin",
    memoryRssMb: getMemoryRssMb(),
  });
  return {
    ...latest,
    durationMs,
    attempts,
    timedOut: !latest.tailReady,
  };
}

async function buildOnePathSmtRefreshCheckFromEnsure(
  ensure: EnsureSmtCoverageResult,
  args: {
    correlationId: string;
    effectiveHouseId: string;
    actualContextHouseId: string;
    sourceUserId: string;
    sourceEsiid: string;
  }
) {
  const persistedSpan = await resolveSmtPersistedCoverageSpan(args.sourceEsiid).catch(() => null);
  logSimPipelineEvent("one_path_smt_tail_backfill_check", {
    correlationId: args.correlationId,
    houseId: args.effectiveHouseId,
    sourceHouseId: args.actualContextHouseId !== args.effectiveHouseId ? args.actualContextHouseId : undefined,
    sourceUserId: args.sourceUserId,
    sourceEsiid: args.sourceEsiid,
    targetEndDate: ensure.window.endDate,
    persistedSpanEndDate: persistedSpan?.endDate ?? null,
    incompleteDateKeys: ensure.dayStatus.incompleteDateKeys.join(","),
    backfillDateKeys: (ensure.backfillDateKeys ?? []).join(","),
    tailWaitTimedOut: Boolean(ensure.tailWaitTimedOut),
    healed: ensure.healed,
    skippedReason: ensure.skippedReason ?? null,
    source: "one-path-admin",
    memoryRssMb: getMemoryRssMb(),
  });

  if (!ensure.healed) {
    return {
      attempted: false,
      reason: ensure.skippedReason === "session_throttle" ? "coverage_tail_current" : "coverage_tail_current",
      coverageStartDate: null,
      coverageEndDate: ensure.dayStatus.window.endDate,
      targetEndDate: ensure.window.endDate,
      wait: null,
      ensure,
    };
  }

  logSimPipelineEvent("one_path_smt_tail_backfill_requested", {
    correlationId: args.correlationId,
    houseId: args.effectiveHouseId,
    sourceUserId: args.sourceUserId,
    sourceEsiid: args.sourceEsiid,
    targetEndDate: ensure.window.endDate,
    backfillDateKeys: (ensure.backfillDateKeys ?? []).join(","),
    refreshOk: ensure.refreshResult?.ok,
    source: "one-path-admin",
    memoryRssMb: getMemoryRssMb(),
  });

  return {
    attempted: true,
    coverageStartDate: ensure.window.startDate,
    coverageEndDate: ensure.window.endDate,
    targetEndDate: ensure.window.endDate,
    result: ensure.refreshResult,
    wait: {
      tailReady: ensure.dayStatus.canonicalEndDayComplete,
      timedOut: Boolean(ensure.tailWaitTimedOut || ensure.incompleteMeterWaitTimedOut),
    },
    ensure,
  };
}

function extractIncompleteMeterDateKeysFromDataset(dataset: unknown): string[] {
  const record = asRecord(dataset);
  const daily = Array.isArray(record?.daily) ? record.daily : [];
  const seriesRecord = asRecord(record?.series);
  const seriesDaily = Array.isArray(seriesRecord?.daily) ? seriesRecord.daily : [];
  const metaRecord = asRecord(record?.meta);
  const simulatedSourceDetailByDate = asRecord(metaRecord?.simulatedSourceDetailByDate);
  const values: string[] = [];
  for (const row of [...daily, ...seriesDaily]) {
    const rowRecord = asRecord(row);
    const sourceDetail = String(rowRecord?.sourceDetail ?? "").trim();
    if (sourceDetail !== "SIMULATED_INCOMPLETE_METER") continue;
    values.push(String(rowRecord?.date ?? rowRecord?.timestamp ?? "").slice(0, 10));
  }
  for (const [dateKey, sourceDetail] of Object.entries(simulatedSourceDetailByDate ?? {})) {
    if (sourceDetail === "SIMULATED_INCOMPLETE_METER") values.push(dateKey);
  }
  return normalizeDateKeys(values);
}

type OnePathSmtPostSimHealingResult = {
  attempted: boolean;
  repairKind?: "ensure_smt_coverage";
  pullDateKey: string;
  requestedDateKeys: string[];
  refreshResult?: UsageRefreshResult;
  waitTimedOut?: boolean;
  targetedIntervalBackfill?: EnsureSmtCoverageResult["targetedBackfill"];
  postTargetedBackfillRefreshResult?: UsageRefreshResult;
  reconcile?: EnsureSmtCoverageResult["reconcile"];
  ensure?: EnsureSmtCoverageResult;
};

function buildOnePathPostSimHealFromEnsure(
  ensure: EnsureSmtCoverageResult,
  args: {
    correlationId: string;
    effectiveHouseId: string;
    actualContextHouseId: string;
    sourceUserId: string;
    sourceEsiid: string;
  }
): OnePathSmtPostSimHealingResult | null {
  logSimPipelineEvent("one_path_smt_post_sim_heal", {
    correlationId: args.correlationId,
    houseId: args.effectiveHouseId,
    sourceHouseId: args.actualContextHouseId !== args.effectiveHouseId ? args.actualContextHouseId : undefined,
    sourceUserId: args.sourceUserId,
    sourceEsiid: args.sourceEsiid,
    healed: ensure.healed,
    skippedReason: ensure.skippedReason ?? null,
    backfillDateKeys: (ensure.backfillDateKeys ?? []).join(","),
    incompleteDateKeys: ensure.dayStatus.incompleteDateKeys.join(","),
    source: "one-path-admin",
    memoryRssMb: getMemoryRssMb(),
  });

  if (!ensure.healed) {
    return null;
  }

  const requestedDateKeys = ensure.backfillDateKeys ?? [];
  return {
    attempted: true,
    repairKind: "ensure_smt_coverage",
    pullDateKey: chicagoPullDateKey(),
    requestedDateKeys,
    refreshResult: ensure.refreshResult?.ok === false ? undefined : ensure.refreshResult,
    waitTimedOut: Boolean(ensure.tailWaitTimedOut || ensure.incompleteMeterWaitTimedOut),
    targetedIntervalBackfill: ensure.targetedBackfill,
    postTargetedBackfillRefreshResult:
      ensure.postTargetedBackfillRefreshResult?.ok === false
        ? undefined
        : ensure.postTargetedBackfillRefreshResult,
    reconcile: ensure.reconcile,
    ensure,
  };
}

type OnePathIncompleteMeterBackfillRetry = OnePathSmtPostSimHealingResult & {
  postRetryIncompleteDateKeys?: string[];
};

/** Green Button usage truth for One Path: pinned lab uploads land on the test home, not the source. */
function resolveOnePathGreenButtonUsageContext(args: {
  onePathTestHomeState: {
    isPinned: boolean;
    testHomeHouseId: string;
    testHomeHouse?: { id: string; label: string; esiid: string | null } | null;
  };
  effectiveUserId: string;
  effectiveHouseId: string;
  resolved: {
    userId: string;
    selectedHouse: { id: string; label?: string | null; esiid?: string | null };
  };
}): { userId: string; houseId: string; house: { id: string; label?: string | null; esiid?: string | null } } {
  if (args.onePathTestHomeState.isPinned && args.effectiveHouseId) {
    return {
      userId: args.effectiveUserId,
      houseId: args.effectiveHouseId,
      house: {
        id: args.effectiveHouseId,
        label: args.onePathTestHomeState.testHomeHouse?.label ?? ONE_PATH_LAB_TEST_HOME_LABEL,
        esiid: args.onePathTestHomeState.testHomeHouse?.esiid ?? null,
      },
    };
  }
  return {
    userId: args.resolved.userId,
    houseId: args.resolved.selectedHouse.id,
    house: {
      id: args.resolved.selectedHouse.id,
      label: args.resolved.selectedHouse.label ?? null,
      esiid: args.resolved.selectedHouse.esiid ?? null,
    },
  };
}

/** Green Button actual context is always the One Path test/selected home — never a silent source-house donor. */
function resolveOnePathGreenButtonActualContextForUsage(args: {
  resolved: {
    userId: string;
    selectedHouse: { id: string; label?: string | null; esiid?: string | null };
  };
  onePathTestHomeState: {
    isPinned: boolean;
    testHomeHouseId: string;
    testHomeHouse?: { id: string; label: string; esiid: string | null } | null;
  };
  effectiveUserId: string;
  effectiveHouseId: string;
}): { userId: string; houseId: string; house: { id: string; label?: string | null; esiid?: string | null } } {
  return resolveOnePathGreenButtonUsageContext(args);
}

async function resolveOnePathUpstreamGreenButtonUsageTruth(args: {
  runtimeUserId: string;
  runtimeHouseId: string;
  actualContextUserId: string;
  actualContextHouseId: string;
  smtSourceEsiid: string | null;
  seedIfMissing: boolean;
}) {
  return resolveOnePathUpstreamUsageTruthForSimulation({
    userId: args.runtimeUserId,
    houseId: args.runtimeHouseId,
    actualContextHouseId: args.actualContextHouseId,
    actualContextUserId: args.actualContextUserId,
    smtSourceEsiid: args.smtSourceEsiid,
    seedIfMissing: args.seedIfMissing,
    preferredActualSource: "GREEN_BUTTON",
  }).catch(() => null);
}

/** SMT pull/backfill must run on a house with ESIID + authorization; pinned lab homes keep esiid null by design. */
function resolveOnePathGreenButtonParitySource(args: {
  resolved: {
    userId: string;
    selectedHouse: { id: string; label?: string | null; esiid?: string | null };
  };
  onePathTestHomeState: {
    isPinned: boolean;
    linkedSourceHouseId: string | null;
    linkedSourceUserId: string | null;
  };
}): { userId: string; house: { id: string; label?: string | null; esiid?: string | null } } {
  if (
    args.onePathTestHomeState.isPinned &&
    args.onePathTestHomeState.linkedSourceHouseId &&
    args.onePathTestHomeState.linkedSourceUserId
  ) {
    return {
      userId: args.onePathTestHomeState.linkedSourceUserId,
      house: {
        id: args.onePathTestHomeState.linkedSourceHouseId,
        label: args.resolved.selectedHouse.label ?? null,
        esiid: args.resolved.selectedHouse.esiid ?? null,
      },
    };
  }
  return {
    userId: args.resolved.userId,
    house: {
      id: args.resolved.selectedHouse.id,
      label: args.resolved.selectedHouse.label ?? null,
      esiid: args.resolved.selectedHouse.esiid ?? null,
    },
  };
}

/** Lookup/run actual context: SMT stays on source when pinned; Green Button prefers the lab test home upload. */
function resolveOnePathLookupActualContext(args: {
  resolved: {
    userId: string;
    selectedHouse: { id: string; label?: string | null; esiid?: string | null };
    houses: Array<{ id: string; label?: string | null; esiid?: string | null }>;
  };
  onePathTestHomeState: {
    isPinned: boolean;
    linkedSourceHouseId: string | null;
    linkedSourceUserId: string | null;
    testHomeHouseId: string;
    testHomeHouse?: { id: string; label: string; esiid: string | null } | null;
  };
  effectiveUserId: string;
  effectiveHouseId: string;
  previewMode?: CanonicalSimulationInputType;
  defaultActualContextHouseId: string;
  defaultActualContextUserId: string;
  bodyActualContextHouseId?: string | null;
}): {
  houseId: string;
  userId: string;
  house: { id: string; label?: string | null; esiid?: string | null };
} {
  if (args.previewMode === "GREEN_BUTTON" && args.onePathTestHomeState.isPinned && args.effectiveHouseId) {
    const gb = resolveOnePathGreenButtonUsageContext({
      resolved: args.resolved,
      onePathTestHomeState: args.onePathTestHomeState,
      effectiveUserId: args.effectiveUserId,
      effectiveHouseId: args.effectiveHouseId,
    });
    return {
      houseId: gb.houseId,
      userId: gb.userId,
      house: gb.house,
    };
  }
  if (args.onePathTestHomeState.isPinned && args.onePathTestHomeState.linkedSourceHouseId) {
    const source = resolveOnePathGreenButtonParitySource({
      resolved: args.resolved,
      onePathTestHomeState: args.onePathTestHomeState,
    });
    return {
      houseId: source.house.id,
      userId: source.userId,
      house: source.house,
    };
  }
  const requested =
    typeof args.bodyActualContextHouseId === "string" && args.bodyActualContextHouseId.trim()
      ? args.bodyActualContextHouseId.trim()
      : args.defaultActualContextHouseId;
  const house = args.resolved.houses.find((entry) => entry.id === requested) ?? args.resolved.selectedHouse;
  return {
    houseId: house.id,
    userId: args.defaultActualContextUserId,
    house,
  };
}

function resolveOnePathAdminSmtHealTarget(args: {
  effectiveUserId: string;
  effectiveHouseId: string;
  smtSourceEsiid: string | null;
  onePathTestHomeState: {
    isPinned: boolean;
    linkedSourceHouseId: string | null;
    linkedSourceUserId: string | null;
  };
}): { userId: string; houseId: string; esiid: string | null } {
  const esiid = String(args.smtSourceEsiid ?? "").trim() || null;
  if (
    args.onePathTestHomeState.isPinned &&
    args.onePathTestHomeState.linkedSourceHouseId &&
    args.onePathTestHomeState.linkedSourceUserId
  ) {
    return {
      userId: args.onePathTestHomeState.linkedSourceUserId,
      houseId: args.onePathTestHomeState.linkedSourceHouseId,
      esiid,
    };
  }
  return {
    userId: args.effectiveUserId,
    houseId: args.effectiveHouseId,
    esiid,
  };
}

async function ensureOnePathSmtOnLookup(args: {
  previewMode: CanonicalSimulationInputType;
  smtSourceEsiid: string | null;
  effectiveUserId: string;
  effectiveHouseId: string;
  sourceUserId: string;
  actualContextHouseId: string;
  onePathTestHomeState: {
    isPinned: boolean;
    linkedSourceHouseId: string | null;
    linkedSourceUserId: string | null;
  };
}) {
  if (args.previewMode === "GREEN_BUTTON") return null;
  const esiid = String(args.smtSourceEsiid ?? "").trim();
  if (!esiid) return null;

  const smtHeal = resolveOnePathAdminSmtHealTarget({
    effectiveUserId: args.effectiveUserId,
    effectiveHouseId: args.effectiveHouseId,
    smtSourceEsiid: esiid,
    onePathTestHomeState: args.onePathTestHomeState,
  });
  const correlationId = createSimCorrelationId();
  const ensure = await ensureSmtCoverageForHouse({
    userId: smtHeal.userId,
    houseId: smtHeal.houseId,
    esiid: smtHeal.esiid,
    profile: ONE_PATH_SMT_HEAL_PROFILE,
    force: true,
    sessionKey: `load:${smtHeal.houseId}`,
  });
  return buildOnePathSmtRefreshCheckFromEnsure(ensure, {
    correlationId,
    effectiveHouseId: args.effectiveHouseId,
    actualContextHouseId: args.actualContextHouseId,
    sourceUserId: args.sourceUserId,
    sourceEsiid: esiid,
  });
}

/** Dual-run: refresh test-home Past build inputs from source DB before admin Past recalc (never artifact copy). */
async function ensureOnePathPastBuildInputsFromSourceForRun(args: {
  ownerUserId: string;
  sourceUserId: string;
  sourceHouseId: string;
  testHomeHouseId: string;
  correlationId: string;
  mode: string;
}): Promise<
  | { ok: true; sourceInputHash?: string; seededFromSourceDb?: boolean }
  | { ok: false; error: string; message: string; mirrorCode?: string }
> {
  const { ensureOnePathPastBuildInputsFromSource } = await import("@/lib/usage/onePathPastUserSiteParity");
  const startedAt = Date.now();
  const preferredActualSource = args.mode === "INTERVAL" ? ("SMT" as const) : ("GREEN_BUTTON" as const);
  const callerLabel =
    args.mode === "INTERVAL" ? "one_path_admin_past_run" : "one_path_admin_gb_past_run";
  const sync = await ensureOnePathPastBuildInputsFromSource({
    ownerUserId: args.ownerUserId,
    sourceUserId: args.sourceUserId,
    sourceHouseId: args.sourceHouseId,
    testHomeHouseId: args.testHomeHouseId,
    preferredActualSource,
    callerLabel,
  });
  logSimPipelineEvent("one_path_past_build_inputs_sync", {
    correlationId: args.correlationId,
    sourceHouseId: args.sourceHouseId,
    testHomeId: args.testHomeHouseId,
    ok: sync.ok,
    syncCode: sync.ok ? undefined : sync.code,
    syncKind: sync.ok ? sync.syncKind : undefined,
    sourceInputHash: sync.ok ? sync.sourceInputHash : undefined,
    durationMs: Date.now() - startedAt,
    mode: args.mode,
    memoryRssMb: getMemoryRssMb(),
    source: "one_path_sim_route",
  });
  if (!sync.ok) {
    return {
      ok: false,
      error: "past_build_inputs_sync_failed",
      message: sync.message ?? "Could not refresh Past build inputs from the linked source house.",
      mirrorCode: sync.code,
    };
  }
  return {
    ok: true,
    sourceInputHash: sync.sourceInputHash,
    seededFromSourceDb: sync.syncKind === "seed",
  };
}

export async function POST(request: NextRequest) {
  const denied = gateOnePathSimAdmin(request);
  if (denied) return denied;

  const body = await request.json().catch(() => ({}));
  const action = String(body?.action ?? "").trim().toLowerCase();
  const includeDebugDiagnostics = includeDebugDiagnosticsByDefault(body?.includeDebugDiagnostics);
  const resolved = await resolveOnePathSimUserSelection({
    email: typeof body?.email === "string" ? body.email : null,
    houseId:
      typeof body?.sourceHouseId === "string"
        ? body.sourceHouseId
        : typeof body?.houseId === "string"
          ? body.houseId
          : null,
  });
  if (!resolved.ok) {
    const status = resolved.error === "email_required" ? 400 : 404;
    return NextResponse.json({ ok: false, error: resolved.error }, { status });
  }

  const ownerUserId = await resolveOnePathSimOwnerUserId(request);
  if (!ownerUserId) {
    return NextResponse.json({ ok: false, error: "lab_owner_not_found" }, { status: 400 });
  }
  const onePathTestHomeState = await resolveOnePathTestHomeState({
    ownerUserId,
    selectedSourceHouseId: resolved.selectedHouse.id,
    selectedSourceUserId: resolved.userId,
    fallbackSourceHouseId:
      typeof body?.sourceHouseId === "string" && body.sourceHouseId.trim() ? body.sourceHouseId.trim() : null,
    preferredTestHomeHouseId:
      typeof body?.onePathTestHomeHouseId === "string" && body.onePathTestHomeHouseId.trim()
        ? body.onePathTestHomeHouseId.trim()
        : typeof body?.houseId === "string" &&
            typeof body?.sourceHouseId === "string" &&
            body.houseId.trim() &&
            body.sourceHouseId.trim() &&
            body.houseId.trim() !== body.sourceHouseId.trim()
          ? body.houseId.trim()
          : null,
  });
  const smtSourceEsiid = resolved.selectedHouse.esiid ? String(resolved.selectedHouse.esiid) : null;
  const sourceCommittedUsageSource = await resolveHouseCommittedUsageSource({
    houseId: resolved.selectedHouse.id,
    userId: resolved.userId,
    esiid: smtSourceEsiid,
  });
  const sourceManualUsageForPreset = await getOnePathManualUsageInput({
    userId: resolved.userId,
    houseId: resolved.selectedHouse.id,
  }).catch(() => ({ payload: null, updatedAt: null }));
  const effectiveUserId = onePathTestHomeState.isPinned ? ownerUserId : resolved.userId;
  const effectiveHouseId = onePathTestHomeState.isPinned ? onePathTestHomeState.testHomeHouseId : resolved.selectedHouse.id;
  /** User-site actual truth always comes from the email-selected source house, not the pinned test home. */
  const defaultActualContextHouseId =
    onePathTestHomeState.isPinned && onePathTestHomeState.linkedSourceHouseId
      ? onePathTestHomeState.linkedSourceHouseId
      : resolved.selectedHouse.id;
  const defaultActualContextUserId =
    onePathTestHomeState.isPinned && onePathTestHomeState.linkedSourceUserId
      ? onePathTestHomeState.linkedSourceUserId
      : resolved.userId;
  if (onePathTestHomeState.isPinned && effectiveHouseId) {
    await ensureWorkspaceScenariosForHouse({ userId: effectiveUserId, houseId: effectiveHouseId }).catch(() => null);
  }
  const effectiveScenarios =
    onePathTestHomeState.isPinned && effectiveHouseId
      ? (
          await listScenarios({ userId: effectiveUserId, houseId: effectiveHouseId }).catch(() => ({
            ok: false as const,
            scenarios: [] as unknown[],
          }))
        ).scenarios ?? []
      : resolved.scenarios;
  const onePathTestHomeSummary = {
    houseId: onePathTestHomeState.testHomeHouseId,
    label: onePathTestHomeState.testHomeHouse?.label ?? ONE_PATH_LAB_TEST_HOME_LABEL,
    esiid: onePathTestHomeState.testHomeHouse?.esiid ?? null,
    status: onePathTestHomeState.status,
    statusMessage: onePathTestHomeState.statusMessage,
    sourceHouseId: onePathTestHomeState.linkedSourceHouseId,
    sourceUserId: onePathTestHomeState.linkedSourceUserId,
    lastReplacedAt: onePathTestHomeState.lastReplacedAt,
    isPinned: onePathTestHomeState.isPinned,
    needsReplace: onePathTestHomeState.needsReplace,
  } as const;

  if (action === "replace_test_home_from_source") {
    const replacement = await replaceGlobalOnePathLabTestHomeFromSource({
      ownerUserId,
      sourceUserId: resolved.userId,
      sourceHouseId: resolved.selectedHouse.id,
    });
    if (!replacement.ok) {
      return NextResponse.json(replacement, { status: replacement.error === "source_house_not_found" ? 404 : 500 });
    }
    const replacedState = await resolveOnePathTestHomeState({
      ownerUserId,
      selectedSourceHouseId: resolved.selectedHouse.id,
      selectedSourceUserId: resolved.userId,
      fallbackSourceHouseId: resolved.selectedHouse.id,
      preferredTestHomeHouseId: replacement.testHomeHouseId ?? null,
    });
    return NextResponse.json({
      ok: true,
      sourceHouseId: resolved.selectedHouse.id,
      testHomeHouseId: replacedState.testHomeHouseId,
      onePathTestHome: {
        houseId: replacedState.testHomeHouseId,
        label: replacedState.testHomeHouse?.label ?? ONE_PATH_LAB_TEST_HOME_LABEL,
        esiid: replacedState.testHomeHouse?.esiid ?? null,
        status: replacedState.status,
        statusMessage: replacedState.statusMessage,
        sourceHouseId: replacedState.linkedSourceHouseId,
        sourceUserId: replacedState.linkedSourceUserId,
        lastReplacedAt: replacedState.lastReplacedAt,
        isPinned: replacedState.isPinned,
        needsReplace: replacedState.needsReplace,
      },
    });
  }

  if (action === "rehydrate_green_button_from_raw") {
    const greenButtonContext = resolveOnePathGreenButtonActualContextForUsage({
      resolved,
      onePathTestHomeState,
      effectiveUserId,
      effectiveHouseId,
    });
    const rehydrate = await rehydrateGreenButtonIntervalsFromRawForHouse({
      houseId: greenButtonContext.houseId,
      userId: greenButtonContext.userId,
    });
    return NextResponse.json({
      ok: rehydrate.ok,
      email: resolved.email,
      userId: resolved.userId,
      houses: resolved.houses,
      selectedHouse: resolved.selectedHouse,
      message: rehydrate.ok ? undefined : greenButtonRehydrateUserMessage(rehydrate.error),
      greenButtonRehydrateFromRaw: rehydrate,
      greenButtonActualContextHouseId: greenButtonContext.houseId,
    });
  }

  if (action === "full_window_smt_reingest") {
    const writable = requireOnePathWritableContext({ testHomeState: onePathTestHomeState });
    if (!writable.ok) return writable.response;
    const reingest = await runFullWindowSmtReingestForHouse({
      userId: ownerUserId,
      houseId: writable.testHomeHouseId,
    });
    const userUsagePageBaselineContract = await buildUserUsageHouseContract({
      userId: resolved.userId,
      house: {
        id: resolved.selectedHouse.id,
        label: resolved.selectedHouse.label ?? null,
        esiid: resolved.selectedHouse.esiid ?? null,
      },
      lightweightActualUsage: true,
      skipLightweightInsightRecompute: true,
    }).catch(() => null);
    const baselineParityAudit = buildOnePathBaselineParityAudit({
      houseContract: userUsagePageBaselineContract,
    });
    const userUsageBaselineView = buildOnePathBaselineReadOnlyView({
      houseContract: userUsagePageBaselineContract,
      parityAudit: baselineParityAudit,
    });
    return NextResponse.json({
      ok: reingest.ok,
      email: resolved.email,
      userId: resolved.userId,
      houses: resolved.houses,
      selectedHouse: resolved.selectedHouse,
      fullWindowSmtReingest: reingest,
      sourceContext: {
        userUsagePageBaselineContract,
        userUsageBaselineContract: userUsagePageBaselineContract,
        userUsageBaselineView,
        baselineParityAudit,
      },
    });
  }

  const syncedPinnedProfiles =
    onePathTestHomeState.isPinned && effectiveHouseId
      ? await syncOnePathMissingProfilesFromSource({
          ownerUserId,
          sourceUserId: resolved.userId,
          sourceHouseId: resolved.selectedHouse.id,
          testHomeHouseId: effectiveHouseId,
          // Lookup should not rewrite profiles every time (pool pressure); repair-missing still runs inside sync.
          overwriteExisting: body?.overwriteProfilesFromSource === true,
        }).catch(() => null)
      : null;

  if ((action === "load_manual" || action === "save_manual" || action === "run") && onePathTestHomeState.needsReplace) {
    return NextResponse.json(
      {
        ok: false,
        error: "test_home_not_ready",
        message: "Replace the One Path test home from the selected source before running or saving.",
        onePathTestHome: onePathTestHomeSummary,
      },
      { status: 409 }
    );
  }

  if (action === "load_manual") {
    const manual = await getOnePathManualUsageInput({
      userId: effectiveUserId,
      houseId: effectiveHouseId,
    }).catch(() => ({ payload: null, updatedAt: null }));
    const actualContextHouseId =
      typeof body?.actualContextHouseId === "string" && body.actualContextHouseId.trim()
        ? body.actualContextHouseId.trim()
        : defaultActualContextHouseId;
    const travelRangesFromDb = await getOnePathTravelRangesFromDb(effectiveUserId, effectiveHouseId).catch(() => []);
    const seeds = await buildOnePathAdminManualSeeds({
      userId: effectiveUserId,
      houseId: effectiveHouseId,
      actualContextHouseId: defaultActualContextHouseId || actualContextHouseId,
      smtSourceEsiid,
      payload: manual.payload ?? null,
      dbTravelRanges: travelRangesFromDb,
    });
    return NextResponse.json({
      ok: true,
      houseId: effectiveHouseId,
      payload: manual.payload ?? null,
      updatedAt: manual.updatedAt ?? null,
      sourcePayload: manual.payload ?? null,
      sourceUpdatedAt: manual.updatedAt ?? null,
      seed: seeds.seed,
    });
  }

  if (action === "save_manual") {
    const saved = await saveOnePathManualUsageInput({
      userId: effectiveUserId,
      houseId: effectiveHouseId,
      payload: body?.payload,
    });
    if (!saved.ok) return NextResponse.json(saved, { status: 400 });
    return NextResponse.json({
      ok: true,
      houseId: effectiveHouseId,
      payload: saved.payload,
      updatedAt: saved.updatedAt,
    });
  }

  if (action === "read_past_interval_diagnostics") {
    const mode = normalizeMode(body?.mode);
    if (mode !== "INTERVAL" && mode !== "GREEN_BUTTON") {
      return NextResponse.json(
        {
          ok: false,
          error: "interval_diagnostics_unavailable",
          message: "Interval diagnostics readback is only available for SMT and Green Button Past runs.",
        },
        { status: 400 }
      );
    }
    const scenarioId =
      typeof body?.scenarioId === "string" && body.scenarioId.trim() ? body.scenarioId.trim() : null;
    if (!scenarioId) {
      return NextResponse.json(
        { ok: false, error: "scenario_required", message: "Past scenarioId is required for interval diagnostics readback." },
        { status: 400 }
      );
    }
    const includePosthocTopMissIntervalCurves = body?.includePosthocTopMissIntervalCurves === true;
    const exactArtifactInputHash =
      typeof body?.exactArtifactInputHash === "string" && body.exactArtifactInputHash.trim()
        ? body.exactArtifactInputHash.trim()
        : null;
    const preferredActualSource = mode === "INTERVAL" ? ("SMT" as const) : ("GREEN_BUTTON" as const);
    const linkedSourceScenarioId =
      onePathTestHomeState.linkedSourceUserId && onePathTestHomeState.linkedSourceHouseId
        ? await findPastScenarioId({
            userId: onePathTestHomeState.linkedSourceUserId,
            houseId: onePathTestHomeState.linkedSourceHouseId,
          })
        : null;
    const readback = await buildPastSimRunReadbackResponse({
      userId: effectiveUserId,
      houseId: effectiveHouseId,
      scenarioId,
      actualContextHouseId:
        typeof body?.actualContextHouseId === "string" && body.actualContextHouseId.trim()
          ? body.actualContextHouseId.trim()
          : defaultActualContextHouseId,
      preferredActualSource,
      smtSourceEsiid,
      readMode: "artifact_only",
      exactArtifactInputHash,
      linkedSourceUserId: onePathTestHomeState.linkedSourceUserId,
      linkedSourceHouseId: onePathTestHomeState.linkedSourceHouseId,
      linkedSourceScenarioId,
      includePosthocTopMissIntervalCurves,
      disableArtifactRebuildFallback: true,
    });
    if (!readback.ok) {
      const status =
        readback.code === "NO_BUILD" || readback.code === "ARTIFACT_MISSING" || readback.code === "SCENARIO_NOT_FOUND"
          ? 404
          : readback.code === "COMPARE_TRUTH_INCOMPLETE"
            ? 409
            : 500;
      return NextResponse.json(
        { ok: false, error: readback.code, message: readback.message },
        { status }
      );
    }
    return NextResponse.json({
      ok: true,
      diagnosticOnly: true,
      onePathIntervalDiagnosticsV1: readback.onePathIntervalDiagnosticsV1,
    });
  }

  if (action === "run") {
    const mode = normalizeMode(body?.mode);
    const correlationId = createSimCorrelationId();
    const routeStartedAt = Date.now();
    const stageTimingsMs: Record<string, number> = {};
    let runScenarioId =
      typeof body?.scenarioId === "string" && body.scenarioId.trim() ? body.scenarioId.trim() : null;
    const runReasonText = String(body?.runReason ?? "").trim().toLowerCase();
    const orchestrationRecord =
      body?.orchestration && typeof body.orchestration === "object" && !Array.isArray(body.orchestration)
        ? (body.orchestration as Record<string, unknown>)
        : {};
    const forceActualDerivedManualPayload =
      runReasonText.includes("model_intelligence_monthly_masked") ||
      runReasonText.includes("model_intelligence_annual_masked") ||
      orchestrationRecord.forceActualDerivedManualPayload === true;
    if (!runScenarioId && mode === "GREEN_BUTTON" && onePathTestHomeState.isPinned && effectiveHouseId) {
      const ensured = await ensureWorkspaceScenariosForHouse({
        userId: effectiveUserId,
        houseId: effectiveHouseId,
      }).catch(() => ({ pastScenarioId: null, futureScenarioId: null }));
      if (
        runReasonText.includes("green-button-past") ||
        runReasonText.includes("keeper-green-button-past")
      ) {
        runScenarioId = ensured.pastScenarioId;
      } else if (
        runReasonText.includes("green-button-future") ||
        runReasonText.includes("keeper-green-button-future")
      ) {
        runScenarioId = ensured.futureScenarioId;
      }
    }
    const isManualMode = mode === "MANUAL_MONTHLY" || mode === "MANUAL_ANNUAL";
    const includePosthocTopMissIntervalCurves = body?.includePosthocTopMissIntervalCurves === true;
    const manualUsage =
      isManualMode
        ? await getOnePathManualUsageInput({ userId: effectiveUserId, houseId: effectiveHouseId }).catch(() => ({
            payload: null,
            updatedAt: null,
          }))
        : { payload: null, updatedAt: null };
    const greenButtonRunActualContext =
      mode === "GREEN_BUTTON"
        ? resolveOnePathGreenButtonActualContextForUsage({
            resolved,
            onePathTestHomeState,
            effectiveUserId,
            effectiveHouseId,
          })
        : null;
    let greenButtonRehydrateFromRaw: Awaited<
      ReturnType<typeof rehydrateGreenButtonIntervalsFromRawForHouse>
    > | null = null;
    if (
      mode === "GREEN_BUTTON" &&
      body?.rehydrateGreenButtonFromRaw === true &&
      greenButtonRunActualContext
    ) {
      greenButtonRehydrateFromRaw = await rehydrateGreenButtonIntervalsFromRawForHouse({
        houseId: greenButtonRunActualContext.houseId,
        userId: greenButtonRunActualContext.userId,
      });
      if (!greenButtonRehydrateFromRaw.ok) {
        return NextResponse.json(
          {
            ok: false,
            error: greenButtonRehydrateFromRaw.error,
            message: greenButtonRehydrateUserMessage(greenButtonRehydrateFromRaw.error),
            houseId: greenButtonRunActualContext.houseId,
            greenButtonRehydrateFromRaw,
            correlationId,
          },
          { status: 422 }
        );
      }
    }
    if (mode === "GREEN_BUTTON" && greenButtonRunActualContext) {
      const gbUsageGate = await assertOnePathGreenButtonPersistedUsage({
        houseId: greenButtonRunActualContext.houseId,
        contextLabel: "One Path test home",
      });
      if (!gbUsageGate.ok) {
        return NextResponse.json(
          {
            ok: false,
            error: gbUsageGate.error,
            message: gbUsageGate.message,
            houseId: gbUsageGate.houseId,
            greenButtonRehydrateFromRaw,
            correlationId,
          },
          { status: 409 }
        );
      }
    }
    const rawInputBase = {
      userId: effectiveUserId,
      houseId: effectiveHouseId,
      actualContextHouseId:
        typeof body?.actualContextHouseId === "string" && body.actualContextHouseId.trim()
          ? body.actualContextHouseId.trim()
          : greenButtonRunActualContext?.houseId ?? defaultActualContextHouseId,
      actualContextUserId: greenButtonRunActualContext?.userId ?? defaultActualContextUserId,
      smtSourceEsiid,
      preferredActualSource: null,
      scenarioId: runScenarioId,
      weatherPreference:
        body?.weatherPreference === "NONE" || body?.weatherPreference === "LONG_TERM_AVERAGE"
          ? body.weatherPreference
          : "LAST_YEAR_WEATHER",
      travelRanges: Array.isArray(body?.travelRanges) ? body.travelRanges : undefined,
      persistRequested: body?.persistRequested !== false,
    } as const;
    const effectiveRawInputBase = {
      ...rawInputBase,
      preferredActualSource:
        mode === "INTERVAL"
          ? "SMT"
          : mode === "GREEN_BUTTON"
            ? "GREEN_BUTTON"
            : rawInputBase.preferredActualSource,
    } as const;
    const globalValidationDayKeys = await resolveGlobalValidationDayKeysForPastSim({
      userId: effectiveUserId,
      houseId: effectiveRawInputBase.actualContextHouseId,
      esiid: smtSourceEsiid,
      sourceHouseId: effectiveRawInputBase.actualContextHouseId,
      surface: "admin_lab",
    });
    const runInputWithValidation = {
      ...effectiveRawInputBase,
      validationSelectionMode: globalValidationDayKeys.selectionMode,
      validationDayCount: globalValidationDayKeys.validationDayCount,
      validationOnlyDateKeysLocal: globalValidationDayKeys.validationOnlyDateKeysLocal,
    } as const;
    if (
      mode === "GREEN_BUTTON" &&
      (runReasonText.includes("green-button-past") || runReasonText.includes("keeper-green-button-past")) &&
      !effectiveRawInputBase.scenarioId
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: "past_scenario_missing",
          message:
            "Green Button Past Sim requires a Past (Corrected) scenario on the One Path test home. Load lookup again, then reload the Green Button Past preset.",
        },
        { status: 409 }
      );
    }
    const adminManualSeeds =
      isManualMode
        ? await buildOnePathAdminManualSeeds({
            userId: effectiveUserId,
            houseId: effectiveHouseId,
            actualContextHouseId: effectiveRawInputBase.actualContextHouseId,
            sourceHouseId:
              typeof body?.sourceHouseId === "string" && body.sourceHouseId.trim()
                ? body.sourceHouseId.trim()
                : onePathTestHomeState.linkedSourceHouseId ?? effectiveRawInputBase.actualContextHouseId,
            smtSourceEsiid,
            payload: forceActualDerivedManualPayload ? null : manualUsage.payload ?? null,
            overrideTravelRanges: effectiveRawInputBase.travelRanges,
            dbTravelRanges: await getOnePathTravelRangesFromDb(effectiveUserId, effectiveHouseId).catch(() => []),
            forceActualDerivedManualPayload,
          })
        : null;
    const effectiveManualUsagePayload =
      isManualMode
        ? applyExplicitTravelRangesToManualPayload(
            adminManualSeeds?.payloadForMode[mode] ?? null,
            effectiveRawInputBase.travelRanges
          )
        : null;
    if (isManualMode && !effectiveManualUsagePayload) {
      const missingItems =
        mode === "MANUAL_ANNUAL"
          ? ["Save filled manual annual usage totals before running MANUAL_ANNUAL."]
          : ["Save filled manual monthly usage totals before running MANUAL_MONTHLY."];
      return NextResponse.json(
        {
          ok: false,
          error: "requirements_unmet",
          missingItems,
          message: `requirements_unmet: ${missingItems.join("; ")}`,
        },
        { status: 409 }
      );
    }
    try {
      // Past Sim (scenario selected): always dispatch canonical recalc + readback — not the
      // adaptIntervalRawInput / runSharedSimulation baseline diagnostic path.
      if (effectiveRawInputBase.scenarioId && !isManualMode) {
        let exactArtifactInputHash: string | null = null;
        if (mode === "INTERVAL" || mode === "GREEN_BUTTON") {
          if (
            onePathTestHomeState.isPinned &&
            onePathTestHomeState.linkedSourceHouseId &&
            onePathTestHomeState.linkedSourceUserId
          ) {
            const mirrorPastInputs = await ensureOnePathPastBuildInputsFromSourceForRun({
              ownerUserId: effectiveUserId,
              sourceUserId: onePathTestHomeState.linkedSourceUserId,
              sourceHouseId: onePathTestHomeState.linkedSourceHouseId,
              testHomeHouseId: effectiveHouseId,
              correlationId,
              mode,
            });
            if (!mirrorPastInputs.ok) {
              return NextResponse.json(
                {
                  ok: false,
                  error: mirrorPastInputs.error,
                  message: mirrorPastInputs.message,
                  mirrorCode: mirrorPastInputs.mirrorCode,
                  correlationId,
                },
                { status: 409 }
              );
            }
          }
          const preLockboxTravelRanges = Array.isArray(runInputWithValidation.travelRanges)
            ? (effectiveRawInputBase.travelRanges as TravelRange[])
            : [];
          const preferredActualSource = mode === "INTERVAL" ? ("SMT" as const) : ("GREEN_BUTTON" as const);
          if (mode === "GREEN_BUTTON") {
            exactArtifactInputHash = await resolveOnePathGbPastCachedArtifactInputHash({
              userId: effectiveUserId,
              houseId: effectiveHouseId,
              scenarioId: effectiveRawInputBase.scenarioId,
              actualContextHouseId: effectiveRawInputBase.actualContextHouseId,
            });
          }
          if (!exactArtifactInputHash) {
            const recalcDispatched = await dispatchPastSimRecalc({
              userId: effectiveUserId,
              houseId: effectiveHouseId,
              esiid: smtSourceEsiid,
              mode: "SMT_BASELINE",
              scenarioId: effectiveRawInputBase.scenarioId,
              actualContextHouseId: effectiveRawInputBase.actualContextHouseId,
              weatherPreference: effectiveRawInputBase.weatherPreference,
              persistPastSimBaseline: true,
              preLockboxTravelRanges,
              validationDaySelectionMode: globalValidationDayKeys.selectionMode,
              validationDayCount: globalValidationDayKeys.validationDayCount,
              validationOnlyDateKeysLocal: globalValidationDayKeys.validationOnlyDateKeysLocal,
              correlationId,
              runContext: {
                callerLabel:
                  mode === "INTERVAL" ? "one_path_admin_past_run" : "one_path_admin_gb_past_run",
                buildPathKind: "recalc",
                persistRequested: effectiveRawInputBase.persistRequested !== false,
                preferredActualSource,
              },
            });
            if (recalcDispatched.executionMode === "droplet_async") {
              return NextResponse.json(
                {
                  ok: false,
                  error: "past_recalc_async_unsupported",
                  message:
                    "Past recalc was queued for droplet execution. One Path admin Past run requires inline recalc in this environment.",
                  jobId: recalcDispatched.jobId,
                  correlationId: recalcDispatched.correlationId,
                },
                { status: 503 }
              );
            }
            if (!recalcDispatched.result.ok) {
              return NextResponse.json(
                {
                  ok: false,
                  error: recalcDispatched.result.error ?? "past_recalc_failed",
                  message:
                    ("missingItems" in recalcDispatched.result &&
                    Array.isArray(recalcDispatched.result.missingItems)
                      ? recalcDispatched.result.missingItems.join("; ")
                      : null) ??
                    recalcDispatched.result.error ??
                    "Past recalc failed on the One Path test home.",
                  correlationId: recalcDispatched.correlationId,
                },
                { status: 400 }
              );
            }
            exactArtifactInputHash = recalcDispatched.result.canonicalArtifactInputHash ?? null;
          }
        }
        const linkedSourceScenarioId =
          onePathTestHomeState.linkedSourceUserId && onePathTestHomeState.linkedSourceHouseId
            ? await findPastScenarioId({
                userId: onePathTestHomeState.linkedSourceUserId,
                houseId: onePathTestHomeState.linkedSourceHouseId,
              })
            : null;
        const readback = await buildPastSimRunReadbackResponse({
          userId: effectiveUserId,
          houseId: effectiveHouseId,
          scenarioId: effectiveRawInputBase.scenarioId,
          correlationId,
          actualContextHouseId: effectiveRawInputBase.actualContextHouseId,
          preferredActualSource: effectiveRawInputBase.preferredActualSource,
          smtSourceEsiid,
          exactArtifactInputHash,
          readMode: exactArtifactInputHash ? "artifact_only" : undefined,
          disableArtifactRebuildFallback: Boolean(exactArtifactInputHash),
          linkedSourceUserId: onePathTestHomeState.linkedSourceUserId,
          linkedSourceHouseId: onePathTestHomeState.linkedSourceHouseId,
          linkedSourceScenarioId,
          includePosthocTopMissIntervalCurves,
        });
        if (!readback.ok) {
          const status =
            readback.code === "NO_BUILD" || readback.code === "ARTIFACT_MISSING" || readback.code === "SCENARIO_NOT_FOUND"
              ? 404
              : readback.code === "COMPARE_TRUTH_INCOMPLETE"
                ? 409
                : 500;
          return NextResponse.json(
            {
              ok: false,
              error: readback.code,
              message: readback.message,
            },
            { status }
          );
        }
        return NextResponse.json({
          ...readback,
        });
      }
      if (mode === "GREEN_BUTTON" && !effectiveRawInputBase.scenarioId) {
        const gbParitySource = resolveOnePathGreenButtonParitySource({
          resolved,
          onePathTestHomeState,
        });
        const gbParityContract = await withAdminRouteStageTimeout({
          stage: "build_green_button_user_site_parity_contract",
          correlationId,
          timeoutMs: GREEN_BUTTON_ROUTE_STAGE_TIMEOUT_MS,
          mode,
          houseId: effectiveHouseId,
          stageTimingsMs,
          promise: buildGreenButtonUserSiteParityContract({
            userId: gbParitySource.userId,
            sourceHouse: gbParitySource.house,
            actualContextHouseId: effectiveRawInputBase.actualContextHouseId ?? defaultActualContextHouseId,
            lightweightActualUsage: true,
            skipLightweightInsightRecompute: false,
          }),
        });
        const baselineDataset = asRecord(gbParityContract?.dataset);
        const baselineDatasetMeta = asRecord(baselineDataset?.meta);
        const compactRunDisplayView =
          buildOnePathRunReadOnlyViewFromBaselineContract({ houseContract: gbParityContract }) ??
          buildOnePathRunReadOnlyView({
            dataset: baselineDataset,
            engineInput: null,
            readModel: null,
            weatherSensitivityScore: gbParityContract?.weatherSensitivityScore ?? null,
          }) ??
          null;
        const compactReadModel =
          compactRunDisplayView || baselineDataset
            ? withRunPerformanceAudit({
                readModel: {
                  dataset: buildCompactRunReadModelDataset({
                    artifactDataset: baselineDataset,
                    artifactDatasetMeta: baselineDatasetMeta,
                    runDisplayView: compactRunDisplayView,
                    forceBaselinePassthrough: true,
                  }),
                },
                stageTimingsMs,
                routeStartedAt,
              })
            : null;
        return NextResponse.json({
          ok: true,
          debugDiagnosticsIncluded: false,
          runType: "BASELINE_PASSTHROUGH",
          correlationId,
          engineInput: null,
          manualStageOneView: null,
          runDisplayView: compactRunDisplayView,
          artifact: null,
          readModel: compactReadModel,
          performanceAudit: compactReadModel?.performanceAudit ?? null,
        });
      }
      let engineInput =
        mode === "INTERVAL"
          ? await adaptIntervalRawInput(runInputWithValidation)
          : mode === "GREEN_BUTTON"
            ? await withAdminRouteStageTimeout({
                stage: "adapt_green_button_raw_input",
                correlationId,
                timeoutMs: GREEN_BUTTON_ROUTE_STAGE_TIMEOUT_MS,
                mode,
                houseId: effectiveHouseId,
                stageTimingsMs,
                promise: adaptGreenButtonRawInput(runInputWithValidation),
              })
            : mode === "MANUAL_ANNUAL"
              ? await adaptManualAnnualRawInput({
                  ...runInputWithValidation,
                  manualUsagePayload: effectiveManualUsagePayload,
                })
              : mode === "NEW_BUILD"
                ? await adaptNewBuildRawInput(runInputWithValidation)
                : await adaptManualMonthlyRawInput({
                    ...runInputWithValidation,
                    manualUsagePayload: effectiveManualUsagePayload,
                  });
      const slimEngineInput = buildSlimAdminEngineInput(engineInput);
      let artifact = await runSharedSimulation(engineInput);
      let artifactDataset = asRecord(artifact.dataset);
      let artifactDatasetMeta = asRecord(artifactDataset?.meta);
      const isGreenButtonBaselinePassthroughRun =
        mode === "GREEN_BUTTON" &&
        !effectiveRawInputBase.scenarioId &&
        Boolean(artifactDatasetMeta?.baselinePassthrough);
      if (isGreenButtonBaselinePassthroughRun) {
        const gbParitySource = resolveOnePathGreenButtonParitySource({
          resolved,
          onePathTestHomeState,
        });
        const gbParityContract = await buildGreenButtonUserSiteParityContract({
          userId: gbParitySource.userId,
          sourceHouse: gbParitySource.house,
          actualContextHouseId: effectiveRawInputBase.actualContextHouseId ?? defaultActualContextHouseId,
          lightweightActualUsage: true,
          skipLightweightInsightRecompute: false,
        }).catch(() => null);
        const compactRunDisplayView =
          buildOnePathRunReadOnlyViewFromBaselineContract({ houseContract: gbParityContract }) ??
          buildOnePathRunReadOnlyView({
            dataset: artifactDataset,
            engineInput: asRecord(engineInput),
            readModel:
              artifact.compareProjection || artifact.manualStageOneView
                ? {
                    compareProjection: artifact.compareProjection,
                    manualStageOneView: artifact.manualStageOneView,
                  }
                : null,
            weatherSensitivityScore: engineInput.weatherSensitivityScore ?? null,
          }) ??
          null;
        const compactReadModel =
          compactRunDisplayView || artifactDataset
            ? withRunPerformanceAudit({
                readModel: {
                  dataset: buildCompactRunReadModelDataset({
                    artifactDataset,
                    artifactDatasetMeta,
                    runDisplayView: compactRunDisplayView,
                    forceBaselinePassthrough: true,
                  }),
                },
                stageTimingsMs,
                routeStartedAt,
              })
            : null;
        return NextResponse.json({
          ok: true,
          debugDiagnosticsIncluded: false,
          runType: "BASELINE_PASSTHROUGH",
          engineInput: slimEngineInput,
          manualStageOneView: artifact.manualStageOneView ?? null,
          runDisplayView: compactRunDisplayView,
          artifact: null,
          readModel: compactReadModel,
          performanceAudit: compactReadModel?.performanceAudit ?? null,
        });
      }
      const shouldReturnCompactPastResponse = Boolean(effectiveRawInputBase.scenarioId && !isManualMode);
      const buildInputsForCompare = effectiveRawInputBase.scenarioId
        ? await loadPastSimBuildInputsForRead({
            userId: effectiveUserId,
            houseId: effectiveHouseId,
            scenarioId: String(effectiveRawInputBase.scenarioId),
          })
        : null;
      const preferredActualSourceForPast = resolvePastSimPreferredActualSource({
        preferredActualSource: effectiveRawInputBase.preferredActualSource,
        dataset: artifactDataset,
        buildInputs: buildInputsForCompare,
      });
      const sageTruthForPastDisplay = await resolveSageDatasetForRunDisplay({
        engineInput,
        scenarioId: effectiveRawInputBase.scenarioId,
        isManualMode,
        preferredActualSource: preferredActualSourceForPast,
        greenButtonFullYearIntervalsForDisplay: preferredActualSourceForPast === "GREEN_BUTTON",
        reloadSageTruth: () =>
          resolveSageActualTruthForRunDisplay({
            userId: effectiveUserId,
            houseId: effectiveHouseId,
            actualContextHouseId: effectiveRawInputBase.actualContextHouseId,
            smtSourceEsiid,
            preferredActualSource: preferredActualSourceForPast,
            greenButtonFullYearIntervalsForDisplay: preferredActualSourceForPast === "GREEN_BUTTON",
          }),
      });
      const sageDisplayArgsForPast = await sageAndStaleIncompleteDisplayArgs({
        sageDataset: sageTruthForPastDisplay?.dataset,
        datasetForMeta: artifactDataset,
        smtSourceEsiid,
      });
      if (shouldReturnCompactPastResponse) {
        const compareProjectionForPast = resolveValidationCompareProjectionForRead({
          dataset: artifactDataset,
          actualDataset: sageTruthForPastDisplay?.dataset ?? null,
          displayDataset: artifactDataset,
          buildInputs: buildInputsForCompare,
          engineInput: asRecord(engineInput),
        });
        const compactFinalizeOutcome = await preparePastArtifactDatasetForDisplay({
          userId: effectiveUserId,
          houseId: effectiveHouseId,
          scenarioId: effectiveRawInputBase.scenarioId ?? null,
          dataset: artifactDataset,
          sageActualDataset: asRecord(sageTruthForPastDisplay?.dataset),
          smtSlotCompleteDateKeys: sageDisplayArgsForPast.smtSlotCompleteDateKeys,
          linkedSourceUserId: onePathTestHomeState.linkedSourceUserId,
          persistDisplayWeatherToCache: effectiveRawInputBase.persistRequested !== false,
        });
        const compactPastWeather =
          effectiveRawInputBase.scenarioId != null && artifactDataset
            ? resolveAdminPastWeatherResponse({
                dataset: artifactDataset,
                houseId: effectiveHouseId,
                scenarioId: String(effectiveRawInputBase.scenarioId),
                compareProjection: compareProjectionForPast,
                finalizeOutcome: compactFinalizeOutcome,
              })
            : null;
        const compactRunDisplayView = applyFinalizedPastVisibleWeatherToRunDisplayView(
          buildOnePathRunReadOnlyView({
            dataset: artifactDataset ?? {},
            engineInput: asRecord(engineInput),
            readModel: { compareProjection: compareProjectionForPast },
            ...sageDisplayArgsForPast,
          }) ?? null,
          compactPastWeather ?? { weatherSensitivity: { score: null, derivedInput: null } }
        );
        const compactReadModel = {
          ...buildCompactSimulationReadModel({
            artifact: asRecord(artifact),
            artifactDataset,
            artifactDatasetMeta: asRecord(artifactDataset?.meta),
            runDisplayView: compactRunDisplayView,
            compareProjection: compareProjectionForPast,
          }),
          sageActualDataset: sageTruthForPastDisplay?.dataset ?? null,
          sageActualDaily: sageDisplayArgsForPast.sageActualDaily ?? null,
        };
        const compactPastWeatherApiFields = compactPastWeather
          ? buildAdminPastWeatherApiFields(compactPastWeather)
          : null;
        const compactActualDatasetForIntervalCompare = await resolveActualDatasetForCompareDiagnostics({
          userId: greenButtonRunActualContext?.userId ?? effectiveRawInputBase.actualContextUserId ?? effectiveUserId,
          actualContextHouseId: effectiveRawInputBase.actualContextHouseId,
          esiid: smtSourceEsiid,
          preferredActualSource: preferredActualSourceForPast,
          baseDataset: sageTruthForPastDisplay?.dataset ?? null,
        });
        return NextResponse.json({
          ok: true,
          debugDiagnosticsIncluded: false,
          debugDiagnosticsSuppressedReason: "past_sim_compact_response",
          runType: "PAST_SIM",
          engineInput: slimEngineInput,
          manualStageOneView: artifact.manualStageOneView ?? null,
          runDisplayView: compactRunDisplayView,
          ...(compactPastWeatherApiFields ?? {}),
          artifact: null,
          onePathIntervalDiagnosticsV1: buildOnePathIntervalDiagnosticsForPastResponse({
            mode,
            preferredActualSource: preferredActualSourceForPast,
            actualDataset: compactActualDatasetForIntervalCompare,
            simulatedDataset: artifactDataset,
            compareProjection: compareProjectionForPast,
            travelRanges: Array.isArray(effectiveRawInputBase.travelRanges)
              ? (effectiveRawInputBase.travelRanges as TravelRange[])
              : undefined,
            includePosthocTopMissIntervalCurves,
          }),
          readModel: compactReadModel,
        });
      }
      let readModel = buildSharedSimulationReadModel(artifact);
      const actualDatasetForManualRun =
        isManualMode
          ? (
              await resolveOnePathUpstreamUsageTruthForSimulation({
                userId: effectiveUserId,
                houseId: effectiveHouseId,
                actualContextHouseId: effectiveRawInputBase.actualContextHouseId,
                seedIfMissing: false,
                preferredActualSource: effectiveRawInputBase.preferredActualSource,
              }).catch(() => null)
            )?.dataset ?? null
          : null;
      const manualPastReadResult =
        isManualMode && effectiveRawInputBase.scenarioId
          ? await buildOnePathManualUsagePastSimReadResult({
              userId: effectiveUserId,
              houseId: effectiveHouseId,
              scenarioId: effectiveRawInputBase.scenarioId,
              readMode: "artifact_only",
              callerType: "user_past",
              exactArtifactInputHash: artifact.artifactInputHash ?? null,
              requireExactArtifactMatch: Boolean(artifact.artifactInputHash),
              usageInputMode: mode,
              weatherLogicMode: artifact.engineInput?.weatherLogicMode ?? null,
              artifactId: artifact.artifactId ?? null,
              artifactInputHash: artifact.artifactInputHash ?? null,
              artifactEngineVersion: artifact.engineVersion ?? null,
              manualUsagePayload: effectiveManualUsagePayload,
              actualDataset: actualDatasetForManualRun,
            })
          : null;
      const manualSageDisplayArgs = actualDatasetForManualRun
        ? await sageAndStaleIncompleteDisplayArgs({
            sageDataset: actualDatasetForManualRun,
            datasetForMeta:
              (manualPastReadResult?.ok === true ? asRecord(manualPastReadResult.displayDataset) : null) ??
              artifactDataset,
            smtSourceEsiid,
          })
        : sageDisplayArgsForPast;
      let runFinalizeOutcome: PastDisplayWeatherFinalizeOutcome | null = null;
      if (manualPastReadResult?.ok) {
        runFinalizeOutcome = await preparePastArtifactDatasetForDisplay({
          userId: effectiveUserId,
          houseId: effectiveHouseId,
          scenarioId: effectiveRawInputBase.scenarioId ?? null,
          dataset: asRecord(manualPastReadResult.displayDataset),
          sageActualDataset: asRecord(actualDatasetForManualRun),
          smtSlotCompleteDateKeys: manualSageDisplayArgs.smtSlotCompleteDateKeys,
          linkedSourceUserId: onePathTestHomeState.linkedSourceUserId,
          persistDisplayWeatherToCache: effectiveRawInputBase.persistRequested !== false,
        });
      } else if (effectiveRawInputBase.scenarioId) {
        runFinalizeOutcome = await preparePastArtifactDatasetForDisplay({
          userId: effectiveUserId,
          houseId: effectiveHouseId,
          scenarioId: effectiveRawInputBase.scenarioId,
          dataset: asRecord(readModel.dataset),
          sageActualDataset: asRecord(sageTruthForPastDisplay?.dataset),
          smtSlotCompleteDateKeys: sageDisplayArgsForPast.smtSlotCompleteDateKeys,
          linkedSourceUserId: onePathTestHomeState.linkedSourceUserId,
          persistDisplayWeatherToCache: effectiveRawInputBase.persistRequested !== false,
        });
      }
      const manualRunDisplayView =
        manualPastReadResult && manualPastReadResult.ok
          ? buildOnePathRunReadOnlyView({
              dataset: asRecord(manualPastReadResult.displayDataset),
              engineInput: asRecord(engineInput),
              readModel: { compareProjection: manualPastReadResult.compareProjection },
              ...manualSageDisplayArgs,
            })
          : null;
      const runDisplayDataset = asRecord(
        manualPastReadResult?.ok ? manualPastReadResult.displayDataset : readModel.dataset
      );
      const runPastWeather =
        effectiveRawInputBase.scenarioId != null && runDisplayDataset
          ? resolveAdminPastWeatherResponse({
              dataset: runDisplayDataset,
              houseId: effectiveHouseId,
              scenarioId: String(effectiveRawInputBase.scenarioId),
              compareProjection: asRecord(
                manualPastReadResult?.ok
                  ? manualPastReadResult.compareProjection
                  : readModel.compareProjection
              ),
              finalizeOutcome: runFinalizeOutcome,
            })
          : null;
      const runDisplayView = applyFinalizedPastVisibleWeatherToRunDisplayView(
        manualRunDisplayView ??
          buildOnePathRunReadOnlyView({
            dataset: runDisplayDataset,
            engineInput: asRecord(engineInput),
            readModel: asRecord(readModel),
            ...sageDisplayArgsForPast,
          }) ??
          null,
        runPastWeather ?? { weatherSensitivity: { score: null, derivedInput: null } }
      );
      const runPastWeatherApiFields = runPastWeather ? buildAdminPastWeatherApiFields(runPastWeather) : null;
      const compareProjectionForDiagnostics = manualPastReadResult?.ok
        ? manualPastReadResult.compareProjection
        : readModel.compareProjection;
      const actualDatasetForIntervalCompare = await resolveActualDatasetForCompareDiagnostics({
        userId: greenButtonRunActualContext?.userId ?? effectiveRawInputBase.actualContextUserId ?? effectiveUserId,
        actualContextHouseId: effectiveRawInputBase.actualContextHouseId,
        esiid: smtSourceEsiid,
        preferredActualSource: preferredActualSourceForPast,
        baseDataset: (isManualMode ? actualDatasetForManualRun : sageTruthForPastDisplay?.dataset) ?? null,
      });
      const onePathIntervalDiagnosticsV1 = buildOnePathIntervalDiagnosticsForPastResponse({
        mode,
        preferredActualSource: preferredActualSourceForPast,
        actualDataset: actualDatasetForIntervalCompare,
        simulatedDataset: runDisplayDataset,
        compareProjection: compareProjectionForDiagnostics,
        travelRanges: Array.isArray(effectiveRawInputBase.travelRanges)
          ? (effectiveRawInputBase.travelRanges as TravelRange[])
          : undefined,
        includePosthocTopMissIntervalCurves,
      });
      if (!includeDebugDiagnostics) {
        const compactReadModel = buildCompactSimulationReadModel({
          artifact: asRecord(artifact),
          artifactDataset: asRecord(readModel.dataset),
          artifactDatasetMeta: asRecord(asRecord(readModel.dataset)?.meta),
          runDisplayView,
          compareProjection: readModel.compareProjection,
          forceBaselinePassthrough: Boolean(artifactDatasetMeta?.baselinePassthrough),
        });
        const compactReadModelWithPerf = withRunPerformanceAudit({
          readModel: compactReadModel,
          stageTimingsMs,
          routeStartedAt,
        });
        return NextResponse.json({
          ok: true,
          debugDiagnosticsIncluded: false,
          runType:
            effectiveRawInputBase.scenarioId
              ? "PAST_SIM"
              : Boolean(artifactDatasetMeta?.baselinePassthrough)
                ? "BASELINE_PASSTHROUGH"
                : "BASELINE_OR_UNSET",
          engineInput: slimEngineInput,
          manualStageOneView: readModel.manualStageOneView ?? null,
          runDisplayView,
          ...(runPastWeatherApiFields ?? {}),
          artifact: null,
          adminManualPayloadProvenance: adminManualSeeds?.provenance ?? null,
          onePathIntervalDiagnosticsV1,
          readModel: compactReadModelWithPerf,
          performanceAudit: compactReadModelWithPerf?.performanceAudit ?? null,
          greenButtonRehydrateFromRaw,
        });
      }
      const readModelWithPerf = withRunPerformanceAudit({
        readModel: readModel as Record<string, unknown>,
        stageTimingsMs,
        routeStartedAt,
      });
      return NextResponse.json({
        ok: true,
        debugDiagnosticsIncluded: true,
        runType:
          effectiveRawInputBase.scenarioId
            ? "PAST_SIM"
            : Boolean(artifactDatasetMeta?.baselinePassthrough)
              ? "BASELINE_PASSTHROUGH"
              : "BASELINE_OR_UNSET",
        engineInput: slimEngineInput,
        artifact,
        adminManualPayloadProvenance: adminManualSeeds?.provenance ?? null,
        readModel: readModelWithPerf,
        manualStageOneView: readModel.manualStageOneView ?? null,
        runDisplayView,
        ...(runPastWeatherApiFields ?? {}),
        onePathIntervalDiagnosticsV1,
        performanceAudit: readModelWithPerf?.performanceAudit ?? null,
        greenButtonRehydrateFromRaw,
      });
    } catch (error) {
      if (isUpstreamUsageTruthMissingFailure(error)) {
        const environmentVisibility = buildEnvironmentVisibility();
        if (!environmentVisibility.usage.envVarPresent) {
          return usageDbUnavailableResponse({
            usageTruthSource: error.usageTruthSource,
            seedResult: error.seedResult,
            upstreamUsageTruth: error.upstreamUsageTruth,
          });
        }
        return NextResponse.json(
          {
            ok: false,
            error: error.code,
            usageTruthSource: error.usageTruthSource,
            seedResult: error.seedResult,
            upstreamUsageTruth: error.upstreamUsageTruth,
            message: error.message,
          },
          { status: 409 }
        );
      }
      if (isAdminRouteStageTimeoutFailure(error)) {
        return NextResponse.json(
          {
            ok: false,
            error: error.code,
            message: error.message,
            stage: error.stage,
            correlationId: error.correlationId,
            timeoutMs: error.timeoutMs,
            elapsedMs: error.elapsedMs,
            stageTimingsMs,
          },
          { status: 504 }
        );
      }
      if (isSharedSimulationRunFailure(error)) {
        const code =
          typeof (error as { code?: unknown }).code === "string"
            ? String((error as { code?: unknown }).code)
            : "requirements_unmet";
        const missingItems = Array.isArray((error as { missingItems?: unknown }).missingItems)
          ? ((error as { missingItems?: unknown }).missingItems as unknown[]).map((item) => String(item))
          : [];
        const message =
          missingItems.length > 0
            ? `${code}: ${missingItems.join("; ")}`
            : error instanceof Error && error.message
              ? error.message
              : code;
        return NextResponse.json(
          {
            ok: false,
            error: code,
            missingItems,
            message,
          },
          { status: 409 }
        );
      }
      const esiidConflict = onePathEsiidSiblingConflictResponse(error);
      if (esiidConflict) return esiidConflict;
      throw error;
    }
  }

  try {
  const previewMode =
    typeof body?.mode === "string" && body.mode.trim()
      ? normalizeMode(body.mode)
      : "INTERVAL";
  const pastBuildInputsSync =
    onePathTestHomeState.isPinned &&
    effectiveHouseId &&
    onePathTestHomeState.linkedSourceHouseId &&
    onePathTestHomeState.linkedSourceUserId &&
    (previewMode === "GREEN_BUTTON" || previewMode === "INTERVAL")
      ? await (async () => {
          const { ensureOnePathPastBuildInputsFromSource } = await import("@/lib/usage/onePathPastUserSiteParity");
          return ensureOnePathPastBuildInputsFromSource({
            ownerUserId,
            sourceUserId: onePathTestHomeState.linkedSourceUserId!,
            sourceHouseId: onePathTestHomeState.linkedSourceHouseId!,
            testHomeHouseId: effectiveHouseId,
            preferredActualSource: previewMode === "INTERVAL" ? "SMT" : "GREEN_BUTTON",
            callerLabel:
              previewMode === "INTERVAL" ? "one_path_admin_past_run" : "one_path_admin_gb_past_run",
          }).catch(() => null);
        })()
      : null;
  const lightweightLookupRequested = body?.lightweightLookup === true;
  const lookupActualContext = resolveOnePathLookupActualContext({
    resolved,
    onePathTestHomeState,
    effectiveUserId,
    effectiveHouseId,
    previewMode,
    defaultActualContextHouseId,
    defaultActualContextUserId,
    bodyActualContextHouseId:
      typeof body?.actualContextHouseId === "string" ? body.actualContextHouseId : null,
  });
  const greenButtonActualContext =
    previewMode === "GREEN_BUTTON"
      ? resolveOnePathGreenButtonActualContextForUsage({
          resolved,
          onePathTestHomeState,
          effectiveUserId,
          effectiveHouseId,
        })
      : null;

  if ((action === "lookup" || !action) && (!includeDebugDiagnostics || lightweightLookupRequested)) {
    const travelRangesFromDb = await getOnePathTravelRangesFromDb(effectiveUserId, effectiveHouseId).catch(() => []);
    const includeLightweightProfiles = lightweightLookupRequested || previewMode === "GREEN_BUTTON";
    const lightweightHomeProfilePromise = !includeLightweightProfiles
      ? Promise.resolve(null)
      : syncedPinnedProfiles?.homeProfile
        ? Promise.resolve(syncedPinnedProfiles.homeProfile)
        : getHomeProfileReadOnlyByUserHouse({ userId: effectiveUserId, houseId: effectiveHouseId }).catch(() => null);
    const lightweightApplianceProfilePromise = !includeLightweightProfiles
      ? Promise.resolve(null)
      : syncedPinnedProfiles?.applianceProfile
        ? Promise.resolve(syncedPinnedProfiles.applianceProfile)
        : getApplianceProfileSimulatedByUserHouse({ userId: effectiveUserId, houseId: effectiveHouseId }).catch(() => null);
    const [lightweightHomeProfile, lightweightApplianceProfileRecord] = await Promise.all([
      lightweightHomeProfilePromise,
      lightweightApplianceProfilePromise,
    ]);
    const lightweightFallbackHomeProfile =
      includeLightweightProfiles && lightweightHomeProfile == null && syncedPinnedProfiles?.homeProfile == null
        ? await getHomeProfileSimulatedByUserHouse({ userId: effectiveUserId, houseId: effectiveHouseId }).catch(() => null)
        : null;
    const lightweightApplianceProfile = normalizeStoredApplianceProfile(
      (lightweightApplianceProfileRecord as any)?.appliancesJson ?? null
    );
    const previewActualContextHouseId = lookupActualContext.houseId;
    const greenButtonUploadHouseId =
      previewMode === "GREEN_BUTTON" && onePathTestHomeState.isPinned && effectiveHouseId
        ? effectiveHouseId
        : previewActualContextHouseId;
    const greenButtonUpload = await loadGreenButtonUploadSummary(greenButtonUploadHouseId);
    const manualUsage =
      previewMode === "MANUAL_MONTHLY" || previewMode === "MANUAL_ANNUAL"
        ? await getOnePathManualUsageInput({ userId: effectiveUserId, houseId: effectiveHouseId }).catch(() => ({
            payload: null,
            updatedAt: null,
          }))
        : { payload: null, updatedAt: null };
    const adminManualSeeds =
      (previewMode === "MANUAL_MONTHLY" || previewMode === "MANUAL_ANNUAL") &&
      needsManualSeedForMode(previewMode, manualUsage.payload ?? null)
        ? await buildOnePathAdminManualSeeds({
            userId: effectiveUserId,
            houseId: effectiveHouseId,
            actualContextHouseId: previewActualContextHouseId,
            smtSourceEsiid,
            payload: manualUsage.payload ?? null,
            dbTravelRanges: travelRangesFromDb,
          })
        : null;
    const effectiveManualUsagePayload =
      previewMode === "MANUAL_MONTHLY" || previewMode === "MANUAL_ANNUAL"
        ? adminManualSeeds?.payloadForMode[previewMode] ?? manualUsage.payload ?? null
        : null;
    const smtRefreshCheck = await ensureOnePathSmtOnLookup({
      previewMode,
      smtSourceEsiid,
      effectiveUserId,
      effectiveHouseId,
      sourceUserId: resolved.userId,
      actualContextHouseId: previewActualContextHouseId,
      onePathTestHomeState,
    });
    return NextResponse.json({
      ok: true,
      email: resolved.email,
      userId: resolved.userId,
      houses: resolved.houses,
      selectedHouse: resolved.selectedHouse,
      scenarios: effectiveScenarios,
      sourceContext: {
        debugDiagnosticsIncluded: false,
        committedUsageSource: sourceCommittedUsageSource,
        manualUsagePayload: sourceManualUsageForPreset.payload ?? null,
        sourceManualUsagePayload: sourceManualUsageForPreset.payload ?? null,
        manualUsageUpdatedAt: sourceManualUsageForPreset.updatedAt ?? null,
        onePathTestHome: onePathTestHomeSummary,
        smtRefreshCheck,
        pastBuildInputsSync: pastBuildInputsSync
          ? {
              ok: pastBuildInputsSync.ok,
              syncKind: pastBuildInputsSync.ok ? pastBuildInputsSync.syncKind : undefined,
              code: pastBuildInputsSync.ok ? undefined : pastBuildInputsSync.code,
            }
          : null,
        travelRangesFromDb,
        homeProfile: lightweightHomeProfile ?? lightweightFallbackHomeProfile ?? null,
        applianceProfile: lightweightApplianceProfile,
        greenButtonUpload,
        ...(effectiveManualUsagePayload
          ? {
              manualStageOneView: buildOnePathManualStageOnePreview(effectiveManualUsagePayload),
              effectiveManualUsagePayload,
              manualSeed: adminManualSeeds?.seed ?? null,
              manualUsageUpdatedAt: manualUsage.updatedAt ?? null,
            }
          : {}),
      },
    });
  }

  const previewActualContextHouse = lookupActualContext.house;
  const greenButtonUploadSummaryHouseId =
    previewMode === "GREEN_BUTTON" && onePathTestHomeState.isPinned && effectiveHouseId
      ? effectiveHouseId
      : previewActualContextHouse.id;
  const actualContextGreenButtonUpload = await loadGreenButtonUploadSummary(greenButtonUploadSummaryHouseId);
  let previewSimulationVariablePolicy: SimulationVariablePolicy | null = null;
  try {
    const sharedSimulationVariablePolicy = await getOnePathSimulationVariablePolicy();
    previewSimulationVariablePolicy =
      (
        sharedSimulationVariablePolicy.effectiveByMode as Partial<
          Record<SimulationVariableInputType, SimulationVariablePolicy>
        >
      )[previewMode as SimulationVariableInputType] ?? null;
  } catch {
    previewSimulationVariablePolicy = null;
  }

  const smtRefreshCheck = await ensureOnePathSmtOnLookup({
    previewMode,
    smtSourceEsiid,
    effectiveUserId,
    effectiveHouseId,
    sourceUserId: resolved.userId,
    actualContextHouseId: previewActualContextHouse.id,
    onePathTestHomeState,
  });

  const [usageTruth, manualUsage, fetchedHomeProfile, fetchedApplianceProfileRecord, travelRangesFromDb] = await Promise.all([
    previewMode === "GREEN_BUTTON"
      ? (async () => {
          const gbHouseId = greenButtonActualContext?.houseId ?? lookupActualContext.houseId;
          const gbGate = await assertOnePathGreenButtonPersistedUsage({
            houseId: gbHouseId,
            contextLabel: "lookup",
          });
          if (!gbGate.ok) return null;
          return resolveOnePathUpstreamGreenButtonUsageTruth({
            runtimeUserId: effectiveUserId,
            runtimeHouseId: effectiveHouseId,
            actualContextHouseId: gbHouseId,
            actualContextUserId: greenButtonActualContext?.userId ?? lookupActualContext.userId,
            smtSourceEsiid,
            seedIfMissing: false,
          });
        })()
      : resolveOnePathUpstreamUsageTruthForSimulation({
          userId: effectiveUserId,
          houseId: effectiveHouseId,
          actualContextHouseId: lookupActualContext.houseId,
          actualContextUserId: lookupActualContext.userId,
          smtSourceEsiid,
          seedIfMissing: false,
          preferredActualSource: null,
        }).catch(() => null),
    getOnePathManualUsageInput({ userId: effectiveUserId, houseId: effectiveHouseId }).catch(() => ({
      payload: null,
      updatedAt: null,
    })),
    getHomeProfileReadOnlyByUserHouse({ userId: effectiveUserId, houseId: effectiveHouseId }).catch(() => null),
    getApplianceProfileSimulatedByUserHouse({ userId: effectiveUserId, houseId: effectiveHouseId }).catch(() => null),
    getOnePathTravelRangesFromDb(effectiveUserId, effectiveHouseId).catch(() => []),
  ]);
  const fallbackSimulatedHomeProfile =
    fetchedHomeProfile == null && syncedPinnedProfiles?.homeProfile == null
      ? await getHomeProfileSimulatedByUserHouse({ userId: effectiveUserId, houseId: effectiveHouseId }).catch(() => null)
      : null;
  const homeProfile = fetchedHomeProfile ?? syncedPinnedProfiles?.homeProfile ?? fallbackSimulatedHomeProfile ?? null;
  const applianceProfileRecord = fetchedApplianceProfileRecord ?? syncedPinnedProfiles?.applianceProfile ?? null;
  const applianceProfile = normalizeStoredApplianceProfile((applianceProfileRecord as any)?.appliancesJson ?? null);
  const adminManualSeeds =
    (previewMode === "MANUAL_MONTHLY" || previewMode === "MANUAL_ANNUAL") &&
    needsManualSeedForMode(previewMode, manualUsage.payload ?? null)
      ? await buildOnePathAdminManualSeeds({
          userId: effectiveUserId,
          houseId: effectiveHouseId,
          actualContextHouseId: previewActualContextHouse.id,
          smtSourceEsiid,
          payload: manualUsage.payload ?? null,
          dbTravelRanges: travelRangesFromDb,
        })
      : null;
  const effectiveManualUsagePayload =
    previewMode === "MANUAL_MONTHLY" || previewMode === "MANUAL_ANNUAL"
      ? applyExplicitTravelRangesToManualPayload(
          adminManualSeeds?.payloadForMode[previewMode] ?? manualUsage.payload ?? null,
          body?.travelRanges
        )
      : null;
  const weatherEnvelope = await resolveOnePathWeatherSensitivityEnvelope({
    actualDataset:
      previewMode === "MANUAL_MONTHLY" || previewMode === "MANUAL_ANNUAL" ? null : usageTruth?.dataset ?? null,
    manualUsagePayload: effectiveManualUsagePayload,
    homeProfile,
    applianceProfile,
    weatherHouseId: previewActualContextHouse.id,
    simulationVariablePolicy: previewSimulationVariablePolicy,
  }).catch(() => ({ score: null, derivedInput: null }));
  const previewLookupSourceContext = {
    committedUsageSource: sourceCommittedUsageSource,
    sourceManualUsagePayload: sourceManualUsageForPreset.payload ?? null,
    actualDatasetSummary: usageTruth?.dataset?.summary ?? null,
    actualDatasetMeta: (usageTruth?.dataset as any)?.meta ?? null,
    usageTruthSource: usageTruth?.usageTruthSource ?? "missing_usage_truth",
    usageTruthSeedResult: usageTruth?.seedResult ?? null,
    upstreamUsageTruth: usageTruth?.summary ?? null,
    smtRefreshCheck,
    pastBuildInputsSync: pastBuildInputsSync
      ? {
          ok: pastBuildInputsSync.ok,
          syncKind: pastBuildInputsSync.ok ? pastBuildInputsSync.syncKind : undefined,
          code: pastBuildInputsSync.ok ? undefined : pastBuildInputsSync.code,
        }
      : null,
    onePathTestHome: onePathTestHomeSummary,
    greenButtonUpload: actualContextGreenButtonUpload,
    manualUsagePayload: manualUsage.payload ?? null,
    effectiveManualUsagePayload,
    manualUsageUpdatedAt: manualUsage.updatedAt ?? null,
    manualStageOneView: buildOnePathManualStageOnePreview(effectiveManualUsagePayload),
    manualSeed: adminManualSeeds?.seed ?? null,
    travelRangesFromDb,
    homeProfile: homeProfile ?? null,
    applianceProfile: applianceProfile ?? null,
    weatherScore: weatherEnvelope.score ?? null,
    weatherDerivedInput: weatherEnvelope.derivedInput ?? null,
  } as const;
  const compactLookupBaselineResponse = previewMode === "GREEN_BUTTON";
  const sharedResolvedUsageLayer = usageTruth
    ? {
        dataset: usageTruth.dataset ?? null,
        alternatives: usageTruth.alternatives ?? { smt: null, greenButton: null },
      }
    : null;
  const lookupContractOpts = {
    lightweightActualUsage: true as const,
    skipLightweightInsightRecompute: (previewMode === "GREEN_BUTTON" ? false : true) as boolean,
  };
  const lookupContractProfileArgs = {
    userId: resolved.userId,
    homeProfile: homeProfile ?? null,
    applianceProfileRecord: applianceProfileRecord ?? null,
    ...lookupContractOpts,
  } as const;

  // User-site baseline contract: same GB passthrough + weather score as /api/user/usage.
  const userUsagePageBaselineContract =
    previewMode === "GREEN_BUTTON"
      ? await buildGreenButtonUserSiteParityContract({
          ...lookupContractProfileArgs,
          sourceHouse: {
            id: resolved.selectedHouse.id,
            label: resolved.selectedHouse.label ?? null,
            esiid: resolved.selectedHouse.esiid ?? null,
          },
          actualContextHouseId: previewActualContextHouse.id,
        }).catch(() => null)
      : await buildUserUsageHouseContract({
          ...lookupContractProfileArgs,
          house: {
            id: resolved.selectedHouse.id,
            label: resolved.selectedHouse.label ?? null,
            esiid: resolved.selectedHouse.esiid ?? null,
          },
          weatherHouseId: previewActualContextHouse.id,
          resolvedUsage: sharedResolvedUsageLayer,
          weatherSensitivity: {
            score: weatherEnvelope.score ?? null,
            derivedInput: weatherEnvelope.derivedInput ?? null,
          },
        }).catch(() => null);
  const userUsageBaselineContract = userUsagePageBaselineContract;
  const baselineParityAudit = buildOnePathBaselineParityAudit({
    houseContract: userUsageBaselineContract,
  });
  const baselineParityReport = compactLookupBaselineResponse
    ? null
    : buildBaselineParityReport({
        userUsagePageContract: userUsagePageBaselineContract,
        onePathBaselineContract: userUsageBaselineContract,
      });
  const userUsageBaselineView = buildOnePathBaselineReadOnlyView({
    houseContract: userUsagePageBaselineContract ?? userUsageBaselineContract,
    parityAudit: baselineParityAudit,
  });
  const readOnlyAudit = buildKnownHouseScenarioPrereqStatus({
    scenario: {
      mode: previewMode,
      scenarioSelectionStrategy:
        typeof body?.scenarioId === "string" && body.scenarioId.trim() ? "scenario_id" : "baseline",
    },
    lookupSourceContext: previewLookupSourceContext,
  });
  const environmentVisibility = buildEnvironmentVisibility();
  const runtimeEnvParityTrace = buildRuntimeEnvParityTrace({
    environmentVisibility,
  });

  if (action === "lookup" || !action) {
    return NextResponse.json({
      ok: true,
      debugDiagnosticsIncluded: true,
      email: resolved.email,
      userId: resolved.userId,
      houses: resolved.houses,
      selectedHouse: resolved.selectedHouse,
      scenarios: effectiveScenarios,
      sourceContext: {
        ...previewLookupSourceContext,
        userUsagePageBaselineContract,
        userUsageBaselineContract,
        userUsageBaselineView,
        baselineParityAudit,
        baselineParityReport,
        environmentVisibility,
        runtimeEnvParityTrace,
        readOnlyAudit,
      },
    });
  }

  return NextResponse.json({ ok: false, error: "unsupported_action" }, { status: 400 });
  } catch (error) {
    const esiidConflict = onePathEsiidSiblingConflictResponse(error);
    if (esiidConflict) return esiidConflict;
    throw error;
  }
}
