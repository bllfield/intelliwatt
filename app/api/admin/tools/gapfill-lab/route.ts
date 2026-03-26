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

export const dynamic = "force-dynamic";
export const maxDuration = 300; // Explicit rebuilds can run full-year canonical build before compare.
// Keep route compare-core timeout below client timeout so route-side
// classification (failedStep/reasonCode) reaches UI before browser abort.
const ROUTE_REBUILD_SHARED_TIMEOUT_MS = 120_000;
const ROUTE_COMPARE_SHARED_TIMEOUT_MS = 120_000;
const ROUTE_COMPARE_REPORT_TIMEOUT_MS = 60_000;

const ADMIN_EMAILS = ["brian@intelliwatt.com", "brian@intellipath-solutions.com"];

function hasAdminSessionCookie(request: NextRequest): boolean {
  const raw = request.cookies.get("intelliwatt_admin")?.value ?? "";
  const email = normalizeEmailSafe(raw);
  if (!email) return false;
  return ADMIN_EMAILS.includes(email);
}

type DateRange = { startDate: string; endDate: string };
type Usage365Payload = {
  source: string;
  timezone: string;
  coverageStart: string | null;
  coverageEnd: string | null;
  intervalCount: number;
  daily: Array<{ date: string; kwh: number }>;
  monthly: Array<{ month: string; kwh: number }>;
  weekdayKwh: number;
  weekendKwh: number;
  fifteenCurve: Array<{ hhmm: string; avgKw: number }>;
  stitchedMonth?: {
    mode: "PRIOR_YEAR_TAIL";
    yearMonth: string;
    haveDaysThrough: number;
    missingDaysFrom: number;
    missingDaysTo: number;
    borrowedFromYearMonth: string;
    completenessRule: string;
  } | null;
};

type IntervalPoint = { timestamp: string; kwh: number };

function shiftIsoDateUtc(dateKey: string, deltaDays: number): string {
  const key = String(dateKey ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return key;
  const base = new Date(`${key}T12:00:00.000Z`);
  if (Number.isNaN(base.getTime())) return key;
  base.setUTCDate(base.getUTCDate() + deltaDays);
  return base.toISOString().slice(0, 10);
}

function normalizeFifteenCurve96(
  raw: unknown
): Array<{ hhmm: string; avgKw: number }> {
  const bySlot = new Map<number, number>();
  if (Array.isArray(raw)) {
    for (const row of raw) {
      const hhmm = String((row as any)?.hhmm ?? "");
      const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
      if (!match) continue;
      const hour = Number(match[1]);
      const minute = Number(match[2]);
      if (!Number.isFinite(hour) || !Number.isFinite(minute)) continue;
      if (hour < 0 || hour > 23) continue;
      if (minute % 15 !== 0 || minute < 0 || minute > 45) continue;
      const slot = hour * 4 + Math.floor(minute / 15);
      const avgKw = Number((row as any)?.avgKw);
      bySlot.set(slot, Number.isFinite(avgKw) ? round2(avgKw) : 0);
    }
  }
  return Array.from({ length: 96 }, (_, slot) => {
    const hour = Math.floor(slot / 4);
    const minute = (slot % 4) * 15;
    const hhmm = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    return { hhmm, avgKw: round2(bySlot.get(slot) ?? 0) };
  });
}

function sortedSample(keys: Set<string>, limit = 10): string[] {
  return Array.from(keys).sort().slice(0, limit);
}

function setIntersect(a: Set<string>, b: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const x of Array.from(a)) if (b.has(x)) out.add(x);
  return out;
}

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

type CompareCoreStepKey =
  | "select_test_days"
  | "map_selected_ranges_to_intervals"
  | "load_actual_usage"
  | "load_artifact"
  | "build_shared_compare"
  | "join_actual_vs_sim"
  | "build_metrics"
  | "summarize_metrics"
  | "build_diagnostics"
  | "build_full_report"
  | "finalize_response";

function startCompareCoreTiming() {
  return {
    startedAtMs: Date.now(),
    startedAt: new Date().toISOString(),
    stepsMs: {} as Record<CompareCoreStepKey, number>,
    lastCompletedStep: null as CompareCoreStepKey | null,
  };
}

function markCompareCoreStep(
  timing: ReturnType<typeof startCompareCoreTiming>,
  step: CompareCoreStepKey
) {
  timing.stepsMs[step] = Math.max(0, Date.now() - timing.startedAtMs);
  timing.lastCompletedStep = step;
}

function finalizeCompareCoreTiming(
  timing: ReturnType<typeof startCompareCoreTiming>,
  extra?: Record<string, unknown>
) {
  return {
    startedAt: timing.startedAt,
    endedAt: new Date().toISOString(),
    elapsedMs: Math.max(0, Date.now() - timing.startedAtMs),
    lastCompletedStep: timing.lastCompletedStep,
    stepsMs: timing.stepsMs,
    compareCoreStepTimings: timing.stepsMs,
    ...(typeof (extra as any)?.failedStep === "string" ? { compareCoreFailedStep: (extra as any).failedStep } : {}),
    ...(extra ?? {}),
  };
}

function buildHeavyTiming(
  timing: ReturnType<typeof startCompareCoreTiming>,
  extra?: {
    heavyFailedStep?: CompareCoreStepKey;
    heavyResponseMode?: "heavy_only_compact";
  }
) {
  return {
    heavyStartedAt: timing.startedAt,
    heavyEndedAt: new Date().toISOString(),
    heavyElapsedMs: Math.max(0, Date.now() - timing.startedAtMs),
    heavyLastCompletedStep: timing.lastCompletedStep,
    heavyStepsMs: timing.stepsMs,
    ...(extra?.heavyFailedStep ? { heavyFailedStep: extra.heavyFailedStep } : {}),
    ...(extra?.heavyResponseMode ? { responseMode: extra.heavyResponseMode } : {}),
  };
}

function buildSelectedDaysCoreResponseModelAssumptions(modelAssumptions: any): Record<string, unknown> | null {
  if (!modelAssumptions || typeof modelAssumptions !== "object") return null;
  const out: Record<string, unknown> = { ...(modelAssumptions as Record<string, unknown>) };
  delete out.weatherApiData;
  delete out.simulatedDayDiagnosticsSample;
  delete out.dayTotalDiagnostics;
  delete out.weatherRowsBySource;
  delete out.weatherSourcesSeen;
  delete out.weatherSourceMismatchDetected;
  delete out.weatherRowCount;
  delete out.weatherKindUsed;
  delete out.weatherValidationFingerprint;
  delete out.simulationWeatherSourceOwner;
  delete out.reportWeatherSourceOwner;
  delete out.benchmarkPayloadForCopy;
  return out;
}

async function withTimeout<T>(task: Promise<T>, timeoutMs: number, timeoutErrorCode: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      const err = new Error(timeoutErrorCode);
      (err as any).code = timeoutErrorCode;
      reject(err);
    }, timeoutMs);
  });
  try {
    return await Promise.race([task, timeoutPromise]);
  } finally {
    if (timeoutId != null) clearTimeout(timeoutId);
  }
}

async function withRequestAbort<T>(
  task: Promise<T>,
  signal: AbortSignal | undefined,
  abortErrorCode: string
): Promise<T> {
  if (!signal) return task;
  if (signal.aborted) {
    const err = new Error(abortErrorCode);
    (err as any).code = abortErrorCode;
    throw err;
  }
  let abortHandler: (() => void) | null = null;
  const abortPromise = new Promise<never>((_, reject) => {
    abortHandler = () => {
      const err = new Error(abortErrorCode);
      (err as any).code = abortErrorCode;
      reject(err);
    };
    signal.addEventListener("abort", abortHandler, { once: true });
  });
  try {
    return await Promise.race([task, abortPromise]);
  } finally {
    if (abortHandler) signal.removeEventListener("abort", abortHandler);
  }
}

/** Forward multiple abort sources into one controller so compare_core can stop work cooperatively (Vercel duration ≈ response time). */
function attachAbortForwarders(target: AbortController, ...sources: Array<AbortSignal | undefined>): () => void {
  const disposers: Array<() => void> = [];
  for (const s of sources) {
    if (s == null) continue;
    if (s.aborted) {
      target.abort();
      return () => {};
    }
    const onAbort = () => target.abort();
    s.addEventListener("abort", onAbort, { once: true });
    disposers.push(() => s.removeEventListener("abort", onAbort));
  }
  return () => {
    for (const d of disposers) d();
  };
}

function normalizeRouteError(value: unknown, fallbackMessage: string): { code: string; message: string } {
  const fromObject = value != null && typeof value === "object" ? (value as Record<string, unknown>) : null;
  const codeRaw = fromObject && typeof fromObject.code === "string" ? fromObject.code.trim() : "";
  const messageRaw = fromObject && typeof fromObject.message === "string" ? fromObject.message.trim() : "";
  const primitiveMessage =
    typeof value === "string"
      ? value.trim()
      : typeof value === "number" || typeof value === "boolean" || typeof value === "bigint"
        ? String(value)
        : "";
  const message = messageRaw || primitiveMessage || fallbackMessage;
  const code = codeRaw || messageRaw || fallbackMessage;
  return { code, message };
}

type GapfillSnapshotReaderAction =
  | "compare_heavy_manifest"
  | "compare_heavy_parity"
  | "compare_heavy_scored_days";

function toSnapshotReaderAction(value: unknown): GapfillSnapshotReaderAction | null {
  const v = typeof value === "string" ? value.trim() : "";
  if (
    v === "compare_heavy_manifest" ||
    v === "compare_heavy_parity" ||
    v === "compare_heavy_scored_days"
  ) {
    return v;
  }
  return null;
}

function buildSnapshotReaderBase(args: {
  compareRunId: string;
  row: {
    status: string;
    phase: string | null;
    compareFreshMode: string;
    requestedInputHash: string | null;
    artifactScenarioId: string | null;
    requireExactArtifactMatch: boolean;
    artifactIdentitySource: string | null;
    failureCode: string | null;
    failureMessage: string | null;
    snapshotReady: boolean;
    snapshotVersion: string | null;
    snapshotPersistedAt: string | null;
    snapshotJson: Record<string, unknown> | null;
    statusMetaJson: Record<string, unknown> | null;
    createdAt: string;
    updatedAt: string;
    startedAt: string;
    finishedAt: string | null;
  };
}) {
  return {
    compareRunId: args.compareRunId,
    compareRunStatus: args.row.status,
    compareRunSnapshotReady: args.row.snapshotReady,
    compareFreshMode: args.row.compareFreshMode,
    compareRunTiming: {
      createdAt: args.row.createdAt,
      updatedAt: args.row.updatedAt,
      startedAt: args.row.startedAt,
      finishedAt: args.row.finishedAt,
      phase: args.row.phase,
    },
    artifactRequestTruth: {
      requestedInputHash: args.row.requestedInputHash,
      requestedArtifactScenarioId: args.row.artifactScenarioId,
      requireExactArtifactMatch: args.row.requireExactArtifactMatch,
      artifactIdentitySource: args.row.artifactIdentitySource,
    },
  };
}

function safeRatio(numerator: number, denominator: number): number | null {
  const d = Number(denominator) || 0;
  if (d === 0) return null;
  return round2((Number(numerator) / d) * 100);
}

function bucketHourBlock(hour: number): "00-05" | "06-11" | "12-17" | "18-23" {
  if (hour < 6) return "00-05";
  if (hour < 12) return "06-11";
  if (hour < 18) return "12-17";
  return "18-23";
}

function classifyTemperatureBand(avgTempF: number | null): string {
  if (avgTempF == null || !Number.isFinite(avgTempF)) return "unknown";
  if (avgTempF < 40) return "<40F";
  if (avgTempF < 55) return "40-54F";
  if (avgTempF < 70) return "55-69F";
  if (avgTempF < 85) return "70-84F";
  return ">=85F";
}

function classifyWeatherRegime(hdd65: number | null, cdd65: number | null): string {
  const hdd = Number(hdd65);
  const cdd = Number(cdd65);
  if (!Number.isFinite(hdd) && !Number.isFinite(cdd)) return "unknown";
  if ((hdd || 0) > (cdd || 0)) return "heating";
  if ((cdd || 0) > (hdd || 0)) return "cooling";
  return "neutral";
}

function topCounts<T extends string>(rows: Array<{ key: T; count: number }>, limit = 3): Array<{ key: T; count: number }> {
  return rows
    .filter((r) => Number.isFinite(r.count) && r.count > 0)
    .sort((a, b) => b.count - a.count || String(a.key).localeCompare(String(b.key)))
    .slice(0, limit);
}

function isValidIanaTimezone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.trim().length === 0) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function getLocalHourMinuteInTimezone(tsIso: string, tz: string): { hour: number; minute: number } {
  try {
    const d = new Date(tsIso);
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    }).formatToParts(d);
    const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10) || 0;
    const minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10) || 0;
    return { hour: Math.max(0, Math.min(23, hour)), minute: Math.max(0, Math.min(59, minute)) };
  } catch {
    const d = new Date(tsIso);
    return { hour: d.getUTCHours(), minute: d.getUTCMinutes() };
  }
}

function buildUsage365Payload(args: {
  intervals: Array<{ timestamp: string; kwh: number }>;
  timezone: string;
  source: string;
  endDate: string;
}): Usage365Payload {
  const { intervals, timezone, source, endDate } = args;
  const byDay = new Map<string, number>();
  const slotSums = Array<number>(96).fill(0);
  const slotCounts = Array<number>(96).fill(0);
  let weekdayKwh = 0;
  let weekendKwh = 0;

  for (const row of intervals) {
    const ts = String(row?.timestamp ?? "").trim();
    const kwh = Number(row?.kwh) || 0;
    const dateKey = dateKeyInTimezone(ts, timezone);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) continue;
    byDay.set(dateKey, (byDay.get(dateKey) ?? 0) + kwh);
    const dow = getLocalDayOfWeekFromDateKey(dateKey, timezone);
    if (dow === 0 || dow === 6) weekendKwh += kwh;
    else weekdayKwh += kwh;

    const hm = getLocalHourMinuteInTimezone(ts, timezone);
    const slot = Math.min(95, Math.max(0, hm.hour * 4 + Math.floor(hm.minute / 15)));
    slotSums[slot] += kwh;
    slotCounts[slot] += 1;
  }

  const daily = Array.from(byDay.entries())
    .map(([date, kwh]) => ({ date, kwh: round2(kwh) }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const monthlyBuild = buildDisplayMonthlyFromIntervalsUtc(
    intervals.map((row) => ({
      timestamp: String(row?.timestamp ?? ""),
      consumption_kwh: Number(row?.kwh) || 0,
    })),
    endDate
  );
  const monthly = monthlyBuild.monthly.map((m) => ({
    month: String(m?.month ?? ""),
    kwh: round2(Number(m?.kwh) || 0),
  }));
  const fifteenCurve = Array.from({ length: 96 }, (_, slot) => {
    const hour = Math.floor(slot / 4);
    const minute = (slot % 4) * 15;
    const hhmm = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    const avgKwh = slotCounts[slot] > 0 ? slotSums[slot] / slotCounts[slot] : 0;
    return { hhmm, avgKw: round2(avgKwh * 4) };
  });

  return {
    source,
    timezone,
    coverageStart: daily[0]?.date ?? null,
    coverageEnd: daily[daily.length - 1]?.date ?? null,
    intervalCount: intervals.length,
    daily,
    monthly,
    weekdayKwh: round2(weekdayKwh),
    weekendKwh: round2(weekendKwh),
    fifteenCurve,
    stitchedMonth: monthlyBuild.stitchedMonth,
  };
}

/** Fetch all travel/vacant ranges stored in scenario events for this house (all scenarios). */
async function getTravelRangesFromDb(userId: string, houseId: string): Promise<Array<{ startDate: string; endDate: string }>> {
  const scenarios = await (prisma as any).usageSimulatorScenario.findMany({
    where: { userId, houseId, archivedAt: null },
    select: { id: true },
  }).catch(() => []);
  if (!scenarios?.length) return [];
  const scenarioIds = scenarios.map((s: { id: string }) => s.id);
  const events = await (prisma as any).usageSimulatorScenarioEvent.findMany({
    where: { scenarioId: { in: scenarioIds }, kind: "TRAVEL_RANGE" },
    select: { payloadJson: true },
  }).catch(() => []);
  const seen = new Set<string>();
  const out: Array<{ startDate: string; endDate: string }> = [];
  for (const e of events ?? []) {
    const p = (e as any)?.payloadJson ?? {};
    const startDate = typeof p?.startDate === "string" ? String(p.startDate).slice(0, 10) : "";
    const endDate = typeof p?.endDate === "string" ? String(p.endDate).slice(0, 10) : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) continue;
    const key = `${startDate}\t${endDate}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ startDate, endDate });
  }
  out.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate));
  return out;
}

const REPORT_VERSION = "gapfill_lab_report_v3";
const TRUNCATE_LIST = 30;

function buildFullReport(args: {
  reportVersion: string;
  generatedAt: string;
  env: string;
  houseId: string;
  userId: string | null;
  email: string;
  houseLabel: string;
  timezone: string;
  timezoneUsedForScoring?: string;
  testRangesInput: Array<{ startDate: string; endDate: string }>;
  travelRangesFromDb: Array<{ startDate: string; endDate: string }>;
  guardrailExcludedRanges: Array<{ startDate: string; endDate: string }>;
  listTestDateKeys: string[];
  testIntervalsCount: number;
  testDaysCount: number;
  guardrailExcludedDateKeysCount: number;
  guardrailExcludedDateKeysSample: string[];
  dateKeyDiag?: {
    travelDateKeysLocalCount: number;
    travelDateKeysLocalSample: string[];
    testDateKeysLocalCount: number;
    testDateKeysLocalSample: string[];
    guardrailExcludedDateKeysCount: number;
    guardrailExcludedDateKeysSample: string[];
    setArithmetic: {
      onlyTravelCount: number;
      onlyTravelSample: string[];
      onlyTestCount: number;
      onlyTestSample: string[];
      overlapCount: number;
      overlapSample: string[];
    };
  };
  dataset: { summary: any; totals: any; insights: any; monthly?: Array<{ month?: string; kwh?: number }> };
  buildInputs: { canonicalMonths: string[] };
  configHash: string;
  excludedDateKeysCount: number;
  excludedDateKeysSample: string[];
  homeProfile: any;
  applianceProfile: any;
  modelAssumptions: any;
  artifactSourceMode: string | null;
  requestedInputHash: string | null;
  artifactInputHashUsed: string | null;
  artifactHashMatch: boolean | null;
  artifactScenarioId: string | null;
  artifactCreatedAt: string | null;
  artifactUpdatedAt: string | null;
  artifactSourceNote: string | null;
  metrics: {
    mae: number;
    rmse: number;
    maxAbs: number;
    wape: number;
    mape: number;
    totalActualKwhMasked: number;
    totalSimKwhMasked: number;
    deltaKwhMasked: number;
    mapeFiltered: number | null;
    mapeFilteredCount: number;
    byMonth: Array<{ month: string; count: number; totalActual: number; totalSim: number; wape: number; mae: number }>;
    byHour: Array<{ hour: number; actualMeanKwh?: number; simMeanKwh?: number; deltaMeanKwh?: number; sumAbs: number }>;
    worst10Abs: Array<{ date: string; actualKwh: number; simKwh: number; deltaKwh: number }>;
  };
  diagnostics: {
    dailyTotalsMasked: Array<{ date: string; actualKwh: number; simKwh: number; deltaKwh: number }>;
    top10Under: Array<{ date: string; actualKwh: number; simKwh: number; deltaKwh: number }>;
    top10Over: Array<{ date: string; actualKwh: number; simKwh: number; deltaKwh: number }>;
    hourlyProfileMasked: Array<{ hour: number; actualMeanKwh: number; simMeanKwh: number; deltaMeanKwh: number }>;
  };
  poolHoursLens: { poolHours: { wape: number | null; mae: number | null }; nonPoolHours: { wape: number | null; mae: number | null }; rule: string } | null;
  usageShapeProfileDiag?: {
    found: boolean;
    id: string | null;
    version: string | null;
    derivedAt: string | null;
    windowStartUtc: string | null;
    windowEndUtc: string | null;
    profileMonthKeys: string[];
    weekdayAvgLen: number | null;
    weekendAvgLen: number | null;
    canonicalMonths: string[];
    canonicalMonthsLen: number;
    reasonNotUsed: string | null;
  } | null;
  profileAutoBuilt?: boolean;
  cacheHit?: boolean;
  userCacheTried?: boolean;
  userCacheHit?: boolean;
  userScenarioIdUsed?: string | null;
  labCacheHit?: boolean;
  cacheSource?: "user" | "lab" | "rebuilt";
  inputHash?: string;
  intervalDataFingerprint?: string;
  engineVersion?: string;
  intervalsCodec?: string;
  compressedBytesLength?: number;
  pastWindowDiag?: {
    canonicalMonthsLen: number;
    firstMonth: string | null;
    lastMonth: string | null;
    windowStartUtc: string | null;
    windowEndUtc: string | null;
    sourceOfWindow: "buildInputs" | "baselineBuild" | "actualSummaryFallback";
  };
  pastBuildIntervalsFetchCount?: number;
  cacheKeyDiag?: {
    inputHash: string | null;
    engineVersion: string | null;
    intervalDataFingerprint: string | null;
    scenarioId: string | null;
  };
  // LEGACY / NON-AUTHORITATIVE: gapfill_test_days_profile may appear in older copied reports.
  enginePath?: "production_past_stitched" | "gapfill_test_days_profile";
  expectedTestIntervals?: number;
  coveragePct?: number | null;
  joinJoinedCount?: number;
  joinMissingCount?: number;
  joinPct?: number | null;
  joinSampleActualTs?: string[];
  joinSampleSimTs?: string[];
  profileSource?: "db" | "auto_built_lite";
  trainingWindowStartUtc?: string | null;
  trainingWindowEndUtc?: string | null;
  trainingIntervalsCount?: number | null;
  trainingDaysCount?: number | null;
  testSelectionMode?: "manual_ranges" | "random_days";
  testDaysRequested?: number;
  testDaysSelected?: number;
  seedUsed?: string | null;
  testMode?: string;
  candidateDaysAfterModeFilterCount?: number | null;
  minDayCoveragePct?: number;
  candidateWindowStartUtc?: string | null;
  candidateWindowEndUtc?: string | null;
  trainingMaxDays?: number;
  trainingGapDays?: number;
  excludedFromTest_travelCount?: number;
  excludedFromTraining_travelCount?: number;
  excludedFromTraining_testCount?: number;
  trainingSelectionMode?: "before_range" | "all_non_test_days";
  trainingEligibleDateKeysCount?: number;
  trainingDateKeysSample?: string[];
  trainingMonthDayCountsSample?: Record<string, number>;
  trainingCoverage?: { expected: number; found: number | null; pct: number | null };
  dayTotalDiagnostics?: DayTotalDiagnostics;
  weatherUsed?: boolean;
  weatherNote?: string;
  simulatedDayDiagnosticsSample?: Array<{
    localDate: string;
    targetDayKwhBeforeWeather: number;
    weatherAdjustedDayKwh: number;
    dayTypeUsed: "weekday" | "weekend" | null;
    shapeVariantUsed: string | null;
    finalDayKwh: number;
    intervalSumKwh: number;
    fallbackLevel: string | null;
  }>;
  weatherApiData?: Array<{ dateKey: string; kind: string; tAvgF: number; tMinF: number; tMaxF: number; hdd65: number; cdd65: number; source: string }>;
  weatherKindUsed?: string;
  weatherRowsBySource?: Record<string, number>;
  weatherSourcesSeen?: string[];
  weatherSourceMismatchDetected?: boolean;
  weatherRowCount?: number;
  simulationWeatherSourceOwner?: string;
  reportWeatherSourceOwner?: string;
  simulationAndReportWeatherMatch?: boolean;
  weatherValidationFingerprint?: { firstRow: string; lastRow: string; rowCount: number };
  scoredDayWeatherRows?: Array<{
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
  }>;
  scoredDayWeatherTruth?: {
    availability: "available" | "missing_expected_scored_day_weather";
    reasonCode: "SCORED_DAY_WEATHER_AVAILABLE" | "SCORED_DAY_WEATHER_MISSING";
    explanation: string;
    source: "shared_compare_scored_day_weather";
    scoredDateCount: number;
    weatherRowCount: number;
    missingDateCount: number;
    missingDateSample: string[];
  };
  benchmarkSummary?: {
    benchmarkAvailable: boolean;
    benchmarkSource: "request_payload" | "prior_run_copy" | "none";
    currentWAPE_pct: number;
    benchmarkWAPE_pct: number | null;
    wapeDelta_pct: number | null;
    currentMAE_kwhPer15m: number;
    benchmarkMAE_kwhPer15m: number | null;
    maeDelta_kwhPer15m: number | null;
    currentTotalSimKwhMasked: number;
    benchmarkTotalSimKwhMasked: number | null;
    totalSimBiasDeltaKwh: number | null;
    currentWorstAbsDayDeltaKwh: number;
    benchmarkWorstAbsDayDeltaKwh: number | null;
    worstAbsDayDeltaChangeKwh: number | null;
    currentWorstDayDate?: string | null;
    benchmarkWorstDayDate?: string | null;
    monthlyComparison?: Array<{ month: string; currentWAPE: number; benchmarkWAPE: number | null; delta: number | null }> | null;
  };
  benchmarkPayloadForCopy?: string;
}): { fullReportJson: object; fullReportText: string } {
  const j = args;
  const round2 = (x: number) => Math.round(x * 100) / 100;
  const enginePath = j.enginePath ?? "production_past_stitched";
  const modelMeta =
    j.modelAssumptions && typeof j.modelAssumptions === "object" ? (j.modelAssumptions as Record<string, unknown>) : {};
  const simVersionMapped = String(
    modelMeta.simVersion ?? (modelMeta as any)?.meta?.simVersion ?? "production_builder"
  );
  const derivationVersionMapped = String(
    modelMeta.derivationVersion ??
      modelMeta.shapeDerivationVersion ??
      (modelMeta as any)?.meta?.shapeDerivationVersion ??
      "v1"
  );
  const weekdayWeekendSplitUsedMapped = Boolean(
    modelMeta.weekdayWeekendSplitUsed ?? (modelMeta as any)?.intradayShape?.weekdayWeekendSplit ?? false
  );
  const dayTotalSourceMapped = String(modelMeta.dayTotalSource ?? "fallback_month_avg");
  const weatherSourceSummaryMapped = String(modelMeta.weatherSourceSummary ?? "").trim();
  const weatherUsedMapped =
    enginePath === "production_past_stitched" &&
    (Boolean(modelMeta.weatherUsed) ||
      weatherSourceSummaryMapped === "actual_only" ||
      weatherSourceSummaryMapped === "mixed_actual_and_stub" ||
      weatherSourceSummaryMapped === "stub_only");
  const weatherNoteMapped =
    String(modelMeta.weatherNote ?? "").trim() ||
    (enginePath === "production_past_stitched"
      ? `Weather integrated in shared past path (${weatherSourceSummaryMapped || "unknown"}).`
      : "Weather not integrated in gap-fill test-days profile path.");
  const expectedTestIntervals = j.expectedTestIntervals ?? j.testDaysCount * 96;
  const missingTestIntervals = expectedTestIntervals - j.testIntervalsCount;
  const coveragePct: number | null = j.coveragePct ?? (expectedTestIntervals > 0 ? j.testIntervalsCount / expectedTestIntervals : null);
  const monthlyTotals: Record<string, number> = {};
  for (const m of j.dataset.monthly ?? []) {
    const month = String(m?.month ?? "").slice(0, 7);
    if (month) monthlyTotals[month] = round2(Number(m?.kwh) || 0);
  }
  const baseloadDailyNum = j.dataset.insights?.baseloadDaily != null ? Number(j.dataset.insights.baseloadDaily) : null;
  const baseloadRaw = j.dataset.insights?.baseload != null ? Number(j.dataset.insights.baseload) : null;
  const useDailyForBaseload = baseloadDailyNum != null && Number.isFinite(baseloadDailyNum) && baseloadDailyNum >= 0;
  const baseloadKwhPer15m = useDailyForBaseload
    ? round2(baseloadDailyNum / 96)
    : baseloadRaw != null && Number.isFinite(baseloadRaw)
      ? round2(baseloadRaw / 4)
      : null;
  const baseloadUnit = useDailyForBaseload ? "kwh_per_15m_from_daily" : baseloadRaw != null ? "kw" : null;
  const timeOfDay = (j.dataset.insights?.timeOfDayBuckets ?? []).map((b: any) => ({ key: b.key, label: b.label, kwh: b.kwh }));
  const weekdayWeekend = j.dataset.insights?.weekdayVsWeekend ?? { weekday: 0, weekend: 0 };
  const totalWw = (weekdayWeekend.weekday ?? 0) + (weekdayWeekend.weekend ?? 0);
  const peakDay = j.dataset.insights?.peakDay ?? null;
  const peakHour = j.dataset.insights?.peakHour ?? null;

  const fullReportJson = {
    reportVersion: j.reportVersion,
    generatedAt: j.generatedAt,
    env: j.env,
    identifiers: {
      houseId: j.houseId,
      userId: j.userId,
      email: j.email,
      houseLabel: j.houseLabel,
      timezone: j.timezone,
      timezoneUsedForScoring: j.timezoneUsedForScoring ?? j.timezone,
    },
    scenario: {
      travelRangesFromDb: j.travelRangesFromDb,
      testRangesInput: j.testRangesInput,
      guardrailExcludedRanges: j.guardrailExcludedRanges,
      travelDateKeysLocalCount: j.dateKeyDiag?.travelDateKeysLocalCount ?? 0,
      travelDateKeysLocalSample: j.dateKeyDiag?.travelDateKeysLocalSample ?? [],
      testDateKeysLocalCount: j.dateKeyDiag?.testDateKeysLocalCount ?? 0,
      testDateKeysLocalSample: j.dateKeyDiag?.testDateKeysLocalSample ?? [],
      onlyTravelCount: j.dateKeyDiag?.setArithmetic?.onlyTravelCount ?? 0,
      onlyTravelSample: j.dateKeyDiag?.setArithmetic?.onlyTravelSample ?? [],
      onlyTestCount: j.dateKeyDiag?.setArithmetic?.onlyTestCount ?? 0,
      onlyTestSample: j.dateKeyDiag?.setArithmetic?.onlyTestSample ?? [],
      overlapCount: j.dateKeyDiag?.setArithmetic?.overlapCount ?? 0,
      overlapSample: j.dateKeyDiag?.setArithmetic?.overlapSample ?? [],
      testSelectionMode: j.testSelectionMode ?? "manual_ranges",
      testDaysRequested: j.testDaysRequested,
      testDaysSelected: j.testDaysSelected,
      seedUsed: j.seedUsed ?? null,
      testMode: j.testMode ?? "fixed",
      candidateDaysAfterModeFilterCount: j.candidateDaysAfterModeFilterCount ?? null,
      minDayCoveragePct: j.minDayCoveragePct,
      candidateWindowStartUtc: j.candidateWindowStartUtc ?? null,
      candidateWindowEndUtc: j.candidateWindowEndUtc ?? null,
      trainingMaxDays: j.trainingMaxDays,
      trainingGapDays: j.trainingGapDays,
      excludedFromTest_travelCount: j.excludedFromTest_travelCount,
      excludedFromTraining_travelCount: j.excludedFromTraining_travelCount,
      excludedFromTraining_testCount: j.excludedFromTraining_testCount,
      trainingSelectionMode: j.trainingSelectionMode ?? null,
      trainingEligibleDateKeysCount: j.trainingEligibleDateKeysCount ?? null,
      trainingDateKeysSample: j.trainingDateKeysSample ?? [],
      trainingMonthDayCountsSample: j.trainingMonthDayCountsSample ?? {},
      trainingCoverage: j.trainingCoverage,
      testIntervalsCount: j.testIntervalsCount,
      testDaysCount: j.testDaysCount,
      listTestDateKeys: j.listTestDateKeys,
      guardrailExcludedDateKeysCount: j.guardrailExcludedDateKeysCount,
      expectedTestIntervals: expectedTestIntervals,
      missingTestIntervals: missingTestIntervals,
      coveragePct: coveragePct,
      ...(j.dateKeyDiag ? { dateKeyDiag: j.dateKeyDiag } : {}),
    },
    parity: {
      windowStartUtc: j.dataset.summary?.start ?? null,
      windowEndUtc: j.dataset.summary?.end ?? null,
      testWindowStartUtc: j.dataset.summary?.start ?? null,
      testWindowEndUtc: j.dataset.summary?.end ?? null,
      intervalCount: j.dataset.summary?.intervalsCount ?? null,
      testWindowKwh: j.dataset.totals?.netKwh ?? null,
      annualKwh: j.dataset.totals?.netKwh ?? null, // legacy; same as testWindowKwh (deprecated, remove after one deploy)
      monthlyTotals,
      baseloadKwhPer15m,
      baseloadUnit: baseloadUnit ?? undefined,
      baseloadDailyKwh: j.dataset.insights?.baseloadDaily ?? null,
      baseloadMonthlyKwh: j.dataset.insights?.baseloadMonthly ?? null,
      weekdayWeekendSplit: { weekdayKwh: weekdayWeekend.weekday, weekendKwh: weekdayWeekend.weekend, weekdayPct: totalWw > 0 ? round2((Number(weekdayWeekend.weekday) / totalWw) * 100) : null, weekendPct: totalWw > 0 ? round2((Number(weekdayWeekend.weekend) / totalWw) * 100) : null },
      timeOfDaySplit: timeOfDay,
      peakDay,
      peakHour,
    },
    homeProfile: j.homeProfile,
    applianceProfile: j.applianceProfile,
    engine: {
      enginePath: enginePath,
      functionsUsed:
        enginePath === "gapfill_test_days_profile"
          ? "getSimulatedUsageForHouseScenario(readMode=artifact_only) -> computeGapFillMetrics"
          : "getPastSimulatedDatasetForHouse -> buildPastSimulatedBaselineV1 -> buildCurveFromPatchedIntervals -> buildSimulatedUsageDatasetFromCurve",
      ...(enginePath === "gapfill_test_days_profile"
        ? { daySimulationCore: SOURCE_OF_DAY_SIMULATION_CORE, sameEngineAsPastProduction: true }
        : {}),
      simVersion: simVersionMapped,
      derivationVersion: derivationVersionMapped,
      configHash: j.configHash,
      cacheHit: j.cacheHit ?? false,
      userCacheTried: j.userCacheTried ?? false,
      userCacheHit: j.userCacheHit ?? false,
      userScenarioIdUsed: j.userScenarioIdUsed ?? null,
      labCacheHit: j.labCacheHit ?? false,
      cacheSource: j.cacheSource ?? "rebuilt",
      inputHash: j.inputHash ?? null,
      intervalDataFingerprint: j.intervalDataFingerprint ?? null,
      engineVersion: j.engineVersion ?? null,
      intervalsCodec: j.intervalsCodec ?? null,
      compressedBytesLength: j.compressedBytesLength ?? null,
      weekdayWeekendSplitUsed: weekdayWeekendSplitUsedMapped,
      dayTotalSource: dayTotalSourceMapped,
      ...(j.pastWindowDiag ? { pastWindowDiag: j.pastWindowDiag } : {}),
      pastBuildIntervalsFetchCount: j.pastBuildIntervalsFetchCount ?? undefined,
      ...(j.cacheKeyDiag ? { cacheKeyDiag: j.cacheKeyDiag } : {}),
      usageShapeProfileDiag: j.usageShapeProfileDiag ?? null,
      profileAutoBuilt: j.profileAutoBuilt ?? false,
      canonicalMonths: j.buildInputs?.canonicalMonths ?? [],
      guardrailExcludedDateKeysCount: j.guardrailExcludedDateKeysCount ?? 0,
      guardrailExcludedDateKeysSample: j.guardrailExcludedDateKeysSample ?? [],
      testDateKeysLocalCount: j.dateKeyDiag?.testDateKeysLocalCount ?? 0,
      testDateKeysLocalSample: j.dateKeyDiag?.testDateKeysLocalSample ?? [],
      excludedDateKeysCount: j.excludedDateKeysCount ?? 0,
      excludedDateKeysSample: j.excludedDateKeysSample ?? [],
      expectedTestIntervals: j.expectedTestIntervals ?? undefined,
      coveragePct: j.coveragePct ?? undefined,
      joinJoinedCount: j.joinJoinedCount ?? undefined,
      joinMissingCount: j.joinMissingCount ?? undefined,
      joinPct: j.joinPct != null ? round2(j.joinPct * 100) + "%" : undefined,
      joinSampleActualTs: j.joinSampleActualTs ?? undefined,
      joinSampleSimTs: j.joinSampleSimTs ?? undefined,
      profileSource: j.profileSource ?? undefined,
      trainingWindowStartUtc: j.trainingWindowStartUtc ?? undefined,
      trainingWindowEndUtc: j.trainingWindowEndUtc ?? undefined,
      trainingIntervalsCount: j.trainingIntervalsCount ?? undefined,
      trainingDaysCount: j.trainingDaysCount ?? undefined,
      weatherUsed: weatherUsedMapped,
      weatherNote: weatherNoteMapped,
      ...(Array.isArray(j.simulatedDayDiagnosticsSample) && j.simulatedDayDiagnosticsSample.length > 0
        ? { simulatedDayDiagnosticsSample: j.simulatedDayDiagnosticsSample }
        : {}),
      ...(j.weatherKindUsed != null ? { weatherKindUsed: j.weatherKindUsed } : {}),
      ...(Array.isArray(j.weatherApiData) && j.weatherApiData.length > 0 ? { weatherApiData: j.weatherApiData } : {}),
      ...(Array.isArray(j.scoredDayWeatherRows) && j.scoredDayWeatherRows.length > 0
        ? { scoredDayWeatherRows: j.scoredDayWeatherRows }
        : {}),
      ...(j.scoredDayWeatherTruth ? { scoredDayWeatherTruth: j.scoredDayWeatherTruth } : {}),
      ...(j.weatherRowsBySource && Object.keys(j.weatherRowsBySource).length > 0 ? { weatherRowsBySource: j.weatherRowsBySource } : {}),
      ...(Array.isArray(j.weatherSourcesSeen) && j.weatherSourcesSeen.length > 0 ? { weatherSourcesSeen: j.weatherSourcesSeen } : {}),
      ...(j.weatherSourceMismatchDetected === true ? { weatherSourceMismatchDetected: true } : {}),
      ...(j.dayTotalDiagnostics ? { dayTotalDiagnostics: j.dayTotalDiagnostics } : {}),
    },
    accuracy: {
      MAE_kwhPer15m: j.metrics.mae,
      RMSE_kwhPer15m: j.metrics.rmse,
      MaxAbs_kwhPer15m: j.metrics.maxAbs,
      WAPE_pct: j.metrics.wape,
      MAPE_pct: j.metrics.mape,
      MAPE_unsafe_near_zero: "MAPE is unstable when actual is near zero; prefer WAPE.",
      MAPE_filtered_pct: j.metrics.mapeFiltered,
      MAPE_filtered_count: j.metrics.mapeFilteredCount,
      totalActualKwhMasked: j.metrics.totalActualKwhMasked,
      totalSimKwhMasked: j.metrics.totalSimKwhMasked,
      deltaKwhMasked: j.metrics.deltaKwhMasked,
    },
    dailyTotalsComparison: {
      top10Under: j.diagnostics.top10Under,
      top10Over: j.diagnostics.top10Over,
      worst10Abs: j.metrics.worst10Abs,
    },
    hourlyProfileComparison: {
      rows: j.diagnostics.hourlyProfileMasked,
      peakHoursWorst: (() => {
        const withSumAbs = j.metrics.byHour.map((h) => ({ hour: h.hour, sumAbs: (h as any).sumAbs ?? 0 }));
        return withSumAbs.sort((a, b) => b.sumAbs - a.sumAbs).slice(0, 8).map((x) => x.hour);
      })(),
    },
    poolHoursLens: j.poolHoursLens,
    byMonthLens: j.metrics.byMonth.map((m) => ({ month: m.month, count: m.count, totalActual: m.totalActual, totalSim: m.totalSim, wape: m.wape, mae: m.mae })),
    ...(j.benchmarkSummary ? { benchmarkRegression: { summary: j.benchmarkSummary } } : {}),
    ...(j.benchmarkPayloadForCopy ? { benchmarkPayloadForCopy: j.benchmarkPayloadForCopy } : {}),
    notes: [] as string[],
  };

  if ((j.enginePath ?? "production_past_stitched") !== "gapfill_test_days_profile" && (j.dataset.summary?.intervalsCount ?? 0) !== 35136) fullReportJson.notes.push(`intervalCount ${j.dataset.summary?.intervalsCount} differs from expected 35136.`);
  const baseloadDaily = Number(j.dataset.insights?.baseloadDaily);
  if (Number.isFinite(baseloadDaily) && (baseloadDaily > 80 || baseloadDaily < 5)) fullReportJson.notes.push(`baseloadDailyKwh ${baseloadDaily} is unusually high or low.`);
  const highWapeMonth = j.metrics.byMonth.find((m) => m.wape > 80);
  if (highWapeMonth) fullReportJson.notes.push(`Masked month ${highWapeMonth.month} WAPE ${highWapeMonth.wape}% is much higher than others.`);
  if (j.dayTotalDiagnostics?.dayTotalGuardrailAppliedCount != null && j.dayTotalDiagnostics.dayTotalGuardrailAppliedCount > 0) {
    fullReportJson.notes.push(`Day-total guardrail applied on ${j.dayTotalDiagnostics.dayTotalGuardrailAppliedCount} tested days.`);
  }
  const wxSummary = j.dayTotalDiagnostics?.weatherAdjustmentSummary;
  if (wxSummary?.daysWithWeatherMultiplier != null && wxSummary.daysWithWeatherMultiplier > 0) {
    fullReportJson.notes.push(`Weather multiplier applied on ${wxSummary.daysWithWeatherMultiplier} tested days.`);
  }
  if (wxSummary?.daysWithAuxHeatAdder != null && wxSummary.daysWithAuxHeatAdder > 0) {
    fullReportJson.notes.push(`Aux heat adder applied on ${wxSummary.daysWithAuxHeatAdder} tested days.`);
  }
  if (wxSummary?.daysWithPoolFreezeProtectAdder != null && wxSummary.daysWithPoolFreezeProtectAdder > 0) {
    fullReportJson.notes.push(`Pool freeze-protect adder applied on ${wxSummary.daysWithPoolFreezeProtectAdder} tested days.`);
  }
  if (j.joinPct != null && j.joinPct < 0.95) {
    fullReportJson.notes.push("ERROR: simulated intervals did not join to actual timestamps; check timestamp keying.");
    if (Array.isArray(j.joinSampleActualTs) && j.joinSampleActualTs.length > 0) {
      fullReportJson.notes.push("joinSampleActualTs (first missing): " + j.joinSampleActualTs.slice(0, 5).join(", "));
    }
    if (Array.isArray(j.joinSampleSimTs) && j.joinSampleSimTs.length > 0) {
      fullReportJson.notes.push("joinSampleSimTs (first 5): " + j.joinSampleSimTs.slice(0, 5).join(", "));
    }
  }

  const lines: string[] = [];
  const section = (title: string, block: () => void) => {
    lines.push(`\n=== ${title} ===`);
    block();
  };
  const kv = (k: string, v: unknown) => lines.push(`${k}: ${v === null || v === undefined ? "—" : String(v)}`);
  const listTrunc = (arr: string[], max: number) => (arr.length <= max ? arr : [...arr.slice(0, max), `...(${arr.length - max} more)`]);

  section("A) Header / identifiers", () => {
    kv("reportVersion", j.reportVersion);
    kv("generatedAt", j.generatedAt);
    kv("env", j.env);
    kv("houseId", j.houseId);
    kv("userId", j.userId ?? "—");
    kv("email", j.email);
    kv("houseLabel", j.houseLabel);
    kv("timezone", j.timezone);
    kv("timezoneUsedForScoring", j.timezoneUsedForScoring ?? j.timezone);
  });

  section("B) Scenario: Vacant/Travel (DB) vs Test Dates", () => {
    if (j.testSelectionMode === "random_days") {
      kv("testSelectionMode", "random_days");
      kv("testMode", j.testMode ?? "fixed");
      kv("testDaysRequested", j.testDaysRequested ?? "—");
      kv("testDaysSelected", j.testDaysSelected ?? "—");
      kv("seedUsed", j.seedUsed ?? "—");
      kv("candidateDaysAfterModeFilterCount", j.candidateDaysAfterModeFilterCount ?? "—");
      kv("minDayCoveragePct", j.minDayCoveragePct != null ? round2((j.minDayCoveragePct as number) * 100) + "%" : "—");
      kv("candidateWindowStartUtc", j.candidateWindowStartUtc ?? "—");
      kv("candidateWindowEndUtc", j.candidateWindowEndUtc ?? "—");
      kv("excludedFromTest_travelCount", j.excludedFromTest_travelCount ?? "—");
    } else {
      kv("testSelectionMode", "manual_ranges");
    }
    kv("trainingMaxDays", j.trainingMaxDays ?? "—");
    kv("trainingGapDays", j.trainingGapDays ?? "—");
    kv("excludedFromTraining_travelCount", j.excludedFromTraining_travelCount ?? "—");
    kv("excludedFromTraining_testCount", j.excludedFromTraining_testCount ?? "—");
    kv("trainingSelectionMode", j.trainingSelectionMode ?? "—");
    kv("trainingEligibleDateKeysCount", j.trainingEligibleDateKeysCount ?? "—");
    if ((j.trainingDateKeysSample?.length ?? 0) > 0) lines.push("trainingDateKeysSample: " + listTrunc(j.trainingDateKeysSample!, 15).join(", "));
    if (j.trainingMonthDayCountsSample && Object.keys(j.trainingMonthDayCountsSample).length > 0) lines.push("trainingMonthDayCountsSample: " + JSON.stringify(j.trainingMonthDayCountsSample));
    if (j.trainingCoverage) {
      kv("trainingCoverage_expected", j.trainingCoverage.expected);
      kv("trainingCoverage_found", j.trainingCoverage.found ?? "—");
      kv("trainingCoverage_pct", j.trainingCoverage.pct != null ? round2((j.trainingCoverage.pct as number) * 100) + "%" : "—");
    }
    lines.push("travelRangesFromDb (Vacant/Travel): " + JSON.stringify(j.travelRangesFromDb));
    lines.push("testRangesInput (Test Dates; ONLY these scored): " + JSON.stringify(j.testRangesInput));
    lines.push("Guardrail union (Travel ∪ Test): " + JSON.stringify(j.guardrailExcludedRanges));
    lines.push("Vacant/Travel (DB) dates are guardrails and are never scored; Test Dates are the scoring set.");
    lines.push("--- Test interval coverage ---");
    kv("testIntervalsCount", j.testIntervalsCount);
    kv("testDaysCount", j.testDaysCount);
    lines.push("listTestDateKeys: " + listTrunc(j.listTestDateKeys, TRUNCATE_LIST).join(", "));
    kv("expectedTestIntervals", expectedTestIntervals);
    kv("missingTestIntervals", missingTestIntervals);
    lines.push("coveragePct: " + (coveragePct != null ? round2(coveragePct * 100) + "%" : "—"));
    if (j.dateKeyDiag) {
      const d = j.dateKeyDiag;
      lines.push("--- Date key diagnostics (local) ---");
      kv("travelDateKeysLocalCount", d.travelDateKeysLocalCount);
      lines.push("travelDateKeysLocalSample: " + listTrunc(d.travelDateKeysLocalSample, 10).join(", "));
      kv("testDateKeysLocalCount", d.testDateKeysLocalCount);
      lines.push("testDateKeysLocalSample: " + listTrunc(d.testDateKeysLocalSample, 10).join(", "));
      kv("guardrailExcludedDateKeysCount", d.guardrailExcludedDateKeysCount);
      lines.push("guardrailExcludedDateKeysSample: " + listTrunc(d.guardrailExcludedDateKeysSample, 10).join(", "));
      lines.push("--- Set arithmetic ---");
      kv("onlyTravelCount", d.setArithmetic.onlyTravelCount);
      lines.push("onlyTravelSample: " + listTrunc(d.setArithmetic.onlyTravelSample, 10).join(", "));
      kv("onlyTestCount", d.setArithmetic.onlyTestCount);
      lines.push("onlyTestSample: " + listTrunc(d.setArithmetic.onlyTestSample, 10).join(", "));
      kv("overlapCount", d.setArithmetic.overlapCount);
      lines.push("overlapSample: " + listTrunc(d.setArithmetic.overlapSample, 10).join(", "));
    }
  });

  section("C) Test window summary (scoring window only)", () => {
    lines.push(
      enginePath === "gapfill_test_days_profile"
        ? "Note: Gap-Fill Lab test-days profile path summarizes the scored test window only."
        : "Note: Gap-Fill Lab production path uses shared Past stitched simulation across the full canonical window; scoring still uses Test Dates only."
    );
    kv("windowStartUtc", j.dataset.summary?.start);
    kv("windowEndUtc", j.dataset.summary?.end);
    kv("intervalCount", j.dataset.summary?.intervalsCount);
    kv("testWindowKwh", j.dataset.totals?.netKwh != null ? round2(j.dataset.totals.netKwh) : null);
    lines.push("monthlyTotals (YYYY-MM => kWh): " + JSON.stringify(monthlyTotals));
    kv("baseloadKwhPer15m", baseloadKwhPer15m);
    kv("baseloadDailyKwh", j.dataset.insights?.baseloadDaily);
    kv("baseloadMonthlyKwh", j.dataset.insights?.baseloadMonthly);
    lines.push(`weekdayWeekendSplit: weekday ${round2(Number(weekdayWeekend.weekday))} kWh (${totalWw > 0 ? round2((Number(weekdayWeekend.weekday) / totalWw) * 100) : "—"}%) | weekend ${round2(Number(weekdayWeekend.weekend))} kWh (${totalWw > 0 ? round2((Number(weekdayWeekend.weekend) / totalWw) * 100) : "—"}%)`);
    timeOfDay.forEach((b: any) => lines.push(`  ${b.label}: ${b.kwh} kWh`));
    if (peakDay) lines.push(`peakDay: ${peakDay.date} ${peakDay.kwh} kWh`);
    if (peakHour != null) lines.push("peakHour: " + JSON.stringify(peakHour));
  });

  section("D) Home Profile", () => lines.push(JSON.stringify(j.homeProfile, null, 2)));

  section("E) Appliance Profile", () => {
    kv("applianceCount", j.applianceProfile?.applianceCount ?? 0);
    const apps = j.applianceProfile?.appliances ?? [];
    apps.slice(0, TRUNCATE_LIST).forEach((a: any, i: number) => lines.push(`  [${i}] type=${a?.type} data=${JSON.stringify(a?.data ?? {}).slice(0, 120)}${(JSON.stringify(a?.data ?? {}).length > 120 ? "…" : "")}`));
    if (apps.length > TRUNCATE_LIST) lines.push(`  ...(${apps.length - TRUNCATE_LIST} more appliances)`);
    const hasPool = j.homeProfile?.pool?.hasPool ?? apps.some((a: any) => a?.type === "pool");
    const hasEV = apps.some((a: any) => a?.type === "ev" || a?.type === "electric_vehicle");
    const hasElectricWH = apps.some((a: any) => a?.type === "water_heater" || a?.type === "electric_water_heater");
    lines.push(`flags: hasPool=${hasPool} hasEV=${hasEV} hasElectricWH=${hasElectricWH}`);
  });

  section("F) Simulator engine path + config", () => {
    kv("enginePath", fullReportJson.engine.enginePath);
    lines.push("functionsUsed: " + (fullReportJson.engine as any).functionsUsed);
    if (enginePath === "gapfill_test_days_profile") {
      kv("daySimulationCore", (fullReportJson.engine as any).daySimulationCore ?? SOURCE_OF_DAY_SIMULATION_CORE);
      kv("sameEngineAsPastProduction", (fullReportJson.engine as any).sameEngineAsPastProduction ?? true);
      kv("profileSource", j.profileSource ?? "—");
      if (j.profileSource === "auto_built_lite") {
        kv("trainingWindowStartUtc", j.trainingWindowStartUtc ?? "—");
        kv("trainingWindowEndUtc", j.trainingWindowEndUtc ?? "—");
        kv("trainingIntervalsCount", j.trainingIntervalsCount ?? "—");
        kv("trainingDaysCount", j.trainingDaysCount ?? "—");
      }
      kv("expectedTestIntervals", j.expectedTestIntervals ?? "—");
      kv("coveragePct", j.coveragePct != null ? round2((j.coveragePct as number) * 100) + "%" : "—");
      kv("joinJoinedCount", j.joinJoinedCount ?? "—");
      kv("joinMissingCount", j.joinMissingCount ?? "—");
      kv("joinPct", j.joinPct != null ? round2((j.joinPct as number) * 100) + "%" : "—");
      lines.push("No Past cache; sim runs through the shared flow with an ensured UsageShapeProfile dependency (or fails if unavailable).");
    } else {
      kv("userCacheTried", (fullReportJson.engine as any).userCacheTried ?? false);
      kv("userCacheHit", (fullReportJson.engine as any).userCacheHit ?? false);
      kv("userScenarioIdUsed", (fullReportJson.engine as any).userScenarioIdUsed ?? "—");
      kv("labCacheHit", (fullReportJson.engine as any).labCacheHit ?? false);
      kv("cacheSource", (fullReportJson.engine as any).cacheSource ?? "rebuilt");
      kv("cacheHit", fullReportJson.engine.cacheHit);
      kv("inputHash", fullReportJson.engine.inputHash ?? "—");
      kv("intervalDataFingerprint", fullReportJson.engine.intervalDataFingerprint ?? "—");
      kv("engineVersion", fullReportJson.engine.engineVersion ?? "—");
      kv("intervalsCodec", fullReportJson.engine.intervalsCodec ?? "—");
      kv("compressedBytesLength", fullReportJson.engine.compressedBytesLength ?? "—");
      const pastWindowDiag = (fullReportJson.engine as any).pastWindowDiag;
      if (pastWindowDiag) {
        lines.push("pastWindowDiag: canonicalMonthsLen=" + pastWindowDiag.canonicalMonthsLen + " firstMonth=" + (pastWindowDiag.firstMonth ?? "—") + " lastMonth=" + (pastWindowDiag.lastMonth ?? "—") + " windowStartUtc=" + (pastWindowDiag.windowStartUtc ?? "—") + " windowEndUtc=" + (pastWindowDiag.windowEndUtc ?? "—") + " sourceOfWindow=" + (pastWindowDiag.sourceOfWindow ?? "—"));
      }
      kv("pastBuildIntervalsFetchCount", (fullReportJson.engine as any).pastBuildIntervalsFetchCount ?? "—");
      const cacheKeyDiag = (fullReportJson.engine as any).cacheKeyDiag;
      if (cacheKeyDiag) {
        lines.push("cacheKeyDiag: inputHash=" + (cacheKeyDiag.inputHash ?? "—") + " engineVersion=" + (cacheKeyDiag.engineVersion ?? "—") + " intervalDataFingerprint=" + (cacheKeyDiag.intervalDataFingerprint ?? "—") + " scenarioId=" + (cacheKeyDiag.scenarioId ?? "—"));
      }
    }
    kv("simVersion", fullReportJson.engine.simVersion);
    kv("derivationVersion", fullReportJson.engine.derivationVersion);
    kv("configHash", j.configHash);
    kv("weekdayWeekendSplitUsed", fullReportJson.engine.weekdayWeekendSplitUsed);
    kv("dayTotalSource", fullReportJson.engine.dayTotalSource);
    kv("guardrailExcludedDateKeysCount", j.guardrailExcludedDateKeysCount);
    lines.push("guardrailExcludedDateKeysSample: " + listTrunc(j.guardrailExcludedDateKeysSample, 10).join(", "));
    kv("testDateKeysLocalCount", j.dateKeyDiag?.testDateKeysLocalCount ?? 0);
    lines.push("testDateKeysLocalSample: " + listTrunc(j.dateKeyDiag?.testDateKeysLocalSample ?? [], 10).join(", "));
    const diag = fullReportJson.engine.usageShapeProfileDiag as typeof j.usageShapeProfileDiag | undefined;
    if (diag) {
      lines.push("usageShapeProfile: found=" + diag.found + " reasonNotUsed=" + (diag.reasonNotUsed ?? "(used)"));
      lines.push("usageShapeProfileDiag: " + JSON.stringify(diag, null, 2));
    } else {
      lines.push("usageShapeProfile: (no diag)");
    }
    kv("profileAutoBuilt", fullReportJson.engine.profileAutoBuilt);
    lines.push("canonicalMonths: " + (j.buildInputs?.canonicalMonths ?? []).join(", "));
    kv("excludedDateKeysCount", j.excludedDateKeysCount);
    lines.push("excludedDateKeysSample: " + listTrunc(j.excludedDateKeysSample, 10).join(", "));
    kv("weatherUsed", weatherUsedMapped);
    lines.push("weatherNote: " + weatherNoteMapped);
    if (Array.isArray(j.simulatedDayDiagnosticsSample) && j.simulatedDayDiagnosticsSample.length > 0) {
      lines.push("sharedSimulatedDayDiagnosticsSample (first 10): localDate | targetDayKwhBeforeWeather | weatherAdjustedDayKwh | dayTypeUsed | shapeVariantUsed | finalDayKwh | intervalSumKwh | fallbackLevel");
      j.simulatedDayDiagnosticsSample.slice(0, 10).forEach((r) =>
        lines.push(
          `  ${r.localDate} | ${r.targetDayKwhBeforeWeather} | ${r.weatherAdjustedDayKwh} | ${r.dayTypeUsed ?? "—"} | ${r.shapeVariantUsed ?? "—"} | ${r.finalDayKwh} | ${r.intervalSumKwh} | ${r.fallbackLevel ?? "—"}`
        )
      );
    }
    const dayDiag = j.dayTotalDiagnostics;
    if (dayDiag) {
      lines.push("profileDayTotalFallbackSummary: " + JSON.stringify(dayDiag.profileDayTotalFallbackSummary));
      lines.push("profileTrainingStrengthSample (month | weekdayCount | weekendCount | overallCount):");
      dayDiag.profileTrainingStrengthSample.forEach((r) =>
        lines.push(`  ${r.month} | ${r.weekdayCount} | ${r.weekendCount} | ${r.overallCount}`)
      );
      lines.push("testedDayFallbackSample (first 10): localDate | monthKey | dayType | fallbackLevelUsed | rawSelectedDayKwh | finalSelectedDayKwh | clampApplied");
      dayDiag.testedDayFallbackSample.forEach((r) =>
        lines.push(`  ${r.localDate} | ${r.monthKey} | ${r.dayType} | ${r.fallbackLevelUsed} | ${r.rawSelectedDayKwh} | ${r.finalSelectedDayKwh} | ${r.clampApplied}`)
      );
      kv("dayTotalGuardrailAppliedCount", dayDiag.dayTotalGuardrailAppliedCount);
    }
    if (dayDiag?.weatherAdjustmentSummary) {
      const w = dayDiag.weatherAdjustmentSummary;
      lines.push("weatherAdjustmentSummary: daysWithWeatherMultiplier=" + w.daysWithWeatherMultiplier + " daysWithAuxHeatAdder=" + w.daysWithAuxHeatAdder + " daysWithPoolFreezeProtectAdder=" + w.daysWithPoolFreezeProtectAdder + " avgWeatherSeverityMultiplier=" + round2(w.avgWeatherSeverityMultiplier) + " minWeatherSeverityMultiplier=" + round2(w.minWeatherSeverityMultiplier) + " maxWeatherSeverityMultiplier=" + round2(w.maxWeatherSeverityMultiplier) + " totalAuxHeatKwhAdded=" + round2(w.totalAuxHeatKwhAdded) + " totalPoolFreezeProtectKwhAdded=" + round2(w.totalPoolFreezeProtectKwhAdded));
      if (w.daysClassified_normal != null || w.daysClassified_weather_scaled != null || w.daysClassified_extreme_cold_event != null || w.daysClassified_freeze_protect != null) {
        lines.push("  daysClassified_normal=" + (w.daysClassified_normal ?? 0) + " daysClassified_weather_scaled=" + (w.daysClassified_weather_scaled ?? 0) + " daysClassified_extreme_cold_event=" + (w.daysClassified_extreme_cold_event ?? 0) + " daysClassified_freeze_protect=" + (w.daysClassified_freeze_protect ?? 0));
      }
    }
    if (dayDiag?.weatherTighteningSummary) {
      const t = dayDiag.weatherTighteningSummary;
      lines.push("weatherTighteningSummary: daysWithMultiplierOne=" + t.daysWithMultiplierOne + " daysWithScaledMultiplier=" + t.daysWithScaledMultiplier + " daysBlendedBackTowardProfile=" + t.daysBlendedBackTowardProfile + " avgBlendWeightWeather=" + round2(t.avgBlendWeightWeather) + " avgBlendWeightProfile=" + round2(t.avgBlendWeightProfile));
    }
    if (Array.isArray(dayDiag?.testedDayWeatherSample) && dayDiag.testedDayWeatherSample.length > 0) {
      lines.push("testedDayWeatherSample (first 10): localDate | dayType | weatherModeUsed | dayClassification | profileSelectedDayKwh | preBlendAdjustedDayKwh | weatherSeverityMultiplier | auxHeatKwhAdder | poolFreezeProtectKwhAdder | finalSelectedDayKwh | blendedBackTowardProfile | dailyAvgTempC | dailyMinTempC | heatingDegreeSeverity | coolingDegreeSeverity | freezeHoursCount | referenceHeatingSeverity | auxHeatGate_minTempPassed | auxHeatGate_freezeHoursPassed | auxHeatGate_severityPassed");
      dayDiag.testedDayWeatherSample.forEach((r) =>
        lines.push(`  ${r.localDate} | ${r.dayType} | ${r.weatherModeUsed} | ${r.dayClassification ?? "—"} | ${r.profileSelectedDayKwh} | ${r.preBlendAdjustedDayKwh ?? "—"} | ${r.weatherSeverityMultiplier} | ${r.auxHeatKwhAdder} | ${r.poolFreezeProtectKwhAdder} | ${r.finalSelectedDayKwh} | ${r.blendedBackTowardProfile ?? "—"} | ${r.dailyAvgTempC ?? "—"} | ${r.dailyMinTempC ?? "—"} | ${r.heatingDegreeSeverity} | ${r.coolingDegreeSeverity} | ${r.freezeHoursCount} | ${r.referenceHeatingSeverity ?? "—"} | ${r.auxHeatGate_minTempPassed ?? "—"} | ${r.auxHeatGate_freezeHoursPassed ?? "—"} | ${r.auxHeatGate_severityPassed ?? "—"}`)
      );
    }
  });

  section("G) Accuracy metrics (test intervals only)", () => {
    kv("MAE_kwhPer15m", j.metrics.mae);
    kv("RMSE_kwhPer15m", j.metrics.rmse);
    kv("MaxAbs_kwhPer15m", j.metrics.maxAbs);
    kv("WAPE_pct", j.metrics.wape);
    kv("MAPE_pct", j.metrics.mape);
    lines.push("MAPE_unsafe_near_zero: MAPE is unstable when actual is near zero; prefer WAPE.");
    kv("MAPE_filtered_pct (actual>=0.05 kWh)", j.metrics.mapeFiltered);
    kv("MAPE_filtered_count", j.metrics.mapeFilteredCount);
    kv("totalActualKwhMasked", j.metrics.totalActualKwhMasked);
    kv("totalSimKwhMasked", j.metrics.totalSimKwhMasked);
    kv("deltaKwhMasked", j.metrics.deltaKwhMasked);
  });

  section("G2) Benchmark / regression summary", () => {
    const bench = j.benchmarkSummary;
    if (bench) {
      kv("benchmarkAvailable", bench.benchmarkAvailable);
      kv("benchmarkSource", bench.benchmarkSource);
      kv("currentWAPE_pct", bench.currentWAPE_pct);
      kv("benchmarkWAPE_pct", bench.benchmarkWAPE_pct);
      kv("wapeDelta_pct", bench.wapeDelta_pct);
      kv("currentMAE_kwhPer15m", bench.currentMAE_kwhPer15m);
      kv("benchmarkMAE_kwhPer15m", bench.benchmarkMAE_kwhPer15m);
      kv("maeDelta_kwhPer15m", bench.maeDelta_kwhPer15m);
      kv("currentTotalSimKwhMasked", bench.currentTotalSimKwhMasked);
      kv("benchmarkTotalSimKwhMasked", bench.benchmarkTotalSimKwhMasked);
      kv("totalSimBiasDeltaKwh", bench.totalSimBiasDeltaKwh);
      kv("currentWorstAbsDayDeltaKwh", bench.currentWorstAbsDayDeltaKwh);
      kv("benchmarkWorstAbsDayDeltaKwh", bench.benchmarkWorstAbsDayDeltaKwh);
      kv("worstAbsDayDeltaChangeKwh", bench.worstAbsDayDeltaChangeKwh);
      if (bench.currentWorstDayDate != null || bench.benchmarkWorstDayDate != null) {
        lines.push("currentWorstDayDate: " + (bench.currentWorstDayDate ?? "—"));
        lines.push("benchmarkWorstDayDate: " + (bench.benchmarkWorstDayDate ?? "—"));
      }
      if (Array.isArray(bench.monthlyComparison) && bench.monthlyComparison.length > 0) {
        lines.push("month | currentWAPE | benchmarkWAPE | delta");
        bench.monthlyComparison.forEach((r) =>
          lines.push(`  ${r.month} | ${r.currentWAPE} | ${r.benchmarkWAPE ?? "—"} | ${r.delta ?? "—"}`)
        );
      }
    } else {
      lines.push("benchmarkAvailable: no");
      lines.push("benchmarkSource: none");
    }
    if (j.benchmarkPayloadForCopy) {
      lines.push("Copyable benchmark payload (paste into next run request body as \"benchmark\"):");
      lines.push("---BEGIN BENCHMARK PAYLOAD---");
      j.benchmarkPayloadForCopy.split("\n").forEach((line) => lines.push("  " + line));
      lines.push("---END BENCHMARK PAYLOAD---");
    }
  });

  section("H) Daily totals comparison (test dates)", () => {
    lines.push("top10Under (most negative delta):");
    j.diagnostics.top10Under.forEach((r) => lines.push(`  ${r.date} | actual=${r.actualKwh} sim=${r.simKwh} delta=${r.deltaKwh}`));
    lines.push("top10Over (most positive delta):");
    j.diagnostics.top10Over.forEach((r) => lines.push(`  ${r.date} | actual=${r.actualKwh} sim=${r.simKwh} delta=${r.deltaKwh}`));
    lines.push("worst10Abs:");
    j.metrics.worst10Abs.forEach((r) => lines.push(`  ${r.date} | actual=${r.actualKwh} sim=${r.simKwh} delta=${r.deltaKwh}`));
  });

  section("I) Hourly profile comparison (test)", () => {
    lines.push("hour | actualMeanKwh | simMeanKwh | deltaMeanKwh");
    j.diagnostics.hourlyProfileMasked.forEach((r) => lines.push(`  ${r.hour} | ${r.actualMeanKwh} | ${r.simMeanKwh} | ${r.deltaMeanKwh}`));
    const peakHoursWorst = (fullReportJson.hourlyProfileComparison as any).peakHoursWorst;
    lines.push("peakHoursWorst (top 8 hours by abs error sum): " + (peakHoursWorst ?? []).join(", "));
  });

  section("J) Pool hours lens", () => {
    if (j.poolHoursLens) {
      lines.push("poolHours: WAPE=" + (j.poolHoursLens.poolHours.wape ?? "—") + "% MAE=" + (j.poolHoursLens.poolHours.mae ?? "—"));
      lines.push("nonPoolHours: WAPE=" + (j.poolHoursLens.nonPoolHours.wape ?? "—") + "% MAE=" + (j.poolHoursLens.nonPoolHours.mae ?? "—"));
      lines.push("rule: " + j.poolHoursLens.rule);
    } else {
      lines.push("poolHoursLens: unavailable or no pool.");
    }
  });

  section("K) Seasonal/month lens (test intervals)", () => {
    lines.push("month | count | totalActual | totalSim | WAPE | MAE");
    j.metrics.byMonth.forEach((m) => lines.push(`  ${m.month} | ${m.count} | ${m.totalActual} | ${m.totalSim} | ${m.wape}% | ${m.mae}`));
  });

  if (j.weatherKindUsed != null || (Array.isArray(j.weatherApiData) && j.weatherApiData.length > 0)) {
    section("Weather API data (used for simulation)", () => {
      lines.push("weatherKindUsed: " + (j.weatherKindUsed ?? "—"));
      if (typeof j.weatherRowCount === "number" && j.weatherRowCount > 0) {
        lines.push("weatherRowCount: " + j.weatherRowCount);
      }
      if (Array.isArray(j.weatherSourcesSeen) && j.weatherSourcesSeen.length > 0) {
        lines.push("weatherSourcesSeen: " + j.weatherSourcesSeen.join(", "));
      }
      if (j.weatherRowsBySource && typeof j.weatherRowsBySource === "object" && Object.keys(j.weatherRowsBySource).length > 0) {
        lines.push("weatherRowsBySource: " + JSON.stringify(j.weatherRowsBySource));
      }
      if (j.weatherSourceMismatchDetected === true) {
        lines.push("weatherSourceMismatchDetected: true (report claimed real weather but every row is stub — internal inconsistency)");
      }
      if (Array.isArray(j.weatherApiData) && j.weatherApiData.length > 0) {
        lines.push("dateKey | kind | tAvgF | tMinF | tMaxF | hdd65 | cdd65 | source");
        j.weatherApiData.forEach((r) =>
          lines.push(`  ${r.dateKey} | ${r.kind} | ${r.tAvgF} | ${r.tMinF} | ${r.tMaxF} | ${r.hdd65} | ${r.cdd65} | ${r.source}`)
        );
      } else {
        lines.push("(no per-date weather rows)");
      }
    });
  }

  if (j.scoredDayWeatherTruth || (Array.isArray(j.scoredDayWeatherRows) && j.scoredDayWeatherRows.length > 0)) {
    section("Scored-day weather truth", () => {
      if (j.scoredDayWeatherTruth) {
        lines.push(
          "availability: " +
            j.scoredDayWeatherTruth.availability +
            " reasonCode: " +
            j.scoredDayWeatherTruth.reasonCode +
            " weatherRowCount: " +
            j.scoredDayWeatherTruth.weatherRowCount +
            " missingDateCount: " +
            j.scoredDayWeatherTruth.missingDateCount
        );
        if (Array.isArray(j.scoredDayWeatherTruth.missingDateSample) && j.scoredDayWeatherTruth.missingDateSample.length > 0) {
          lines.push("missingDateSample: " + j.scoredDayWeatherTruth.missingDateSample.join(", "));
        }
      }
      if (Array.isArray(j.scoredDayWeatherRows) && j.scoredDayWeatherRows.length > 0) {
        lines.push(
          "localDate | avgTempF | minTempF | maxTempF | hdd65 | cdd65 | weatherBasisUsed | weatherKindUsed | weatherSourceUsed | weatherProviderName | weatherFallbackReason"
        );
        j.scoredDayWeatherRows.forEach((row) =>
          lines.push(
            `  ${row.localDate} | ${row.avgTempF ?? "—"} | ${row.minTempF ?? "—"} | ${row.maxTempF ?? "—"} | ${row.hdd65 ?? "—"} | ${row.cdd65 ?? "—"} | ${row.weatherBasisUsed ?? "—"} | ${row.weatherKindUsed ?? "—"} | ${row.weatherSourceUsed ?? "—"} | ${row.weatherProviderName ?? "—"} | ${row.weatherFallbackReason ?? "—"}`
          )
        );
      }
    });
  }

  section("L) Notes / next-action hints", () => {
    fullReportJson.notes.forEach((n) => lines.push("- " + n));
    if (fullReportJson.notes.length === 0) lines.push("- No automatic flags.");
  });

  const fullReportText = lines.join("\n").trimStart();
  return { fullReportJson, fullReportText };
}

export async function POST(req: NextRequest) {
  if (!hasAdminSessionCookie(req)) {
    const gate = requireAdmin(req);
    if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });
  }

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
  let compareRunStatus: "started" | "running" | "succeeded" | "failed" | null = null;
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

  const testDateKeysSorted = Array.from(testDateKeysLocal).sort();
  const minTestKey = testDateKeysSorted[0] ?? "";
  const fetchStart = minTestKey;
  const fetchEnd = testDateKeysSorted[testDateKeysSorted.length - 1] ?? "";
  const fetchStartExpanded = shiftIsoDateUtc(fetchStart, -1);
  const fetchEndExpanded = shiftIsoDateUtc(fetchEnd, 1);

  const actualIntervals = await (
    candidateIntervalsForTesting != null
      ? candidateIntervalsForTesting
      : testSelectionMode === "manual_ranges"
        ? (() => {
            // Manual replay after rebuild can contain sparse one-day ranges across the year.
            // Fetch per merged range to avoid materializing a full-window interval payload.
            const mergedManualRanges = mergeDateKeysToRanges(testDateKeysSorted);
            return Promise.all(
              mergedManualRanges.map((r) =>
                getActualIntervalsForRange({
                  houseId: house.id,
                  esiid,
                  // Expand by one UTC day on both sides so local-day filtering can
                  // include timezone spillover intervals at day boundaries.
                  startDate: shiftIsoDateUtc(r.startDate, -1),
                  endDate: shiftIsoDateUtc(r.endDate, 1),
                })
              )
            ).then((chunks) => {
              const byTs = new Map<string, { timestamp: string; kwh: number }>();
              for (const chunk of chunks) {
                for (const row of chunk ?? []) {
                  const ts = String((row as any)?.timestamp ?? "").trim();
                  if (!ts) continue;
                  byTs.set(ts, { timestamp: ts, kwh: Number((row as any)?.kwh) || 0 });
                }
              }
              return Array.from(byTs.values()).sort((a, b) =>
                String(a.timestamp).localeCompare(String(b.timestamp))
              );
            });
          })()
        : getActualIntervalsForRange({
            houseId: house.id,
            esiid,
            // Expand by one UTC day on both sides so local-day filtering can
            // include timezone spillover intervals at day boundaries.
            startDate: fetchStartExpanded,
            endDate: fetchEndExpanded,
          })
  );
  markCompareCoreStep(compareCoreTiming, "load_actual_usage");

  if (!actualIntervals?.length) {
    const classification = classifySimulationFailure({
      code: "no_actual_data",
      message: "No actual interval data for the test date window.",
    });
    await recordSimulationDataAlert({
      source: "GAPFILL_LAB",
      userId: user.id,
      userEmail: user.email,
      houseId: house.id,
      houseLabel: [house.addressLine1, house.addressCity, house.addressState].filter(Boolean).join(", ") || house.id,
      scenarioId: "past_shared_artifact",
      reasonCode: classification.reasonCode,
      reasonMessage: classification.reasonMessage,
      missingData: classification.missingData,
      context: { fetchStart, fetchEnd, testDaysRequested: testDateKeysLocal.size },
    });
    return NextResponse.json(
      {
        ok: false,
        error: "no_actual_data",
        message: "No actual interval data for the test date window.",
        explanation: classification.userFacingExplanation,
        compareCoreTiming: finalizeCompareCoreTiming(compareCoreTiming),
      },
      { status: 400 }
    );
  }

  const compareFreshMode: "selected_days" | "full_window" =
    includeDiagnostics || includeFullReportText ? "full_window" : "selected_days";
  const selectedDaysCoreLightweight =
    compareFreshMode === "selected_days" && !includeDiagnostics && !includeFullReportText;
  const compareCoreMode = selectedDaysCoreLightweight
    ? "selected_days_core_lightweight"
    : compareFreshMode === "full_window"
      ? "full_window_compare_core"
      : "selected_days_compare_core";
  // Orchestrator already runs explicit artifact_ensure before compare_core.
  // Skip redundant auto-ensure in lightweight selected-days compare.
  const autoEnsureArtifactForCompare =
    selectedDaysCoreLightweight && !rebuildArtifact ? false : true;
  const compareRequestTruth = {
    includeDiagnosticsRequested: includeDiagnostics,
    includeFullReportTextRequested: includeFullReportText,
    compareFreshModeRequested: compareFreshMode,
  };
  const artifactRequestTruth = {
    requestedInputHash: requestedArtifactInputHash,
    requestedArtifactScenarioId,
    requireExactArtifactMatch,
    artifactIdentitySource,
  };
  compareRequestTruthForLifecycle = compareRequestTruth;
  artifactRequestTruthForLifecycle = artifactRequestTruth;
  compareCoreTimingForLifecycle = compareCoreTiming;
  const compareRunStart = await createGapfillCompareRunStart({
    userId: user.id,
    houseId: house.id,
    compareFreshMode,
    requestedInputHash: requestedArtifactInputHash,
    artifactScenarioId: requestedArtifactScenarioId,
    requireExactArtifactMatch,
    artifactIdentitySource,
    statusMeta: {
      route: "admin_gapfill_lab",
      phase: "compare_core_start",
      compareCoreStartedAt: compareCoreTiming.startedAt,
      compareCoreStartedAtMs: compareCoreTiming.startedAtMs,
      compareRequestTruth,
      artifactRequestTruth,
      requestedCompareRunId,
      responseMode: heavyOnlyCompactResponse ? "heavy_only_compact" : "default",
    },
  });
  if (!compareRunStart.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: compareRunStart.error,
        message: "Compare core could not start because compare-run persistence failed.",
        detail: compareRunStart.message,
        reasonCode: "COMPARE_RUN_START_PERSIST_FAILED",
        compareRequestTruth,
        artifactRequestTruth,
        compareCoreTiming: finalizeCompareCoreTiming(compareCoreTiming, {
          failedStep: "build_shared_compare",
          compareRequestTruth,
          selectedDaysCoreLightweight,
        }),
      },
      { status: 500 }
    );
  }
  compareRunId = compareRunStart.compareRunId;
  compareRunStatus = "started";
  const logCompareRunLifecycle = (
    level: "info" | "warn" | "error",
    event: string,
    extra?: Record<string, unknown>
  ) => {
    const payload = {
      route: "admin_gapfill_lab",
      event,
      compareRunId,
      compareRunStatus,
      compareRunSnapshotReady,
      elapsedMs: Math.max(0, Date.now() - compareCoreTiming.startedAtMs),
      compareCoreStepTimings: compareCoreTiming.stepsMs,
      ...(extra ?? {}),
    };
    if (level === "warn") console.warn("[gapfill-lab][compare-run]", payload);
    else if (level === "error") console.error("[gapfill-lab][compare-run]", payload);
    else console.info("[gapfill-lab][compare-run]", payload);
  };
  logCompareRunLifecycle("info", "compare_run_started");
  await markGapfillCompareRunRunning({
    compareRunId,
    phase: "build_shared_compare_start",
    statusMeta: {
      route: "admin_gapfill_lab",
      compareRunId,
      compareCoreStartedAt: compareCoreTiming.startedAt,
      compareCoreStepTimings: compareCoreTiming.stepsMs,
      compareRequestTruth,
      artifactRequestTruth,
    },
  });
  compareRunStatus = "running";
  logCompareRunLifecycle("info", "compare_run_running", {
    phase: "build_shared_compare_start",
  });
  const reportSharedComparePhase = async (
    phase: GapfillCompareBuildPhase,
    phaseMeta?: Record<string, unknown>
  ) => {
    if (!compareRunId || compareRunTerminalState) return;
    await markGapfillCompareRunRunning({
      compareRunId,
      phase,
      statusMeta: {
        route: "admin_gapfill_lab",
        compareRunId,
        phase,
        compareCoreStepTimings: compareCoreTiming.stepsMs,
        compareRequestTruth,
        artifactRequestTruth,
        phaseMeta: phaseMeta ?? null,
      },
    });
    compareRunStatus = "running";
    logCompareRunLifecycle("info", "shared_compare_phase", {
      phase,
      phaseMeta: phaseMeta ?? null,
    });
  };
  const markCompareRunFailure = async (args: {
    phase: string;
    failureCode: string;
    failureMessage: string;
    statusCode?: number;
    compareCoreFailedStep?: CompareCoreStepKey;
  }) => {
    if (!compareRunId) return null;
    await markGapfillCompareRunFailed({
      compareRunId,
      phase: args.phase,
      failureCode: args.failureCode,
      failureMessage: args.failureMessage,
      statusMeta: {
        route: "admin_gapfill_lab",
        compareRunId,
        compareRunSnapshotReady: false,
        compareCoreFailedStep: args.compareCoreFailedStep ?? args.phase,
        compareCoreTiming: finalizeCompareCoreTiming(compareCoreTiming, {
          failedStep: args.compareCoreFailedStep ?? "build_shared_compare",
          compareRequestTruth,
          selectedDaysCoreLightweight,
          statusCode: args.statusCode,
        }),
        compareRequestTruth,
        artifactRequestTruth,
      },
    });
    compareRunStatus = "failed";
    compareRunSnapshotReady = false;
    compareRunTerminalState = true;
    logCompareRunLifecycle("warn", "compare_run_failed", {
      phase: args.phase,
      failureCode: args.failureCode,
      failureMessage: args.failureMessage,
      statusCode: args.statusCode,
      compareCoreFailedStep: args.compareCoreFailedStep ?? args.phase,
    });
    return {
      compareRunId,
      compareRunStatus,
      compareRunSnapshotReady,
    };
  };
  let sharedSim: Awaited<ReturnType<typeof buildGapfillCompareSimShared>>;
  const compareCoreAbort = new AbortController();
  const unlinkCompareCoreAbort = attachAbortForwarders(compareCoreAbort, req.signal);
  const compareCoreDeadlineTimer = setTimeout(() => {
    compareCoreAbort.abort();
  }, ROUTE_COMPARE_SHARED_TIMEOUT_MS);
  try {
    sharedSim = await buildGapfillCompareSimShared({
      userId: user.id,
      houseId: house.id,
      timezone,
      canonicalWindow,
      testDateKeysLocal,
      rebuildArtifact,
      autoEnsureArtifact: autoEnsureArtifactForCompare,
      compareFreshMode,
      includeFreshCompareCalc: compareFreshMode === "full_window",
      selectedDaysLightweightArtifactRead: selectedDaysCoreLightweight,
      includeDiagnostics,
      includeFullReportText,
      artifactExactScenarioId: requestedArtifactScenarioId,
      artifactExactInputHash: requestedArtifactInputHash,
      requireExactArtifactMatch,
      artifactIdentitySource:
        artifactIdentitySource === "same_run_artifact_ensure" || artifactIdentitySource === "manual_request"
          ? artifactIdentitySource
          : null,
      onPhaseUpdate: reportSharedComparePhase,
      abortSignal: compareCoreAbort.signal,
    });
  } catch (err: unknown) {
    const normalizedError = normalizeRouteError(
      err,
      "Compare core failed while building shared compare output."
    );
    const buildAborted = normalizedError.code === "compare_core_build_aborted";
    // Client disconnect vs route deadline: cooperative abort stops work so Vercel duration tracks the response.
    const aborted =
      (buildAborted && req.signal.aborted) ||
      normalizedError.code === "compare_core_request_aborted_build_shared_compare";
    const timedOut =
      (buildAborted && !req.signal.aborted) ||
      normalizedError.code === "compare_core_route_timeout_build_shared_compare";
    const compareRunEnvelope = await markCompareRunFailure({
      phase: "build_shared_compare",
      failureCode: aborted
        ? "COMPARE_CORE_REQUEST_ABORTED_BUILD_SHARED_COMPARE"
        : timedOut
          ? "COMPARE_CORE_ROUTE_TIMEOUT_BUILD_SHARED_COMPARE"
          : "COMPARE_CORE_ROUTE_EXCEPTION_BUILD_SHARED_COMPARE",
      failureMessage: aborted
        ? "Compare core request was aborted while building shared compare output."
        : timedOut
          ? "Compare core timed out while building shared compare output."
          : normalizedError.message,
      statusCode: aborted ? 499 : timedOut ? 504 : 500,
      compareCoreFailedStep: "build_shared_compare",
    });
    return NextResponse.json(
      {
        ok: false,
        error: aborted
          ? "compare_core_request_aborted"
          : timedOut
            ? "compare_core_route_timeout"
            : "compare_core_route_exception",
        message: aborted
          ? "Compare core request was aborted while building shared compare output."
          : timedOut
            ? "Compare core timed out while building shared compare output."
            : normalizedError.message,
        missingData: timedOut || aborted ? ["buildGapfillCompareSimShared"] : undefined,
        reasonCode: aborted
          ? "COMPARE_CORE_REQUEST_ABORTED_BUILD_SHARED_COMPARE"
          : timedOut
            ? "COMPARE_CORE_ROUTE_TIMEOUT_BUILD_SHARED_COMPARE"
            : "COMPARE_CORE_ROUTE_EXCEPTION_BUILD_SHARED_COMPARE",
        ...(heavyOnlyCompactResponse
          ? buildHeavyTiming(compareCoreTiming, {
              heavyFailedStep: "build_shared_compare",
              heavyResponseMode: "heavy_only_compact",
            })
          : {}),
        compareCoreTiming: finalizeCompareCoreTiming(compareCoreTiming, {
          failedStep: "build_shared_compare",
          timeoutMs: timedOut ? ROUTE_COMPARE_SHARED_TIMEOUT_MS : undefined,
          requestAborted: aborted || undefined,
          compareRequestTruth,
          selectedDaysCoreLightweight,
        }),
        artifactRequestTruth,
        ...(compareRunEnvelope ?? {}),
      },
      { status: aborted ? 499 : timedOut ? 504 : 500 }
    );
  } finally {
    clearTimeout(compareCoreDeadlineTimer);
    unlinkCompareCoreAbort();
  }
  markCompareCoreStep(compareCoreTiming, "load_artifact");
  markCompareCoreStep(compareCoreTiming, "build_shared_compare");
  if (compareRunId) {
    await markGapfillCompareRunRunning({
      compareRunId,
      phase: "build_shared_compare_done",
      statusMeta: {
        route: "admin_gapfill_lab",
        compareRunId,
        compareCoreStepTimings: compareCoreTiming.stepsMs,
      },
    });
  }
  if (!sharedSim.ok) {
    const classification = classifySimulationFailure({
      code: String((sharedSim.body as any)?.error ?? ""),
      message: String((sharedSim.body as any)?.message ?? ""),
    });
    const mergedBody = {
      ...(sharedSim.body as Record<string, unknown>),
      compareRequestTruth,
      artifactRequestTruth,
      ...(heavyOnlyCompactResponse
        ? buildHeavyTiming(compareCoreTiming, {
            heavyFailedStep: "build_shared_compare",
            heavyResponseMode: "heavy_only_compact",
          })
        : {}),
      explanation: classification.userFacingExplanation,
      missingData: classification.missingData,
      reasonCode: (sharedSim.body as any)?.reasonCode ?? classification.reasonCode,
      canonicalWindowHelper:
        (sharedSim.body as any)?.windowHelper ?? canonicalWindowHelper,
      coverageStart:
        (sharedSim.body as any)?.windowStartUtc ?? canonicalWindow.startDate,
      coverageEnd:
        (sharedSim.body as any)?.windowEndUtc ?? canonicalWindow.endDate,
    };
    await recordSimulationDataAlert({
      source: "GAPFILL_LAB",
      userId: user.id,
      userEmail: user.email,
      houseId: house.id,
      houseLabel:
        [house.addressLine1, house.addressCity, house.addressState]
          .filter(Boolean)
          .join(", ") || house.id,
      scenarioId: "past_shared_artifact",
      reasonCode: classification.reasonCode,
      reasonMessage: classification.reasonMessage,
      missingData: classification.missingData,
      context: {
        error: String((sharedSim.body as any)?.error ?? ""),
        status: sharedSim.status,
        rebuildArtifact,
        testDaysRequested: testDateKeysLocal.size,
        compareCoreTiming: finalizeCompareCoreTiming(compareCoreTiming, {
          failedStep: "build_shared_compare",
          compareRequestTruth,
        }),
      },
    });
    const compareRunEnvelope = await markCompareRunFailure({
      phase: "build_shared_compare",
      failureCode: String((mergedBody as any)?.reasonCode ?? "COMPARE_CORE_SHARED_COMPARE_FAILED"),
      failureMessage: String((mergedBody as any)?.message ?? "Shared compare failed."),
      statusCode: sharedSim.status,
      compareCoreFailedStep: "build_shared_compare",
    });
    return NextResponse.json(
      {
        ...mergedBody,
        compareCoreTiming: finalizeCompareCoreTiming(compareCoreTiming, {
          failedStep: "build_shared_compare",
          compareRequestTruth,
        }),
        ...(compareRunEnvelope ?? {}),
      },
      { status: sharedSim.status }
    );
  }

  const scoringTimezone = String((sharedSim as any)?.timezoneUsedForScoring ?? timezone);
  const scoringWindowRaw = (sharedSim as any)?.windowUsedForScoring;
  const scoringWindow =
    scoringWindowRaw &&
    /^\d{4}-\d{2}-\d{2}$/.test(String(scoringWindowRaw.startDate ?? "")) &&
    /^\d{4}-\d{2}-\d{2}$/.test(String(scoringWindowRaw.endDate ?? ""))
      ? {
          startDate: String(scoringWindowRaw.startDate),
          endDate: String(scoringWindowRaw.endDate),
        }
      : sharedSim.sharedCoverageWindow;
  const scoringTestDateKeysRaw = (sharedSim as any)?.scoringTestDateKeysLocal;
  const scoringTestDateKeysLocal = new Set<string>(
    (scoringTestDateKeysRaw instanceof Set
      ? Array.from(scoringTestDateKeysRaw)
      : Array.isArray(scoringTestDateKeysRaw)
        ? scoringTestDateKeysRaw
        : Array.from(testDateKeysLocal))
      .map((dk) => String(dk ?? "").slice(0, 10))
      .filter((dk) => /^\d{4}-\d{2}-\d{2}$/.test(dk))
  );
  const actualScoringIntervals = actualIntervals.filter((p) =>
    scoringTestDateKeysLocal.has(dateKeyInTimezone(p.timestamp, scoringTimezone))
  );
  if (actualScoringIntervals.length === 0) {
    const classification = classifySimulationFailure({
      code: "no_actual_data",
      message: "No actual interval data found for Test dates in this shared scoring window.",
    });
    await recordSimulationDataAlert({
      source: "GAPFILL_LAB",
      userId: user.id,
      userEmail: user.email,
      houseId: house.id,
      houseLabel: [house.addressLine1, house.addressCity, house.addressState].filter(Boolean).join(", ") || house.id,
      scenarioId: "past_shared_artifact",
      reasonCode: classification.reasonCode,
      reasonMessage: classification.reasonMessage,
      missingData: classification.missingData,
      context: {
        fetchStart,
        fetchEnd,
        testDaysRequested: scoringTestDateKeysLocal.size,
        scoringTimezone,
        scoringWindow,
        compareCoreTiming: finalizeCompareCoreTiming(compareCoreTiming, {
          failedStep: "load_actual_usage",
          compareRequestTruth,
        }),
      },
    });
    const compareRunEnvelope = await markCompareRunFailure({
      phase: "load_actual_usage",
      failureCode: "NO_ACTUAL_DATA_SCORING_WINDOW",
      failureMessage: "No actual interval data found for Test dates in this shared scoring window.",
      statusCode: 400,
      compareCoreFailedStep: "load_actual_usage",
    });
    return NextResponse.json(
      {
        ok: false,
        error: "no_actual_data",
        message: "No actual interval data found for Test dates in this shared scoring window.",
        explanation: classification.userFacingExplanation,
        compareCoreTiming: finalizeCompareCoreTiming(compareCoreTiming, {
          failedStep: "load_actual_usage",
          compareRequestTruth,
        }),
        ...(compareRunEnvelope ?? {}),
      },
      { status: 400 }
    );
  }
  const actualScoringIntervalsCanon = actualScoringIntervals.map((p) => ({
    ...p,
    timestamp: canonicalIntervalKey(String(p?.timestamp ?? "").trim()),
  }));
  const actualTestIntervals = actualScoringIntervals;
  const actualTestIntervalsCanon = actualScoringIntervalsCanon;

  const simulatedByTs = new Map<string, number>();
  for (const p of sharedSim.simulatedTestIntervals) simulatedByTs.set(p.timestamp, p.kwh);
  const artifactSimulatedByTs = new Map<string, number>();
  for (const p of Array.isArray(sharedSim.artifactIntervals) ? sharedSim.artifactIntervals : []) {
    if (!scoringTestDateKeysLocal.has(dateKeyInTimezone(p.timestamp, scoringTimezone))) continue;
    artifactSimulatedByTs.set(p.timestamp, p.kwh);
  }
  const simulatedScoringDateKeysLocal = new Set<string>(
    sharedSim.simulatedTestIntervals.map((p) => dateKeyInTimezone(p.timestamp, scoringTimezone))
  );
  const scoringActualTestIntervalsCanon = actualScoringIntervalsCanon.filter((p) =>
    simulatedScoringDateKeysLocal.has(dateKeyInTimezone(p.timestamp, scoringTimezone))
  );
  const inferredMissingSimulatedOwnershipCount = Array.from(scoringTestDateKeysLocal).filter(
    (dk) => !simulatedScoringDateKeysLocal.has(dk)
  ).length;
  const scoredTestDaysMissingSimulatedOwnershipCountRaw = Number(
    (sharedSim as any)?.scoredTestDaysMissingSimulatedOwnershipCount
  );
  const scoredTestDaysMissingSimulatedOwnershipCount = Number.isFinite(
    scoredTestDaysMissingSimulatedOwnershipCountRaw
  )
    ? Math.max(0, Math.trunc(scoredTestDaysMissingSimulatedOwnershipCountRaw))
    : inferredMissingSimulatedOwnershipCount;
  // Normalize optional compare-source booleans so guardrails do not drift when
  // one field is omitted by mocks/older payload shapes.
  const rawScoringUsedSharedArtifact = (sharedSim as any).scoringUsedSharedArtifact;
  const rawComparePulledFromSharedArtifactOnly = (sharedSim as any).comparePulledFromSharedArtifactOnly;
  const rawCompareFreshModeUsed = String((sharedSim as any).compareFreshModeUsed ?? "");
  const rawCompareSimSource = String((sharedSim as any).compareSimSource ?? "");
  const rawScoringSimulatedSource = String((sharedSim as any).scoringSimulatedSource ?? "");
  const inferredFreshScoringSource =
    rawCompareFreshModeUsed === "selected_days" ||
    rawCompareFreshModeUsed === "full_window" ||
    rawCompareSimSource === "shared_selected_days_calc" ||
    rawCompareSimSource === "shared_fresh_calc" ||
    rawScoringSimulatedSource === "shared_selected_days_simulated_intervals15" ||
    rawScoringSimulatedSource === "shared_fresh_simulated_intervals15";
  const inferredArtifactScoringSource =
    rawCompareFreshModeUsed === "artifact_only" ||
    rawCompareSimSource === "shared_artifact_cache" ||
    rawScoringSimulatedSource === "shared_artifact_simulated_intervals15";
  const scoringUsedSharedArtifact = typeof rawScoringUsedSharedArtifact === "boolean"
    ? rawScoringUsedSharedArtifact
    : typeof rawComparePulledFromSharedArtifactOnly === "boolean"
      ? rawComparePulledFromSharedArtifactOnly
      : inferredFreshScoringSource
        ? false
        : inferredArtifactScoringSource
          ? true
          : true;
  const scoringJoinMissingActual = scoringActualTestIntervalsCanon.filter((p) => !simulatedByTs.has(p.timestamp));
  const artifactJoinMissingActual =
    artifactSimulatedByTs.size > 0
      ? scoringActualTestIntervalsCanon.filter((p) => !artifactSimulatedByTs.has(p.timestamp))
      : [];
  const scoringUsesArtifactOnly = scoringUsedSharedArtifact;
  if (scoringJoinMissingActual.length > 0) {
    markCompareCoreStep(compareCoreTiming, "join_actual_vs_sim");
    if (scoringUsesArtifactOnly) {
      const classification = classifySimulationFailure({
        code: "artifact_compare_join_incomplete_rebuild_required",
        message: "Saved shared Past artifact did not produce all simulated timestamps required for compare join.",
      });
      const compareRunEnvelope = await markCompareRunFailure({
        phase: "join_actual_vs_sim",
        failureCode: String(classification.reasonCode ?? "ARTIFACT_COMPARE_JOIN_INCOMPLETE_REBUILD_REQUIRED"),
        failureMessage:
          "Saved/rebuilt shared Past artifact is missing points needed for compare join. Trigger explicit rebuildArtifact=true and retry compare.",
        statusCode: 409,
        compareCoreFailedStep: "join_actual_vs_sim",
      });
      return NextResponse.json(
        {
          ok: false,
          error: "artifact_compare_join_incomplete_rebuild_required",
          message:
            "Saved/rebuilt shared Past artifact is missing points needed for compare join. Trigger explicit rebuildArtifact=true and retry compare.",
          explanation: classification.userFacingExplanation,
          missingData: classification.missingData,
          reasonCode: classification.reasonCode,
          joinMissingCount: scoringJoinMissingActual.length,
          joinMissingSampleTs: scoringJoinMissingActual.slice(0, 10).map((p) => p.timestamp),
          compareCoreTiming: finalizeCompareCoreTiming(compareCoreTiming, {
            failedStep: "join_actual_vs_sim",
            compareRequestTruth,
          }),
          ...(compareRunEnvelope ?? {}),
        },
        { status: 409 }
      );
    }
    const compareRunEnvelope = await markCompareRunFailure({
      phase: "join_actual_vs_sim",
      failureCode: "COMPARE_SCORING_JOIN_INCOMPLETE",
      failureMessage:
        "Fresh shared compare scoring output is missing timestamps required for actual-vs-sim join. Retry compare and inspect shared scoring diagnostics.",
      statusCode: 409,
      compareCoreFailedStep: "join_actual_vs_sim",
    });
    return NextResponse.json(
      {
        ok: false,
        error: "compare_scoring_join_incomplete",
        message:
          "Fresh shared compare scoring output is missing timestamps required for actual-vs-sim join. Retry compare and inspect shared scoring diagnostics.",
        reasonCode: "COMPARE_SCORING_JOIN_INCOMPLETE",
        missingData: ["fresh_shared_compare_intervals15"],
        joinMissingCount: scoringJoinMissingActual.length,
        joinMissingSampleTs: scoringJoinMissingActual.slice(0, 10).map((p) => p.timestamp),
        compareCoreTiming: finalizeCompareCoreTiming(compareCoreTiming, {
          failedStep: "join_actual_vs_sim",
          compareRequestTruth,
        }),
        ...(compareRunEnvelope ?? {}),
      },
      { status: 409 }
    );
  }
  markCompareCoreStep(compareCoreTiming, "join_actual_vs_sim");
  const artifactDisplayReferenceWarning = !scoringUsesArtifactOnly && artifactJoinMissingActual.length > 0
    ? {
        code: "artifact_display_reference_incomplete",
        message:
          "Saved shared Past artifact is missing some scored-day join timestamps for display/parity/reference paths, but fresh shared compare scoring completed.",
        nonBlocking: true,
        joinMissingCount: artifactJoinMissingActual.length,
        joinMissingSampleTs: artifactJoinMissingActual.slice(0, 10).map((p) => p.timestamp),
      }
    : null;

  const metrics = computeGapFillMetrics({
    actual: scoringActualTestIntervalsCanon,
    simulated: sharedSim.simulatedTestIntervals,
    simulatedByTs,
    timezone,
  });
  markCompareCoreStep(compareCoreTiming, "build_metrics");
  markCompareCoreStep(compareCoreTiming, "summarize_metrics");
  if (compareRunId) {
    await markGapfillCompareRunRunning({
      compareRunId,
      phase: "metrics_built",
      statusMeta: {
        route: "admin_gapfill_lab",
        compareRunId,
        compareCoreStepTimings: compareCoreTiming.stepsMs,
      },
    });
  }
  const requestedTestDaysCount = testDateKeysLocal.size;
  const scoringTestDaysCount = scoringTestDateKeysLocal.size;
  const scoredIntervalsCount = scoringActualTestIntervalsCanon.length;
  const actualTestIntervalsCount = scoringActualTestIntervalsCanon.length;
  const simulatedTestIntervalsCount = sharedSim.simulatedTestIntervals.length;
  const hasScoreableIntervals = simulatedTestIntervalsCount > 0;
  const scoreableIntervalsMessage = hasScoreableIntervals
    ? "Selected test days include scoreable intervals from shared compare scoring output."
    : "Selected test days had no scoreable intervals from shared compare scoring output. This compare completed with zero scored intervals.";
  const scoringActualSource = "actual_usage_test_window_intervals";
  const scoringSimulatedSource =
    (sharedSim as any).scoringSimulatedSource ?? "shared_artifact_simulated_intervals15";
  const scoringExcludedSource =
    (sharedSim as any).scoringExcludedSource ?? "shared_past_travel_vacant_excludedDateKeysFingerprint";
  const artifactBuildExcludedSource =
    (sharedSim as any).artifactBuildExcludedSource ?? "shared_past_travel_vacant_excludedDateKeysFingerprint";
  const artifactUsesTestDaysInIdentity =
    (sharedSim as any).artifactUsesTestDaysInIdentity === true;
  const artifactUsesTravelDaysInIdentity =
    (sharedSim as any).artifactUsesTravelDaysInIdentity !== false;
  const sharedArtifactScenarioId =
    (sharedSim as any).sharedArtifactScenarioId ??
    (sharedSim as any)?.modelAssumptions?.artifactScenarioId ??
    null;
  const sharedArtifactInputHash =
    (sharedSim as any).sharedArtifactInputHash ??
    (sharedSim as any)?.modelAssumptions?.artifactInputHash ??
    (sharedSim as any)?.modelAssumptions?.artifactInputHashUsed ??
    null;
  const comparePulledFromSharedArtifactOnly = typeof rawComparePulledFromSharedArtifactOnly === "boolean"
    ? rawComparePulledFromSharedArtifactOnly
    : scoringUsedSharedArtifact;
  const sharedCoverageWindow = sharedSim.sharedCoverageWindow;
  const boundedTravelDateKeysLocal = sharedSim.boundedTravelDateKeysLocal;
  const responseHomeProfile = sharedSim.homeProfileFromModel ?? homeProfile;
  const responseApplianceProfile = sharedSim.applianceProfileFromModel ?? applianceProfile;
  const rawModelAssumptions = (sharedSim.modelAssumptions as any) ?? {};
  const responseModelAssumptions = selectedDaysCoreLightweight
    ? buildSelectedDaysCoreResponseModelAssumptions(rawModelAssumptions)
    : rawModelAssumptions;
  const ma = rawModelAssumptions;
  const artifactSourceMode = String(ma.artifactSourceMode ?? "") || null;
  const requestedInputHash = ma.requestedInputHash ?? null;
  const artifactInputHashUsed = ma.artifactInputHashUsed ?? null;
  const artifactHashMatch = ma.artifactHashMatch ?? null;
  const artifactScenarioId = ma.artifactScenarioId ?? null;
  const contextScenarioId =
    (typeof ma.scenarioId === "string" && ma.scenarioId.trim()) ||
    (typeof ma.cacheKeyDiag?.scenarioId === "string" && ma.cacheKeyDiag.scenarioId.trim()) ||
    null;
  const stableScenarioId =
    (typeof artifactScenarioId === "string" && artifactScenarioId.trim()) ||
    contextScenarioId ||
    "past_shared_artifact";
  const artifactCreatedAt = ma.artifactCreatedAt ?? null;
  const artifactUpdatedAt = ma.artifactUpdatedAt ?? null;
  const artifactRequestedScenarioId = ma.artifactRequestedScenarioId ?? null;
  const artifactExactIdentityRequested = ma.artifactExactIdentityRequested === true;
  const artifactExactIdentityResolved = ma.artifactExactIdentityResolved === true;
  const artifactIdentitySourceUsed = ma.artifactIdentitySource ?? null;
  const artifactSameRunEnsureIdentity = ma.artifactSameRunEnsureIdentity === true;
  const artifactFallbackOccurred = ma.artifactFallbackOccurred === true;
  const artifactFallbackReason = ma.artifactFallbackReason ?? null;
  const artifactExactIdentifierUsed =
    ma.artifactExactIdentifierUsed ??
    (artifactInputHashUsed && (artifactScenarioId ?? stableScenarioId)
      ? `${artifactScenarioId ?? stableScenarioId}:${artifactInputHashUsed}`
      : null);
  const sameRunExactHashRequested =
    typeof requestedInputHash === "string" && requestedInputHash.length > 0;
  const sameRunExactHandoffRequired =
    requireExactArtifactMatch &&
    sameRunExactHashRequested &&
    artifactIdentitySourceUsed === "same_run_artifact_ensure";
  const sameRunExactHandoffResolved =
    sameRunExactHandoffRequired &&
    artifactSourceMode === "exact_hash_match" &&
    artifactHashMatch === true &&
    typeof requestedInputHash === "string" &&
    requestedInputHash.length > 0 &&
    artifactInputHashUsed === requestedInputHash &&
    artifactExactIdentityResolved === true;
  if (sameRunExactHandoffRequired && !sameRunExactHandoffResolved) {
    const compareRunEnvelope = await markCompareRunFailure({
      phase: "artifact_identity_validation",
      failureCode: "ARTIFACT_ENSURE_EXACT_HANDOFF_FAILED",
      failureMessage:
        "Compare required the exact shared Past artifact identity returned by same-run artifact ensure, but that handoff was not proven as an exact hash match.",
      statusCode: 409,
      compareCoreFailedStep: "build_shared_compare",
    });
    return NextResponse.json(
      {
        ok: false,
        error: "artifact_exact_identity_unresolved",
        message:
          "Compare required the exact shared Past artifact identity returned by same-run artifact ensure, but that handoff was not proven as an exact hash match.",
        reasonCode: "ARTIFACT_ENSURE_EXACT_HANDOFF_FAILED",
        compareRequestTruth,
        artifactRequestTruth,
        artifactTruth: {
          sourceMode: artifactSourceMode,
          requestedInputHash,
          artifactInputHashUsed,
          artifactHashMatch,
          requestedScenarioId: artifactRequestedScenarioId,
          scenarioId: artifactScenarioId ?? stableScenarioId,
          exactIdentifierUsed: artifactExactIdentifierUsed,
          exactIdentityResolved: artifactExactIdentityResolved,
          sameRunEnsureArtifact: artifactSameRunEnsureIdentity,
          fallbackOccurred: artifactFallbackOccurred,
          fallbackReason: artifactFallbackReason,
        },
        compareCoreTiming: finalizeCompareCoreTiming(compareCoreTiming, {
          failedStep: "build_shared_compare",
          compareRequestTruth,
          selectedDaysCoreLightweight,
        }),
        ...(compareRunEnvelope ?? {}),
      },
      { status: 409 }
    );
  }
  const hasContradictoryExactArtifactTruth =
    artifactSourceMode === "exact_hash_match" &&
    (!artifactInputHashUsed ||
      artifactHashMatch !== true ||
      (typeof requestedInputHash === "string" &&
        requestedInputHash.length > 0 &&
        artifactInputHashUsed !== requestedInputHash) ||
      (requireExactArtifactMatch && sameRunExactHashRequested && artifactExactIdentityResolved !== true));
  if (hasContradictoryExactArtifactTruth) {
    const compareRunEnvelope = await markCompareRunFailure({
      phase: "artifact_truth_validation",
      failureCode: requireExactArtifactMatch
        ? "ARTIFACT_EXACT_IDENTITY_UNRESOLVED"
        : "ARTIFACT_TRUTH_INVARIANT_FAILED",
      failureMessage: requireExactArtifactMatch
        ? "Compare required an exact shared Past artifact identity, but the returned artifact truth could not prove that exact match."
        : "Compare returned contradictory artifact truth and cannot report success.",
      statusCode: requireExactArtifactMatch ? 409 : 500,
      compareCoreFailedStep: "build_shared_compare",
    });
    return NextResponse.json(
      {
        ok: false,
        error: requireExactArtifactMatch ? "artifact_exact_identity_unresolved" : "artifact_truth_invariant_failed",
        message: requireExactArtifactMatch
          ? "Compare required an exact shared Past artifact identity, but the returned artifact truth could not prove that exact match."
          : "Compare returned contradictory artifact truth and cannot report success.",
        reasonCode: requireExactArtifactMatch
          ? "ARTIFACT_EXACT_IDENTITY_UNRESOLVED"
          : "ARTIFACT_TRUTH_INVARIANT_FAILED",
        compareRequestTruth,
        artifactRequestTruth,
        artifactTruth: {
          sourceMode: artifactSourceMode,
          requestedInputHash,
          artifactInputHashUsed,
          artifactHashMatch,
          requestedScenarioId: artifactRequestedScenarioId,
          scenarioId: artifactScenarioId ?? stableScenarioId,
          exactIdentifierUsed: artifactExactIdentifierUsed,
          exactIdentityResolved: artifactExactIdentityResolved,
          sameRunEnsureArtifact: artifactSameRunEnsureIdentity,
          fallbackOccurred: artifactFallbackOccurred,
          fallbackReason: artifactFallbackReason,
        },
        compareCoreTiming: finalizeCompareCoreTiming(compareCoreTiming, {
          failedStep: "build_shared_compare",
          compareRequestTruth,
          selectedDaysCoreLightweight,
        }),
        ...(compareRunEnvelope ?? {}),
      },
      { status: requireExactArtifactMatch ? 409 : 500 }
    );
  }
  const artifactSourceNote =
    ma.artifactSourceNote ??
    (artifactSourceMode === "latest_by_scenario_fallback"
      ? "Artifact source: latest cached Past scenario artifact (fallback from exact hash miss)."
      : artifactSourceMode === "exact_hash_match"
        ? "Artifact source: exact identity match on Past input hash."
        : null);
  const chartIntervalCount = Array.isArray(sharedSim.simulatedChartIntervals)
    ? sharedSim.simulatedChartIntervals.length
    : Number(ma.intervalCount ?? 0) || 0;
  const displayDailyRowsBase: Array<{ date: string; simKwh: number; source: "ACTUAL" | "SIMULATED" }> = Array.isArray(
    sharedSim.simulatedChartDaily
  )
    ? sharedSim.simulatedChartDaily.map((row) => ({
        date: String((row as any)?.date ?? "").slice(0, 10),
        simKwh: round2(Number((row as any)?.simKwh ?? 0)),
        source: String((row as any)?.source ?? "").toUpperCase() === "SIMULATED" ? "SIMULATED" : "ACTUAL",
      }))
    : [];
  const displayDailyByDate = new Map<string, { simKwh: number; source: "ACTUAL" | "SIMULATED" }>(
    displayDailyRowsBase
      .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date))
      .map((r) => [r.date, { simKwh: r.simKwh, source: r.source as "ACTUAL" | "SIMULATED" }] as const)
  );
  const parityDisplayDailyByDate = new Map<string, { simKwh: number; source: "SIMULATED" }>(
    (Array.isArray((sharedSim as any)?.artifactSimulatedDayReferenceRows)
      ? ((sharedSim as any).artifactSimulatedDayReferenceRows as Array<Record<string, unknown>>)
      : [])
      .map((row) => ({
        date: String((row as any)?.date ?? "").slice(0, 10),
        simKwh: round2(Number((row as any)?.simKwh ?? 0)),
      }))
      .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date))
      .map((r) => [r.date, { simKwh: r.simKwh, source: "SIMULATED" as const }] as const)
  );
  const artifactReferenceDayCountUsed = Array.from(scoringTestDateKeysLocal).filter((dk) =>
    parityDisplayDailyByDate.has(dk)
  ).length;
  const actualDailyByDate = new Map<string, number>();
  for (const p of actualScoringIntervalsCanon) {
    const dk = dateKeyInTimezone(p.timestamp, scoringTimezone);
    actualDailyByDate.set(dk, round2((actualDailyByDate.get(dk) ?? 0) + (Number(p.kwh) || 0)));
  }
  const freshDailyByDate = new Map<string, number>();
  for (const p of sharedSim.simulatedTestIntervals) {
    const dk = dateKeyInTimezone(p.timestamp, scoringTimezone);
    if (!scoringTestDateKeysLocal.has(dk)) continue;
    freshDailyByDate.set(dk, round2((freshDailyByDate.get(dk) ?? 0) + (Number(p.kwh) || 0)));
  }
  const simulatedDayDiagnosticsRaw = Array.isArray((ma as any)?.simulatedDayDiagnosticsSample)
    ? ((ma as any).simulatedDayDiagnosticsSample as Array<Record<string, unknown>>)
    : [];
  const simulatedDiagByDate = new Map<string, Record<string, unknown>>();
  for (const d of simulatedDayDiagnosticsRaw) {
    const dk = String((d as any)?.localDate ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dk) || !scoringTestDateKeysLocal.has(dk)) continue;
    if (!simulatedDiagByDate.has(dk)) simulatedDiagByDate.set(dk, d);
  }
  const compactScoredDayWeatherRows: Array<{
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
  }> = Array.isArray((sharedSim as any)?.scoredDayWeatherRows)
    ? ((sharedSim as any).scoredDayWeatherRows as Array<{
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
      }>)
    : [];
  const weatherByDate = new Map<string, Record<string, unknown>>();
  for (const w of compactScoredDayWeatherRows) {
    const dk = String((w as any)?.localDate ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dk) || !scoringTestDateKeysLocal.has(dk)) continue;
    if (!weatherByDate.has(dk)) weatherByDate.set(dk, w);
  }
  const scoredDayWeatherTruthFromService =
    ((sharedSim as any)?.scoredDayWeatherTruth as Record<string, unknown> | undefined) ?? null;
  const scoredDayWeatherTruth =
    (scoredDayWeatherTruthFromService ?? {
      availability: weatherByDate.size === scoringTestDateKeysLocal.size ? "available" : "missing_expected_scored_day_weather",
      reasonCode: weatherByDate.size === scoringTestDateKeysLocal.size ? "SCORED_DAY_WEATHER_AVAILABLE" : "SCORED_DAY_WEATHER_MISSING",
      explanation:
        weatherByDate.size === scoringTestDateKeysLocal.size
          ? "Compact scored-day weather truth is available from the shared compare execution."
          : "Shared compare completed without compact weather truth for one or more scored dates.",
      source: "shared_compare_scored_day_weather",
      scoredDateCount: scoringTestDateKeysLocal.size,
      weatherRowCount: weatherByDate.size,
      missingDateCount: Math.max(0, scoringTestDateKeysLocal.size - weatherByDate.size),
      missingDateSample: Array.from(scoringTestDateKeysLocal).filter((dk) => !weatherByDate.has(dk)).slice(0, 10),
    }) as Record<string, unknown>;
  const shouldEnforceScoredDayWeatherInvariant =
    actualScoringIntervals.length > 0 && Array.isArray(sharedSim.simulatedTestIntervals) && sharedSim.simulatedTestIntervals.length > 0;
  if (
    shouldEnforceScoredDayWeatherInvariant &&
    scoringTestDateKeysLocal.size > 0 &&
    String(scoredDayWeatherTruth.availability ?? "") !== "available"
  ) {
    const compareRunEnvelope = await markCompareRunFailure({
      phase: "weather_truth_validation",
      failureCode: "COMPARE_CORE_WEATHER_TRUTH_MISSING",
      failureMessage: "Compare core completed without compact scored-day weather truth for one or more scored dates.",
      statusCode: 500,
      compareCoreFailedStep: "build_shared_compare",
    });
    return NextResponse.json(
      {
        ok: false,
        error: "compare_core_weather_truth_missing",
        message: "Compare core completed without compact scored-day weather truth for one or more scored dates.",
        reasonCode: "COMPARE_CORE_WEATHER_TRUTH_MISSING",
        scoredDayWeatherTruth,
        compareCoreTiming: finalizeCompareCoreTiming(compareCoreTiming, {
          failedStep: "build_shared_compare",
          compareRequestTruth,
          selectedDaysCoreLightweight,
        }),
        ...(compareRunEnvelope ?? {}),
      },
      { status: 500 }
    );
  }
  const travelVacantParityRows = Array.isArray((sharedSim as any)?.travelVacantParityRows)
    ? ((sharedSim as any).travelVacantParityRows as Array<Record<string, unknown>>)
    : [];
  const travelVacantParityTruth =
    ((sharedSim as any)?.travelVacantParityTruth as Record<string, unknown> | undefined) ?? {
      availability: "not_requested",
      reasonCode: "TRAVEL_VACANT_PARITY_NOT_REQUESTED",
      explanation: "No DB travel/vacant parity validation was returned by the shared compare service.",
      source: "db_travel_vacant_ranges",
      comparisonBasis: "canonical_artifact_simulated_day_totals_vs_fresh_shared_compare_daily_totals",
      requestedDateCount: 0,
      validatedDateCount: 0,
      mismatchCount: 0,
      missingArtifactReferenceCount: 0,
      missingFreshCompareCount: 0,
      requestedDateSample: [],
      exactProofRequired: false,
      exactProofSatisfied: true,
    };
  const scoredDayTruthRows = Array.from(scoringTestDateKeysLocal)
    .sort()
    .map((date) => {
      const actualDayKwh = round2(actualDailyByDate.get(date) ?? 0);
      const freshCompareSimDayKwh = round2(freshDailyByDate.get(date) ?? 0);
      const displayDay = displayDailyByDate.get(date);
      const parityDisplayDay = parityDisplayDailyByDate.get(date);
      const parityNotApplicableForScoredActualDay = !parityDisplayDay && displayDay?.source === "ACTUAL";
      const displayedPastStyleSimDayKwh =
        parityDisplayDay && parityDisplayDay.source === "SIMULATED"
          ? round2(parityDisplayDay.simKwh)
          : null;
      const parityMatch =
        parityNotApplicableForScoredActualDay || displayedPastStyleSimDayKwh == null
          ? null
          : round2(freshCompareSimDayKwh) === round2(displayedPastStyleSimDayKwh);
      const dow = getLocalDayOfWeekFromDateKey(date, scoringTimezone);
      const weekend = dow === 0 || dow === 6;
      const weather = weatherByDate.get(date) ?? {};
      const diag = simulatedDiagByDate.get(date) ?? {};
      const fallbackLevelRaw = String((diag as any)?.fallbackLevel ?? "").trim();
      const fallbackLevel = fallbackLevelRaw || null;
      const sampleCountCandidate = Number(
        (diag as any)?.selectedMatchSampleCount ??
          (diag as any)?.matchSampleCount ??
          (diag as any)?.referenceSampleCount ??
          (diag as any)?.sampleCountUsed
      );
      const sampleCount = Number.isFinite(sampleCountCandidate) ? Math.max(0, Math.trunc(sampleCountCandidate)) : null;
      const avgTempF = Number((weather as any)?.avgTempF);
      const minTempF = Number((weather as any)?.minTempF);
      const maxTempF = Number((weather as any)?.maxTempF);
      const hdd65 = Number((weather as any)?.hdd65);
      const cdd65 = Number((weather as any)?.cdd65);
      return {
        localDate: date,
        actualDayKwh,
        freshCompareSimDayKwh,
        displayedPastStyleSimDayKwh,
        actualVsFreshErrorKwh: round2(actualDayKwh - freshCompareSimDayKwh),
        displayVsFreshParityMatch: parityMatch,
        parityAvailability: parityNotApplicableForScoredActualDay
          ? "not_applicable_scored_actual_days"
          : displayedPastStyleSimDayKwh == null
            ? "missing_expected_reference"
            : "available",
        parityDisplaySourceUsed:
          ((sharedSim as any)?.displayVsFreshParityForScoredDays?.parityDisplaySourceUsed as string | undefined) ??
          "canonical_artifact_simulated_day_totals",
        artifactSimulatedDayReferenceSource:
          ((sharedSim as any)?.artifactSimulatedDayReferenceSource as string | undefined) ??
          "canonical_artifact_simulated_day_totals",
        parityDisplayValueKind:
          parityNotApplicableForScoredActualDay
            ? "not_applicable_scored_actual_day"
            : displayedPastStyleSimDayKwh == null
              ? "missing_display_sim_reference"
              : "artifact_simulated_day_total",
        parityReasonCode:
          parityNotApplicableForScoredActualDay
            ? "SCORED_DAYS_USE_ACTUAL_ARTIFACT_ROWS"
            : displayedPastStyleSimDayKwh == null
              ? "ARTIFACT_SIMULATED_REFERENCE_MISSING"
              : "ARTIFACT_SIMULATED_REFERENCE_AVAILABLE",
        scoredDayDisplaySource: displayDay?.source ?? null,
        dayType: weekend ? "weekend" : "weekday",
        weatherBasis:
          String((weather as any)?.weatherBasisUsed ?? (sharedSim as any).weatherBasisUsed ?? "") || null,
        weatherSourceUsed: String((weather as any)?.weatherSourceUsed ?? "") || null,
        weatherFallbackReason: String((weather as any)?.weatherFallbackReason ?? "") || null,
        avgTempF: Number.isFinite(avgTempF) ? round2(avgTempF) : null,
        minTempF: Number.isFinite(minTempF) ? round2(minTempF) : null,
        maxTempF: Number.isFinite(maxTempF) ? round2(maxTempF) : null,
        hdd65: Number.isFinite(hdd65) ? round2(hdd65) : null,
        cdd65: Number.isFinite(cdd65) ? round2(cdd65) : null,
        fallbackLevel,
        selectedDayTotalSource:
          String(
            (diag as any)?.dayTotalSource ??
              (diag as any)?.selectedDayTotalSource ??
              (diag as any)?.targetDaySource ??
              ""
          ) || null,
        selectedShapeVariant:
          String((diag as any)?.shapeVariantUsed ?? (diag as any)?.selectedShapeVariant ?? "") || null,
        selectedReferenceMatchTier:
          String(
            (diag as any)?.selectedReferenceMatchTier ??
              (diag as any)?.matchTier ??
              (diag as any)?.referencePoolTier ??
              ""
          ) || null,
        selectedMatchSampleCount: sampleCount,
        reasonCode:
          String((diag as any)?.reasonCode ?? (diag as any)?.fallbackReasonCode ?? (diag as any)?.fallbackReason ?? "") || null,
      };
    });
  const scoredRowsWithMiss = scoredDayTruthRows.filter((row) => Math.abs(Number(row.actualVsFreshErrorKwh) || 0) > 0.01);
  const worstErrorDates = scoredRowsWithMiss
    .slice()
    .sort((a, b) => Math.abs(b.actualVsFreshErrorKwh) - Math.abs(a.actualVsFreshErrorKwh))
    .slice(0, 10)
    .map((row) => ({
      localDate: row.localDate,
      absErrorKwh: round2(Math.abs(row.actualVsFreshErrorKwh)),
      summary: row.reasonCode ?? row.fallbackLevel ?? row.selectedReferenceMatchTier ?? "no_reason_code",
    }));
  const countIf = (pred: (row: (typeof scoredDayTruthRows)[number]) => boolean): number =>
    scoredRowsWithMiss.reduce((sum, row) => sum + (pred(row) ? 1 : 0), 0);
  const missAttributionSummary = {
    source: "scored_day_truth_rows",
    categories: {
      dayTotalDominantMiss: {
        count: countIf((row) => String(row.selectedDayTotalSource ?? "").toLowerCase().includes("fallback")),
        classification: "heuristic",
      },
      shapeDominantMiss: {
        count: countIf((row) => String(row.selectedShapeVariant ?? "").toLowerCase().includes("fallback")),
        classification: "heuristic",
      },
      weatherResponseMiss: {
        count: countIf((row) => (row.hdd65 ?? 0) + (row.cdd65 ?? 0) >= 5),
        classification: "heuristic",
      },
      fallbackTierMiss: {
        count: countIf((row) => Boolean(row.fallbackLevel)),
        classification: "supported",
      },
      sparseBinSampleCountIssue: {
        count: countIf((row) => (row.selectedMatchSampleCount ?? 999) < 3),
        classification: "heuristic",
      },
      weekdayWeekendMismatchRisk: {
        count: countIf((row) => String((simulatedDiagByDate.get(row.localDate) as any)?.dayTypeUsed ?? "").toLowerCase() !== row.dayType),
        classification: "heuristic",
      },
    },
    topWorstErrorDates: worstErrorDates,
  };
  const summarizeRows = (rows: typeof scoredDayTruthRows) => {
    const count = rows.length;
    const totalActual = round2(rows.reduce((sum, row) => sum + (Number(row.actualDayKwh) || 0), 0));
    const totalAbsError = round2(rows.reduce((sum, row) => sum + Math.abs(Number(row.actualVsFreshErrorKwh) || 0), 0));
    return {
      count,
      maeKwh: count > 0 ? round2(totalAbsError / count) : 0,
      wapePct: safeRatio(totalAbsError, totalActual),
    };
  };
  const pushBucketSummary = (
    map: Map<string, Array<(typeof scoredDayTruthRows)[number]>>,
    key: string,
    row: (typeof scoredDayTruthRows)[number]
  ) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(row);
  };
  const byTempBandMap = new Map<string, Array<(typeof scoredDayTruthRows)[number]>>();
  const byDayTypeMap = new Map<string, Array<(typeof scoredDayTruthRows)[number]>>();
  const byMonthMap = new Map<string, Array<(typeof scoredDayTruthRows)[number]>>();
  const byFallbackTierMap = new Map<string, Array<(typeof scoredDayTruthRows)[number]>>();
  const byWeatherRegimeMap = new Map<string, Array<(typeof scoredDayTruthRows)[number]>>();
  for (const row of scoredDayTruthRows) {
    pushBucketSummary(byTempBandMap, classifyTemperatureBand(row.avgTempF), row);
    pushBucketSummary(byDayTypeMap, row.dayType, row);
    pushBucketSummary(byMonthMap, row.localDate.slice(0, 7), row);
    pushBucketSummary(byFallbackTierMap, row.fallbackLevel ?? "none", row);
    pushBucketSummary(byWeatherRegimeMap, classifyWeatherRegime(row.hdd65, row.cdd65), row);
  }
  const buildBucketRows = (map: Map<string, Array<(typeof scoredDayTruthRows)[number]>>) =>
    Array.from(map.entries())
      .map(([bucket, rows]) => ({ bucket, ...summarizeRows(rows) }))
      .sort((a, b) => b.count - a.count || a.bucket.localeCompare(b.bucket));
  const intervalHourBlockMap = new Map<string, { count: number; totalActual: number; totalAbsError: number }>();
  for (const p of scoringActualTestIntervalsCanon) {
    const local = getLocalHourMinuteInTimezone(p.timestamp, scoringTimezone);
    const block = bucketHourBlock(local.hour);
    const simKwh = Number(simulatedByTs.get(p.timestamp) ?? 0);
    const actualKwh = Number(p.kwh) || 0;
    const prev = intervalHourBlockMap.get(block) ?? { count: 0, totalActual: 0, totalAbsError: 0 };
    prev.count += 1;
    prev.totalActual += actualKwh;
    prev.totalAbsError += Math.abs(actualKwh - simKwh);
    intervalHourBlockMap.set(block, prev);
  }
  const byHourBlock = Array.from(intervalHourBlockMap.entries()).map(([bucket, agg]) => ({
    bucket,
    count: agg.count,
    maeKwh: agg.count > 0 ? round2(agg.totalAbsError / agg.count) : 0,
    wapePct: safeRatio(agg.totalAbsError, agg.totalActual),
  }));
  const compareFreshModeUsed = (sharedSim as any).compareFreshModeUsed ?? null;
  const compareCalculationScope = (sharedSim as any).compareCalculationScope ?? null;
  const compareSharedCalcPath = (sharedSim as any).compareSharedCalcPath ?? null;
  const compareSimSource = (sharedSim as any).compareSimSource ?? null;
  const displaySimSource = (sharedSim as any).displaySimSource ?? null;
  const weatherBasisUsed = (sharedSim as any).weatherBasisUsed ?? null;
  const compareModelAssumptions = ((sharedSim as any).modelAssumptions ?? null) as Record<string, unknown> | null;
  const usageShapeDayTotalSource = String((compareModelAssumptions as any)?.dayTotalSource ?? "").trim() || null;
  const usageShapeDiag =
    compareModelAssumptions && typeof compareModelAssumptions === "object"
      ? (((compareModelAssumptions as any).usageShapeProfileDiag ?? null) as
          | { found?: unknown; reasonNotUsed?: unknown }
          | null)
      : null;
  const usageShapeProfileUsed =
    usageShapeDayTotalSource === "usage_shape_profile" ||
    usageShapeDayTotalSource === "usageShapeProfile_avgKwhPerDayByMonth";
  const usageShapeReasonNotUsed =
    usageShapeDiag && String(usageShapeDiag.reasonNotUsed ?? "").trim()
      ? String(usageShapeDiag.reasonNotUsed ?? "").trim()
      : null;
  const compareTruth = {
    compareFreshModeUsed,
    compareFreshModeLabel:
      compareFreshModeUsed === "selected_days"
        ? "Selected-days fresh shared execution"
        : compareFreshModeUsed === "full_window"
          ? "Full-window fresh shared execution"
          : compareFreshModeUsed === "artifact_only"
            ? "Artifact-only compare (no fresh shared execution)"
            : "Unknown compare mode",
    compareCalculationScope,
    compareCalculationScopeLabel:
      compareCalculationScope === "selected_days_shared_path_only"
        ? "Canonical shared Past dataset path, then selected-day slice"
        : compareCalculationScope === "full_window_shared_path_then_scored_day_filter"
          ? "Full-window fresh shared calculation, then scored-day filter"
          : compareCalculationScope === "artifact_read_then_scored_day_filter"
            ? "Artifact read, then scored-day filter"
            : "Unknown compare scope",
    compareSharedCalcPath,
    compareSimSource,
    displaySimSource,
    artifactParityReferenceSource: (sharedSim as any).artifactSimulatedDayReferenceSource ?? null,
    travelVacantParitySource: (travelVacantParityTruth as any)?.source ?? null,
    travelVacantParityComparisonBasis: (travelVacantParityTruth as any)?.comparisonBasis ?? null,
    travelVacantParityAvailability: (travelVacantParityTruth as any)?.availability ?? null,
    travelVacantParityExactProofSatisfied: (travelVacantParityTruth as any)?.exactProofSatisfied ?? null,
    weatherBasisUsed,
    architectureNote:
      compareCalculationScope === "selected_days_shared_path_only"
        ? "Selected-days mode now reuses the canonical shared Past simulation/output path once, then slices scored local dates and exact parity dates from that shared output."
        : compareCalculationScope === "full_window_shared_path_then_scored_day_filter"
          ? "Full-window mode runs shared simulator over the full window before filtering to scored days and validating DB travel/vacant parity."
          : "Artifact-only mode reads shared artifact output and filters scored days.",
    compareRequestTruth,
  };
  const displayDailyRows = (() => {
    const byDate = new Map<
      string,
      {
        date: string;
        simKwh: number;
        source: "ACTUAL" | "SIMULATED" | "MISSING_REFERENCE";
        selectedTestDate?: boolean;
        status?: string | null;
        reasonCode?: string | null;
      }
    >();
    for (const row of displayDailyRowsBase) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(row.date ?? ""))) continue;
      byDate.set(row.date, row);
    }
    for (const row of scoredDayTruthRows) {
      const localDate = String(row.localDate ?? "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) continue;
      const existing = byDate.get(localDate);
      if (existing) {
        byDate.set(localDate, {
          ...existing,
          selectedTestDate: true,
          status: row.parityAvailability ?? null,
          reasonCode: row.parityReasonCode ?? null,
        });
        continue;
      }
      byDate.set(localDate, {
        date: localDate,
        simKwh:
          row.scoredDayDisplaySource === "ACTUAL"
            ? round2(Number(row.actualDayKwh) || 0)
            : 0,
        source: row.scoredDayDisplaySource === "ACTUAL" ? "ACTUAL" : "MISSING_REFERENCE",
        selectedTestDate: true,
        status: row.parityAvailability ?? "missing_expected_reference",
        reasonCode: row.parityReasonCode ?? "ARTIFACT_SIMULATED_REFERENCE_MISSING",
      });
    }
    return Array.from(byDate.values()).sort((a, b) => (a.date < b.date ? -1 : 1));
  })();
  const hasGapfillLoadCurveData =
    Array.isArray((metrics as any)?.diagnostics?.hourlyProfileMasked) &&
    ((metrics as any).diagnostics.hourlyProfileMasked as Array<unknown>).length > 0;
  const displaySimulatedLoadCurveMessage =
    !hasGapfillLoadCurveData && (usageShapeProfileUsed || usageShapeDiag?.found === true)
      ? includeDiagnostics
        ? "No 15-minute load-curve visualization was returned for this Gap-Fill view, but the shared sim still used the ensured usage-shape dependency for day shaping."
        : "Compact Gap-Fill view does not include a 15-minute load-curve visualization, but the shared sim still used the ensured usage-shape dependency for day shaping."
      : null;
  const truthEnvelope = {
    compareFreshModeUsed,
    compareCalculationScope,
    compareSharedCalcPath,
    compareSimSource,
    displaySimSource,
    artifactParityReferenceSource: (sharedSim as any).artifactSimulatedDayReferenceSource ?? null,
    weatherBasisUsed,
    compareTruth,
    compareRequestTruth,
    displayVsFreshParityForScoredDays: (sharedSim as any).displayVsFreshParityForScoredDays ?? null,
    travelVacantParityRows,
    travelVacantParityTruth,
    timezoneUsedForScoring: scoringTimezone,
    windowUsedForScoring: scoringWindow,
    requestedTestDaysCount,
    scoringTestDaysCount,
    scoredIntervalsCount,
    travelVacantExclusionCount: boundedTravelDateKeysLocal.size,
    artifactDisplayReferenceWarning,
    usageShapeDependencyStatus: (() => {
      if (usageShapeReasonNotUsed) {
        return {
          status: "missing_or_not_used",
          reason: usageShapeReasonNotUsed,
          dayTotalSource: usageShapeDayTotalSource,
        };
      }
      if (usageShapeProfileUsed || usageShapeDiag?.found === true) {
        return {
          status: "available",
          reason: null,
          dayTotalSource: usageShapeDayTotalSource,
        };
      }
      if (!usageShapeDiag) {
        return { status: "unknown", reason: null, dayTotalSource: usageShapeDayTotalSource };
      }
      if (usageShapeDiag.found === false) {
        return { status: "unknown", reason: null, dayTotalSource: usageShapeDayTotalSource };
      }
      return {
        status: "unknown",
        reason: null,
        dayTotalSource: usageShapeDayTotalSource,
      };
    })(),
    artifact: {
      sourceMode: artifactSourceMode,
      sourceNote: artifactSourceNote,
      requestedInputHash,
      requestedScenarioId: artifactRequestedScenarioId,
      artifactInputHashUsed,
      artifactHashMatch,
      scenarioId: artifactScenarioId ?? stableScenarioId,
      exactIdentifierUsed: artifactExactIdentifierUsed,
      exactIdentityRequested: artifactExactIdentityRequested,
      exactIdentityResolved: artifactExactIdentityResolved,
      identitySource: artifactIdentitySourceUsed,
      sameRunEnsureArtifact: artifactSameRunEnsureIdentity,
      compareUsedSameRunEnsureArtifact: artifactSameRunEnsureIdentity && artifactExactIdentityResolved,
      fallbackOccurred: artifactFallbackOccurred,
      fallbackReason: artifactFallbackReason,
      createdAt: artifactCreatedAt,
      updatedAt: artifactUpdatedAt,
      rebuiltRequested: rebuildArtifact,
      autoRebuilt: sharedSim.artifactAutoRebuilt === true,
      pathKind:
        sharedSim.artifactAutoRebuilt || rebuildArtifact
          ? "full_rebuild"
          : artifactSourceMode === "exact_hash_match" || artifactSourceMode === "latest_by_scenario_fallback"
            ? "cheap_read"
            : "unknown",
    },
  };
  const accuracyTuningBreakdowns = {
    source: "scored_day_truth_rows",
    byTemperatureBand: buildBucketRows(byTempBandMap),
    byWeekdayWeekend: buildBucketRows(byDayTypeMap),
    byMonth: buildBucketRows(byMonthMap),
    byHourBlock,
    byFallbackTier: buildBucketRows(byFallbackTierMap),
    byWeatherRegime: buildBucketRows(byWeatherRegimeMap),
  };
  let fullReport: ReturnType<typeof buildFullReport> | null = null;
  if (includeFullReportText) {
    try {
      fullReport = await withTimeout(
        withRequestAbort(
          Promise.resolve(
            buildFullReport({
            reportVersion: REPORT_VERSION,
            generatedAt: new Date().toISOString(),
            env: process.env.NODE_ENV ?? "development",
            houseId: house.id,
            userId: user.id,
            email: user.email,
            houseLabel: [house.addressLine1, house.addressCity, house.addressState].filter(Boolean).join(", ") || house.id,
            timezone,
            timezoneUsedForScoring: scoringTimezone,
            testRangesInput: testRanges,
            travelRangesFromDb,
            guardrailExcludedRanges: mergeDateKeysToRanges(Array.from(guardrailExcludedDateKeysLocal).sort()),
            listTestDateKeys: testDateKeysSorted,
            testIntervalsCount: actualTestIntervals.length,
            testDaysCount: testDateKeysLocal.size,
            guardrailExcludedDateKeysCount: guardrailExcludedDateKeysLocal.size,
            guardrailExcludedDateKeysSample: sortedSample(guardrailExcludedDateKeysLocal),
            dateKeyDiag: {
              travelDateKeysLocalCount: travelDateKeysLocal.size,
              travelDateKeysLocalSample: sortedSample(travelDateKeysLocal),
              testDateKeysLocalCount: testDateKeysLocal.size,
              testDateKeysLocalSample: sortedSample(testDateKeysLocal),
              guardrailExcludedDateKeysCount: guardrailExcludedDateKeysLocal.size,
              guardrailExcludedDateKeysSample: sortedSample(guardrailExcludedDateKeysLocal),
              setArithmetic: {
                onlyTravelCount: Array.from(travelDateKeysLocal).filter((dk) => !testDateKeysLocal.has(dk)).length,
                onlyTravelSample: Array.from(travelDateKeysLocal).filter((dk) => !testDateKeysLocal.has(dk)).sort().slice(0, 10),
                onlyTestCount: Array.from(testDateKeysLocal).filter((dk) => !travelDateKeysLocal.has(dk)).length,
                onlyTestSample: Array.from(testDateKeysLocal).filter((dk) => !travelDateKeysLocal.has(dk)).sort().slice(0, 10),
                overlapCount: overlapLocal.size,
                overlapSample: sortedSample(overlapLocal),
              },
            },
            dataset: {
              summary: {
                intervalsCount: chartIntervalCount,
                start: sharedCoverageWindow.startDate,
                end: sharedCoverageWindow.endDate,
              },
              totals: {
                netKwh: Number((sharedSim.modelAssumptions as any)?.totalKwh ?? metrics.totalSimKwhMasked ?? 0) || 0,
              },
              insights: {
                baseloadDaily: (sharedSim.modelAssumptions as any)?.baseloadDaily ?? null,
                baseload: (sharedSim.modelAssumptions as any)?.baseload ?? null,
                timeOfDayBuckets: [],
                weekdayVsWeekend: {
                  weekday: Number((sharedSim.modelAssumptions as any)?.weekdayKwh ?? 0) || 0,
                  weekend: Number((sharedSim.modelAssumptions as any)?.weekendKwh ?? 0) || 0,
                },
                peakDay: null,
                peakHour: null,
              },
              monthly: sharedSim.simulatedChartMonthly,
            },
            buildInputs: {
              canonicalMonths,
            },
            configHash: String(ma.artifactInputHash ?? "n/a"),
            excludedDateKeysCount: boundedTravelDateKeysLocal.size,
            excludedDateKeysSample: sortedSample(boundedTravelDateKeysLocal),
            homeProfile: responseHomeProfile,
            applianceProfile: responseApplianceProfile,
            modelAssumptions: sharedSim.modelAssumptions,
            artifactSourceMode,
            requestedInputHash,
            artifactInputHashUsed,
            artifactHashMatch,
            artifactScenarioId,
            artifactCreatedAt,
            artifactUpdatedAt,
            artifactSourceNote,
            metrics: {
              mae: metrics.mae,
              rmse: metrics.rmse,
              maxAbs: metrics.maxAbs,
              wape: metrics.wape,
              mape: metrics.mape,
              totalActualKwhMasked: metrics.totalActualKwhMasked,
              totalSimKwhMasked: metrics.totalSimKwhMasked,
              deltaKwhMasked: metrics.deltaKwhMasked,
              mapeFiltered: (metrics as any).mapeFiltered ?? null,
              mapeFilteredCount: (metrics as any).mapeFilteredCount ?? 0,
              byMonth: metrics.byMonth,
              byHour: metrics.byHour,
              worst10Abs: (metrics as any).worst10Abs ?? [],
            },
            diagnostics: {
              dailyTotalsMasked: metrics.diagnostics.dailyTotalsMasked,
              top10Under: metrics.diagnostics.top10Under,
              top10Over: metrics.diagnostics.top10Over,
              hourlyProfileMasked: metrics.diagnostics.hourlyProfileMasked,
            },
            poolHoursLens: null,
            usageShapeProfileDiag: ((sharedSim.modelAssumptions as any)?.usageShapeProfileDiag ?? null) as any,
            simulatedDayDiagnosticsSample:
              ((sharedSim.modelAssumptions as any)?.simulatedDayDiagnosticsSample ?? []) as Array<{
                localDate: string;
                targetDayKwhBeforeWeather: number;
                weatherAdjustedDayKwh: number;
                dayTypeUsed: "weekday" | "weekend" | null;
                shapeVariantUsed: string | null;
                finalDayKwh: number;
                intervalSumKwh: number;
                fallbackLevel: string | null;
              }>,
            cacheHit: !rebuildArtifact,
            cacheSource: rebuildArtifact ? "rebuilt" : "lab",
            inputHash: String((sharedSim.modelAssumptions as any)?.artifactInputHash ?? ""),
            intervalDataFingerprint: String((sharedSim.modelAssumptions as any)?.intervalDataFingerprint ?? ""),
            engineVersion: String((sharedSim.modelAssumptions as any)?.simVersion ?? ""),
            intervalsCodec: String((sharedSim.modelAssumptions as any)?.intervalsCodec ?? ""),
            compressedBytesLength: Number((sharedSim.modelAssumptions as any)?.compressedBytesLength ?? 0) || 0,
            enginePath: "production_past_stitched",
            expectedTestIntervals: scoringTestDateKeysLocal.size * 96,
            coveragePct: scoringTestDateKeysLocal.size > 0 ? actualScoringIntervals.length / (scoringTestDateKeysLocal.size * 96) : null,
            joinJoinedCount: actualScoringIntervals.length - scoringJoinMissingActual.length,
            joinMissingCount: scoringJoinMissingActual.length,
            joinPct:
              actualScoringIntervals.length > 0
                ? (actualScoringIntervals.length - scoringJoinMissingActual.length) / actualScoringIntervals.length
                : null,
            joinSampleActualTs: actualScoringIntervalsCanon.slice(0, 5).map((p) => p.timestamp),
            joinSampleSimTs: sharedSim.simulatedTestIntervals.slice(0, 5).map((p) => p.timestamp),
            testSelectionMode,
            testDaysRequested: testDaysRequested ?? undefined,
            testDaysSelected,
            seedUsed,
            testMode,
            candidateDaysAfterModeFilterCount,
            minDayCoveragePct,
            candidateWindowStartUtc: candidateWindowStart,
            candidateWindowEndUtc: candidateWindowEnd,
            excludedFromTest_travelCount,
            scoredDayWeatherRows: compactScoredDayWeatherRows,
            scoredDayWeatherTruth: scoredDayWeatherTruth as any,
            })
          ),
          req.signal,
          "compare_core_request_aborted_build_full_report"
        ),
        ROUTE_COMPARE_REPORT_TIMEOUT_MS,
        "compare_core_route_timeout_build_full_report"
      );
      markCompareCoreStep(compareCoreTiming, "build_full_report");
      if (compareRunId) {
        await markGapfillCompareRunRunning({
          compareRunId,
          phase: "build_full_report_done",
          statusMeta: {
            route: "admin_gapfill_lab",
            compareRunId,
            compareCoreStepTimings: compareCoreTiming.stepsMs,
          },
        });
      }
    } catch (err: unknown) {
      const normalizedError = normalizeRouteError(
        err,
        "Compare core failed while building diagnostics report payload."
      );
      const timedOut = normalizedError.code === "compare_core_route_timeout_build_full_report";
      const aborted = normalizedError.code === "compare_core_request_aborted_build_full_report";
      const compareRunEnvelope = await markCompareRunFailure({
        phase: "build_full_report",
        failureCode: aborted
          ? "COMPARE_CORE_REQUEST_ABORTED_BUILD_DIAGNOSTICS"
          : timedOut
          ? "COMPARE_CORE_ROUTE_TIMEOUT_BUILD_DIAGNOSTICS"
          : "COMPARE_CORE_ROUTE_EXCEPTION_BUILD_DIAGNOSTICS",
        failureMessage: aborted
          ? "Compare core request was aborted while building diagnostics report payload."
          : timedOut
          ? "Compare core timed out while building diagnostics report payload."
          : "Compare core failed while building diagnostics report payload.",
        statusCode: aborted ? 499 : timedOut ? 504 : 500,
        compareCoreFailedStep: "build_diagnostics",
      });
      return NextResponse.json(
        {
          ok: false,
          error: aborted
            ? "compare_core_request_aborted"
            : timedOut
              ? "compare_core_route_timeout"
              : "compare_core_route_exception",
          message: aborted
            ? "Compare core request was aborted while building diagnostics report payload."
            : timedOut
            ? "Compare core timed out while building diagnostics report payload."
            : "Compare core failed while building diagnostics report payload.",
          reasonCode: aborted
            ? "COMPARE_CORE_REQUEST_ABORTED_BUILD_DIAGNOSTICS"
            : timedOut
            ? "COMPARE_CORE_ROUTE_TIMEOUT_BUILD_DIAGNOSTICS"
            : "COMPARE_CORE_ROUTE_EXCEPTION_BUILD_DIAGNOSTICS",
          ...(heavyOnlyCompactResponse
            ? buildHeavyTiming(compareCoreTiming, {
                heavyFailedStep: "build_full_report",
                heavyResponseMode: "heavy_only_compact",
              })
            : {}),
          compareCoreTiming: finalizeCompareCoreTiming(compareCoreTiming, {
            failedStep: "build_diagnostics",
            timeoutMs: timedOut ? ROUTE_COMPARE_REPORT_TIMEOUT_MS : undefined,
            requestAborted: aborted || undefined,
            compareRequestTruth,
            selectedDaysCoreLightweight,
          }),
          ...(compareRunEnvelope ?? {}),
        },
        { status: aborted ? 499 : timedOut ? 504 : 500 }
      );
    }
  }
  markCompareCoreStep(compareCoreTiming, "build_diagnostics");
  markCompareCoreStep(compareCoreTiming, "finalize_response");
  const compareCoreTimingEnvelope = finalizeCompareCoreTiming(compareCoreTiming, {
    compareRequestTruth,
    selectedDaysCoreLightweight,
    compareCoreMode,
    selectedDaysRequestedCount: requestedTestDaysCount,
    selectedDaysScoredCount: scoringTestDaysCount,
    freshSimIntervalCountSelectedDays: simulatedTestIntervalsCount,
    actualIntervalCountSelectedDays: actualTestIntervalsCount,
    artifactReferenceDayCountUsed,
    compareCorePhaseStep: "finalize_response",
    compareCorePhaseElapsedMsByStep: compareCoreTiming.stepsMs,
  });
  const compareRunSnapshotPayload: Record<string, unknown> = {
    compareRunId,
    snapshotVersion: "gapfill_compare_snapshot_v1",
    generatedAt: new Date().toISOString(),
    userId: user.id,
    houseId: house.id,
    timezone,
    timezoneUsedForScoring: scoringTimezone,
    compareFreshMode,
    compareFreshModeUsed,
    compareCoreMode,
    compareRequestTruth,
    artifactRequestTruth,
    identityTruth: {
      requestedInputHash,
      artifactInputHashUsed,
      artifactHashMatch,
      artifactScenarioId,
      artifactIdentitySource: artifactIdentitySourceUsed,
      requireExactArtifactMatch,
      artifactSourceMode,
      artifactSourceNote,
      artifactCreatedAt,
      artifactUpdatedAt,
      artifactExactIdentityRequested,
      artifactExactIdentityResolved,
      artifactSameRunEnsureIdentity,
      artifactFallbackOccurred,
      artifactFallbackReason,
      artifactExactIdentifierUsed,
    },
    selectedScoredDateKeys: Array.from(scoringTestDateKeysLocal).sort(),
    scoredDayTruthRowsCompact: scoredDayTruthRows.map((row) => ({
      localDate: row.localDate,
      actualDayKwh: row.actualDayKwh,
      freshCompareSimDayKwh: row.freshCompareSimDayKwh,
      displayedPastStyleSimDayKwh: row.displayedPastStyleSimDayKwh,
      actualVsFreshErrorKwh: row.actualVsFreshErrorKwh,
      displayVsFreshParityMatch: row.displayVsFreshParityMatch,
      parityAvailability: row.parityAvailability,
      weatherBasis: row.weatherBasis,
      weatherSourceUsed: row.weatherSourceUsed,
      weatherFallbackReason: row.weatherFallbackReason,
      avgTempF: row.avgTempF,
      minTempF: row.minTempF,
      maxTempF: row.maxTempF,
      hdd65: row.hdd65,
      cdd65: row.cdd65,
      fallbackLevel: row.fallbackLevel,
      selectedReferenceMatchTier: row.selectedReferenceMatchTier,
      selectedMatchSampleCount: row.selectedMatchSampleCount,
      reasonCode: row.reasonCode,
    })),
    scoredDayWeatherRows: compactScoredDayWeatherRows,
    scoredDayWeatherTruth,
    travelVacantParityRows,
    travelVacantParityTruth,
    missAttributionSummary,
    accuracyTuningBreakdowns,
    compareTruth,
    truthEnvelope,
    metricsSummary: {
      mae: metrics.mae,
      rmse: metrics.rmse,
      mape: metrics.mape,
      wape: metrics.wape,
      maxAbs: metrics.maxAbs,
      totalActualKwhMasked: metrics.totalActualKwhMasked,
      totalSimKwhMasked: metrics.totalSimKwhMasked,
      deltaKwhMasked: metrics.deltaKwhMasked,
    },
    compareCoreTiming: compareCoreTimingEnvelope,
    counts: {
      requestedTestDaysCount,
      scoringTestDaysCount,
      scoredIntervalsCount,
      actualTestIntervalsCount,
      simulatedTestIntervalsCount,
      boundedTravelDateKeysCount: boundedTravelDateKeysLocal.size,
    },
    responseMode: heavyOnlyCompactResponse ? "heavy_only_compact" : "default",
  };
  if (compareRunId) {
    const snapshotPersisted = await finalizeGapfillCompareRunSnapshot({
      compareRunId,
      phase: "compare_core_succeeded",
      snapshot: compareRunSnapshotPayload,
      statusMeta: {
        route: "admin_gapfill_lab",
        compareRunId,
        compareRequestTruth,
        artifactRequestTruth,
        compareCoreTiming: compareCoreTimingEnvelope,
        responseMode: heavyOnlyCompactResponse ? "heavy_only_compact" : "default",
      },
    });
    if (!snapshotPersisted) {
      await markGapfillCompareRunFailed({
        compareRunId,
        phase: "snapshot_persist_failed",
        failureCode: "COMPARE_RUN_SNAPSHOT_PERSIST_FAILED",
        failureMessage:
          "Compare core calculation completed, but final compare snapshot persistence failed.",
        statusMeta: {
          route: "admin_gapfill_lab",
          compareRunId,
          compareRequestTruth,
          artifactRequestTruth,
          compareCoreTiming: compareCoreTimingEnvelope,
        },
      });
      compareRunStatus = "failed";
      compareRunSnapshotReady = false;
      compareRunTerminalState = true;
      logCompareRunLifecycle("error", "compare_run_snapshot_persist_failed", {
        phase: "snapshot_persist_failed",
        failureCode: "COMPARE_RUN_SNAPSHOT_PERSIST_FAILED",
      });
      return NextResponse.json(
        {
          ok: false,
          error: "compare_run_snapshot_persist_failed",
          message:
            "Compare core completed, but the final compare snapshot could not be persisted.",
          reasonCode: "COMPARE_RUN_SNAPSHOT_PERSIST_FAILED",
          compareRunId,
          compareRunStatus,
          compareRunSnapshotReady,
          compareCoreTiming: compareCoreTimingEnvelope,
          compareRequestTruth,
          artifactRequestTruth,
        },
        { status: 500 }
      );
    }
    compareRunStatus = "succeeded";
    compareRunSnapshotReady = true;
    compareRunTerminalState = true;
    logCompareRunLifecycle("info", "compare_run_succeeded", {
      phase: "compare_core_succeeded",
      compareCoreTiming: compareCoreTimingEnvelope,
    });
  }
  if (heavyOnlyCompactResponse) {
    return NextResponse.json({
      ok: true,
      responseMode: "heavy_only_compact",
      compareRunId,
      compareRunStatus,
      compareRunSnapshotReady,
      diagnostics: includeDiagnostics
        ? {
            dailyTotalsChartSim: sharedSim.simulatedChartDaily,
            monthlyTotalsChartSim: sharedSim.simulatedChartMonthly,
            stitchedMonthChartSim: sharedSim.simulatedChartStitchedMonth,
            chartIntervalCount,
            dailyTotalsMasked: metrics.diagnostics.dailyTotalsMasked,
            top10Under: metrics.diagnostics.top10Under,
            top10Over: metrics.diagnostics.top10Over,
            hourlyProfileMasked: metrics.diagnostics.hourlyProfileMasked,
            seasonalSplit: metrics.diagnostics.seasonalSplit,
          }
        : {
            included: false,
            chartIntervalCount,
          },
      fullReportText: includeFullReportText ? fullReport?.fullReportText : undefined,
      missAttributionSummary,
      accuracyTuningBreakdowns,
      travelVacantParityRows,
      travelVacantParityTruth,
      scoredDayWeatherRows: compactScoredDayWeatherRows,
      scoredDayWeatherTruth,
      heavyTruth: {
        source: "heavy_only_compact",
        artifactSourceMode,
        artifactHashMatch,
        artifactExactIdentityResolved,
        parityAvailability:
          ((sharedSim as any)?.displayVsFreshParityForScoredDays?.availability as string | undefined) ?? null,
        parityReasonCode:
          ((sharedSim as any)?.displayVsFreshParityForScoredDays?.reasonCode as string | undefined) ?? null,
      },
      ...buildHeavyTiming(compareCoreTiming, {
        heavyResponseMode: "heavy_only_compact",
      }),
    });
  }

  return NextResponse.json({
    ok: true,
    compareRunId,
    compareRunStatus,
    compareRunSnapshotReady,
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
    rebuilt: rebuildArtifact,
    artifactAutoRebuilt: sharedSim.artifactAutoRebuilt,
    enginePath: "production_past_stitched",
    cacheSource: rebuildArtifact ? "rebuilt" : "artifact",
    sourceOfDaySimulationCore: SOURCE_OF_DAY_SIMULATION_CORE,
    scenarioId: stableScenarioId,
    homeProfile: responseHomeProfile,
    applianceProfile: responseApplianceProfile,
    modelAssumptions: responseModelAssumptions,
    artifactSourceMode,
    requestedInputHash,
    artifactInputHashUsed,
    artifactHashMatch,
    artifactScenarioId,
    artifactCreatedAt,
    artifactUpdatedAt,
    artifactSourceNote,
    testIntervalsCount: actualTestIntervals.length,
    actualTestIntervalsCount,
    simulatedTestIntervalsCount,
    hasScoreableIntervals,
    message: scoreableIntervalsMessage,
    scoringActualSource,
    scoringSimulatedSource,
    timezoneUsedForScoring: scoringTimezone,
    windowUsedForScoring: scoringWindow,
    scoringUsedSharedArtifact,
    scoringExcludedSource,
    artifactBuildExcludedSource,
    artifactUsesTestDaysInIdentity,
    artifactUsesTravelDaysInIdentity,
    sharedArtifactScenarioId,
    sharedArtifactInputHash,
    comparePulledFromSharedArtifactOnly,
    scoredTestDaysMissingSimulatedOwnershipCount,
    requestedTestDaysCount,
    scoringTestDaysCount,
    scoredIntervalsCount,
    compareSharedCalcPath,
    compareFreshModeUsed,
    compareCalculationScope,
    compareCoreMode,
    compareCoreStepTimings: compareCoreTiming.stepsMs,
    selectedFreshIntervalCount: simulatedTestIntervalsCount,
    selectedActualIntervalCount: actualTestIntervalsCount,
    artifactReferenceDayCount: artifactReferenceDayCountUsed,
    displaySimSource,
    compareSimSource,
    weatherBasisUsed,
    compareTruth,
    compareRequestTruth,
    artifactRequestTruth,
    compareCoreTiming: compareCoreTimingEnvelope,
    artifactDisplayReferenceWarning,
    displayVsFreshParityForScoredDays: (sharedSim as any).displayVsFreshParityForScoredDays ?? null,
    travelVacantParityRows,
    travelVacantParityTruth,
    scoredDayWeatherRows: compactScoredDayWeatherRows,
    scoredDayWeatherTruth,
    truthEnvelope,
    displaySimulated: {
      source: (sharedSim as any).displaySimSource ?? null,
      coverageStart: sharedCoverageWindow.startDate,
      coverageEnd: sharedCoverageWindow.endDate,
      daily: displayDailyRows,
      loadCurveMessage: displaySimulatedLoadCurveMessage,
      monthly: sharedSim.simulatedChartMonthly,
      stitchedMonth: sharedSim.simulatedChartStitchedMonth,
    },
    scoredDayTruthRows,
    missAttributionSummary,
    accuracyTuningBreakdowns,
    metrics: {
      mae: metrics.mae,
      rmse: metrics.rmse,
      mape: metrics.mape,
      wape: metrics.wape,
      maxAbs: metrics.maxAbs,
    },
    primaryPercentMetric: Number.isFinite(metrics.wape) ? metrics.wape : null,
    byMonth: metrics.byMonth,
    byHour: metrics.byHour,
    byDayType: metrics.byDayType,
    worstDays: metrics.worstDays,
    diagnostics: includeDiagnostics
      ? {
          // Chart scope is always the full canonical window for parity with Usage dashboard charts.
          dailyTotalsChartSim: sharedSim.simulatedChartDaily,
          monthlyTotalsChartSim: sharedSim.simulatedChartMonthly,
          stitchedMonthChartSim: sharedSim.simulatedChartStitchedMonth,
          chartIntervalCount,
          dailyTotalsMasked: metrics.diagnostics.dailyTotalsMasked,
          top10Under: metrics.diagnostics.top10Under,
          top10Over: metrics.diagnostics.top10Over,
          hourlyProfileMasked: metrics.diagnostics.hourlyProfileMasked,
          seasonalSplit: metrics.diagnostics.seasonalSplit,
        }
      : {
          included: false,
          chartIntervalCount,
        },
    parity: {
      intervalCount: actualScoringIntervals.length,
      testWindowKwh: metrics.totalActualKwhMasked,
      annualKwh: metrics.totalActualKwhMasked,
      baseloadKwhPer15m: null,
      baseloadDailyKwh: null,
      windowStartUtc: sharedCoverageWindow.startDate,
      windowEndUtc: sharedCoverageWindow.endDate,
      canonicalWindowHelper,
    },
    fullReportText: includeFullReportText ? fullReport?.fullReportText : undefined,
    pasteSummary:
      `Gap-Fill Lab (artifact-first): engine=production_past_stitched; mode=artifact_only; rebuilt=${String(rebuildArtifact)}; ` +
      `WAPE=${metrics.wape}%; MAE=${metrics.mae} kWh; intervalCount=${actualTestIntervals.length}; scenarioId=${stableScenarioId}`,
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