// Auto-extracted from route.ts — shared by POST and gapfillCompareCorePipeline.
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

/** Shared compare/report timeouts (Gap-Fill compare_core + full report). */
export const ROUTE_COMPARE_SHARED_TIMEOUT_MS = 90_000;
export const ROUTE_COMPARE_REPORT_TIMEOUT_MS = 35_000;

/** Built in POST; parity fields align with GapfillScoredDayParity* in usageSimulator/service. */
export type GapfillLabScoredDayTruthRow = {
  localDate: string;
  actualDayKwh: number;
  freshCompareSimDayKwh: number | null;
  displayedPastStyleSimDayKwh: number | null;
  actualVsFreshErrorKwh: number | null;
  displayVsFreshParityMatch: boolean | null;
  parityAvailability: GapfillScoredDayParityAvailability;
  parityDisplaySourceUsed: string;
  artifactSimulatedDayReferenceSource: string;
  parityDisplayValueKind: GapfillScoredDayParityDisplayValueKind;
  parityReasonCode: GapfillScoredDayParityReasonCode;
  scoredDayDisplaySource: "SIMULATED" | "MISSING_REFERENCE";
  dayType: "weekend" | "weekday";
  weatherBasis: string | null;
  weatherSourceUsed: string | null;
  weatherFallbackReason: string | null;
  avgTempF: number | null;
  minTempF: number | null;
  maxTempF: number | null;
  hdd65: number | null;
  cdd65: number | null;
  fallbackLevel: string | null;
  selectedDayTotalSource: string | null;
  selectedShapeVariant: string | null;
  selectedReferenceMatchTier: string | null;
  selectedMatchSampleCount: number | null;
  reasonCode: string | null;
};

export type DateRange = { startDate: string; endDate: string };
export type Usage365Payload = {
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

export type IntervalPoint = { timestamp: string; kwh: number };

export function shiftIsoDateUtc(dateKey: string, deltaDays: number): string {
  const key = String(dateKey ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return key;
  const base = new Date(`${key}T12:00:00.000Z`);
  if (Number.isNaN(base.getTime())) return key;
  base.setUTCDate(base.getUTCDate() + deltaDays);
  return base.toISOString().slice(0, 10);
}

export function normalizeFifteenCurve96(
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

export function sortedSample(keys: Set<string>, limit = 10): string[] {
  return Array.from(keys).sort().slice(0, limit);
}

export function setIntersect(a: Set<string>, b: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const x of Array.from(a)) if (b.has(x)) out.add(x);
  return out;
}

export function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export type CompareCoreStepKey =
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

export function startCompareCoreTiming() {
  return {
    startedAtMs: Date.now(),
    startedAt: new Date().toISOString(),
    stepsMs: {} as Record<CompareCoreStepKey, number>,
    lastCompletedStep: null as CompareCoreStepKey | null,
  };
}

export function markCompareCoreStep(
  timing: ReturnType<typeof startCompareCoreTiming>,
  step: CompareCoreStepKey
) {
  timing.stepsMs[step] = Math.max(0, Date.now() - timing.startedAtMs);
  timing.lastCompletedStep = step;
}

export function finalizeCompareCoreTiming(
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

export function buildHeavyTiming(
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

export function buildSelectedDaysCoreResponseModelAssumptions(modelAssumptions: any): Record<string, unknown> | null {
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

export async function withTimeout<T>(task: Promise<T>, timeoutMs: number, timeoutErrorCode: string): Promise<T> {
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

export async function withRequestAbort<T>(
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
export function attachAbortForwarders(target: AbortController, ...sources: Array<AbortSignal | undefined>): () => void {
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

export function normalizeRouteError(value: unknown, fallbackMessage: string): { code: string; message: string } {
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

export type GapfillSnapshotReaderAction =
  | "compare_heavy_manifest"
  | "compare_heavy_parity"
  | "compare_heavy_scored_days"
  | "compare_run_poll";

export function toSnapshotReaderAction(value: unknown): GapfillSnapshotReaderAction | null {
  const v = typeof value === "string" ? value.trim() : "";
  if (
    v === "compare_heavy_manifest" ||
    v === "compare_heavy_parity" ||
    v === "compare_heavy_scored_days" ||
    v === "compare_run_poll"
  ) {
    return v;
  }
  return null;
}

export function buildSnapshotReaderBase(args: {
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

export function safeRatio(numerator: number, denominator: number): number | null {
  const d = Number(denominator) || 0;
  if (d === 0) return null;
  return round2((Number(numerator) / d) * 100);
}

export function bucketHourBlock(hour: number): "00-05" | "06-11" | "12-17" | "18-23" {
  if (hour < 6) return "00-05";
  if (hour < 12) return "06-11";
  if (hour < 18) return "12-17";
  return "18-23";
}

export function classifyTemperatureBand(avgTempF: number | null): string {
  if (avgTempF == null || !Number.isFinite(avgTempF)) return "unknown";
  if (avgTempF < 40) return "<40F";
  if (avgTempF < 55) return "40-54F";
  if (avgTempF < 70) return "55-69F";
  if (avgTempF < 85) return "70-84F";
  return ">=85F";
}

export function classifyWeatherRegime(hdd65: number | null, cdd65: number | null): string {
  const hdd = Number(hdd65);
  const cdd = Number(cdd65);
  if (!Number.isFinite(hdd) && !Number.isFinite(cdd)) return "unknown";
  if ((hdd || 0) > (cdd || 0)) return "heating";
  if ((cdd || 0) > (hdd || 0)) return "cooling";
  return "neutral";
}

export function topCounts<T extends string>(rows: Array<{ key: T; count: number }>, limit = 3): Array<{ key: T; count: number }> {
  return rows
    .filter((r) => Number.isFinite(r.count) && r.count > 0)
    .sort((a, b) => b.count - a.count || String(a.key).localeCompare(String(b.key)))
    .slice(0, limit);
}

export function isValidIanaTimezone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.trim().length === 0) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function getLocalHourMinuteInTimezone(tsIso: string, tz: string): { hour: number; minute: number } {
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

export function buildUsage365Payload(args: {
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
export async function getTravelRangesFromDb(userId: string, houseId: string): Promise<Array<{ startDate: string; endDate: string }>> {
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

export const REPORT_VERSION = "gapfill_lab_report_v3";
export const TRUNCATE_LIST = 30;

export function buildFullReport(args: {
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
