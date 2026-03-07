import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { prisma } from "@/lib/db";
import { normalizeEmailSafe } from "@/lib/utils/email";
import { getActualIntervalsForRange } from "@/lib/usage/actualDatasetForHouse";
import { chooseActualSource } from "@/modules/realUsageAdapter/actual";
import { getHomeProfileSimulatedByUserHouse } from "@/modules/homeProfile/repo";
import { getApplianceProfileSimulatedByUserHouse } from "@/modules/applianceProfile/repo";
import { getLatestUsageShapeProfile } from "@/modules/usageShapeProfile/repo";
import { normalizeStoredApplianceProfile } from "@/modules/applianceProfile/validation";
import {
  buildUsageShapeProfileLiteFromIntervals,
  buildDailyWeatherFeaturesFromHourly,
  buildTrainingWeatherStats,
  canonicalIntervalKey,
  computeGapFillMetrics,
  dateKeyInTimezone,
  getLocalDayOfWeekFromDateKey,
  getPoolHourRange,
  localDateKeysInRange,
  localHourInTimezone,
  mergeDateKeysToRanges,
  pickRandomTestDateKeys,
  prevCalendarDay,
  simulateIntervalsForTestDaysFromUsageShapeProfile,
  summarizeDailyCoverageFromIntervals,
  type DayTotalDiagnostics,
  type UsageShapeProfileRowForSim,
  filterCandidateDateKeysBySeason,
  pickExtremeWeatherTestDateKeys,
} from "@/lib/admin/gapfillLab";
import { getWeatherForRange } from "@/lib/sim/weatherProvider";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // Run Compare: candidate + training + test windows; allow longer for 365-day usage

const ADMIN_EMAILS = ["brian@intelliwatt.com", "brian@intellipath-solutions.com"];

function hasAdminSessionCookie(request: NextRequest): boolean {
  const raw = request.cookies.get("intelliwatt_admin")?.value ?? "";
  const email = normalizeEmailSafe(raw);
  if (!email) return false;
  return ADMIN_EMAILS.includes(email);
}

type DateRange = { startDate: string; endDate: string };

/** Normalize ranges to local date keys (YYYY-MM-DD), inclusive. Inputs are local calendar dates (e.g. from HTML date inputs). We iterate in calendar-day space (no UTC) so output keys match dateKeyInTimezone(ts, timezone) when filtering actual intervals. */
function normalizeRangesToLocalDateKeysInclusive(ranges: DateRange[], _timezone: string): Set<string> {
  const out = new Set<string>();
  for (const r of ranges ?? []) {
    const start = (r?.startDate ?? "").slice(0, 10);
    const end = (r?.endDate ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) continue;
    if (end < start) continue;
    let y = Number(start.slice(0, 4));
    let m = Number(start.slice(5, 7));
    let d = Number(start.slice(8, 10));
    const endY = Number(end.slice(0, 4));
    const endM = Number(end.slice(5, 7));
    const endD = Number(end.slice(8, 10));
    while (y < endY || (y === endY && m < endM) || (y === endY && m === endM && d <= endD)) {
      out.add(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
      const daysInMonth = new Date(y, m, 0).getDate();
      d += 1;
      if (d > daysInMonth) {
        d = 1;
        m += 1;
      }
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
  }
  return out;
}

function sortedSample(keys: Set<string>, limit = 10): string[] {
  return Array.from(keys).sort().slice(0, limit);
}

function setDiff(a: Set<string>, b: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const x of Array.from(a)) if (!b.has(x)) out.add(x);
  return out;
}

function setIntersect(a: Set<string>, b: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const x of Array.from(a)) if (b.has(x)) out.add(x);
  return out;
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

/** Build Home Profile snapshot for audit (fields as stored; add spec aliases where needed). */
function homeProfileSnapshot(rec: Awaited<ReturnType<typeof getHomeProfileSimulatedByUserHouse>>) {
  if (!rec) return null;
  const o = rec as Record<string, unknown>;
  return {
    homeAge: o.homeAge,
    homeStyle: o.homeStyle,
    squareFeet: o.squareFeet,
    stories: o.stories,
    insulation: o.insulationType,
    insulationType: o.insulationType,
    windows: o.windowType,
    windowType: o.windowType,
    foundation: o.foundation,
    fuelConfiguration: o.fuelConfiguration,
    hvacType: o.hvacType,
    heatingType: o.heatingType,
    thermostatSummerF: o.summerTemp,
    thermostatWinterF: o.winterTemp,
    summerTemp: o.summerTemp,
    winterTemp: o.winterTemp,
    ledLights: o.ledLights,
    smartThermostat: o.smartThermostat,
    pool: {
      hasPool: o.hasPool,
      pumpType: o.poolPumpType,
      pumpHp: o.poolPumpHp,
      summerRunHoursPerDay: o.poolSummerRunHoursPerDay,
      winterRunHoursPerDay: o.poolWinterRunHoursPerDay,
      heaterInstalled: o.hasPoolHeater,
      poolHeaterType: o.poolHeaterType,
    },
    occupants: {
      work: o.occupantsWork,
      school: o.occupantsSchool,
      homeAllDay: o.occupantsHomeAllDay,
      total: Number(o.occupantsWork ?? 0) + Number(o.occupantsSchool ?? 0) + Number(o.occupantsHomeAllDay ?? 0),
    },
    ev: o.ev ?? undefined,
  };
}

/** Build Appliance Profile snapshot for audit. */
function applianceProfileSnapshot(rec: Awaited<ReturnType<typeof getApplianceProfileSimulatedByUserHouse>>) {
  if (!rec?.appliancesJson) return null;
  const normalized = normalizeStoredApplianceProfile(rec.appliancesJson as any);
  return {
    version: normalized.version,
    fuelConfiguration: normalized.fuelConfiguration,
    appliances: normalized.appliances,
    applianceCount: normalized.appliances?.length ?? 0,
  };
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
}): { fullReportJson: object; fullReportText: string } {
  const j = args;
  const round2 = (x: number) => Math.round(x * 100) / 100;
  const enginePath = j.enginePath ?? "production_past_stitched";
  const expectedTestIntervals = j.expectedTestIntervals ?? j.testDaysCount * 96;
  const missingTestIntervals = expectedTestIntervals - j.testIntervalsCount;
  const coveragePct: number | null = j.coveragePct ?? (expectedTestIntervals > 0 ? j.testIntervalsCount / expectedTestIntervals : null);
  const monthlyTotals: Record<string, number> = {};
  for (const m of j.dataset.monthly ?? []) {
    const month = String(m?.month ?? "").slice(0, 7);
    if (month) monthlyTotals[month] = round2(Number(m?.kwh) || 0);
  }
  // Prefer daily-derived per-15m so parity matches baseloadDaily; else convert kW→kWh/15m when dataset provides kW.
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
      functionsUsed: enginePath === "gapfill_test_days_profile" ? "getActualIntervalsForRange(test window only) -> simulateIntervalsForTestDaysFromUsageShapeProfile -> computeGapFillMetrics" : "getPastSimulatedDatasetForHouse -> buildPastSimulatedBaselineV1 -> buildCurveFromPatchedIntervals -> buildSimulatedUsageDatasetFromCurve",
      simVersion: j.modelAssumptions?.meta?.simVersion ?? "production_builder",
      derivationVersion: j.modelAssumptions?.meta?.shapeDerivationVersion ?? "v1",
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
      weekdayWeekendSplitUsed: j.modelAssumptions?.intradayShape?.weekdayWeekendSplit ?? false,
      dayTotalSource: j.modelAssumptions?.dayTotalSource ?? "fallback_month_avg",
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
      weatherUsed: j.weatherUsed ?? false,
      weatherNote: j.weatherNote ?? "Weather not integrated in gap-fill lab path.",
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
    lines.push("Note: Gap-Fill Lab v3 does not run Past; this section summarizes the scored test window only.");
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
    kv("weatherUsed", j.weatherUsed ?? false);
    lines.push("weatherNote: " + (j.weatherNote ?? "Weather not integrated in gap-fill lab path."));
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
      lines.push("testedDayWeatherSample (first 10): localDate | dayType | weatherModeUsed | dayClassification | profileSelectedDayKwh | weatherSeverityMultiplier | auxHeatKwhAdder | poolFreezeProtectKwhAdder | preBlendAdjustedDayKwh | postBlendFinalDayKwh | finalSelectedDayKwh | dailyAvgTempC | dailyMinTempC | heatingDegreeSeverity | coolingDegreeSeverity | freezeHoursCount");
      dayDiag.testedDayWeatherSample.forEach((r) =>
        lines.push(`  ${r.localDate} | ${r.dayType} | ${r.weatherModeUsed} | ${r.dayClassification ?? "—"} | ${r.profileSelectedDayKwh} | ${r.weatherSeverityMultiplier} | ${r.auxHeatKwhAdder} | ${r.poolFreezeProtectKwhAdder} | ${r.preBlendAdjustedDayKwh ?? "—"} | ${r.postBlendFinalDayKwh ?? "—"} | ${r.finalSelectedDayKwh} | ${r.dailyAvgTempC ?? "—"} | ${r.dailyMinTempC ?? "—"} | ${r.heatingDegreeSeverity} | ${r.coolingDegreeSeverity} | ${r.freezeHoursCount}`)
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

  const houseIdParam = (body?.houseId ?? "").trim();
  let house = houseIdParam
    ? houses.find((h: any) => h.id === houseIdParam)
    : houses[0];
  if (!house) {
    return NextResponse.json({ ok: false, error: "house_not_found", message: "House not found or not owned by user." }, { status: 404 });
  }

  const [homeProfileRec, applianceProfileRec] = await Promise.all([
    getHomeProfileSimulatedByUserHouse({ userId: user.id, houseId: house.id }),
    getApplianceProfileSimulatedByUserHouse({ userId: user.id, houseId: house.id }),
  ]);
  const homeProfile = homeProfileSnapshot(homeProfileRec);
  const applianceProfile = applianceProfileSnapshot(applianceProfileRec);

  const esiid = house.esiid ? String(house.esiid) : null;
  const source = await chooseActualSource({ houseId: house.id, esiid });
  if (!source) {
    return NextResponse.json(
      { ok: false, error: "no_actual_data", message: "No actual interval data (SMT or Green Button)." },
      { status: 400 }
    );
  }

  const travelRangesFromDb = await getTravelRangesFromDb(user.id, house.id);
  const travelDateKeysLocal = normalizeRangesToLocalDateKeysInclusive(travelRangesFromDb, timezone);

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
  /** For random_days only: date keys in candidate window with sufficient coverage (reused for training pool). */
  let candidateDateKeysForTraining: string[] = [];
  /** For random_days only: candidate-window intervals (reused for training to avoid second fetch). */
  let candidateIntervalsForTraining: Array<{ timestamp: string; kwh: number }> | null = null;

  if (testDaysRequested != null) {
    const todayTz = dateKeyInTimezone(new Date().toISOString(), timezone);
    const candidateEnd = prevCalendarDay(todayTz, 2);
    const candidateStart = prevCalendarDay(todayTz, 367);
    const candidateIntervals = await getActualIntervalsForRange({
      houseId: house.id,
      esiid,
      startDate: candidateStart,
      endDate: candidateEnd,
    });
    candidateIntervalsForTraining = candidateIntervals ?? null;
    const coverage = summarizeDailyCoverageFromIntervals(candidateIntervals ?? [], timezone);
    const candidateDateKeys = Array.from(coverage.keys()).filter(
      (dk) => (coverage.get(dk)?.pct ?? 0) >= minDayCoveragePct
    ).sort();
    candidateDateKeysForTraining = candidateDateKeys;
    if (testMode === "random") {
      seedUsed = `${house.id}-${Date.now()}`;
    } else {
      seedUsed = seed || `${house.id}-${todayTz}`;
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
    testDateKeysLocal = normalizeRangesToLocalDateKeysInclusive(testRanges, timezone);
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

  let trainStart: string;
  let trainEnd: string;
  let trainingDateKeysAll: string[];
  let trainingDateKeysSet: Set<string>;
  if (testSelectionMode === "random_days" && candidateWindowStart != null && candidateWindowEnd != null) {
    trainStart = candidateWindowStart;
    trainEnd = candidateWindowEnd;
    trainingDateKeysAll = [...candidateDateKeysForTraining];
    trainingDateKeysSet = new Set(trainingDateKeysAll.filter((d) => !guardrailExcludedDateKeysLocal.has(d)));
  } else {
    trainEnd = prevCalendarDay(minTestKey, trainGapDays);
    trainStart = prevCalendarDay(trainEnd, trainMaxDays);
    trainingDateKeysAll = localDateKeysInRange(trainStart, trainEnd, timezone);
    trainingDateKeysSet = new Set(trainingDateKeysAll.filter((d) => !guardrailExcludedDateKeysLocal.has(d)));
  }
  const excludedFromTraining_travelCount = trainingDateKeysAll.filter((d) => travelDateKeysLocal.has(d)).length;
  const excludedFromTraining_testCount = trainingDateKeysAll.filter((d) => testDateKeysLocal.has(d)).length;
  const trainingSelectionMode: "before_range" | "all_non_test_days" =
    testSelectionMode === "random_days" ? "all_non_test_days" : "before_range";
  const trainingEligibleDateKeysCount = trainingDateKeysSet.size;
  const trainingDateKeysSample = Array.from(trainingDateKeysSet).sort().slice(0, 15);
  const trainingMonthDayCountsSample: Record<string, number> = {};
  for (const dk of Array.from(trainingDateKeysSet)) {
    const month = dk.slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(month)) trainingMonthDayCountsSample[month] = (trainingMonthDayCountsSample[month] ?? 0) + 1;
  }

  const actualIntervals = await getActualIntervalsForRange({
    houseId: house.id,
    esiid,
    startDate: fetchStart,
    endDate: fetchEnd,
  });

  if (!actualIntervals?.length) {
    return NextResponse.json(
      { ok: false, error: "no_actual_data", message: "No actual interval data for the test date window." },
      { status: 400 }
    );
  }

  const actualTestIntervals = actualIntervals.filter((p) =>
    testDateKeysLocal.has(dateKeyInTimezone(p.timestamp, timezone))
  );
  if (actualTestIntervals.length === 0) {
    return NextResponse.json(
      { ok: false, error: "no_actual_data", message: "No actual interval data found for Test dates in this window." },
      { status: 400 }
    );
  }

  const actualTestIntervalsCanon = actualTestIntervals.map((p) => ({
    ...p,
    timestamp: canonicalIntervalKey(String(p?.timestamp ?? "").trim()),
  }));

  const usageShapeProfile = await getLatestUsageShapeProfile(house.id).catch(() => null);
  let profileForSim: UsageShapeProfileRowForSim = usageShapeProfile as UsageShapeProfileRowForSim;
  let profileSource: "db" | "auto_built_lite" = usageShapeProfile ? "db" : "auto_built_lite";
  let trainingWindowStartUtc: string | null = null;
  let trainingWindowEndUtc: string | null = null;
  let trainingIntervalsCount: number | null = null;
  let trainingDaysCount: number | null = null;
  const trainingCoverageExpected = trainingDateKeysSet.size * 96;
  let trainingCoverageFound: number | null = null;
  let trainingCoveragePct: number | null = null;
  /** Set when profile is auto-built from training intervals; used for weather adjustment. */
  let trainingIntervalsFiltered: Array<{ timestamp: string; kwh: number }> | null = null;

  if (!usageShapeProfile) {
    if (trainingDateKeysSet.size === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "PROFILE_MISSING_NO_TRAINING_DATA",
          message:
            "No UsageShapeProfile for this house and no non-test, non-travel dates in the training window. Ensure baseline usage exists or build a profile first.",
          trainingWindow: { trainStartUtc: trainStart, trainEndUtc: trainEnd },
        },
        { status: 400 }
      );
    }
    const trainingIntervalsRaw =
      testSelectionMode === "random_days" && candidateIntervalsForTraining != null
        ? candidateIntervalsForTraining
        : await getActualIntervalsForRange({
            houseId: house.id,
            esiid,
            startDate: trainStart,
            endDate: trainEnd,
          });
    const trainingIntervalsFilteredLocal = (trainingIntervalsRaw ?? []).filter((p) =>
      trainingDateKeysSet.has(dateKeyInTimezone(p.timestamp, timezone))
    );
    trainingIntervalsFiltered = trainingIntervalsFilteredLocal;
    const minTrainingIntervals = 96 * 7;
    if (trainingIntervalsFilteredLocal.length < minTrainingIntervals) {
      return NextResponse.json(
        {
          ok: false,
          error: "PROFILE_MISSING_NO_TRAINING_DATA",
          message:
            "No UsageShapeProfile for this house and not enough non-test, non-travel interval history to auto-build. Ensure baseline usage exists or build a profile first.",
          trainingIntervalsCount: trainingIntervalsFilteredLocal.length,
          trainingWindow: { trainStartUtc: trainStart, trainEndUtc: trainEnd },
        },
        { status: 400 }
      );
    }
    const lite = buildUsageShapeProfileLiteFromIntervals({ timezone, intervals: trainingIntervalsFilteredLocal });
    profileForSim = lite;
    trainingWindowStartUtc = trainStart;
    trainingWindowEndUtc = trainEnd;
    trainingIntervalsCount = trainingIntervalsFilteredLocal.length;
    trainingDaysCount = trainingDateKeysSet.size;
    trainingCoverageFound = trainingIntervalsFilteredLocal.length;
    trainingCoveragePct = trainingCoverageExpected > 0 ? trainingCoverageFound / trainingCoverageExpected : null;
  }

  let weatherUsedForSim = false;
  let weatherByDateKey: Map<string, import("@/lib/admin/gapfillLab").DailyWeatherFeatures> | undefined;
  let trainingWeatherStats: import("@/lib/admin/gapfillLab").TrainingWeatherStats | undefined;

  if (profileSource === "auto_built_lite" && trainingIntervalsFiltered != null && trainingIntervalsFiltered.length > 0) {
    const houseWx = await prisma.houseAddress.findUnique({ where: { id: house.id }, select: { lat: true, lng: true } }).catch(() => null);
    const lat = houseWx?.lat != null && Number.isFinite(houseWx.lat) ? houseWx.lat : null;
    const lon = houseWx?.lng != null && Number.isFinite(houseWx.lng) ? houseWx.lng : null;
    if (lat != null && lon != null) {
      const allRows: Array<{ timestampUtc: Date | string; temperatureC: number | null; cloudcoverPct?: number | null; solarRadiation?: number | null }> = [];
      const seenTs = new Set<string>();
      const addRows = (rows: Array<{ timestampUtc: Date | string; temperatureC: number | null; cloudcoverPct?: number | null; solarRadiation?: number | null }>) => {
        for (const r of rows) {
          const t = r.timestampUtc instanceof Date ? r.timestampUtc : new Date(r.timestampUtc);
          const key = t.toISOString();
          if (!seenTs.has(key)) {
            seenTs.add(key);
            allRows.push(r);
          }
        }
      };
      const trainResult = await getWeatherForRange(lat, lon, trainStart, trainEnd);
      addRows(trainResult.rows);
      let anyFromStub = trainResult.fromStub;
      if (fetchStart !== trainStart || fetchEnd !== trainEnd) {
        const testResult = await getWeatherForRange(lat, lon, fetchStart, fetchEnd);
        addRows(testResult.rows);
        anyFromStub = anyFromStub || testResult.fromStub;
      }
      allRows.sort((a, b) => {
        const ta = a.timestampUtc instanceof Date ? a.timestampUtc.getTime() : new Date(a.timestampUtc).getTime();
        const tb = b.timestampUtc instanceof Date ? b.timestampUtc.getTime() : new Date(b.timestampUtc).getTime();
        return ta - tb;
      });
      if (allRows.length > 0) {
        weatherUsedForSim = !anyFromStub;
        weatherByDateKey = buildDailyWeatherFeaturesFromHourly(allRows);
        const trainingDayKwhByDate = new Map<string, number>();
        for (const p of trainingIntervalsFiltered) {
          const dk = dateKeyInTimezone(p.timestamp, timezone);
          trainingDayKwhByDate.set(dk, (trainingDayKwhByDate.get(dk) ?? 0) + (Number(p.kwh) || 0));
        }
        trainingWeatherStats = buildTrainingWeatherStats({
          trainingDateKeys: Array.from(trainingDateKeysSet),
          trainingDayKwhByDate,
          weatherByDateKey,
          isWeekend: (dk) => {
            const dow = getLocalDayOfWeekFromDateKey(dk, timezone);
            return dow === 0 || dow === 6;
          },
        });
      }
    }
  }

  const simResult = simulateIntervalsForTestDaysFromUsageShapeProfile({
    timezone,
    testIntervals: actualTestIntervalsCanon,
    usageShapeProfileRowOrNull: profileForSim,
    returnDiagnostics: profileSource === "auto_built_lite",
    ...(weatherByDateKey && trainingWeatherStats
      ? {
          weatherByDateKey,
          trainingWeatherStats,
          homeProfile: homeProfile as import("@/lib/admin/gapfillLab").GapfillHomeProfileForWeather | null,
          applianceProfile,
        }
      : {}),
  });
  const simIntervals = Array.isArray(simResult) ? simResult : simResult.intervals;
  const dayTotalDiagnostics: DayTotalDiagnostics | undefined = Array.isArray(simResult) ? undefined : simResult.diagnostics;
  const simulatedByTs = new Map<string, number>();
  for (const p of simIntervals) {
    const ts = String(p?.timestamp ?? "").trim();
    if (ts) simulatedByTs.set(canonicalIntervalKey(ts), Number(p?.kwh) || 0);
  }

  const actualCount = actualTestIntervalsCanon.length;
  const joinedCount = actualTestIntervalsCanon.filter((p) => simulatedByTs.has(p.timestamp)).length;
  const joinMissingCount = actualCount - joinedCount;
  const joinPct = actualCount > 0 ? joinedCount / actualCount : 1;
  const joinSampleActualTs: string[] = [];
  if (joinMissingCount > 0) {
    for (const p of actualTestIntervalsCanon) {
      if (!simulatedByTs.has(p.timestamp)) {
        joinSampleActualTs.push(p.timestamp);
        if (joinSampleActualTs.length >= 5) break;
      }
    }
  }
  const joinSampleSimTs = Array.from(simulatedByTs.keys()).slice(0, 5);

  const metrics = computeGapFillMetrics({
    actual: actualTestIntervalsCanon,
    simulated: simIntervals,
    simulatedByTs,
    timezone,
  });

  const onlyTravel = setDiff(travelDateKeysLocal, testDateKeysLocal);
  const onlyTest = setDiff(testDateKeysLocal, travelDateKeysLocal);
  const expectedTestIntervals = testDateKeysLocal.size * 96;
  const coveragePctNum = expectedTestIntervals > 0 ? actualTestIntervals.length / expectedTestIntervals : null;
  const dateKeyDiag = {
    travelDateKeysLocalCount: travelDateKeysLocal.size,
    travelDateKeysLocalSample: sortedSample(travelDateKeysLocal),
    testDateKeysLocalCount: testDateKeysLocal.size,
    testDateKeysLocalSample: sortedSample(testDateKeysLocal),
    guardrailExcludedDateKeysCount: guardrailExcludedDateKeysLocal.size,
    guardrailExcludedDateKeysSample: sortedSample(guardrailExcludedDateKeysLocal).slice(0, 10),
    setArithmetic: {
      onlyTravelCount: onlyTravel.size,
      onlyTravelSample: sortedSample(onlyTravel),
      onlyTestCount: onlyTest.size,
      onlyTestSample: sortedSample(onlyTest),
      overlapCount: overlapLocal.size,
      overlapSample: sortedSample(overlapLocal),
    },
  };

  let weatherUsedForReport = false;
  let weatherNoteReport = "Weather not integrated in gap-fill lab path.";
  if (testDateKeysSorted.length > 0) {
    if (weatherUsedForSim) {
      weatherUsedForReport = true;
      weatherNoteReport = "Real weather (Open-Meteo cache) used for test window; day totals scaled by weather (and optional aux heat / pool freeze-protect).";
    } else {
      const houseWx = await prisma.houseAddress.findUnique({ where: { id: house.id }, select: { lat: true, lng: true } }).catch(() => null);
      const lat = houseWx?.lat != null && Number.isFinite(houseWx.lat) ? houseWx.lat : null;
      const lon = houseWx?.lng != null && Number.isFinite(houseWx.lng) ? houseWx.lng : null;
      if (lat != null && lon != null) {
        const testStart = testDateKeysSorted[0];
        const testEnd = testDateKeysSorted[testDateKeysSorted.length - 1];
        const result = await getWeatherForRange(lat, lon, testStart!, testEnd!);
        weatherUsedForReport = !result.fromStub;
        weatherNoteReport = result.fromStub ? "Weather service unavailable; stub used for test window." : "Real weather (Open-Meteo cache) used for test window.";
      }
    }
  }

  const modelAssumptions = {
    baseload: { used: false, method: "test_days_profile", params: {}, valueKwhPer15m: null, valueKwhPerDay: null },
    pool: {
      used: false,
      pumpType: homeProfile?.pool?.pumpType ?? null,
      pumpHp: homeProfile?.pool?.pumpHp ?? null,
      assumedKw: null,
      runHoursPerDaySummer: homeProfile?.pool?.summerRunHoursPerDay ?? null,
      runHoursPerDayWinter: homeProfile?.pool?.winterRunHoursPerDay ?? null,
      scheduleRule: "Gap-fill lab (test-days only) does not model pool.",
    },
    hvac: {
      used: false,
      hvacType: homeProfile?.hvacType ?? null,
      heatingType: homeProfile?.heatingType ?? null,
      setpointSummerF: homeProfile?.thermostatSummerF ?? homeProfile?.summerTemp ?? null,
      setpointWinterF: homeProfile?.thermostatWinterF ?? homeProfile?.winterTemp ?? null,
      weatherUsed: weatherUsedForReport,
      rule: "Gap-fill lab uses UsageShapeProfile shape only; no HVAC model.",
    },
    occupancy: {
      used: false,
      occupantsWork: homeProfile?.occupants?.work ?? null,
      occupantsSchool: homeProfile?.occupants?.school ?? null,
      occupantsHomeAllDay: homeProfile?.occupants?.homeAllDay ?? null,
      rule: "Gap-fill lab uses profile weekday/weekend avg; no occupancy model.",
    },
    intradayShape: {
      source: profileSource === "db" ? "usage_shape_profile" : profileSource === "auto_built_lite" ? "auto_built_lite" : "uniform_fallback",
      weekdayWeekendSplit: Boolean(profileForSim),
      smoothing: "none",
    },
    dayTotalSource: profileForSim ? (profileSource === "auto_built_lite" ? "auto_built_lite_by_month" : "profile_weekday_weekend_by_month") : "global_avg_or_zero",
    meta: {
      simVersion: "gapfill_test_days_profile",
      shapeDerivationVersion: "v1",
      seed: null,
      maskMode: "test_dates_only",
      holdoutN: actualTestIntervals.length,
      configHash: `engine=gapfill_test_days_profile,profile=${profileSource}`,
    },
  };

  const hasPool = Boolean(homeProfile?.pool?.hasPool);
  const poolHoursErrorSplit = hasPool
    ? {
        poolHours: { wape: null as number | null, mae: null as number | null },
        nonPoolHours: { wape: null as number | null, mae: null as number | null },
        scheduleRuleUsed: "Pool schedule not implemented in gap-fill lab; used: false.",
      }
    : null;

  const runHours = Number(homeProfile?.pool?.summerRunHoursPerDay) || 12;
  const poolRange = getPoolHourRange(runHours);
  let poolHoursLens: { poolHours: { wape: number | null; mae: number | null }; nonPoolHours: { wape: number | null; mae: number | null }; rule: string } | null = null;
  if (hasPool) {
    let poolSumActual = 0, poolSumSim = 0, poolSumAbs = 0, poolN = 0;
    let nonSumActual = 0, nonSumSim = 0, nonSumAbs = 0, nonN = 0;
    for (const p of actualTestIntervalsCanon) {
      const ts = p.timestamp;
      const actualKwh = Number(p?.kwh) || 0;
      const simKwh = simulatedByTs.get(ts) ?? 0;
      const hour = localHourInTimezone(ts, timezone);
      const inPool = hour >= poolRange.startHour && hour <= poolRange.endHour;
      if (inPool) {
        poolSumActual += actualKwh;
        poolSumSim += simKwh;
        poolSumAbs += Math.abs(simKwh - actualKwh);
        poolN++;
      } else {
        nonSumActual += actualKwh;
        nonSumSim += simKwh;
        nonSumAbs += Math.abs(simKwh - actualKwh);
        nonN++;
      }
    }
    const round2 = (x: number) => Math.round(x * 100) / 100;
    poolHoursLens = {
      poolHours: {
        wape: poolSumActual > 1e-6 ? round2((poolSumAbs / poolSumActual) * 100) : null,
        mae: poolN > 0 ? round2(poolSumAbs / poolN) : null,
      },
      nonPoolHours: {
        wape: nonSumActual > 1e-6 ? round2((nonSumAbs / nonSumActual) * 100) : null,
        mae: nonN > 0 ? round2(nonSumAbs / nonN) : null,
      },
      rule: `Pool window: local hours ${poolRange.startHour}-${poolRange.endHour} (centered midday, runHoursPerDay=${runHours}).`,
    };
  }

  const listTestDateKeys = testDateKeysSorted;
  const guardrailExcludedDateKeysSample = sortedSample(guardrailExcludedDateKeysLocal).slice(0, 10);
  const testDatasetStub = {
    summary: { start: fetchStart, end: fetchEnd, intervalsCount: actualTestIntervals.length },
    totals: { netKwh: metrics.totalActualKwhMasked },
    insights: {} as any,
    monthly: [] as Array<{ month?: string; kwh?: number }>,
  };
  const { fullReportJson, fullReportText } = buildFullReport({
    reportVersion: REPORT_VERSION,
    generatedAt: new Date().toISOString(),
    env: process.env.VERCEL ? "vercel" : "local",
    houseId: house.id,
    userId: user.id,
    email: user.email ?? "",
    houseLabel: [house.addressLine1, house.addressCity, house.addressState].filter(Boolean).join(", ") || house.id,
    timezone,
    testRangesInput: testRangesUsed,
    travelRangesFromDb,
    guardrailExcludedRanges: Array.from(guardrailExcludedDateKeysLocal).sort().map((d) => ({ startDate: d, endDate: d })),
    listTestDateKeys,
    testIntervalsCount: actualTestIntervals.length,
    testDaysCount: listTestDateKeys.length,
    guardrailExcludedDateKeysCount: guardrailExcludedDateKeysLocal.size,
    guardrailExcludedDateKeysSample,
    dateKeyDiag,
    dataset: testDatasetStub,
    buildInputs: { canonicalMonths: [] },
    configHash: modelAssumptions.meta.configHash,
    excludedDateKeysCount: 0,
    excludedDateKeysSample: [],
    homeProfile,
    applianceProfile,
    modelAssumptions,
    metrics: {
      mae: metrics.mae,
      rmse: metrics.rmse,
      maxAbs: metrics.maxAbs,
      wape: metrics.wape,
      mape: metrics.mape,
      totalActualKwhMasked: metrics.totalActualKwhMasked,
      totalSimKwhMasked: metrics.totalSimKwhMasked,
      deltaKwhMasked: metrics.deltaKwhMasked,
      mapeFiltered: metrics.mapeFiltered,
      mapeFilteredCount: metrics.mapeFilteredCount,
      byMonth: metrics.byMonth,
      byHour: metrics.byHour,
      worst10Abs: metrics.worst10Abs,
    },
    diagnostics: {
      dailyTotalsMasked: metrics.diagnostics.dailyTotalsMasked,
      top10Under: metrics.diagnostics.top10Under,
      top10Over: metrics.diagnostics.top10Over,
      hourlyProfileMasked: metrics.diagnostics.hourlyProfileMasked,
    },
    poolHoursLens,
    usageShapeProfileDiag: usageShapeProfile ? { found: true, id: (usageShapeProfile as any).id, version: (usageShapeProfile as any).version, derivedAt: (usageShapeProfile as any).derivedAt, windowStartUtc: null, windowEndUtc: null, profileMonthKeys: Object.keys((usageShapeProfile as any).shapeByMonth96 ?? {}).sort(), weekdayAvgLen: Array.isArray((usageShapeProfile as any).avgKwhPerDayWeekdayByMonth) ? (usageShapeProfile as any).avgKwhPerDayWeekdayByMonth.length : null, weekendAvgLen: Array.isArray((usageShapeProfile as any).avgKwhPerDayWeekendByMonth) ? (usageShapeProfile as any).avgKwhPerDayWeekendByMonth.length : null, canonicalMonths: [], canonicalMonthsLen: 0, reasonNotUsed: null } : null,
    enginePath: "gapfill_test_days_profile",
    expectedTestIntervals,
    coveragePct: coveragePctNum,
    joinJoinedCount: joinedCount,
    joinMissingCount: joinMissingCount,
    joinPct,
    joinSampleActualTs,
    joinSampleSimTs,
    profileSource,
    trainingWindowStartUtc,
    trainingWindowEndUtc,
    trainingIntervalsCount,
    trainingDaysCount,
    testSelectionMode,
    testDaysRequested: testDaysRequested ?? undefined,
    testDaysSelected,
    seedUsed: seedUsed ?? undefined,
    testMode,
    candidateDaysAfterModeFilterCount: candidateDaysAfterModeFilterCount ?? undefined,
    minDayCoveragePct: testSelectionMode === "random_days" ? minDayCoveragePct : undefined,
    candidateWindowStartUtc: candidateWindowStart ?? undefined,
    candidateWindowEndUtc: candidateWindowEnd ?? undefined,
    trainingMaxDays: trainMaxDays,
    trainingGapDays: trainGapDays,
    excludedFromTest_travelCount: testSelectionMode === "random_days" ? excludedFromTest_travelCount : undefined,
    excludedFromTraining_travelCount,
    excludedFromTraining_testCount,
    trainingSelectionMode,
    trainingEligibleDateKeysCount,
    trainingDateKeysSample,
    trainingMonthDayCountsSample,
    trainingCoverage: {
      expected: trainingCoverageExpected,
      found: trainingCoverageFound,
      pct: trainingCoveragePct,
    },
    ...(dayTotalDiagnostics ? { dayTotalDiagnostics: dayTotalDiagnostics } : {}),
    weatherUsed: weatherUsedForReport,
    weatherNote: weatherNoteReport,
  });

  const pasteLines = [
    "=== Simulation Audit Report (Gap-Fill Lab) ===",
    `House: ${house.addressLine1 ?? ""} ${house.addressCity ?? ""} ${house.addressState ?? ""}`.trim() || house.id,
    `Engine: gapfill_test_days_profile | Test intervals: ${actualTestIntervals.length} | Timezone: ${timezone}`,
    "",
    "--- Primary metrics ---",
    `WAPE: ${metrics.wape}% | MAE: ${metrics.mae} kWh | RMSE: ${metrics.rmse} | MAPE: ${metrics.mape}% | MaxAbs: ${metrics.maxAbs} kWh`,
    "",
    "--- Test window ---",
    `intervalCount: ${actualTestIntervals.length} | totalActualKwh: ${metrics.totalActualKwhMasked} | totalSimKwh: ${metrics.totalSimKwhMasked} | window: ${fetchStart} → ${fetchEnd}`,
    "",
    "--- Assumptions ---",
    `Intraday shape: ${modelAssumptions.intradayShape.source} | Weekday/weekend: ${modelAssumptions.intradayShape.weekdayWeekendSplit}`,
    "",
    "--- Diagnostics ---",
    `Seasonal: Summer WAPE ${metrics.diagnostics.seasonalSplit.summer.wape}% | Winter WAPE ${metrics.diagnostics.seasonalSplit.winter.wape}% | Shoulder WAPE ${metrics.diagnostics.seasonalSplit.shoulder.wape}%`,
    `Worst days: ${metrics.worstDays.slice(0, 5).map((d) => `${d.date}: ${d.absErrorKwh} kWh`).join(" | ")}`,
  ];
  const pasteSummary = pasteLines.join("\n");

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
    modelAssumptions,
    testIntervalsCount: actualTestIntervals.length,
    metrics: {
      mae: metrics.mae,
      rmse: metrics.rmse,
      mape: metrics.mape,
      wape: metrics.wape,
      maxAbs: metrics.maxAbs,
    },
    primaryPercentMetric: metrics.wape,
    byMonth: metrics.byMonth,
    byHour: metrics.byHour,
    byDayType: metrics.byDayType,
    worstDays: metrics.worstDays,
    diagnostics: {
      dailyTotalsMasked: metrics.diagnostics.dailyTotalsMasked,
      top10Under: metrics.diagnostics.top10Under,
      top10Over: metrics.diagnostics.top10Over,
      hourlyProfileMasked: metrics.diagnostics.hourlyProfileMasked,
      seasonalSplit: metrics.diagnostics.seasonalSplit,
      poolHoursErrorSplit,
    },
    parity: {
      intervalCount: actualTestIntervals.length,
      testWindowKwh: metrics.totalActualKwhMasked,
      annualKwh: metrics.totalActualKwhMasked, // legacy (deprecated, remove after one deploy)
      baseloadKwhPer15m: null,
      baseloadDailyKwh: null,
      windowStartUtc: fetchStart,
      windowEndUtc: fetchEnd,
    },
    pasteSummary,
    fullReportText,
    fullReportJson,
    testSelectionMode,
    testDaysRequested: testDaysRequested ?? undefined,
    testDaysSelected,
    seedUsed: seedUsed ?? undefined,
    testMode,
    candidateDaysAfterModeFilterCount: candidateDaysAfterModeFilterCount ?? undefined,
    minDayCoveragePct: testSelectionMode === "random_days" ? minDayCoveragePct : undefined,
    candidateWindowStartUtc: candidateWindowStart ?? undefined,
    candidateWindowEndUtc: candidateWindowEnd ?? undefined,
    trainingMaxDays: trainMaxDays,
    trainingGapDays: trainGapDays,
    excludedFromTest_travelCount: testSelectionMode === "random_days" ? excludedFromTest_travelCount : undefined,
    excludedFromTraining_travelCount,
    excludedFromTraining_testCount,
    trainingSelectionMode,
    trainingEligibleDateKeysCount,
    trainingDateKeysSample,
    trainingMonthDayCountsSample,
    trainingCoverage: { expected: trainingCoverageExpected, found: trainingCoverageFound, pct: trainingCoveragePct },
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