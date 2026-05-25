import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resolveStaleIncompleteMeterSlotCompleteDateKeys } from "@/lib/usage/pastSimStaleIncompleteMeter";
import { sageActualDailyRowsFromDataset } from "@/lib/usage/sageActualDailyTruth";
import { buildUserUsageHouseContract } from "@/lib/usage/userUsageHouseContract";
import { resolveIntervalsLayer } from "@/lib/usage/resolveIntervalsLayer";
import { IntervalSeriesKind } from "@/modules/usageSimulator/kinds";
import {
  ensureSmtCoverageForHouse,
  type EnsureSmtCoverageResult,
} from "@/lib/usage/ensureSmtCoverage";
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
import { getApplianceProfileSimulatedByUserHouse } from "@/modules/applianceProfile/repo";
import { normalizeStoredApplianceProfile } from "@/modules/applianceProfile/validation";
import {
  gateOnePathSimAdmin,
  requireOnePathWritableContext,
  resolveOnePathSimOwnerUserId,
  resolveOnePathSimUserSelection,
} from "./_helpers";
import {
  ensureGlobalOnePathLabTestHomeHouse,
  getOnePathLabTestHomeLink,
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
import { buildOnePathBaselineReadOnlyView } from "@/modules/onePathSim/baselineReadOnlyView";
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
import type { ManualUsagePayload } from "@/modules/onePathSim/simulatedUsage/types";
import { buildValidationCompareProjectionSidecar } from "@/modules/onePathSim/usageSimulator/compareProjection";
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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const GREEN_BUTTON_ROUTE_STAGE_TIMEOUT_MS = 120_000;
/** Same heal profile as POST /api/user/usage/refresh. */
const ONE_PATH_SMT_HEAL_PROFILE = "user_session" as const;

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
      ...(args.artifactDatasetMeta ?? {}),
      ...(args.forceBaselinePassthrough ? { baselinePassthrough: true } : {}),
    },
  };
}

function buildCompactArtifactSummary(artifact: Record<string, unknown> | null) {
  return artifact
    ? {
        artifactId: artifact.artifactId ?? null,
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
  smtSourceEsiid?: string | null;
  payload: ManualUsagePayload | null;
  overrideTravelRanges?: unknown;
  dbTravelRanges?: unknown;
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
  const preferredSourcePayload = shouldPreferActualDerivedAdminMonthlyPayload({
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
  smtSourceEsiid?: string | null;
  preferredActualSource?: "SMT" | "GREEN_BUTTON" | null;
}) {
  return resolveOnePathUpstreamUsageTruthForSimulation({
    userId: args.userId,
    houseId: args.houseId,
    actualContextHouseId: args.actualContextHouseId ?? args.houseId,
    smtSourceEsiid: args.smtSourceEsiid ?? null,
    seedIfMissing: false,
    preferredActualSource: args.preferredActualSource ?? null,
  }).catch(() => null);
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

async function sageAndStaleIncompleteDisplayArgs(args: {
  sageDataset: unknown;
  datasetForMeta: Record<string, unknown> | null | undefined;
  smtSourceEsiid: string | null | undefined;
}) {
  const sageDisplayArgs = sageDisplayViewArgsFromDataset(args.sageDataset);
  const smtSlotCompleteDateKeys = await resolveStaleIncompleteMeterSlotCompleteDateKeys({
    esiid: args.smtSourceEsiid,
    meta: asRecord(args.datasetForMeta)?.meta ?? args.datasetForMeta,
  });
  return { ...sageDisplayArgs, smtSlotCompleteDateKeys };
}

async function buildPastSimRunReadbackResponse(args: {
  userId: string;
  houseId: string;
  scenarioId: string;
  correlationId?: string | null;
  readMode?: "artifact_only" | "allow_rebuild";
  smtPostSimHealing?: PastSimReadbackSmtHealingArgs | null;
  actualContextHouseId?: string | null;
  preferredActualSource?: "SMT" | "GREEN_BUTTON" | null;
  smtSourceEsiid?: string | null;
}) {
  const readMode = args.readMode ?? "artifact_only";
  const startedAt = Date.now();
  logSimPipelineEvent("one_path_admin_past_readback_start", {
    correlationId: args.correlationId ?? null,
    houseId: args.houseId,
    scenarioId: args.scenarioId,
    readMode,
    source: "buildPastSimRunReadbackResponse",
    memoryRssMb: getMemoryRssMb(),
  });
  const readScenarioDataset = (forceRebuildArtifact = false) =>
    readOnePathSimulatedUsageScenario({
      userId: args.userId,
      houseId: args.houseId,
      scenarioId: args.scenarioId,
      readMode,
      forceRebuildArtifact,
      projectionMode: "baseline",
      readContext: {
        artifactReadMode: readMode,
        projectionMode: "baseline",
        compareSidecarRequest: true,
      },
    });

  let readback = await readScenarioDataset();
  if (!readback.ok) {
    logSimPipelineEvent("one_path_admin_past_readback_failure", {
      correlationId: args.correlationId ?? null,
      houseId: args.houseId,
      scenarioId: args.scenarioId,
      readMode,
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
    readMode,
    durationMs: Date.now() - startedAt,
    source: "buildPastSimRunReadbackResponse",
    memoryRssMb: getMemoryRssMb(),
  });
  const sidecarStartedAt = Date.now();
  const compareProjection = buildValidationCompareProjectionSidecar(readback.dataset);
  logSimPipelineEvent("one_path_admin_past_compare_sidecar_success", {
    correlationId: args.correlationId ?? null,
    houseId: args.houseId,
    scenarioId: args.scenarioId,
    rowCount: Array.isArray(compareProjection.rows) ? compareProjection.rows.length : 0,
    durationMs: Date.now() - sidecarStartedAt,
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
  const sageTruth = await resolveSageActualTruthForRunDisplay({
    userId: args.userId,
    houseId: args.houseId,
    actualContextHouseId:
      args.actualContextHouseId ?? args.smtPostSimHealing?.actualContextHouseId ?? args.houseId,
    smtSourceEsiid: args.smtSourceEsiid ?? args.smtPostSimHealing?.sourceEsiid ?? null,
    preferredActualSource:
      args.preferredActualSource ?? args.smtPostSimHealing?.preferredActualSource ?? null,
  });
  const sageDisplayArgs = await sageAndStaleIncompleteDisplayArgs({
    sageDataset: sageTruth?.dataset,
    datasetForMeta: asRecord(readback.dataset),
    smtSourceEsiid: args.smtSourceEsiid ?? args.smtPostSimHealing?.sourceEsiid ?? null,
  });
  const runDisplayViewBase =
    buildOnePathRunReadOnlyView({
      dataset: asRecord(readback.dataset),
      readModel: { compareProjection },
      ...sageDisplayArgs,
    }) ?? null;
  logSimPipelineEvent("one_path_admin_past_display_view_success", {
    correlationId: args.correlationId ?? null,
    houseId: args.houseId,
    scenarioId: args.scenarioId,
    hasDisplayView: runDisplayViewBase != null,
    durationMs: Date.now() - displayViewStartedAt,
    source: "buildPastSimRunReadbackResponse",
    memoryRssMb: getMemoryRssMb(),
  });
  const pastVariables =
    scenarioEvents.ok && Array.isArray(scenarioEvents.events)
      ? scenarioEvents.events
          .map((event) => asScenarioVariable(event))
          .filter((event): event is NonNullable<ReturnType<typeof asScenarioVariable>> => event != null)
      : [];

  logSimPipelineEvent("one_path_admin_past_response_ready", {
    correlationId: args.correlationId ?? null,
    houseId: args.houseId,
    scenarioId: args.scenarioId,
    pastVariableCount: pastVariables.length,
    durationMs: Date.now() - startedAt,
    source: "buildPastSimRunReadbackResponse",
    memoryRssMb: getMemoryRssMb(),
  });
  const compactRunDisplayView =
    runDisplayViewBase != null
      ? {
          ...runDisplayViewBase,
          pastVariables,
        }
      : null;
  return {
    ok: true as const,
    debugDiagnosticsIncluded: false,
    executionMode: "artifact_readback" as const,
    readbackPending: false,
    runType: "PAST_SIM" as const,
    correlationId: args.correlationId ?? null,
    manualStageOneView: null,
    runDisplayView: compactRunDisplayView,
    artifact: null,
    readModel: buildCompactSimulationReadModel({
      artifact: null,
      artifactDataset: asRecord(readback.dataset),
      artifactDatasetMeta: asRecord(asRecord(readback.dataset)?.meta),
      runDisplayView: compactRunDisplayView,
      compareProjection,
    }),
  };
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

  if (latestUpload) {
    return {
      ...latestUpload,
      dateRangeStart: derivedCoverage?.start ?? latestUpload.dateRangeStart ?? null,
      dateRangeEnd: derivedCoverage?.end ?? latestUpload.dateRangeEnd ?? null,
      intervalCount: derivedCoverage?.count ?? 0,
      hasPersistedUsageIntervals: Boolean(derivedCoverage),
    };
  }

  if (!derivedCoverage) return null;
  return {
    id: "derived-coverage",
    createdAt: derivedCoverage.start ?? null,
    updatedAt: derivedCoverage.end ?? null,
    parseStatus: "complete",
    parseMessage: null,
    dateRangeStart: derivedCoverage.start,
    dateRangeEnd: derivedCoverage.end,
    intervalMinutes: 15,
    fileName: "derived",
    fileSizeBytes: null,
    intervalCount: derivedCoverage.count,
    hasPersistedUsageIntervals: true,
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

/** SMT pull/backfill must run on a house with ESIID + authorization; pinned lab homes keep esiid null by design. */
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

async function resolveOnePathTestHomeState(args: {
  ownerUserId: string;
  selectedSourceHouseId: string;
  fallbackSourceHouseId?: string | null;
  preferredTestHomeHouseId?: string | null;
}) {
  const ensured = await ensureGlobalOnePathLabTestHomeHouse(args.ownerUserId);
  const link = await getOnePathLabTestHomeLink(args.ownerUserId);
  const preferredTestHomeHouseId =
    typeof args.preferredTestHomeHouseId === "string" && args.preferredTestHomeHouseId.trim()
      ? args.preferredTestHomeHouseId.trim()
      : null;
  const testHomeHouseId = String(
    (preferredTestHomeHouseId && preferredTestHomeHouseId === ensured.id ? preferredTestHomeHouseId : null) ??
      link?.testHomeHouseId ??
      ensured.id
  );
  const testHomeHouse = await (prisma as any).houseAddress
    .findFirst({
      where: { id: testHomeHouseId, userId: args.ownerUserId, archivedAt: null },
      select: { id: true, label: true, esiid: true },
    })
    .catch(() => null);
  const linkedSourceHouseId =
    (link?.sourceHouseId ? String(link.sourceHouseId) : null) ??
    (typeof args.fallbackSourceHouseId === "string" && args.fallbackSourceHouseId.trim()
      ? args.fallbackSourceHouseId.trim()
      : null);
  const status = String(link?.status ?? (testHomeHouse && linkedSourceHouseId ? "ready" : testHomeHouse ? "unlinked" : "replacing"));
  const isPinned = Boolean(
    testHomeHouse?.id && status === "ready" && linkedSourceHouseId && linkedSourceHouseId === args.selectedSourceHouseId
  );
  return {
    ownerUserId: args.ownerUserId,
    testHomeHouseId,
    testHomeHouse: testHomeHouse
      ? {
          id: String(testHomeHouse.id),
          label: String(testHomeHouse.label ?? ""),
          esiid: testHomeHouse.esiid ? String(testHomeHouse.esiid) : null,
        }
      : null,
    linkedSourceHouseId,
    linkedSourceUserId: link?.sourceUserId ? String(link.sourceUserId) : null,
    status,
    statusMessage:
      link?.statusMessage ? String(link.statusMessage) : linkedSourceHouseId ? "Using request-scoped One Path test-home binding." : null,
    lastReplacedAt: link?.lastReplacedAt ? new Date(link.lastReplacedAt).toISOString() : null,
    isPinned,
    needsReplace: !isPinned,
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
  const effectiveUserId = onePathTestHomeState.isPinned ? ownerUserId : resolved.userId;
  const effectiveHouseId = onePathTestHomeState.isPinned ? onePathTestHomeState.testHomeHouseId : resolved.selectedHouse.id;
  const onePathUsageTruthHouseId =
    onePathTestHomeState.isPinned && onePathTestHomeState.testHomeHouseId
      ? onePathTestHomeState.testHomeHouseId
      : null;
  const defaultActualContextHouseId = onePathUsageTruthHouseId ?? resolved.selectedHouse.id;
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

  if (action === "run") {
    const mode = normalizeMode(body?.mode);
    const correlationId = createSimCorrelationId();
    const stageTimingsMs: Record<string, number> = {};
    const isManualMode = mode === "MANUAL_MONTHLY" || mode === "MANUAL_ANNUAL";
    const manualUsage =
      isManualMode
        ? await getOnePathManualUsageInput({ userId: effectiveUserId, houseId: effectiveHouseId }).catch(() => ({
            payload: null,
            updatedAt: null,
          }))
        : { payload: null, updatedAt: null };
    const rawInputBase = {
      userId: effectiveUserId,
      houseId: effectiveHouseId,
      actualContextHouseId: defaultActualContextHouseId,
      smtSourceEsiid,
      preferredActualSource:
        body?.preferredActualSource === "SMT" || body?.preferredActualSource === "GREEN_BUTTON"
          ? body.preferredActualSource
          : null,
      scenarioId: typeof body?.scenarioId === "string" && body.scenarioId.trim() ? body.scenarioId.trim() : null,
      weatherPreference:
        body?.weatherPreference === "NONE" || body?.weatherPreference === "LONG_TERM_AVERAGE"
          ? body.weatherPreference
          : "LAST_YEAR_WEATHER",
      validationSelectionMode:
        typeof body?.validationSelectionMode === "string" && body.validationSelectionMode.trim()
          ? body.validationSelectionMode.trim()
          : null,
      validationDayCount:
        typeof body?.validationDayCount === "number" && Number.isFinite(body.validationDayCount)
          ? body.validationDayCount
          : null,
      validationOnlyDateKeysLocal: Array.isArray(body?.validationOnlyDateKeysLocal)
        ? body.validationOnlyDateKeysLocal.map((value: unknown) => String(value ?? "").slice(0, 10))
        : [],
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
    const adminManualSeeds =
      isManualMode
        ? await buildOnePathAdminManualSeeds({
            userId: effectiveUserId,
            houseId: effectiveHouseId,
            actualContextHouseId: effectiveRawInputBase.actualContextHouseId,
            smtSourceEsiid,
            payload: manualUsage.payload ?? null,
            overrideTravelRanges: effectiveRawInputBase.travelRanges,
            dbTravelRanges: await getOnePathTravelRangesFromDb(effectiveUserId, effectiveHouseId).catch(() => []),
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
      if (!includeDebugDiagnostics && effectiveRawInputBase.scenarioId && !isManualMode) {
        const readback = await buildPastSimRunReadbackResponse({
          userId: effectiveUserId,
          houseId: effectiveHouseId,
          scenarioId: effectiveRawInputBase.scenarioId,
          correlationId,
          readMode: "allow_rebuild",
          actualContextHouseId: effectiveRawInputBase.actualContextHouseId,
          preferredActualSource: effectiveRawInputBase.preferredActualSource,
          smtSourceEsiid,
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
      let engineInput =
        mode === "INTERVAL"
          ? await adaptIntervalRawInput(effectiveRawInputBase)
          : mode === "GREEN_BUTTON"
            ? await withAdminRouteStageTimeout({
                stage: "adapt_green_button_raw_input",
                correlationId,
                timeoutMs: GREEN_BUTTON_ROUTE_STAGE_TIMEOUT_MS,
                mode,
                houseId: effectiveHouseId,
                stageTimingsMs,
                promise: adaptGreenButtonRawInput(effectiveRawInputBase),
              })
          : mode === "MANUAL_ANNUAL"
            ? await adaptManualAnnualRawInput({
                ...effectiveRawInputBase,
                manualUsagePayload: effectiveManualUsagePayload,
              })
            : mode === "NEW_BUILD"
              ? await adaptNewBuildRawInput(effectiveRawInputBase)
              : await adaptManualMonthlyRawInput({
                  ...effectiveRawInputBase,
                  manualUsagePayload: effectiveManualUsagePayload,
                });
      let slimEngineInput = buildSlimAdminEngineInput(engineInput);
      if (mode === "GREEN_BUTTON" && !effectiveRawInputBase.scenarioId) {
        const baselineDataset = asRecord(
          await withAdminRouteStageTimeout({
            stage: "build_green_button_baseline_dataset",
            correlationId,
            timeoutMs: GREEN_BUTTON_ROUTE_STAGE_TIMEOUT_MS,
            mode,
            houseId: effectiveHouseId,
            stageTimingsMs,
            promise: buildIntervalLikeBaselinePassthroughDataset(engineInput),
          })
        );
        const baselineDatasetMeta = asRecord(baselineDataset?.meta);
        const compactRunDisplayView =
          (
            await withAdminRouteStageTimeout({
              stage: "build_green_button_baseline_view",
              correlationId,
              timeoutMs: GREEN_BUTTON_ROUTE_STAGE_TIMEOUT_MS,
              mode,
              houseId: effectiveHouseId,
              stageTimingsMs,
              promise: Promise.resolve(
                buildOnePathRunReadOnlyView({
                  dataset: baselineDataset,
                  engineInput: asRecord(engineInput),
                  readModel: null,
                  weatherSensitivityScore: engineInput.weatherSensitivityScore ?? null,
                }) ?? null
              ),
            })
          ) ?? null;
        const compactReadModel =
          compactRunDisplayView || baselineDataset
            ? {
                dataset: buildCompactRunReadModelDataset({
                  artifactDataset: baselineDataset,
                  artifactDatasetMeta: baselineDatasetMeta,
                  runDisplayView: compactRunDisplayView,
                  forceBaselinePassthrough: true,
                }),
              }
            : null;
        return NextResponse.json({
          ok: true,
          debugDiagnosticsIncluded: false,
          runType: "BASELINE_PASSTHROUGH",
          correlationId,
          engineInput: slimEngineInput,
          manualStageOneView: null,
          runDisplayView: compactRunDisplayView,
          artifact: null,
          readModel: compactReadModel,
        });
      }
      let artifact = await runSharedSimulation(engineInput);
      let artifactDataset = asRecord(artifact.dataset);
      let artifactDatasetMeta = asRecord(artifactDataset?.meta);
      const isGreenButtonBaselinePassthroughRun =
        mode === "GREEN_BUTTON" &&
        !effectiveRawInputBase.scenarioId &&
        Boolean(artifactDatasetMeta?.baselinePassthrough);
      if (isGreenButtonBaselinePassthroughRun) {
        const compactRunDisplayView =
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
          }) ?? null;
        const compactReadModel =
          compactRunDisplayView || artifactDataset
            ? {
                dataset: buildCompactRunReadModelDataset({
                  artifactDataset,
                  artifactDatasetMeta,
                  runDisplayView: compactRunDisplayView,
                  forceBaselinePassthrough: true,
                }),
              }
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
        });
      }
      const shouldReturnCompactPastResponse = Boolean(effectiveRawInputBase.scenarioId && !isManualMode);
      const sageTruthForPastDisplay = await resolveSageActualTruthForRunDisplay({
        userId: effectiveUserId,
        houseId: effectiveHouseId,
        actualContextHouseId: effectiveRawInputBase.actualContextHouseId,
        smtSourceEsiid,
        preferredActualSource: effectiveRawInputBase.preferredActualSource,
      });
      const sageDisplayArgsForPast = await sageAndStaleIncompleteDisplayArgs({
        sageDataset: sageTruthForPastDisplay?.dataset,
        datasetForMeta: artifactDataset,
        smtSourceEsiid,
      });
      if (shouldReturnCompactPastResponse) {
        const compactRunDisplayView =
          buildOnePathRunReadOnlyView({
            dataset: artifactDataset,
            engineInput: asRecord(engineInput),
            readModel: { compareProjection: artifact.compareProjection },
            ...sageDisplayArgsForPast,
          }) ?? null;
        const compactReadModel = buildCompactSimulationReadModel({
          artifact: asRecord(artifact),
          artifactDataset,
          artifactDatasetMeta,
          runDisplayView: compactRunDisplayView,
          compareProjection: artifact.compareProjection,
        });
        return NextResponse.json({
          ok: true,
          debugDiagnosticsIncluded: false,
          debugDiagnosticsSuppressedReason: "past_sim_compact_response",
          runType: "PAST_SIM",
          engineInput: slimEngineInput,
          manualStageOneView: artifact.manualStageOneView ?? null,
          runDisplayView: compactRunDisplayView,
          artifact: null,
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
      const manualRunDisplayView =
        manualPastReadResult && manualPastReadResult.ok
          ? buildOnePathRunReadOnlyView({
              dataset: asRecord(manualPastReadResult.displayDataset),
              engineInput: asRecord(engineInput),
              readModel: { compareProjection: manualPastReadResult.compareProjection },
              weatherSensitivityScore: engineInput.weatherSensitivityScore ?? null,
              ...manualSageDisplayArgs,
            })
          : null;
      const runDisplayView =
        manualRunDisplayView ??
        buildOnePathRunReadOnlyView({
          dataset: asRecord(readModel.dataset),
          engineInput: asRecord(engineInput),
          readModel: asRecord(readModel),
          weatherSensitivityScore: engineInput.weatherSensitivityScore ?? null,
          ...sageDisplayArgsForPast,
        }) ??
        null;
      if (!includeDebugDiagnostics) {
        const compactReadModel = buildCompactSimulationReadModel({
          artifact: asRecord(artifact),
          artifactDataset: asRecord(readModel.dataset),
          artifactDatasetMeta: asRecord(asRecord(readModel.dataset)?.meta),
          runDisplayView,
          compareProjection: readModel.compareProjection,
          forceBaselinePassthrough: Boolean(artifactDatasetMeta?.baselinePassthrough),
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
          artifact: null,
          readModel: compactReadModel,
        });
      }
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
        readModel,
        manualStageOneView: readModel.manualStageOneView ?? null,
        runDisplayView,
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
      throw error;
    }
  }

  const previewMode =
    typeof body?.mode === "string" && body.mode.trim()
      ? normalizeMode(body.mode)
      : "INTERVAL";
  const lightweightLookupRequested = body?.lightweightLookup === true;

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
    const previewActualContextHouseId =
      typeof body?.actualContextHouseId === "string" && body.actualContextHouseId.trim()
        ? defaultActualContextHouseId
        : defaultActualContextHouseId;
    const greenButtonUpload = await loadGreenButtonUploadSummary(previewActualContextHouseId);
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
        onePathTestHome: onePathTestHomeSummary,
        smtRefreshCheck,
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

  const previewActualContextHouse =
    onePathTestHomeState.isPinned && onePathTestHomeState.testHomeHouse
      ? onePathTestHomeState.testHomeHouse
      : resolved.houses.find(
            (house) =>
              house.id ===
              (typeof body?.actualContextHouseId === "string" && body.actualContextHouseId.trim()
                ? body.actualContextHouseId.trim()
                : resolved.selectedHouse.id)
          ) ?? resolved.selectedHouse;
  const actualContextGreenButtonUpload = await loadGreenButtonUploadSummary(previewActualContextHouse.id);
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
    resolveOnePathUpstreamUsageTruthForSimulation({
      userId: effectiveUserId,
      houseId: effectiveHouseId,
      actualContextHouseId: previewActualContextHouse.id,
      smtSourceEsiid,
      seedIfMissing: false,
      preferredActualSource: previewMode === "GREEN_BUTTON" ? "GREEN_BUTTON" : null,
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
    actualDatasetSummary: usageTruth?.dataset?.summary ?? null,
    actualDatasetMeta: (usageTruth?.dataset as any)?.meta ?? null,
    usageTruthSource: usageTruth?.usageTruthSource ?? "missing_usage_truth",
    usageTruthSeedResult: usageTruth?.seedResult ?? null,
    upstreamUsageTruth: usageTruth?.summary ?? null,
    smtRefreshCheck,
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
    skipLightweightInsightRecompute: true as const,
  };
  const { resolveGreenButtonBaselineUsageForUserSite } = await import("@/lib/usage/greenButtonUserSiteBaseline");
  const { isGreenButtonPrimaryDataset } = await import("@/lib/usage/smtTailCoverage");

  let sourceBaselineResolvedUsage: {
    dataset: unknown;
    alternatives: { smt: unknown; greenButton: unknown };
  } | null = null;
  if (compactLookupBaselineResponse) {
    const sourceLayer = await resolveIntervalsLayer({
      userId: resolved.userId,
      houseId: resolved.selectedHouse.id,
      layerKind: IntervalSeriesKind.ACTUAL_USAGE_INTERVALS,
      esiid: resolved.selectedHouse.esiid ?? null,
      lightweightActualUsage: true,
      skipLightweightInsightRecompute: true,
    }).catch(() => null);
    if (sourceLayer && isGreenButtonPrimaryDataset(sourceLayer.dataset)) {
      sourceBaselineResolvedUsage = await resolveGreenButtonBaselineUsageForUserSite({
        userId: resolved.userId,
        houseId: resolved.selectedHouse.id,
        actualContextHouseId: previewActualContextHouse.id,
        resolvedUsage: sourceLayer,
      }).catch(() => null);
    }
  }

  // User-site baseline contract: same GB passthrough + weather score as /api/user/usage.
  const userUsagePageBaselineContract = await buildUserUsageHouseContract({
    userId: resolved.userId,
    house: {
      id: resolved.selectedHouse.id,
      label: resolved.selectedHouse.label ?? null,
      esiid: resolved.selectedHouse.esiid ?? null,
    },
    weatherHouseId: previewActualContextHouse.id,
    homeProfile: homeProfile ?? null,
    applianceProfileRecord: applianceProfileRecord ?? null,
    ...(sourceBaselineResolvedUsage ? { resolvedUsage: sourceBaselineResolvedUsage } : {}),
    ...lookupContractOpts,
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
}
