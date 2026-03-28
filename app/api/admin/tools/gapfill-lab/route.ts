import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { prisma } from "@/lib/db";
import { homeDetailsPrisma } from "@/lib/db/homeDetailsClient";
import { appliancesPrisma } from "@/lib/db/appliancesClient";
import { normalizeEmailSafe } from "@/lib/utils/email";
import { getActualIntervalsForRange, getActualUsageDatasetForHouse } from "@/lib/usage/actualDatasetForHouse";
import { chooseActualSource } from "@/modules/realUsageAdapter/actual";
import {
  buildDailyWeatherFeaturesFromHourly,
  canonicalIntervalKey,
  computeGapFillMetrics,
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
import { buildValidationCompareProjectionSidecar } from "@/modules/usageSimulator/compareProjection";
import { getWeatherForRange } from "@/lib/sim/weatherProvider";
import { SOURCE_OF_DAY_SIMULATION_CORE } from "@/modules/simulatedUsage/pastDaySimulator";
import { loadDisplayProfilesForHouse } from "@/modules/usageSimulator/profileDisplay";
import { validateHomeProfile } from "@/modules/homeProfile/validation";
import { validateApplianceProfile, normalizeStoredApplianceProfile } from "@/modules/applianceProfile/validation";
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
  rebuildGapfillSharedPastArtifact,
} from "@/modules/usageSimulator/service";
import {
  createGapfillCompareRunStart,
  finalizeGapfillCompareRunSnapshot,
  getGapfillCompareRunSnapshotById,
  markGapfillCompareRunFailed,
  markGapfillCompareRunRunning,
} from "@/modules/usageSimulator/compareRunSnapshot";
import {
  ensureGlobalLabTestHomeHouse,
  getLabTestHomeLink,
  replaceGlobalLabTestHomeFromSource,
} from "@/modules/usageSimulator/labTestHome";
import { IntervalSeriesKind } from "@/modules/usageSimulator/kinds";
import {
  classifySimulationFailure,
  recordSimulationDataAlert,
} from "@/modules/usageSimulator/simulationDataAlerts";
import { monthsEndingAt } from "@/lib/time/chicago";
import { buildDisplayMonthlyFromIntervalsUtc } from "@/modules/usageSimulator/dataset";
import { buildGapfillCompareQueuedPayloadV1 } from "@/modules/usageSimulator/gapfillCompareQueuedPayload";
import {
  getGapfillCompareEnqueueDiagnostics,
  shouldEnqueueGapfillCompareRemote,
  triggerDropletSimWebhook,
  type DropletSimWebhookResult,
} from "@/modules/usageSimulator/dropletSimWebhook";
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


export const dynamic = "force-dynamic";
// Vercel serverless ceiling (seconds). Keep tight: OOM/thrash can otherwise run many minutes before the
// platform kills the instance; shorter wall-clock returns a 504/classified timeout sooner on bad runs.
// Sum(shared compare + report) must stay under this with margin.
export const maxDuration = 120;
// Cooperative abort for rebuild/compare; keep sum(shared + report) under maxDuration with margin.
const ROUTE_REBUILD_SHARED_TIMEOUT_MS = 75_000;

const ADMIN_EMAILS = ["brian@intelliwatt.com", "brian@intellipath-solutions.com"];
const VALIDATION_SELECTION_MODES = [
  ...VALIDATION_DAY_SELECTION_MODES,
] as const;

function hasAdminSessionCookie(request: NextRequest): boolean {
  const raw = request.cookies.get("intelliwatt_admin")?.value ?? "";
  const email = normalizeEmailSafe(raw);
  if (!email) return false;
  return ADMIN_EMAILS.includes(email);
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

async function triggerGapfillCompareDropletWebhook(
  compareRunId: string
): Promise<DropletSimWebhookResult> {
  return triggerDropletSimWebhook({
    reason: "gapfill_compare",
    compareRunId,
  });
}

function gateGapfillLabAdmin(req: NextRequest): NextResponse | null {
  if (!hasAdminSessionCookie(req)) {
    const gate = requireAdmin(req);
    if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });
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
      { ok: false, error: "invalid_query", message: "Use ?diagnostics=enqueue" },
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
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
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
    return NextResponse.json({ ok: false, error: "email_required" }, { status: 400 });
  }

  const timezone = String(body?.timezone ?? "America/Chicago").trim() || "America/Chicago";
  if (!isValidIanaTimezone(timezone)) {
    return NextResponse.json(
      { ok: false, error: "invalid_timezone", message: "Timezone must be a valid IANA timezone." },
      { status: 400 }
    );
  }
  const includeUsage365 = body?.includeUsage365 === true;
  const includeDiagnostics = body?.includeDiagnostics === true;
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

  const VALID_WEATHER_KINDS = ["ACTUAL_LAST_YEAR", "NORMAL_AVG", "open_meteo"] as const;
  type WeatherKindParam = (typeof VALID_WEATHER_KINDS)[number];
  const rawWeatherKind = String(body?.weatherKind ?? "open_meteo").trim();
  const weatherKind: WeatherKindParam = VALID_WEATHER_KINDS.includes(rawWeatherKind as WeatherKindParam) ? (rawWeatherKind as WeatherKindParam) : "open_meteo";

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
    return NextResponse.json({ ok: false, error: "user_not_found", message: "No user with that email." }, { status: 404 });
  }

  const houses = await (prisma as any).houseAddress.findMany({
    where: { userId: user.id, archivedAt: null },
    orderBy: { updatedAt: "desc" },
    select: { id: true, esiid: true, addressLine1: true, addressCity: true, addressState: true, addressZip5: true, createdAt: true },
  });

  if (!houses?.length) {
    return NextResponse.json({ ok: false, error: "no_houses", message: "User has no houses." }, { status: 404 });
  }

  const houseIdParam = typeof body?.houseId === "string" ? body.houseId.trim() : "";
  let house = houseIdParam
    ? houses.find((h: any) => h.id === houseIdParam)
    : houses[0];
  if (!house) {
    return NextResponse.json({ ok: false, error: "house_not_found", message: "House not found or not owned by user." }, { status: 404 });
  }

  const isCanonicalLabAction =
    rawAction === "lookup_source_houses" ||
    rawAction === "get_validation_selection_settings" ||
    rawAction === "set_user_default_validation_selection_mode" ||
    rawAction === "replace_test_home_from_source" ||
    rawAction === "save_test_home_inputs" ||
    rawAction === "run_test_home_canonical_recalc";
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
        {
          ok: false,
          error: "invalid_validation_selection_mode",
          message: "Provide a valid userDefaultValidationSelectionMode.",
          supportedModes: VALIDATION_SELECTION_MODES,
        },
        { status: 400 }
      );
    }
    const write = await setUserDefaultValidationSelectionMode(requestedUserDefaultValidationMode);
    if (!write.ok) {
      return NextResponse.json(
        { ok: false, error: write.error, message: "Could not save system-wide user-facing validation-day mode." },
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
    const userDefaultValidationSelectionMode = await getUserDefaultValidationSelectionMode();
    return NextResponse.json({
      ok: true,
      action: "lookup_source_houses",
      sourceUser: { id: user.id, email: user.email },
      sourceHouses: houses.map((h: any) => ({
        id: h.id,
        esiid: h.esiid ? String(h.esiid) : null,
        label: [h.addressLine1, h.addressCity, h.addressState].filter(Boolean).join(", ") || h.id,
      })),
      selectedSourceHouseId: sourceHouseIdParam,
      testHomeLink: link,
      userDefaultValidationSelectionMode,
      adminLabDefaultValidationSelectionMode: getAdminLabDefaultValidationSelectionMode(),
      supportedValidationSelectionModes: VALIDATION_SELECTION_MODES,
    });
  }

  if (rawAction === "replace_test_home_from_source") {
    if (!labOwnerUserId) {
      return NextResponse.json({ ok: false, error: "lab_owner_not_found" }, { status: 400 });
    }
    const selectedSourceHouse = houses.find((h: any) => String(h.id) === sourceHouseIdParam);
    if (!selectedSourceHouse) {
      return NextResponse.json({ ok: false, error: "source_house_not_found" }, { status: 404 });
    }
    const replaced = await replaceGlobalLabTestHomeFromSource({
      ownerUserId: labOwnerUserId,
      sourceUserId: user.id,
      sourceHouseId: sourceHouseIdParam,
    });
    if (!replaced.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: replaced.error ?? "replace_test_home_failed",
          message:
            replaced.message ??
            "Test-home replace failed before post-load snapshot.",
        },
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
      const testHomeTravelRanges = await getTravelRangesFromDb(labOwnerUserId, String(replaced.testHomeHouseId));
      const sourceTravelRanges = await getTravelRangesFromDb(user.id, sourceHouseIdParam);
      const effectiveTravelRanges =
        testHomeTravelRanges.length > 0
          ? testHomeTravelRanges
          : sourceTravelRanges;
      const link = await getLabTestHomeLink(labOwnerUserId);
      return NextResponse.json({
        ok: true,
        action: "replace_test_home_from_source",
        sourceUser: { id: user.id, email: user.email },
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
              label: [testHome.addressLine1, testHome.addressCity, testHome.addressState].filter(Boolean).join(", ") || testHome.id,
              identityLabel: testHome.label ?? null,
            }
          : null,
        homeProfile: testHomeProfiles.homeProfile,
        applianceProfile: testHomeProfiles.applianceProfile,
        travelRangesFromDb: effectiveTravelRanges,
        travelRangesSource:
          testHomeTravelRanges.length > 0 ? "test_home" : "source_house_fallback",
        testHomeLink: link,
      });
    } catch (postLoadError: unknown) {
      return NextResponse.json(
        {
          ok: false,
          error: "replace_test_home_postload_failed",
          message:
            postLoadError instanceof Error
              ? postLoadError.message
              : "Test-home replacement succeeded but post-load snapshot failed.",
          sourceHouseId: sourceHouseIdParam,
          testHomeHouseId: replaced.testHomeHouseId ?? null,
        },
        { status: 500 }
      );
    }
  }

  if (rawAction === "save_test_home_inputs") {
    if (!labOwnerUserId) {
      return NextResponse.json({ ok: false, error: "lab_owner_not_found" }, { status: 400 });
    }
    const link = await getLabTestHomeLink(labOwnerUserId);
    if (!link?.testHomeHouseId) {
      return NextResponse.json({ ok: false, error: "test_home_not_ready", message: "Load/replace test home first." }, { status: 409 });
    }
    if (link.status !== "ready") {
      return NextResponse.json(
        {
          ok: false,
          error: "test_home_replace_incomplete",
          message: "Test home replacement is still in progress.",
          testHomeLink: link,
        },
        { status: 409 }
      );
    }

    if (body?.homeProfile != null) {
      const homeValidated = validateHomeProfile(normalizeLabHomeProfileInput(body.homeProfile), { requirePastBaselineFields: true });
      if (!homeValidated.ok) {
        return NextResponse.json({ ok: false, error: "invalid_home_profile", detail: homeValidated.error }, { status: 400 });
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
        return NextResponse.json({ ok: false, error: "invalid_appliance_profile", detail: applianceValidated.error }, { status: 400 });
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
      const ranges = body.travelRanges
        .map((r: any) => ({
          startDate: String(r?.startDate ?? "").slice(0, 10),
          endDate: String(r?.endDate ?? "").slice(0, 10),
        }))
        .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.startDate) && /^\d{4}-\d{2}-\d{2}$/.test(r.endDate));
      await (prisma as any).$transaction(async (tx: any) => {
        let pastScenario = await tx.usageSimulatorScenario.findFirst({
          where: {
            userId: labOwnerUserId,
            houseId: link.testHomeHouseId,
            name: "Past (Corrected)",
            archivedAt: null,
          },
          select: { id: true },
        });
        if (!pastScenario?.id) {
          pastScenario = await tx.usageSimulatorScenario.create({
            data: {
              userId: labOwnerUserId,
              houseId: link.testHomeHouseId,
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

    const refreshedProfiles = await loadDisplayProfilesForHouse({
      userId: labOwnerUserId,
      houseId: link.testHomeHouseId,
    });
    const refreshedTravel = await getTravelRangesFromDb(labOwnerUserId, link.testHomeHouseId);
    return NextResponse.json({
      ok: true,
      action: "save_test_home_inputs",
      testHomeHouseId: link.testHomeHouseId,
      homeProfile: refreshedProfiles.homeProfile,
      applianceProfile: refreshedProfiles.applianceProfile,
      travelRangesFromDb: refreshedTravel,
      message: "Saved canonical test-home inputs. Recalc to refresh outputs.",
    });
  }

  if (rawAction === "run_test_home_canonical_recalc") {
    if (!labOwnerUserId) {
      return NextResponse.json({ ok: false, error: "lab_owner_not_found" }, { status: 400 });
    }
    const link = await getLabTestHomeLink(labOwnerUserId);
    if (!link?.testHomeHouseId || !link.sourceHouseId || !link.sourceUserId || link.status !== "ready") {
      return NextResponse.json(
        {
          ok: false,
          error: "test_home_not_ready",
          message: "Load/replace test home first and wait for ready state.",
          testHomeLink: link ?? null,
        },
        { status: 409 }
      );
    }
    const [labOwnerUser, testHomeHouse, sourceHouse] = await Promise.all([
      prisma.user.findUnique({ where: { id: labOwnerUserId }, select: { id: true, email: true } }),
      (prisma as any).houseAddress.findUnique({
        where: { id: link.testHomeHouseId },
        select: { id: true, addressLine1: true, addressCity: true, addressState: true, esiid: true },
      }),
      (prisma as any).houseAddress.findUnique({
        where: { id: link.sourceHouseId },
        select: { id: true, userId: true, addressLine1: true, addressCity: true, addressState: true, esiid: true },
      }),
    ]);
    if (!labOwnerUser?.id || !testHomeHouse?.id || !sourceHouse?.id) {
      return NextResponse.json({ ok: false, error: "test_home_context_not_found" }, { status: 404 });
    }

    const { homeProfile, applianceProfile } = await loadDisplayProfilesForHouse({
      userId: labOwnerUser.id,
      houseId: testHomeHouse.id,
    });

    const sourceEsiid = sourceHouse.esiid ? String(sourceHouse.esiid) : null;
    const source = await chooseActualSource({ houseId: sourceHouse.id, esiid: sourceEsiid });
    if (!source) {
      return NextResponse.json(
        { ok: false, error: "no_actual_data", message: "No actual interval data (SMT or Green Button) on source house." },
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

    const travelRangesFromDb = await getTravelRangesFromDb(labOwnerUser.id, testHomeHouse.id);
    const travelDateKeysLocal = new Set<string>(
      travelRangesFromDb.flatMap((r) => localDateKeysInRange(r.startDate, r.endDate, timezone))
    );

    const selectedTestRanges = testRanges;
    const targetValidationDayCount = testDaysRequested != null ? testDaysRequested : 21;
    const seedUsed = seed || `${sourceHouse.id}-${canonicalWindow.endDate}`;
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
    const selectedValidation = selectValidationDayKeys({
      mode: requestedMode,
      targetCount: targetValidationDayCount,
      candidateDateKeys: coverageSelection.candidateDateKeys,
      travelDateKeysSet: travelDateKeysLocal,
      timezone,
      seed: seedUsed,
      manualDateKeys,
    });
    const testDateKeysLocal = new Set(selectedValidation.selectedDateKeys);
    const testRangesUsed = mergeDateKeysToRanges(selectedValidation.selectedDateKeys);
    const testSelectionMode = requestedMode;
    const testDaysSelected = selectedValidation.selectedDateKeys.length;
    const selectionDiagnostics = selectedValidation.diagnostics;
    if (testDateKeysLocal.size === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "test_ranges_required",
          message: "At least one valid test-day range is required.",
        },
        { status: 400 }
      );
    }
    const overlapLocal = setIntersect(travelDateKeysLocal, testDateKeysLocal);
    if (overlapLocal.size > 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "test_overlaps_travel",
          message: "Test dates overlap saved vacant/travel dates.",
          overlapCount: overlapLocal.size,
        },
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
        { ok: false, error: "no_past_scenario", message: "No Past (Corrected) scenario found on test home." },
        { status: 400 }
      );
    }

    const recalcOut = await recalcSimulatorBuild({
      userId: labOwnerUser.id,
      houseId: testHomeHouse.id,
      esiid: sourceEsiid,
      actualContextHouseId: sourceHouse.id,
      mode: "SMT_BASELINE",
      scenarioId: String(pastScenario.id),
      persistPastSimBaseline: true,
      validationOnlyDateKeysLocal: testDateKeysLocal,
      validationDaySelectionMode: testSelectionMode,
      validationDayCount: targetValidationDayCount,
    });
    if (!recalcOut.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: "canonical_recalc_failed",
          message: String(recalcOut.error ?? "Canonical recalc failed."),
        },
        { status: 500 }
      );
    }

    const [canonicalRead, baselineRead] = await Promise.all([
      getSimulatedUsageForHouseScenario({
        userId: labOwnerUser.id,
        houseId: testHomeHouse.id,
        scenarioId: String(pastScenario.id),
        readMode: "allow_rebuild",
        projectionMode: "raw",
      }),
      getSimulatedUsageForHouseScenario({
        userId: labOwnerUser.id,
        houseId: testHomeHouse.id,
        scenarioId: String(pastScenario.id),
        readMode: "allow_rebuild",
        projectionMode: "baseline",
      }),
    ]);
    if (!canonicalRead.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: "canonical_read_failed",
          message: canonicalRead.message ?? "Canonical read failed.",
        },
        { status: 500 }
      );
    }

    const canonicalDataset = canonicalRead.dataset as any;
    const baselineDataset = baselineRead.ok ? (baselineRead.dataset as any) : canonicalDataset;
    const selectedDateKeysSorted = Array.from(testDateKeysLocal).sort();
    // Shared compare sidecar remains the canonical modeled-vs-actual projection family.
    const compareProjection = buildValidationCompareProjectionSidecar(canonicalDataset);
    const scoredDayTruthRows = selectedDateKeysSorted.map((dk) => {
      const row = Array.isArray(compareProjection.rows)
        ? compareProjection.rows.find((r) => String(r?.localDate ?? "").slice(0, 10) === dk)
        : null;
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
    const compareMetrics = (compareProjection.metrics && typeof compareProjection.metrics === "object")
      ? compareProjection.metrics as Record<string, unknown>
      : {};

    return NextResponse.json({
      ok: true,
      action: "run_test_home_canonical_recalc",
      mode: "canonical_test_home_lab",
      email: user.email,
      sourceUserId: user.id,
      sourceHouse: {
        id: sourceHouse.id,
        label: [sourceHouse.addressLine1, sourceHouse.addressCity, sourceHouse.addressState].filter(Boolean).join(", ") || sourceHouse.id,
      },
      testHome: {
        id: testHomeHouse.id,
        label: [testHomeHouse.addressLine1, testHomeHouse.addressCity, testHomeHouse.addressState].filter(Boolean).join(", ") || testHomeHouse.id,
      },
      timezone,
      homeProfile,
      applianceProfile,
      weatherKind,
      canonicalWindow: {
        startDate: canonicalWindow.startDate,
        endDate: canonicalWindow.endDate,
        helper: canonicalWindowHelper,
      },
      travelRangesFromDb,
      testRangesUsed,
      testSelectionMode,
      testDaysRequested,
      testDaysSelected,
      seedUsed,
      selectionDiagnostics,
      usage365,
      baselineDatasetProjection: baselineDataset,
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
      modelAssumptions: {
        canonicalReadFamily: "getSimulatedUsageForHouseScenario->/api/user/usage/simulated/house",
        projectionMode: "baseline_vs_accuracy",
        validationOnlyDateKeysLocal: selectedDateKeysSorted,
        actualContextHouseId: sourceHouse.id,
        userDefaultValidationSelectionMode: await getUserDefaultValidationSelectionMode(),
        adminLabValidationSelectionMode: testSelectionMode,
      },
    });
  }

  if (action) {
    if (!requestedCompareRunId) {
      return NextResponse.json(
        {
          ok: false,
          error: "compare_run_id_required",
          message: "Snapshot reader action requires compareRunId.",
          reasonCode: "COMPARE_RUN_ID_REQUIRED",
          action,
        },
        { status: 400 }
      );
    }
    const compareRunRead = await getGapfillCompareRunSnapshotById({
      compareRunId: requestedCompareRunId,
    });
    if (!compareRunRead.ok) {
      const notFound = compareRunRead.error === "compare_run_not_found";
      return NextResponse.json(
        {
          ok: false,
          error: notFound ? "compare_run_not_found" : "compare_run_read_failed",
          message: compareRunRead.message,
          reasonCode: notFound ? "COMPARE_RUN_NOT_FOUND" : "COMPARE_RUN_READ_FAILED",
          action,
          compareRunId: requestedCompareRunId,
        },
        { status: notFound ? 404 : 500 }
      );
    }
    const runRow = compareRunRead.row;
    if (runRow.userId && runRow.userId !== user.id) {
      return NextResponse.json(
        {
          ok: false,
          error: "compare_run_not_found",
          message: "No compare-run snapshot record exists for the provided compareRunId.",
          reasonCode: "COMPARE_RUN_NOT_FOUND",
          action,
          compareRunId: requestedCompareRunId,
        },
        { status: 404 }
      );
    }
    if (runRow.houseId && runRow.houseId !== house.id) {
      return NextResponse.json(
        {
          ok: false,
          error: "compare_run_not_found",
          message: "No compare-run snapshot record exists for the provided compareRunId.",
          reasonCode: "COMPARE_RUN_NOT_FOUND",
          action,
          compareRunId: requestedCompareRunId,
        },
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
        {
          ok: false,
          error: "compare_run_failed",
          message: runRow.failureMessage ?? "Compare run failed before snapshot readers could serve data.",
          reasonCode: runRow.failureCode ?? "COMPARE_RUN_FAILED",
          action,
          ...buildSnapshotReaderBase({
            compareRunId: requestedCompareRunId,
            row: runRow,
          }),
        },
        { status: 409 }
      );
    }
    if (!runRow.snapshotReady || !runRow.snapshotJson) {
      return NextResponse.json(
        {
          ok: false,
          error: "compare_snapshot_not_ready",
          message: "Compare snapshot is not ready for staged heavy readers yet.",
          reasonCode: "COMPARE_SNAPSHOT_NOT_READY",
          action,
          ...buildSnapshotReaderBase({
            compareRunId: requestedCompareRunId,
            row: runRow,
          }),
        },
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
      { ok: false, error: "no_actual_data", message: "No actual interval data (SMT or Green Button)." },
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
          { ok: false, error: "extreme_weather_requires_coordinates", message: "testMode=extreme_weather requires house lat/lng. Add coordinates to the house address." },
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
      {
        ok: false,
        error: "test_ranges_required",
        message: "At least one valid Test Date range is required (or use Random Test Days).",
        compareCoreTiming: finalizeCompareCoreTiming(compareCoreTiming),
      },
      { status: 400 }
    );
  }

  const guardrailExcludedDateKeysLocal = new Set<string>([...Array.from(travelDateKeysLocal), ...Array.from(testDateKeysLocal)]);
  const overlapLocal = setIntersect(travelDateKeysLocal, testDateKeysLocal);
  if (overlapLocal.size > 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "test_overlaps_travel",
        message: "Test Dates overlap saved Vacant/Travel dates. Remove overlap and retry.",
        overlapCount: overlapLocal.size,
        overlapSample: sortedSample(overlapLocal),
        testDateKeysCount: testDateKeysLocal.size,
        travelDateKeysCount: travelDateKeysLocal.size,
        compareCoreTiming: finalizeCompareCoreTiming(compareCoreTiming),
      },
      { status: 400 }
    );
  }

  // Canonical path: Gap-Fill scoring reads the shared Past artifact/service output only.
  const rebuildArtifact = body?.rebuildArtifact === true;
  const rebuildOnly = body?.rebuildOnly === true;
  if (rebuildArtifact && rebuildOnly) {
    let rebuilt: Awaited<ReturnType<typeof rebuildGapfillSharedPastArtifact>>;
    try {
      rebuilt = await withTimeout(
        rebuildGapfillSharedPastArtifact({
          userId: user.id,
          houseId: house.id,
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
        {
          ok: false,
          error: timedOut ? "artifact_ensure_route_timeout" : "artifact_ensure_route_exception",
          message: timedOut
            ? "Artifact ensure timed out while rebuilding shared Past artifact."
            : normalizedError.message,
          missingData: timedOut ? ["rebuildGapfillSharedPastArtifact"] : undefined,
          reasonCode: timedOut
            ? "ARTIFACT_ENSURE_ROUTE_TIMEOUT"
            : "ARTIFACT_ENSURE_ROUTE_EXCEPTION",
          timeoutMs: timedOut ? ROUTE_REBUILD_SHARED_TIMEOUT_MS : undefined,
        },
        { status: timedOut ? 504 : 500 }
      );
    }
    if (!rebuilt.ok) {
      const classification = classifySimulationFailure({
        code: String((rebuilt as any)?.error ?? ""),
        message: String((rebuilt as any)?.message ?? ""),
      });
      return NextResponse.json(
        {
          ok: false,
          error: String((rebuilt as any)?.error ?? "past_rebuild_failed"),
          message: String((rebuilt as any)?.message ?? "Failed to rebuild shared Past artifact."),
          explanation: classification.userFacingExplanation,
          missingData: classification.missingData,
          reasonCode: classification.reasonCode,
        },
        { status: 500 }
      );
    }
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
      rebuilt: rebuilt.rebuilt === true,
      scenarioId: rebuilt.scenarioId,
      artifactScenarioId: rebuilt.artifactScenarioId,
      requestedInputHash: rebuilt.requestedInputHash,
      artifactInputHashUsed: rebuilt.artifactInputHashUsed,
      artifactHashMatch: rebuilt.artifactHashMatch,
      artifactSourceMode: rebuilt.artifactSourceMode,
      artifactSourceNote: rebuilt.artifactSourceNote,
      message:
        rebuilt.rebuilt === true
          ? "Shared Past artifact rebuilt via shared simulator path. Running compare next will score selected test days from shared artifact output."
          : "Shared Past artifact exact identity was already available, so artifact ensure skipped a redundant rebuild.",
      testRangesUsed,
      testSelectionMode,
      testDaysRequested,
      testDaysSelected,
      seedUsed,
      travelRangesFromDb,
    });
  }

  // Canonical Gap-Fill main path:
  // recalc shared Past artifact once, then read from the same saved family as
  // getSimulatedUsageForHouseScenario (/api/user/usage/simulated/house lineage),
  // then apply admin-only projections for accuracy display.
  const pastScenario = await (prisma as any).usageSimulatorScenario
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
  if (!pastScenario?.id) {
    return NextResponse.json(
      {
        ok: false,
        error: "no_past_scenario",
        message: "No Past (Corrected) scenario found for this house.",
      },
      { status: 400 }
    );
  }

  const run = await createGapfillCompareRunStart({
    userId: user.id,
    houseId: house.id,
    compareFreshMode: "selected_days",
    requestedInputHash: requestedArtifactInputHash,
    artifactScenarioId: String(pastScenario.id),
    requireExactArtifactMatch,
    artifactIdentitySource,
    initialStatus: "started",
    initialPhase: "compare_core_recalc_started",
    statusMeta: {
      route: "admin_gapfill_lab",
      phase: "compare_core_recalc_started",
      canonicalReadFamily: "getSimulatedUsageForHouseScenario->/api/user/usage/simulated/house",
    },
  });
  if (!run.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: run.error,
        message: run.message,
        reasonCode: "COMPARE_RUN_QUEUE_PERSIST_FAILED",
      },
      { status: 500 }
    );
  }
  compareRunId = run.compareRunId;
  compareRunStatus = "running";
  compareRunSnapshotReady = false;

  const recalcOut = await recalcSimulatorBuild({
    userId: user.id,
    houseId: house.id,
    esiid,
    mode: "SMT_BASELINE",
    scenarioId: String(pastScenario.id),
    persistPastSimBaseline: true,
    validationOnlyDateKeysLocal: testDateKeysLocal,
  });
  if (!recalcOut.ok) {
    await markGapfillCompareRunFailed({
      compareRunId: run.compareRunId,
      phase: "compare_core_recalc_failed",
      failureCode: "compare_core_recalc_failed",
      failureMessage: String(recalcOut.error ?? "Canonical recalc failed."),
      statusMeta: { route: "admin_gapfill_lab" },
    });
    compareRunStatus = "failed";
    compareRunTerminalState = true;
    return NextResponse.json(
      {
        ok: false,
        error: "compare_core_recalc_failed",
        message: String(recalcOut.error ?? "Canonical recalc failed."),
        compareRunId: run.compareRunId,
        compareRunStatus: "failed",
      },
      { status: 500 }
    );
  }
  markCompareCoreStep(compareCoreTiming, "build_shared_compare");

  const canonicalRead = await getSimulatedUsageForHouseScenario({
    userId: user.id,
    houseId: house.id,
    scenarioId: String(pastScenario.id),
    readMode: "allow_rebuild",
    projectionMode: "raw",
  });
  if (!canonicalRead.ok) {
    await markGapfillCompareRunFailed({
      compareRunId: run.compareRunId,
      phase: "compare_core_canonical_read_failed",
      failureCode: String(canonicalRead.code ?? "compare_core_canonical_read_failed"),
      failureMessage: String(canonicalRead.message ?? "Canonical read failed."),
      statusMeta: { route: "admin_gapfill_lab" },
    });
    compareRunStatus = "failed";
    compareRunTerminalState = true;
    return NextResponse.json(
      {
        ok: false,
        error: "compare_core_canonical_read_failed",
        message: String(canonicalRead.message ?? "Canonical read failed."),
        compareRunId: run.compareRunId,
        compareRunStatus: "failed",
      },
      { status: 500 }
    );
  }
  const baselineRead = await getSimulatedUsageForHouseScenario({
    userId: user.id,
    houseId: house.id,
    scenarioId: String(pastScenario.id),
    readMode: "allow_rebuild",
    projectionMode: "baseline",
  });
  const canonicalDataset = canonicalRead.dataset as any;
  const baselineDataset = baselineRead.ok ? (baselineRead.dataset as any) : canonicalDataset;

  const selectedDateKeysSorted = Array.from(testDateKeysLocal).sort();
  const testDateKeySet = new Set<string>(selectedDateKeysSorted);
  const actualIntervalsForSelected = (
    candidateIntervalsForTesting != null && candidateIntervalsForTesting.length > 0
      ? candidateIntervalsForTesting
      : await getActualIntervalsForRange({
          houseId: house.id,
          esiid,
          startDate: shiftIsoDateUtc(selectedDateKeysSorted[0] ?? canonicalWindow.startDate, -1),
          endDate: shiftIsoDateUtc(
            selectedDateKeysSorted[selectedDateKeysSorted.length - 1] ?? canonicalWindow.endDate,
            1
          ),
        })
  ).filter((row) =>
    testDateKeySet.has(dateKeyInTimezone(String(row?.timestamp ?? ""), timezone))
  );
  markCompareCoreStep(compareCoreTiming, "load_actual_usage");

  const simulatedIntervalsForSelected = Array.isArray(canonicalDataset?.series?.intervals15)
    ? (canonicalDataset.series.intervals15 as Array<{ timestamp: string; kwh: number }>).filter((row) =>
        testDateKeySet.has(dateKeyInTimezone(String(row?.timestamp ?? ""), timezone))
      )
    : [];
  const simulatedByTs = new Map<string, number>();
  for (const row of simulatedIntervalsForSelected) {
    simulatedByTs.set(canonicalIntervalKey(String(row?.timestamp ?? "")), Number(row?.kwh) || 0);
  }
  const actualDailyByDate = new Map<string, number>();
  for (const row of actualIntervalsForSelected) {
    const dk = dateKeyInTimezone(String(row?.timestamp ?? ""), timezone);
    if (!testDateKeySet.has(dk)) continue;
    actualDailyByDate.set(dk, round2((actualDailyByDate.get(dk) ?? 0) + (Number(row?.kwh) || 0)));
  }
  const simDailyFromMeta = (() => {
    const src =
      (canonicalDataset?.meta?.canonicalArtifactSimulatedDayTotalsByDate as
        | Record<string, number>
        | undefined) ??
      (canonicalDataset?.canonicalArtifactSimulatedDayTotalsByDate as
        | Record<string, number>
        | undefined) ??
      {};
    const out = new Map<string, number>();
    for (const [dk, kwh] of Object.entries(src)) {
      const key = String(dk).slice(0, 10);
      if (!testDateKeySet.has(key)) continue;
      out.set(key, round2(Number(kwh) || 0));
    }
    return out;
  })();
  if (simDailyFromMeta.size === 0 && Array.isArray(canonicalDataset?.daily)) {
    for (const row of canonicalDataset.daily as Array<{ date?: string; kwh?: number }>) {
      const dk = String(row?.date ?? "").slice(0, 10);
      if (!testDateKeySet.has(dk)) continue;
      simDailyFromMeta.set(dk, round2(Number(row?.kwh) || 0));
    }
  }
  const metrics = computeGapFillMetrics({
    actual: actualIntervalsForSelected,
    simulated: simulatedIntervalsForSelected,
    simulatedByTs,
    timezone,
  });
  const scoredDayTruthRows = selectedDateKeysSorted.map((dk) => {
    const actualDayKwh = round2(actualDailyByDate.get(dk) ?? 0);
    const freshCompareSimDayKwh = round2(simDailyFromMeta.get(dk) ?? 0);
    const dow = getLocalDayOfWeekFromDateKey(dk, timezone);
    return {
      localDate: dk,
      actualDayKwh,
      freshCompareSimDayKwh,
      displayedPastStyleSimDayKwh: freshCompareSimDayKwh,
      actualVsFreshErrorKwh: round2(actualDayKwh - freshCompareSimDayKwh),
      displayVsFreshParityMatch: true,
      parityAvailability: "available",
      parityReasonCode: "display_matches_canonical_artifact",
      dayType: dow === 0 || dow === 6 ? "weekend" : "weekday",
      weatherBasis: null,
      weatherSourceUsed: null,
      weatherFallbackReason: null,
      avgTempF: null,
      minTempF: null,
      maxTempF: null,
      hdd65: null,
      cdd65: null,
      fallbackLevel: null,
      selectedDayTotalSource: "canonical_artifact_simulated_day_total",
      selectedShapeVariant: null,
      selectedReferenceMatchTier: null,
      selectedMatchSampleCount: null,
      reasonCode: "canonical_artifact_simulated_day_total",
    };
  });
  markCompareCoreStep(compareCoreTiming, "build_metrics");

  const metricsSummary = {
    mae: metrics.mae,
    rmse: metrics.rmse,
    mape: metrics.mape,
    wape: metrics.wape,
    maxAbs: metrics.maxAbs,
    totalActualKwhMasked: metrics.totalActualKwhMasked,
    totalSimKwhMasked: metrics.totalSimKwhMasked,
    deltaKwhMasked: metrics.deltaKwhMasked,
    mapeFiltered: metrics.mapeFiltered,
    mapeFilteredCount: metrics.mapeFilteredCount,
  };
  const compareTruth = {
    compareSharedCalcPath:
      "dispatchPastSimRecalc->recalcSimulatorBuild->simulatePastUsageDataset(recalc)->getSimulatedUsageForHouseScenario(/api/user/usage/simulated/house family)->admin_accuracy_projection",
    sourceOfDaySimulationCore: SOURCE_OF_DAY_SIMULATION_CORE,
    validationDaysTruthSource: "canonical_saved_artifact_family",
  };
  const snapshotPayload: Record<string, unknown> = {
    selectedScoredDateKeys: selectedDateKeysSorted,
    scoredDayTruthRowsCompact: scoredDayTruthRows,
    scoredDayWeatherRows: [],
    scoredDayWeatherTruth: {
      availability: "not_requested",
      reasonCode: "SCORED_DAY_WEATHER_NOT_REQUESTED",
      explanation: "Weather diagnostics are not requested in canonical baseline projection mode.",
      source: "canonical_saved_artifact_family",
      scoredDateCount: selectedDateKeysSorted.length,
      weatherRowCount: 0,
      missingDateCount: selectedDateKeysSorted.length,
      missingDateSample: selectedDateKeysSorted.slice(0, 10),
    },
    travelVacantParityRows: [],
    travelVacantParityTruth: {
      availability: "not_requested",
      reasonCode: "TRAVEL_VACANT_PARITY_NOT_REQUESTED",
      explanation: "Travel/vacant parity reader remains legacy and is not canonical in this flow.",
      source: "canonical_saved_artifact_family",
      comparisonBasis: "legacy_not_requested",
      requestedDateCount: 0,
      validatedDateCount: 0,
      mismatchCount: 0,
      missingArtifactReferenceCount: 0,
      missingFreshCompareCount: 0,
      requestedDateSample: [],
      exactProofRequired: false,
      exactProofSatisfied: true,
    },
    metricsSummary,
    counts: {
      scoredRowCount: scoredDayTruthRows.length,
      selectedDateKeyCount: selectedDateKeysSorted.length,
      parityRowCount: 0,
    },
    compareTruth,
    compareCoreTiming: finalizeCompareCoreTiming(compareCoreTiming),
    identityTruth: {
      scenarioId: String(pastScenario.id),
      canonicalReadSource: "getSimulatedUsageForHouseScenario",
      canonicalReadRoute: "/api/user/usage/simulated/house",
    },
    modelAssumptions: {
      selectedDaysRequestedCount: selectedDateKeysSorted.length,
      validationOnlyDateKeysLocal: selectedDateKeysSorted,
      canonicalReadFamily: "getSimulatedUsageForHouseScenario->/api/user/usage/simulated/house",
      projectionMode: "baseline_vs_accuracy",
    },
  };
  const finalized = await finalizeGapfillCompareRunSnapshot({
    compareRunId: run.compareRunId,
    phase: "compare_core_complete",
    snapshot: snapshotPayload,
    statusMeta: {
      route: "admin_gapfill_lab",
      projectionMode: "baseline_vs_accuracy",
      canonicalTruthSource: "/api/user/usage/simulated/house",
    },
  });
  if (!finalized) {
    await markGapfillCompareRunFailed({
      compareRunId: run.compareRunId,
      phase: "compare_core_snapshot_persist_failed",
      failureCode: "compare_core_snapshot_persist_failed",
      failureMessage: "Could not persist compare snapshot payload.",
      statusMeta: { route: "admin_gapfill_lab" },
    });
    compareRunStatus = "failed";
    compareRunTerminalState = true;
    return NextResponse.json(
      {
        ok: false,
        error: "compare_core_snapshot_persist_failed",
        message: "Could not persist compare snapshot payload.",
        compareRunId: run.compareRunId,
        compareRunStatus: "failed",
      },
      { status: 500 }
    );
  }
  compareRunStatus = "succeeded";
  compareRunSnapshotReady = true;
  compareRunTerminalState = true;
  compareCoreTimingForLifecycle = compareCoreTiming;
  compareRequestTruthForLifecycle = {
    route: "admin_gapfill_lab",
    canonicalReadLayer: "getSimulatedUsageForHouseScenario",
    canonicalReadRoute: "/api/user/usage/simulated/house",
  };
  artifactRequestTruthForLifecycle = {
    scenarioId: String(pastScenario.id),
    sourceFamily: "usageSimulatorBuild + shared past cache",
  };
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
    compareExecutionMode: "inline_canonical",
    compareRunId: run.compareRunId,
    compareRunStatus: "succeeded",
    compareRunSnapshotReady: true,
    modelAssumptions: buildSelectedDaysCoreResponseModelAssumptions(
      (snapshotPayload.modelAssumptions as Record<string, unknown>) ?? null
    ),
    testIntervalsCount: actualIntervalsForSelected.length,
    metrics: metricsSummary,
    primaryPercentMetric: metricsSummary.wape,
    byMonth: metrics.byMonth,
    byHour: metrics.byHour,
    byDayType: metrics.byDayType,
    worstDays: metrics.worstDays,
    diagnostics: metrics.diagnostics,
    pasteSummary: metrics.pasteSummary,
    travelRangesFromDb,
    testSelectionMode,
    testDaysRequested,
    testDaysSelected,
    seedUsed,
    testRangesUsed,
    testMode,
    candidateDaysAfterModeFilterCount,
    minDayCoveragePct,
    candidateWindowStartUtc: candidateWindowStart,
    candidateWindowEndUtc: candidateWindowEnd,
    usage365,
    scoredDayTruthRows,
    scoredDayWeatherRows: [],
    scoredDayWeatherTruth: (snapshotPayload.scoredDayWeatherTruth as Record<string, unknown>) ?? null,
    parity: {
      travelVacantParityRows: [],
      travelVacantParityTruth: snapshotPayload.travelVacantParityTruth,
      compareTruth,
      identityTruth: snapshotPayload.identityTruth,
      compareCoreTiming: snapshotPayload.compareCoreTiming,
      counts: snapshotPayload.counts,
      missAttributionSummary: null,
    },
    compareTruth,
    compareSharedCalcPath: compareTruth.compareSharedCalcPath,
    baselineDatasetProjection: baselineDataset,
    responseMode: heavyOnlyCompactResponse === true ? "heavy_only_compact" : undefined,
    message: "Gap-Fill compare executed via canonical Past Sim recalc/read path.",
    noRecompute: true,
  });
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
      {
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
      },
      { status: 500 }
    );
  }
}