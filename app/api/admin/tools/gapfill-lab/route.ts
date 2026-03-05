import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { prisma } from "@/lib/db";
import { normalizeEmailSafe } from "@/lib/utils/email";
import { getActualIntervalsForRange, getActualUsageDatasetForHouse, getIntervalDataFingerprint } from "@/lib/usage/actualDatasetForHouse";
import { chooseActualSource } from "@/modules/realUsageAdapter/actual";
import { monthsEndingAt } from "@/modules/manualUsage/anchor";
import { buildSimulatorInputs } from "@/modules/usageSimulator/build";
import { type SimulatorBuildInputsV1 } from "@/modules/usageSimulator/dataset";
import { getPastSimulatedDatasetForHouse } from "@/modules/usageSimulator/service";
import {
  computePastInputHash,
  getCachedPastDataset,
  saveCachedPastDataset,
  PAST_ENGINE_VERSION,
} from "@/modules/usageSimulator/pastCache";
import {
  encodeIntervalsV1,
  decodeIntervalsV1,
  INTERVAL_CODEC_V1,
} from "@/modules/usageSimulator/intervalCodec";
import { getHomeProfileSimulatedByUserHouse } from "@/modules/homeProfile/repo";
import { getApplianceProfileSimulatedByUserHouse } from "@/modules/applianceProfile/repo";
import { getLatestUsageShapeProfile, upsertUsageShapeProfile } from "@/modules/usageShapeProfile/repo";
import { deriveUsageShapeProfile } from "@/modules/usageShapeProfile/derive";
import { normalizeStoredApplianceProfile } from "@/modules/applianceProfile/validation";
import {
  canonicalIntervalKey,
  computeGapFillMetrics,
  dateKeyInTimezone,
  getPoolHourRange,
  localHourInTimezone,
} from "@/lib/admin/gapfillLab";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // Run Compare can take 1–3 min (auto-build + past dataset + metrics)

const ADMIN_EMAILS = ["brian@intelliwatt.com", "brian@intellipath-solutions.com"];

function hasAdminSessionCookie(request: NextRequest): boolean {
  const raw = request.cookies.get("intelliwatt_admin")?.value ?? "";
  const email = normalizeEmailSafe(raw);
  if (!email) return false;
  return ADMIN_EMAILS.includes(email);
}

function yearMonthsFromRange(startDate: string, endDate: string): string[] {
  const start = String(startDate).slice(0, 10);
  const end = String(endDate).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return [];
  const seen = new Set<string>();
  const a = new Date(start + "T12:00:00.000Z").getTime();
  const b = new Date(end + "T12:00:00.000Z").getTime();
  let t = Math.min(a, b);
  const last = Math.max(a, b);
  const dayMs = 24 * 60 * 60 * 1000;
  while (t <= last) {
    const ym = new Date(t).toISOString().slice(0, 7);
    seen.add(ym);
    t += dayMs;
  }
  return Array.from(seen).sort();
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

function utcDateKeyFromUtcMs(utcMs: number): string {
  const d = new Date(utcMs);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function localDateKeyFromUtcMs(utcMs: number, timezone: string): string {
  const dt = new Date(utcMs);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(dt);
  const y = parts.find((p) => p.type === "year")?.value ?? "";
  const m = parts.find((p) => p.type === "month")?.value ?? "";
  const d = parts.find((p) => p.type === "day")?.value ?? "";
  return `${y}-${m}-${d}`;
}

/** Map local date keys to UTC excluded date keys (YYYY-MM-DD) for the window. Same convention as Past engine. */
function buildExcludedUtcDateKeySetFromLocalKeys(
  localDateKeys: Set<string>,
  windowStartUtc: string,
  windowEndUtc: string,
  timezone: string
): Set<string> {
  const out = new Set<string>();
  if (!localDateKeys || localDateKeys.size === 0) return out;
  const startMs = Date.UTC(
    Number(windowStartUtc.slice(0, 4)),
    Number(windowStartUtc.slice(5, 7)) - 1,
    Number(windowStartUtc.slice(8, 10)),
    0, 0, 0
  );
  const endMs = Date.UTC(
    Number(windowEndUtc.slice(0, 4)),
    Number(windowEndUtc.slice(5, 7)) - 1,
    Number(windowEndUtc.slice(8, 10)),
    0, 0, 0
  );
  const dayMs = 24 * 60 * 60 * 1000;
  for (let dayStart = startMs; dayStart <= endMs; dayStart += dayMs) {
    const localKey = localDateKeyFromUtcMs(dayStart + 12 * 60 * 60 * 1000, timezone);
    if (localDateKeys.has(localKey)) out.add(utcDateKeyFromUtcMs(dayStart));
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

const REPORT_VERSION = "gapfill_lab_report_v2";
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
  evalRanges: Array<{ startDate: string; endDate: string }>;
  buildExcludedRanges: Array<{ startDate: string; endDate: string }>;
  travelRangesNormalized: Array<{ startDate: string; endDate: string }>;
  listMaskedDateKeys: string[];
  maskedIntervalsCount: number;
  maskedDaysCount: number;
  buildExcludedDateKeysCount: number;
  buildExcludedDateKeysSample: string[];
  evalMaskedDateKeysCount: number;
  evalMaskedDateKeysSample: string[];
  dateKeyDiag?: {
    dbTravelDateKeysCount: number;
    dbTravelDateKeysSample: string[];
    evalDateKeysCount: number;
    evalDateKeysSample: string[];
    buildExcludedDateKeysCount: number;
    buildExcludedDateKeysSample: string[];
    setArithmetic: {
      onlyDbCount: number;
      onlyDbSample: string[];
      onlyEvalCount: number;
      onlyEvalSample: string[];
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
}): { fullReportJson: object; fullReportText: string } {
  const j = args;
  const round2 = (x: number) => Math.round(x * 100) / 100;
  const expectedMaskedIntervals = j.evalMaskedDateKeysCount * 96;
  const missingMaskedIntervals = expectedMaskedIntervals - j.maskedIntervalsCount;
  const coveragePct: number | null = expectedMaskedIntervals > 0 ? j.maskedIntervalsCount / expectedMaskedIntervals : null;
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
      evalRangesInput: j.evalRanges,
      buildExcludedRanges: j.buildExcludedRanges,
      travelRangesNormalized: j.travelRangesNormalized,
      maskedIntervalsCount: j.maskedIntervalsCount,
      maskedDaysCount: j.maskedDaysCount,
      listMaskedDateKeys: j.listMaskedDateKeys,
      buildExcludedDateKeysCount: j.buildExcludedDateKeysCount,
      evalMaskedDateKeysCount: j.evalMaskedDateKeysCount,
      expectedMaskedIntervals: expectedMaskedIntervals,
      missingMaskedIntervals: missingMaskedIntervals,
      coveragePct: coveragePct,
      ...(j.dateKeyDiag ? { dateKeyDiag: j.dateKeyDiag } : {}),
    },
    parity: {
      windowStartUtc: j.dataset.summary?.start ?? null,
      windowEndUtc: j.dataset.summary?.end ?? null,
      intervalCount: j.dataset.summary?.intervalsCount ?? null,
      annualKwh: j.dataset.totals?.netKwh ?? null,
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
      enginePath: "production_past_stitched",
      functionsUsed: "getPastSimulatedDatasetForHouse -> buildPastSimulatedBaselineV1 -> buildCurveFromPatchedIntervals -> buildSimulatedUsageDatasetFromCurve",
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
      usageShapeProfileDiag: j.usageShapeProfileDiag ?? null,
      profileAutoBuilt: j.profileAutoBuilt ?? false,
      canonicalMonths: j.buildInputs.canonicalMonths,
      buildExcludedDateKeysCount: j.buildExcludedDateKeysCount,
      buildExcludedDateKeysSample: j.buildExcludedDateKeysSample,
      evalMaskedDateKeysCount: j.evalMaskedDateKeysCount,
      evalMaskedDateKeysSample: j.evalMaskedDateKeysSample,
      excludedDateKeysCount: j.excludedDateKeysCount,
      excludedDateKeysSample: j.excludedDateKeysSample,
      weatherUsed: false,
      weatherNote: "Weather not integrated in gap-fill lab path.",
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

  if ((j.dataset.summary?.intervalsCount ?? 0) !== 35136) fullReportJson.notes.push(`intervalCount ${j.dataset.summary?.intervalsCount} differs from expected 35136.`);
  const baseloadDaily = Number(j.dataset.insights?.baseloadDaily);
  if (Number.isFinite(baseloadDaily) && (baseloadDaily > 80 || baseloadDaily < 5)) fullReportJson.notes.push(`baseloadDailyKwh ${baseloadDaily} is unusually high or low.`);
  const highWapeMonth = j.metrics.byMonth.find((m) => m.wape > 80);
  if (highWapeMonth) fullReportJson.notes.push(`Masked month ${highWapeMonth.month} WAPE ${highWapeMonth.wape}% is much higher than others.`);
  if (j.metrics.totalActualKwhMasked > 0 && j.metrics.totalSimKwhMasked === 0) {
    fullReportJson.notes.push("ERROR: simulated intervals did not join to actual timestamps; check timestamp keying.");
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

  section("B) Scenario + masking", () => {
    lines.push("evalRanges input (entered ranges; used for accuracy): " + JSON.stringify(j.evalRanges));
    lines.push("buildExcludedRanges (DB ∪ eval; used to build dataset): " + JSON.stringify(j.buildExcludedRanges));
    lines.push("maskedIntervalsCount / maskedDaysCount / listMaskedDateKeys are based on evalRanges only.");
    kv("maskedIntervalsCount", j.maskedIntervalsCount);
    kv("maskedDaysCount", j.maskedDaysCount);
    lines.push("listMaskedDateKeys (eval only): " + listTrunc(j.listMaskedDateKeys, TRUNCATE_LIST).join(", "));
    lines.push("--- Masked-interval coverage ---");
    kv("expectedMaskedIntervals", expectedMaskedIntervals);
    kv("missingMaskedIntervals", missingMaskedIntervals);
    lines.push("coveragePct: " + (coveragePct != null ? round2(coveragePct * 100) + "%" : "—"));
    if (j.dateKeyDiag) {
      const d = j.dateKeyDiag;
      lines.push("--- Date key diagnostics (local) ---");
      kv("dbTravelDateKeysCount", d.dbTravelDateKeysCount);
      lines.push("dbTravelDateKeysSample: " + listTrunc(d.dbTravelDateKeysSample, 10).join(", "));
      kv("evalDateKeysCount", d.evalDateKeysCount);
      lines.push("evalDateKeysSample: " + listTrunc(d.evalDateKeysSample, 10).join(", "));
      kv("buildExcludedDateKeysCount", d.buildExcludedDateKeysCount);
      lines.push("buildExcludedDateKeysSample: " + listTrunc(d.buildExcludedDateKeysSample, 10).join(", "));
      lines.push("--- Set arithmetic ---");
      kv("onlyDbCount", d.setArithmetic.onlyDbCount);
      lines.push("onlyDbSample: " + listTrunc(d.setArithmetic.onlyDbSample, 10).join(", "));
      kv("onlyEvalCount", d.setArithmetic.onlyEvalCount);
      lines.push("onlyEvalSample: " + listTrunc(d.setArithmetic.onlyEvalSample, 10).join(", "));
      kv("overlapCount", d.setArithmetic.overlapCount);
      lines.push("overlapSample: " + listTrunc(d.setArithmetic.overlapSample, 10).join(", "));
    }
  });

  section("C) Production parity (Past simulated usage)", () => {
    kv("windowStartUtc", j.dataset.summary?.start);
    kv("windowEndUtc", j.dataset.summary?.end);
    kv("intervalCount", j.dataset.summary?.intervalsCount);
    kv("annualKwh", j.dataset.totals?.netKwh != null ? round2(j.dataset.totals.netKwh) : null);
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
    kv("enginePath", "production_past_stitched");
    lines.push("functionsUsed: getPastSimulatedDatasetForHouse -> buildPastSimulatedBaselineV1 -> buildCurveFromPatchedIntervals -> buildSimulatedUsageDatasetFromCurve");
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
    kv("simVersion", fullReportJson.engine.simVersion);
    kv("derivationVersion", fullReportJson.engine.derivationVersion);
    kv("configHash", j.configHash);
    kv("weekdayWeekendSplitUsed", fullReportJson.engine.weekdayWeekendSplitUsed);
    kv("dayTotalSource", fullReportJson.engine.dayTotalSource);
    kv("buildExcludedDateKeysCount", j.buildExcludedDateKeysCount);
    lines.push("buildExcludedDateKeysSample: " + listTrunc(j.buildExcludedDateKeysSample, 10).join(", "));
    kv("evalMaskedDateKeysCount", j.evalMaskedDateKeysCount);
    lines.push("evalMaskedDateKeysSample: " + listTrunc(j.evalMaskedDateKeysSample, 10).join(", "));
    const diag = fullReportJson.engine.usageShapeProfileDiag as typeof j.usageShapeProfileDiag | undefined;
    if (diag) {
      lines.push("usageShapeProfile: found=" + diag.found + " reasonNotUsed=" + (diag.reasonNotUsed ?? "(used)"));
      lines.push("usageShapeProfileDiag: " + JSON.stringify(diag, null, 2));
    } else {
      lines.push("usageShapeProfile: (no diag)");
    }
    kv("profileAutoBuilt", fullReportJson.engine.profileAutoBuilt);
    lines.push("canonicalMonths: " + (j.buildInputs.canonicalMonths ?? []).join(", "));
    kv("excludedDateKeysCount", j.excludedDateKeysCount);
    lines.push("excludedDateKeysSample: " + listTrunc(j.excludedDateKeysSample, 10).join(", "));
    kv("weatherUsed", false);
    lines.push("weatherNote: Weather not integrated in gap-fill lab path.");
  });

  section("G) Accuracy metrics (masked intervals only)", () => {
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

  section("H) Daily totals comparison (masked days)", () => {
    lines.push("top10Under (most negative delta):");
    j.diagnostics.top10Under.forEach((r) => lines.push(`  ${r.date} | actual=${r.actualKwh} sim=${r.simKwh} delta=${r.deltaKwh}`));
    lines.push("top10Over (most positive delta):");
    j.diagnostics.top10Over.forEach((r) => lines.push(`  ${r.date} | actual=${r.actualKwh} sim=${r.simKwh} delta=${r.deltaKwh}`));
    lines.push("worst10Abs:");
    j.metrics.worst10Abs.forEach((r) => lines.push(`  ${r.date} | actual=${r.actualKwh} sim=${r.simKwh} delta=${r.deltaKwh}`));
  });

  section("I) Hourly profile comparison (masked)", () => {
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

  section("K) Seasonal/month lens (masked intervals)", () => {
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
    rangesToMask?: Array<{ startDate: string; endDate: string }>;
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
  const rangesToMask = Array.isArray(body?.rangesToMask)
    ? body.rangesToMask
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

  const result = await getActualUsageDatasetForHouse(house.id, esiid, { skipFullYearIntervalFetch: true });
  const summary = result?.dataset?.summary;
  if (!summary?.start || !summary?.end) {
    return NextResponse.json(
      { ok: false, error: "no_actual_data", message: "No actual interval data for baseline window." },
      { status: 400 }
    );
  }

  const startDate = summary.start.slice(0, 10);
  const endDate = summary.end.slice(0, 10);

  if (rangesToMask.length === 0) {
    const travelRangesFromDb = await getTravelRangesFromDb(user.id, house.id);
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
      maskedIntervals: 0,
      message: "Add travel/vacant ranges and click Run Compare to see metrics.",
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

  const AUTO_BUILD_TIMEOUT_MS = 55_000; // avoid burning most of maxDuration on full-window fetch
  let profileAutoBuilt = false;
  const existingProfile = await getLatestUsageShapeProfile(house.id).catch(() => null);
  if (!existingProfile) {
    try {
      const fullWindowIntervals = await Promise.race([
        getActualIntervalsForRange({
          houseId: house.id,
          esiid,
          startDate,
          endDate,
        }),
        new Promise<undefined>((_, reject) =>
          setTimeout(() => reject(new Error("auto_build_timeout")), AUTO_BUILD_TIMEOUT_MS)
        ),
      ]);
      if (fullWindowIntervals?.length) {
        const windowStartUtc = `${startDate}T00:00:00.000Z`;
        const windowEndUtc = `${endDate}T23:59:59.999Z`;
        const intervalsForDerive = fullWindowIntervals.map((r) => ({ tsUtc: r.timestamp, kwh: r.kwh }));
        const profile = deriveUsageShapeProfile(intervalsForDerive, timezone, windowStartUtc, windowEndUtc);
        await upsertUsageShapeProfile(house.id, "v1", profile);
        profileAutoBuilt = true;
      }
    } catch {
      // non-fatal: continue without profile; diag will show profile_not_found (or run rebuild tool first)
    }
  }

  // Fetch actual intervals only for the masked range to avoid loading 12 months (timeout).
  const maskedRangeStart = rangesToMask.reduce((min, r) => (r.startDate < min ? r.startDate : min), rangesToMask[0].startDate);
  const maskedRangeEnd = rangesToMask.reduce((max, r) => (r.endDate > max ? r.endDate : max), rangesToMask[0].endDate);
  const fetchStart = maskedRangeStart < startDate ? startDate : maskedRangeStart;
  const fetchEnd = maskedRangeEnd > endDate ? endDate : maskedRangeEnd;

  const actualIntervals = await getActualIntervalsForRange({
    houseId: house.id,
    esiid,
    startDate: fetchStart,
    endDate: fetchEnd,
  });

  if (!actualIntervals?.length) {
    return NextResponse.json(
      { ok: false, error: "no_actual_data", message: "No actual interval data." },
      { status: 400 }
    );
  }

  const canonicalMonths = yearMonthsFromRange(startDate, endDate);
  if (!canonicalMonths.length) {
    return NextResponse.json({ ok: false, error: "invalid_range" }, { status: 400 });
  }

  const evalRanges = rangesToMask;
  const evalDateKeysLocal = normalizeRangesToLocalDateKeysInclusive(evalRanges, timezone);
  if (evalDateKeysLocal.size === 0) {
    return NextResponse.json(
      { ok: false, error: "eval_ranges_required", message: "Add at least one valid travel/vacant range (start and end date, YYYY-MM-DD) to run the comparison." },
      { status: 400 }
    );
  }

  const dbTravelRanges = await getTravelRangesFromDb(user.id, house.id);
  const dbLocal = normalizeRangesToLocalDateKeysInclusive(dbTravelRanges, timezone);
  const buildExcludedDateKeysLocal = new Set<string>(Array.from(dbLocal).concat(Array.from(evalDateKeysLocal)));
  const onlyDb = setDiff(dbLocal, evalDateKeysLocal);
  const onlyEval = setDiff(evalDateKeysLocal, dbLocal);
  const overlap = setIntersect(dbLocal, evalDateKeysLocal);
  const dateKeyDiag = {
    dbTravelDateKeysCount: dbLocal.size,
    dbTravelDateKeysSample: sortedSample(dbLocal),
    evalDateKeysCount: evalDateKeysLocal.size,
    evalDateKeysSample: sortedSample(evalDateKeysLocal),
    buildExcludedDateKeysCount: buildExcludedDateKeysLocal.size,
    buildExcludedDateKeysSample: sortedSample(buildExcludedDateKeysLocal),
    setArithmetic: {
      onlyDbCount: onlyDb.size,
      onlyDbSample: sortedSample(onlyDb),
      onlyEvalCount: onlyEval.size,
      onlyEvalSample: sortedSample(onlyEval),
      overlapCount: overlap.size,
      overlapSample: sortedSample(overlap),
    },
  };

  const buildExcludedUtcSet = buildExcludedUtcDateKeySetFromLocalKeys(
    buildExcludedDateKeysLocal,
    startDate,
    endDate,
    timezone
  );
  const buildExcludedRanges = Array.from(buildExcludedUtcSet)
    .sort()
    .map((d) => ({ startDate: d, endDate: d }));

  const maskedActual = actualIntervals.filter((p) => evalDateKeysLocal.has(dateKeyInTimezone(p.timestamp, timezone)));
  if (maskedActual.length === 0) {
    return NextResponse.json({
      ok: true,
      email: user.email,
      userId: user.id,
      house: { id: house.id, label: [house.addressLine1, house.addressCity, house.addressState].filter(Boolean).join(", ") || house.id },
      houses: houses.map((h: any) => ({
        id: h.id,
        label: [h.addressLine1, h.addressCity, h.addressState].filter(Boolean).join(", ") || h.id,
      })),
      timezone,
      homeProfile,
      applianceProfile,
      modelAssumptions: null,
      maskedIntervals: 0,
      message: "No intervals fall inside the masked ranges; add ranges and try again.",
      metrics: null,
      primaryPercentMetric: null,
      byMonth: [],
      byHour: [],
      byDayType: [],
      worstDays: [],
      diagnostics: null,
      pasteSummary: "",
      parity: null,
      fullReportText: "",
      fullReportJson: null,
    });
  }

  if (!homeProfileRec || !applianceProfileRec?.appliancesJson) {
    return NextResponse.json(
      {
        ok: false,
        error: "profile_required",
        message: "Production builder requires home and appliance profile for this house.",
      },
      { status: 400 }
    );
  }

  const normalizedAppliance = normalizeStoredApplianceProfile(applianceProfileRec.appliancesJson as any);
  const endMonth = endDate.slice(0, 7);
  const canonicalMonths12 = monthsEndingAt(endMonth, 12);

  const buildResult = await buildSimulatorInputs({
    mode: "SMT_BASELINE",
    manualUsagePayload: null,
    homeProfile: homeProfileRec as any,
    applianceProfile: normalizedAppliance,
    houseIdForActual: house.id,
    esiidForSmt: esiid,
    travelRanges: buildExcludedRanges,
    canonicalMonths: canonicalMonths12,
  });

  const buildInputs: SimulatorBuildInputsV1 = {
    version: 1,
    mode: "SMT_BASELINE",
    baseKind: buildResult.baseKind,
    canonicalMonths: buildResult.canonicalMonths,
    canonicalEndMonth: buildResult.canonicalMonths[buildResult.canonicalMonths.length - 1] ?? "",
    monthlyTotalsKwhByMonth: buildResult.monthlyTotalsKwhByMonth,
    intradayShape96: buildResult.intradayShape96,
    weekdayWeekendShape96: buildResult.weekdayWeekendShape96,
    travelRanges: buildExcludedRanges,
    notes: buildResult.notes ?? [],
    filledMonths: buildResult.filledMonths ?? [],
  };

  // Build exclusions (dataset + cache): DB ∪ Eval. Scoring mask (metrics): Eval only.
  // Try user's Past scenario cache first so we get a hit when they've already loaded Past with same inputs; else use lab cache.
  const userPastScenario = await (prisma as any).usageSimulatorScenario
    .findFirst({
      where: { userId: user.id, houseId: house.id, name: "Past (Corrected)", archivedAt: null },
      select: { id: true },
    })
    .catch(() => null);
  const userPastScenarioId = userPastScenario?.id ?? null;

  const intervalDataFingerprint = await getIntervalDataFingerprint({
    houseId: house.id,
    esiid: house.esiid ?? null,
    startDate,
    endDate,
  });
  const inputHash = computePastInputHash({
    engineVersion: PAST_ENGINE_VERSION,
    windowStartUtc: startDate,
    windowEndUtc: endDate,
    timezone,
    travelRanges: buildExcludedRanges,
    buildInputs: buildInputs as Record<string, unknown>,
    intervalDataFingerprint,
  });
  const userCacheTried = Boolean(userPastScenarioId);
  let userCacheHit = false;
  let labCacheHit = false;
  let cached: Awaited<ReturnType<typeof getCachedPastDataset>> = null;
  if (userPastScenarioId) {
    cached = await getCachedPastDataset({ houseId: house.id, scenarioId: userPastScenarioId, inputHash });
    if (cached && cached.intervalsCodec === INTERVAL_CODEC_V1) userCacheHit = true;
  }
  if (!cached) {
    cached = await getCachedPastDataset({
      houseId: house.id,
      scenarioId: "gapfill_lab",
      inputHash,
    });
    if (cached && cached.intervalsCodec === INTERVAL_CODEC_V1) labCacheHit = true;
  }
  const cacheSource: "user" | "lab" | "rebuilt" = userCacheHit ? "user" : labCacheHit ? "lab" : "rebuilt";
  const cacheHit = userCacheHit || labCacheHit;
  let compressedBytesLength = 0;
  let dataset: NonNullable<Awaited<ReturnType<typeof getPastSimulatedDatasetForHouse>>["dataset"]>;
  if (cached && cached.intervalsCodec === INTERVAL_CODEC_V1) {
    compressedBytesLength = cached.intervalsCompressed.length;
    const decoded = decodeIntervalsV1(cached.intervalsCompressed);
    dataset = {
      ...cached.datasetJson,
      series: {
        ...(typeof (cached.datasetJson as any).series === "object" && (cached.datasetJson as any).series !== null
          ? (cached.datasetJson as any).series
          : {}),
        intervals15: decoded,
      },
    } as any;
  } else {
    const pastResult = await getPastSimulatedDatasetForHouse({
      userId: user.id,
      houseId: house.id,
      esiid,
      travelRanges: buildExcludedRanges,
      buildInputs,
      startDate,
      endDate,
      timezone,
    });
    if (!pastResult.dataset) {
      return NextResponse.json(
        {
          ok: false,
          error: "past_dataset_failed",
          message: pastResult.error ?? "Could not build Past stitched dataset (same as production UI). Check house has actual data and weather stubbed.",
          inputHash,
          engineVersion: PAST_ENGINE_VERSION,
        },
        { status: 500 }
      );
    }
    dataset = pastResult.dataset;
    const intervals15 = dataset.series?.intervals15 ?? [];
    const { bytes } = encodeIntervalsV1(intervals15);
    compressedBytesLength = bytes.length;
    const datasetJsonForStorage = {
      ...dataset,
      series: { ...(dataset.series ?? {}), intervals15: [] },
    };
    await saveCachedPastDataset({
      houseId: house.id,
      scenarioId: "gapfill_lab",
      inputHash,
      engineVersion: PAST_ENGINE_VERSION,
      windowStartUtc: startDate,
      windowEndUtc: endDate,
      datasetJson: datasetJsonForStorage as Record<string, unknown>,
      intervalsCodec: INTERVAL_CODEC_V1,
      intervalsCompressed: bytes,
    });
  }

  const intervals15m = dataset.series?.intervals15 ?? [];
  const simulatedByTs = new Map<string, number>();
  for (const i of intervals15m) {
    const ts = String(i?.timestamp ?? "").trim();
    if (ts) simulatedByTs.set(canonicalIntervalKey(ts), Number(i?.kwh) || 0);
  }

  const metrics = computeGapFillMetrics({
    actual: maskedActual,
    simulated: intervals15m,
    simulatedByTs,
  });

  const baseloadDailyVal = dataset.insights?.baseloadDaily != null ? Number(dataset.insights.baseloadDaily) : null;
  const baseloadRawVal = dataset.insights?.baseload != null ? Number(dataset.insights.baseload) : null;
  const useDailyForParityBaseload =
    baseloadDailyVal != null && Number.isFinite(baseloadDailyVal) && baseloadDailyVal >= 0;
  const parityBaseloadKwhPer15m = useDailyForParityBaseload && baseloadDailyVal != null
    ? Math.round((baseloadDailyVal / 96) * 100) / 100
    : baseloadRawVal != null && Number.isFinite(baseloadRawVal)
      ? Math.round((baseloadRawVal / 4) * 100) / 100
      : null;

  const shapeSource = buildResult.source?.actualIntradayShape96 ? "actual_excluding_masked" : "generic_weekday";
  const modelAssumptions = {
    baseload: {
      used: false,
      method: "monthly_totals_from_actual",
      params: { excludeDateKeys: buildExcludedUtcSet.size },
      valueKwhPer15m: null,
      valueKwhPerDay: null,
    },
    pool: {
      used: false,
      pumpType: homeProfile?.pool?.pumpType ?? null,
      pumpHp: homeProfile?.pool?.pumpHp ?? null,
      assumedKw: null,
      runHoursPerDaySummer: homeProfile?.pool?.summerRunHoursPerDay ?? null,
      runHoursPerDayWinter: homeProfile?.pool?.winterRunHoursPerDay ?? null,
      scheduleRule: "Gap-fill lab does not model pool; monthly totals exclude masked days only.",
    },
    hvac: {
      used: false,
      hvacType: homeProfile?.hvacType ?? null,
      heatingType: homeProfile?.heatingType ?? null,
      setpointSummerF: homeProfile?.thermostatSummerF ?? homeProfile?.summerTemp ?? null,
      setpointWinterF: homeProfile?.thermostatWinterF ?? homeProfile?.winterTemp ?? null,
      weatherUsed: false,
      rule: "Gap-fill lab uses single intraday shape; no HVAC model.",
    },
    occupancy: {
      used: false,
      occupantsWork: homeProfile?.occupants?.work ?? null,
      occupantsSchool: homeProfile?.occupants?.school ?? null,
      occupantsHomeAllDay: homeProfile?.occupants?.homeAllDay ?? null,
      rule: "Gap-fill lab uses monthly totals × shape; no occupancy model.",
    },
    intradayShape: {
      source: shapeSource,
      weekdayWeekendSplit: Boolean((dataset as any)?.meta?.weekdayWeekendSplitUsed),
      smoothing: "none",
    },
    dayTotalSource: (dataset as any)?.meta?.dayTotalSource ?? "fallback_month_avg",
    meta: {
      simVersion: "production_builder",
      shapeDerivationVersion: "v1",
      seed: null,
      maskMode: "travel_ranges",
      holdoutN: maskedActual.length,
      configHash: `months=${buildInputs.canonicalMonths.length},shape=${shapeSource}`,
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
    for (const p of maskedActual) {
      const ts = String(p?.timestamp ?? "").trim();
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

  const listMaskedDateKeys = Array.from(evalDateKeysLocal).sort();
  const buildExcludedDateKeysSample = Array.from(buildExcludedUtcSet).sort().slice(0, 10);
  const evalMaskedDateKeysSample = listMaskedDateKeys.slice(0, 10);
  const { fullReportJson, fullReportText } = buildFullReport({
    reportVersion: REPORT_VERSION,
    generatedAt: new Date().toISOString(),
    env: process.env.VERCEL ? "vercel" : "local",
    houseId: house.id,
    userId: user.id,
    email: user.email ?? "",
    houseLabel: [house.addressLine1, house.addressCity, house.addressState].filter(Boolean).join(", ") || house.id,
    timezone,
    evalRanges,
    buildExcludedRanges,
    travelRangesNormalized: listMaskedDateKeys.map((d) => ({ startDate: d, endDate: d })),
    listMaskedDateKeys,
    maskedIntervalsCount: maskedActual.length,
    maskedDaysCount: listMaskedDateKeys.length,
    buildExcludedDateKeysCount: buildExcludedUtcSet.size,
    buildExcludedDateKeysSample,
    evalMaskedDateKeysCount: evalDateKeysLocal.size,
    evalMaskedDateKeysSample,
    dateKeyDiag,
    dataset: {
      summary: dataset.summary,
      totals: dataset.totals,
      insights: dataset.insights,
      monthly: dataset.monthly,
    },
    buildInputs: { canonicalMonths: buildInputs.canonicalMonths },
    configHash: modelAssumptions.meta.configHash,
    excludedDateKeysCount: buildExcludedUtcSet.size,
    excludedDateKeysSample: buildExcludedDateKeysSample,
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
    usageShapeProfileDiag: (dataset as any)?.meta?.usageShapeProfileDiag ?? null,
    profileAutoBuilt,
    cacheHit,
    userCacheTried,
    userCacheHit,
    userScenarioIdUsed: userPastScenarioId ?? null,
    labCacheHit,
    cacheSource,
    inputHash,
    intervalDataFingerprint,
    engineVersion: PAST_ENGINE_VERSION,
    intervalsCodec: INTERVAL_CODEC_V1,
    compressedBytesLength,
  });

  const pasteLines = [
    "=== Simulation Audit Report (Gap-Fill Lab) ===",
    `House: ${house.addressLine1 ?? ""} ${house.addressCity ?? ""} ${house.addressState ?? ""}`.trim() || house.id,
    `Masked intervals: ${maskedActual.length} | Timezone: ${timezone}`,
    "",
    "--- Primary metrics ---",
    `WAPE: ${metrics.wape}% | MAE: ${metrics.mae} kWh | RMSE: ${metrics.rmse} | MAPE: ${metrics.mape}% | MaxAbs: ${metrics.maxAbs} kWh`,
    "",
    "--- Parity (production Past simulated usage) ---",
    `intervalCount: ${dataset.summary.intervalsCount} | annualKwh: ${dataset.totals.netKwh} | baseloadKwhPer15m: ${parityBaseloadKwhPer15m ?? "—"} | baseloadDailyKwh: ${dataset.insights.baseloadDaily ?? "—"} | window: ${dataset.summary.start ?? "—"} → ${dataset.summary.end ?? "—"}`,
    "",
    "--- Assumptions ---",
    `Intraday shape: ${modelAssumptions.intradayShape.source} | Weekday/weekend split: ${modelAssumptions.intradayShape.weekdayWeekendSplit}`,
    `Baseload/Pool/HVAC/Occupancy models: not used (monthly totals × shape only)`,
    "",
    "--- Diagnostics ---",
    `Seasonal: Summer WAPE ${metrics.diagnostics.seasonalSplit.summer.wape}% MAE ${metrics.diagnostics.seasonalSplit.summer.mae} | Winter WAPE ${metrics.diagnostics.seasonalSplit.winter.wape}% MAE ${metrics.diagnostics.seasonalSplit.winter.mae} | Shoulder WAPE ${metrics.diagnostics.seasonalSplit.shoulder.wape}% MAE ${metrics.diagnostics.seasonalSplit.shoulder.mae}`,
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
    maskedIntervals: maskedActual.length,
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
      intervalCount: dataset.summary.intervalsCount,
      annualKwh: dataset.totals.netKwh,
      baseloadKwhPer15m: parityBaseloadKwhPer15m,
      baseloadDailyKwh: dataset.insights.baseloadDaily ?? null,
      windowStartUtc: dataset.summary.start ?? null,
      windowEndUtc: dataset.summary.end ?? null,
    },
    profileAutoBuilt,
    pasteSummary,
    fullReportText,
    fullReportJson,
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