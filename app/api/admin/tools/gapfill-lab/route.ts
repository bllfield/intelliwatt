import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { prisma } from "@/lib/db";
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
import { getWeatherForRange } from "@/lib/sim/weatherProvider";
import { SOURCE_OF_DAY_SIMULATION_CORE } from "@/modules/simulatedUsage/pastDaySimulator";
import { loadDisplayProfilesForHouse } from "@/modules/usageSimulator/profileDisplay";
import {
  buildGapfillCompareSimShared,
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
import { IntervalSeriesKind } from "@/modules/usageSimulator/kinds";
import {
  classifySimulationFailure,
  recordSimulationDataAlert,
} from "@/modules/usageSimulator/simulationDataAlerts";
import { monthsEndingAt } from "@/lib/time/chicago";
import { buildDisplayMonthlyFromIntervalsUtc } from "@/modules/usageSimulator/dataset";
import { runGapfillCompareCorePipeline } from "@/modules/usageSimulator/gapfillCompareCorePipeline";
import { buildGapfillCompareQueuedPayloadV1 } from "@/modules/usageSimulator/gapfillCompareQueuedPayload";
import {
  getGapfillCompareEnqueueDiagnostics,
  shouldEnqueueGapfillCompareRemote,
  triggerDropletSimWebhook,
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

function hasAdminSessionCookie(request: NextRequest): boolean {
  const raw = request.cookies.get("intelliwatt_admin")?.value ?? "";
  const email = normalizeEmailSafe(raw);
  if (!email) return false;
  return ADMIN_EMAILS.includes(email);
}

async function triggerGapfillCompareDropletWebhook(compareRunId: string): Promise<void> {
  await triggerDropletSimWebhook({
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
  const action = toSnapshotReaderAction(body?.action);
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

  const compareFreshModeForQueue: "selected_days" | "full_window" =
    includeDiagnostics || includeFullReportText ? "full_window" : "selected_days";
  const enqueueEligibility = getGapfillCompareEnqueueDiagnostics();
  console.info("[gapfill-lab][compare-enqueue-eval]", {
    route: "admin_gapfill_lab",
    email: user.email,
    houseId: house.id,
    ...enqueueEligibility,
  });
  if (shouldEnqueueGapfillCompareRemote()) {
    const queuedPayload = buildGapfillCompareQueuedPayloadV1({
      userId: user.id,
      houseId: house.id,
      timezone,
      canonicalWindow,
      canonicalMonths,
      canonicalWindowHelper,
      esiid,
      testDateKeysLocal,
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
      includeDiagnostics,
      includeFullReportText,
      rebuildArtifact,
      requestedArtifactInputHash,
      requestedArtifactScenarioId,
      requireExactArtifactMatch,
      artifactIdentitySource,
      heavyOnlyCompactResponse,
      requestedCompareRunId,
      minDayCoveragePct,
    });
    const run = await createGapfillCompareRunStart({
      userId: user.id,
      houseId: house.id,
      compareFreshMode: compareFreshModeForQueue,
      requestedInputHash: requestedArtifactInputHash,
      artifactScenarioId: requestedArtifactScenarioId,
      requireExactArtifactMatch,
      artifactIdentitySource,
      queuedPayloadJson: queuedPayload as unknown as Record<string, unknown>,
      initialStatus: "queued",
      initialPhase: "compare_async_queued",
      statusMeta: {
        route: "admin_gapfill_lab",
        phase: "compare_async_queued",
        compareEnqueueAt: new Date().toISOString(),
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
    await triggerGapfillCompareDropletWebhook(run.compareRunId);
    console.info("[gapfill-lab][compare-enqueue]", {
      route: "admin_gapfill_lab",
      event: "droplet_webhook_triggered",
      compareRunId: run.compareRunId,
      ...enqueueEligibility,
    });
    compareRunId = run.compareRunId;
    compareRunStatus = "queued";
    compareRunSnapshotReady = false;
    return NextResponse.json({
      ok: true,
      email: user.email,
      userId: user.id,
      house: {
        id: house.id,
        label: [house.addressLine1, house.addressCity, house.addressState].filter(Boolean).join(", ") || house.id,
      },
      compareRunId: run.compareRunId,
      compareRunStatus: "queued",
      compareRunSnapshotReady: false,
      compareExecutionMode: "droplet_async",
      enqueueEligibility,
      message: "Compare queued for droplet execution.",
    });
  }

  console.info("[gapfill-lab][compare-path]", {
    route: "admin_gapfill_lab",
    path: "vercel_inline_pipeline",
    email: user.email,
    houseId: house.id,
    ...enqueueEligibility,
  });

  const pipelineState: import("@/modules/usageSimulator/gapfillCompareCorePipeline").GapfillComparePipelineState = {
    compareRequestTruthForLifecycle: null,
    artifactRequestTruthForLifecycle: null,
    compareCoreTimingForLifecycle: null,
  };
  const pipelineOut: import("@/modules/usageSimulator/gapfillCompareCorePipeline").GapfillCompareRunOut = {
    compareRunId: null,
    compareRunStatus: null,
    compareRunSnapshotReady: false,
    compareRunTerminalState: false,
  };
  const response = await runGapfillCompareCorePipeline({
    abortSignal: req.signal,
    resumeExistingCompareRunId: null,
    state: pipelineState,
    out: pipelineOut,
    user,
    house,
    houses,
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
    includeFullReportText,
    rebuildArtifact,
    requestedArtifactInputHash,
    requestedArtifactScenarioId,
    requireExactArtifactMatch,
    artifactIdentitySource,
    heavyOnlyCompactResponse,
    requestedCompareRunId,
    minDayCoveragePct,
  });
  compareRunId = pipelineOut.compareRunId;
  compareRunStatus = pipelineOut.compareRunStatus;
  compareRunSnapshotReady = pipelineOut.compareRunSnapshotReady;
  compareRunTerminalState = pipelineOut.compareRunTerminalState;
  compareRequestTruthForLifecycle = pipelineState.compareRequestTruthForLifecycle;
  artifactRequestTruthForLifecycle = pipelineState.artifactRequestTruthForLifecycle;
  compareCoreTimingForLifecycle = pipelineState.compareCoreTimingForLifecycle;
  return response;
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