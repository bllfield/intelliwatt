type AnyRecord = Record<string, unknown>;

function asRecord(value: unknown): AnyRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as AnyRecord) : {};
}

function maybeRecord(value: unknown): AnyRecord | null {
  const record = asRecord(value);
  return Object.keys(record).length > 0 ? record : null;
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function asString(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : String(value ?? "").trim();
  return text.length > 0 ? text : null;
}

function asNumber(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function round4(value: number | null): number | null {
  return value == null ? null : Math.round(value * 10000) / 10000;
}

function parseJsonRecord(value: unknown): AnyRecord | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as AnyRecord;
  if (typeof value !== "string" || value.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as AnyRecord) : null;
  } catch {
    return null;
  }
}

function pickTestDataset(base: AnyRecord): AnyRecord | null {
  const result = asRecord(base.result);
  const baselineProjection = asRecord(result.baselineDatasetProjection);
  const displayProjection = asRecord(result.displayDatasetProjection);
  const derived = asRecord(base.derived);
  const testHouseOverride = asRecord(derived.testHouseOverride);
  return maybeRecord(baselineProjection.dataset) ?? maybeRecord(displayProjection.dataset) ?? maybeRecord(testHouseOverride.dataset) ?? null;
}

function pickActualDataset(base: AnyRecord): AnyRecord | null {
  const snapshot = asRecord(base.pastSimSnapshot);
  const reads = asRecord(snapshot.reads);
  const baselineProjection = asRecord(reads.baselineProjection);
  const derived = asRecord(base.derived);
  const actualHouseOverride = asRecord(derived.actualHouseOverride);
  return maybeRecord(baselineProjection.dataset) ?? maybeRecord(actualHouseOverride.dataset) ?? null;
}

function countBy(items: Array<AnyRecord>, key: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const label = asString(item[key]) ?? "unknown";
    counts[label] = (counts[label] ?? 0) + 1;
  }
  return counts;
}

function deriveUsageInputMode(result: AnyRecord, formState: AnyRecord): string | null {
  return (
    asString(result.usageInputMode) ??
    asString(result.treatmentMode) ??
    asString(result.manualDateSourceMode) ??
    asString(formState.adminLabTreatmentMode)
  );
}

function deriveValidationMode(result: AnyRecord, formState: AnyRecord): string | null {
  return (
    asString(result.effectiveValidationSelectionMode) ??
    asString(result.adminValidationMode) ??
    asString(formState.adminLabValidationSelectionMode) ??
    asString(result.testSelectionMode)
  );
}

function extractProfileInputs(base: AnyRecord): AnyRecord {
  const result = asRecord(base.result);
  const formState = asRecord(base.formState);
  const homeProfile = maybeRecord(result.homeProfile) ?? parseJsonRecord(formState.homeProfileJson) ?? {};
  const applianceProfile = maybeRecord(result.applianceProfile) ?? parseJsonRecord(formState.applianceProfileJson) ?? {};
  const occupants = asRecord(homeProfile.occupants);
  const pool = asRecord(homeProfile.pool);
  const ev = asRecord(homeProfile.ev);
  const appliances = asArray<AnyRecord>(applianceProfile.appliances).map((item) => ({
    type: asString(item.type ?? item.kind),
    age: asNumber(item.age ?? item.ageYears),
    seer: asNumber(item.seer ?? item.seer2),
    heat_source: asString(item.heat_source ?? item.heatSource),
    system_type: asString(item.system_type ?? item.systemType),
    data: asRecord(item.data),
  }));

  return {
    squareFeet: asNumber(homeProfile.squareFeet),
    homeAge: asNumber(homeProfile.homeAge ?? homeProfile.yearBuilt),
    stories: asNumber(homeProfile.stories),
    homeStyle: asString(homeProfile.homeStyle),
    insulation: asString(homeProfile.insulation),
    insulationType: asString(homeProfile.insulationType),
    windows: asString(homeProfile.windows),
    windowType: asString(homeProfile.windowType),
    foundation: asString(homeProfile.foundation),
    fuelConfiguration: homeProfile.fuelConfiguration ?? applianceProfile.fuelConfiguration ?? null,
    hvacType: asString(homeProfile.hvacType),
    heatingType: asString(homeProfile.heatingType),
    thermostatSummerF: asNumber(homeProfile.thermostatSummerF ?? homeProfile.summerTemp),
    thermostatWinterF: asNumber(homeProfile.thermostatWinterF ?? homeProfile.winterTemp),
    summerTemp: asNumber(homeProfile.summerTemp),
    winterTemp: asNumber(homeProfile.winterTemp),
    smartThermostat: Boolean(homeProfile.smartThermostat),
    ledLights: Boolean(homeProfile.ledLights),
    occupantsSummary: {
      total: asNumber(occupants.total ?? homeProfile.occupantsTotal),
      work: asNumber(occupants.work ?? homeProfile.occupantsWork),
      school: asNumber(occupants.school ?? homeProfile.occupantsSchool),
      homeAllDay: asNumber(occupants.homeAllDay ?? homeProfile.occupantsHomeAllDay),
    },
    poolSummary: {
      hasPool: Boolean(homeProfile.hasPool ?? pool.hasPool),
      pumpHp: asNumber(homeProfile.poolPumpHp ?? pool.pumpHp),
    },
    evSummary: {
      hasVehicle: Boolean(homeProfile.evHasVehicle ?? ev.hasVehicle),
      chargerLevel: asString(ev.chargerLevel),
    },
    coreApplianceSummary: appliances,
  };
}

function buildManualStage1Contract(result: AnyRecord): AnyRecord | null {
  const readModel = asRecord(result.manualReadModel);
  const billPeriods = asArray<AnyRecord>(readModel.manualBillPeriods);
  if (billPeriods.length === 0 && !asString(result.manualAnchorEndDate)) return null;

  return {
    anchorEndDate: asString(result.manualAnchorEndDate),
    billEndDay: asString(result.manualBillEndDay),
    eligibleRangeCount: billPeriods.filter((period) => Boolean(period.eligibleForConstraint)).length,
    ineligibleRangeCount: billPeriods.filter((period) => !period.eligibleForConstraint).length,
    billPeriods: billPeriods.map((period) => ({
      month: asString(period.monthKey ?? period.month),
      billPeriod: asString(period.label ?? period.id),
      label: asString(period.label ?? period.id),
      enteredKwh: asNumber(period.enteredKwh),
      eligibleForConstraint: Boolean(period.eligibleForConstraint),
      exclusionReason: asString(period.exclusionReason),
    })),
    manualBillPeriodTotalsKwhById: readModel.manualBillPeriodTotalsKwhById ?? null,
    normalizedMonthTargetsByMonth: readModel.normalizedMonthTargetsByMonth ?? null,
  };
}

function mergeWeatherSide(score: AnyRecord, derivedInput: AnyRecord | null): AnyRecord | null {
  if (Object.keys(score).length === 0 && (!derivedInput || Object.keys(derivedInput).length === 0)) return null;
  return {
    scoringMode: asString(score.scoringMode ?? derivedInput?.scoringMode),
    weatherEfficiencyScore0to100: asNumber(score.weatherEfficiencyScore0to100 ?? derivedInput?.weatherEfficiencyScore0to100),
    coolingSensitivityScore0to100: asNumber(score.coolingSensitivityScore0to100 ?? derivedInput?.coolingSensitivityScore0to100),
    heatingSensitivityScore0to100: asNumber(score.heatingSensitivityScore0to100 ?? derivedInput?.heatingSensitivityScore0to100),
    confidenceScore0to100: asNumber(score.confidenceScore0to100 ?? derivedInput?.confidenceScore0to100),
    shoulderBaselineKwhPerDay: asNumber(score.shoulderBaselineKwhPerDay ?? derivedInput?.shoulderBaselineKwhPerDay),
    coolingSlopeKwhPerCDD: asNumber(score.coolingSlopeKwhPerCDD ?? derivedInput?.coolingSlopeKwhPerCDD),
    heatingSlopeKwhPerHDD: asNumber(score.heatingSlopeKwhPerHDD ?? derivedInput?.heatingSlopeKwhPerHDD),
    coolingResponseRatio: asNumber(score.coolingResponseRatio ?? derivedInput?.coolingResponseRatio),
    heatingResponseRatio: asNumber(score.heatingResponseRatio ?? derivedInput?.heatingResponseRatio),
    requiredInputAdjustmentsApplied:
      score.requiredInputAdjustmentsApplied ?? derivedInput?.requiredInputAdjustmentsApplied ?? [],
    derivedInputAttached: derivedInput?.derivedInputAttached ?? null,
    simulationActive: derivedInput?.simulationActive ?? null,
    scoreVersion: asString(score.scoreVersion ?? derivedInput?.scoreVersion),
    calculationVersion: asString(score.calculationVersion ?? derivedInput?.calculationVersion),
  };
}

function buildWeatherDeltaVsActual(actual: AnyRecord | null, manual: AnyRecord | null): AnyRecord | null {
  if (!actual || !manual) return null;
  const delta = (manualValue: unknown, actualValue: unknown) => {
    const manualNum = asNumber(manualValue);
    const actualNum = asNumber(actualValue);
    return manualNum == null || actualNum == null ? null : round4(manualNum - actualNum);
  };

  return {
    weatherEfficiencyScoreDelta: delta(manual.weatherEfficiencyScore0to100, actual.weatherEfficiencyScore0to100),
    coolingSensitivityScoreDelta: delta(manual.coolingSensitivityScore0to100, actual.coolingSensitivityScore0to100),
    heatingSensitivityScoreDelta: delta(manual.heatingSensitivityScore0to100, actual.heatingSensitivityScore0to100),
    confidenceScoreDelta: delta(manual.confidenceScore0to100, actual.confidenceScore0to100),
    shoulderBaselineDelta: delta(manual.shoulderBaselineKwhPerDay, actual.shoulderBaselineKwhPerDay),
    coolingSlopeDelta: delta(manual.coolingSlopeKwhPerCDD, actual.coolingSlopeKwhPerCDD),
    heatingSlopeDelta: delta(manual.heatingSlopeKwhPerHDD, actual.heatingSlopeKwhPerHDD),
    coolingResponseRatioDelta: delta(manual.coolingResponseRatio, actual.coolingResponseRatio),
    heatingResponseRatioDelta: delta(manual.heatingResponseRatio, actual.heatingResponseRatio),
  };
}

function buildSharedWeatherEfficiency(base: AnyRecord, testDataset: AnyRecord | null, actualDataset: AnyRecord | null): AnyRecord {
  const result = asRecord(base.result);
  const compare = asRecord(result.manualMonthlyWeatherCompare);
  const sourceInterval = asRecord(compare.sourceInterval);
  const manualMonthly = asRecord(compare.manualMonthly);

  const actualScore = mergeWeatherSide(
    maybeRecord(sourceInterval.score) ?? asRecord(asRecord(actualDataset?.meta).weatherSensitivityScore),
    maybeRecord(sourceInterval.derivedInput) ?? asRecord(asRecord(actualDataset?.meta).weatherEfficiencyDerivedInput)
  );
  const manualScore = mergeWeatherSide(
    maybeRecord(manualMonthly.score) ?? asRecord(asRecord(testDataset?.meta).weatherSensitivityScore),
    maybeRecord(manualMonthly.derivedInput) ?? asRecord(asRecord(testDataset?.meta).weatherEfficiencyDerivedInput)
  );

  return {
    actualIntervalWeather: actualScore,
    manualMonthlyWeather: manualScore,
    weatherDeltaVsActual: buildWeatherDeltaVsActual(actualScore, manualScore),
  };
}

function buildStage2Outputs(testDataset: AnyRecord | null): AnyRecord {
  const meta = asRecord(testDataset?.meta);
  const monthly = asArray<AnyRecord>(testDataset?.monthly);
  const daily = asArray<AnyRecord>(testDataset?.daily);
  const perDayTrace = asArray<AnyRecord>(meta.lockboxPerDayTrace);

  return {
    modeledDayReasonCounts: countBy(perDayTrace, "simulatedReasonCode"),
    monthlyTotalsByMonth: monthly.map((row) => ({
      month: asString(row.month ?? row.date),
      totalKwh: asNumber(row.totalKwh ?? row.kwh ?? row.value),
    })),
    dailySourceClassificationsSummary: countBy(perDayTrace, "dayClassification"),
    sourceDetailCountsByCategory: countBy(
      daily.map((row) => ({ sourceDetail: row.sourceDetail ?? row.source })),
      "sourceDetail"
    ),
    intervalCount:
      asNumber(meta.intervalCount) ??
      asArray<AnyRecord>(asRecord(testDataset?.series).intervals15).length,
    dailyRowCount: asNumber(meta.dailyRowCount) ?? daily.length,
    sharedProducerPathUsed: Boolean(meta.sharedProducerPathUsed),
  };
}

function buildActualVsSimCompare(base: AnyRecord): AnyRecord {
  const derived = asRecord(base.derived);
  const result = asRecord(base.result);
  const resultCompareProjection = maybeRecord(result.compareProjection);
  const derivedCompareProjection = maybeRecord(derived.testHouseCompareProjection);
  const metrics = asRecord(resultCompareProjection?.metrics ?? derivedCompareProjection?.metrics);
  const rows = asArray<AnyRecord>(resultCompareProjection?.rows ?? derivedCompareProjection?.rows);

  return {
    compareMetrics: {
      WAPE: asNumber(metrics.wape ?? metrics.WAPE),
      MAE: asNumber(metrics.mae ?? metrics.MAE),
      RMSE: asNumber(metrics.rmse ?? metrics.RMSE),
      MaxAbs: asNumber(metrics.maxAbs ?? metrics.max_abs),
      totalActualKwhMasked: asNumber(metrics.totalActualKwhMasked),
      totalSimKwhMasked: asNumber(metrics.totalSimKwhMasked),
      deltaKwhMasked: asNumber(metrics.deltaKwhMasked),
      compareRowsCount: asNumber(metrics.compareRowsCount ?? rows.length),
    },
    compareRows: rows.map((row) => {
      const weather = asRecord(row.weather);
      return {
        date: asString(row.localDate ?? row.date),
        dayType: asString(row.dayType),
        avgF: asNumber(row.avgTempF ?? weather.avgTempF),
        minF: asNumber(row.minTempF ?? weather.minTempF),
        maxF: asNumber(row.maxTempF ?? weather.maxTempF),
        HDD65: asNumber(row.hdd65 ?? weather.hdd65),
        CDD65: asNumber(row.cdd65 ?? weather.cdd65),
        actualKwh: asNumber(row.actualDayKwh ?? row.actualKwh),
        simKwh: asNumber(row.simulatedDayKwh ?? row.simKwh),
        errorKwh: asNumber(row.errorKwh),
        percentError: asNumber(row.percentError),
      };
    }),
  };
}

function buildDailyShapeTuning(base: AnyRecord): AnyRecord {
  const summary = asRecord(base.dailyCurveCompareSummary);
  return {
    representativeDayGroupShapeSummaries: summary.aggregates ?? [],
    hourBlockBiasSummaries: summary.hourBlockBiases ?? [],
    slotLevelMetricsSummaries: summary.slotMetrics ?? [],
    rawPerDayActualVsSimCurveCompareSummaries: summary.days ?? [],
    metrics: summary.metrics ?? null,
    rawContext: summary.rawContext ?? null,
  };
}

function buildSourceTruthContext(base: AnyRecord, testDataset: AnyRecord | null): AnyRecord {
  const result = asRecord(base.result);
  const meta = asRecord(testDataset?.meta);
  const lockboxInput = asRecord(meta.lockboxInput);
  const sourceContext = asRecord(lockboxInput.sourceContext);
  const profileContext = asRecord(lockboxInput.profileContext);
  const travelRanges = asRecord(lockboxInput.travelRanges);
  const validationKeys = asRecord(lockboxInput.validationKeys);

  return {
    sourceIntervalFingerprint: asString(sourceContext.intervalFingerprint),
    weatherIdentity: asString(sourceContext.weatherIdentity),
    usageShapeProfileIdentity:
      asString(profileContext.usageShapeProfileIdentity) ?? asString(meta.intervalUsageFingerprintIdentity),
    trustedFingerprintReferencePoolDiagnostics: result.fingerprintBuildFreshness ?? null,
    sourceDerivedMonthlyAnchors: sourceContext.sourceDerivedMonthlyTotalsKwhByMonth ?? meta.sourceDerivedMonthlyTotalsKwhByMonth ?? null,
    sourceDerivedAnnualTotal: asNumber(sourceContext.sourceDerivedAnnualTotalKwh ?? meta.sourceDerivedAnnualTotalKwh),
    validationTestKeysUsed: validationKeys.localDateKeys ?? null,
    travelRangesUsed: travelRanges.ranges ?? null,
    exclusionDrivingCanonicalInputSummary: {
      excludedDateKeysCount: asNumber(meta.excludedDateKeysCount),
      excludedDateKeysFingerprint: asString(meta.excludedDateKeysFingerprint),
    },
  };
}

function buildSharedCalculationInputs(base: AnyRecord, testDataset: AnyRecord | null): AnyRecord {
  const meta = asRecord(testDataset?.meta);
  const calcSummary = asRecord(base.calculationLogicSummary);
  const perDayTrace = asArray<AnyRecord>(meta.lockboxPerDayTrace);

  return {
    weatherEfficiencyDerivedInput: meta.weatherEfficiencyDerivedInput ?? null,
    weatherResponsivenessInputsActuallyUsedBySim: meta.weatherEfficiencySimulationSummary ?? calcSummary.weatherExplanation ?? null,
    monthlyTargetConstructionDiagnostics: meta.monthlyTargetConstructionDiagnostics ?? null,
    manualMonthlyWeatherEvidenceSummary: meta.manualMonthlyWeatherEvidenceSummary ?? null,
    donorSourceDiagnostics: calcSummary.dailyTotalLogic ?? null,
    resolvedSimFingerprintOrBlendIdentity: meta.resolvedSimFingerprint ?? null,
    usageShapeSelectionInputs: {
      shapeBucketSummaries: calcSummary.shapeBucketSummaries ?? [],
      intervalShapeLogic: calcSummary.intervalCurveLogic ?? null,
    },
    fallbackDiagnostics: {
      dailyTotalLogic: calcSummary.dailyTotalLogic ?? null,
      exclusions: calcSummary.exclusions ?? [],
    },
    fallbackFrequency: calcSummary.runImpactSummary ?? null,
    dayReasonCounts: countBy(perDayTrace, "simulatedReasonCode"),
    modelReasonCounts: countBy(perDayTrace, "dayClassification"),
    exclusionCounts: {
      excludedDateKeysCount: asNumber(meta.excludedDateKeysCount),
      excludedDateKeysFingerprint: asString(meta.excludedDateKeysFingerprint),
    },
    weatherScalingCapsOrControls: calcSummary.weatherExplanation ?? null,
  };
}

function buildParityAndReconciliation(result: AnyRecord): AnyRecord {
  const readModel = asRecord(result.manualReadModel);
  const parityRows =
    asArray<AnyRecord>(readModel.parityRows).length > 0
      ? asArray<AnyRecord>(readModel.parityRows)
      : asArray<AnyRecord>(asRecord(result.manualMonthlyReconciliation).rows);

  return {
    parityRows: parityRows.map((row) => ({
      month: asString(row.month ?? row.monthKey),
      billPeriod: asString(row.billPeriod ?? row.label),
      actualInterval: asNumber(row.actualIntervalKwh ?? row.actualKwh),
      stage1Target: asNumber(row.stage1TargetKwh ?? row.targetKwh),
      finalSimulated: asNumber(row.simulatedKwh ?? row.finalSimulatedKwh),
      simVsActual: asNumber(row.simVsActualKwh ?? row.deltaVsActualKwh),
      simVsTarget: asNumber(row.simVsTargetKwh ?? row.deltaVsTargetKwh),
      parityContract: asString(row.parityContract),
      status: asString(row.status),
    })),
  };
}

function buildTuningLeversSummary(base: AnyRecord): AnyRecord {
  const result = asRecord(base.result);
  const parity = asRecord(result.manualParitySummary);
  const calcSummary = asRecord(base.calculationLogicSummary);
  const runImpactSummary = asArray<AnyRecord>(calcSummary.runImpactSummary);

  const findImpact = (label: string) =>
    runImpactSummary.find((item) => asString(item.label)?.toLowerCase() === label.toLowerCase()) ?? null;

  return {
    monthlyConstraintQuality: parity.monthlyConstraintQuality ?? findImpact("monthly constraint quality")?.value ?? null,
    validationTestDayComposition: parity.validationComposition ?? findImpact("validation / test-day composition")?.value ?? null,
    weatherScalingBehavior: parity.weatherScalingBehavior ?? findImpact("weather scaling behavior")?.value ?? null,
    shapeBucketQuality: parity.shapeBucketQuality ?? findImpact("shape bucket quality")?.value ?? null,
    fallbackFrequency: parity.fallbackFrequency ?? findImpact("fallback frequency")?.value ?? null,
    trustedReferencePoolQuality:
      parity.trustedReferencePoolQuality ?? findImpact("trusted reference-pool quality")?.value ?? null,
  };
}

export function buildGapfillFullTuningPayload<T extends Record<string, unknown>>(
  payloadBase: T,
  now: Date = new Date()
): {
  exportedAt: string;
  runIdentity: AnyRecord;
  sourceTruthContext: AnyRecord;
  profileInputsUsedBySim: AnyRecord;
  manualStage1Contract: AnyRecord | null;
  sharedWeatherEfficiency: AnyRecord;
  sharedCalculationInputs: AnyRecord;
  stage2SimOutputs: AnyRecord;
  parityAndReconciliation: AnyRecord;
  actualVsSimCompare: AnyRecord;
  dailyShapeTuning: AnyRecord;
  tuningLeversSummary: AnyRecord;
} {
  const base = asRecord(payloadBase);
  const result = asRecord(base.result);
  const formState = asRecord(base.formState);
  const testDataset = pickTestDataset(base);
  const actualDataset = pickActualDataset(base);
  const testMeta = asRecord(testDataset?.meta);

  return {
    exportedAt: now.toISOString(),
    runIdentity: {
      sourceUserId: asString(result.sourceUserId),
      sourceHouseId: asString(result.sourceHouseId ?? formState.sourceHouseId),
      testHouseId: asString(result.testHomeId),
      scenarioId: asString(result.scenarioId),
      simulatorMode: asString(result.simulatorMode),
      usageInputMode: deriveUsageInputMode(result, formState),
      adminSimulationTreatmentMode: asString(result.treatmentMode ?? formState.adminLabTreatmentMode),
      weatherLogicMode: asString(result.weatherLogicMode ?? testMeta.weatherLogicMode),
      validationMode: deriveValidationMode(result, formState),
      buildId: asString(result.buildId),
      buildInputsHash: asString(result.buildInputsHash ?? testMeta.buildInputsHash),
      artifactId: asString(result.artifactId),
      artifactInputHash: asString(result.artifactInputHash),
      fullChainHash: asString(result.fullChainHash ?? testMeta.fullChainHash),
      artifactEngineVersion: asString(result.artifactEngineVersion),
      correlationId: asString(result.correlationId),
      anchorEndDate: asString(result.manualAnchorEndDate),
      billEndDay: asString(result.manualBillEndDay),
      dateSourceMode: asString(result.manualDateSourceMode),
    },
    sourceTruthContext: buildSourceTruthContext(base, testDataset),
    profileInputsUsedBySim: extractProfileInputs(base),
    manualStage1Contract: buildManualStage1Contract(result),
    sharedWeatherEfficiency: buildSharedWeatherEfficiency(base, testDataset, actualDataset),
    sharedCalculationInputs: buildSharedCalculationInputs(base, testDataset),
    stage2SimOutputs: buildStage2Outputs(testDataset),
    parityAndReconciliation: buildParityAndReconciliation(result),
    actualVsSimCompare: buildActualVsSimCompare(base),
    dailyShapeTuning: buildDailyShapeTuning(base),
    tuningLeversSummary: buildTuningLeversSummary(base),
  };
}

