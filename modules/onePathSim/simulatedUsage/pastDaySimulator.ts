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
  PastWeatherDonorContribution,
  PastLowDataWeatherEvidenceMonth,
} from "./pastDaySimulatorTypes";
import {
  DEFAULT_SIMULATION_VARIABLE_POLICY,
  type SimulationVariablePolicy,
} from "@/modules/onePathSim/usageSimulator/simulationVariablePolicy";

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
const WEATHER_DONOR_PICK_COUNT = 5;
const NEIGHBOR_DOM_RADIUS = 5;
const GUARDRAIL_MAX_MULT = 1.75;
const GUARDRAIL_MIN_MULT = 0.45;
const DONOR_VARIANCE_CV_TRIGGER = 0.18;
const DONOR_SPREAD_TO_MEDIAN_TRIGGER = 0.38;

function parseLocalDayOfMonth(localDate: string): number | null {
  const dom = Number(String(localDate ?? "").slice(8, 10));
  if (!Number.isFinite(dom) || dom < 1 || dom > 31) return null;
  return dom;
}

function weightedNeighborDayKwh(args: {
  targetDayOfMonth: number | null;
  samples: PastNeighborDaySample[] | undefined;
  policy: SimulationVariablePolicy["pastDayCore"];
}): number | null {
  const dom = args.targetDayOfMonth;
  if (dom == null || !Array.isArray(args.samples) || args.samples.length === 0) return null;
  const scored = args.samples
    .map((s) => {
      const sampleDom = Number(s?.dayOfMonth);
      const dayKwh = Number(s?.dayKwh);
      if (!Number.isFinite(sampleDom) || !Number.isFinite(dayKwh) || dayKwh <= 0) return null;
      const dist = Math.abs(sampleDom - dom);
      if (dist > args.policy.neighborDomRadius) return null;
      const weight = 1 / (1 + dist);
      return { weight, dayKwh };
    })
    .filter((x): x is { weight: number; dayKwh: number } => Boolean(x))
    .sort((a, b) => b.weight - a.weight);
  if (scored.length < args.policy.minDaysNeighborDayType) return null;
  const wSum = scored.reduce((s, r) => s + r.weight, 0);
  if (!Number.isFinite(wSum) || wSum <= 0) return null;
  const kwh = scored.reduce((s, r) => s + r.dayKwh * r.weight, 0) / wSum;
  return Number.isFinite(kwh) && kwh > 0 ? kwh : null;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

type SharedWeatherShapeModifier = {
  applied: boolean;
  weatherShapingMode: "none" | "interval_based_shared_modifier" | "billing_period_compressed_shared_modifier";
  weatherAmplitudeCompressionFactor: number;
  intradayPeakValleyCompressionFactor: number;
  weatherResponsivenessScale: number;
  dailyExtremaConfidence: number;
};

function resolveSharedWeatherShapeModifier(
  derivedInput: PastDaySimulationContext["weatherEfficiencyDerivedInput"],
  weatherModeUsed: "heating" | "cooling" | "neutral",
  policy: SimulationVariablePolicy["weatherShaping"]
): SharedWeatherShapeModifier {
  if (!derivedInput || derivedInput.simulationActive !== true || weatherModeUsed === "neutral") {
    return {
      applied: false,
      weatherShapingMode: "none",
      weatherAmplitudeCompressionFactor: 1,
      intradayPeakValleyCompressionFactor: 1,
      weatherResponsivenessScale: 1,
      dailyExtremaConfidence: 0,
    };
  }
  const confidence = clampNumber((Number(derivedInput.confidenceScore0to100) || 0) / 100, 0.15, 1);
  const loadShare = clampNumber(Number(derivedInput.estimatedWeatherDrivenLoadShare) || 0, 0.05, 0.85);
  const scoreScale = clampNumber((Number(derivedInput.weatherEfficiencyScore0to100) || 0) / 100, 0.05, 1);
  const responseScale = clampNumber(
    ((Math.abs(Number(derivedInput.coolingResponseRatio) || 0) + Math.abs(Number(derivedInput.heatingResponseRatio) || 0)) / 2) || 0,
    0.35,
    1.4
  );
  if (derivedInput.scoringMode === "INTERVAL_BASED") {
    return {
      applied: true,
      weatherShapingMode: "interval_based_shared_modifier",
      weatherAmplitudeCompressionFactor: clampNumber(
        policy.intervalAmplitudeBase +
          confidence * policy.intervalAmplitudeConfidenceWeight +
          (responseScale - 0.35) * policy.intervalAmplitudeResponseWeight,
        policy.intervalAmplitudeBase,
        1
      ),
      intradayPeakValleyCompressionFactor: clampNumber(
        policy.intervalPeakValleyBase + confidence * policy.intervalPeakValleyConfidenceWeight,
        policy.intervalPeakValleyBase,
        1
      ),
      weatherResponsivenessScale: clampNumber(
        policy.intervalResponsivenessBase +
          loadShare * policy.intervalResponsivenessLoadShareWeight +
          scoreScale * policy.intervalResponsivenessScoreWeight,
        policy.intervalResponsivenessBase,
        1.05
      ),
      dailyExtremaConfidence: clampNumber(
        policy.intervalDailyExtremaBase + confidence * policy.intervalDailyExtremaConfidenceWeight,
        policy.intervalDailyExtremaBase,
        1
      ),
    };
  }
  return {
    applied: true,
    weatherShapingMode: "billing_period_compressed_shared_modifier",
    weatherAmplitudeCompressionFactor: clampNumber(
      policy.billingAmplitudeBase +
        confidence * policy.billingAmplitudeConfidenceWeight +
        loadShare * policy.billingAmplitudeLoadShareWeight +
        scoreScale * policy.billingAmplitudeScoreWeight,
      policy.billingAmplitudeBase,
      0.78
    ),
    intradayPeakValleyCompressionFactor: clampNumber(
      policy.billingPeakValleyBase +
        confidence * policy.billingPeakValleyConfidenceWeight +
        loadShare * policy.billingPeakValleyLoadShareWeight,
      policy.billingPeakValleyBase,
      0.82
    ),
    weatherResponsivenessScale: clampNumber(
      policy.billingResponsivenessBase +
        loadShare * policy.billingResponsivenessLoadShareWeight +
        confidence * policy.billingResponsivenessConfidenceWeight +
        scoreScale * policy.billingResponsivenessScoreWeight,
      policy.billingResponsivenessBase,
      0.78
    ),
    dailyExtremaConfidence: clampNumber(
      policy.billingDailyExtremaBase + confidence * policy.billingDailyExtremaConfidenceWeight,
      policy.billingDailyExtremaBase,
      0.7
    ),
  };
}

function applySharedWeatherAdjustedDayTotal(args: {
  baseDayKwh: number;
  adjustedDayKwh: number;
  modifier: SharedWeatherShapeModifier;
}): number {
  if (!args.modifier.applied) return args.adjustedDayKwh;
  const delta = args.adjustedDayKwh - args.baseDayKwh;
  return args.baseDayKwh + delta * args.modifier.weatherAmplitudeCompressionFactor * args.modifier.weatherResponsivenessScale;
}

function normalizeShape96Weights(shape: number[]): number[] {
  const nonNegative = shape.map((value) => Math.max(0, Number(value) || 0));
  const sum = nonNegative.reduce((acc, value) => acc + value, 0);
  if (!Number.isFinite(sum) || sum <= 0) return Array.from({ length: INTERVALS_PER_DAY }, () => 1 / INTERVALS_PER_DAY);
  return nonNegative.map((value) => value / sum);
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

function weatherRegimeFromWeather(
  wx: PastDayWeatherFeatures | null | undefined,
  policy: SimulationVariablePolicy["pastDayCore"]
): PastWeatherRegimeKey {
  const heating = Math.max(0, Number(wx?.heatingDegreeSeverity) || 0);
  const cooling = Math.max(0, Number(wx?.coolingDegreeSeverity) || 0);
  if (heating > cooling && heating > policy.weatherSeverityThreshold) return "heating";
  if (cooling > heating && cooling > policy.weatherSeverityThreshold) return "cooling";
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

function medianOfNumbers(values: number[]): number | null {
  const finite = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (finite.length === 0) return null;
  const mid = Math.floor(finite.length / 2);
  return finite.length % 2 === 1 ? finite[mid]! : (finite[mid - 1]! + finite[mid]!) / 2;
}

function varianceOfNumbers(values: number[]): number | null {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length === 0) return null;
  const mean = finite.reduce((sum, value) => sum + value, 0) / finite.length;
  return finite.reduce((sum, value) => sum + (value - mean) ** 2, 0) / finite.length;
}

function weatherDistanceScore(args: {
  target: PastDayWeatherFeatures;
  donor: PastWeatherDonorSample;
  targetMonthKey: string;
  targetDayOfMonth: number | null;
  targetRegime: PastWeatherRegimeKey;
  policy: SimulationVariablePolicy["pastDayCore"];
}): number {
  const targetSpread = spreadForWeather(args.target) ?? 0;
  const donorSpread = Number(args.donor.tempSpreadC);
  const donorDayOfMonth = parseLocalDayOfMonth(args.donor.localDate);
  const heatingDiff = Math.abs((Number(args.donor.heatingDegreeSeverity) || 0) - (Number(args.target.heatingDegreeSeverity) || 0));
  const coolingDiff = Math.abs((Number(args.donor.coolingDegreeSeverity) || 0) - (Number(args.target.coolingDegreeSeverity) || 0));
  const avgDiff = Math.abs((Number(args.donor.dailyAvgTempC) || 0) - (Number(args.target.dailyAvgTempC) || 0));
  const maxDiff = Math.abs((Number(args.donor.dailyMaxTempC) || 0) - (Number(args.target.dailyMaxTempC) || 0));
  const minDiff = Math.abs((Number(args.donor.dailyMinTempC) || 0) - (Number(args.target.dailyMinTempC) || 0));
  const spreadDiff = Math.abs((Number.isFinite(donorSpread) ? donorSpread : 0) - targetSpread);
  const monthDiff = monthDistance(args.targetMonthKey, args.donor.monthKey);
  const domDiff = Math.abs((donorDayOfMonth ?? 15) - (args.targetDayOfMonth ?? 15));

  if (args.targetRegime === "heating") {
    return (
      heatingDiff * args.policy.heatingDistanceHeatingDiffWeight +
      minDiff * args.policy.heatingDistanceMinTempWeight +
      avgDiff * args.policy.heatingDistanceAvgTempWeight +
      maxDiff * args.policy.heatingDistanceMaxTempWeight +
      spreadDiff * args.policy.heatingDistanceSpreadWeight +
      monthDiff * args.policy.heatingDistanceMonthWeight +
      domDiff * args.policy.heatingDistanceDayOfMonthWeight
    );
  }
  if (args.targetRegime === "cooling") {
    return (
      coolingDiff * args.policy.coolingDistanceCoolingDiffWeight +
      avgDiff * args.policy.coolingDistanceAvgTempWeight +
      maxDiff * args.policy.coolingDistanceMaxTempWeight +
      minDiff * args.policy.coolingDistanceMinTempWeight +
      spreadDiff * args.policy.coolingDistanceSpreadWeight +
      monthDiff * args.policy.coolingDistanceMonthWeight +
      domDiff * args.policy.coolingDistanceDayOfMonthWeight
    );
  }
  return (
    avgDiff * args.policy.neutralDistanceAvgTempWeight +
    spreadDiff * args.policy.neutralDistanceSpreadWeight +
    maxDiff * args.policy.neutralDistanceMaxTempWeight +
    minDiff * args.policy.neutralDistanceMinTempWeight +
    heatingDiff * args.policy.neutralDistanceHeatingWeight +
    coolingDiff * args.policy.neutralDistanceCoolingWeight +
    monthDiff * args.policy.neutralDistanceMonthWeight +
    domDiff * args.policy.neutralDistanceDayOfMonthWeight
  );
}

function selectWeatherSimilarDonor(args: {
  localDate: string;
  monthKey: string;
  isWeekend: boolean;
  weatherForDay: PastDayWeatherFeatures | null;
  weatherDonorSamples?: PastWeatherDonorSample[] | null;
  policy: SimulationVariablePolicy["pastDayCore"];
}):
  | {
      targetDayKwh: number;
      fallbackLevel: PastDayFallbackLevel;
      donorSelectionModeUsed: string;
      donorCandidatePoolSize: number;
      selectedDonorLocalDates: string[];
      selectedDonorWeights: PastWeatherDonorContribution[];
      donorWeatherRegimeUsed: PastWeatherRegimeKey | null;
      donorMonthKeyUsed: string | null;
      thermalDistanceScore: number | null;
      broadFallbackUsed: boolean;
      sameRegimeDonorPoolAvailable: boolean;
      donorPoolBlendStrategy: "distance_weighted_blend" | "variance_dampened_blend";
      donorPoolKwhSpread: number | null;
      donorPoolKwhVariance: number | null;
      donorPoolMedianKwh: number | null;
      donorVarianceGuardrailTriggered: boolean;
      donorWeatherReference: PastDayWeatherFeatures | null;
    }
  | null {
  const weatherForDay = args.weatherForDay;
  if (!weatherForDay || !Array.isArray(args.weatherDonorSamples) || args.weatherDonorSamples.length === 0) return null;
  const dayType = dayTypeKeyFromWeekend(args.isWeekend);
  const targetRegime = weatherRegimeFromWeather(weatherForDay, args.policy);
  const targetDayOfMonth = parseLocalDayOfMonth(args.localDate);
  const sameDayType = args.weatherDonorSamples.filter(
    (sample) => sample.dayType === dayType && Number(sample.dayKwh) > 0
  );
  if (sameDayType.length < args.policy.minDaysWeatherDonorSameDayType) return null;
  const sameRegime = sameDayType.filter((sample) => sample.weatherRegime === targetRegime);
  const candidatePool =
    sameRegime.length >= args.policy.minDaysWeatherDonorSameRegime
      ? sameRegime
      : sameDayType;
  const sameRegimeDonorPoolAvailable = sameRegime.length >= args.policy.minDaysWeatherDonorSameRegime;
  if (candidatePool.length < args.policy.minDaysWeatherDonorSameDayType) return null;

  const scored = candidatePool
    .map((donor) => ({
      donor,
      distance: weatherDistanceScore({
        target: weatherForDay,
        donor,
        targetMonthKey: args.monthKey,
        targetDayOfMonth,
        targetRegime,
          policy: args.policy,
      }),
    }))
    .sort((a, b) => a.distance - b.distance || a.donor.localDate.localeCompare(b.donor.localDate));
  if (scored.length === 0) return null;
  const picked = scored.slice(0, Math.min(args.policy.weatherDonorPickCount, scored.length));
  const weightedBase = picked.map((entry) => ({
    ...entry,
    weight: 1 / Math.pow(args.policy.weatherDonorDistanceWeightBase + Math.max(0, entry.distance), 2),
  }));
  const donorDayKwhs = picked.map((entry) => Number(entry.donor.dayKwh) || 0).filter((value) => value > 0);
  const donorPoolMedianKwh = medianOfNumbers(donorDayKwhs);
  const donorPoolKwhVariance = varianceOfNumbers(donorDayKwhs);
  const donorPoolKwhSpread = donorDayKwhs.length > 0 ? Math.max(...donorDayKwhs) - Math.min(...donorDayKwhs) : null;
  const donorStdDev = donorPoolKwhVariance != null ? Math.sqrt(donorPoolKwhVariance) : null;
  const donorCv =
    donorStdDev != null && donorPoolMedianKwh != null && donorPoolMedianKwh > 1e-6
      ? donorStdDev / donorPoolMedianKwh
      : 0;
  const donorSpreadRatio =
    donorPoolKwhSpread != null && donorPoolMedianKwh != null && donorPoolMedianKwh > 1e-6
      ? donorPoolKwhSpread / donorPoolMedianKwh
      : 0;
  const donorVarianceGuardrailTriggered =
    picked.length >= 3 &&
    (donorCv > args.policy.donorVarianceCvTrigger || donorSpreadRatio > args.policy.donorSpreadToMedianTrigger);
  const weighted = weightedBase.map((entry) => ({
    ...entry,
    adjustedDayKwh:
      donorVarianceGuardrailTriggered && donorPoolMedianKwh != null
        ? (Number(entry.donor.dayKwh) || 0) * args.policy.weatherDonorVarianceBlendWeight +
          donorPoolMedianKwh * args.policy.weatherDonorMedianBlendWeight
        : Number(entry.donor.dayKwh) || 0,
  }));
  const weightSum = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  if (!Number.isFinite(weightSum) || weightSum <= 0) return null;
  const targetDayKwh =
    weighted.reduce((sum, entry) => sum + entry.adjustedDayKwh * entry.weight, 0) / weightSum;
  const selectedDonorWeights: PastWeatherDonorContribution[] = weighted.map((entry) => ({
    localDate: entry.donor.localDate,
    monthKey: entry.donor.monthKey,
    weatherRegime: entry.donor.weatherRegime,
    dayKwh: Number(entry.donor.dayKwh) || 0,
    distance: entry.distance,
    weight: entry.weight / weightSum,
  }));
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
      sameRegimeDonorPoolAvailable
        ? "weather_nearest_daytype_regime"
        : "weather_nearest_daytype",
    donorSelectionModeUsed:
      sameRegimeDonorPoolAvailable
        ? "weather_nearest_daytype_regime"
        : "weather_nearest_daytype",
    donorCandidatePoolSize: candidatePool.length,
    selectedDonorLocalDates: picked.map((entry) => entry.donor.localDate),
    selectedDonorWeights,
    donorWeatherRegimeUsed:
      sameRegimeDonorPoolAvailable ? targetRegime : null,
    donorMonthKeyUsed: picked[0]?.donor.monthKey ?? null,
    thermalDistanceScore:
      picked.length > 0
        ? selectedDonorWeights.reduce((sum, entry) => sum + entry.distance * entry.weight, 0)
        : null,
    broadFallbackUsed: false,
    sameRegimeDonorPoolAvailable,
    donorPoolBlendStrategy: donorVarianceGuardrailTriggered ? "variance_dampened_blend" : "distance_weighted_blend",
    donorPoolKwhSpread,
    donorPoolKwhVariance,
    donorPoolMedianKwh,
    donorVarianceGuardrailTriggered,
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
  policy: SimulationVariablePolicy["pastDayCore"];
}): {
  targetDayKwh: number;
  fallbackLevel: PastDayFallbackLevel;
  rawSelectedDayKwh: number;
  clampApplied: boolean;
  donorSelectionModeUsed: string;
  donorCandidatePoolSize: number;
  selectedDonorLocalDates: string[];
  selectedDonorWeights: PastWeatherDonorContribution[];
  donorWeatherRegimeUsed: PastWeatherRegimeKey | null;
  donorMonthKeyUsed: string | null;
  thermalDistanceScore: number | null;
  broadFallbackUsed: boolean;
  sameRegimeDonorPoolAvailable: boolean;
  donorPoolBlendStrategy: "distance_weighted_blend" | "variance_dampened_blend" | null;
  donorPoolKwhSpread: number | null;
  donorPoolKwhVariance: number | null;
  donorPoolMedianKwh: number | null;
  donorVarianceGuardrailTriggered: boolean;
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
  let selectedDonorWeights: PastWeatherDonorContribution[] = [];
  let donorWeatherRegimeUsed: PastWeatherRegimeKey | null = null;
  let donorMonthKeyUsed: string | null = null;
  let thermalDistanceScore: number | null = null;
  let broadFallbackUsed = true;
  let sameRegimeDonorPoolAvailable = false;
  let donorPoolBlendStrategy: "distance_weighted_blend" | "variance_dampened_blend" | null = null;
  let donorPoolKwhSpread: number | null = null;
  let donorPoolKwhVariance: number | null = null;
  let donorPoolMedianKwh: number | null = null;
  let donorVarianceGuardrailTriggered = false;
  let donorWeatherReference: PastDayWeatherFeatures | null = null;
  const dom = parseLocalDayOfMonth(localDate);
  const neighborSamples = isWeekend
    ? (neighborDayTotals?.weekendByMonth?.[monthKey] ?? [])
    : (neighborDayTotals?.weekdayByMonth?.[monthKey] ?? []);
  const neighborKwh = weightedNeighborDayKwh({ targetDayOfMonth: dom, samples: neighborSamples, policy: args.policy });
  const weatherDonorSelection =
    args.modeledDaySelectionStrategy === "weather_donor_first"
      ? selectWeatherSimilarDonor({
          localDate,
          monthKey,
          isWeekend,
          weatherForDay: args.weatherForDay,
          weatherDonorSamples: args.weatherDonorSamples,
          policy: args.policy,
        })
      : null;

  if (weatherDonorSelection && Number.isFinite(weatherDonorSelection.targetDayKwh) && weatherDonorSelection.targetDayKwh > 0) {
    rawKwh = weatherDonorSelection.targetDayKwh;
    level = weatherDonorSelection.fallbackLevel;
    donorSelectionModeUsed = weatherDonorSelection.donorSelectionModeUsed;
    donorCandidatePoolSize = weatherDonorSelection.donorCandidatePoolSize;
    selectedDonorLocalDates = weatherDonorSelection.selectedDonorLocalDates;
    selectedDonorWeights = weatherDonorSelection.selectedDonorWeights;
    donorWeatherRegimeUsed = weatherDonorSelection.donorWeatherRegimeUsed;
    donorMonthKeyUsed = weatherDonorSelection.donorMonthKeyUsed;
    thermalDistanceScore = weatherDonorSelection.thermalDistanceScore;
    broadFallbackUsed = weatherDonorSelection.broadFallbackUsed;
    sameRegimeDonorPoolAvailable = weatherDonorSelection.sameRegimeDonorPoolAvailable;
    donorPoolBlendStrategy = weatherDonorSelection.donorPoolBlendStrategy;
    donorPoolKwhSpread = weatherDonorSelection.donorPoolKwhSpread;
    donorPoolKwhVariance = weatherDonorSelection.donorPoolKwhVariance;
    donorPoolMedianKwh = weatherDonorSelection.donorPoolMedianKwh;
    donorVarianceGuardrailTriggered = weatherDonorSelection.donorVarianceGuardrailTriggered;
    donorWeatherReference = weatherDonorSelection.donorWeatherReference;
  } else if (neighborKwh != null && Number.isFinite(neighborKwh) && neighborKwh > 0) {
    rawKwh = neighborKwh;
    level = "month_daytype_neighbor";
  } else if (sameDayTypeCount >= args.policy.minDaysMonthDayType && Number.isFinite(dayTypeAvg) && dayTypeAvg > 0) {
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
    if (adjCount >= args.policy.minDaysAdjacent && (Number.isFinite(prevAvg) || Number.isFinite(nextAvg))) {
      const total = prevDayTypeCount + nextDayTypeCount;
      rawKwh =
        total > 0 ? ((prevAvg ?? 0) * prevDayTypeCount + (nextAvg ?? 0) * nextDayTypeCount) / total : globalAvgDayType;
      level = "adjacent_month_daytype";
    } else if ((monthOverallCountByMonth[monthKey] ?? 0) >= args.policy.minDaysMonthOverall) {
      rawKwh = monthOverallAvgByMonth[monthKey] ?? globalOverallAvg;
      level = "month_overall";
    } else {
      const seasonKeys = getSeasonMonthKeys(monthKey, monthKeys);
      const seasonCount = seasonKeys.reduce(
        (s, k) => s + (weekdayCountByMonth[k] ?? 0) + (weekendCountByMonth[k] ?? 0),
        0
      );
      if (seasonCount >= args.policy.minDaysSeason) {
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
      } else if (globalCountDayType >= args.policy.minDaysGlobalDayType) {
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
    if (rawKwh > globalAvgDayType * args.policy.guardrailMaxMult) {
      targetDayKwh = globalAvgDayType * args.policy.guardrailMaxMult;
      clampApplied = true;
    } else if (rawKwh < globalAvgDayType * args.policy.guardrailMinMult) {
      targetDayKwh = globalAvgDayType * args.policy.guardrailMinMult;
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
    selectedDonorWeights,
    donorWeatherRegimeUsed,
    donorMonthKeyUsed,
    thermalDistanceScore,
    broadFallbackUsed,
    sameRegimeDonorPoolAvailable,
    donorPoolBlendStrategy,
    donorPoolKwhSpread,
    donorPoolKwhVariance,
    donorPoolMedianKwh,
    donorVarianceGuardrailTriggered,
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

function computeLowDataWeatherAdjustedDayTotal(args: {
  baseDayKwh: number;
  weatherForDay: PastDayWeatherFeatures | null;
  monthEvidence: PastLowDataWeatherEvidenceMonth | null;
  weatherEfficiencyDerivedInput?: PastDaySimulationContext["weatherEfficiencyDerivedInput"];
  simulationVariablePolicy?: SimulationVariablePolicy | null;
}): {
  finalSelectedDayKwh: number;
  weatherSeverityMultiplier: number;
  weatherModeUsed: "heating" | "cooling" | "neutral";
  dayClassification: PastDayWeatherClassification;
  preBlendAdjustedDayKwh: number;
  weatherAdjustmentModeUsed: "manual_monthly_weather_evidence";
  postDonorAdjustmentCoefficient: number | null;
  weatherEfficiencyApplied: boolean;
  weatherShapingMode: SharedWeatherShapeModifier["weatherShapingMode"];
  weatherAmplitudeCompressionFactor: number;
  intradayPeakValleyCompressionFactor: number;
  dailyExtremaConfidence: number;
} {
  const baseDayKwh = Math.max(0, Number(args.baseDayKwh) || 0);
  const wx = args.weatherForDay;
  const evidence = args.monthEvidence;
  if (!wx || !evidence || baseDayKwh <= 0) {
    return {
      finalSelectedDayKwh: baseDayKwh,
      weatherSeverityMultiplier: 1,
      weatherModeUsed: "neutral",
      dayClassification: "normal_day",
      preBlendAdjustedDayKwh: baseDayKwh,
      weatherAdjustmentModeUsed: "manual_monthly_weather_evidence",
      postDonorAdjustmentCoefficient: 1,
      weatherEfficiencyApplied: false,
      weatherShapingMode: "none",
      weatherAmplitudeCompressionFactor: 1,
      intradayPeakValleyCompressionFactor: 1,
      dailyExtremaConfidence: 0,
    };
  }

  const lowDataPolicy = args.simulationVariablePolicy?.lowDataWeatherEvidence ?? DEFAULT_SIMULATION_VARIABLE_POLICY.lowDataWeatherEvidence;
  const weatherShapingPolicy = args.simulationVariablePolicy?.weatherShaping ?? DEFAULT_SIMULATION_VARIABLE_POLICY.weatherShaping;
  const pastDayPolicy = args.simulationVariablePolicy?.pastDayCore ?? DEFAULT_SIMULATION_VARIABLE_POLICY.pastDayCore;
  const baseloadShare = clampNumber(Number(evidence.baseloadShare) || 0, lowDataPolicy.lowDataDayBaseloadShareMin, lowDataPolicy.lowDataDayBaseloadShareMax);
  const hvacShare = clampNumber(Number(evidence.hvacShare) || 0, lowDataPolicy.lowDataDayHvacShareMin, lowDataPolicy.lowDataDayHvacShareMax);
  const heatingSensitivity = clampNumber(Number(evidence.heatingSensitivity) || 0, lowDataPolicy.lowDataDaySensitivityMin, lowDataPolicy.lowDataDaySensitivityMax);
  const coolingSensitivity = clampNumber(Number(evidence.coolingSensitivity) || 0, lowDataPolicy.lowDataDaySensitivityMin, lowDataPolicy.lowDataDaySensitivityMax);
  const referenceDailyHdd = Math.max(0, Number(evidence.referenceDailyHdd) || 0);
  const referenceDailyCdd = Math.max(0, Number(evidence.referenceDailyCdd) || 0);

  const heatingDelta = (Math.max(0, Number(wx.heatingDegreeSeverity) || 0) - referenceDailyHdd) / Math.max(referenceDailyHdd, 6);
  const coolingDelta = (Math.max(0, Number(wx.coolingDegreeSeverity) || 0) - referenceDailyCdd) / Math.max(referenceDailyCdd, 6);
  const heatingResponse = heatingDelta * heatingSensitivity;
  const coolingResponse = coolingDelta * coolingSensitivity;
  const hvacMultiplier = clampNumber(1 + heatingResponse + coolingResponse, 0.3, 2.25);
  const baseloadKwh = baseDayKwh * baseloadShare;
  const hvacResponsiveKwh = Math.max(0, baseDayKwh - baseloadKwh) * hvacMultiplier;
  const preBlendAdjustedDayKwh = baseloadKwh + hvacResponsiveKwh;

  const weatherModeUsed: "heating" | "cooling" | "neutral" =
    Math.max(0, Number(wx.heatingDegreeSeverity) || 0) > Math.max(referenceDailyHdd + 1, Number(wx.coolingDegreeSeverity) || 0)
      ? "heating"
      : Math.max(0, Number(wx.coolingDegreeSeverity) || 0) > Math.max(referenceDailyCdd + 1, Number(wx.heatingDegreeSeverity) || 0)
        ? "cooling"
        : "neutral";
  const dayClassification: PastDayWeatherClassification =
    Math.abs((baseDayKwh > 1e-6 ? preBlendAdjustedDayKwh / baseDayKwh : 1) - 1) >= lowDataPolicy.lowDataScaledDayThreshold ? "weather_scaled_day" : "normal_day";
  const modifier = resolveSharedWeatherShapeModifier(args.weatherEfficiencyDerivedInput ?? null, weatherModeUsed, weatherShapingPolicy);
  const adjustedForDerivedInput = applySharedWeatherAdjustedDayTotal({
    baseDayKwh,
    adjustedDayKwh: preBlendAdjustedDayKwh,
    modifier,
  });
  const weatherSeverityMultiplier = baseDayKwh > 1e-6 ? adjustedForDerivedInput / baseDayKwh : 1;
  const finalSelectedDayKwh =
    dayClassification === "weather_scaled_day"
      ? baseDayKwh * pastDayPolicy.weatherScaledProfileAnchorFrac + adjustedForDerivedInput * (1 - pastDayPolicy.weatherScaledProfileAnchorFrac)
      : baseDayKwh;

  return {
    finalSelectedDayKwh: Math.max(0, finalSelectedDayKwh),
    weatherSeverityMultiplier,
    weatherModeUsed,
    dayClassification,
    preBlendAdjustedDayKwh: adjustedForDerivedInput,
    weatherAdjustmentModeUsed: "manual_monthly_weather_evidence",
    postDonorAdjustmentCoefficient: weatherSeverityMultiplier,
    weatherEfficiencyApplied: modifier.applied,
    weatherShapingMode: modifier.weatherShapingMode,
    weatherAmplitudeCompressionFactor: modifier.weatherAmplitudeCompressionFactor,
    intradayPeakValleyCompressionFactor: modifier.intradayPeakValleyCompressionFactor,
    dailyExtremaConfidence: modifier.dailyExtremaConfidence,
  };
}

function applyLowDataShapeWeatherAmplitude(args: {
  shape96: number[];
  weatherRegime: PastWeatherRegimeKey;
  weatherSeverityMultiplier: number;
  monthEvidence: PastLowDataWeatherEvidenceMonth | null;
  weatherEfficiencyDerivedInput?: PastDaySimulationContext["weatherEfficiencyDerivedInput"];
  simulationVariablePolicy?: SimulationVariablePolicy | null;
}): number[] {
  const normalized = normalizeShape96Weights(args.shape96);
  if (args.weatherRegime === "neutral" || !args.monthEvidence) return normalized;
  const lowDataPolicy = args.simulationVariablePolicy?.lowDataWeatherEvidence ?? DEFAULT_SIMULATION_VARIABLE_POLICY.lowDataWeatherEvidence;
  const weatherShapingPolicy = args.simulationVariablePolicy?.weatherShaping ?? DEFAULT_SIMULATION_VARIABLE_POLICY.weatherShaping;
  const hvacShare = clampNumber(Number(args.monthEvidence.hvacShare) || 0, lowDataPolicy.lowDataDayHvacShareMin, lowDataPolicy.lowDataDayHvacShareMax);
  const baseloadShare = clampNumber(Number(args.monthEvidence.baseloadShare) || 0, lowDataPolicy.lowDataDayBaseloadShareMin, lowDataPolicy.lowDataDayBaseloadShareMax);
  const deviation = Math.abs((Number(args.weatherSeverityMultiplier) || 1) - 1);
  if (deviation < 0.02) return normalized;
  const modifier = resolveSharedWeatherShapeModifier(args.weatherEfficiencyDerivedInput ?? null, args.weatherRegime, weatherShapingPolicy);

  const flat = 1 / INTERVALS_PER_DAY;
  const effectiveDeviation = deviation * modifier.weatherAmplitudeCompressionFactor * modifier.weatherResponsivenessScale;
  const amplitudeMultiplier =
    1 +
    effectiveDeviation *
      (weatherShapingPolicy.shapeAmplitudeBase + hvacShare * weatherShapingPolicy.shapeAmplitudeHvacShareWeight);
  const flattenBlend = clampNumber(
    baseloadShare * weatherShapingPolicy.shapeAmplitudeBase +
      (1 - modifier.intradayPeakValleyCompressionFactor) * weatherShapingPolicy.shapeFlattenBlendWeight,
    0,
    0.5
  );
  const adjusted = normalized.map((value) => {
    const amplified = flat + (value - flat) * amplitudeMultiplier;
    return flat * flattenBlend + amplified * (1 - flattenBlend);
  });
  return normalizeShape96Weights(adjusted);
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
  weatherEfficiencyDerivedInput?: PastDaySimulationContext["weatherEfficiencyDerivedInput"];
  simulationVariablePolicy?: SimulationVariablePolicy | null;
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
  postDonorAdjustmentCoefficient: number | null;
  weatherEfficiencyApplied: boolean;
  weatherShapingMode: SharedWeatherShapeModifier["weatherShapingMode"];
  weatherAmplitudeCompressionFactor: number;
  intradayPeakValleyCompressionFactor: number;
  dailyExtremaConfidence: number;
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
    weatherEfficiencyDerivedInput,
    simulationVariablePolicy,
  } = args;
  const pastDayPolicy = simulationVariablePolicy?.pastDayCore ?? DEFAULT_SIMULATION_VARIABLE_POLICY.pastDayCore;
  const weatherShapingPolicy = simulationVariablePolicy?.weatherShaping ?? DEFAULT_SIMULATION_VARIABLE_POLICY.weatherShaping;
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
      postDonorAdjustmentCoefficient: 1,
      weatherEfficiencyApplied: false,
      weatherShapingMode: "none",
      weatherAmplitudeCompressionFactor: 1,
      intradayPeakValleyCompressionFactor: 1,
      dailyExtremaConfidence: 0,
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
    if (testHdd > testCdd && testHdd > pastDayPolicy.weatherSeverityThreshold) {
      weatherModeUsed = "heating";
      const severityDelta = refHdd > 1e-6 ? (testHdd - refHdd) / Math.max(refHdd, 8) : 0;
      const tempDelta = refAvgTempC != null && wx.dailyAvgTempC != null ? (refAvgTempC - wx.dailyAvgTempC) / 22 : 0;
      const minTempDelta =
        donorWeatherReference?.dailyMinTempC != null && wx.dailyMinTempC != null
          ? (donorWeatherReference.dailyMinTempC - wx.dailyMinTempC) / 14
          : 0;
      const maxTempDelta =
        donorWeatherReference?.dailyMaxTempC != null && wx.dailyMaxTempC != null
          ? (donorWeatherReference.dailyMaxTempC - wx.dailyMaxTempC) / 24
          : 0;
      const spreadDelta = refSpreadC != null ? (testSpreadC - refSpreadC) / 20 : 0;
      weatherSeverityMultiplier =
        1 + clampNumber(severityDelta * 0.52 + minTempDelta * 0.22 + tempDelta * 0.1 + maxTempDelta * 0.04 + spreadDelta * 0.04, -0.11, 0.15);
    } else if (testCdd > testHdd && testCdd > pastDayPolicy.weatherSeverityThreshold) {
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
    if (testHdd > testCdd && testHdd > pastDayPolicy.weatherSeverityThreshold) {
      weatherModeUsed = "heating";
      if (refHdd != null && refHdd > 1e-6) {
        const ratio = testHdd / refHdd;
        if (ratio >= 1 - pastDayPolicy.heatingDeadbandPct && ratio <= 1 + pastDayPolicy.heatingDeadbandPct) {
          weatherSeverityMultiplier = 1;
        } else {
          weatherSeverityMultiplier = ratio;
        }
      }
    } else if (testCdd > testHdd && testCdd > pastDayPolicy.weatherSeverityThreshold) {
      weatherModeUsed = "cooling";
      if (refCdd != null && refCdd > 1e-6) {
        const ratio = testCdd / refCdd;
        if (ratio >= 1 - pastDayPolicy.coolingDeadbandPct && ratio <= 1 + pastDayPolicy.coolingDeadbandPct) {
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
  const auxHeatGate_minTempPassed = wx.dailyMinTempC != null && wx.dailyMinTempC <= pastDayPolicy.auxMinTempC;
  const auxHeatGate_freezeHoursPassed = wx.freezeHoursCount >= pastDayPolicy.auxFreezeHoursMin;
  const auxHeatGate_severityPassed =
    referenceHeatingSeverity > 1e-6 &&
    wx.heatingDegreeSeverity >= referenceHeatingSeverity * pastDayPolicy.auxHddRatio;
  const allAuxGatesPassed =
    isElectricHeat &&
    auxHeatGate_minTempPassed &&
    auxHeatGate_freezeHoursPassed &&
    auxHeatGate_severityPassed;
  if (allAuxGatesPassed) {
    const ref = Math.max(referenceHeatingSeverity, 1);
    auxHeatKwhAdder = Math.max(
      0,
      Math.min(pastDayPolicy.auxHeatKwhCap, (wx.heatingDegreeSeverity - ref) * pastDayPolicy.auxHeatSlope)
    );
  }

  const hasPool =
    Boolean(homeProfile?.pool?.hasPool) ||
    (applianceProfile?.appliances ?? []).some((a) => a?.type === "pool");
  const pumpHp =
    homeProfile?.pool?.pumpHp ??
    (applianceProfile?.appliances ?? []).find((a) => a?.type === "pool")?.data?.pump_hp;
  const freezeHoursOk = wx.freezeHoursCount >= pastDayPolicy.poolFreezeHoursMin;
  const dailyMinOkForPool = wx.dailyMinTempC != null && wx.dailyMinTempC <= pastDayPolicy.poolFreezeMinTempC;
  if (hasPool && freezeHoursOk && dailyMinOkForPool) {
    const hp = pumpHp != null && Number.isFinite(Number(pumpHp)) ? Number(pumpHp) : 1;
    poolFreezeProtectKwhAdder = Math.max(
      0,
      Math.min(
        pastDayPolicy.poolFreezeKwhCap,
        hp * pastDayPolicy.poolFreezeHpFactor * Math.max(1, wx.freezeHoursCount / 4)
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
      weatherSeverityMultiplier = Math.max(pastDayPolicy.heatingMultMin, Math.min(pastDayPolicy.heatingMultMax, weatherSeverityMultiplier));
    } else {
      weatherSeverityMultiplier = Math.max(
        pastDayPolicy.heatingMultMinNonEvent,
        Math.min(pastDayPolicy.heatingMultMaxNonEvent, weatherSeverityMultiplier)
      );
    }
  } else if (weatherModeUsed === "cooling") {
    if (isEventDay) {
      weatherSeverityMultiplier = Math.max(pastDayPolicy.coolingMultMin, Math.min(pastDayPolicy.coolingMultMax, weatherSeverityMultiplier));
    } else {
      weatherSeverityMultiplier = Math.max(
        pastDayPolicy.coolingMultMinNonEvent,
        Math.min(pastDayPolicy.coolingMultMaxNonEvent, weatherSeverityMultiplier)
      );
    }
  }

  const weatherModifier = resolveSharedWeatherShapeModifier(weatherEfficiencyDerivedInput ?? null, weatherModeUsed, weatherShapingPolicy);
  if (weatherModifier.applied) {
    weatherSeverityMultiplier =
      1 +
      (weatherSeverityMultiplier - 1) *
        weatherModifier.weatherAmplitudeCompressionFactor *
        weatherModifier.weatherResponsivenessScale;
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
      baseDayKwh * pastDayPolicy.weatherScaledProfileAnchorFrac +
      preBlendAdjustedDayKwh * (1 - pastDayPolicy.weatherScaledProfileAnchorFrac);
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
    postDonorAdjustmentCoefficient: weatherSeverityMultiplier,
    weatherEfficiencyApplied: weatherModifier.applied,
    weatherShapingMode: weatherModifier.weatherShapingMode,
    weatherAmplitudeCompressionFactor: weatherModifier.weatherAmplitudeCompressionFactor,
    intradayPeakValleyCompressionFactor: weatherModifier.intradayPeakValleyCompressionFactor,
    dailyExtremaConfidence: weatherModifier.dailyExtremaConfidence,
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
  lowDataSyntheticDayKwhByMonthDayType?: PastDaySimulationContext["lowDataSyntheticDayKwhByMonthDayType"];
  lowDataWeatherEvidence?: PastDaySimulationContext["lowDataWeatherEvidence"];
  weatherEfficiencyDerivedInput?: PastDaySimulationContext["weatherEfficiencyDerivedInput"];
  simulationVariablePolicy?: PastDaySimulationContext["simulationVariablePolicy"];
}): PastDaySimulationContext {
  return {
    profile: args.profile,
    trainingWeatherStats: args.trainingWeatherStats,
    weatherByDateKey: args.weatherByDateKey,
    neighborDayTotals: args.neighborDayTotals ?? null,
    weatherDonorSamples: args.weatherDonorSamples ?? null,
    modeledDaySelectionStrategy: args.modeledDaySelectionStrategy ?? "calendar_first",
    shapeVariants: args.shapeVariants ?? null,
    lowDataSyntheticDayKwhByMonthDayType: args.lowDataSyntheticDayKwhByMonthDayType ?? null,
    lowDataWeatherEvidence: args.lowDataWeatherEvidence ?? null,
    weatherEfficiencyDerivedInput: args.weatherEfficiencyDerivedInput ?? null,
    simulationVariablePolicy: args.simulationVariablePolicy ?? null,
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
  const simulationVariablePolicy = context.simulationVariablePolicy ?? DEFAULT_SIMULATION_VARIABLE_POLICY;
  const monthKey = localDate.slice(0, 7);
  const dayTypeUsed: PastDayTypeKey = isWeekend ? "weekend" : "weekday";
  const lowDataMonthBucket = context.lowDataSyntheticDayKwhByMonthDayType?.[monthKey] ?? null;
  const lowDataMonthEvidence = context.lowDataWeatherEvidence?.byMonth?.[monthKey] ?? null;
  const lowDataTargetDayKwh = lowDataMonthBucket
    ? Number(dayTypeUsed === "weekend" ? lowDataMonthBucket.weekend : lowDataMonthBucket.weekday) || 0
    : null;
  const canUseLowDataSyntheticFastPath =
    lowDataTargetDayKwh != null &&
    lowDataTargetDayKwh >= 0 &&
    context.trainingWeatherStats == null &&
    (!context.weatherDonorSamples || context.weatherDonorSamples.length === 0) &&
    (!context.neighborDayTotals ||
      ((context.neighborDayTotals.weekdayByMonth == null ||
        Object.keys(context.neighborDayTotals.weekdayByMonth).length === 0) &&
        (context.neighborDayTotals.weekendByMonth == null ||
          Object.keys(context.neighborDayTotals.weekendByMonth).length === 0)));

  const sel = canUseLowDataSyntheticFastPath
    ? {
        targetDayKwh: lowDataTargetDayKwh,
        fallbackLevel: "month_daytype" as PastDayFallbackLevel,
        rawSelectedDayKwh: lowDataTargetDayKwh,
        clampApplied: false,
        donorSelectionModeUsed: "low_data_month_daytype",
        donorCandidatePoolSize: 0,
        selectedDonorLocalDates: [] as string[],
        selectedDonorWeights: [] as PastWeatherDonorContribution[],
        donorWeatherRegimeUsed: null,
        donorMonthKeyUsed: monthKey,
        thermalDistanceScore: null,
        broadFallbackUsed: false,
        sameRegimeDonorPoolAvailable: false,
        donorPoolBlendStrategy: null as "distance_weighted_blend" | "variance_dampened_blend" | null,
        donorPoolKwhSpread: null,
        donorPoolKwhVariance: null,
        donorPoolMedianKwh: null,
        donorVarianceGuardrailTriggered: false,
        donorWeatherReference: null as PastDayWeatherFeatures | null,
      }
    : selectPastDayTotalWithFallback({
        localDate,
        monthKey,
        isWeekend,
        profile: context.profile,
        weatherForDay,
        modeledDaySelectionStrategy: context.modeledDaySelectionStrategy,
        neighborDayTotals: context.neighborDayTotals,
        weatherDonorSamples: context.weatherDonorSamples,
        policy: simulationVariablePolicy.pastDayCore,
      });

  const adj = canUseLowDataSyntheticFastPath
    ? (() => {
        const adjusted = computeLowDataWeatherAdjustedDayTotal({
          baseDayKwh: sel.targetDayKwh,
          weatherForDay,
          monthEvidence: lowDataMonthEvidence,
          weatherEfficiencyDerivedInput: context.weatherEfficiencyDerivedInput ?? null,
          simulationVariablePolicy,
        });
        return {
          finalSelectedDayKwh: adjusted.finalSelectedDayKwh,
          weatherSeverityMultiplier: adjusted.weatherSeverityMultiplier,
          weatherModeUsed: adjusted.weatherModeUsed,
          auxHeatKwhAdder: 0,
          poolFreezeProtectKwhAdder: 0,
          dayClassification: adjusted.dayClassification,
          auxHeatGate_minTempPassed: false,
          auxHeatGate_freezeHoursPassed: false,
          auxHeatGate_severityPassed: false,
          referenceHeatingSeverity: 0,
          preBlendAdjustedDayKwh: adjusted.preBlendAdjustedDayKwh,
          blendedBackTowardProfile: adjusted.dayClassification === "weather_scaled_day",
          weatherAdjustmentModeUsed: adjusted.weatherAdjustmentModeUsed,
          postDonorAdjustmentCoefficient: adjusted.postDonorAdjustmentCoefficient,
            weatherEfficiencyApplied: adjusted.weatherEfficiencyApplied,
            weatherShapingMode: adjusted.weatherShapingMode,
            weatherAmplitudeCompressionFactor: adjusted.weatherAmplitudeCompressionFactor,
            intradayPeakValleyCompressionFactor: adjusted.intradayPeakValleyCompressionFactor,
            dailyExtremaConfidence: adjusted.dailyExtremaConfidence,
        };
      })()
    : (() => {
        const weatherByDateKey = new Map<string, PastDayWeatherFeatures>();
        if (weatherForDay) weatherByDateKey.set(localDate, weatherForDay);
        return computeWeatherAdjustedDayTotal({
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
          weatherEfficiencyDerivedInput: context.weatherEfficiencyDerivedInput ?? null,
          simulationVariablePolicy,
        });
      })();

  const weatherRegime: PastWeatherRegimeKey =
    adj.weatherModeUsed === "heating" || adj.weatherModeUsed === "cooling" ? adj.weatherModeUsed : "neutral";
  const selectedShape = selectShape96({
    monthKey,
    dayType: dayTypeUsed,
    weatherRegime,
    preferredMonthKeys: sel.donorMonthKeyUsed ? [sel.donorMonthKeyUsed] : [monthKey],
    shapeVariants: context.shapeVariants,
    legacyByMonth96: shapeByMonth96 ?? null,
  });
  const normShape = canUseLowDataSyntheticFastPath
    ? applyLowDataShapeWeatherAmplitude({
        shape96: selectedShape.shape96,
        weatherRegime,
        weatherSeverityMultiplier: adj.weatherSeverityMultiplier,
        monthEvidence: lowDataMonthEvidence,
        weatherEfficiencyDerivedInput: context.weatherEfficiencyDerivedInput ?? null,
        simulationVariablePolicy,
      })
    : selectedShape.shape96;

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
    selectedDonorWeights: sel.selectedDonorWeights,
    donorWeatherRegimeUsed: sel.donorWeatherRegimeUsed,
    donorMonthKeyUsed: sel.donorMonthKeyUsed,
    thermalDistanceScore: sel.thermalDistanceScore,
    broadFallbackUsed: sel.broadFallbackUsed,
    sameRegimeDonorPoolAvailable: sel.sameRegimeDonorPoolAvailable,
    donorPoolBlendStrategy: sel.donorPoolBlendStrategy ?? undefined,
    donorPoolKwhSpread: sel.donorPoolKwhSpread,
    donorPoolKwhVariance: sel.donorPoolKwhVariance,
    donorPoolMedianKwh: sel.donorPoolMedianKwh,
    donorVarianceGuardrailTriggered: sel.donorVarianceGuardrailTriggered,
    weatherAdjustmentModeUsed: adj.weatherAdjustmentModeUsed,
    postDonorAdjustmentCoefficient: adj.postDonorAdjustmentCoefficient,
    selectedFingerprintBucketMonth: selectedShape.selectedMonthKeyUsed ?? monthKey,
    shape96Used: normShape,
    auxHeatGate_minTempPassed: adj.auxHeatGate_minTempPassed,
    auxHeatGate_freezeHoursPassed: adj.auxHeatGate_freezeHoursPassed,
    auxHeatGate_severityPassed: adj.auxHeatGate_severityPassed,
    referenceHeatingSeverity: adj.referenceHeatingSeverity,
    preBlendAdjustedDayKwh: adj.preBlendAdjustedDayKwh,
    blendedBackTowardProfile: adj.blendedBackTowardProfile,
    weatherEfficiencyApplied: adj.weatherEfficiencyApplied,
    weatherShapingMode: adj.weatherShapingMode,
    weatherAmplitudeCompressionFactor: adj.weatherAmplitudeCompressionFactor,
    intradayPeakValleyCompressionFactor: adj.intradayPeakValleyCompressionFactor,
    dailyExtremaConfidence: adj.dailyExtremaConfidence,
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
