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
  adapterCanonicalInput: {
    canonicalCoverageLagDays: number;
    canonicalCoverageTotalDays: number;
    manualMonthlyDefaultBillEndDay: number;
    manualAnnualWindowDays: number;
    longTermWeatherBaselineStartYear: number;
    longTermWeatherBaselineEndYear: number;
  };
  constraintRebalance: {
    weatherModifierConfidenceMin: number;
    weatherModifierConfidenceMax: number;
    weatherModifierLoadShareMin: number;
    weatherModifierLoadShareMax: number;
    weatherModifierScoreMin: number;
    weatherModifierScoreMax: number;
    weatherModifierResponseMin: number;
    weatherModifierResponseMax: number;
    intervalResponsivenessMax: number;
    billingAmplitudeMax: number;
    billingPeakValleyMax: number;
    billingResponsivenessMax: number;
    billingDailyExtremaMax: number;
    lowDataHvacMultiplierMin: number;
    lowDataHvacMultiplierMax: number;
    lowDataReferenceDegreeFloor: number;
    lowDataWeatherTieBias: number;
    shapeSkipThreshold: number;
    shapeFlattenBlendMin: number;
    shapeFlattenBlendMax: number;
    postDonorHeatingSeverityFloor: number;
    postDonorCoolingSeverityFloor: number;
    postDonorHeatingMultiplierMin: number;
    postDonorHeatingMultiplierMax: number;
    postDonorHeatingNonEventMin: number;
    postDonorHeatingNonEventMax: number;
    postDonorCoolingMultiplierMin: number;
    postDonorCoolingMultiplierMax: number;
    postDonorCoolingNonEventMin: number;
    postDonorCoolingNonEventMax: number;
    postDonorNeutralMin: number;
    postDonorNeutralMax: number;
    weekdayWeekendProfileRatioMin: number;
    weekdayWeekendProfileRatioMax: number;
  };
  donorFallbackExclusions: {
    donorVarianceGuardrailMinSampleCount: number;
    weatherDistanceDefaultDayOfMonth: number;
    monthDistanceInvalidFallback: number;
    nearestWeatherPickCount: number;
    nearestWeatherMinimumCandidates: number;
    nearestWeatherHvacBlendWeight: number;
    weatherSensitivityMinimumIntervalFitPoints: number;
  };
  intradayShapeReconstruction: {
    coolingBoostHoursStart: number;
    coolingBoostHoursEnd: number;
    heatingMorningBoostHoursStart: number;
    heatingMorningBoostHoursEnd: number;
    heatingEveningBoostHoursStart: number;
    heatingEveningBoostHoursEnd: number;
    weatherAwareHvacSetpointClampMin: number;
    weatherAwareHvacSetpointClampMax: number;
    weatherAwareHvacSummerReferenceF: number;
    weatherAwareHvacWinterReferenceF: number;
    freezeDayMinTempC: number;
    freezeDayHoursCount: number;
    syntheticSqftMin: number;
    syntheticSqftMax: number;
    syntheticSqftFallback: number;
    syntheticEvDailyCapKwh: number;
    syntheticBaseLoadIntercept: number;
    syntheticBaseLoadSqftDivisor: number;
    syntheticBaseLoadSqftMultiplier: number;
    syntheticEvBlendWeight: number;
    syntheticPoolAdderKwh: number;
    syntheticWeekdayMinKwh: number;
    syntheticWeekdayMaxKwh: number;
    syntheticWeekendBlendWeight: number;
    syntheticWinterSeasonMultiplier: number;
    syntheticSummerSeasonMultiplier: number;
    syntheticFallbackMonthKeyYear: number;
    syntheticFallbackMonthKeyMonth: number;
  };
  compareTuningMetrics: {
    thermostatSummerReferenceF: number;
    thermostatWinterReferenceF: number;
    squareFootageReference: number;
    squareFootageFactorMin: number;
    squareFootageFactorMax: number;
    occupancyCoolingCountCap: number;
    occupancyHeatingHomeAllDayCap: number;
    hvacAgePenaltyThresholdYears: number;
    hvacLowSeerThreshold: number;
    hvacHighSeerThreshold: number;
    applianceDetailRichMinimumCount: number;
    weatherEfficiencyScoreAnchor: number;
    lowConfidencePenaltyReference: number;
    appearsSensitiveCoolingThreshold: number;
    appearsSensitiveHeatingThreshold: number;
    simulatedDayDiagnosticsSampleLimit: number;
  };
};

export type SimulationVariableInputType = "INTERVAL" | "MANUAL_MONTHLY" | "MANUAL_ANNUAL" | "NEW_BUILD";
export type SimulationVariablePolicyModeBucketKey =
  | "sharedDefaults"
  | "intervalOverrides"
  | "manualMonthlyOverrides"
  | "manualAnnualOverrides"
  | "newBuildOverrides";

export type SimulationVariableFamilyConfig<T extends Record<string, unknown>> = {
  sharedDefaults: T;
  intervalOverrides: Partial<T>;
  manualMonthlyOverrides: Partial<T>;
  manualAnnualOverrides: Partial<T>;
  newBuildOverrides: Partial<T>;
};

export type SimulationVariablePolicyConfig = {
  [K in keyof SimulationVariablePolicy]: SimulationVariableFamilyConfig<SimulationVariablePolicy[K]>;
};

export type SimulationVariablePolicyOverrides = {
  [K in keyof SimulationVariablePolicy]?: Partial<SimulationVariableFamilyConfig<SimulationVariablePolicy[K]>>;
};

export type SimulationVariableValueSource =
  | "shared default"
  | "interval override"
  | "manual monthly override"
  | "manual annual override"
  | "new build override"
  | "explicit admin override";

export type EffectiveSimulationVariableFamilySnapshot<T extends Record<string, unknown>> = {
  resolvedValues: T;
  valuesByKey: {
    [K in keyof T]: {
      value: T[K];
      valueSource: SimulationVariableValueSource;
    };
  };
  modeBucketUsed: Exclude<SimulationVariableValueSource, "shared default" | "explicit admin override"> | null;
  explicitAdminOverrideKeys: Array<keyof T>;
};

export type EffectiveSimulationVariablesUsed = {
  inputType: SimulationVariableInputType;
  runIdentityLinkage: {
    artifactId: string | null;
    artifactInputHash: string | null;
    buildInputsHash: string | null;
    engineVersion: string | null;
    houseId: string | null;
    actualContextHouseId: string | null;
    scenarioId: string | null;
  };
  familyByFamilyResolvedValues: {
    [K in keyof SimulationVariablePolicy]: EffectiveSimulationVariableFamilySnapshot<SimulationVariablePolicy[K]>;
  };
  resolvedWeatherShapingMode: string;
  resolvedRebalanceMode: string;
  resolvedFallbackMode: string;
  resolvedIntradayReconstructionControls: SimulationVariablePolicy["intradayShapeReconstruction"];
  resolvedCompareTuningThresholds: SimulationVariablePolicy["compareTuningMetrics"];
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
  adapterCanonicalInput: {
    canonicalCoverageLagDays: 2,
    canonicalCoverageTotalDays: 365,
    manualMonthlyDefaultBillEndDay: 15,
    manualAnnualWindowDays: 365,
    longTermWeatherBaselineStartYear: 1991,
    longTermWeatherBaselineEndYear: 2020,
  },
  constraintRebalance: {
    weatherModifierConfidenceMin: 0.15,
    weatherModifierConfidenceMax: 1,
    weatherModifierLoadShareMin: 0.05,
    weatherModifierLoadShareMax: 0.85,
    weatherModifierScoreMin: 0.05,
    weatherModifierScoreMax: 1,
    weatherModifierResponseMin: 0.35,
    weatherModifierResponseMax: 1.4,
    intervalResponsivenessMax: 1.05,
    billingAmplitudeMax: 0.78,
    billingPeakValleyMax: 0.82,
    billingResponsivenessMax: 0.78,
    billingDailyExtremaMax: 0.7,
    lowDataHvacMultiplierMin: 0.3,
    lowDataHvacMultiplierMax: 2.25,
    lowDataReferenceDegreeFloor: 6,
    lowDataWeatherTieBias: 1,
    shapeSkipThreshold: 0.02,
    shapeFlattenBlendMin: 0,
    shapeFlattenBlendMax: 0.5,
    postDonorHeatingSeverityFloor: 8,
    postDonorCoolingSeverityFloor: 8,
    postDonorHeatingMultiplierMin: 0.88,
    postDonorHeatingMultiplierMax: 1.15,
    postDonorHeatingNonEventMin: 0.92,
    postDonorHeatingNonEventMax: 1.08,
    postDonorCoolingMultiplierMin: 0.9,
    postDonorCoolingMultiplierMax: 1.12,
    postDonorCoolingNonEventMin: 0.94,
    postDonorCoolingNonEventMax: 1.08,
    postDonorNeutralMin: 0.97,
    postDonorNeutralMax: 1.03,
    weekdayWeekendProfileRatioMin: 0.82,
    weekdayWeekendProfileRatioMax: 1.18,
  },
  donorFallbackExclusions: {
    donorVarianceGuardrailMinSampleCount: 3,
    weatherDistanceDefaultDayOfMonth: 15,
    monthDistanceInvalidFallback: 12,
    nearestWeatherPickCount: 7,
    nearestWeatherMinimumCandidates: 4,
    nearestWeatherHvacBlendWeight: 0.5,
    weatherSensitivityMinimumIntervalFitPoints: 3,
  },
  intradayShapeReconstruction: {
    coolingBoostHoursStart: 14,
    coolingBoostHoursEnd: 19,
    heatingMorningBoostHoursStart: 6,
    heatingMorningBoostHoursEnd: 9,
    heatingEveningBoostHoursStart: 17,
    heatingEveningBoostHoursEnd: 22,
    weatherAwareHvacSetpointClampMin: 0.8,
    weatherAwareHvacSetpointClampMax: 1.2,
    weatherAwareHvacSummerReferenceF: 72,
    weatherAwareHvacWinterReferenceF: 68,
    freezeDayMinTempC: 0,
    freezeDayHoursCount: 24,
    syntheticSqftMin: 500,
    syntheticSqftMax: 20000,
    syntheticSqftFallback: 2000,
    syntheticEvDailyCapKwh: 80,
    syntheticBaseLoadIntercept: 10,
    syntheticBaseLoadSqftDivisor: 2500,
    syntheticBaseLoadSqftMultiplier: 28,
    syntheticEvBlendWeight: 0.35,
    syntheticPoolAdderKwh: 3,
    syntheticWeekdayMinKwh: 8,
    syntheticWeekdayMaxKwh: 120,
    syntheticWeekendBlendWeight: 0.93,
    syntheticWinterSeasonMultiplier: 1.12,
    syntheticSummerSeasonMultiplier: 1.08,
    syntheticFallbackMonthKeyYear: 2000,
    syntheticFallbackMonthKeyMonth: 1,
  },
  compareTuningMetrics: {
    thermostatSummerReferenceF: 74,
    thermostatWinterReferenceF: 68,
    squareFootageReference: 2000,
    squareFootageFactorMin: 0.7,
    squareFootageFactorMax: 1.7,
    occupancyCoolingCountCap: 6,
    occupancyHeatingHomeAllDayCap: 3,
    hvacAgePenaltyThresholdYears: 15,
    hvacLowSeerThreshold: 14,
    hvacHighSeerThreshold: 18,
    applianceDetailRichMinimumCount: 2,
    weatherEfficiencyScoreAnchor: 88,
    lowConfidencePenaltyReference: 60,
    appearsSensitiveCoolingThreshold: 70,
    appearsSensitiveHeatingThreshold: 70,
    simulatedDayDiagnosticsSampleLimit: 40,
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
  adapterCanonicalInput: {
    title: "Adapter / Canonical Input",
    description: "Canonical window, anchor, bill-end, and pre-engine normalization knobs used before the One Path producer runs.",
  },
  constraintRebalance: {
    title: "Constraint / Rebalance",
    description: "Shared tolerances, clamps, and parity-preservation controls that bound shaping and rebalance behavior.",
  },
  donorFallbackExclusions: {
    title: "Donor / Fallback / Exclusions",
    description: "Shared donor-pool selection, fallback, and exclusion thresholds used when direct evidence is weak or unavailable.",
  },
  intradayShapeReconstruction: {
    title: "Intraday Shape Reconstruction",
    description: "Shared post-daily-total intraday weighting, setpoint clamps, synthetic-shape defaults, and hour-block controls.",
  },
  compareTuningMetrics: {
    title: "Compare / Tuning Metrics",
    description: "Shared compare/tuning thresholds, efficiency score calibration, and diagnostic sampling controls.",
  },
} satisfies Record<keyof SimulationVariablePolicy, { title: string; description: string }>;

const SIMULATION_VARIABLE_POLICY_MODE_BUCKETS: SimulationVariablePolicyModeBucketKey[] = [
  "sharedDefaults",
  "intervalOverrides",
  "manualMonthlyOverrides",
  "manualAnnualOverrides",
  "newBuildOverrides",
];

const MODE_BUCKET_SOURCE_LABEL: Record<Exclude<SimulationVariablePolicyModeBucketKey, "sharedDefaults">, Exclude<SimulationVariableValueSource, "shared default" | "explicit admin override">> = {
  intervalOverrides: "interval override",
  manualMonthlyOverrides: "manual monthly override",
  manualAnnualOverrides: "manual annual override",
  newBuildOverrides: "new build override",
};

function createFamilyConfig<T extends Record<string, unknown>>(sharedDefaults: T): SimulationVariableFamilyConfig<T> {
  return {
    sharedDefaults,
    intervalOverrides: {},
    manualMonthlyOverrides: {},
    manualAnnualOverrides: {},
    newBuildOverrides: {},
  };
}

export const DEFAULT_SIMULATION_VARIABLE_POLICY_CONFIG: SimulationVariablePolicyConfig = {
  pastDayCore: createFamilyConfig(DEFAULT_SIMULATION_VARIABLE_POLICY.pastDayCore),
  weatherShaping: createFamilyConfig(DEFAULT_SIMULATION_VARIABLE_POLICY.weatherShaping),
  engineProfile: createFamilyConfig(DEFAULT_SIMULATION_VARIABLE_POLICY.engineProfile),
  weatherSensitivityScoring: createFamilyConfig(DEFAULT_SIMULATION_VARIABLE_POLICY.weatherSensitivityScoring),
  lowDataWeatherEvidence: createFamilyConfig(DEFAULT_SIMULATION_VARIABLE_POLICY.lowDataWeatherEvidence),
  adapterCanonicalInput: createFamilyConfig(DEFAULT_SIMULATION_VARIABLE_POLICY.adapterCanonicalInput),
  constraintRebalance: createFamilyConfig(DEFAULT_SIMULATION_VARIABLE_POLICY.constraintRebalance),
  donorFallbackExclusions: createFamilyConfig(DEFAULT_SIMULATION_VARIABLE_POLICY.donorFallbackExclusions),
  intradayShapeReconstruction: createFamilyConfig(DEFAULT_SIMULATION_VARIABLE_POLICY.intradayShapeReconstruction),
  compareTuningMetrics: createFamilyConfig(DEFAULT_SIMULATION_VARIABLE_POLICY.compareTuningMetrics),
};

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

function resolveModeBucketKey(inputType: SimulationVariableInputType): Exclude<SimulationVariablePolicyModeBucketKey, "sharedDefaults"> {
  switch (inputType) {
    case "MANUAL_MONTHLY":
      return "manualMonthlyOverrides";
    case "MANUAL_ANNUAL":
      return "manualAnnualOverrides";
    case "NEW_BUILD":
      return "newBuildOverrides";
    case "INTERVAL":
    default:
      return "intervalOverrides";
  }
}

function familyConfigFor<T extends Record<string, unknown>>(
  familyKey: keyof SimulationVariablePolicy
): SimulationVariableFamilyConfig<T> {
  return DEFAULT_SIMULATION_VARIABLE_POLICY_CONFIG[familyKey] as unknown as SimulationVariableFamilyConfig<T>;
}

function sanitizeFamilyOverride<T extends Record<string, unknown>>(
  config: SimulationVariableFamilyConfig<T>,
  raw: unknown
): Partial<SimulationVariableFamilyConfig<T>> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const incoming = raw as Record<string, unknown>;
  return {
    sharedDefaults: pickKnownOverrideValues(config.sharedDefaults, incoming.sharedDefaults as Record<string, unknown> | undefined),
    intervalOverrides: pickKnownOverrideValues(config.sharedDefaults, incoming.intervalOverrides as Record<string, unknown> | undefined),
    manualMonthlyOverrides: pickKnownOverrideValues(config.sharedDefaults, incoming.manualMonthlyOverrides as Record<string, unknown> | undefined),
    manualAnnualOverrides: pickKnownOverrideValues(config.sharedDefaults, incoming.manualAnnualOverrides as Record<string, unknown> | undefined),
    newBuildOverrides: pickKnownOverrideValues(config.sharedDefaults, incoming.newBuildOverrides as Record<string, unknown> | undefined),
  } as Partial<SimulationVariableFamilyConfig<T>>;
}

function resolveFamilyForMode<T extends Record<string, unknown>>(args: {
  config: SimulationVariableFamilyConfig<T>;
  overrides: Partial<SimulationVariableFamilyConfig<T>> | undefined;
  modeBucketKey: Exclude<SimulationVariablePolicyModeBucketKey, "sharedDefaults">;
}): EffectiveSimulationVariableFamilySnapshot<T> {
  const resolved = {
    ...args.config.sharedDefaults,
  } as Record<string, unknown>;
  const valueSources = {} as Record<string, { value: unknown; valueSource: SimulationVariableValueSource }>;
  const modeSource = MODE_BUCKET_SOURCE_LABEL[args.modeBucketKey];
  const explicitAdminOverrideKeys = new Set<keyof T>();

  for (const key of Object.keys(args.config.sharedDefaults) as Array<keyof T>) {
    resolved[key as string] = args.config.sharedDefaults[key];
    valueSources[key as string] = {
      value: args.config.sharedDefaults[key],
      valueSource: "shared default",
    };
  }

  const builtInModeOverrides = (args.config[args.modeBucketKey] ?? {}) as Partial<T>;
  for (const key of Object.keys(args.config.sharedDefaults) as Array<keyof T>) {
    const builtInValue = builtInModeOverrides[key];
    if (typeof builtInValue === "number" && Number.isFinite(builtInValue)) {
      resolved[key as string] = builtInValue;
      valueSources[key as string] = { value: builtInValue, valueSource: modeSource };
    }
  }

  const adminShared = (args.overrides?.sharedDefaults ?? {}) as Partial<T>;
  const adminMode = (args.overrides?.[args.modeBucketKey] ?? {}) as Partial<T>;
  for (const incoming of [adminShared, adminMode]) {
    for (const key of Object.keys(args.config.sharedDefaults) as Array<keyof T>) {
      const adminValue = incoming[key];
      if (typeof adminValue === "number" && Number.isFinite(adminValue)) {
        resolved[key as string] = adminValue;
        valueSources[key as string] = { value: adminValue, valueSource: "explicit admin override" };
        explicitAdminOverrideKeys.add(key);
      }
    }
  }

  return {
    resolvedValues: resolved as T,
    valuesByKey: valueSources as EffectiveSimulationVariableFamilySnapshot<T>["valuesByKey"],
    modeBucketUsed: modeSource,
    explicitAdminOverrideKeys: Array.from(explicitAdminOverrideKeys),
  };
}

export function mergeSimulationVariablePolicyOverrides(
  overrides: SimulationVariablePolicyOverrides | null | undefined,
  inputType: SimulationVariableInputType = "INTERVAL"
): SimulationVariablePolicy {
  return resolveSimulationVariablePolicyForInputType(inputType, overrides).effective;
}

export function sanitizeSimulationVariableOverrides(raw: unknown): SimulationVariablePolicyOverrides {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const overrides = raw as Record<string, unknown>;
  return {
    pastDayCore: sanitizeFamilyOverride(familyConfigFor("pastDayCore"), overrides.pastDayCore),
    weatherShaping: sanitizeFamilyOverride(familyConfigFor("weatherShaping"), overrides.weatherShaping),
    engineProfile: sanitizeFamilyOverride(familyConfigFor("engineProfile"), overrides.engineProfile),
    weatherSensitivityScoring: sanitizeFamilyOverride(familyConfigFor("weatherSensitivityScoring"), overrides.weatherSensitivityScoring),
    lowDataWeatherEvidence: sanitizeFamilyOverride(familyConfigFor("lowDataWeatherEvidence"), overrides.lowDataWeatherEvidence),
    adapterCanonicalInput: sanitizeFamilyOverride(familyConfigFor("adapterCanonicalInput"), overrides.adapterCanonicalInput),
    constraintRebalance: sanitizeFamilyOverride(familyConfigFor("constraintRebalance"), overrides.constraintRebalance),
    donorFallbackExclusions: sanitizeFamilyOverride(familyConfigFor("donorFallbackExclusions"), overrides.donorFallbackExclusions),
    intradayShapeReconstruction: sanitizeFamilyOverride(familyConfigFor("intradayShapeReconstruction"), overrides.intradayShapeReconstruction),
    compareTuningMetrics: sanitizeFamilyOverride(familyConfigFor("compareTuningMetrics"), overrides.compareTuningMetrics),
  };
}

export function resolveSimulationVariablePolicyForInputType(
  inputType: SimulationVariableInputType,
  rawOverrides?: SimulationVariablePolicyOverrides | null
): {
  effective: SimulationVariablePolicy;
  effectiveSimulationVariablesUsed: EffectiveSimulationVariablesUsed;
} {
  const overrides = sanitizeSimulationVariableOverrides(rawOverrides ?? {});
  const modeBucketKey = resolveModeBucketKey(inputType);
  const pastDayCore = resolveFamilyForMode({ config: familyConfigFor("pastDayCore"), overrides: overrides.pastDayCore, modeBucketKey });
  const weatherShaping = resolveFamilyForMode({ config: familyConfigFor("weatherShaping"), overrides: overrides.weatherShaping, modeBucketKey });
  const engineProfile = resolveFamilyForMode({ config: familyConfigFor("engineProfile"), overrides: overrides.engineProfile, modeBucketKey });
  const weatherSensitivityScoring = resolveFamilyForMode({
    config: familyConfigFor("weatherSensitivityScoring"),
    overrides: overrides.weatherSensitivityScoring,
    modeBucketKey,
  });
  const lowDataWeatherEvidence = resolveFamilyForMode({
    config: familyConfigFor("lowDataWeatherEvidence"),
    overrides: overrides.lowDataWeatherEvidence,
    modeBucketKey,
  });
  const adapterCanonicalInput = resolveFamilyForMode({
    config: familyConfigFor("adapterCanonicalInput"),
    overrides: overrides.adapterCanonicalInput,
    modeBucketKey,
  });
  const constraintRebalance = resolveFamilyForMode({
    config: familyConfigFor("constraintRebalance"),
    overrides: overrides.constraintRebalance,
    modeBucketKey,
  });
  const donorFallbackExclusions = resolveFamilyForMode({
    config: familyConfigFor("donorFallbackExclusions"),
    overrides: overrides.donorFallbackExclusions,
    modeBucketKey,
  });
  const intradayShapeReconstruction = resolveFamilyForMode({
    config: familyConfigFor("intradayShapeReconstruction"),
    overrides: overrides.intradayShapeReconstruction,
    modeBucketKey,
  });
  const compareTuningMetrics = resolveFamilyForMode({
    config: familyConfigFor("compareTuningMetrics"),
    overrides: overrides.compareTuningMetrics,
    modeBucketKey,
  });

  const effective = {
    pastDayCore: pastDayCore.resolvedValues,
    weatherShaping: weatherShaping.resolvedValues,
    engineProfile: engineProfile.resolvedValues,
    weatherSensitivityScoring: weatherSensitivityScoring.resolvedValues,
    lowDataWeatherEvidence: lowDataWeatherEvidence.resolvedValues,
    adapterCanonicalInput: adapterCanonicalInput.resolvedValues,
    constraintRebalance: constraintRebalance.resolvedValues,
    donorFallbackExclusions: donorFallbackExclusions.resolvedValues,
    intradayShapeReconstruction: intradayShapeReconstruction.resolvedValues,
    compareTuningMetrics: compareTuningMetrics.resolvedValues,
  } as SimulationVariablePolicy;

  const effectiveSimulationVariablesUsed: EffectiveSimulationVariablesUsed = {
    inputType,
    runIdentityLinkage: {
      artifactId: null,
      artifactInputHash: null,
      buildInputsHash: null,
      engineVersion: null,
      houseId: null,
      actualContextHouseId: null,
      scenarioId: null,
    },
    familyByFamilyResolvedValues: {
      pastDayCore,
      weatherShaping,
      engineProfile,
      weatherSensitivityScoring,
      lowDataWeatherEvidence,
      adapterCanonicalInput,
      constraintRebalance,
      donorFallbackExclusions,
      intradayShapeReconstruction,
      compareTuningMetrics,
    } as EffectiveSimulationVariablesUsed["familyByFamilyResolvedValues"],
    resolvedWeatherShapingMode:
      inputType === "INTERVAL" ? "interval_based_shared_path" : inputType === "NEW_BUILD" ? "shared_weather_path_without_interval_score" : "billing_period_shared_path",
    resolvedRebalanceMode:
      inputType === "INTERVAL" ? "interval_reference_authoritative" : inputType === "NEW_BUILD" ? "synthetic_target_authoritative" : "manual_target_authoritative",
    resolvedFallbackMode: "shared_donor_fallback_exclusion_ladder",
    resolvedIntradayReconstructionControls:
      intradayShapeReconstruction.resolvedValues as SimulationVariablePolicy["intradayShapeReconstruction"],
    resolvedCompareTuningThresholds:
      compareTuningMetrics.resolvedValues as SimulationVariablePolicy["compareTuningMetrics"],
  };

  return { effective, effectiveSimulationVariablesUsed };
}

export function attachRunIdentityToEffectiveSimulationVariablesUsed(
  snapshot: EffectiveSimulationVariablesUsed | null | undefined,
  runIdentityLinkage: EffectiveSimulationVariablesUsed["runIdentityLinkage"]
): EffectiveSimulationVariablesUsed | null {
  if (!snapshot) return null;
  return {
    ...snapshot,
    runIdentityLinkage,
  };
}

export function buildEffectivePoliciesByMode(
  overrides: SimulationVariablePolicyOverrides | null | undefined
): Record<SimulationVariableInputType, SimulationVariablePolicy> {
  return {
    INTERVAL: resolveSimulationVariablePolicyForInputType("INTERVAL", overrides).effective,
    MANUAL_MONTHLY: resolveSimulationVariablePolicyForInputType("MANUAL_MONTHLY", overrides).effective,
    MANUAL_ANNUAL: resolveSimulationVariablePolicyForInputType("MANUAL_ANNUAL", overrides).effective,
    NEW_BUILD: resolveSimulationVariablePolicyForInputType("NEW_BUILD", overrides).effective,
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
  effectiveByMode: Record<SimulationVariableInputType, SimulationVariablePolicy>;
  overrides: SimulationVariablePolicyOverrides;
}> {
  const overrides = await getSimulationVariableOverrides();
  return {
    effectiveByMode: buildEffectivePoliciesByMode(overrides),
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

