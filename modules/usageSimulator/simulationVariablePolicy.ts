import { getFlag, setFlag } from "@/lib/flags";

export const SIMULATION_VARIABLE_POLICY_FLAG_KEY = "sim.shared_variable_policy.v1";
export const SIMULATION_VARIABLE_OVERRIDE_CONFIRMATION = "OVERRIDE";

export type SimulationVariablePolicy = {
  pastDayCore: {
    minDaysMonthDayType: number;
    minDaysAdjacent: number;
    minDaysMonthOverall: number;
    minDaysSeason: number;
    minDaysGlobalDayType: number;
    minDaysNeighborDayType: number;
    minDaysWeatherDonorSameDayType: number;
    minDaysWeatherDonorSameRegime: number;
    weatherDonorPickCount: number;
    neighborDomRadius: number;
    guardrailMaxMult: number;
    guardrailMinMult: number;
    donorVarianceCvTrigger: number;
    donorSpreadToMedianTrigger: number;
    weatherSeverityThreshold: number;
    weatherDonorDistanceWeightBase: number;
    weatherDonorVarianceBlendWeight: number;
    weatherDonorMedianBlendWeight: number;
    heatingDistanceHeatingDiffWeight: number;
    heatingDistanceMinTempWeight: number;
    heatingDistanceAvgTempWeight: number;
    heatingDistanceMaxTempWeight: number;
    heatingDistanceSpreadWeight: number;
    heatingDistanceMonthWeight: number;
    heatingDistanceDayOfMonthWeight: number;
    coolingDistanceCoolingDiffWeight: number;
    coolingDistanceAvgTempWeight: number;
    coolingDistanceMaxTempWeight: number;
    coolingDistanceMinTempWeight: number;
    coolingDistanceSpreadWeight: number;
    coolingDistanceMonthWeight: number;
    coolingDistanceDayOfMonthWeight: number;
    neutralDistanceAvgTempWeight: number;
    neutralDistanceSpreadWeight: number;
    neutralDistanceMaxTempWeight: number;
    neutralDistanceMinTempWeight: number;
    neutralDistanceHeatingWeight: number;
    neutralDistanceCoolingWeight: number;
    neutralDistanceMonthWeight: number;
    neutralDistanceDayOfMonthWeight: number;
    heatingDeadbandPct: number;
    coolingDeadbandPct: number;
    heatingMultMin: number;
    heatingMultMax: number;
    coolingMultMin: number;
    coolingMultMax: number;
    heatingMultMinNonEvent: number;
    heatingMultMaxNonEvent: number;
    coolingMultMinNonEvent: number;
    coolingMultMaxNonEvent: number;
    auxHeatSlope: number;
    weatherScaledProfileAnchorFrac: number;
    auxHeatKwhCap: number;
    auxMinTempC: number;
    auxHddRatio: number;
    auxFreezeHoursMin: number;
    poolFreezeHoursMin: number;
    poolFreezeMinTempC: number;
    poolFreezeKwhCap: number;
    poolFreezeHpFactor: number;
  };
  weatherShaping: {
    intervalAmplitudeBase: number;
    intervalAmplitudeConfidenceWeight: number;
    intervalAmplitudeResponseWeight: number;
    intervalPeakValleyBase: number;
    intervalPeakValleyConfidenceWeight: number;
    intervalResponsivenessBase: number;
    intervalResponsivenessLoadShareWeight: number;
    intervalResponsivenessScoreWeight: number;
    intervalDailyExtremaBase: number;
    intervalDailyExtremaConfidenceWeight: number;
    billingAmplitudeBase: number;
    billingAmplitudeConfidenceWeight: number;
    billingAmplitudeLoadShareWeight: number;
    billingAmplitudeScoreWeight: number;
    billingPeakValleyBase: number;
    billingPeakValleyConfidenceWeight: number;
    billingPeakValleyLoadShareWeight: number;
    billingResponsivenessBase: number;
    billingResponsivenessLoadShareWeight: number;
    billingResponsivenessConfidenceWeight: number;
    billingResponsivenessScoreWeight: number;
    billingDailyExtremaBase: number;
    billingDailyExtremaConfidenceWeight: number;
    shapeAmplitudeBase: number;
    shapeAmplitudeHvacShareWeight: number;
    shapeFlattenBlendWeight: number;
  };
  engineProfile: {
    shapeWeatherSeverityThreshold: number;
    weatherAwareHvacGasHeatK: number;
    weatherAwareHvacElectricHeatK: number;
    weatherAwareHvacHeatStripK: number;
    weatherAwareHvacHeatPumpK: number;
    weatherAwareHvacCoolingK: number;
    weatherAwareHvacSummerSetpointWeight: number;
    weatherAwareHvacWinterSetpointWeight: number;
    weatherAwareHvacMaxCapKwh: number;
    poolPumpKwPerHpSingleSpeed: number;
    poolPumpKwPerHpDualSpeed: number;
    poolPumpKwPerHpVariableSpeed: number;
    poolHeaterAdderKwh: number;
    poolSeasonalMaxCapKwh: number;
    weatherTiltCoolingPerCdd: number;
    weatherTiltCoolingMaxBoost: number;
    weatherTiltHeatingElectricPerHdd: number;
    weatherTiltHeatingGasPerHdd: number;
    weatherTiltHeatingMaxBoost: number;
    wholeHomeSyntheticMinDays: number;
    minDaysForProfileUse: number;
    profileRatioMin: number;
    profileRatioMax: number;
  };
  weatherSensitivityScoring: {
    occupancyCoolingPerOccupant: number;
    occupancyCoolingHomeAllDayPerOccupant: number;
    occupancyHeatingHomeAllDayPerOccupant: number;
    gasHeatingFactor: number;
    electricHeatingFactor: number;
    heatPumpHeatingFactor: number;
    poolCoolingBase: number;
    poolCoolingPerHp: number;
    evCoolingFactor: number;
    evHeatingFactor: number;
    hvacAgePenalty: number;
    hvacLowSeerFactor: number;
    hvacHighSeerFactor: number;
    electricResistanceHeatingFactor: number;
    thermostatSummerPerDegree: number;
    thermostatWinterPerDegree: number;
    shoulderDegreeThreshold: number;
    baselineFallbackSliceFraction: number;
    expectedCoolingSlopeBase: number;
    expectedHeatingSlopeBase: number;
    responseRatioScoreWeight: number;
    weatherShareScoreWeight: number;
    coverageScorePerPoint: number;
    coverageScoreMax: number;
    seasonPresenceScorePerBucket: number;
    shoulderPresenceScore: number;
    factorCompletenessScorePerField: number;
    inefficiencyResponsePenaltyWeight: number;
    inefficiencyWeatherSharePenaltyWeight: number;
    inefficiencyLowConfidencePenaltyWeight: number;
    appearsSensitiveEfficiencyThreshold: number;
    highEfficiencyThreshold: number;
    confidenceLimitedThreshold: number;
  };
  lowDataWeatherEvidence: {
    electricHeatingPriorSensitivity: number;
    defaultHeatingPriorSensitivity: number;
    coolingPriorSensitivityWithCoolingPriors: number;
    coolingPriorSensitivityDefault: number;
    evidenceWeightHighThreshold: number;
    evidenceWeightMediumThreshold: number;
    evidenceWeightHigh: number;
    evidenceWeightMedium: number;
    evidenceWeightLow: number;
    baseloadMeanFallbackMultiplier: number;
    baseloadDailyMinMultiplier: number;
    baseloadDailyMaxMultiplier: number;
    sensitivityMin: number;
    sensitivityMax: number;
    baseloadShareMin: number;
    baseloadShareMax: number;
    hvacShareMin: number;
    hvacShareMax: number;
    inferredDailyTargetMinMultiplier: number;
    inferredDailyTargetMaxMultiplier: number;
    weatherDrivenHvacShareThreshold: number;
    weatherDrivenSensitivityThreshold: number;
    mixedBaseloadThreshold: number;
    lowDataDayBaseloadShareMin: number;
    lowDataDayBaseloadShareMax: number;
    lowDataDayHvacShareMin: number;
    lowDataDayHvacShareMax: number;
    lowDataDaySensitivityMin: number;
    lowDataDaySensitivityMax: number;
    lowDataScaledDayThreshold: number;
  };
};

export type SimulationVariablePolicyOverrides = {
  [K in keyof SimulationVariablePolicy]?: Partial<SimulationVariablePolicy[K]>;
};

export const DEFAULT_SIMULATION_VARIABLE_POLICY: SimulationVariablePolicy = {
  pastDayCore: {
    minDaysMonthDayType: 4,
    minDaysAdjacent: 6,
    minDaysMonthOverall: 6,
    minDaysSeason: 8,
    minDaysGlobalDayType: 8,
    minDaysNeighborDayType: 3,
    minDaysWeatherDonorSameDayType: 3,
    minDaysWeatherDonorSameRegime: 2,
    weatherDonorPickCount: 5,
    neighborDomRadius: 5,
    guardrailMaxMult: 1.75,
    guardrailMinMult: 0.45,
    donorVarianceCvTrigger: 0.18,
    donorSpreadToMedianTrigger: 0.38,
    weatherSeverityThreshold: 2,
    weatherDonorDistanceWeightBase: 0.35,
    weatherDonorVarianceBlendWeight: 0.7,
    weatherDonorMedianBlendWeight: 0.3,
    heatingDistanceHeatingDiffWeight: 3.4,
    heatingDistanceMinTempWeight: 1.1,
    heatingDistanceAvgTempWeight: 0.45,
    heatingDistanceMaxTempWeight: 0.18,
    heatingDistanceSpreadWeight: 0.12,
    heatingDistanceMonthWeight: 0.28,
    heatingDistanceDayOfMonthWeight: 0.03,
    coolingDistanceCoolingDiffWeight: 3.1,
    coolingDistanceAvgTempWeight: 0.75,
    coolingDistanceMaxTempWeight: 0.45,
    coolingDistanceMinTempWeight: 0.2,
    coolingDistanceSpreadWeight: 0.18,
    coolingDistanceMonthWeight: 0.32,
    coolingDistanceDayOfMonthWeight: 0.03,
    neutralDistanceAvgTempWeight: 0.95,
    neutralDistanceSpreadWeight: 0.28,
    neutralDistanceMaxTempWeight: 0.3,
    neutralDistanceMinTempWeight: 0.3,
    neutralDistanceHeatingWeight: 0.8,
    neutralDistanceCoolingWeight: 0.8,
    neutralDistanceMonthWeight: 0.35,
    neutralDistanceDayOfMonthWeight: 0.04,
    heatingDeadbandPct: 0.3,
    coolingDeadbandPct: 0.25,
    heatingMultMin: 0.9,
    heatingMultMax: 1.35,
    coolingMultMin: 0.9,
    coolingMultMax: 1.25,
    heatingMultMinNonEvent: 0.97,
    heatingMultMaxNonEvent: 1.15,
    coolingMultMinNonEvent: 0.97,
    coolingMultMaxNonEvent: 1.1,
    auxHeatSlope: 0.15,
    weatherScaledProfileAnchorFrac: 0.12,
    auxHeatKwhCap: 12,
    auxMinTempC: 0,
    auxHddRatio: 1.35,
    auxFreezeHoursMin: 2,
    poolFreezeHoursMin: 4,
    poolFreezeMinTempC: 0,
    poolFreezeKwhCap: 8,
    poolFreezeHpFactor: 0.75,
  },
  weatherShaping: {
    intervalAmplitudeBase: 0.78,
    intervalAmplitudeConfidenceWeight: 0.18,
    intervalAmplitudeResponseWeight: 0.04,
    intervalPeakValleyBase: 0.88,
    intervalPeakValleyConfidenceWeight: 0.1,
    intervalResponsivenessBase: 0.72,
    intervalResponsivenessLoadShareWeight: 0.2,
    intervalResponsivenessScoreWeight: 0.12,
    intervalDailyExtremaBase: 0.68,
    intervalDailyExtremaConfidenceWeight: 0.32,
    billingAmplitudeBase: 0.42,
    billingAmplitudeConfidenceWeight: 0.18,
    billingAmplitudeLoadShareWeight: 0.12,
    billingAmplitudeScoreWeight: 0.08,
    billingPeakValleyBase: 0.58,
    billingPeakValleyConfidenceWeight: 0.12,
    billingPeakValleyLoadShareWeight: 0.08,
    billingResponsivenessBase: 0.38,
    billingResponsivenessLoadShareWeight: 0.18,
    billingResponsivenessConfidenceWeight: 0.14,
    billingResponsivenessScoreWeight: 0.08,
    billingDailyExtremaBase: 0.35,
    billingDailyExtremaConfidenceWeight: 0.22,
    shapeAmplitudeBase: 0.45,
    shapeAmplitudeHvacShareWeight: 0.55,
    shapeFlattenBlendWeight: 0.4,
  },
  engineProfile: {
    shapeWeatherSeverityThreshold: 2,
    weatherAwareHvacGasHeatK: 0.02,
    weatherAwareHvacElectricHeatK: 0.16,
    weatherAwareHvacHeatStripK: 0.3,
    weatherAwareHvacHeatPumpK: 0.18,
    weatherAwareHvacCoolingK: 0.12,
    weatherAwareHvacSummerSetpointWeight: 0.01,
    weatherAwareHvacWinterSetpointWeight: 0.01,
    weatherAwareHvacMaxCapKwh: 60,
    poolPumpKwPerHpSingleSpeed: 0.75,
    poolPumpKwPerHpDualSpeed: 0.65,
    poolPumpKwPerHpVariableSpeed: 0.45,
    poolHeaterAdderKwh: 1.25,
    poolSeasonalMaxCapKwh: 40,
    weatherTiltCoolingPerCdd: 0.015,
    weatherTiltCoolingMaxBoost: 0.55,
    weatherTiltHeatingElectricPerHdd: 0.015,
    weatherTiltHeatingGasPerHdd: 0.006,
    weatherTiltHeatingMaxBoost: 0.45,
    wholeHomeSyntheticMinDays: 4,
    minDaysForProfileUse: 4,
    profileRatioMin: 0.82,
    profileRatioMax: 1.18,
  },
  weatherSensitivityScoring: {
    occupancyCoolingPerOccupant: 0.04,
    occupancyCoolingHomeAllDayPerOccupant: 0.06,
    occupancyHeatingHomeAllDayPerOccupant: 0.03,
    gasHeatingFactor: 0.72,
    electricHeatingFactor: 1.14,
    heatPumpHeatingFactor: 0.95,
    poolCoolingBase: 1.12,
    poolCoolingPerHp: 0.04,
    evCoolingFactor: 1.03,
    evHeatingFactor: 1.03,
    hvacAgePenalty: 1.08,
    hvacLowSeerFactor: 1.1,
    hvacHighSeerFactor: 0.93,
    electricResistanceHeatingFactor: 1.1,
    thermostatSummerPerDegree: 0.05,
    thermostatWinterPerDegree: 0.04,
    shoulderDegreeThreshold: 3,
    baselineFallbackSliceFraction: 0.25,
    expectedCoolingSlopeBase: 0.75,
    expectedHeatingSlopeBase: 0.6,
    responseRatioScoreWeight: 42,
    weatherShareScoreWeight: 35,
    coverageScorePerPoint: 6,
    coverageScoreMax: 55,
    seasonPresenceScorePerBucket: 15,
    shoulderPresenceScore: 10,
    factorCompletenessScorePerField: 5,
    inefficiencyResponsePenaltyWeight: 20,
    inefficiencyWeatherSharePenaltyWeight: 22,
    inefficiencyLowConfidencePenaltyWeight: 0.2,
    appearsSensitiveEfficiencyThreshold: 45,
    highEfficiencyThreshold: 75,
    confidenceLimitedThreshold: 55,
  },
  lowDataWeatherEvidence: {
    electricHeatingPriorSensitivity: 0.95,
    defaultHeatingPriorSensitivity: 0.45,
    coolingPriorSensitivityWithCoolingPriors: 0.75,
    coolingPriorSensitivityDefault: 0.45,
    evidenceWeightHighThreshold: 5,
    evidenceWeightMediumThreshold: 3,
    evidenceWeightHigh: 0.9,
    evidenceWeightMedium: 0.7,
    evidenceWeightLow: 0.45,
    baseloadMeanFallbackMultiplier: 0.55,
    baseloadDailyMinMultiplier: 0.18,
    baseloadDailyMaxMultiplier: 0.92,
    sensitivityMin: 0.12,
    sensitivityMax: 1.8,
    baseloadShareMin: 0.18,
    baseloadShareMax: 0.9,
    hvacShareMin: 0.1,
    hvacShareMax: 0.82,
    inferredDailyTargetMinMultiplier: 0.35,
    inferredDailyTargetMaxMultiplier: 1.85,
    weatherDrivenHvacShareThreshold: 0.48,
    weatherDrivenSensitivityThreshold: 0.9,
    mixedBaseloadThreshold: 0.24,
    lowDataDayBaseloadShareMin: 0.15,
    lowDataDayBaseloadShareMax: 0.92,
    lowDataDayHvacShareMin: 0.08,
    lowDataDayHvacShareMax: 0.85,
    lowDataDaySensitivityMin: 0,
    lowDataDaySensitivityMax: 1.8,
    lowDataScaledDayThreshold: 0.035,
  },
};

export const SIMULATION_VARIABLE_POLICY_FAMILY_META = {
  pastDayCore: {
    title: "Past Day Core",
    description: "Fallback thresholds, donor-pool selection, weather distance weighting, and shared day-total/weather caps.",
  },
  weatherShaping: {
    title: "Weather Shaping",
    description: "Shared weather-efficiency modifier coefficients for interval and billing-period shaping paths.",
  },
  engineProfile: {
    title: "Engine Profile",
    description: "Reference-shape HVAC/pool heuristics, whole-home synthetic profile thresholds, and weather tilt weights.",
  },
  weatherSensitivityScoring: {
    title: "Weather Sensitivity Scoring",
    description: "Shared weather score expectations and response/coverage/confidence weighting used to build derived input.",
  },
  lowDataWeatherEvidence: {
    title: "Low-Data Weather Evidence",
    description: "Manual monthly/annual evidence regression priors, blend thresholds, and low-data weather-response clamps.",
  },
} satisfies Record<keyof SimulationVariablePolicy, { title: string; description: string }>;

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "number" && Number.isFinite(entry));
}

function mergeKnownValues<T extends Record<string, unknown>>(defaults: T, overrides: Record<string, unknown> | null | undefined): T {
  const next = { ...defaults } as Record<string, unknown>;
  if (!overrides) return next as T;
  for (const key of Object.keys(defaults)) {
    const incoming = overrides[key];
    if (typeof defaults[key] === "number" && typeof incoming === "number" && Number.isFinite(incoming)) {
      next[key] = incoming;
      continue;
    }
    if (isNumberArray(defaults[key]) && isNumberArray(incoming)) {
      next[key] = incoming;
    }
  }
  return next as T;
}

function pickKnownOverrideValues<T extends Record<string, unknown>>(
  defaults: T,
  overrides: Record<string, unknown> | null | undefined
): Partial<T> {
  const next: Partial<T> = {};
  if (!overrides) return next;
  for (const key of Object.keys(defaults) as Array<keyof T>) {
    const incoming = overrides[key as string];
    if (typeof defaults[key] === "number" && typeof incoming === "number" && Number.isFinite(incoming)) {
      next[key] = incoming as T[keyof T];
      continue;
    }
    if (isNumberArray(defaults[key]) && isNumberArray(incoming)) {
      next[key] = incoming as T[keyof T];
    }
  }
  return next;
}

export function mergeSimulationVariablePolicyOverrides(
  overrides: SimulationVariablePolicyOverrides | null | undefined
): SimulationVariablePolicy {
  return {
    pastDayCore: mergeKnownValues(DEFAULT_SIMULATION_VARIABLE_POLICY.pastDayCore, overrides?.pastDayCore as Record<string, unknown> | undefined),
    weatherShaping: mergeKnownValues(DEFAULT_SIMULATION_VARIABLE_POLICY.weatherShaping, overrides?.weatherShaping as Record<string, unknown> | undefined),
    engineProfile: mergeKnownValues(DEFAULT_SIMULATION_VARIABLE_POLICY.engineProfile, overrides?.engineProfile as Record<string, unknown> | undefined),
    weatherSensitivityScoring: mergeKnownValues(
      DEFAULT_SIMULATION_VARIABLE_POLICY.weatherSensitivityScoring,
      overrides?.weatherSensitivityScoring as Record<string, unknown> | undefined
    ),
    lowDataWeatherEvidence: mergeKnownValues(
      DEFAULT_SIMULATION_VARIABLE_POLICY.lowDataWeatherEvidence,
      overrides?.lowDataWeatherEvidence as Record<string, unknown> | undefined
    ),
  };
}

export function sanitizeSimulationVariableOverrides(raw: unknown): SimulationVariablePolicyOverrides {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const overrides = raw as Record<string, unknown>;
  return {
    pastDayCore: pickKnownOverrideValues(DEFAULT_SIMULATION_VARIABLE_POLICY.pastDayCore, overrides.pastDayCore as Record<string, unknown> | undefined),
    weatherShaping: pickKnownOverrideValues(DEFAULT_SIMULATION_VARIABLE_POLICY.weatherShaping, overrides.weatherShaping as Record<string, unknown> | undefined),
    engineProfile: pickKnownOverrideValues(DEFAULT_SIMULATION_VARIABLE_POLICY.engineProfile, overrides.engineProfile as Record<string, unknown> | undefined),
    weatherSensitivityScoring: pickKnownOverrideValues(
      DEFAULT_SIMULATION_VARIABLE_POLICY.weatherSensitivityScoring,
      overrides.weatherSensitivityScoring as Record<string, unknown> | undefined
    ),
    lowDataWeatherEvidence: pickKnownOverrideValues(
      DEFAULT_SIMULATION_VARIABLE_POLICY.lowDataWeatherEvidence,
      overrides.lowDataWeatherEvidence as Record<string, unknown> | undefined
    ),
  };
}

export async function getSimulationVariableOverrides(): Promise<SimulationVariablePolicyOverrides> {
  const raw = await getFlag(SIMULATION_VARIABLE_POLICY_FLAG_KEY);
  if (!raw) return {};
  try {
    return sanitizeSimulationVariableOverrides(JSON.parse(raw));
  } catch {
    return {};
  }
}

export async function getSimulationVariablePolicy(): Promise<{
  effective: SimulationVariablePolicy;
  overrides: SimulationVariablePolicyOverrides;
}> {
  const overrides = await getSimulationVariableOverrides();
  return {
    effective: mergeSimulationVariablePolicyOverrides(overrides),
    overrides,
  };
}

export async function saveSimulationVariableOverrides(overrides: SimulationVariablePolicyOverrides): Promise<void> {
  const sanitized = sanitizeSimulationVariableOverrides(overrides);
  await setFlag(SIMULATION_VARIABLE_POLICY_FLAG_KEY, JSON.stringify(sanitized));
}

export async function resetSimulationVariableOverrides(): Promise<void> {
  await setFlag(SIMULATION_VARIABLE_POLICY_FLAG_KEY, JSON.stringify({}));
}
