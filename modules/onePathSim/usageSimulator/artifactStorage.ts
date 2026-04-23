type AnyRecord = Record<string, unknown>;

function asRecord(value: unknown): AnyRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as AnyRecord) : null;
}

function asFiniteNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function asOptionalString(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : null;
}

function compactDateKeyList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item ?? "").slice(0, 10))
    .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item));
}

export function compactLockboxPerDayTraceForArtifactStorage(value: unknown): AnyRecord[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => {
      const item = asRecord(row);
      if (!item) return null;
      return {
        localDate: asOptionalString(item.localDate),
        simulatedReasonCode: asOptionalString(item.simulatedReasonCode),
        fallbackLevel: asOptionalString(item.fallbackLevel),
        clampApplied: item.clampApplied === true,
        dayClassification: asOptionalString(item.dayClassification),
        weatherSeverityMultiplier: asFiniteNumber(item.weatherSeverityMultiplier),
        weatherModeUsed: asOptionalString(item.weatherModeUsed),
        finalDayKwh: asFiniteNumber(item.finalDayKwh),
        displayDayKwh: asFiniteNumber(item.displayDayKwh),
        intervalSumKwh: asFiniteNumber(item.intervalSumKwh),
        shapeVariantUsed: asOptionalString(item.shapeVariantUsed),
        donorSelectionModeUsed: asOptionalString(item.donorSelectionModeUsed),
        donorCandidatePoolSize: asFiniteNumber(item.donorCandidatePoolSize),
        selectedDonorLocalDates: compactDateKeyList(item.selectedDonorLocalDates),
        donorWeatherRegimeUsed: asOptionalString(item.donorWeatherRegimeUsed),
        donorMonthKeyUsed: asOptionalString(item.donorMonthKeyUsed),
        thermalDistanceScore: asFiniteNumber(item.thermalDistanceScore),
        broadFallbackUsed: item.broadFallbackUsed === true,
        sameRegimeDonorPoolAvailable: item.sameRegimeDonorPoolAvailable === true,
        donorPoolBlendStrategy: asOptionalString(item.donorPoolBlendStrategy),
        donorPoolKwhSpread: asFiniteNumber(item.donorPoolKwhSpread),
        donorPoolKwhVariance: asFiniteNumber(item.donorPoolKwhVariance),
        donorPoolMedianKwh: asFiniteNumber(item.donorPoolMedianKwh),
        donorVarianceGuardrailTriggered: item.donorVarianceGuardrailTriggered === true,
        weatherAdjustmentModeUsed: asOptionalString(item.weatherAdjustmentModeUsed),
        postDonorAdjustmentCoefficient: asFiniteNumber(item.postDonorAdjustmentCoefficient),
        shape96Hash: asOptionalString(item.shape96Hash),
        templateSelectionKind: asOptionalString(item.templateSelectionKind),
        selectedFingerprintBucketMonth: asOptionalString(item.selectedFingerprintBucketMonth),
        selectedFingerprintBucketDayType: asOptionalString(item.selectedFingerprintBucketDayType),
        selectedFingerprintWeatherBucket: asOptionalString(item.selectedFingerprintWeatherBucket),
        selectedFingerprintIdentity: asOptionalString(item.selectedFingerprintIdentity),
        selectedReferencePoolCount: asFiniteNumber(item.selectedReferencePoolCount),
        weatherScalingCoefficientUsed: asFiniteNumber(item.weatherScalingCoefficientUsed),
        dayTotalBeforeWeatherScale: asFiniteNumber(item.dayTotalBeforeWeatherScale),
        dayTotalAfterWeatherScale: asFiniteNumber(item.dayTotalAfterWeatherScale),
        intervalShapeScalingMethod: asOptionalString(item.intervalShapeScalingMethod),
      };
    })
    .filter((row): row is AnyRecord => row != null);
}

export function buildPastArtifactDatasetJsonForStorage(args: {
  dataset: unknown;
  canonicalArtifactSimulatedDayTotalsByDate: Record<string, number>;
}): Record<string, unknown> {
  const dataset = asRecord(args.dataset) ?? {};
  const meta = asRecord(dataset.meta) ?? {};
  const series = asRecord(dataset.series) ?? {};
  const rawPerDayTrace = Array.isArray(meta.lockboxPerDayTrace) ? meta.lockboxPerDayTrace : [];
  return {
    ...dataset,
    canonicalArtifactSimulatedDayTotalsByDate: args.canonicalArtifactSimulatedDayTotalsByDate,
    meta: {
      ...meta,
      canonicalArtifactSimulatedDayTotalsByDate: args.canonicalArtifactSimulatedDayTotalsByDate,
      lockboxPerDayTrace: compactLockboxPerDayTraceForArtifactStorage(rawPerDayTrace),
      lockboxPerDayTraceCount: rawPerDayTrace.length,
      lockboxPerDayTraceStorageMode: "compact_v1",
    },
    series: {
      ...series,
      intervals15: [],
    },
  };
}
