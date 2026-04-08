import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { prisma } from "@/lib/db";
import { homeDetailsPrisma } from "@/lib/db/homeDetailsClient";
import { appliancesPrisma } from "@/lib/db/appliancesClient";
import { normalizeEmailSafe } from "@/lib/utils/email";
import { getActualIntervalsForRange, getActualUsageDatasetForHouse } from "@/lib/usage/actualDatasetForHouse";
import { runSimulatorDiagnostic } from "@/lib/admin/simulatorDiagnostic";
import { chooseActualSource } from "@/modules/realUsageAdapter/actual";
import {
  buildDailyWeatherFeaturesFromHourly,
  dateKeyInTimezone,
  localDateKeysInRange,
  getLocalDayOfWeekFromDateKey,
  getCandidateDateCoverageForSelection,
  mergeDateKeysToRanges,
  pickRandomTestDateKeys,
  type DayTotalDiagnostics,
  filterCandidateDateKeysBySeason,
  pickExtremeWeatherTestDateKeys,
} from "@/lib/admin/gapfillLab";
import {
  selectValidationDayKeys,
  normalizeValidationSelectionMode,
  VALIDATION_DAY_SELECTION_MODES,
  type ValidationDaySelectionMode,
} from "@/modules/usageSimulator/validationSelection";
import {
  buildValidationCompareProjectionSidecar,
} from "@/modules/usageSimulator/compareProjection";
import { getWeatherForRange } from "@/lib/sim/weatherProvider";
import { loadDisplayProfilesForHouse } from "@/modules/usageSimulator/profileDisplay";
import { validateHomeProfile } from "@/modules/homeProfile/validation";
import { validateApplianceProfile, normalizeStoredApplianceProfile } from "@/modules/applianceProfile/validation";
import { dispatchPastSimRecalc } from "@/modules/usageSimulator/pastSimRecalcDispatch";
import { getPastSimRecalcJobForUser } from "@/modules/usageSimulator/simDropletJob";
import {
  getSimulatedUsageForHouseScenario,
  recalcSimulatorBuild,
  getUserDefaultValidationSelectionMode,
  setUserDefaultValidationSelectionMode,
  getAdminLabDefaultValidationSelectionMode,
  type GapfillCompareBuildPhase,
  type GapfillScoredDayParityAvailability,
  type GapfillScoredDayParityDisplayValueKind,
  type GapfillScoredDayParityReasonCode,
  getSharedPastCoverageWindowForHouse,
} from "@/modules/usageSimulator/service";
import {
  getGapfillCompareRunSnapshotById,
  markGapfillCompareRunFailed,
} from "@/modules/usageSimulator/compareRunSnapshot";
import {
  ensureGlobalLabTestHomeHouse,
  getLabTestHomeLink,
  replaceGlobalLabTestHomeFromSource,
  GAPFILL_LAB_TEST_HOME_LABEL,
} from "@/modules/usageSimulator/labTestHome";
import { createSimCorrelationId, logSimPipelineEvent } from "@/modules/usageSimulator/simObservability";
import { attachFailureContract } from "@/lib/api/usageSimulationApiContract";
import {
  GAPFILL_CANONICAL_LAB_TREATMENT_MODE,
  readEffectiveValidationFromBuildInputs,
  serializeFingerprintBuildFreshnessFromDatasetMeta,
} from "@/lib/api/gapfillLabAdminSerialization";
import {
  ADMIN_LAB_TREATMENT_MODES,
  isAdminLabTreatmentMode,
} from "@/modules/usageSimulator/adminLabTreatment";
import {
  resolveAdminValidationPolicy,
  resolveTestHomeUsageInputMode,
  resolveTestHomeUsageModeRecalcConfig,
  resolveUserValidationPolicy,
  type TestHomeUsageInputMode,
  type ValidationPolicyOwner,
} from "@/modules/usageSimulator/pastSimPolicy";
import {
  resolveGapfillWeatherLogicSetting,
  resolveUserWeatherLogicSetting,
} from "@/modules/usageSimulator/pastSimWeatherPolicy";
import {
  buildManualUsageStageOneResolvedSeeds,
  resolveManualUsageStageOnePayloadForMode,
} from "@/modules/manualUsage/prefill";
import { getManualUsageInputForUserHouse } from "@/modules/manualUsage/store";
import { buildManualUsagePastSimReadResult } from "@/modules/manualUsage/pastSimReadResult";
import type { ManualUsagePayload } from "@/modules/simulatedUsage/types";
import { buildSharedPastSimDiagnostics } from "@/modules/usageSimulator/sharedDiagnostics";
import { usagePrisma } from "@/lib/db/usageClient";
import { IntervalSeriesKind } from "@/modules/usageSimulator/kinds";
import {
  classifySimulationFailure,
  recordSimulationDataAlert,
} from "@/modules/usageSimulator/simulationDataAlerts";
import { monthsEndingAt } from "@/lib/time/chicago";
import { buildDisplayMonthlyFromIntervalsUtc } from "@/modules/usageSimulator/dataset";
import { travelRangesToExcludeDateKeys } from "@/modules/usageSimulator/build";
import { boundDateKeysToCoverageWindow } from "@/modules/usageSimulator/metadataWindow";
import {
  getGapfillCompareEnqueueDiagnostics,
} from "@/modules/usageSimulator/dropletSimWebhook";
import {
  runGapfillCompareCorePipeline,
  type GapfillComparePipelineState,
  type GapfillCompareRunOut,
} from "@/modules/usageSimulator/gapfillCompareCorePipeline";
import {
  GapfillLabScoredDayTruthRow,
  DateRange,
  Usage365Payload,
  IntervalPoint,
  shiftIsoDateUtc,
  normalizeFifteenCurve96,
  sortedSample,
  setIntersect,
  round2,
  type CompareCoreStepKey,
  startCompareCoreTiming,
  markCompareCoreStep,
  finalizeCompareCoreTiming,
  buildHeavyTiming,
  buildSelectedDaysCoreResponseModelAssumptions,
  withTimeout,
  withRequestAbort,
  attachAbortForwarders,
  normalizeRouteError,
  type GapfillSnapshotReaderAction,
  toSnapshotReaderAction,
  buildSnapshotReaderBase,
  safeRatio,
  bucketHourBlock,
  classifyTemperatureBand,
  classifyWeatherRegime,
  topCounts,
  isValidIanaTimezone,
  getLocalHourMinuteInTimezone,
  buildUsage365Payload,
  getTravelRangesFromDb,
  REPORT_VERSION,
  TRUNCATE_LIST,
  buildFullReport,
  ROUTE_COMPARE_SHARED_TIMEOUT_MS,
  ROUTE_COMPARE_REPORT_TIMEOUT_MS,
} from "./gapfillLabRouteHelpers";
import { buildSourceHomePastSimSnapshot } from "./sourceHomePastSimSnapshot";


export const dynamic = "force-dynamic";
// Vercel serverless ceiling (seconds). Canonical test-home recalc can run several minutes (fingerprints + day sim).
// Keep sum(recalc timeout + post-recalc artifact read) under this with margin.
export const maxDuration = 300;
/** Shared rebuilds (artifact ensure, etc.); stay well under maxDuration. */
const ROUTE_REBUILD_SHARED_TIMEOUT_MS = 120_000;
/** `run_test_home_canonical_recalc`: `recalcSimulatorBuild` alone can exceed 75s on real houses. */
const ROUTE_CANONICAL_RECALC_TIMEOUT_MS = 240_000;
/** Read after successful recalc; must leave headroom under maxDuration when added to recalc. */
const ROUTE_CANONICAL_READ_AFTER_RECALC_TIMEOUT_MS = 55_000;
const SOURCE_HOME_PAST_SIM_POLL_MS = 2000;

const ADMIN_EMAILS = ["brian@intelliwatt.com", "brian@intellipath-solutions.com"];
const VALIDATION_SELECTION_MODES = [
  ...VALIDATION_DAY_SELECTION_MODES,
] as const;

function gapfillHouseGroupKey(house: {
  addressLine1?: unknown;
  addressCity?: unknown;
  addressState?: unknown;
  addressZip5?: unknown;
}): string {
  return [
    String(house?.addressLine1 ?? "").trim().toLowerCase(),
    String(house?.addressCity ?? "").trim().toLowerCase(),
    String(house?.addressState ?? "").trim().toLowerCase(),
    String(house?.addressZip5 ?? "").trim().toLowerCase(),
  ].join("|");
}

function selectCanonicalGapfillHouseFromGroup<T extends {
  id?: unknown;
  esiid?: unknown;
  addressLine1?: unknown;
  addressCity?: unknown;
  addressState?: unknown;
  addressZip5?: unknown;
}>(houses: T[], selectedId?: string | null): T | null {
  const candidates = houses.filter(Boolean);
  if (candidates.length === 0) return null;
  const exact = selectedId
    ? candidates.find((house) => String(house?.id ?? "").trim() === String(selectedId).trim()) ?? null
    : null;
  const withEsiid = candidates.find((house) => String(house?.esiid ?? "").trim()) ?? null;
  return withEsiid ?? exact ?? candidates[0] ?? null;
}

function buildCanonicalGapfillSourceHouseOptions<T extends {
  id?: unknown;
  esiid?: unknown;
  addressLine1?: unknown;
  addressCity?: unknown;
  addressState?: unknown;
  addressZip5?: unknown;
}>(houses: T[], testHomeHouseId?: string | null): T[] {
  const filtered = houses.filter(
    (house) => !(testHomeHouseId && String(house?.id ?? "").trim() === String(testHomeHouseId).trim())
  );
  const groups = new Map<string, T[]>();
  for (const house of filtered) {
    const key = gapfillHouseGroupKey(house);
    const bucket = groups.get(key) ?? [];
    bucket.push(house);
    groups.set(key, bucket);
  }
  return Array.from(groups.values())
    .map((group) => selectCanonicalGapfillHouseFromGroup(group))
    .filter((house): house is T => Boolean(house));
}

function resolveCanonicalGapfillSourceHouse<T extends {
  id?: unknown;
  esiid?: unknown;
  addressLine1?: unknown;
  addressCity?: unknown;
  addressState?: unknown;
  addressZip5?: unknown;
}>(houses: T[], selectedId?: string | null, testHomeHouseId?: string | null): T | null {
  const exact = houses.find((house) => String(house?.id ?? "").trim() === String(selectedId ?? "").trim()) ?? null;
  if (!exact) return null;
  const groupKey = gapfillHouseGroupKey(exact);
  const siblings = houses.filter(
    (house) =>
      gapfillHouseGroupKey(house) === groupKey &&
      !(testHomeHouseId && String(house?.id ?? "").trim() === String(testHomeHouseId).trim())
  );
  return selectCanonicalGapfillHouseFromGroup(siblings, selectedId);
}

function buildSourceCopySelectionDiagnostics(args: {
  selectionMode: ValidationDaySelectionMode;
  selectedDateKeys: string[];
}) {
  return {
    modeUsed: args.selectionMode,
    targetCount: args.selectedDateKeys.length,
    selectedCount: args.selectedDateKeys.length,
    fallbackSubstitutions: 0,
    excludedTravelVacantCount: 0,
    excludedWeakCoverageCount: 0,
    weekdayWeekendSplit: null,
    seasonalSplit: null,
    bucketCounts: { source_copy: args.selectedDateKeys.length },
    shortfallReason: null,
    sourceCopy: true,
  };
}

function shouldUseCanonicalSourceCopyPolicy(args: {
  usageInputMode: TestHomeUsageInputMode;
  explicitAdminValidationMode: ValidationDaySelectionMode | null;
  testRanges: DateRange[];
  testDaysRequested: number | null;
}): boolean {
  return (
    args.usageInputMode === "EXACT_INTERVALS" &&
    !args.explicitAdminValidationMode &&
    args.testRanges.length === 0 &&
    args.testDaysRequested == null
  );
}

function isGapfillManualUsageInputMode(usageInputMode: TestHomeUsageInputMode): boolean {
  return (
    usageInputMode === "MONTHLY_FROM_SOURCE_INTERVALS" ||
    usageInputMode === "ANNUAL_FROM_SOURCE_INTERVALS"
  );
}

function statusForGapfillManualReadResultFailure(result: {
  error?: string | null;
  failureCode?: string | null;
}): number {
  const code = String(result.failureCode ?? result.error ?? "").trim();
  switch (code) {
    case "past_scenario_missing":
    case "NO_BUILD":
    case "SCENARIO_NOT_FOUND":
    case "ARTIFACT_MISSING":
      return 404;
    case "HOUSE_NOT_FOUND":
      return 403;
    case "COMPARE_TRUTH_INCOMPLETE":
      return 409;
    default:
      return 500;
  }
}

function buildAdminGapfillManualRecalcFailure(args: {
  error?: string | null;
  missingItems?: string[] | null;
  fallbackMessage: string;
  correlationId?: string | null;
}) {
  const detail = Array.isArray(args.missingItems) && args.missingItems.length > 0
    ? args.missingItems.join("; ")
    : args.fallbackMessage;
  const classification = classifySimulationFailure({
    code: args.error,
    error: args.error,
    message: detail,
  });
  const normalizedDetail = detail.toLowerCase();
  const reasonCode =
    normalizedDetail.includes("p2024") ||
    normalizedDetail.includes("connection pool") ||
    normalizedDetail.includes("timed out fetching a new connection") ||
    normalizedDetail.includes("connection limit: 1")
      ? "PRISMA_POOL_EXHAUSTION"
      : classification.reasonCode;
  return {
    status: String(args.error ?? "").trim() === "recalc_timeout" ? 504 : 500,
    body: {
      ...attachFailureContract({
        ok: false,
        error: args.error ?? "canonical_recalc_failed",
        message: classification.userFacingExplanation,
      }),
      detail,
      failureCode: reasonCode,
      failureMessage: detail,
      reasonCode,
      correlationId: args.correlationId ?? undefined,
    },
  };
}

async function buildGapfillManualConstraintPayload(args: {
  labOwnerUserId: string;
  testHomeHouseId: string;
  sourceHouseUserId: string;
  sourceHouseId: string;
  sourceEsiid: string | null;
  travelRangesForRecalc: DateRange[];
  usageInputMode: TestHomeUsageInputMode;
}): Promise<ManualUsagePayload | null> {
  const [sourceManualRec, testHomeManualRec, sourceUsageDataset] = await Promise.all([
    getManualUsageInputForUserHouse({
      userId: args.sourceHouseUserId,
      houseId: args.sourceHouseId,
    }),
    getManualUsageInputForUserHouse({
      userId: args.labOwnerUserId,
      houseId: args.testHomeHouseId,
    }),
    getActualUsageDatasetForHouse(args.sourceHouseId, args.sourceEsiid ?? null, {
      skipFullYearIntervalFetch: true,
    }).catch(() => ({ dataset: null })),
  ]);
  const seedSet = buildManualUsageStageOneResolvedSeeds({
    sourcePayload: sourceManualRec.payload,
    actualEndDate:
      String(sourceUsageDataset?.dataset?.summary?.end ?? "").slice(0, 10) || null,
    travelRanges: args.travelRangesForRecalc,
    dailyRows: sourceUsageDataset?.dataset?.daily ?? [],
  });
  return (
    resolveManualUsageStageOnePayloadForMode({
      mode: args.usageInputMode === "ANNUAL_FROM_SOURCE_INTERVALS" ? "ANNUAL" : "MONTHLY",
      testHomePayload: testHomeManualRec.payload,
      seedSet,
    }).payload ?? null
  );
}

function hasAdminSessionCookie(request: NextRequest): boolean {
  const raw = request.cookies.get("intelliwatt_admin")?.value ?? "";
  const email = normalizeEmailSafe(raw);
  if (!email) return false;
  return ADMIN_EMAILS.includes(email);
}

async function waitForSourceHomePastSimJob(args: { userId: string; jobId: string }) {
  while (true) {
    const job = await getPastSimRecalcJobForUser({
      jobId: args.jobId,
      userId: args.userId,
    });
    if (!job.ok) {
      return { ok: false as const, error: "job_not_found", message: "No Past Sim recalc job found for this source house." };
    }
    if (job.status === "succeeded") {
      return { ok: true as const };
    }
    if (job.status === "failed") {
      return {
        ok: false as const,
        error: "recalc_failed",
        message: String(job.failureMessage ?? "Source-home Past Sim recalc failed."),
      };
    }
    await new Promise((resolve) => setTimeout(resolve, SOURCE_HOME_PAST_SIM_POLL_MS));
  }
}

async function buildGapfillManualUsageReadbackResponse(args: {
  action: string;
  email: string;
  timezone: string;
  labOwnerUserId: string;
  sourceHouse: {
    id: string;
    userId?: string | null;
    esiid?: string | null;
    addressLine1?: string | null;
    addressCity?: string | null;
    addressState?: string | null;
  };
  sourceUserId: string;
  testHomeHouse: { id: string };
  scenarioId: string;
  correlationId?: string | null;
  testUsageInputMode: TestHomeUsageInputMode;
  weatherKind: string;
  gapfillWeatherLogic: { weatherLogicMode: string; owner: string };
  canonicalWindow: { startDate: string; endDate: string };
  canonicalWindowHelper: string;
  usage365?: Usage365Payload;
  homeProfile: unknown;
  applianceProfile: unknown;
  travelRangesFromDb: DateRange[];
  sourceTravelRangesFromDb: DateRange[];
  travelRangesForRecalc: DateRange[];
  usingSourceTravelRangesForRecalc: boolean;
  testSelectionMode: ValidationDaySelectionMode;
  validationPolicyOwner: ValidationPolicyOwner;
  userDefaultValidationSelectionMode: string;
  selectionDiagnostics: Record<string, unknown> | null;
}) {
  const [buildRow, artifactRow, manualUsagePayload] = await Promise.all([
    (prisma as any).usageSimulatorBuild
      .findUnique({
        where: {
          userId_houseId_scenarioKey: {
            userId: args.labOwnerUserId,
            houseId: args.testHomeHouse.id,
            scenarioKey: String(args.scenarioId),
          },
        },
        select: { id: true, lastBuiltAt: true, buildInputsHash: true, buildInputs: true },
      })
      .catch(() => null),
    (usagePrisma as any).pastSimulatedDatasetCache
      .findFirst({
        where: { houseId: args.testHomeHouse.id, scenarioId: String(args.scenarioId) },
        orderBy: { updatedAt: "desc" },
        select: { id: true, updatedAt: true, inputHash: true, engineVersion: true },
      })
      .catch(() => null),
    buildGapfillManualConstraintPayload({
      labOwnerUserId: args.labOwnerUserId,
      testHomeHouseId: args.testHomeHouse.id,
      sourceHouseUserId: args.sourceUserId,
      sourceHouseId: args.sourceHouse.id,
      sourceEsiid: args.sourceHouse.esiid ? String(args.sourceHouse.esiid) : null,
      travelRangesForRecalc: args.travelRangesForRecalc,
      usageInputMode: args.testUsageInputMode,
    }),
  ]);

  const readResultWithManualPayload = await buildManualUsagePastSimReadResult({
    userId: args.labOwnerUserId,
    houseId: args.testHomeHouse.id,
    scenarioId: String(args.scenarioId),
    readMode: "artifact_only",
    callerType: "gapfill_test",
    correlationId: args.correlationId ?? null,
    usageInputMode: args.testUsageInputMode,
    validationPolicyOwner: args.validationPolicyOwner,
    weatherLogicMode: args.gapfillWeatherLogic.weatherLogicMode,
    artifactId: artifactRow?.id ?? null,
    artifactInputHash: artifactRow?.inputHash ?? null,
    artifactEngineVersion: artifactRow?.engineVersion ?? null,
    artifactPersistenceOutcome: "persisted_artifact_exact_read",
    manualUsagePayload,
  });
  if (!readResultWithManualPayload.ok) {
    return NextResponse.json(
      attachFailureContract({
        ...readResultWithManualPayload,
        action: args.action,
      }),
      { status: statusForGapfillManualReadResultFailure(readResultWithManualPayload) }
    );
  }

  const { effectiveValidationSelectionMode, fromBuildInputs: effectiveValidationFromBuild } =
    readEffectiveValidationFromBuildInputs(
      buildRow?.buildInputs as Record<string, unknown> | undefined,
      args.testSelectionMode
    );

  return NextResponse.json({
    ok: true,
    action: args.action,
    mode: "canonical_test_home_lab",
    correlationId:
      args.correlationId ??
      ((readResultWithManualPayload.sharedDiagnostics as any)?.identityContext?.correlationId as string | null) ??
      null,
    email: args.email,
    sourceUserId: args.sourceUserId,
    scenarioId: String(args.scenarioId),
    sourceHouseId: args.sourceHouse.id,
    testHomeId: args.testHomeHouse.id,
    treatmentMode: args.testUsageInputMode,
    supportedAdminTreatmentModes: [...ADMIN_LAB_TREATMENT_MODES],
    usageInputMode: args.testUsageInputMode,
    simulatorMode:
      typeof (buildRow?.buildInputs as Record<string, unknown> | undefined)?.mode === "string"
        ? String((buildRow?.buildInputs as Record<string, unknown>).mode)
        : "MANUAL_TOTALS",
    sourceHouse: {
      id: args.sourceHouse.id,
      label:
        [args.sourceHouse.addressLine1, args.sourceHouse.addressCity, args.sourceHouse.addressState]
          .filter(Boolean)
          .join(", ") || args.sourceHouse.id,
    },
    testHome: {
      id: args.testHomeHouse.id,
      label: "Test Home",
      canonicalIdentity: GAPFILL_LAB_TEST_HOME_LABEL,
    },
    timezone: args.timezone,
    homeProfile: args.homeProfile,
    applianceProfile: args.applianceProfile,
    weatherKind: args.weatherKind,
    weatherLogicMode: args.gapfillWeatherLogic.weatherLogicMode,
    weatherLogicOwner: args.gapfillWeatherLogic.owner,
    canonicalWindow: {
      startDate: args.canonicalWindow.startDate,
      endDate: args.canonicalWindow.endDate,
      helper: args.canonicalWindowHelper,
    },
    travelRangesFromDb: args.travelRangesForRecalc,
    testHomeTravelRangesFromDb: args.travelRangesFromDb,
    sourceTravelRangesFromDb: args.sourceTravelRangesFromDb,
    effectiveTravelRangesForRecalc: args.travelRangesForRecalc,
    effectiveTravelRangesSource: args.usingSourceTravelRangesForRecalc ? "source_house_copy_policy" : "test_home_saved",
    testRangesUsed: [],
    testSelectionMode: args.testSelectionMode,
    adminValidationMode: args.testSelectionMode,
    validationPolicyOwner: args.validationPolicyOwner,
    userDefaultValidationSelectionMode: args.userDefaultValidationSelectionMode,
    effectiveValidationSelectionMode,
    effectiveValidationSelectionModeSource: effectiveValidationFromBuild ? "usage_simulator_build" : "request_fallback",
    testDaysRequested: null,
    testDaysSelected: Array.isArray((readResultWithManualPayload.dataset as any)?.meta?.validationOnlyDateKeysLocal)
      ? (readResultWithManualPayload.dataset as any).meta.validationOnlyDateKeysLocal.length
      : 0,
    seedUsed: null,
    selectionDiagnostics: args.selectionDiagnostics,
    validationSelectionDiagnostics: args.selectionDiagnostics,
    usage365: args.usage365,
    baselineDatasetProjection: readResultWithManualPayload.dataset,
    compareProjection: readResultWithManualPayload.compareProjection,
    buildId: buildRow?.id ?? null,
    buildLastBuiltAt: buildRow?.lastBuiltAt ? (buildRow.lastBuiltAt as Date).toISOString() : null,
    buildInputsHash: buildRow?.buildInputsHash ?? null,
    artifactId: artifactRow?.id ?? null,
    artifactInputHash: artifactRow?.inputHash ?? null,
    artifactCacheUpdatedAt: artifactRow?.updatedAt instanceof Date ? artifactRow.updatedAt.toISOString() : null,
    artifactEngineVersion: artifactRow?.engineVersion ?? null,
    sharedDiagnostics: readResultWithManualPayload.sharedDiagnostics,
    compareProjectionSummary: {
      attached: Array.isArray(readResultWithManualPayload.compareProjection?.rows) &&
        readResultWithManualPayload.compareProjection.rows.length > 0,
      rowCount: Array.isArray(readResultWithManualPayload.compareProjection?.rows)
        ? readResultWithManualPayload.compareProjection.rows.length
        : 0,
      metrics: readResultWithManualPayload.compareProjection?.metrics ?? {},
    },
    baselineProjectionSummary: {
      applied: Boolean((readResultWithManualPayload.dataset as any)?.meta?.validationProjectionApplied),
      expected: Array.isArray((readResultWithManualPayload.dataset as any)?.meta?.validationOnlyDateKeysLocal),
      correct: true,
      validationOnlyDateKeyCount: Array.isArray((readResultWithManualPayload.dataset as any)?.meta?.validationOnlyDateKeysLocal)
        ? (readResultWithManualPayload.dataset as any).meta.validationOnlyDateKeysLocal.length
        : 0,
    },
  });
}

function normalizeLabHomeProfileInput(input: any): any {
  const src = (input && typeof input === "object") ? input : {};
  const occupants = (src.occupants && typeof src.occupants === "object") ? src.occupants : {};
  const pool = (src.pool && typeof src.pool === "object") ? src.pool : {};
  return {
    ...src,
    insulationType: src.insulationType ?? src.insulation ?? src.insulation_type ?? null,
    windowType: src.windowType ?? src.windows ?? src.window_type ?? null,
    summerTemp: src.summerTemp ?? src.thermostatSummerF ?? src.summer_temp ?? null,
    winterTemp: src.winterTemp ?? src.thermostatWinterF ?? src.winter_temp ?? null,
    occupantsWork: src.occupantsWork ?? occupants.work ?? 0,
    occupantsSchool: src.occupantsSchool ?? occupants.school ?? 0,
    occupantsHomeAllDay: src.occupantsHomeAllDay ?? occupants.homeAllDay ?? 0,
    hasPool: src.hasPool ?? pool.hasPool ?? false,
    poolPumpType: src.poolPumpType ?? pool.pumpType ?? null,
    poolPumpHp: src.poolPumpHp ?? pool.pumpHp ?? null,
    poolSummerRunHoursPerDay: src.poolSummerRunHoursPerDay ?? pool.summerRunHoursPerDay ?? null,
    poolWinterRunHoursPerDay: src.poolWinterRunHoursPerDay ?? pool.winterRunHoursPerDay ?? null,
    hasPoolHeater: src.hasPoolHeater ?? pool.heaterInstalled ?? false,
    poolHeaterType: src.poolHeaterType ?? pool.poolHeaterType ?? null,
  };
}

async function resolveLabOwnerUserId(request: NextRequest): Promise<string | null> {
  const cookieEmail = normalizeEmailSafe(request.cookies.get("intelliwatt_admin")?.value ?? "");
  if (cookieEmail) {
    const cookieUser = await prisma.user
      .findFirst({
        where: { email: { equals: cookieEmail, mode: "insensitive" } },
        select: { id: true },
      })
      .catch(() => null);
    if (cookieUser?.id) return String(cookieUser.id);
  }
  for (const adminEmail of ADMIN_EMAILS) {
    const fallback = await prisma.user
      .findFirst({
        where: { email: { equals: adminEmail, mode: "insensitive" } },
        select: { id: true },
      })
      .catch(() => null);
    if (fallback?.id) return String(fallback.id);
  }
  return null;
}

async function replaceTravelRangesForHousePastScenario(
  userId: string,
  houseId: string,
  rangesInput: Array<{ startDate: string; endDate: string }>
): Promise<void> {
  const ranges = rangesInput
    .map((r) => ({
      startDate: String(r?.startDate ?? "").slice(0, 10),
      endDate: String(r?.endDate ?? "").slice(0, 10),
    }))
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.startDate) && /^\d{4}-\d{2}-\d{2}$/.test(r.endDate));

  await (prisma as any).$transaction(async (tx: any) => {
    let pastScenario = await tx.usageSimulatorScenario.findFirst({
      where: {
        userId,
        houseId,
        name: "Past (Corrected)",
        archivedAt: null,
      },
      select: { id: true },
    });
    if (!pastScenario?.id) {
      pastScenario = await tx.usageSimulatorScenario.create({
        data: {
          userId,
          houseId,
          name: "Past (Corrected)",
        },
        select: { id: true },
      });
    }
    await tx.usageSimulatorScenarioEvent.deleteMany({
      where: {
        scenarioId: String(pastScenario.id),
        kind: "TRAVEL_RANGE",
      },
    });
    if (ranges.length > 0) {
      await tx.usageSimulatorScenarioEvent.createMany({
        data: ranges.map((r) => ({
          scenarioId: String(pastScenario.id),
          effectiveMonth: r.startDate.slice(0, 7),
          kind: "TRAVEL_RANGE",
          payloadJson: { startDate: r.startDate, endDate: r.endDate },
        })),
      });
    }
  });
}

function gateGapfillLabAdmin(req: NextRequest): NextResponse | null {
  if (!hasAdminSessionCookie(req)) {
    const gate = requireAdmin(req);
    if (!gate.ok) {
      const raw = gate.body as { error?: string };
      const errMsg = typeof raw?.error === "string" ? raw.error : "Admin gate denied";
      const errKey =
        errMsg === "Unauthorized"
          ? "admin_unauthorized"
          : errMsg === "ADMIN_TOKEN not configured"
            ? "admin_token_not_configured"
            : "admin_gate_denied";
      return NextResponse.json(
        attachFailureContract({
          ok: false,
          error: errKey,
          message: errMsg,
        }),
        { status: gate.status }
      );
    }
  }
  return null;
}

/**
 * GET `?diagnostics=enqueue` — safe enqueue eligibility (admin only). Use when debugging why compare stays on Vercel.
 */
export async function GET(req: NextRequest) {
  const denied = gateGapfillLabAdmin(req);
  if (denied) return denied;
  const url = new URL(req.url);
  if (url.searchParams.get("diagnostics") !== "enqueue") {
    return NextResponse.json(
      attachFailureContract({
        ok: false,
        error: "invalid_query",
        message: "Use ?diagnostics=enqueue",
      }),
      { status: 400 }
    );
  }
  return NextResponse.json({ ok: true, enqueueEligibility: getGapfillCompareEnqueueDiagnostics() });
}

export async function POST(req: NextRequest) {
  const adminDenied = gateGapfillLabAdmin(req);
  if (adminDenied) return adminDenied;

  let body: {
    email?: string;
    timezone?: string;
    testRanges?: Array<{ startDate: string; endDate: string }>;
    rangesToMask?: Array<{ startDate: string; endDate: string }>;
    testDays?: number;
    seed?: string;
    testMode?: string;
    stratifyByMonth?: boolean;
    stratifyByWeekend?: boolean;
    minDayCoveragePct?: number;
    trainMaxDays?: number;
    trainGapDays?: number;
    houseId?: string;
    sourceHouseId?: string;
    /** Weather source: ACTUAL_LAST_YEAR (last year temps), NORMAL_AVG (average temps), or open_meteo (live API). */
    weatherKind?: "ACTUAL_LAST_YEAR" | "NORMAL_AVG" | "open_meteo";
    /** Optional benchmark payload from a prior run for regression comparison (copy from report). */
    benchmark?: unknown;
    /** Include usage365 chart payload (expensive); compare path can disable for performance. */
    includeUsage365?: boolean;
    /** Optional: run user-pipeline parity read alongside compare core (extra read + payload). */
    includeUserPipelineParity?: boolean;
    /** Explicit write action: regenerate + resave canonical shared Past artifact before compare. */
    rebuildArtifact?: boolean;
    /** Rebuild artifact only, then return immediately (no compare in same request). */
    rebuildOnly?: boolean;
    /** Include heavy compare diagnostics payload; defaults false. */
    includeDiagnostics?: boolean;
    /** Include full report text payload; defaults false. */
    includeFullReportText?: boolean;
    /** Request compact heavy-only response shaping for merge onto an existing core result. */
    responseMode?: "heavy_only_compact";
    /** Optional staged reader action over persisted compare-run snapshot. */
    action?: unknown;
    /** Optional exact artifact identity forwarded from same-run artifact ensure. */
    requestedInputHash?: unknown;
    artifactScenarioId?: unknown;
    requireExactArtifactMatch?: unknown;
    artifactIdentitySource?: unknown;
    compareRunId?: unknown;
    homeProfile?: unknown;
    applianceProfile?: unknown;
    travelRanges?: Array<{ startDate: string; endDate: string }>;
    adminLabValidationSelectionMode?: unknown;
    userDefaultValidationSelectionMode?: unknown;
    /** Section 24 admin-only simulation treatment (canonical lab recalc). */
    adminLabTreatmentMode?: unknown;
    testUsageInputMode?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(attachFailureContract({ ok: false, error: "invalid_json" }), { status: 400 });
  }

  let compareRunId: string | null = null;
  let compareRunStatus: "started" | "running" | "succeeded" | "failed" | "queued" | null = null;
  let compareRunSnapshotReady = false;
  let compareRunTerminalState = false;
  let compareRequestTruthForLifecycle: Record<string, unknown> | null = null;
  let artifactRequestTruthForLifecycle: Record<string, unknown> | null = null;
  let compareCoreTimingForLifecycle: ReturnType<typeof startCompareCoreTiming> | null = null;

  try {
  const email = normalizeEmailSafe(body?.email ?? "");
  if (!email) {
    return NextResponse.json(attachFailureContract({ ok: false, error: "email_required" }), { status: 400 });
  }

  const timezone = String(body?.timezone ?? "America/Chicago").trim() || "America/Chicago";
  if (!isValidIanaTimezone(timezone)) {
    return NextResponse.json(
      attachFailureContract({
        ok: false,
        error: "invalid_timezone",
        message: "Timezone must be a valid IANA timezone.",
      }),
      { status: 400 }
    );
  }
  const includeUsage365 = body?.includeUsage365 === true;
  const includeDiagnostics = body?.includeDiagnostics === true;
  const includeUserPipelineParity = body?.includeUserPipelineParity === true;
  const includeFullReportText = body?.includeFullReportText === true;
  const rawAction = String(body?.action ?? "").trim();
  const action = toSnapshotReaderAction(rawAction);
  const heavyOnlyCompactResponse =
    body?.responseMode === "heavy_only_compact" && includeDiagnostics && includeFullReportText;
  const requestedArtifactInputHash =
    typeof body?.requestedInputHash === "string" && body.requestedInputHash.trim()
      ? body.requestedInputHash.trim()
      : null;
  const requestedArtifactScenarioId =
    typeof body?.artifactScenarioId === "string" && body.artifactScenarioId.trim()
      ? body.artifactScenarioId.trim()
      : null;
  const requireExactArtifactMatch = body?.requireExactArtifactMatch === true;
  const artifactIdentitySource =
    typeof body?.artifactIdentitySource === "string" && body.artifactIdentitySource.trim()
      ? body.artifactIdentitySource.trim()
      : null;
  const requestedCompareRunId =
    typeof body?.compareRunId === "string" && body.compareRunId.trim()
      ? body.compareRunId.trim()
      : null;
  const testDaysRequested = body?.testDays != null && Number(body.testDays) >= 1 ? Math.min(365, Math.floor(Number(body.testDays))) : null;
  const seed = String(body?.seed ?? "").trim() || null;
  const VALID_TEST_MODES = ["fixed", "random", "winter", "summer", "shoulder", "extreme_weather"] as const;
  type TestMode = (typeof VALID_TEST_MODES)[number];
  const rawTestMode = String(body?.testMode ?? "fixed").trim().toLowerCase();
  const testMode: TestMode = VALID_TEST_MODES.includes(rawTestMode as TestMode) ? (rawTestMode as TestMode) : "fixed";
  const stratifyByMonth = body?.stratifyByMonth !== false;
  const stratifyByWeekend = body?.stratifyByWeekend !== false;
  const minDayCoveragePct = Math.max(0.01, Math.min(1, Number(body?.minDayCoveragePct) || 0.95));
  const trainMaxDays = Math.max(7, Math.min(365, Math.floor(Number(body?.trainMaxDays) || 365)));
  const trainGapDays = Math.max(0, Math.min(30, Math.floor(Number(body?.trainGapDays) || 2)));

  const VALID_WEATHER_KINDS = [
    "ACTUAL_LAST_YEAR",
    "NORMAL_AVG",
    "open_meteo",
    "LAST_YEAR_ACTUAL_WEATHER",
    "LONG_TERM_AVERAGE_WEATHER",
  ] as const;
  type WeatherKindParam = (typeof VALID_WEATHER_KINDS)[number];
  const rawWeatherKind = String(body?.weatherKind ?? "LAST_YEAR_ACTUAL_WEATHER").trim();
  const normalizedWeatherKind: WeatherKindParam = VALID_WEATHER_KINDS.includes(rawWeatherKind as WeatherKindParam)
    ? (rawWeatherKind as WeatherKindParam)
    : "LAST_YEAR_ACTUAL_WEATHER";
  const gapfillWeatherLogic = resolveGapfillWeatherLogicSetting(normalizedWeatherKind);
  const weatherKind: WeatherKindParam = normalizedWeatherKind;

  const rawAdminLabTreatment = typeof body?.adminLabTreatmentMode === "string" ? body.adminLabTreatmentMode.trim() : "";
  const rawTestUsageInputMode = typeof body?.testUsageInputMode === "string" ? body.testUsageInputMode.trim() : "";
  const testUsageInputMode = resolveTestHomeUsageInputMode(
    rawTestUsageInputMode || rawAdminLabTreatment || GAPFILL_CANONICAL_LAB_TREATMENT_MODE
  );
  const {
    simulatorMode: testHomeSimulatorMode,
    adminLabTreatmentMode: adminLabTreatmentModeForRecalc,
  } = resolveTestHomeUsageModeRecalcConfig(testUsageInputMode);
  if (
    rawAdminLabTreatment !== "" &&
    rawTestUsageInputMode === "" &&
    !isAdminLabTreatmentMode(rawAdminLabTreatment)
  ) {
    return NextResponse.json(
      attachFailureContract({
        ok: false,
        error: "invalid_admin_lab_treatment_mode",
        message: "adminLabTreatmentMode must be one of the Section 24 admin treatment keys.",
        supportedModes: [...ADMIN_LAB_TREATMENT_MODES],
      }),
      { status: 400 }
    );
  }

  const rawTestRanges = body?.testRanges ?? body?.rangesToMask ?? [];
  let testRanges = Array.isArray(rawTestRanges)
    ? rawTestRanges
        .map((r: any) => ({
          startDate: String(r?.startDate ?? "").slice(0, 10),
          endDate: String(r?.endDate ?? "").slice(0, 10),
        }))
        .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.startDate) && /^\d{4}-\d{2}-\d{2}$/.test(r.endDate))
    : [];

  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true, email: true },
  });
  if (!user) {
    return NextResponse.json(
      attachFailureContract({
        ok: false,
        error: "user_not_found",
        message: "No user with that email.",
      }),
      { status: 404 }
    );
  }

  const houses = await (prisma as any).houseAddress.findMany({
    where: { userId: user.id, archivedAt: null },
    orderBy: { updatedAt: "desc" },
    select: { id: true, esiid: true, addressLine1: true, addressCity: true, addressState: true, addressZip5: true, createdAt: true },
  });

  if (!houses?.length) {
    return NextResponse.json(
      attachFailureContract({ ok: false, error: "no_houses", message: "User has no houses." }),
      { status: 404 }
    );
  }

  const houseIdParam = typeof body?.houseId === "string" ? body.houseId.trim() : "";
  let house = houseIdParam
    ? houses.find((h: any) => h.id === houseIdParam)
    : houses[0];
  if (!house) {
    return NextResponse.json(
      attachFailureContract({
        ok: false,
        error: "house_not_found",
        message: "House not found or not owned by user.",
      }),
      { status: 404 }
    );
  }

  const isCanonicalLabAction =
    rawAction === "lookup_source_houses" ||
    rawAction === "get_validation_selection_settings" ||
    rawAction === "set_user_default_validation_selection_mode" ||
    rawAction === "replace_test_home_from_source" ||
    rawAction === "save_test_home_inputs" ||
    rawAction === "run_test_home_canonical_recalc" ||
    rawAction === "read_test_home_canonical_result";
  const labOwnerUserId = isCanonicalLabAction ? await resolveLabOwnerUserId(req) : null;
  const sourceHouseIdParam = typeof body?.sourceHouseId === "string" && body.sourceHouseId.trim()
    ? body.sourceHouseId.trim()
    : house.id;
  const explicitAdminLabValidationMode =
    normalizeValidationSelectionMode(body?.adminLabValidationSelectionMode);
  const requestedUserDefaultValidationMode =
    normalizeValidationSelectionMode(body?.userDefaultValidationSelectionMode);

  if (rawAction === "get_validation_selection_settings") {
    const userDefaultValidationSelectionMode = await getUserDefaultValidationSelectionMode();
    return NextResponse.json({
      ok: true,
      action: "get_validation_selection_settings",
      userDefaultValidationSelectionMode,
      adminLabDefaultValidationSelectionMode: getAdminLabDefaultValidationSelectionMode(),
      supportedModes: VALIDATION_SELECTION_MODES,
    });
  }

  if (rawAction === "set_user_default_validation_selection_mode") {
    if (!requestedUserDefaultValidationMode) {
      return NextResponse.json(
        attachFailureContract({
          ok: false,
          error: "invalid_validation_selection_mode",
          message: "Provide a valid userDefaultValidationSelectionMode.",
          supportedModes: VALIDATION_SELECTION_MODES,
        }),
        { status: 400 }
      );
    }
    const write = await setUserDefaultValidationSelectionMode(requestedUserDefaultValidationMode);
    if (!write.ok) {
      return NextResponse.json(
        attachFailureContract({
          ok: false,
          error: String(write.error ?? "usage_simulator_settings_write_failed"),
          message: "Could not save system-wide user-facing validation-day mode.",
        }),
        { status: 500 }
      );
    }
    return NextResponse.json({
      ok: true,
      action: "set_user_default_validation_selection_mode",
      userDefaultValidationSelectionMode: write.mode,
      message: "System-wide user-facing validation-day mode saved (future recalcs only).",
    });
  }

  if (rawAction === "lookup_source_houses") {
    const link = labOwnerUserId ? await getLabTestHomeLink(labOwnerUserId) : null;
    const testHomeHouseId = String(link?.testHomeHouseId ?? "").trim();
    const sourceHouseOptions = buildCanonicalGapfillSourceHouseOptions(houses, testHomeHouseId);
    const requestedSourceHouseId = String(sourceHouseIdParam ?? "").trim();
    const linkedSourceHouseId = String(
      resolveCanonicalGapfillSourceHouse(houses, String(link?.sourceHouseId ?? "").trim(), testHomeHouseId)?.id ??
        link?.sourceHouseId ??
        ""
    ).trim();
    const selectedSourceHouseId =
      (requestedSourceHouseId &&
      requestedSourceHouseId !== testHomeHouseId &&
      resolveCanonicalGapfillSourceHouse(houses, requestedSourceHouseId, testHomeHouseId)?.id
        ? String(resolveCanonicalGapfillSourceHouse(houses, requestedSourceHouseId, testHomeHouseId)?.id ?? "")
        : linkedSourceHouseId &&
            linkedSourceHouseId !== testHomeHouseId &&
            sourceHouseOptions.some((h: any) => String(h.id) === linkedSourceHouseId)
          ? linkedSourceHouseId
          : sourceHouseOptions[0]?.id
            ? String(sourceHouseOptions[0].id)
            : "");
    const testHomeTravelRanges =
      labOwnerUserId && link?.testHomeHouseId
        ? await getTravelRangesFromDb(labOwnerUserId, String(link.testHomeHouseId))
        : [];
    const sourceTravelRanges =
      selectedSourceHouseId
        ? await getTravelRangesFromDb(user.id, selectedSourceHouseId)
        : [];
    const userDefaultValidationSelectionMode = await getUserDefaultValidationSelectionMode();
    const labCorrelationId = createSimCorrelationId();
    logSimPipelineEvent("admin_lab_source_house_selected", {
      correlationId: labCorrelationId,
      source: "gapfill_lab",
      action: "lookup_source_houses",
      userId: user.id,
      sourceHouseId: selectedSourceHouseId,
      testHomeId: testHomeHouseId || undefined,
    });
    return NextResponse.json({
      ok: true,
      action: "lookup_source_houses",
      sourceUser: { id: user.id, email: user.email },
      sourceHouses: sourceHouseOptions.map((h: any) => ({
        id: h.id,
        esiid: h.esiid ? String(h.esiid) : null,
        label: [h.addressLine1, h.addressCity, h.addressState].filter(Boolean).join(", ") || h.id,
      })),
      sourceHouseId: selectedSourceHouseId,
      testHomeId: testHomeHouseId || null,
      selectedSourceHouseId,
      testHomeLink: link,
      travelRangesFromDb: testHomeTravelRanges,
      testHomeTravelRangesFromDb: testHomeTravelRanges,
      sourceTravelRangesFromDb: sourceTravelRanges,
      travelRangesSource: "test_home",
      userDefaultValidationSelectionMode,
      adminLabDefaultValidationSelectionMode: getAdminLabDefaultValidationSelectionMode(),
      /** No UsageSimulatorBuild context until recalc; UI should not infer. */
      effectiveValidationSelectionMode: null,
      adminValidationMode: null,
      treatmentMode: null,
      supportedValidationSelectionModes: VALIDATION_SELECTION_MODES,
    });
  }

  if (rawAction === "replace_test_home_from_source") {
    if (!labOwnerUserId) {
      return NextResponse.json(attachFailureContract({ ok: false, error: "lab_owner_not_found" }), { status: 400 });
    }
    const link = await getLabTestHomeLink(labOwnerUserId);
    const testHomeHouseId = String(link?.testHomeHouseId ?? "").trim();
    const canonicalSelectedSourceHouse = resolveCanonicalGapfillSourceHouse(houses, sourceHouseIdParam, testHomeHouseId);
    const canonicalSourceHouseId = String(canonicalSelectedSourceHouse?.id ?? sourceHouseIdParam ?? "").trim();
    if (testHomeHouseId && canonicalSourceHouseId === testHomeHouseId) {
      return NextResponse.json(
        attachFailureContract({
          ok: false,
          error: "invalid_source_house",
          message: "Select a real source home. The canonical test home cannot be used as source.",
        }),
        { status: 400 }
      );
    }
    const selectedSourceHouse = canonicalSelectedSourceHouse;
    if (!selectedSourceHouse) {
      return NextResponse.json(attachFailureContract({ ok: false, error: "source_house_not_found" }), { status: 404 });
    }
    const replaced = await replaceGlobalLabTestHomeFromSource({
      ownerUserId: labOwnerUserId,
      sourceUserId: user.id,
      sourceHouseId: canonicalSourceHouseId,
    });
    if (!replaced.ok) {
      return NextResponse.json(
        attachFailureContract({
          ok: false,
          error: String(replaced.error ?? "replace_test_home_failed"),
          message:
            replaced.message ??
            "Test-home replace failed before post-load snapshot.",
        }),
        { status: 500 }
      );
    }
    try {
      const testHome = await (prisma as any).houseAddress.findUnique({
        where: { id: replaced.testHomeHouseId },
        select: { id: true, addressLine1: true, addressCity: true, addressState: true, esiid: true, label: true },
      });
      const testHomeProfiles = await loadDisplayProfilesForHouse({
        userId: labOwnerUserId,
        houseId: String(replaced.testHomeHouseId),
      });
      let testHomeTravelRanges = await getTravelRangesFromDb(labOwnerUserId, String(replaced.testHomeHouseId));
      const sourceTravelRanges = await getTravelRangesFromDb(user.id, canonicalSourceHouseId);
      if (testHomeTravelRanges.length === 0 && sourceTravelRanges.length > 0) {
        await replaceTravelRangesForHousePastScenario(
          labOwnerUserId,
          String(replaced.testHomeHouseId),
          sourceTravelRanges
        );
        testHomeTravelRanges = await getTravelRangesFromDb(labOwnerUserId, String(replaced.testHomeHouseId));
      }
      const effectiveTravelRanges =
        testHomeTravelRanges.length > 0
          ? testHomeTravelRanges
          : sourceTravelRanges;
      const refreshedLink = await getLabTestHomeLink(labOwnerUserId);
      const labCorrelationId = createSimCorrelationId();
      logSimPipelineEvent("admin_lab_test_home_replaced", {
        correlationId: labCorrelationId,
        source: "gapfill_lab",
        action: "replace_test_home_from_source",
        userId: labOwnerUserId,
        sourceUserId: user.id,
        sourceHouseId: canonicalSourceHouseId,
        testHomeId: String(replaced.testHomeHouseId ?? ""),
      });
      return NextResponse.json({
        ok: true,
        action: "replace_test_home_from_source",
        sourceUser: { id: user.id, email: user.email },
        sourceHouseId: selectedSourceHouse.id,
        testHomeId: testHome?.id ?? String(replaced.testHomeHouseId ?? ""),
        sourceHouse: {
          id: selectedSourceHouse.id,
          esiid: selectedSourceHouse.esiid ? String(selectedSourceHouse.esiid) : null,
          label: [selectedSourceHouse.addressLine1, selectedSourceHouse.addressCity, selectedSourceHouse.addressState]
            .filter(Boolean)
            .join(", ") || selectedSourceHouse.id,
        },
        testHome: testHome
          ? {
              id: testHome.id,
              esiid: testHome.esiid ? String(testHome.esiid) : null,
              label: "Test Home",
              identityLabel: testHome.label ?? null,
              canonicalIdentity: GAPFILL_LAB_TEST_HOME_LABEL,
            }
          : null,
        homeProfile: testHomeProfiles.homeProfile,
        applianceProfile: testHomeProfiles.applianceProfile,
        travelRangesFromDb: effectiveTravelRanges,
        testHomeTravelRangesFromDb: testHomeTravelRanges,
        sourceTravelRangesFromDb: sourceTravelRanges,
        effectiveTravelRangesForRecalc: effectiveTravelRanges,
        effectiveTravelRangesSource:
          testHomeTravelRanges.length > 0 ? "test_home_saved" : "source_house_fallback",
        travelRangesSource:
          testHomeTravelRanges.length > 0 ? "test_home" : "source_house_fallback",
        testHomeLink: refreshedLink,
        userDefaultValidationSelectionMode: await getUserDefaultValidationSelectionMode(),
        adminLabDefaultValidationSelectionMode: getAdminLabDefaultValidationSelectionMode(),
        effectiveValidationSelectionMode: null,
        adminValidationMode: null,
        treatmentMode: null,
      });
    } catch (postLoadError: unknown) {
      return NextResponse.json(
        attachFailureContract({
          ok: false,
          error: "replace_test_home_postload_failed",
          message:
            postLoadError instanceof Error
              ? postLoadError.message
              : "Test-home replacement succeeded but post-load snapshot failed.",
          sourceHouseId: canonicalSourceHouseId,
          testHomeHouseId: replaced.testHomeHouseId ?? null,
        }),
        { status: 500 }
      );
    }
  }

  if (rawAction === "save_test_home_inputs") {
    if (!labOwnerUserId) {
      return NextResponse.json(attachFailureContract({ ok: false, error: "lab_owner_not_found" }), { status: 400 });
    }
    const link = await getLabTestHomeLink(labOwnerUserId);
    if (!link?.testHomeHouseId) {
      return NextResponse.json(
        attachFailureContract({
          ok: false,
          error: "test_home_not_ready",
          message: "Load/replace test home first.",
        }),
        { status: 409 }
      );
    }
    if (link.status !== "ready") {
      return NextResponse.json(
        attachFailureContract({
          ok: false,
          error: "test_home_replace_incomplete",
          message: "Test home replacement is still in progress.",
          testHomeLink: link,
        }),
        { status: 409 }
      );
    }

    if (body?.homeProfile != null) {
      const homeValidated = validateHomeProfile(normalizeLabHomeProfileInput(body.homeProfile), { requirePastBaselineFields: true });
      if (!homeValidated.ok) {
        return NextResponse.json(
          attachFailureContract({
            ok: false,
            error: "invalid_home_profile",
            detail: homeValidated.error,
          }),
          { status: 400 }
        );
      }
      await (homeDetailsPrisma as any).homeProfileSimulated.upsert({
        where: { userId_houseId: { userId: labOwnerUserId, houseId: link.testHomeHouseId } },
        create: { userId: labOwnerUserId, houseId: link.testHomeHouseId, ...homeValidated.value },
        update: { ...homeValidated.value },
      });
    }
    if (body?.applianceProfile != null) {
      const normalized = normalizeStoredApplianceProfile(body.applianceProfile);
      const applianceValidated = validateApplianceProfile(normalized);
      if (!applianceValidated.ok) {
        return NextResponse.json(
          attachFailureContract({
            ok: false,
            error: "invalid_appliance_profile",
            detail: applianceValidated.error,
          }),
          { status: 400 }
        );
      }
      await (appliancesPrisma as any).applianceProfileSimulated.upsert({
        where: { userId_houseId: { userId: labOwnerUserId, houseId: link.testHomeHouseId } },
        create: {
          userId: labOwnerUserId,
          houseId: link.testHomeHouseId,
          appliancesJson: applianceValidated.value,
        },
        update: {
          appliancesJson: applianceValidated.value,
        },
      });
    }
    if (Array.isArray(body?.travelRanges)) {
      await replaceTravelRangesForHousePastScenario(
        labOwnerUserId,
        link.testHomeHouseId,
        body.travelRanges
      );
    }

    const refreshedProfiles = await loadDisplayProfilesForHouse({
      userId: labOwnerUserId,
      houseId: link.testHomeHouseId,
    });
    const refreshedTravel = await getTravelRangesFromDb(labOwnerUserId, link.testHomeHouseId);
    const labCorrelationId = createSimCorrelationId();
    logSimPipelineEvent("admin_lab_test_home_input_save", {
      correlationId: labCorrelationId,
      source: "gapfill_lab",
      action: "save_test_home_inputs",
      userId: labOwnerUserId,
      testHomeId: link.testHomeHouseId,
    });
    return NextResponse.json({
      ok: true,
      action: "save_test_home_inputs",
      testHomeHouseId: link.testHomeHouseId,
      sourceHouseId: link.sourceHouseId ?? null,
      testHomeId: link.testHomeHouseId,
      userDefaultValidationSelectionMode: await getUserDefaultValidationSelectionMode(),
      adminLabDefaultValidationSelectionMode: getAdminLabDefaultValidationSelectionMode(),
      effectiveValidationSelectionMode: null,
      adminValidationMode: null,
      treatmentMode: null,
      homeProfile: refreshedProfiles.homeProfile,
      applianceProfile: refreshedProfiles.applianceProfile,
      travelRangesFromDb: refreshedTravel,
      testHomeTravelRangesFromDb: refreshedTravel,
      sourceTravelRangesFromDb: link.sourceHouseId
        ? await getTravelRangesFromDb(user.id, String(link.sourceHouseId))
        : [],
      message: "Saved canonical test-home inputs. Recalc to refresh outputs.",
    });
  }

  if (rawAction === "run_test_home_canonical_recalc") {
    if (!labOwnerUserId) {
      return NextResponse.json(attachFailureContract({ ok: false, error: "lab_owner_not_found" }), { status: 400 });
    }
    const link = await getLabTestHomeLink(labOwnerUserId);
    if (!link?.testHomeHouseId || !link.sourceHouseId || !link.sourceUserId || link.status !== "ready") {
      return NextResponse.json(
        attachFailureContract({
          ok: false,
          error: "test_home_not_ready",
          message: "Load/replace test home first and wait for ready state.",
          testHomeLink: link ?? null,
        }),
        { status: 409 }
      );
    }
    const canonicalLinkedSourceHouse = resolveCanonicalGapfillSourceHouse(
      houses,
      String(link.sourceHouseId ?? ""),
      String(link.testHomeHouseId ?? "")
    );
    const canonicalLinkedSourceHouseId = String(
      canonicalLinkedSourceHouse?.id ?? link.sourceHouseId ?? ""
    ).trim();
    const [labOwnerUser, testHomeHouse, sourceHouse] = await Promise.all([
      prisma.user.findUnique({ where: { id: labOwnerUserId }, select: { id: true, email: true } }),
      (prisma as any).houseAddress.findUnique({
        where: { id: link.testHomeHouseId },
        select: { id: true, addressLine1: true, addressCity: true, addressState: true, esiid: true },
      }),
      (prisma as any).houseAddress.findUnique({
        where: { id: canonicalLinkedSourceHouseId },
        select: { id: true, userId: true, addressLine1: true, addressCity: true, addressState: true, esiid: true },
      }),
    ]);
    if (!labOwnerUser?.id || !testHomeHouse?.id || !sourceHouse?.id) {
      return NextResponse.json(
        attachFailureContract({ ok: false, error: "test_home_context_not_found" }),
        { status: 404 }
      );
    }

    const { homeProfile, applianceProfile } = await loadDisplayProfilesForHouse({
      userId: labOwnerUser.id,
      houseId: testHomeHouse.id,
    });

    const sourceEsiid = sourceHouse.esiid ? String(sourceHouse.esiid) : null;
    const source = await chooseActualSource({ houseId: sourceHouse.id, esiid: sourceEsiid });
    if (!source) {
      return NextResponse.json(
        attachFailureContract({
          ok: false,
          error: "no_actual_data",
          message: "No actual interval data (SMT or Green Button) on source house.",
        }),
        { status: 400 }
      );
    }
    const canonicalWindow = await getSharedPastCoverageWindowForHouse({
      userId: String(sourceHouse.userId ?? link.sourceUserId),
      houseId: sourceHouse.id,
    });
    const canonicalMonths = monthsEndingAt(canonicalWindow.endDate.slice(0, 7), 12);
    const canonicalWindowHelper = "resolveCanonicalUsage365CoverageWindow";
    let usage365: Usage365Payload | undefined = undefined;
    if (includeUsage365) {
      const sourceLabel = String((source as any)?.source ?? (source as any)?.kind ?? "actual");
      let usageDatasetResult:
        | Awaited<ReturnType<typeof getActualUsageDatasetForHouse>>
        | null = null;
      try {
        usageDatasetResult = await getActualUsageDatasetForHouse(sourceHouse.id, sourceEsiid, {
          skipFullYearIntervalFetch: true,
        });
      } catch {
        usageDatasetResult = null;
      }
      const usageDataset = usageDatasetResult?.dataset ?? null;
      if (usageDataset) {
        const boundedDaily = Array.isArray(usageDataset.daily)
          ? usageDataset.daily
              .filter((row) => {
                const dk = String((row as any)?.date ?? "").slice(0, 10);
                return dk >= canonicalWindow.startDate && dk <= canonicalWindow.endDate;
              })
              .map((row) => ({ date: String((row as any)?.date ?? "").slice(0, 10), kwh: Number((row as any)?.kwh) || 0 }))
          : [];
        const monthlyRows = Array.isArray(usageDataset.monthly)
          ? usageDataset.monthly.map((m) => ({
              month: String((m as any)?.month ?? "").slice(0, 7),
              kwh: Number((m as any)?.kwh) || 0,
            }))
          : [];
        usage365 = {
          source: String((usageDataset as any)?.summary?.source ?? sourceLabel),
          timezone,
          coverageStart: canonicalWindow.startDate,
          coverageEnd: canonicalWindow.endDate,
          intervalCount: Number((usageDataset as any)?.summary?.intervalsCount ?? 0) || 0,
          daily: boundedDaily,
          monthly: monthlyRows,
          weekdayKwh: Number((usageDataset as any)?.insights?.weekdayVsWeekend?.weekday ?? 0) || 0,
          weekendKwh: Number((usageDataset as any)?.insights?.weekdayVsWeekend?.weekend ?? 0) || 0,
          fifteenCurve: normalizeFifteenCurve96((usageDataset as any)?.insights?.fifteenMinuteAverages),
          stitchedMonth: ((usageDataset as any)?.insights?.stitchedMonth ?? null) as Usage365Payload["stitchedMonth"],
        };
      }
    }

    const userValidationPolicy = resolveUserValidationPolicy({
      defaultSelectionMode: await getUserDefaultValidationSelectionMode(),
      validationDayCount: testDaysRequested != null ? testDaysRequested : 21,
    });
    const travelRangesFromDb = await getTravelRangesFromDb(labOwnerUser.id, testHomeHouse.id);
    const sourceTravelRangesFromDb = await getTravelRangesFromDb(
      String(sourceHouse.userId ?? link.sourceUserId),
      sourceHouse.id
    );
    const travelDateKeysLocal = new Set<string>(
      travelRangesFromDb.flatMap((r) => localDateKeysInRange(r.startDate, r.endDate, timezone))
    );

    const selectedTestRanges = testRanges;
    const targetValidationDayCount = testDaysRequested != null ? testDaysRequested : 21;
    const seedUsed = seed || `${sourceHouse.id}-${canonicalWindow.endDate}`;
    const manualDateKeys = selectedTestRanges.flatMap((r) =>
      localDateKeysInRange(r.startDate, r.endDate, timezone)
    );
    const requestedModeRaw: ValidationDaySelectionMode =
      explicitAdminLabValidationMode ??
      (testDaysRequested != null
        ? getAdminLabDefaultValidationSelectionMode()
        : ("manual" as ValidationDaySelectionMode));
    const requestedMode =
      requestedModeRaw === "manual" && manualDateKeys.length === 0
        ? ("customer_style_seasonal_mix" as ValidationDaySelectionMode)
        : requestedModeRaw;
    let validationPolicyOwner: ValidationPolicyOwner = "adminValidationPolicy";
    let validationPolicy = resolveAdminValidationPolicy({
      selectionMode: requestedMode,
      validationDayCount: targetValidationDayCount,
    });
    const isManualUsageMode = isGapfillManualUsageInputMode(testUsageInputMode);
    let travelRangesForRecalc = travelRangesFromDb;
    let testSelectionMode = validationPolicy.selectionMode;
    let testDateKeysLocal = new Set<string>();
    let testRangesUsed: Array<{ startDate: string; endDate: string }> = [];
    let testDaysSelected = 0;
    let selectionDiagnostics: Record<string, unknown> | null = null;
    const usingSourceTravelRangesForRecalc = shouldUseCanonicalSourceCopyPolicy({
      usageInputMode: testUsageInputMode,
      explicitAdminValidationMode: explicitAdminLabValidationMode,
      testRanges: selectedTestRanges,
      testDaysRequested,
    });
    if (isManualUsageMode) {
      selectionDiagnostics = {
        modeUsed: validationPolicy.selectionMode,
        targetCount: validationPolicy.validationDayCount,
        selectedCount: null,
        delegatedToSharedPastSimRead: true,
        source: "manual_usage_shared_dispatch",
      };
    } else if (usingSourceTravelRangesForRecalc) {
      const sourcePastScenario = await (prisma as any).usageSimulatorScenario
        .findFirst({
          where: {
            userId: String(sourceHouse.userId ?? link.sourceUserId),
            houseId: sourceHouse.id,
            name: "Past (Corrected)",
            archivedAt: null,
          },
          select: { id: true },
        })
        .catch(() => null);
      const sourceBuildForPolicy = sourcePastScenario?.id
        ? await (prisma as any).usageSimulatorBuild
            .findUnique({
              where: {
                userId_houseId_scenarioKey: {
                  userId: String(sourceHouse.userId ?? link.sourceUserId),
                  houseId: sourceHouse.id,
                  scenarioKey: String(sourcePastScenario.id),
                },
              },
              select: { buildInputs: true },
            })
            .catch(() => null)
        : null;
      const sourceBuildInputs = (sourceBuildForPolicy as any)?.buildInputs as Record<string, unknown> | null | undefined;
      const sourceValidationKeys = Array.isArray(sourceBuildInputs?.validationOnlyDateKeysLocal)
        ? (sourceBuildInputs.validationOnlyDateKeysLocal as unknown[])
            .map((value) => String(value ?? "").slice(0, 10))
            .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
        : [];
      if (!sourcePastScenario?.id || sourceValidationKeys.length === 0) {
        return NextResponse.json(
          attachFailureContract({
            ok: false,
            error: "canonical_parity_inputs_missing",
            message:
              "Canonical source-copy parity requires persisted source-house validation keys from the normal Past Sim run.",
          }),
          { status: 409 }
        );
      }
      const sourceSelectionMode =
        normalizeValidationSelectionMode(sourceBuildInputs?.effectiveValidationSelectionMode) ??
        userValidationPolicy.selectionMode;
      validationPolicy = resolveAdminValidationPolicy({
        selectionMode: sourceSelectionMode,
        validationDayCount: sourceValidationKeys.length,
      });
      travelRangesForRecalc = sourceTravelRangesFromDb;
      testSelectionMode = validationPolicy.selectionMode;
      testDateKeysLocal = new Set(sourceValidationKeys);
      testRangesUsed = mergeDateKeysToRanges(sourceValidationKeys);
      testDaysSelected = sourceValidationKeys.length;
      selectionDiagnostics = buildSourceCopySelectionDiagnostics({
        selectionMode: sourceSelectionMode,
        selectedDateKeys: sourceValidationKeys,
      });
    } else {
      const coverageSelection = await getCandidateDateCoverageForSelection({
        houseId: sourceHouse.id,
        scenarioIdentity: `shared_past:${canonicalMonths.join(",")}`,
        windowStart: canonicalWindow.startDate,
        windowEnd: canonicalWindow.endDate,
        timezone,
        minDayCoveragePct,
        stratifyByMonth,
        stratifyByWeekend,
        loadIntervalsForWindow: async () =>
          await getActualIntervalsForRange({
            houseId: sourceHouse.id,
            esiid: sourceEsiid,
            startDate: canonicalWindow.startDate,
            endDate: canonicalWindow.endDate,
          }),
      });
      const selectedValidation = selectValidationDayKeys({
        mode: validationPolicy.selectionMode,
        targetCount: validationPolicy.validationDayCount,
        candidateDateKeys: coverageSelection.candidateDateKeys,
        travelDateKeysSet: travelDateKeysLocal,
        timezone,
        seed: seedUsed,
        manualDateKeys,
      });
      testDateKeysLocal = new Set(selectedValidation.selectedDateKeys);
      testRangesUsed = mergeDateKeysToRanges(selectedValidation.selectedDateKeys);
      testSelectionMode = validationPolicy.selectionMode;
      testDaysSelected = selectedValidation.selectedDateKeys.length;
      selectionDiagnostics = selectedValidation.diagnostics;
    }
    if (!isManualUsageMode && testDateKeysLocal.size === 0) {
      return NextResponse.json(
        attachFailureContract({
          ok: false,
          error: "test_ranges_required",
          message: "At least one valid test-day range is required.",
          validationSelectionDiagnostics: selectionDiagnostics,
        }),
        { status: 400 }
      );
    }
    const effectiveTravelDateKeysLocal = new Set<string>(
      travelRangesForRecalc.flatMap((r) => localDateKeysInRange(r.startDate, r.endDate, timezone))
    );
    const overlapLocal = setIntersect(effectiveTravelDateKeysLocal, testDateKeysLocal);
    if (!isManualUsageMode && overlapLocal.size > 0) {
      return NextResponse.json(
        attachFailureContract({
          ok: false,
          error: "test_overlaps_travel",
          message: "Test dates overlap saved vacant/travel dates.",
          overlapCount: overlapLocal.size,
        }),
        { status: 400 }
      );
    }

    const pastScenario = await (prisma as any).usageSimulatorScenario
      .findFirst({
        where: {
          userId: labOwnerUser.id,
          houseId: testHomeHouse.id,
          name: "Past (Corrected)",
          archivedAt: null,
        },
        select: { id: true },
      })
      .catch(() => null);
    if (!pastScenario?.id) {
      return NextResponse.json(
        attachFailureContract({
          ok: false,
          error: "no_past_scenario",
          message: "No Past (Corrected) scenario found on test home.",
        }),
        { status: 400 }
      );
    }

    const labCorrelationId = createSimCorrelationId();
    logSimPipelineEvent("admin_lab_run_test_home_canonical_recalc", {
      correlationId: labCorrelationId,
      source: "gapfill_lab",
      action: "run_test_home_canonical_recalc",
      userId: labOwnerUser.id,
      sourceHouseId: sourceHouse.id,
      testHomeId: testHomeHouse.id,
      scenarioId: String(pastScenario.id),
    });

    if (isManualUsageMode) {
      let dispatched: Awaited<ReturnType<typeof dispatchPastSimRecalc>>;
      try {
        dispatched = await dispatchPastSimRecalc({
          userId: labOwnerUser.id,
          houseId: testHomeHouse.id,
          esiid: sourceEsiid,
          actualContextHouseId: sourceHouse.id,
          mode: testHomeSimulatorMode,
          scenarioId: String(pastScenario.id),
          weatherPreference: gapfillWeatherLogic.weatherPreference,
          persistPastSimBaseline: true,
          preLockboxTravelRanges: travelRangesForRecalc,
          validationDaySelectionMode: testSelectionMode,
          validationDayCount: validationPolicy.validationDayCount,
          correlationId: labCorrelationId,
          adminLabTreatmentMode: adminLabTreatmentModeForRecalc ?? undefined,
          runContext: {
            callerLabel: "gapfill_launcher",
            buildPathKind: "recalc",
            persistRequested: true,
            adminLabTreatmentMode: adminLabTreatmentModeForRecalc ?? undefined,
          },
        });
      } catch (error: unknown) {
        const failure = buildAdminGapfillManualRecalcFailure({
          error: error instanceof Error ? error.name : "recalc_exception",
          missingItems: [error instanceof Error ? error.message : String(error)],
          fallbackMessage: "Canonical MANUAL_TOTALS recalc failed before the shared artifact could be persisted.",
          correlationId: labCorrelationId,
        });
        return NextResponse.json(failure.body, { status: failure.status });
      }
      if (dispatched.executionMode === "inline" && !dispatched.result.ok) {
        const failure = buildAdminGapfillManualRecalcFailure({
          error: dispatched.result.error,
          missingItems: dispatched.result.missingItems ?? null,
          fallbackMessage: String(dispatched.result.error ?? "Canonical recalc failed."),
          correlationId: dispatched.correlationId,
        });
        return NextResponse.json(failure.body, { status: failure.status });
      }
      if (dispatched.executionMode === "droplet_async") {
        return NextResponse.json({
          ok: true,
          action: "run_test_home_canonical_recalc",
          mode: "canonical_test_home_lab",
          executionMode: "droplet_async",
          correlationId: dispatched.correlationId,
          jobId: dispatched.jobId,
          treatmentMode: testUsageInputMode,
          simulatorMode: "MANUAL_TOTALS",
          testSelectionMode,
          adminValidationMode: testSelectionMode,
          effectiveTravelRangesForRecalc: travelRangesForRecalc,
          effectiveTravelRangesSource:
            usingSourceTravelRangesForRecalc ? "source_house_copy_policy" : "test_home_saved",
        });
      }
      return await buildGapfillManualUsageReadbackResponse({
        action: "run_test_home_canonical_recalc",
        email: user.email,
        timezone,
        labOwnerUserId: labOwnerUser.id,
        sourceHouse,
        sourceUserId: String(sourceHouse.userId ?? link.sourceUserId),
        testHomeHouse,
        scenarioId: String(pastScenario.id),
        correlationId: dispatched.correlationId,
        testUsageInputMode,
        weatherKind,
        gapfillWeatherLogic,
        canonicalWindow,
        canonicalWindowHelper,
        usage365,
        homeProfile,
        applianceProfile,
        travelRangesFromDb,
        sourceTravelRangesFromDb,
        travelRangesForRecalc,
        usingSourceTravelRangesForRecalc,
        testSelectionMode,
        validationPolicyOwner,
        userDefaultValidationSelectionMode: userValidationPolicy.selectionMode,
        selectionDiagnostics,
      });
    }

    let recalcOut: Awaited<ReturnType<typeof recalcSimulatorBuild>>;
    try {
      recalcOut = await withTimeout(
        recalcSimulatorBuild({
          userId: labOwnerUser.id,
          houseId: testHomeHouse.id,
          esiid: sourceEsiid,
          actualContextHouseId: sourceHouse.id,
          mode: testHomeSimulatorMode,
          scenarioId: String(pastScenario.id),
          weatherPreference: gapfillWeatherLogic.weatherPreference,
          persistPastSimBaseline: true,
          validationOnlyDateKeysLocal: testDateKeysLocal,
          preLockboxTravelRanges: travelRangesForRecalc,
          validationDaySelectionMode: testSelectionMode,
          validationDayCount: validationPolicy.validationDayCount,
          correlationId: labCorrelationId,
          adminLabTreatmentMode: adminLabTreatmentModeForRecalc ?? undefined,
          runContext: {
            callerLabel: "gapfill_launcher",
            buildPathKind: "recalc",
            persistRequested: true,
            adminLabTreatmentMode: adminLabTreatmentModeForRecalc ?? undefined,
          },
        }),
        ROUTE_CANONICAL_RECALC_TIMEOUT_MS,
        "canonical_recalc_timeout"
      );
    } catch (recalcError: unknown) {
      const timedOut =
        recalcError instanceof Error &&
        ((recalcError as any).code === "canonical_recalc_timeout" ||
          /canonical_recalc_timeout/i.test(String(recalcError.message ?? "")));
      if (timedOut) {
        logSimPipelineEvent("recalc_timeout", {
          correlationId: labCorrelationId,
          source: "gapfill_lab",
          action: "run_test_home_canonical_recalc",
          userId: labOwnerUser.id,
          houseId: testHomeHouse.id,
          scenarioId: String(pastScenario.id),
          durationMs: ROUTE_CANONICAL_RECALC_TIMEOUT_MS,
        });
      }
      return NextResponse.json(
        attachFailureContract({
          ok: false,
          error: timedOut ? "canonical_recalc_timeout" : "canonical_recalc_failed",
          message: timedOut
            ? "Canonical recalc exceeded route timeout. Retry, or run with smaller compare scope."
            : recalcError instanceof Error
              ? recalcError.message
              : "Canonical recalc failed.",
          correlationId: labCorrelationId,
        }),
        { status: timedOut ? 504 : 500 }
      );
    }
    if (!recalcOut.ok) {
      return NextResponse.json(
        attachFailureContract({
          ok: false,
          error: "canonical_recalc_failed",
          message: String(recalcOut.error ?? "Canonical recalc failed."),
          correlationId: labCorrelationId,
        }),
        { status: 500 }
      );
    }

    let baselineRead: Awaited<ReturnType<typeof getSimulatedUsageForHouseScenario>>;
    try {
      baselineRead = await withTimeout(
        getSimulatedUsageForHouseScenario({
          userId: labOwnerUser.id,
          houseId: testHomeHouse.id,
          scenarioId: String(pastScenario.id),
          // Recalc just persisted the canonical artifact; read it directly so this route
          // does not trigger another heavy rebuild leg after a successful recalc.
          readMode: "artifact_only",
          exactArtifactInputHash:
            typeof recalcOut.canonicalArtifactInputHash === "string" &&
            recalcOut.canonicalArtifactInputHash.trim()
              ? recalcOut.canonicalArtifactInputHash
              : undefined,
          requireExactArtifactMatch: Boolean(
            typeof recalcOut.canonicalArtifactInputHash === "string" &&
              recalcOut.canonicalArtifactInputHash.trim()
          ),
          projectionMode: "baseline",
          correlationId: labCorrelationId,
          readContext: {
            artifactReadMode: "artifact_only",
            projectionMode: "baseline",
            compareSidecarRequest: true,
          },
        }),
        ROUTE_CANONICAL_READ_AFTER_RECALC_TIMEOUT_MS,
        "canonical_read_timeout"
      );
    } catch (readError: unknown) {
      const timedOut =
        readError instanceof Error &&
        ((readError as any).code === "canonical_read_timeout" ||
          /canonical_read_timeout/i.test(String(readError.message ?? "")));
      return NextResponse.json(
        attachFailureContract({
          ok: false,
          error: timedOut ? "canonical_read_timeout" : "canonical_read_failed",
          message: timedOut
            ? "Canonical read exceeded route timeout. Retry recalc."
            : readError instanceof Error
              ? readError.message
              : "Canonical read failed.",
          correlationId: labCorrelationId,
        }),
        { status: timedOut ? 504 : 500 }
      );
    }
    if (!baselineRead.ok) {
      return NextResponse.json(
        attachFailureContract({
          ok: false,
          error: "canonical_read_failed",
          message: baselineRead.message ?? "Canonical read failed.",
          correlationId: labCorrelationId,
        }),
        { status: 500 }
      );
    }

    const baselineDataset = baselineRead.dataset as any;
    const metaRaw =
      baselineDataset && typeof baselineDataset === "object" && baselineDataset.meta && typeof baselineDataset.meta === "object"
        ? (baselineDataset.meta as Record<string, unknown>)
        : null;
    const fingerprintBuildFreshness = serializeFingerprintBuildFreshnessFromDatasetMeta(metaRaw);

    const buildRow = await (prisma as any).usageSimulatorBuild
      .findUnique({
        where: {
          userId_houseId_scenarioKey: {
            userId: labOwnerUser.id,
            houseId: testHomeHouse.id,
            scenarioKey: String(pastScenario.id),
          },
        },
        select: { id: true, lastBuiltAt: true, buildInputsHash: true, buildInputs: true },
      })
      .catch(() => null);

    const { effectiveValidationSelectionMode, fromBuildInputs: effectiveValidationFromBuild } =
      readEffectiveValidationFromBuildInputs(
        buildRow?.buildInputs as Record<string, unknown> | undefined,
        testSelectionMode
      );

    const artifactRow = await (usagePrisma as any).pastSimulatedDatasetCache
      .findFirst({
        where: { houseId: testHomeHouse.id, scenarioId: String(pastScenario.id) },
        orderBy: { updatedAt: "desc" },
        select: { id: true, updatedAt: true, inputHash: true, engineVersion: true },
      })
      .catch(() => null);

    const userDefaultValidationSelectionMode = await getUserDefaultValidationSelectionMode();

    const selectedDateKeysSorted = Array.from(testDateKeysLocal).sort();
    const metadataValidationOnlyDateKeysLocal = Array.isArray((baselineDataset as any)?.meta?.validationOnlyDateKeysLocal)
      ? ((baselineDataset as any).meta.validationOnlyDateKeysLocal as unknown[])
          .map((v) => String(v ?? "").slice(0, 10))
          .filter((dk) => /^\d{4}-\d{2}-\d{2}$/.test(dk))
      : [];
    const effectiveValidationOnlyDateKeysLocal =
      selectedDateKeysSorted.length > 0 ? selectedDateKeysSorted : metadataValidationOnlyDateKeysLocal;
    const effectiveValidationDateKeySet = new Set<string>(effectiveValidationOnlyDateKeysLocal);
    let rawCurveCompareDataset: any = null;
    let rawCurveCompareReadStatus: string | null = null;
    try {
      const rawCurveCompareRead = await withTimeout(
        getSimulatedUsageForHouseScenario({
          userId: labOwnerUser.id,
          houseId: testHomeHouse.id,
          scenarioId: String(pastScenario.id),
          readMode: "artifact_only",
          exactArtifactInputHash:
            typeof recalcOut.canonicalArtifactInputHash === "string" &&
            recalcOut.canonicalArtifactInputHash.trim()
              ? recalcOut.canonicalArtifactInputHash
              : undefined,
          requireExactArtifactMatch: Boolean(
            typeof recalcOut.canonicalArtifactInputHash === "string" &&
              recalcOut.canonicalArtifactInputHash.trim()
          ),
          projectionMode: "raw",
          correlationId: labCorrelationId,
          readContext: {
            artifactReadMode: "artifact_only",
            projectionMode: "raw",
            compareSidecarRequest: false,
          },
        }),
        ROUTE_CANONICAL_READ_AFTER_RECALC_TIMEOUT_MS,
        "canonical_curve_compare_raw_read_timeout"
      );
      if (rawCurveCompareRead.ok) {
        rawCurveCompareDataset = rawCurveCompareRead.dataset as any;
        rawCurveCompareReadStatus = "available";
      } else {
        rawCurveCompareReadStatus = rawCurveCompareRead.message ?? "raw_curve_compare_read_failed";
      }
    } catch (rawCurveCompareReadError: unknown) {
      rawCurveCompareReadStatus =
        rawCurveCompareReadError instanceof Error
          ? rawCurveCompareReadError.message
          : "raw_curve_compare_read_failed";
    }
    const compareProjectionRead =
      baselineRead &&
      typeof baselineRead === "object" &&
      (baselineRead as Record<string, unknown>).compareProjection &&
      typeof (baselineRead as Record<string, unknown>).compareProjection === "object"
        ? ((baselineRead as Record<string, unknown>).compareProjection as Record<string, unknown>)
        : buildValidationCompareProjectionSidecar(baselineDataset);
    const baselineDailyRows = Array.isArray(baselineDataset?.daily) ? (baselineDataset.daily as Array<Record<string, unknown>>) : [];
    const baselineActualDayCount = baselineDailyRows.reduce((count, row) => {
      const source = String((row as any)?.source ?? "").toUpperCase();
      return source === "ACTUAL" ? count + 1 : count;
    }, 0);
    const baselineSimulatedDayCount = baselineDailyRows.reduce((count, row) => {
      const source = String((row as any)?.source ?? "").toUpperCase();
      return source === "SIMULATED" ? count + 1 : count;
    }, 0);
    const rawCurveCompareSimulatedIntervals15 = Array.isArray(rawCurveCompareDataset?.series?.intervals15)
      ? (rawCurveCompareDataset.series.intervals15 as Array<Record<string, unknown>>)
          .filter((row) =>
            effectiveValidationDateKeySet.has(dateKeyInTimezone(String(row?.timestamp ?? ""), timezone))
          )
          .map((row) => ({
            timestamp: String(row.timestamp ?? ""),
            kwh: Number(row.kwh ?? 0) || 0,
          }))
      : [];
    const rawCurveCompareDailyRows = Array.isArray(rawCurveCompareDataset?.daily)
      ? (rawCurveCompareDataset.daily as Array<Record<string, unknown>>)
          .filter((row) =>
            effectiveValidationDateKeySet.has(String(row?.date ?? "").slice(0, 10))
          )
          .map((row) => ({
            date: String(row.date ?? "").slice(0, 10),
            kwh: Number(row.kwh ?? 0) || 0,
            source: typeof row.source === "string" ? row.source : null,
            sourceDetail: typeof row.sourceDetail === "string" ? row.sourceDetail : null,
          }))
          .sort((a, b) => a.date.localeCompare(b.date))
      : [];
    // Single source of truth for this response: scored rows and summaries must use the same effective date set.
    const compareProjectionRows = Array.isArray((compareProjectionRead as any)?.rows)
      ? (((compareProjectionRead as any).rows as Array<Record<string, unknown>>) ?? []).map((row) => ({ ...row }))
      : [];
    const compareProjectionMetrics =
      (compareProjectionRead as any)?.metrics && typeof (compareProjectionRead as any).metrics === "object"
        ? ((compareProjectionRead as any).metrics as Record<string, unknown>)
        : {};
    const compareProjectionRowDateSet = new Set(
      compareProjectionRows
        .map((row) => String((row as any)?.localDate ?? "").slice(0, 10))
        .filter((dk) => /^\d{4}-\d{2}-\d{2}$/.test(dk))
    );
    if (effectiveValidationOnlyDateKeysLocal.length > 0) {
      const missingCompareDateKeys = effectiveValidationOnlyDateKeysLocal.filter(
        (dk) => !compareProjectionRowDateSet.has(dk)
      );
      if (missingCompareDateKeys.length > 0) {
        return NextResponse.json(
          attachFailureContract({
            ok: false,
            error: "compare_truth_incomplete",
            message: `Canonical GapFill compare requires persisted compare rows for: ${missingCompareDateKeys.join(", ")}.`,
            reasonCode: "COMPARE_TRUTH_INCOMPLETE",
            missingDateKeysLocal: missingCompareDateKeys,
            correlationId: labCorrelationId,
          }),
          { status: 409 }
        );
      }
    }
    const compareProjectionForResponse = {
      rows: compareProjectionRows,
      metrics: compareProjectionMetrics,
    };
    const compareRowsCount = compareProjectionRows.length;
    const artifactSourceMode =
      typeof metaRaw?.artifactSourceMode === "string" ? String(metaRaw.artifactSourceMode) : null;
    const artifactHashMatch =
      typeof metaRaw?.artifactHashMatch === "boolean" ? metaRaw.artifactHashMatch : null;
    const requestedInputHash =
      typeof metaRaw?.requestedInputHash === "string" ? String(metaRaw.requestedInputHash) : null;
    const readArtifactInputHash =
      typeof metaRaw?.artifactInputHashUsed === "string"
        ? String(metaRaw.artifactInputHashUsed)
        : typeof metaRaw?.artifactInputHash === "string"
          ? String(metaRaw.artifactInputHash)
          : null;
    /** Latest-by-scenario artifact substitution is removed; kept false for response shape compatibility. */
    const usedFallbackArtifact = false;
    const exactCanonicalReadSucceeded = artifactHashMatch === true;
    const baselineProjectionExpected = effectiveValidationOnlyDateKeysLocal.length > 0;
    const validationLeakDatesInBaseline = baselineDailyRows
      .filter((row) => {
        const dateKey = String((row as any)?.date ?? "").slice(0, 10);
        const source = String((row as any)?.source ?? "").toUpperCase();
        return effectiveValidationDateKeySet.has(dateKey) && source === "SIMULATED";
      })
      .map((row) => String((row as any)?.date ?? "").slice(0, 10))
      .filter((dk) => /^\d{4}-\d{2}-\d{2}$/.test(dk))
      .sort();
    const validationLeakCountInBaseline = validationLeakDatesInBaseline.length;
    const validationDatesRenderedAsActualCount = baselineDailyRows.reduce((count, row) => {
      const dateKey = String((row as any)?.date ?? "").slice(0, 10);
      const source = String((row as any)?.source ?? "").toUpperCase();
      return effectiveValidationDateKeySet.has(dateKey) && source === "ACTUAL" ? count + 1 : count;
    }, 0);
    const validationDatesRenderedAsSimulatedCount = baselineDailyRows.reduce((count, row) => {
      const dateKey = String((row as any)?.date ?? "").slice(0, 10);
      const source = String((row as any)?.source ?? "").toUpperCase();
      return effectiveValidationDateKeySet.has(dateKey) && source === "SIMULATED" ? count + 1 : count;
    }, 0);
    const travelVacantSimulatedDatesInBaselineCount = baselineDailyRows.reduce((count, row) => {
      const dateKey = String((row as any)?.date ?? "").slice(0, 10);
      const source = String((row as any)?.source ?? "").toUpperCase();
      return !effectiveValidationDateKeySet.has(dateKey) && source === "SIMULATED" ? count + 1 : count;
    }, 0);
    const compareRowDateSet = compareProjectionRowDateSet;
    const selectedValidationDateSet = new Set(effectiveValidationOnlyDateKeysLocal);
    const compareRowsMatchSelectedDates =
      compareRowDateSet.size === selectedValidationDateSet.size &&
      Array.from(compareRowDateSet).every((dk) => selectedValidationDateSet.has(dk));
    const baselineProjectionApplied = Boolean(metaRaw?.validationProjectionApplied);
    const baselineProjectionCorrect = baselineProjectionExpected
      ? baselineProjectionApplied &&
        validationLeakCountInBaseline === 0 &&
        validationDatesRenderedAsSimulatedCount === 0
      : validationLeakCountInBaseline === 0 && validationDatesRenderedAsSimulatedCount === 0;
    const canonicalReadResultSummary = {
      ok: true,
      readMode: "artifact_only",
      projectionMode: "baseline",
      readLayer: "getSimulatedUsageForHouseScenario",
      readFamily: "getSimulatedUsageForHouseScenario->/api/user/usage/simulated/house",
      fallbackAllowed: false,
      exactCanonicalReadSucceeded,
      usedFallbackArtifact,
      artifactSourceMode,
      artifactHashMatch,
      artifactRecomputed:
        typeof metaRaw?.artifactRecomputed === "boolean" ? metaRaw.artifactRecomputed : null,
      artifactSourceNote: typeof metaRaw?.artifactSourceNote === "string" ? metaRaw.artifactSourceNote : null,
      requestedInputHash,
      artifactInputHashUsed: readArtifactInputHash,
      metadataValidationOnlyDateKeysLocal,
      canonicalReadFailureCode: null as string | null,
      canonicalReadFailureMessage: null as string | null,
    };
    const baselineProjectionSummary = {
      applied: baselineProjectionApplied,
      expected: baselineProjectionExpected,
      correct: baselineProjectionCorrect,
      projectionType:
        typeof metaRaw?.validationProjectionType === "string" ? metaRaw.validationProjectionType : null,
      validationCompareAvailable: Boolean(metaRaw?.validationCompareAvailable),
      validationOnlyDateKeysLocal: effectiveValidationOnlyDateKeysLocal,
      validationOnlyDateKeyCount: effectiveValidationOnlyDateKeysLocal.length,
      actualDayCount: baselineActualDayCount,
      simulatedDayCount: baselineSimulatedDayCount,
      validationLeakDatesInBaseline,
      validationLeakCountInBaseline,
      validationDatesRenderedAsActualCount,
      validationDatesRenderedAsSimulatedCount,
      baselineDailyRowCount: baselineDailyRows.length,
      baselineMonthlyRowCount: Array.isArray(baselineDataset?.monthly) ? baselineDataset.monthly.length : 0,
      baselineIntervalCount: Array.isArray(baselineDataset?.series?.intervals15) ? baselineDataset.series.intervals15.length : 0,
    };
    const compareProjectionSummary = {
      attached: compareRowsCount > 0,
      rowCount: compareRowsCount,
      metrics: compareProjectionForResponse.metrics,
    };
    const sharedResultPayloadSummary = {
      summary: baselineDataset?.summary ?? null,
      metaKeys: metaRaw ? Object.keys(metaRaw).sort() : [],
      coverageStart: String((baselineDataset?.summary?.start as string | undefined) ?? canonicalWindow.startDate).slice(0, 10),
      coverageEnd: String((baselineDataset?.summary?.end as string | undefined) ?? canonicalWindow.endDate).slice(0, 10),
      validationOnlyDateKeysLocal: effectiveValidationOnlyDateKeysLocal,
      compareRowsCount,
      baselineActualDayCount,
      baselineSimulatedDayCount,
    };
    const pipelineDiagnosticsSummary = {
      correlationId: labCorrelationId,
      buildId: buildRow?.id ?? null,
      buildInputsHash: buildRow?.buildInputsHash ?? recalcOut.buildInputsHash,
      artifactId: artifactRow?.id ?? null,
      artifactInputHash: artifactRow?.inputHash ?? null,
      artifactUpdatedAt: artifactRow?.updatedAt instanceof Date ? artifactRow.updatedAt.toISOString() : null,
      artifactEngineVersion: artifactRow?.engineVersion ?? null,
      testSelectionMode,
      validationOnlyDateKeysLocal: effectiveValidationOnlyDateKeysLocal,
      validationOnlyDateKeyCount: effectiveValidationOnlyDateKeysLocal.length,
      compareRowsCount,
      baselineActualDayCount,
      baselineSimulatedDayCount,
      exactCanonicalReadSucceeded,
      usedFallbackArtifact,
      requestedInputHash,
      artifactInputHashUsed: readArtifactInputHash,
      artifactHashMatch,
      baselineProjectionExpected,
      baselineProjectionApplied,
      baselineProjectionCorrect,
      compareRowsMatchSelectedDates,
      validationLeakDatesInBaseline,
      validationLeakCountInBaseline,
    };
    const diagnosticsVerdict = {
      exactCanonicalReadSucceeded,
      usedFallbackArtifact,
      fallbackArtifactReason: usedFallbackArtifact ? artifactSourceMode : null,
      savedArtifactInputHash: artifactRow?.inputHash ?? null,
      requestedInputHash,
      readArtifactInputHash,
      artifactHashMatch,
      baselineProjectionExpected,
      baselineProjectionApplied,
      baselineProjectionCorrect,
      selectedValidationDateCount: effectiveValidationOnlyDateKeysLocal.length,
      compareRowCount: compareRowsCount,
      compareRowsMatchSelectedDates,
      validationLeakDatesInBaseline,
      validationLeakCountInBaseline,
      travelVacantSimulatedDatesInBaselineCount,
      validationDatesRenderedAsActualCount,
      validationDatesRenderedAsSimulatedCount,
    };
    const scoredDayTruthRows = effectiveValidationOnlyDateKeysLocal.map((dk) => {
      const row = compareProjectionRows.find((r) => String(r?.localDate ?? "").slice(0, 10) === dk) ?? null;
      const actualDayKwh = round2(Number(row?.actualDayKwh ?? 0) || 0);
      const freshCompareSimDayKwh = round2(Number(row?.simulatedDayKwh ?? 0) || 0);
      const percentError =
        row?.percentError == null
          ? null
          : round2(Number(row.percentError) || 0);
      return {
        localDate: dk,
        actualDayKwh,
        freshCompareSimDayKwh,
        displayedPastStyleSimDayKwh: freshCompareSimDayKwh,
        actualVsFreshErrorKwh: round2(actualDayKwh - freshCompareSimDayKwh),
        displayVsFreshParityMatch: true,
        parityAvailability: "available",
        parityReasonCode: "display_matches_canonical_artifact",
        dayType: row?.dayType === "weekend" ? "weekend" : "weekday",
        percentError,
      };
    });
    const compareMetrics = (compareProjectionForResponse.metrics && typeof compareProjectionForResponse.metrics === "object")
      ? compareProjectionForResponse.metrics as Record<string, unknown>
      : {};
    const sharedDiagnostics = baselineDataset
      ? buildSharedPastSimDiagnostics({
          callerType: "gapfill_test",
          dataset: baselineDataset,
          scenarioId: String(pastScenario.id),
          correlationId: labCorrelationId,
          usageInputMode: testUsageInputMode,
          validationPolicyOwner,
          weatherLogicMode: gapfillWeatherLogic.weatherLogicMode,
          compareProjection: compareProjectionForResponse,
          readMode: "artifact_only",
          projectionMode: "baseline",
          artifactId: artifactRow?.id ?? null,
          artifactInputHash: artifactRow?.inputHash ?? null,
          artifactEngineVersion: artifactRow?.engineVersion ?? null,
          artifactPersistenceOutcome: exactCanonicalReadSucceeded ? "persisted_artifact_exact_read" : "persisted_artifact_fallback",
        })
      : null;

    return NextResponse.json({
      ok: true,
      action: "run_test_home_canonical_recalc",
      mode: "canonical_test_home_lab",
      correlationId: labCorrelationId,
      email: user.email,
      sourceUserId: user.id,
      scenarioId: String(pastScenario.id),
      sourceHouseId: sourceHouse.id,
      testHomeId: testHomeHouse.id,
      /** Requested Section 24 admin treatment; applied in shared `recalcSimulatorBuild` after `resolveSimFingerprint`. */
      treatmentMode: testUsageInputMode,
      supportedAdminTreatmentModes: [...ADMIN_LAB_TREATMENT_MODES],
      usageInputMode: testUsageInputMode,
      simulatorMode:
        recalcOut.effectiveSimulatorMode ??
        (typeof (buildRow?.buildInputs as Record<string, unknown> | undefined)?.mode === "string"
          ? String((buildRow?.buildInputs as Record<string, unknown>).mode)
          : "SMT_BASELINE"),
      sourceHouse: {
        id: sourceHouse.id,
        label: [sourceHouse.addressLine1, sourceHouse.addressCity, sourceHouse.addressState].filter(Boolean).join(", ") || sourceHouse.id,
      },
      testHome: {
        id: testHomeHouse.id,
        label: "Test Home",
        canonicalIdentity: GAPFILL_LAB_TEST_HOME_LABEL,
      },
      timezone,
      homeProfile,
      applianceProfile,
      weatherKind,
      weatherLogicMode: gapfillWeatherLogic.weatherLogicMode,
      weatherLogicOwner: gapfillWeatherLogic.owner,
      canonicalWindow: {
        startDate: canonicalWindow.startDate,
        endDate: canonicalWindow.endDate,
        helper: canonicalWindowHelper,
      },
      travelRangesFromDb: travelRangesForRecalc,
      testHomeTravelRangesFromDb: travelRangesFromDb,
      sourceTravelRangesFromDb,
      effectiveTravelRangesForRecalc: travelRangesForRecalc,
      effectiveTravelRangesSource:
        usingSourceTravelRangesForRecalc ? "source_house_copy_policy" : "test_home_saved",
      testRangesUsed,
      testSelectionMode,
      adminValidationMode: testSelectionMode,
      validationPolicyOwner,
      userDefaultValidationSelectionMode: userValidationPolicy.selectionMode,
      effectiveValidationSelectionMode,
      effectiveValidationSelectionModeSource: effectiveValidationFromBuild ? "usage_simulator_build" : "request_fallback",
      testDaysRequested,
      testDaysSelected,
      seedUsed,
      selectionDiagnostics,
      validationSelectionDiagnostics: selectionDiagnostics,
      usage365,
      baselineDatasetProjection: baselineDataset,
      compareProjection: compareProjectionForResponse,
      buildId: buildRow?.id ?? null,
      buildLastBuiltAt: buildRow?.lastBuiltAt ? (buildRow.lastBuiltAt as Date).toISOString() : null,
      buildInputsHash: buildRow?.buildInputsHash ?? recalcOut.buildInputsHash,
      artifactId: artifactRow?.id ?? null,
      artifactInputHash: artifactRow?.inputHash ?? null,
      artifactCacheUpdatedAt: artifactRow?.updatedAt instanceof Date ? artifactRow.updatedAt.toISOString() : null,
      artifactEngineVersion: artifactRow?.engineVersion ?? null,
      fingerprintBuildFreshness,
      scoredDayTruthRows,
      metrics: {
        mae: Number(compareMetrics.mae ?? 0) || 0,
        rmse: Number(compareMetrics.rmse ?? 0) || 0,
        mape: Number(compareMetrics.mape ?? 0) || 0,
        wape: Number(compareMetrics.wape ?? 0) || 0,
        maxAbs: Number(compareMetrics.maxAbs ?? 0) || 0,
        totalActualKwhMasked: Number(compareMetrics.totalActualKwhMasked ?? 0) || 0,
        totalSimKwhMasked: Number(compareMetrics.totalSimKwhMasked ?? 0) || 0,
        deltaKwhMasked: Number(compareMetrics.deltaKwhMasked ?? 0) || 0,
        mapeFiltered: compareMetrics.mapeFiltered == null ? null : (Number(compareMetrics.mapeFiltered) || 0),
        mapeFilteredCount: Number(compareMetrics.mapeFilteredCount ?? 0) || 0,
      },
      compareTruth: {
        canonicalReadLayer: "getSimulatedUsageForHouseScenario",
        canonicalReadRoute: "/api/user/usage/simulated/house",
        validationDaysTruthSource: "canonical_saved_artifact_family",
      },
      canonicalReadResultSummary,
      baselineProjectionSummary,
      compareProjectionSummary,
      sharedResultPayloadSummary,
      pipelineDiagnosticsSummary,
      diagnosticsVerdict,
      sharedDiagnostics,
      curveCompareSimulatedIntervals15: rawCurveCompareSimulatedIntervals15,
      curveCompareSimulatedDailyRows: rawCurveCompareDailyRows,
      curveCompareRawReadStatus: rawCurveCompareReadStatus,
      modelAssumptions: {
        canonicalReadFamily: "getSimulatedUsageForHouseScenario->/api/user/usage/simulated/house",
        projectionMode: "baseline_vs_accuracy",
        validationOnlyDateKeysLocal: effectiveValidationOnlyDateKeysLocal,
        actualContextHouseId: sourceHouse.id,
        userDefaultValidationSelectionMode,
        adminLabValidationSelectionMode: testSelectionMode,
      },
    });
  }

  if (rawAction === "read_test_home_canonical_result") {
    if (!labOwnerUserId) {
      return NextResponse.json(attachFailureContract({ ok: false, error: "lab_owner_not_found" }), { status: 400 });
    }
    const link = await getLabTestHomeLink(labOwnerUserId);
    if (!link?.testHomeHouseId || !link.sourceHouseId || !link.sourceUserId || link.status !== "ready") {
      return NextResponse.json(
        attachFailureContract({
          ok: false,
          error: "test_home_not_ready",
          message: "Load/replace test home first and wait for ready state.",
          testHomeLink: link ?? null,
        }),
        { status: 409 }
      );
    }
    const canonicalLinkedSourceHouse = resolveCanonicalGapfillSourceHouse(
      houses,
      String(link.sourceHouseId ?? ""),
      String(link.testHomeHouseId ?? "")
    );
    const canonicalLinkedSourceHouseId = String(
      canonicalLinkedSourceHouse?.id ?? link.sourceHouseId ?? ""
    ).trim();
    const [labOwnerUser, testHomeHouse, sourceHouse] = await Promise.all([
      prisma.user.findUnique({ where: { id: labOwnerUserId }, select: { id: true, email: true } }),
      (prisma as any).houseAddress.findUnique({
        where: { id: link.testHomeHouseId },
        select: { id: true, addressLine1: true, addressCity: true, addressState: true, esiid: true },
      }),
      (prisma as any).houseAddress.findUnique({
        where: { id: canonicalLinkedSourceHouseId },
        select: { id: true, userId: true, addressLine1: true, addressCity: true, addressState: true, esiid: true },
      }),
    ]);
    if (!labOwnerUser?.id || !testHomeHouse?.id || !sourceHouse?.id) {
      return NextResponse.json(
        attachFailureContract({ ok: false, error: "test_home_context_not_found" }),
        { status: 404 }
      );
    }
    const source = await chooseActualSource({ houseId: sourceHouse.id, esiid: sourceHouse.esiid ? String(sourceHouse.esiid) : null });
    if (!source) {
      return NextResponse.json(
        attachFailureContract({
          ok: false,
          error: "no_actual_data",
          message: "No actual interval data (SMT or Green Button) on source house.",
        }),
        { status: 400 }
      );
    }
    const { homeProfile, applianceProfile } = await loadDisplayProfilesForHouse({
      userId: labOwnerUser.id,
      houseId: testHomeHouse.id,
    });
    const canonicalWindow = await getSharedPastCoverageWindowForHouse({
      userId: String(sourceHouse.userId ?? link.sourceUserId),
      houseId: sourceHouse.id,
    });
    const canonicalWindowHelper = "resolveCanonicalUsage365CoverageWindow";
    let usage365: Usage365Payload | undefined = undefined;
    if (includeUsage365) {
      const usageDatasetResult = await getActualUsageDatasetForHouse(
        sourceHouse.id,
        sourceHouse.esiid ? String(sourceHouse.esiid) : null,
        { skipFullYearIntervalFetch: true }
      ).catch(() => ({ dataset: null }));
      const usageDataset = usageDatasetResult?.dataset ?? null;
      if (usageDataset) {
        usage365 = {
          source: String((usageDataset as any)?.summary?.source ?? (source as any)?.source ?? "actual"),
          timezone,
          coverageStart: canonicalWindow.startDate,
          coverageEnd: canonicalWindow.endDate,
          intervalCount: Number((usageDataset as any)?.summary?.intervalsCount ?? 0) || 0,
          daily: Array.isArray(usageDataset.daily)
            ? usageDataset.daily
                .filter((row) => {
                  const dk = String((row as any)?.date ?? "").slice(0, 10);
                  return dk >= canonicalWindow.startDate && dk <= canonicalWindow.endDate;
                })
                .map((row) => ({
                  date: String((row as any)?.date ?? "").slice(0, 10),
                  kwh: Number((row as any)?.kwh ?? 0) || 0,
                }))
            : [],
          monthly: Array.isArray(usageDataset.monthly)
            ? usageDataset.monthly.map((m) => ({
                month: String((m as any)?.month ?? "").slice(0, 7),
                kwh: Number((m as any)?.kwh ?? 0) || 0,
              }))
            : [],
          weekdayKwh: Number((usageDataset as any)?.insights?.weekdayVsWeekend?.weekday ?? 0) || 0,
          weekendKwh: Number((usageDataset as any)?.insights?.weekdayVsWeekend?.weekend ?? 0) || 0,
          fifteenCurve: normalizeFifteenCurve96((usageDataset as any)?.insights?.fifteenMinuteAverages),
          stitchedMonth: ((usageDataset as any)?.insights?.stitchedMonth ?? null) as Usage365Payload["stitchedMonth"],
        };
      }
    }
    const userValidationPolicy = resolveUserValidationPolicy({
      defaultSelectionMode: await getUserDefaultValidationSelectionMode(),
      validationDayCount: testDaysRequested != null ? testDaysRequested : 21,
    });
    const travelRangesFromDb = await getTravelRangesFromDb(labOwnerUser.id, testHomeHouse.id);
    const sourceTravelRangesFromDb = await getTravelRangesFromDb(
      String(sourceHouse.userId ?? link.sourceUserId),
      sourceHouse.id
    );
    const selectedTestRanges = testRanges;
    const targetValidationDayCount = testDaysRequested != null ? testDaysRequested : 21;
    const manualDateKeys = selectedTestRanges.flatMap((r) =>
      localDateKeysInRange(r.startDate, r.endDate, timezone)
    );
    const requestedModeRaw: ValidationDaySelectionMode =
      explicitAdminLabValidationMode ??
      (testDaysRequested != null
        ? getAdminLabDefaultValidationSelectionMode()
        : ("manual" as ValidationDaySelectionMode));
    const requestedMode =
      requestedModeRaw === "manual" && manualDateKeys.length === 0
        ? ("customer_style_seasonal_mix" as ValidationDaySelectionMode)
        : requestedModeRaw;
    const validationPolicy = resolveAdminValidationPolicy({
      selectionMode: requestedMode,
      validationDayCount: targetValidationDayCount,
    });
    const usingSourceTravelRangesForRecalc = shouldUseCanonicalSourceCopyPolicy({
      usageInputMode: testUsageInputMode,
      explicitAdminValidationMode: explicitAdminLabValidationMode,
      testRanges: selectedTestRanges,
      testDaysRequested,
    });
    const travelRangesForRecalc = usingSourceTravelRangesForRecalc ? sourceTravelRangesFromDb : travelRangesFromDb;
    const selectionDiagnostics = {
      modeUsed: validationPolicy.selectionMode,
      targetCount: validationPolicy.validationDayCount,
      selectedCount: null,
      delegatedToSharedPastSimRead: true,
      source: "manual_usage_shared_dispatch",
    };
    const pastScenario = await (prisma as any).usageSimulatorScenario
      .findFirst({
        where: {
          userId: labOwnerUser.id,
          houseId: testHomeHouse.id,
          name: "Past (Corrected)",
          archivedAt: null,
        },
        select: { id: true },
      })
      .catch(() => null);
    return await buildGapfillManualUsageReadbackResponse({
      action: "read_test_home_canonical_result",
      email: user.email,
      timezone,
      labOwnerUserId: labOwnerUser.id,
      sourceHouse,
      sourceUserId: String(sourceHouse.userId ?? link.sourceUserId),
      testHomeHouse,
      scenarioId: String(pastScenario?.id ?? ""),
      correlationId: null,
      testUsageInputMode,
      weatherKind,
      gapfillWeatherLogic,
      canonicalWindow,
      canonicalWindowHelper,
      usage365,
      homeProfile,
      applianceProfile,
      travelRangesFromDb,
      sourceTravelRangesFromDb,
      travelRangesForRecalc,
      usingSourceTravelRangesForRecalc,
      testSelectionMode: validationPolicy.selectionMode,
      validationPolicyOwner: "adminValidationPolicy",
      userDefaultValidationSelectionMode: userValidationPolicy.selectionMode,
      selectionDiagnostics,
    });
  }

  if (rawAction === "run_source_home_past_sim_snapshot") {
    const selectedSourceHouse = houses.find((h: any) => String(h.id) === sourceHouseIdParam);
    if (!selectedSourceHouse) {
      return NextResponse.json(
        attachFailureContract({
          ok: false,
          error: "source_house_not_found",
          message: "Selected source house was not found for this user.",
        }),
        { status: 404 }
      );
    }
    const sourcePastCorrelationId = createSimCorrelationId();
    logSimPipelineEvent("admin_lab_run_source_home_past_sim_snapshot_started", {
      correlationId: sourcePastCorrelationId,
      source: "gapfill_lab",
      action: "run_source_home_past_sim_snapshot",
      userId: user.id,
      sourceHouseId: selectedSourceHouse.id,
      timezone,
      weatherKind,
    });
    let snapshot:
      | Awaited<ReturnType<typeof buildSourceHomePastSimSnapshot>>
      | null = null;
    try {
      snapshot = await buildSourceHomePastSimSnapshot({
        userId: user.id,
        sourceHouse: {
          id: selectedSourceHouse.id,
          esiid: selectedSourceHouse.esiid ? String(selectedSourceHouse.esiid) : null,
        },
        correlationId: sourcePastCorrelationId,
        includeDiagnostics,
        getTravelRangesFromDb,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logSimPipelineEvent("admin_lab_run_source_home_past_sim_snapshot_failed", {
        correlationId: sourcePastCorrelationId,
        source: "gapfill_lab",
        action: "run_source_home_past_sim_snapshot",
        userId: user.id,
        sourceHouseId: selectedSourceHouse.id,
        phase: "pre_dispatch_failed",
        error: message,
      });
      return NextResponse.json(
        attachFailureContract({
          ok: false,
          error: "source_home_past_sim_snapshot_failed",
          message,
          correlationId: sourcePastCorrelationId,
        }),
        { status: 500 }
      );
    }

    if (!snapshot.ok) {
      logSimPipelineEvent("admin_lab_run_source_home_past_sim_snapshot_failed", {
        correlationId: sourcePastCorrelationId,
        source: "gapfill_lab",
        action: "run_source_home_past_sim_snapshot",
        userId: user.id,
        sourceHouseId: selectedSourceHouse.id,
        phase: snapshot.error === "no_past_scenario" ? "past_scenario_missing" : "snapshot_read_failed",
        error: snapshot.error,
        message: snapshot.message,
      });
      return NextResponse.json(
        attachFailureContract({
          ok: false,
          error: snapshot.error,
          message: snapshot.message,
          correlationId: sourcePastCorrelationId,
        }),
        { status: snapshot.error === "no_past_scenario" ? 400 : 500 }
      );
    }
    logSimPipelineEvent("admin_lab_run_source_home_past_sim_snapshot_completed", {
      correlationId: sourcePastCorrelationId,
      source: "gapfill_lab",
      action: "run_source_home_past_sim_snapshot",
      userId: user.id,
      sourceHouseId: selectedSourceHouse.id,
      scenarioId: snapshot.scenarioId,
      readExecutionMode: "not_run",
      baselineReadOk: snapshot.pastSimSnapshot?.reads?.baselineProjection?.ok ?? null,
      buildInputsHash: (snapshot.pastSimSnapshot as any)?.build?.buildInputsHash ?? null,
    });
    return NextResponse.json({
      ok: true,
      action: "run_source_home_past_sim_snapshot",
      sourceHouseId: snapshot.sourceHouseId,
      scenarioId: snapshot.scenarioId,
      correlationId: sourcePastCorrelationId,
      validationPolicyOwner: snapshot.validationPolicyOwner,
      pastSimSnapshot: snapshot.pastSimSnapshot,
    });
  }

  if (action) {
    if (!requestedCompareRunId) {
      return NextResponse.json(
        attachFailureContract({
          ok: false,
          error: "compare_run_id_required",
          message: "Snapshot reader action requires compareRunId.",
          reasonCode: "COMPARE_RUN_ID_REQUIRED",
          action,
        }),
        { status: 400 }
      );
    }
    const compareRunRead = await getGapfillCompareRunSnapshotById({
      compareRunId: requestedCompareRunId,
    });
    if (!compareRunRead.ok) {
      const notFound = compareRunRead.error === "compare_run_not_found";
      return NextResponse.json(
        attachFailureContract({
          ok: false,
          error: notFound ? "compare_run_not_found" : "compare_run_read_failed",
          message: compareRunRead.message,
          reasonCode: notFound ? "COMPARE_RUN_NOT_FOUND" : "COMPARE_RUN_READ_FAILED",
          action,
          compareRunId: requestedCompareRunId,
        }),
        { status: notFound ? 404 : 500 }
      );
    }
    const runRow = compareRunRead.row;
    if (runRow.userId && runRow.userId !== user.id) {
      return NextResponse.json(
        attachFailureContract({
          ok: false,
          error: "compare_run_not_found",
          message: "No compare-run snapshot record exists for the provided compareRunId.",
          reasonCode: "COMPARE_RUN_NOT_FOUND",
          action,
          compareRunId: requestedCompareRunId,
        }),
        { status: 404 }
      );
    }
    if (runRow.houseId && runRow.houseId !== house.id) {
      return NextResponse.json(
        attachFailureContract({
          ok: false,
          error: "compare_run_not_found",
          message: "No compare-run snapshot record exists for the provided compareRunId.",
          reasonCode: "COMPARE_RUN_NOT_FOUND",
          action,
          compareRunId: requestedCompareRunId,
        }),
        { status: 404 }
      );
    }
    if (action === "compare_run_poll") {
      return NextResponse.json({
        ok: true,
        action,
        failureCode: runRow.failureCode,
        failureMessage: runRow.failureMessage,
        phase: runRow.phase,
        ...buildSnapshotReaderBase({
          compareRunId: requestedCompareRunId,
          row: runRow,
        }),
        noRecompute: true,
      });
    }
    if (runRow.status === "failed") {
      return NextResponse.json(
        attachFailureContract({
          ok: false,
          error: "compare_run_failed",
          message: runRow.failureMessage ?? "Compare run failed before snapshot readers could serve data.",
          reasonCode: runRow.failureCode ?? "COMPARE_RUN_FAILED",
          action,
          ...buildSnapshotReaderBase({
            compareRunId: requestedCompareRunId,
            row: runRow,
          }),
        }),
        { status: 409 }
      );
    }
    if (!runRow.snapshotReady || !runRow.snapshotJson) {
      return NextResponse.json(
        attachFailureContract({
          ok: false,
          error: "compare_snapshot_not_ready",
          message: "Compare snapshot is not ready for staged heavy readers yet.",
          reasonCode: "COMPARE_SNAPSHOT_NOT_READY",
          action,
          ...buildSnapshotReaderBase({
            compareRunId: requestedCompareRunId,
            row: runRow,
          }),
        }),
        { status: 409 }
      );
    }

    const snapshot = runRow.snapshotJson;
    const base = buildSnapshotReaderBase({
      compareRunId: requestedCompareRunId,
      row: runRow,
    });
    console.info("[gapfill-lab][snapshot-reader]", {
      route: "admin_gapfill_lab",
      action,
      compareRunId: requestedCompareRunId,
      compareRunStatus: runRow.status,
      compareRunSnapshotReady: runRow.snapshotReady,
      snapshotSource: "GapfillCompareRunSnapshot.snapshotJson",
      noRecompute: true,
    });
    if (action === "compare_heavy_manifest") {
      const selectedScoredDateKeys = Array.isArray((snapshot as any)?.selectedScoredDateKeys)
        ? (snapshot as any).selectedScoredDateKeys
        : [];
      const scoredDayWeatherRows = Array.isArray((snapshot as any)?.scoredDayWeatherRows)
        ? (snapshot as any).scoredDayWeatherRows
        : [];
      const travelVacantParityRows = Array.isArray((snapshot as any)?.travelVacantParityRows)
        ? (snapshot as any).travelVacantParityRows
        : [];
      return NextResponse.json({
        ok: true,
        action,
        ...base,
        snapshotSource: "compare_run_snapshot",
        snapshotVersion: runRow.snapshotVersion,
        snapshotPersistedAt: runRow.snapshotPersistedAt,
        availableSections: {
          parity: travelVacantParityRows.length > 0 || (snapshot as any)?.travelVacantParityTruth != null,
          scoredDays:
            selectedScoredDateKeys.length > 0 ||
            Array.isArray((snapshot as any)?.scoredDayTruthRowsCompact),
          scoredDayWeather:
            scoredDayWeatherRows.length > 0 || (snapshot as any)?.scoredDayWeatherTruth != null,
          compactDiagnostics:
            (snapshot as any)?.missAttributionSummary != null ||
            (snapshot as any)?.accuracyTuningBreakdowns != null,
        },
        counts: (snapshot as any)?.counts ?? null,
        compareRequestTruth: (snapshot as any)?.compareRequestTruth ?? null,
        identityTruth: (snapshot as any)?.identityTruth ?? null,
        compareCoreTiming: (snapshot as any)?.compareCoreTiming ?? null,
        noRecompute: true,
      });
    }
    if (action === "compare_heavy_parity") {
      const travelVacantParityRows = Array.isArray((snapshot as any)?.travelVacantParityRows)
        ? (snapshot as any).travelVacantParityRows
        : [];
      const travelVacantParityTruth = (snapshot as any)?.travelVacantParityTruth ?? null;
      const compareTruth = (snapshot as any)?.compareTruth ?? null;
      const missAttributionSummary = (snapshot as any)?.missAttributionSummary ?? null;
      return NextResponse.json({
        ok: true,
        action,
        ...base,
        snapshotSource: "compare_run_snapshot",
        travelVacantParityRows,
        travelVacantParityTruth,
        compareTruth,
        missAttributionSummary,
        parity: {
          travelVacantParityRows,
          travelVacantParityTruth,
          compareTruth,
          identityTruth: (snapshot as any)?.identityTruth ?? null,
          compareCoreTiming: (snapshot as any)?.compareCoreTiming ?? null,
          counts: (snapshot as any)?.counts ?? null,
          missAttributionSummary,
        },
        noRecompute: true,
      });
    }
    const scoredDayTruthRowsCompact = Array.isArray((snapshot as any)?.scoredDayTruthRowsCompact)
      ? (snapshot as any).scoredDayTruthRowsCompact
      : [];
    const scoredDayWeatherRows = Array.isArray((snapshot as any)?.scoredDayWeatherRows)
      ? (snapshot as any).scoredDayWeatherRows
      : [];
    const scoredDayWeatherTruth = (snapshot as any)?.scoredDayWeatherTruth ?? null;
    return NextResponse.json({
      ok: true,
      action,
      ...base,
      snapshotSource: "compare_run_snapshot",
      scoredDayTruthRows: scoredDayTruthRowsCompact,
      scoredDayWeatherRows,
      scoredDayWeatherTruth,
      scoredDays: {
        selectedScoredDateKeys: Array.isArray((snapshot as any)?.selectedScoredDateKeys)
          ? (snapshot as any).selectedScoredDateKeys
          : [],
        scoredDayTruthRowsCompact,
        scoredDayWeatherRows,
        scoredDayWeatherTruth,
        metricsSummary: (snapshot as any)?.metricsSummary ?? null,
        compareCoreTiming: (snapshot as any)?.compareCoreTiming ?? null,
        counts: (snapshot as any)?.counts ?? null,
      },
      noRecompute: true,
    });
  }

  const { homeProfile, applianceProfile } = await loadDisplayProfilesForHouse({
    userId: user.id,
    houseId: house.id,
  });

  const esiid = house.esiid ? String(house.esiid) : null;
  const source = await chooseActualSource({ houseId: house.id, esiid });
  if (!source) {
    return NextResponse.json(
      attachFailureContract({
        ok: false,
        error: "no_actual_data",
        message: "No actual interval data (SMT or Green Button).",
      }),
      { status: 400 }
    );
  }

  const canonicalWindow = await getSharedPastCoverageWindowForHouse({
    userId: user.id,
    houseId: house.id,
  });
  const canonicalMonths = monthsEndingAt(canonicalWindow.endDate.slice(0, 7), 12);
  const canonicalWindowHelper = "resolveCanonicalUsage365CoverageWindow";
  let usage365: Usage365Payload | undefined = undefined;
  // Usage365 fetch is expensive; only load when explicitly requested.
  if (includeUsage365) {
    const sourceLabel = String((source as any)?.source ?? (source as any)?.kind ?? "actual");
    // Fast path: use lightweight actual dataset aggregation (no full-year interval fetch).
    let usageDatasetResult:
      | Awaited<ReturnType<typeof getActualUsageDatasetForHouse>>
      | null = null;
    try {
      usageDatasetResult = await getActualUsageDatasetForHouse(house.id, esiid, {
        skipFullYearIntervalFetch: true,
      });
    } catch {
      usageDatasetResult = null;
    }
    const usageDataset = usageDatasetResult?.dataset ?? null;
    if (usageDataset) {
      const boundedDaily = Array.isArray(usageDataset.daily)
        ? usageDataset.daily
            .filter((row) => {
              const dk = String((row as any)?.date ?? "").slice(0, 10);
              return dk >= canonicalWindow.startDate && dk <= canonicalWindow.endDate;
            })
            .map((row) => ({ date: String((row as any)?.date ?? "").slice(0, 10), kwh: Number((row as any)?.kwh) || 0 }))
        : [];
      const monthlyRows = Array.isArray(usageDataset.monthly)
        ? usageDataset.monthly.map((m) => ({
            month: String((m as any)?.month ?? "").slice(0, 7),
            kwh: Number((m as any)?.kwh) || 0,
          }))
        : [];
      const fifteenCurve = normalizeFifteenCurve96(
        (usageDataset as any)?.insights?.fifteenMinuteAverages
      );
      usage365 = {
        source: String((usageDataset as any)?.summary?.source ?? sourceLabel),
        timezone,
        coverageStart: canonicalWindow.startDate,
        coverageEnd: canonicalWindow.endDate,
        intervalCount: Number((usageDataset as any)?.summary?.intervalsCount ?? 0) || 0,
        daily: boundedDaily,
        monthly: monthlyRows,
        weekdayKwh: Number((usageDataset as any)?.insights?.weekdayVsWeekend?.weekday ?? 0) || 0,
        weekendKwh: Number((usageDataset as any)?.insights?.weekdayVsWeekend?.weekend ?? 0) || 0,
        fifteenCurve,
        stitchedMonth: ((usageDataset as any)?.insights?.stitchedMonth ?? null) as Usage365Payload["stitchedMonth"],
      };
    } else {
      // Fallback: legacy full-interval path.
      try {
        const intervalsForWindow = await getActualIntervalsForRange({
          houseId: house.id,
          esiid,
          startDate: canonicalWindow.startDate,
          endDate: canonicalWindow.endDate,
        });
        const boundedIntervalsForWindow = (intervalsForWindow ?? []).filter((row) => {
          const dk = dateKeyInTimezone(String(row?.timestamp ?? ""), timezone);
          return dk >= canonicalWindow.startDate && dk <= canonicalWindow.endDate;
        });
        usage365 = buildUsage365Payload({
          intervals: boundedIntervalsForWindow,
          timezone,
          source: sourceLabel,
          endDate: canonicalWindow.endDate,
        });
      } catch {
        usage365 = undefined;
      }
    }
    // Keep displayed window aligned to the same backend canonical window helper.
    if (usage365) {
      usage365.coverageStart = canonicalWindow.startDate;
      usage365.coverageEnd = canonicalWindow.endDate;
    }
  }

  const travelRangesFromDb = await getTravelRangesFromDb(user.id, house.id);
  const travelDateKeysLocal = new Set<string>(
    travelRangesFromDb.flatMap((r) => localDateKeysInRange(r.startDate, r.endDate, timezone))
  );

  if (testRanges.length === 0 && !testDaysRequested) {
    return NextResponse.json({
      ok: true,
      email: user.email,
      userId: user.id,
      house: {
        id: house.id,
        label: [house.addressLine1, house.addressCity, house.addressState].filter(Boolean).join(", ") || house.id,
      },
      houses: houses.map((h: any) => ({
        id: h.id,
        label: [h.addressLine1, h.addressCity, h.addressState].filter(Boolean).join(", ") || h.id,
      })),
      timezone,
      homeProfile,
      applianceProfile,
      modelAssumptions: null,
      testIntervalsCount: 0,
      message: "Add Test Dates (and ensure they do not overlap Vacant/Travel dates) and click Run Compare.",
      metrics: null,
      primaryPercentMetric: null,
      byMonth: [],
      byHour: [],
      byDayType: [],
      worstDays: [],
      diagnostics: null,
      pasteSummary: "",
      parity: null,
      travelRangesFromDb,
      usage365,
    });
  }

  // Test Dates = manual ranges or random selection. Vacant/Travel (DB) are always excluded from both training and test.
  const compareCoreTiming = startCompareCoreTiming();
  let testDateKeysLocal: Set<string> = new Set();
  let testRangesUsed: Array<{ startDate: string; endDate: string }> = [];
  let testSelectionMode: "manual_ranges" | "random_days" = "manual_ranges";
  let testDaysSelected: number = 0;
  let seedUsed: string | null = null;
  let candidateDaysAfterModeFilterCount: number | null = null;
  let candidateWindowStart: string | null = null;
  let candidateWindowEnd: string | null = null;
  let excludedFromTest_travelCount = 0;
  let candidateIntervalsForTesting: IntervalPoint[] | null = null;

  if (testDaysRequested != null) {
    const candidateEnd = canonicalWindow.endDate;
    const candidateStart = canonicalWindow.startDate;
    const coverageSelection = await getCandidateDateCoverageForSelection({
      houseId: house.id,
      scenarioIdentity: `shared_past:${canonicalMonths.join(",")}`,
      windowStart: candidateStart,
      windowEnd: candidateEnd,
      timezone,
      minDayCoveragePct,
      stratifyByMonth,
      stratifyByWeekend,
      loadIntervalsForWindow: async () => {
        const candidateIntervals = await getActualIntervalsForRange({
          houseId: house.id,
          esiid,
          startDate: candidateStart,
          endDate: candidateEnd,
        });
        candidateIntervalsForTesting = candidateIntervals ?? [];
        return candidateIntervalsForTesting;
      },
    });
    // On cache hits, loadIntervalsForWindow is not invoked; reuse cached intervals to avoid redundant fetch.
    candidateIntervalsForTesting = coverageSelection.intervalsForWindow ?? [];
    const candidateDateKeys = coverageSelection.candidateDateKeys;
    if (testMode === "random") {
      seedUsed = `${house.id}-${Date.now()}`;
    } else {
      seedUsed = seed || `${house.id}-${candidateEnd}`;
    }
    let candidatesForPick: string[] = candidateDateKeys;
    if (testMode === "winter" || testMode === "summer" || testMode === "shoulder") {
      candidatesForPick = filterCandidateDateKeysBySeason(candidateDateKeys, testMode);
      candidateDaysAfterModeFilterCount = candidatesForPick.length;
    } else if (testMode === "extreme_weather") {
      const houseWx = await prisma.houseAddress.findUnique({ where: { id: house.id }, select: { lat: true, lng: true } }).catch(() => null);
      const lat = houseWx?.lat != null && Number.isFinite(houseWx.lat) ? houseWx.lat : null;
      const lon = houseWx?.lng != null && Number.isFinite(houseWx.lng) ? houseWx.lng : null;
      if (lat == null || lon == null) {
        return NextResponse.json(
          attachFailureContract({
            ok: false,
            error: "extreme_weather_requires_coordinates",
            message: "testMode=extreme_weather requires house lat/lng. Add coordinates to the house address.",
          }),
          { status: 400 }
        );
      }
      const wxResult = await getWeatherForRange(lat, lon, candidateStart, candidateEnd);
      const hourly = Array.isArray(wxResult?.rows) ? wxResult.rows : [];
      const weatherByDateKey = buildDailyWeatherFeaturesFromHourly(hourly, undefined, undefined, timezone);
      const { picked: pickedExtreme, candidateDaysAfterModeFilterCount: extremeCount } = pickExtremeWeatherTestDateKeys({
        candidateDateKeys,
        travelDateKeysSet: travelDateKeysLocal,
        weatherByDateKey,
        testDays: testDaysRequested,
        seed: seedUsed!,
        stratifyByMonth,
        stratifyByWeekend,
        isWeekendLocalKey: (dk) => {
          const dow = getLocalDayOfWeekFromDateKey(dk, timezone);
          return dow === 0 || dow === 6;
        },
        monthKeyFromLocalKey: (dk) => dk.slice(0, 7),
      });
      testRangesUsed = mergeDateKeysToRanges(pickedExtreme);
      testDateKeysLocal = new Set(pickedExtreme);
      candidateDaysAfterModeFilterCount = extremeCount;
      testDaysSelected = pickedExtreme.length;
      testSelectionMode = "random_days";
      candidateWindowStart = candidateStart;
      candidateWindowEnd = candidateEnd;
      excludedFromTest_travelCount = Array.from(travelDateKeysLocal).filter(
        (dk) => dk >= candidateStart && dk <= candidateEnd
      ).length;
    } else {
      candidateDaysAfterModeFilterCount = candidateDateKeys.length;
    }
    if (testMode !== "extreme_weather") {
    const picked = pickRandomTestDateKeys({
      candidateDateKeys: candidatesForPick,
      travelDateKeysSet: travelDateKeysLocal,
      testDays: testDaysRequested,
      seed: seedUsed!,
      stratifyByMonth,
      stratifyByWeekend,
      isWeekendLocalKey: (dk) => {
        const dow = getLocalDayOfWeekFromDateKey(dk, timezone);
        return dow === 0 || dow === 6;
      },
      monthKeyFromLocalKey: (dk) => dk.slice(0, 7),
    });
    testRangesUsed = mergeDateKeysToRanges(picked);
    testDateKeysLocal = new Set(picked);
    testDaysSelected = picked.length;
    testSelectionMode = "random_days";
    candidateWindowStart = candidateStart;
    candidateWindowEnd = candidateEnd;
    excludedFromTest_travelCount = Array.from(travelDateKeysLocal).filter(
      (dk) => dk >= candidateStart && dk <= candidateEnd
    ).length;
    }
  } else {
    testDateKeysLocal = new Set<string>(
      testRanges.flatMap((r) => localDateKeysInRange(r.startDate, r.endDate, timezone))
    );
    testRangesUsed = testRanges;
    testSelectionMode = "manual_ranges";
    testDaysSelected = testDateKeysLocal.size;
  }
  markCompareCoreStep(compareCoreTiming, "select_test_days");
  markCompareCoreStep(compareCoreTiming, "map_selected_ranges_to_intervals");

  if (testDateKeysLocal.size === 0) {
    return NextResponse.json(
      attachFailureContract({
        ok: false,
        error: "test_ranges_required",
        message: "At least one valid Test Date range is required (or use Random Test Days).",
        compareCoreTiming: finalizeCompareCoreTiming(compareCoreTiming),
      }),
      { status: 400 }
    );
  }

  const guardrailExcludedDateKeysLocal = new Set<string>([...Array.from(travelDateKeysLocal), ...Array.from(testDateKeysLocal)]);
  const overlapLocal = setIntersect(travelDateKeysLocal, testDateKeysLocal);
  if (overlapLocal.size > 0) {
    return NextResponse.json(
      attachFailureContract({
        ok: false,
        error: "test_overlaps_travel",
        message: "Test Dates overlap saved Vacant/Travel dates. Remove overlap and retry.",
        overlapCount: overlapLocal.size,
        overlapSample: sortedSample(overlapLocal),
        testDateKeysCount: testDateKeysLocal.size,
        travelDateKeysCount: travelDateKeysLocal.size,
        compareCoreTiming: finalizeCompareCoreTiming(compareCoreTiming),
      }),
      { status: 400 }
    );
  }

  // Canonical path: Gap-Fill scoring reads the shared Past artifact/service output only.
  const rebuildArtifact = body?.rebuildArtifact === true;
  const rebuildOnly = body?.rebuildOnly === true;
  if (rebuildArtifact && rebuildOnly) {
    const pastScenarioForRebuildOnly = await (prisma as any).usageSimulatorScenario
      .findFirst({
        where: {
          userId: user.id,
          houseId: house.id,
          name: "Past (Corrected)",
          archivedAt: null,
        },
        select: { id: true },
      })
      .catch(() => null);
    if (!pastScenarioForRebuildOnly?.id) {
      return NextResponse.json(
        attachFailureContract({
          ok: false,
          error: "no_past_scenario",
          message: "No Past (Corrected) scenario found for this house.",
        }),
        { status: 404 }
      );
    }
    let rebuilt: Awaited<ReturnType<typeof getSimulatedUsageForHouseScenario>>;
    try {
      rebuilt = await withTimeout(
        getSimulatedUsageForHouseScenario({
          userId: user.id,
          houseId: house.id,
          scenarioId: String(pastScenarioForRebuildOnly.id),
          forceRebuildArtifact: true,
          readMode: "allow_rebuild",
          projectionMode: "raw",
          readContext: {
            artifactReadMode: "allow_rebuild",
            projectionMode: "raw",
            compareSidecarRequest: false,
          },
        }),
        ROUTE_REBUILD_SHARED_TIMEOUT_MS,
        "artifact_ensure_route_timeout_rebuild_shared_artifact"
      );
    } catch (err: unknown) {
      const normalizedError = normalizeRouteError(
        err,
        "Artifact ensure failed while rebuilding shared Past artifact."
      );
      const timedOut = normalizedError.code === "artifact_ensure_route_timeout_rebuild_shared_artifact";
      return NextResponse.json(
        attachFailureContract({
          ok: false,
          error: timedOut ? "artifact_ensure_route_timeout" : "artifact_ensure_route_exception",
          message: timedOut
            ? "Artifact ensure timed out while rebuilding shared Past artifact."
            : normalizedError.message,
          missingData: timedOut ? ["getSimulatedUsageForHouseScenario(forceRebuildArtifact=true)"] : undefined,
          reasonCode: timedOut
            ? "ARTIFACT_ENSURE_ROUTE_TIMEOUT"
            : "ARTIFACT_ENSURE_ROUTE_EXCEPTION",
          timeoutMs: timedOut ? ROUTE_REBUILD_SHARED_TIMEOUT_MS : undefined,
        }),
        { status: timedOut ? 504 : 500 }
      );
    }
    if (!rebuilt.ok) {
      const classification = classifySimulationFailure({
        code: String((rebuilt as any)?.code ?? ""),
        message: String((rebuilt as any)?.message ?? ""),
      });
      return NextResponse.json(
        attachFailureContract({
          ok: false,
          error: String((rebuilt as any)?.code ?? "past_rebuild_failed"),
          message: String((rebuilt as any)?.message ?? "Failed to rebuild shared Past artifact."),
          explanation: classification.userFacingExplanation,
          missingData: classification.missingData,
          reasonCode: classification.reasonCode,
        }),
        { status: 500 }
      );
    }
    const rebuiltMeta = (((rebuilt as any)?.dataset?.meta ?? {}) as Record<string, unknown>) ?? {};
    return NextResponse.json({
      ok: true,
      email: user.email,
      userId: user.id,
      house: {
        id: house.id,
        label: [house.addressLine1, house.addressCity, house.addressState].filter(Boolean).join(", ") || house.id,
      },
      houses: houses.map((h: any) => ({
        id: h.id,
        label: [h.addressLine1, h.addressCity, h.addressState].filter(Boolean).join(", ") || h.id,
      })),
      timezone,
      mode: "artifact_only",
      action: "rebuild_only",
      rebuilt: true,
      scenarioId: rebuilt.scenarioId,
      artifactScenarioId: rebuilt.scenarioId ?? pastScenarioForRebuildOnly.id,
      requestedInputHash: rebuiltMeta.requestedInputHash ?? null,
      artifactInputHashUsed: rebuiltMeta.artifactInputHashUsed ?? rebuiltMeta.artifactInputHash ?? null,
      artifactHashMatch: rebuiltMeta.artifactHashMatch ?? null,
      artifactSourceMode: rebuiltMeta.artifactSourceMode ?? null,
      artifactSourceNote: rebuiltMeta.artifactSourceNote ?? null,
      message: "Shared Past artifact rebuilt via shared simulator path. Running compare next will score selected test days from shared artifact output.",
      testRangesUsed,
      testSelectionMode,
      testDaysRequested,
      testDaysSelected,
      seedUsed,
      travelRangesFromDb,
    });
  }

  const pipelineState: GapfillComparePipelineState = {
    compareRequestTruthForLifecycle: null,
    artifactRequestTruthForLifecycle: null,
    compareCoreTimingForLifecycle: compareCoreTiming,
  };
  const pipelineOut: GapfillCompareRunOut = {
    compareRunId,
    compareRunStatus,
    compareRunSnapshotReady,
    compareRunTerminalState,
  };
  const pipelineResponse = await runGapfillCompareCorePipeline({
    abortSignal: req.signal,
    state: pipelineState,
    out: pipelineOut,
    user,
    house: house as Record<string, unknown> & {
      id: string;
      addressLine1?: string | null;
      addressCity?: string | null;
      addressState?: string | null;
      esiid?: string | null;
    },
    houses: houses as Array<Record<string, unknown>>,
    esiid,
    timezone,
    canonicalWindow,
    canonicalMonths,
    canonicalWindowHelper,
    homeProfile,
    applianceProfile,
    testDateKeysLocal,
    candidateIntervalsForTesting,
    testRanges,
    testRangesUsed,
    testSelectionMode,
    testDaysRequested,
    testDaysSelected,
    seedUsed,
    testMode,
    candidateDaysAfterModeFilterCount,
    candidateWindowStart,
    candidateWindowEnd,
    excludedFromTest_travelCount,
    travelRangesFromDb,
    travelDateKeysLocal,
    guardrailExcludedDateKeysLocal,
    overlapLocal,
    compareCoreTiming,
    includeDiagnostics,
    includeUserPipelineParity,
    includeFullReportText,
    rebuildArtifact,
    requestedArtifactInputHash,
    requestedArtifactScenarioId,
    requireExactArtifactMatch,
    artifactIdentitySource,
    heavyOnlyCompactResponse,
    requestedCompareRunId,
    minDayCoveragePct,
    usage365,
  });
  compareRunId = pipelineOut.compareRunId;
  compareRunStatus = pipelineOut.compareRunStatus;
  compareRunSnapshotReady = pipelineOut.compareRunSnapshotReady;
  compareRunTerminalState = pipelineOut.compareRunTerminalState;
  compareRequestTruthForLifecycle = pipelineState.compareRequestTruthForLifecycle;
  artifactRequestTruthForLifecycle = pipelineState.artifactRequestTruthForLifecycle;
  compareCoreTimingForLifecycle = pipelineState.compareCoreTimingForLifecycle;
  return pipelineResponse;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[gapfill-lab]", message, err);
    if (compareRunId && !compareRunTerminalState) {
      await markGapfillCompareRunFailed({
        compareRunId,
        phase: "compare_core_uncaught_exception",
        failureCode: "COMPARE_CORE_UNCAUGHT_EXCEPTION_AFTER_RUN_START",
        failureMessage: message,
        statusMeta: {
          route: "admin_gapfill_lab",
          compareRunId,
          compareRunSnapshotReady: false,
          compareRequestTruth: compareRequestTruthForLifecycle,
          artifactRequestTruth: artifactRequestTruthForLifecycle,
          compareCoreTiming:
            compareCoreTimingForLifecycle != null
              ? finalizeCompareCoreTiming(compareCoreTimingForLifecycle, {
                  failedStep: "build_shared_compare",
                  compareRequestTruth: compareRequestTruthForLifecycle ?? undefined,
                })
              : null,
        },
      });
      compareRunStatus = "failed";
      compareRunSnapshotReady = false;
      compareRunTerminalState = true;
      console.error("[gapfill-lab][compare-run]", {
        route: "admin_gapfill_lab",
        event: "compare_run_failed_uncaught",
        compareRunId,
        compareRunStatus,
        compareRunSnapshotReady,
        detail: message,
      });
    }
    return NextResponse.json(
      attachFailureContract({
        ok: false,
        error: "server_error",
        message: "The request took too long or failed. Try a shorter date range or try again.",
        detail: process.env.NODE_ENV === "development" ? message : undefined,
        ...(compareRunId
          ? {
              compareRunId,
              compareRunStatus,
              compareRunSnapshotReady,
            }
          : {}),
      }),
      { status: 500 }
    );
  }
}