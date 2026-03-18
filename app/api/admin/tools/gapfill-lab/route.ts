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
  getSharedPastCoverageWindowForHouse,
} from "@/modules/usageSimulator/service";
import { IntervalSeriesKind } from "@/modules/usageSimulator/kinds";
import {
  classifySimulationFailure,
  recordSimulationDataAlert,
} from "@/modules/usageSimulator/simulationDataAlerts";
import { monthsEndingAt } from "@/lib/time/chicago";
import { buildDisplayMonthlyFromIntervalsUtc } from "@/modules/usageSimulator/dataset";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // Explicit rebuilds can run full-year canonical build before compare.

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
    identifiers: { houseId: j.houseId, userId: j.userId, email: j.email, houseLabel: j.houseLabel, timezone: j.timezone },
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
      lines.push("No Past cache; sim from UsageShapeProfile or auto-built lite (or uniform fallback).");
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
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

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

  if (testDateKeysLocal.size === 0) {
    return NextResponse.json(
      { ok: false, error: "test_ranges_required", message: "At least one valid Test Date range is required (or use Random Test Days)." },
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
      },
      { status: 400 }
    );
  }

  const testDateKeysSorted = Array.from(testDateKeysLocal).sort();
  const minTestKey = testDateKeysSorted[0] ?? "";
  const fetchStart = minTestKey;
  const fetchEnd = testDateKeysSorted[testDateKeysSorted.length - 1] ?? "";

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
                  startDate: r.startDate,
                  endDate: r.endDate,
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
            startDate: fetchStart,
            endDate: fetchEnd,
          })
  );

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
      },
      { status: 400 }
    );
  }

  const actualTestIntervals = actualIntervals.filter((p) =>
    testDateKeysLocal.has(dateKeyInTimezone(p.timestamp, timezone))
  );
  if (actualTestIntervals.length === 0) {
    const classification = classifySimulationFailure({
      code: "no_actual_data",
      message: "No actual interval data found for Test dates in this window.",
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
        message: "No actual interval data found for Test dates in this window.",
        explanation: classification.userFacingExplanation,
      },
      { status: 400 }
    );
  }

  const actualTestIntervalsCanon = actualTestIntervals.map((p) => ({
    ...p,
    timestamp: canonicalIntervalKey(String(p?.timestamp ?? "").trim()),
  }));

  // Canonical path: Gap-Fill scoring reads the shared Past artifact/service output only.
  const rebuildArtifact = body?.rebuildArtifact === true;
  const rebuildOnly = body?.rebuildOnly === true;
  if (rebuildArtifact && rebuildOnly) {
    const rebuiltCompare = await buildGapfillCompareSimShared({
      userId: user.id,
      houseId: house.id,
      timezone,
      canonicalWindow,
      testDateKeysLocal,
      rebuildArtifact: true,
    });
    if (!rebuiltCompare.ok) {
      const classification = classifySimulationFailure({
        code: String((rebuiltCompare.body as any)?.error ?? ""),
        message: String((rebuiltCompare.body as any)?.message ?? ""),
      });
      return NextResponse.json(
        {
          ...(rebuiltCompare.body as Record<string, unknown>),
          explanation: classification.userFacingExplanation,
          missingData: classification.missingData,
          reasonCode: classification.reasonCode,
        },
        { status: rebuiltCompare.status }
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
      rebuilt: true,
      message:
        "Shared Past artifact rebuilt via shared simulator path. Running compare next will score selected test days from shared artifact output.",
      testRangesUsed,
      testSelectionMode,
      testDaysRequested,
      testDaysSelected,
      seedUsed,
      travelRangesFromDb,
    });
  }
  const sharedSim = await buildGapfillCompareSimShared({
    userId: user.id,
    houseId: house.id,
    timezone,
    canonicalWindow,
    testDateKeysLocal,
    rebuildArtifact,
  });
  if (!sharedSim.ok) {
    const classification = classifySimulationFailure({
      code: String((sharedSim.body as any)?.error ?? ""),
      message: String((sharedSim.body as any)?.message ?? ""),
    });
    const mergedBody = {
      ...(sharedSim.body as Record<string, unknown>),
      explanation: classification.userFacingExplanation,
      missingData: classification.missingData,
      reasonCode: classification.reasonCode,
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
      },
    });
    return NextResponse.json(mergedBody, { status: sharedSim.status });
  }

  const simulatedByTs = new Map<string, number>();
  for (const p of sharedSim.simulatedTestIntervals) simulatedByTs.set(p.timestamp, p.kwh);
  const simulatedScoringDateKeysLocal = new Set<string>(
    sharedSim.simulatedTestIntervals.map((p) => dateKeyInTimezone(p.timestamp, timezone))
  );
  const scoringActualTestIntervalsCanon = actualTestIntervalsCanon.filter((p) =>
    simulatedScoringDateKeysLocal.has(dateKeyInTimezone(p.timestamp, timezone))
  );
  const inferredMissingSimulatedOwnershipCount = Array.from(testDateKeysLocal).filter(
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
  const missingJoinedActual = scoringActualTestIntervalsCanon.filter((p) => !simulatedByTs.has(p.timestamp));
  if (missingJoinedActual.length > 0) {
    const classification = classifySimulationFailure({
      code: "artifact_compare_join_incomplete_rebuild_required",
      message: "Saved shared Past artifact did not produce all simulated timestamps required for compare join.",
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
        joinMissingCount: missingJoinedActual.length,
        joinMissingSampleTs: missingJoinedActual.slice(0, 10).map((p) => p.timestamp),
      },
      { status: 409 }
    );
  }

  const metrics = computeGapFillMetrics({
    actual: scoringActualTestIntervalsCanon,
    simulated: sharedSim.simulatedTestIntervals,
    simulatedByTs,
    timezone,
  });
  const actualTestIntervalsCount = scoringActualTestIntervalsCanon.length;
  const simulatedTestIntervalsCount = sharedSim.simulatedTestIntervals.length;
  const hasScoreableIntervals = simulatedTestIntervalsCount > 0;
  const scoreableIntervalsMessage = hasScoreableIntervals
    ? "Selected test days include scoreable intervals from shared Past artifact output."
    : "Selected test days had no scoreable intervals from shared Past artifact output. This compare completed with zero scored intervals.";
  const scoringActualSource = "actual_usage_test_window_intervals";
  const scoringSimulatedSource =
    (sharedSim as any).scoringSimulatedSource ?? "shared_artifact_simulated_intervals15";
  const scoringUsedSharedArtifact =
    (sharedSim as any).scoringUsedSharedArtifact !== false;
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
  const comparePulledFromSharedArtifactOnly =
    (sharedSim as any).comparePulledFromSharedArtifactOnly !== false;
  const sharedCoverageWindow = sharedSim.sharedCoverageWindow;
  const boundedTravelDateKeysLocal = sharedSim.boundedTravelDateKeysLocal;
  const responseHomeProfile = sharedSim.homeProfileFromModel ?? homeProfile;
  const responseApplianceProfile = sharedSim.applianceProfileFromModel ?? applianceProfile;
  const ma = (sharedSim.modelAssumptions as any) ?? {};
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
  const artifactSourceNote =
    ma.artifactSourceNote ??
    (artifactSourceMode === "latest_by_scenario_fallback"
      ? "Artifact source: latest cached Past scenario artifact (fallback from exact hash miss)."
      : artifactSourceMode === "exact_hash_match"
        ? "Artifact source: exact identity match on Past input hash."
        : null);
  const fullReport = buildFullReport({
    reportVersion: REPORT_VERSION,
    generatedAt: new Date().toISOString(),
    env: process.env.NODE_ENV ?? "development",
    houseId: house.id,
    userId: user.id,
    email: user.email,
    houseLabel: [house.addressLine1, house.addressCity, house.addressState].filter(Boolean).join(", ") || house.id,
    timezone,
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
        intervalsCount: Number((sharedSim.modelAssumptions as any)?.intervalCount ?? sharedSim.simulatedChartIntervals.length ?? 0),
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
    expectedTestIntervals: testDateKeysLocal.size * 96,
    coveragePct: testDateKeysLocal.size > 0 ? actualTestIntervals.length / (testDateKeysLocal.size * 96) : null,
    joinJoinedCount: actualTestIntervals.length - missingJoinedActual.length,
    joinMissingCount: missingJoinedActual.length,
    joinPct: actualTestIntervals.length > 0 ? (actualTestIntervals.length - missingJoinedActual.length) / actualTestIntervals.length : null,
    joinSampleActualTs: actualTestIntervalsCanon.slice(0, 5).map((p) => p.timestamp),
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
  });

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
    rebuilt: rebuildArtifact,
    artifactAutoRebuilt: sharedSim.artifactAutoRebuilt,
    enginePath: "production_past_stitched",
    cacheSource: rebuildArtifact ? "rebuilt" : "artifact",
    sourceOfDaySimulationCore: SOURCE_OF_DAY_SIMULATION_CORE,
    scenarioId: stableScenarioId,
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
    testIntervalsCount: actualTestIntervals.length,
    actualTestIntervalsCount,
    simulatedTestIntervalsCount,
    hasScoreableIntervals,
    message: scoreableIntervalsMessage,
    scoringActualSource,
    scoringSimulatedSource,
    scoringUsedSharedArtifact,
    scoringExcludedSource,
    artifactBuildExcludedSource,
    artifactUsesTestDaysInIdentity,
    artifactUsesTravelDaysInIdentity,
    sharedArtifactScenarioId,
    sharedArtifactInputHash,
    comparePulledFromSharedArtifactOnly,
    scoredTestDaysMissingSimulatedOwnershipCount,
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
    diagnostics: {
      // Chart scope is always the full canonical window for parity with Usage dashboard charts.
      dailyTotalsChartSim: sharedSim.simulatedChartDaily,
      monthlyTotalsChartSim: sharedSim.simulatedChartMonthly,
      stitchedMonthChartSim: sharedSim.simulatedChartStitchedMonth,
      chartIntervalCount: sharedSim.simulatedChartIntervals.length,
      dailyTotalsMasked: metrics.diagnostics.dailyTotalsMasked,
      top10Under: metrics.diagnostics.top10Under,
      top10Over: metrics.diagnostics.top10Over,
      hourlyProfileMasked: metrics.diagnostics.hourlyProfileMasked,
      seasonalSplit: metrics.diagnostics.seasonalSplit,
    },
    parity: {
      intervalCount: actualTestIntervals.length,
      testWindowKwh: metrics.totalActualKwhMasked,
      annualKwh: metrics.totalActualKwhMasked,
      baseloadKwhPer15m: null,
      baseloadDailyKwh: null,
      windowStartUtc: sharedCoverageWindow.startDate,
      windowEndUtc: sharedCoverageWindow.endDate,
      canonicalWindowHelper,
    },
    fullReportText: fullReport.fullReportText,
    pasteSummary:
      `Gap-Fill Lab (artifact-first): engine=production_past_stitched; mode=artifact_only; rebuilt=${String(rebuildArtifact)}; ` +
      `WAPE=${metrics.wape}%; MAE=${metrics.mae} kWh; intervalCount=${actualTestIntervals.length}; scenarioId=${stableScenarioId}`,
  });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[gapfill-lab]", message, err);
    return NextResponse.json(
      {
        ok: false,
        error: "server_error",
        message: "The request took too long or failed. Try a shorter date range or try again.",
        detail: process.env.NODE_ENV === "development" ? message : undefined,
      },
      { status: 500 }
    );
  }
}