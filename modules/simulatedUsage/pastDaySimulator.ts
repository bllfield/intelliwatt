/**
 * Shared Past day simulation core.
 * Used by both GapFill Lab and user-facing Past baseline so both paths use the same day-simulation math.
 */

import type {
  PastDaySimulationContext,
  PastDaySimulationRequest,
  PastDaySimulationResult,
  SimulatedDayResult,
  PastDayProfileLite,
  PastDayTrainingWeatherStats,
  PastDayWeatherFeatures,
  PastDayHomeProfile,
  PastDayApplianceProfile,
  PastDayWeatherClassification,
  PastDayFallbackLevel,
  PastShapeVariants,
  PastDayTypeKey,
  PastWeatherRegimeKey,
  PastNeighborDaySample,
  PastWeatherDonorSample,
} from "./pastDaySimulatorTypes";

export { PAST_DAY_SIMULATOR_VERSION, SOURCE_OF_DAY_SIMULATION_CORE } from "./pastDaySimulatorTypes";
export type { PastDaySimulationContext, PastDaySimulationRequest, PastDaySimulationResult, SimulatedDayResult } from "./pastDaySimulatorTypes";

const INTERVALS_PER_DAY = 96;

/** Canonical day-display rounding used across simulated-day paths. */
export function roundDayKwhDisplay(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

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
const MIN_DAYS_NEIGHBOR_DAYTYPE = 3;
const MIN_DAYS_WEATHER_DONOR_SAME_DAYTYPE = 3;
const MIN_DAYS_WEATHER_DONOR_SAME_REGIME = 2;
const WEATHER_DONOR_PICK_COUNT = 4;
const NEIGHBOR_DOM_RADIUS = 5;
const GUARDRAIL_MAX_MULT = 1.75;
const GUARDRAIL_MIN_MULT = 0.45;

function parseLocalDayOfMonth(localDate: string): number | null {
  const dom = Number(String(localDate ?? "").slice(8, 10));
  if (!Number.isFinite(dom) || dom < 1 || dom > 31) return null;
  return dom;
}

function weightedNeighborDayKwh(args: {
  targetDayOfMonth: number | null;
  samples: PastNeighborDaySample[] | undefined;
}): number | null {
  const dom = args.targetDayOfMonth;
  if (dom == null || !Array.isArray(args.samples) || args.samples.length === 0) return null;
  const scored = args.samples
    .map((s) => {
      const sampleDom = Number(s?.dayOfMonth);
      const dayKwh = Number(s?.dayKwh);
      if (!Number.isFinite(sampleDom) || !Number.isFinite(dayKwh) || dayKwh <= 0) return null;
      const dist = Math.abs(sampleDom - dom);
      if (dist > NEIGHBOR_DOM_RADIUS) return null;
      const weight = 1 / (1 + dist);
      return { weight, dayKwh };
    })
    .filter((x): x is { weight: number; dayKwh: number } => Boolean(x))
    .sort((a, b) => b.weight - a.weight);
  if (scored.length < MIN_DAYS_NEIGHBOR_DAYTYPE) return null;
  const wSum = scored.reduce((s, r) => s + r.weight, 0);
  if (!Number.isFinite(wSum) || wSum <= 0) return null;
  const kwh = scored.reduce((s, r) => s + r.dayKwh * r.weight, 0) / wSum;
  return Number.isFinite(kwh) && kwh > 0 ? kwh : null;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function spreadForWeather(wx: {
  dailyMinTempC: number | null | undefined;
  dailyMaxTempC: number | null | undefined;
} | null | undefined): number | null {
  const min = Number(wx?.dailyMinTempC);
  const max = Number(wx?.dailyMaxTempC);
  return Number.isFinite(min) && Number.isFinite(max) ? max - min : null;
}

function dayTypeKeyFromWeekend(isWeekend: boolean): PastDayTypeKey {
  return isWeekend ? "weekend" : "weekday";
}

function weatherRegimeFromWeather(wx: PastDayWeatherFeatures | null | undefined): PastWeatherRegimeKey {
  const heating = Math.max(0, Number(wx?.heatingDegreeSeverity) || 0);
  const cooling = Math.max(0, Number(wx?.coolingDegreeSeverity) || 0);
  if (heating > cooling && heating > WEATHER_SEVERITY_THRESHOLD) return "heating";
  if (cooling > heating && cooling > WEATHER_SEVERITY_THRESHOLD) return "cooling";
  return "neutral";
}

function monthDistance(targetMonthKey: string, donorMonthKey: string): number {
  const [targetYear, targetMonth] = targetMonthKey.split("-").map(Number);
  const [donorYear, donorMonth] = donorMonthKey.split("-").map(Number);
  if (!Number.isFinite(targetYear) || !Number.isFinite(targetMonth) || !Number.isFinite(donorYear) || !Number.isFinite(donorMonth)) {
    return 12;
  }
  return Math.abs((targetYear - donorYear) * 12 + (targetMonth - donorMonth));
}

function weatherDistanceScore(args: {
  target: PastDayWeatherFeatures;
  donor: PastWeatherDonorSample;
  targetMonthKey: string;
  targetDayOfMonth: number | null;
}): number {
  const targetSpread = spreadForWeather(args.target) ?? 0;
  const donorSpread = Number(args.donor.tempSpreadC);
  const donorDayOfMonth = parseLocalDayOfMonth(args.donor.localDate);
  return (
    Math.abs((Number(args.donor.heatingDegreeSeverity) || 0) - (Number(args.target.heatingDegreeSeverity) || 0)) * 2.4 +
    Math.abs((Number(args.donor.coolingDegreeSeverity) || 0) - (Number(args.target.coolingDegreeSeverity) || 0)) * 2.4 +
    Math.abs((Number(args.donor.dailyAvgTempC) || 0) - (Number(args.target.dailyAvgTempC) || 0)) * 0.8 +
    Math.abs((Number(args.donor.dailyMaxTempC) || 0) - (Number(args.target.dailyMaxTempC) || 0)) * 0.35 +
    Math.abs((Number(args.donor.dailyMinTempC) || 0) - (Number(args.target.dailyMinTempC) || 0)) * 0.35 +
    Math.abs((Number.isFinite(donorSpread) ? donorSpread : 0) - targetSpread) * 0.2 +
    monthDistance(args.targetMonthKey, args.donor.monthKey) * 0.35 +
    Math.abs((donorDayOfMonth ?? 15) - (args.targetDayOfMonth ?? 15)) * 0.04
  );
}

function selectWeatherSimilarDonor(args: {
  localDate: string;
  monthKey: string;
  isWeekend: boolean;
  weatherForDay: PastDayWeatherFeatures | null;
  weatherDonorSamples?: PastWeatherDonorSample[] | null;
}):
  | {
      targetDayKwh: number;
      fallbackLevel: PastDayFallbackLevel;
      donorSelectionModeUsed: string;
      donorCandidatePoolSize: number;
      selectedDonorLocalDates: string[];
      donorWeatherRegimeUsed: PastWeatherRegimeKey | null;
      donorMonthKeyUsed: string | null;
      thermalDistanceScore: number | null;
      broadFallbackUsed: boolean;
      donorWeatherReference: PastDayWeatherFeatures | null;
    }
  | null {
  const weatherForDay = args.weatherForDay;
  if (!weatherForDay || !Array.isArray(args.weatherDonorSamples) || args.weatherDonorSamples.length === 0) return null;
  const dayType = dayTypeKeyFromWeekend(args.isWeekend);
  const targetRegime = weatherRegimeFromWeather(weatherForDay);
  const targetDayOfMonth = parseLocalDayOfMonth(args.localDate);
  const sameDayType = args.weatherDonorSamples.filter(
    (sample) => sample.dayType === dayType && Number(sample.dayKwh) > 0
  );
  if (sameDayType.length < MIN_DAYS_WEATHER_DONOR_SAME_DAYTYPE) return null;
  const sameRegime = sameDayType.filter((sample) => sample.weatherRegime === targetRegime);
  const candidatePool =
    sameRegime.length >= MIN_DAYS_WEATHER_DONOR_SAME_REGIME
      ? sameRegime
      : sameDayType;
  if (candidatePool.length < MIN_DAYS_WEATHER_DONOR_SAME_DAYTYPE) return null;

  const scored = candidatePool
    .map((donor) => ({
      donor,
      distance: weatherDistanceScore({
        target: weatherForDay,
        donor,
        targetMonthKey: args.monthKey,
        targetDayOfMonth,
      }),
    }))
    .sort((a, b) => a.distance - b.distance || a.donor.localDate.localeCompare(b.donor.localDate));
  if (scored.length === 0) return null;
  const picked = scored.slice(0, Math.min(WEATHER_DONOR_PICK_COUNT, scored.length));
  const weighted = picked.map((entry) => ({
    ...entry,
    weight: 1 / (1 + Math.max(0, entry.distance)),
  }));
  const weightSum = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  if (!Number.isFinite(weightSum) || weightSum <= 0) return null;
  const targetDayKwh =
    weighted.reduce((sum, entry) => sum + (Number(entry.donor.dayKwh) || 0) * entry.weight, 0) / weightSum;
  const donorWeatherReference: PastDayWeatherFeatures = {
    dailyAvgTempC:
      weighted.reduce((sum, entry) => sum + (Number(entry.donor.dailyAvgTempC) || 0) * entry.weight, 0) / weightSum,
    dailyMinTempC:
      weighted.reduce((sum, entry) => sum + (Number(entry.donor.dailyMinTempC) || 0) * entry.weight, 0) / weightSum,
    dailyMaxTempC:
      weighted.reduce((sum, entry) => sum + (Number(entry.donor.dailyMaxTempC) || 0) * entry.weight, 0) / weightSum,
    heatingDegreeSeverity:
      weighted.reduce((sum, entry) => sum + (Number(entry.donor.heatingDegreeSeverity) || 0) * entry.weight, 0) / weightSum,
    coolingDegreeSeverity:
      weighted.reduce((sum, entry) => sum + (Number(entry.donor.coolingDegreeSeverity) || 0) * entry.weight, 0) / weightSum,
    freezeHoursCount: 0,
  };
  return {
    targetDayKwh,
    fallbackLevel:
      sameRegime.length >= MIN_DAYS_WEATHER_DONOR_SAME_REGIME
        ? "weather_nearest_daytype_regime"
        : "weather_nearest_daytype",
    donorSelectionModeUsed:
      sameRegime.length >= MIN_DAYS_WEATHER_DONOR_SAME_REGIME
        ? "weather_nearest_daytype_regime"
        : "weather_nearest_daytype",
    donorCandidatePoolSize: candidatePool.length,
    selectedDonorLocalDates: picked.map((entry) => entry.donor.localDate),
    donorWeatherRegimeUsed:
      sameRegime.length >= MIN_DAYS_WEATHER_DONOR_SAME_REGIME ? targetRegime : null,
    donorMonthKeyUsed: picked[0]?.donor.monthKey ?? null,
    thermalDistanceScore:
      picked.length > 0
        ? picked.reduce((sum, entry) => sum + entry.distance, 0) / picked.length
        : null,
    broadFallbackUsed: sameRegime.length < MIN_DAYS_WEATHER_DONOR_SAME_REGIME,
    donorWeatherReference,
  };
}

function selectPastDayTotalWithFallback(args: {
  localDate: string;
  monthKey: string;
  isWeekend: boolean;
  profile: PastDayProfileLite;
  weatherForDay: PastDayWeatherFeatures | null;
  modeledDaySelectionStrategy?: PastDaySimulationContext["modeledDaySelectionStrategy"];
  neighborDayTotals?: {
    weekdayByMonth?: Record<string, PastNeighborDaySample[]> | null;
    weekendByMonth?: Record<string, PastNeighborDaySample[]> | null;
  } | null;
  weatherDonorSamples?: PastDaySimulationContext["weatherDonorSamples"];
}): {
  targetDayKwh: number;
  fallbackLevel: PastDayFallbackLevel;
  rawSelectedDayKwh: number;
  clampApplied: boolean;
  donorSelectionModeUsed: string;
  donorCandidatePoolSize: number;
  selectedDonorLocalDates: string[];
  donorWeatherRegimeUsed: PastWeatherRegimeKey | null;
  donorMonthKeyUsed: string | null;
  thermalDistanceScore: number | null;
  broadFallbackUsed: boolean;
  donorWeatherReference: PastDayWeatherFeatures | null;
} {
  const { monthKey, isWeekend, profile, localDate, neighborDayTotals } = args;
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
  let donorSelectionModeUsed = "calendar_fallback";
  let donorCandidatePoolSize = 0;
  let selectedDonorLocalDates: string[] = [];
  let donorWeatherRegimeUsed: PastWeatherRegimeKey | null = null;
  let donorMonthKeyUsed: string | null = null;
  let thermalDistanceScore: number | null = null;
  let broadFallbackUsed = true;
  let donorWeatherReference: PastDayWeatherFeatures | null = null;
  const dom = parseLocalDayOfMonth(localDate);
  const neighborSamples = isWeekend
    ? (neighborDayTotals?.weekendByMonth?.[monthKey] ?? [])
    : (neighborDayTotals?.weekdayByMonth?.[monthKey] ?? []);
  const neighborKwh = weightedNeighborDayKwh({ targetDayOfMonth: dom, samples: neighborSamples });
  const weatherDonorSelection =
    args.modeledDaySelectionStrategy === "weather_donor_first"
      ? selectWeatherSimilarDonor({
          localDate,
          monthKey,
          isWeekend,
          weatherForDay: args.weatherForDay,
          weatherDonorSamples: args.weatherDonorSamples,
        })
      : null;

  if (weatherDonorSelection && Number.isFinite(weatherDonorSelection.targetDayKwh) && weatherDonorSelection.targetDayKwh > 0) {
    rawKwh = weatherDonorSelection.targetDayKwh;
    level = weatherDonorSelection.fallbackLevel;
    donorSelectionModeUsed = weatherDonorSelection.donorSelectionModeUsed;
    donorCandidatePoolSize = weatherDonorSelection.donorCandidatePoolSize;
    selectedDonorLocalDates = weatherDonorSelection.selectedDonorLocalDates;
    donorWeatherRegimeUsed = weatherDonorSelection.donorWeatherRegimeUsed;
    donorMonthKeyUsed = weatherDonorSelection.donorMonthKeyUsed;
    thermalDistanceScore = weatherDonorSelection.thermalDistanceScore;
    broadFallbackUsed = weatherDonorSelection.broadFallbackUsed;
    donorWeatherReference = weatherDonorSelection.donorWeatherReference;
  } else if (neighborKwh != null && Number.isFinite(neighborKwh) && neighborKwh > 0) {
    rawKwh = neighborKwh;
    level = "month_daytype_neighbor";
  } else if (sameDayTypeCount >= MIN_DAYS_MONTH_DAYTYPE && Number.isFinite(dayTypeAvg) && dayTypeAvg > 0) {
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
  return {
    targetDayKwh,
    fallbackLevel: level,
    rawSelectedDayKwh: rawKwh,
    clampApplied,
    donorSelectionModeUsed,
    donorCandidatePoolSize,
    selectedDonorLocalDates,
    donorWeatherRegimeUsed,
    donorMonthKeyUsed,
    thermalDistanceScore,
    broadFallbackUsed,
    donorWeatherReference,
  };
}

function normalizeShape96Safe(shape: unknown): number[] | null {
  if (!Array.isArray(shape) || shape.length !== INTERVALS_PER_DAY) return null;
  const nums = shape.map((v) => Math.max(0, Number(v) || 0));
  const sum = nums.reduce((a, b) => a + b, 0);
  if (!Number.isFinite(sum) || sum <= 0) return null;
  return nums.map((v) => v / sum);
}

function selectShape96(args: {
  monthKey: string;
  dayType: PastDayTypeKey;
  weatherRegime: PastWeatherRegimeKey;
  preferredMonthKeys?: string[] | null;
  shapeVariants?: PastShapeVariants | null;
  legacyByMonth96?: Record<string, number[]> | null;
}): { shape96: number[]; shapeVariantUsed: string; selectedMonthKeyUsed: string | null } {
  const { monthKey, dayType, weatherRegime, preferredMonthKeys, shapeVariants, legacyByMonth96 } = args;
  const dayTypeBucket = dayType === "weekend" ? "weekend" : "weekday";
  const wwWeather = shapeVariants?.weekdayWeekendWeather96?.[dayTypeBucket];
  const wwFlat = shapeVariants?.weekdayWeekend96?.[dayTypeBucket];
  const monthPreference = Array.from(
    new Set([...(preferredMonthKeys ?? []), monthKey].filter((value): value is string => typeof value === "string" && value.length > 0))
  );
  const candidateOrder: Array<{ shape: unknown; variant: string; selectedMonthKeyUsed: string | null }> = [];
  for (const preferredMonthKey of monthPreference) {
    const weatherBuckets = shapeVariants?.byMonthWeatherDayType96?.[preferredMonthKey]?.[dayTypeBucket];
    const monthDayType = shapeVariants?.byMonthDayType96?.[preferredMonthKey]?.[dayTypeBucket];
    const monthFlat = shapeVariants?.byMonth96?.[preferredMonthKey] ?? legacyByMonth96?.[preferredMonthKey];
    candidateOrder.push(
      {
        shape: weatherBuckets?.[weatherRegime],
        variant: `month_${dayType}_weather_${weatherRegime}`,
        selectedMonthKeyUsed: preferredMonthKey,
      },
      {
        shape: monthDayType,
        variant: `month_${dayType}`,
        selectedMonthKeyUsed: preferredMonthKey,
      },
      {
        shape: monthFlat,
        variant: "month",
        selectedMonthKeyUsed: preferredMonthKey,
      }
    );
  }
  candidateOrder.push(
    {
      shape: wwWeather?.[weatherRegime],
      variant: `weekdayweekend_weather_${dayType}_${weatherRegime}`,
      selectedMonthKeyUsed: null,
    },
    {
      shape: wwFlat,
      variant: `weekdayweekend_${dayType}`,
      selectedMonthKeyUsed: null,
    }
  );
  for (const cand of candidateOrder) {
    const normalized = normalizeShape96Safe(cand.shape);
    if (normalized) {
      return {
        shape96: normalized,
        shapeVariantUsed: cand.variant,
        selectedMonthKeyUsed: cand.selectedMonthKeyUsed,
      };
    }
  }
  return {
    shape96: Array.from({ length: INTERVALS_PER_DAY }, () => 1 / INTERVALS_PER_DAY),
    shapeVariantUsed: "uniform_fallback",
    selectedMonthKeyUsed: null,
  };
}

// ----- Weather adjustment (from GapFill Lab) -----
const WEATHER_SEVERITY_THRESHOLD = 2;
/** Heating: scale only when relative deviation > 30% (ratio outside [0.70, 1.30]). */
const HEATING_DEADBAND_PCT = 0.3;
/** Cooling: scale only when relative deviation > 25% (ratio outside [0.75, 1.25]). */
const COOLING_DEADBAND_PCT = 0.25;
/** Event days (aux or pool): heating multiplier range unchanged. */
const HEATING_MULT_MIN = 0.9;
const HEATING_MULT_MAX = 1.35;
const COOLING_MULT_MIN = 0.9;
const COOLING_MULT_MAX = 1.25;
/** Non-event days only: tighter heating multiplier cap. */
const HEATING_MULT_MIN_NON_EVENT = 0.97;
const HEATING_MULT_MAX_NON_EVENT = 1.15;
/** Non-event days only: tighter cooling multiplier cap. */
const COOLING_MULT_MIN_NON_EVENT = 0.97;
const COOLING_MULT_MAX_NON_EVENT = 1.1;
const AUX_HEAT_SLOPE = 0.15;
/**
 * Phase 1 / Section 21: for `weather_scaled_day`, the daily total is primarily
 * `preBlendAdjustedDayKwh` (profile × temperature-response multiplier). A small
 * fraction of the profile anchor remains for stability (not a rigid bucket quota).
 */
export const WEATHER_SCALED_PROFILE_ANCHOR_FRAC = 0.12;

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
  donorWeatherReference?: PastDayWeatherFeatures | null;
  weatherAdjustmentMode?: "legacy_training_stats" | "bounded_post_donor";
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
  preBlendAdjustedDayKwh: number;
  blendedBackTowardProfile: boolean;
  weatherAdjustmentModeUsed: "legacy_training_stats" | "bounded_post_donor";
} {
  const {
    baseDayKwh,
    localDate,
    weatherByDateKey,
    trainingStats,
    donorWeatherReference,
    weatherAdjustmentMode,
    isWeekend,
    homeProfile,
    applianceProfile,
  } = args;
  const wx = weatherByDateKey.get(localDate);
  const monthKey = localDate.slice(0, 7);
  const season = getSeasonBucket(monthKey);
  const bucket = `${monthKey}:${isWeekend ? "we" : "wd"}`;
  const seasonBucket = `${season}:${isWeekend ? "we" : "wd"}`;
  const adjustmentModeUsed =
    weatherAdjustmentMode === "bounded_post_donor" && donorWeatherReference
      ? "bounded_post_donor"
      : "legacy_training_stats";

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
      preBlendAdjustedDayKwh: baseDayKwh,
      blendedBackTowardProfile: false,
      weatherAdjustmentModeUsed: adjustmentModeUsed,
    };
  }

  const refMonth = trainingStats.byMonthDaytype.get(bucket);
  const refSeason = trainingStats.bySeasonDaytype.get(seasonBucket);
  const refGlobal = trainingStats.global;
  const refHdd =
    adjustmentModeUsed === "bounded_post_donor"
      ? donorWeatherReference?.heatingDegreeSeverity ?? 0
      : refMonth?.avgHdd ?? refSeason?.avgHdd ?? (isWeekend ? refGlobal.avgHddWe : refGlobal.avgHddWd);
  const refCdd =
    adjustmentModeUsed === "bounded_post_donor"
      ? donorWeatherReference?.coolingDegreeSeverity ?? 0
      : refMonth?.avgCdd ?? refSeason?.avgCdd ?? (isWeekend ? refGlobal.avgCddWe : refGlobal.avgCddWd);
  const refAvgTempC =
    adjustmentModeUsed === "bounded_post_donor" ? donorWeatherReference?.dailyAvgTempC ?? null : null;
  const refSpreadC =
    adjustmentModeUsed === "bounded_post_donor" ? spreadForWeather(donorWeatherReference ?? null) : null;
  const testHdd = wx.heatingDegreeSeverity;
  const testCdd = wx.coolingDegreeSeverity;

  if (adjustmentModeUsed === "bounded_post_donor") {
    const testSpreadC = spreadForWeather(wx) ?? 0;
    if (testHdd > testCdd && testHdd > WEATHER_SEVERITY_THRESHOLD) {
      weatherModeUsed = "heating";
      const severityDelta = refHdd > 1e-6 ? (testHdd - refHdd) / Math.max(refHdd, 8) : 0;
      const tempDelta = refAvgTempC != null && wx.dailyAvgTempC != null ? (refAvgTempC - wx.dailyAvgTempC) / 18 : 0;
      const spreadDelta = refSpreadC != null ? (testSpreadC - refSpreadC) / 20 : 0;
      weatherSeverityMultiplier = 1 + clampNumber(severityDelta * 0.4 + tempDelta * 0.15 + spreadDelta * 0.05, -0.1, 0.12);
    } else if (testCdd > testHdd && testCdd > WEATHER_SEVERITY_THRESHOLD) {
      weatherModeUsed = "cooling";
      const severityDelta = refCdd > 1e-6 ? (testCdd - refCdd) / Math.max(refCdd, 8) : 0;
      const tempDelta = refAvgTempC != null && wx.dailyAvgTempC != null ? (wx.dailyAvgTempC - refAvgTempC) / 18 : 0;
      const spreadDelta = refSpreadC != null ? (testSpreadC - refSpreadC) / 20 : 0;
      weatherSeverityMultiplier = 1 + clampNumber(severityDelta * 0.35 + tempDelta * 0.15 + spreadDelta * 0.05, -0.08, 0.1);
    } else if (refAvgTempC != null && wx.dailyAvgTempC != null) {
      weatherModeUsed = "neutral";
      weatherSeverityMultiplier = 1 + clampNumber((wx.dailyAvgTempC - refAvgTempC) / 40, -0.03, 0.03);
    }
  } else {
    // Apply deadbands: heating >30% deviation, cooling >25% deviation before scaling
    if (testHdd > testCdd && testHdd > WEATHER_SEVERITY_THRESHOLD) {
      weatherModeUsed = "heating";
      if (refHdd != null && refHdd > 1e-6) {
        const ratio = testHdd / refHdd;
        if (ratio >= 1 - HEATING_DEADBAND_PCT && ratio <= 1 + HEATING_DEADBAND_PCT) {
          weatherSeverityMultiplier = 1;
        } else {
          weatherSeverityMultiplier = ratio;
        }
      }
    } else if (testCdd > testHdd && testCdd > WEATHER_SEVERITY_THRESHOLD) {
      weatherModeUsed = "cooling";
      if (refCdd != null && refCdd > 1e-6) {
        const ratio = testCdd / refCdd;
        if (ratio >= 1 - COOLING_DEADBAND_PCT && ratio <= 1 + COOLING_DEADBAND_PCT) {
          weatherSeverityMultiplier = 1;
        } else {
          weatherSeverityMultiplier = ratio;
        }
      } else {
        weatherSeverityMultiplier = 1;
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

  // Non-event days: tighter multiplier caps. Event days: keep original caps.
  const isEventDay = auxHeatKwhAdder > 0 || poolFreezeProtectKwhAdder > 0;
  if (adjustmentModeUsed === "bounded_post_donor") {
    if (weatherModeUsed === "heating") {
      weatherSeverityMultiplier = clampNumber(weatherSeverityMultiplier, isEventDay ? 0.88 : 0.92, isEventDay ? 1.15 : 1.08);
    } else if (weatherModeUsed === "cooling") {
      weatherSeverityMultiplier = clampNumber(weatherSeverityMultiplier, isEventDay ? 0.9 : 0.94, isEventDay ? 1.12 : 1.08);
    } else {
      weatherSeverityMultiplier = clampNumber(weatherSeverityMultiplier, 0.97, 1.03);
    }
  } else if (weatherModeUsed === "heating") {
    if (isEventDay) {
      weatherSeverityMultiplier = Math.max(HEATING_MULT_MIN, Math.min(HEATING_MULT_MAX, weatherSeverityMultiplier));
    } else {
      weatherSeverityMultiplier = Math.max(
        HEATING_MULT_MIN_NON_EVENT,
        Math.min(HEATING_MULT_MAX_NON_EVENT, weatherSeverityMultiplier)
      );
    }
  } else if (weatherModeUsed === "cooling") {
    if (isEventDay) {
      weatherSeverityMultiplier = Math.max(COOLING_MULT_MIN, Math.min(COOLING_MULT_MAX, weatherSeverityMultiplier));
    } else {
      weatherSeverityMultiplier = Math.max(
        COOLING_MULT_MIN_NON_EVENT,
        Math.min(COOLING_MULT_MAX_NON_EVENT, weatherSeverityMultiplier)
      );
    }
  }

  const preBlendAdjustedDayKwh = baseDayKwh * weatherSeverityMultiplier;
  const fullEventKwh = preBlendAdjustedDayKwh + auxHeatKwhAdder + poolFreezeProtectKwhAdder;

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

  let finalSelectedDayKwh: number;
  let blendedBackTowardProfile = false;
  if (dayClassification === "normal_day") {
    finalSelectedDayKwh = baseDayKwh;
  } else if (
    dayClassification === "extreme_cold_event_day" ||
    dayClassification === "freeze_protect_day"
  ) {
    finalSelectedDayKwh = fullEventKwh;
  } else {
    // weather_scaled_day: temperature-response primary; light profile anchor
    finalSelectedDayKwh =
      baseDayKwh * WEATHER_SCALED_PROFILE_ANCHOR_FRAC +
      preBlendAdjustedDayKwh * (1 - WEATHER_SCALED_PROFILE_ANCHOR_FRAC);
    blendedBackTowardProfile = true;
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
    preBlendAdjustedDayKwh,
    blendedBackTowardProfile,
    weatherAdjustmentModeUsed: adjustmentModeUsed,
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
  neighborDayTotals?: PastDaySimulationContext["neighborDayTotals"];
  weatherDonorSamples?: PastDaySimulationContext["weatherDonorSamples"];
  modeledDaySelectionStrategy?: PastDaySimulationContext["modeledDaySelectionStrategy"];
  shapeVariants?: PastDaySimulationContext["shapeVariants"];
}): PastDaySimulationContext {
  return {
    profile: args.profile,
    trainingWeatherStats: args.trainingWeatherStats,
    weatherByDateKey: args.weatherByDateKey,
    neighborDayTotals: args.neighborDayTotals ?? null,
    weatherDonorSamples: args.weatherDonorSamples ?? null,
    modeledDaySelectionStrategy: args.modeledDaySelectionStrategy ?? "calendar_first",
    shapeVariants: args.shapeVariants ?? null,
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
): SimulatedDayResult {
  const { localDate, isWeekend, gridTimestamps, weatherForDay } = request;
  const monthKey = localDate.slice(0, 7);

  const sel = selectPastDayTotalWithFallback({
    localDate,
    monthKey,
    isWeekend,
    profile: context.profile,
    weatherForDay,
    modeledDaySelectionStrategy: context.modeledDaySelectionStrategy,
    neighborDayTotals: context.neighborDayTotals,
    weatherDonorSamples: context.weatherDonorSamples,
  });

  const weatherByDateKey = new Map<string, PastDayWeatherFeatures>();
  if (weatherForDay) weatherByDateKey.set(localDate, weatherForDay);

  const adj = computeWeatherAdjustedDayTotal({
    baseDayKwh: sel.targetDayKwh,
    localDate,
    weatherByDateKey,
    trainingStats: context.trainingWeatherStats,
    donorWeatherReference: sel.donorWeatherReference,
    weatherAdjustmentMode:
      sel.donorSelectionModeUsed === "calendar_fallback" ? "legacy_training_stats" : "bounded_post_donor",
    isWeekend,
    homeProfile: homeProfile ?? null,
    applianceProfile: applianceProfile ?? null,
  });

  const weatherRegime: PastWeatherRegimeKey =
    adj.weatherModeUsed === "heating" || adj.weatherModeUsed === "cooling" ? adj.weatherModeUsed : "neutral";
  const dayTypeUsed: PastDayTypeKey = isWeekend ? "weekend" : "weekday";
  const selectedShape = selectShape96({
    monthKey,
    dayType: dayTypeUsed,
    weatherRegime,
    preferredMonthKeys: sel.donorMonthKeyUsed ? [sel.donorMonthKeyUsed] : [monthKey],
    shapeVariants: context.shapeVariants,
    legacyByMonth96: shapeByMonth96 ?? null,
  });
  const normShape = selectedShape.shape96;

  const intervals = gridTimestamps.slice(0, INTERVALS_PER_DAY).map((ts, i) => ({
    timestamp: ts,
    kwh: Math.max(0, (adj.finalSelectedDayKwh ?? 0) * (normShape[i] ?? 1 / INTERVALS_PER_DAY)),
  }));
  const intervalSumKwh = intervals.reduce((sum, row) => sum + (Number(row.kwh) || 0), 0);
  const displayDayKwh = roundDayKwhDisplay(intervalSumKwh);
  const weatherAdjustedDayKwh =
    adj.preBlendAdjustedDayKwh ?? (Number(sel.targetDayKwh) || 0) * (Number(adj.weatherSeverityMultiplier) || 0);

  return {
    localDate,
    source: "simulated_vacant_day",
    intervals,
    intervals15: intervals.map((row) => Number(row.kwh) || 0),
    intervalSumKwh,
    displayDayKwh,
    rawDayKwh: sel.targetDayKwh,
    targetDayKwhBeforeWeather: sel.targetDayKwh,
    weatherAdjustedDayKwh,
    profileSelectedDayKwh: sel.targetDayKwh,
    finalDayKwh: adj.finalSelectedDayKwh,
    weatherSeverityMultiplier: adj.weatherSeverityMultiplier,
    weatherModeUsed: adj.weatherModeUsed,
    auxHeatKwhAdder: adj.auxHeatKwhAdder,
    poolFreezeProtectKwhAdder: adj.poolFreezeProtectKwhAdder,
    dayClassification: adj.dayClassification,
    fallbackLevel: sel.fallbackLevel,
    clampApplied: sel.clampApplied,
    dayTypeUsed,
    weatherRegimeUsed: weatherRegime,
    shapeVariantUsed: selectedShape.shapeVariantUsed,
    donorSelectionModeUsed: sel.donorSelectionModeUsed,
    donorCandidatePoolSize: sel.donorCandidatePoolSize,
    selectedDonorLocalDates: sel.selectedDonorLocalDates,
    donorWeatherRegimeUsed: sel.donorWeatherRegimeUsed,
    donorMonthKeyUsed: sel.donorMonthKeyUsed,
    thermalDistanceScore: sel.thermalDistanceScore,
    broadFallbackUsed: sel.broadFallbackUsed,
    weatherAdjustmentModeUsed: adj.weatherAdjustmentModeUsed,
    selectedFingerprintBucketMonth: selectedShape.selectedMonthKeyUsed ?? monthKey,
    shape96Used: normShape,
    auxHeatGate_minTempPassed: adj.auxHeatGate_minTempPassed,
    auxHeatGate_freezeHoursPassed: adj.auxHeatGate_freezeHoursPassed,
    auxHeatGate_severityPassed: adj.auxHeatGate_severityPassed,
    referenceHeatingSeverity: adj.referenceHeatingSeverity,
    preBlendAdjustedDayKwh: adj.preBlendAdjustedDayKwh,
    blendedBackTowardProfile: adj.blendedBackTowardProfile,
  };
}

/**
 * Backward-compatible wrapper for callers still using this function name.
 * Returns the same full canonical simulated-day artifact as simulatePastDay.
 */
export function getPastDayResultOnly(
  localDate: string,
  isWeekend: boolean,
  context: PastDaySimulationContext,
  homeProfile?: PastDayHomeProfile | null,
  applianceProfile?: PastDayApplianceProfile | null,
  weatherForDay?: PastDayWeatherFeatures | null,
  shapeByMonth96?: Record<string, number[]> | null
): SimulatedDayResult {
  const [year, month, day] = localDate.split("-").map((x) => Number(x));
  const dayStartMs = Date.UTC(year, (month || 1) - 1, day || 1, 0, 0, 0, 0);
  const gridTimestamps = Array.from({ length: INTERVALS_PER_DAY }, (_, idx) =>
    new Date(dayStartMs + idx * 15 * 60 * 1000).toISOString()
  );
  return simulatePastDay(
    {
      localDate,
      isWeekend,
      gridTimestamps,
      weatherForDay: weatherForDay ?? null,
    },
    context,
    homeProfile,
    applianceProfile,
    shapeByMonth96
  );
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