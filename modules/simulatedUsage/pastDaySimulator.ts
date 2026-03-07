/**
 * Shared Past day simulation core.
 * Used by both GapFill Lab and user-facing Past baseline so both paths use the same day-simulation math.
 */

import type {
  PastDaySimulationContext,
  PastDaySimulationRequest,
  PastDaySimulationResult,
  PastDayProfileLite,
  PastDayTrainingWeatherStats,
  PastDayWeatherFeatures,
  PastDayHomeProfile,
  PastDayApplianceProfile,
  PastDayWeatherClassification,
  PastDayFallbackLevel,
} from "./pastDaySimulatorTypes";

export { PAST_DAY_SIMULATOR_VERSION, SOURCE_OF_DAY_SIMULATION_CORE } from "./pastDaySimulatorTypes";
export type { PastDaySimulationContext, PastDaySimulationRequest, PastDaySimulationResult } from "./pastDaySimulatorTypes";

const INTERVALS_PER_DAY = 96;

// ----- Fallback hierarchy (from GapFill Lab) -----
function prevMonthKey(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  if (m === 1) return `${y - 1}-12`;
  return `${y}-${String(m - 1).padStart(2, "0")}`;
}

function nextMonthKey(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  if (m === 12) return `${y + 1}-01`;
  return `${y}-${String(m + 1).padStart(2, "0")}`;
}

function getSeasonForMonthKey(monthKey: string): "winter" | "shoulder" | "summer" {
  const m = parseInt(monthKey.slice(5, 7), 10) || 0;
  if (m === 12 || m <= 2) return "winter";
  if (m >= 6 && m <= 9) return "summer";
  return "shoulder";
}

function getSeasonMonthKeys(monthKey: string, allMonthKeys: string[]): string[] {
  const season = getSeasonForMonthKey(monthKey);
  return allMonthKeys.filter((k) => getSeasonForMonthKey(k) === season);
}

function getSeasonBucket(monthKey: string): string {
  const m = parseInt(monthKey.slice(5, 7), 10) || 1;
  if (m === 12 || m <= 2) return "winter";
  if (m >= 3 && m <= 5) return "spring";
  if (m >= 6 && m <= 8) return "summer";
  return "fall";
}

const MIN_DAYS_MONTH_DAYTYPE = 4;
const MIN_DAYS_ADJACENT = 6;
const MIN_DAYS_MONTH_OVERALL = 6;
const MIN_DAYS_SEASON = 8;
const MIN_DAYS_GLOBAL_DAYTYPE = 8;
const GUARDRAIL_MAX_MULT = 1.75;
const GUARDRAIL_MIN_MULT = 0.45;

function selectDayTotalWithFallback(args: {
  monthKey: string;
  isWeekend: boolean;
  profile: PastDayProfileLite;
}): { targetDayKwh: number; fallbackLevel: PastDayFallbackLevel; rawSelectedDayKwh: number; clampApplied: boolean } {
  const { monthKey, isWeekend, profile } = args;
  const {
    monthKeys,
    avgKwhPerDayWeekdayByMonth,
    avgKwhPerDayWeekendByMonth,
    weekdayCountByMonth,
    weekendCountByMonth,
    monthOverallAvgByMonth,
    monthOverallCountByMonth,
  } = profile;
  const monthIdx = monthKeys.indexOf(monthKey);
  const wdCount = weekdayCountByMonth[monthKey] ?? 0;
  const weCount = weekendCountByMonth[monthKey] ?? 0;
  const sameDayTypeCount = isWeekend ? weCount : wdCount;
  const dayTypeAvgArr = isWeekend ? avgKwhPerDayWeekendByMonth : avgKwhPerDayWeekdayByMonth;
  const dayTypeAvg = monthIdx >= 0 && dayTypeAvgArr[monthIdx] != null ? dayTypeAvgArr[monthIdx]! : 0;

  const globalWdSum = monthKeys.reduce(
    (s, k) => s + (weekdayCountByMonth[k] ?? 0) * (avgKwhPerDayWeekdayByMonth[monthKeys.indexOf(k)] ?? 0),
    0
  );
  const globalWeSum = monthKeys.reduce(
    (s, k) => s + (weekendCountByMonth[k] ?? 0) * (avgKwhPerDayWeekendByMonth[monthKeys.indexOf(k)] ?? 0),
    0
  );
  const globalWdCount = monthKeys.reduce((s, k) => s + (weekdayCountByMonth[k] ?? 0), 0);
  const globalWeCount = monthKeys.reduce((s, k) => s + (weekendCountByMonth[k] ?? 0), 0);
  const globalAvgWd = globalWdCount > 0 ? globalWdSum / globalWdCount : 0;
  const globalAvgWe = globalWeCount > 0 ? globalWeSum / globalWeCount : 0;
  const globalAvgDayType = isWeekend ? globalAvgWe : globalAvgWd;
  const globalCountDayType = isWeekend ? globalWeCount : globalWdCount;
  const globalOverallCount = globalWdCount + globalWeCount;
  const globalOverallAvg =
    globalOverallCount > 0 ? (globalWdSum + globalWeSum) / globalOverallCount : (globalAvgWd + globalAvgWe) / 2 || 0;

  let rawKwh: number;
  let level: PastDayFallbackLevel;

  if (sameDayTypeCount >= MIN_DAYS_MONTH_DAYTYPE && Number.isFinite(dayTypeAvg) && dayTypeAvg > 0) {
    rawKwh = dayTypeAvg;
    level = "month_daytype";
  } else {
    const prevKey = prevMonthKey(monthKey);
    const nextKey = nextMonthKey(monthKey);
    const prevDayTypeCount = isWeekend ? (weekendCountByMonth[prevKey] ?? 0) : (weekdayCountByMonth[prevKey] ?? 0);
    const nextDayTypeCount = isWeekend ? (weekendCountByMonth[nextKey] ?? 0) : (weekdayCountByMonth[nextKey] ?? 0);
    const adjCount = prevDayTypeCount + nextDayTypeCount;
    const prevIdx = monthKeys.indexOf(prevKey);
    const nextIdx = monthKeys.indexOf(nextKey);
    const prevAvg =
      prevIdx >= 0 ? (isWeekend ? avgKwhPerDayWeekendByMonth[prevIdx] : avgKwhPerDayWeekdayByMonth[prevIdx]) : 0;
    const nextAvg =
      nextIdx >= 0 ? (isWeekend ? avgKwhPerDayWeekendByMonth[nextIdx] : avgKwhPerDayWeekdayByMonth[nextIdx]) : 0;
    if (adjCount >= MIN_DAYS_ADJACENT && (Number.isFinite(prevAvg) || Number.isFinite(nextAvg))) {
      const total = prevDayTypeCount + nextDayTypeCount;
      rawKwh =
        total > 0 ? ((prevAvg ?? 0) * prevDayTypeCount + (nextAvg ?? 0) * nextDayTypeCount) / total : globalAvgDayType;
      level = "adjacent_month_daytype";
    } else if ((monthOverallCountByMonth[monthKey] ?? 0) >= MIN_DAYS_MONTH_OVERALL) {
      rawKwh = monthOverallAvgByMonth[monthKey] ?? globalOverallAvg;
      level = "month_overall";
    } else {
      const seasonKeys = getSeasonMonthKeys(monthKey, monthKeys);
      const seasonCount = seasonKeys.reduce(
        (s, k) => s + (weekdayCountByMonth[k] ?? 0) + (weekendCountByMonth[k] ?? 0),
        0
      );
      if (seasonCount >= MIN_DAYS_SEASON) {
        let sum = 0;
        let cnt = 0;
        for (const k of seasonKeys) {
          const n = monthOverallCountByMonth[k] ?? 0;
          if (n > 0) {
            sum += (monthOverallAvgByMonth[k] ?? 0) * n;
            cnt += n;
          }
        }
        rawKwh = cnt > 0 ? sum / cnt : globalOverallAvg;
        level = "season_overall";
      } else if (globalCountDayType >= MIN_DAYS_GLOBAL_DAYTYPE) {
        rawKwh = globalAvgDayType;
        level = "global_daytype";
      } else {
        rawKwh = globalOverallAvg;
        level = "global_overall";
      }
    }
  }

  let targetDayKwh = rawKwh;
  let clampApplied = false;
  if (Number.isFinite(globalAvgDayType) && globalAvgDayType > 1e-6) {
    if (rawKwh > globalAvgDayType * GUARDRAIL_MAX_MULT) {
      targetDayKwh = globalAvgDayType * GUARDRAIL_MAX_MULT;
      clampApplied = true;
    } else if (rawKwh < globalAvgDayType * GUARDRAIL_MIN_MULT) {
      targetDayKwh = globalAvgDayType * GUARDRAIL_MIN_MULT;
      clampApplied = true;
    }
  }
  return { targetDayKwh, fallbackLevel: level, rawSelectedDayKwh: rawKwh, clampApplied };
}

// ----- Weather adjustment (from GapFill Lab) -----
const WEATHER_SEVERITY_THRESHOLD = 2;
const WEATHER_DEADBAND_PCT = 0.15;
const HEATING_MULT_MIN = 0.9;
const HEATING_MULT_MAX = 1.35;
const COOLING_MULT_MIN = 0.9;
const COOLING_MULT_MAX = 1.25;
const AUX_HEAT_SLOPE = 0.15;
/** Phase 1 safety cap: aux heat adder per day (kWh). */
const AUX_HEAT_KWH_CAP = 12;
/** Aux heat only when daily min temp <= 0 C (freezing or below). */
const AUX_MIN_TEMP_C = 0;
/** Aux heat only when heating severity >= this ratio of reference. */
const AUX_HDD_RATIO = 1.35;
/** Aux heat only when at least this many hours at or below 0 C. */
const AUX_FREEZE_HOURS_MIN = 2;
const POOL_FREEZE_HOURS_MIN = 4;
const POOL_FREEZE_MIN_TEMP_C = 0;
const POOL_FREEZE_KWH_CAP = 8;
const POOL_FREEZE_HP_FACTOR = 0.75;

function computeWeatherAdjustedDayTotal(args: {
  baseDayKwh: number;
  localDate: string;
  weatherByDateKey: Map<string, PastDayWeatherFeatures>;
  trainingStats: PastDayTrainingWeatherStats | null;
  isWeekend: boolean;
  homeProfile?: PastDayHomeProfile | null;
  applianceProfile?: PastDayApplianceProfile | null;
}): {
  finalSelectedDayKwh: number;
  weatherSeverityMultiplier: number;
  weatherModeUsed: "heating" | "cooling" | "neutral";
  auxHeatKwhAdder: number;
  poolFreezeProtectKwhAdder: number;
  dayClassification: PastDayWeatherClassification;
  auxHeatGate_minTempPassed: boolean;
  auxHeatGate_freezeHoursPassed: boolean;
  auxHeatGate_severityPassed: boolean;
  referenceHeatingSeverity: number;
} {
  const { baseDayKwh, localDate, weatherByDateKey, trainingStats, isWeekend, homeProfile, applianceProfile } = args;
  const wx = weatherByDateKey.get(localDate);
  const monthKey = localDate.slice(0, 7);
  const season = getSeasonBucket(monthKey);
  const bucket = `${monthKey}:${isWeekend ? "we" : "wd"}`;
  const seasonBucket = `${season}:${isWeekend ? "we" : "wd"}`;

  let weatherSeverityMultiplier = 1;
  let weatherModeUsed: "heating" | "cooling" | "neutral" = "neutral";
  let auxHeatKwhAdder = 0;
  let poolFreezeProtectKwhAdder = 0;

  if (!wx || !trainingStats) {
    return {
      finalSelectedDayKwh: baseDayKwh,
      weatherSeverityMultiplier: 1,
      weatherModeUsed: "neutral",
      auxHeatKwhAdder: 0,
      poolFreezeProtectKwhAdder: 0,
      dayClassification: "normal_day",
      auxHeatGate_minTempPassed: false,
      auxHeatGate_freezeHoursPassed: false,
      auxHeatGate_severityPassed: false,
      referenceHeatingSeverity: 0,
    };
  }

  const refMonth = trainingStats.byMonthDaytype.get(bucket);
  const refSeason = trainingStats.bySeasonDaytype.get(seasonBucket);
  const refGlobal = trainingStats.global;
  const refHdd =
    refMonth?.avgHdd ?? refSeason?.avgHdd ?? (isWeekend ? refGlobal.avgHddWe : refGlobal.avgHddWd);
  const refCdd =
    refMonth?.avgCdd ?? refSeason?.avgCdd ?? (isWeekend ? refGlobal.avgCddWe : refGlobal.avgCddWd);
  const testHdd = wx.heatingDegreeSeverity;
  const testCdd = wx.coolingDegreeSeverity;

  if (testHdd > testCdd && testHdd > WEATHER_SEVERITY_THRESHOLD) {
    weatherModeUsed = "heating";
    if (refHdd != null && refHdd > 1e-6) {
      const ratio = testHdd / refHdd;
      if (ratio >= 1 - WEATHER_DEADBAND_PCT && ratio <= 1 + WEATHER_DEADBAND_PCT) {
        weatherSeverityMultiplier = 1;
      } else {
        weatherSeverityMultiplier = Math.max(HEATING_MULT_MIN, Math.min(HEATING_MULT_MAX, ratio));
      }
    }
  } else if (testCdd > testHdd && testCdd > WEATHER_SEVERITY_THRESHOLD) {
    weatherModeUsed = "cooling";
    if (refCdd != null && refCdd > 1e-6) {
      const ratio = testCdd / refCdd;
      if (ratio >= 1 - WEATHER_DEADBAND_PCT && ratio <= 1 + WEATHER_DEADBAND_PCT) {
        weatherSeverityMultiplier = 1;
      } else {
        weatherSeverityMultiplier = Math.max(COOLING_MULT_MIN, Math.min(COOLING_MULT_MAX, ratio));
      }
    }
  }

  const isElectricHeat =
    homeProfile?.fuelConfiguration === "all_electric" || homeProfile?.heatingType === "electric";
  const referenceHeatingSeverity = refHdd ?? 0;
  const auxHeatGate_minTempPassed = wx.dailyMinTempC != null && wx.dailyMinTempC <= AUX_MIN_TEMP_C;
  const auxHeatGate_freezeHoursPassed = wx.freezeHoursCount >= AUX_FREEZE_HOURS_MIN;
  const auxHeatGate_severityPassed =
    referenceHeatingSeverity > 1e-6 &&
    wx.heatingDegreeSeverity >= referenceHeatingSeverity * AUX_HDD_RATIO;
  const allAuxGatesPassed =
    isElectricHeat &&
    auxHeatGate_minTempPassed &&
    auxHeatGate_freezeHoursPassed &&
    auxHeatGate_severityPassed;
  if (allAuxGatesPassed) {
    const ref = Math.max(referenceHeatingSeverity, 1);
    auxHeatKwhAdder = Math.max(
      0,
      Math.min(AUX_HEAT_KWH_CAP, (wx.heatingDegreeSeverity - ref) * AUX_HEAT_SLOPE)
    );
  }

  const hasPool =
    Boolean(homeProfile?.pool?.hasPool) ||
    (applianceProfile?.appliances ?? []).some((a) => a?.type === "pool");
  const pumpHp =
    homeProfile?.pool?.pumpHp ??
    (applianceProfile?.appliances ?? []).find((a) => a?.type === "pool")?.data?.pump_hp;
  const freezeHoursOk = wx.freezeHoursCount >= POOL_FREEZE_HOURS_MIN;
  const dailyMinOkForPool = wx.dailyMinTempC != null && wx.dailyMinTempC <= POOL_FREEZE_MIN_TEMP_C;
  if (hasPool && freezeHoursOk && dailyMinOkForPool) {
    const hp = pumpHp != null && Number.isFinite(Number(pumpHp)) ? Number(pumpHp) : 1;
    poolFreezeProtectKwhAdder = Math.max(
      0,
      Math.min(
        POOL_FREEZE_KWH_CAP,
        hp * POOL_FREEZE_HP_FACTOR * Math.max(1, wx.freezeHoursCount / 4)
      )
    );
  }

  const finalSelectedDayKwh =
    baseDayKwh * weatherSeverityMultiplier + auxHeatKwhAdder + poolFreezeProtectKwhAdder;

  let dayClassification: PastDayWeatherClassification;
  if (auxHeatKwhAdder > 0) {
    dayClassification = "extreme_cold_event_day";
  } else if (poolFreezeProtectKwhAdder > 0) {
    dayClassification = "freeze_protect_day";
  } else if (weatherSeverityMultiplier !== 1) {
    dayClassification = "weather_scaled_day";
  } else {
    dayClassification = "normal_day";
  }

  return {
    finalSelectedDayKwh: Math.max(0, finalSelectedDayKwh),
    weatherSeverityMultiplier,
    weatherModeUsed,
    auxHeatKwhAdder,
    poolFreezeProtectKwhAdder,
    dayClassification,
    auxHeatGate_minTempPassed,
    auxHeatGate_freezeHoursPassed,
    auxHeatGate_severityPassed,
    referenceHeatingSeverity,
  };
}

// ----- Public API -----

/**
 * Build reusable context for past day simulation (profile + training weather stats + weather by date).
 */
export function buildPastDaySimulationContext(args: {
  profile: PastDayProfileLite;
  trainingWeatherStats: PastDayTrainingWeatherStats | null;
  weatherByDateKey: Map<string, PastDayWeatherFeatures>;
}): PastDaySimulationContext {
  return {
    profile: args.profile,
    trainingWeatherStats: args.trainingWeatherStats,
    weatherByDateKey: args.weatherByDateKey,
  };
}

/**
 * Simulate one past day: profile day total + weather adjustment + 96-point shape -> 15-min intervals.
 */
export function simulatePastDay(
  request: PastDaySimulationRequest,
  context: PastDaySimulationContext,
  homeProfile?: PastDayHomeProfile | null,
  applianceProfile?: PastDayApplianceProfile | null,
  shapeByMonth96?: Record<string, number[]> | null
): PastDaySimulationResult {
  const { localDate, isWeekend, gridTimestamps, weatherForDay } = request;
  const monthKey = localDate.slice(0, 7);

  const sel = selectDayTotalWithFallback({
    monthKey,
    isWeekend,
    profile: context.profile,
  });

  const weatherByDateKey = new Map<string, PastDayWeatherFeatures>();
  if (weatherForDay) weatherByDateKey.set(localDate, weatherForDay);

  const adj = computeWeatherAdjustedDayTotal({
    baseDayKwh: sel.targetDayKwh,
    localDate,
    weatherByDateKey,
    trainingStats: context.trainingWeatherStats,
    isWeekend,
    homeProfile: homeProfile ?? null,
    applianceProfile: applianceProfile ?? null,
  });

  const shape96 =
    (shapeByMonth96 && shapeByMonth96[monthKey] && shapeByMonth96[monthKey].length === INTERVALS_PER_DAY
      ? shapeByMonth96[monthKey]
      : null) ?? Array.from({ length: INTERVALS_PER_DAY }, () => 1 / INTERVALS_PER_DAY);
  const sumShape = shape96.reduce((a, b) => a + b, 0) || 1;
  const normShape = shape96.map((w) => w / sumShape);

  const intervals = gridTimestamps.slice(0, INTERVALS_PER_DAY).map((ts, i) => ({
    timestamp: ts,
    kwh: Math.max(0, (adj.finalSelectedDayKwh ?? 0) * (normShape[i] ?? 1 / INTERVALS_PER_DAY)),
  }));

  return {
    intervals,
    profileSelectedDayKwh: sel.targetDayKwh,
    finalDayKwh: adj.finalSelectedDayKwh,
    weatherSeverityMultiplier: adj.weatherSeverityMultiplier,
    weatherModeUsed: adj.weatherModeUsed,
    auxHeatKwhAdder: adj.auxHeatKwhAdder,
    poolFreezeProtectKwhAdder: adj.poolFreezeProtectKwhAdder,
    dayClassification: adj.dayClassification,
    fallbackLevel: sel.fallbackLevel,
    clampApplied: sel.clampApplied,
    shape96Used: normShape,
    auxHeatGate_minTempPassed: adj.auxHeatGate_minTempPassed,
    auxHeatGate_freezeHoursPassed: adj.auxHeatGate_freezeHoursPassed,
    auxHeatGate_severityPassed: adj.auxHeatGate_severityPassed,
    referenceHeatingSeverity: adj.referenceHeatingSeverity,
  };
}

/**
 * Get day-level simulation result only (no intervals). Use when caller applies shape to its own grid (e.g. GapFill Lab).
 */
export function getPastDayResultOnly(
  localDate: string,
  isWeekend: boolean,
  context: PastDaySimulationContext,
  homeProfile?: PastDayHomeProfile | null,
  applianceProfile?: PastDayApplianceProfile | null,
  weatherForDay?: PastDayWeatherFeatures | null,
  shapeByMonth96?: Record<string, number[]> | null
): Omit<PastDaySimulationResult, "intervals"> {
  const monthKey = localDate.slice(0, 7);
  const sel = selectDayTotalWithFallback({ monthKey, isWeekend, profile: context.profile });
  const weatherByDateKey = new Map<string, PastDayWeatherFeatures>();
  if (weatherForDay) weatherByDateKey.set(localDate, weatherForDay);
  const adj = computeWeatherAdjustedDayTotal({
    baseDayKwh: sel.targetDayKwh,
    localDate,
    weatherByDateKey,
    trainingStats: context.trainingWeatherStats,
    isWeekend,
    homeProfile: homeProfile ?? null,
    applianceProfile: applianceProfile ?? null,
  });
  const shape96 =
    (shapeByMonth96 && shapeByMonth96[monthKey] && shapeByMonth96[monthKey].length === INTERVALS_PER_DAY
      ? shapeByMonth96[monthKey]
      : null) ?? Array.from({ length: INTERVALS_PER_DAY }, () => 1 / INTERVALS_PER_DAY);
  const sumShape = shape96.reduce((a, b) => a + b, 0) || 1;
  const normShape = shape96.map((w) => w / sumShape);
  return {
    profileSelectedDayKwh: sel.targetDayKwh,
    finalDayKwh: adj.finalSelectedDayKwh,
    weatherSeverityMultiplier: adj.weatherSeverityMultiplier,
    weatherModeUsed: adj.weatherModeUsed,
    auxHeatKwhAdder: adj.auxHeatKwhAdder,
    poolFreezeProtectKwhAdder: adj.poolFreezeProtectKwhAdder,
    dayClassification: adj.dayClassification,
    fallbackLevel: sel.fallbackLevel,
    clampApplied: sel.clampApplied,
    shape96Used: normShape,
    auxHeatGate_minTempPassed: adj.auxHeatGate_minTempPassed,
    auxHeatGate_freezeHoursPassed: adj.auxHeatGate_freezeHoursPassed,
    auxHeatGate_severityPassed: adj.auxHeatGate_severityPassed,
    referenceHeatingSeverity: adj.referenceHeatingSeverity,
  };
}

/**
 * Simulate multiple past days (vectorized wrapper).
 */
export function simulatePastDays(
  requests: PastDaySimulationRequest[],
  context: PastDaySimulationContext,
  homeProfile?: PastDayHomeProfile | null,
  applianceProfile?: PastDayApplianceProfile | null,
  shapeByMonth96?: Record<string, number[]> | null
): PastDaySimulationResult[] {
  return requests.map((req) =>
    simulatePastDay(req, context, homeProfile, applianceProfile, shapeByMonth96)
  );
}
