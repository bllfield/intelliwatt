import { buildValidationCompareProjectionSidecar } from "@/modules/usageSimulator/compareProjection";
import type { ManualMonthlyReconciliation } from "@/modules/manualUsage/reconciliation";

export type SharedDiagnosticsCallerType =
  | "user_past"
  | "gapfill_actual"
  | "gapfill_test";

export type SharedPastSimDiagnostics = {
  identityContext: Record<string, unknown>;
  sourceTruthContext: Record<string, unknown>;
  lockboxExecutionSummary: Record<string, unknown>;
  projectionReadSummary: Record<string, unknown>;
  tuningSummary: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function meaningfulString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function normalizeRows(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((row) => row && typeof row === "object" && !Array.isArray(row)) as Array<Record<string, unknown>>
    : [];
}

function summarizeDailySources(dataset: any): Record<string, number> {
  const counts: Record<string, number> = {};
  const dailyRows = Array.isArray(dataset?.daily) ? dataset.daily : [];
  for (const row of dailyRows) {
    const source = String((row as any)?.sourceDetail ?? (row as any)?.source ?? "unknown").trim() || "unknown";
    counts[source] = (counts[source] ?? 0) + 1;
  }
  return counts;
}

function summarizeTuningRows(compareProjection: { rows?: unknown; metrics?: unknown } | null | undefined) {
  const rows = normalizeRows(compareProjection?.rows).map((row) => ({
    localDate: String(row.localDate ?? "").slice(0, 10),
    dayType: row.dayType === "weekend" ? "weekend" : "weekday",
    actualDayKwh: typeof row.actualDayKwh === "number" ? row.actualDayKwh : null,
    simulatedDayKwh: typeof row.simulatedDayKwh === "number" ? row.simulatedDayKwh : null,
    errorKwh: typeof row.errorKwh === "number" ? row.errorKwh : null,
    percentError: typeof row.percentError === "number" ? row.percentError : null,
    weather: asRecord(row.weather),
  }));
  return {
    selectedValidationRows: rows,
    validationMetricsSummary: asRecord(compareProjection?.metrics),
  };
}

export function buildSharedPastSimDiagnostics(args: {
  callerType: SharedDiagnosticsCallerType;
  dataset: any;
  scenarioId: string | null;
  correlationId?: string | null;
  usageInputMode?: string | null;
  validationPolicyOwner?: string | null;
  weatherLogicMode?: string | null;
  simulatorDiagnostic?: Record<string, unknown> | null;
  readMode?: string | null;
  projectionMode?: string | null;
  artifactId?: string | null;
  artifactInputHash?: string | null;
  artifactEngineVersion?: string | null;
  artifactPersistenceOutcome?: string | null;
  compareProjection?: { rows?: unknown; metrics?: unknown } | null;
  manualMonthlyReconciliation?: ManualMonthlyReconciliation | null;
}): SharedPastSimDiagnostics {
  const dataset = args.dataset ?? {};
  const meta = asRecord(dataset?.meta);
  const lockboxInput = asRecord(meta.lockboxInput);
  const sourceContext = asRecord(lockboxInput.sourceContext);
  const profileContext = asRecord(lockboxInput.profileContext);
  const validationKeys = asRecord(lockboxInput.validationKeys);
  const lockboxTrace = asRecord(meta.lockboxPerRunTrace);
  const stageTimings = asRecord(lockboxTrace.stageTimingsMs);
  const compareProjection =
    args.compareProjection ??
    buildValidationCompareProjectionSidecar(dataset);
  const simulatorDiagnostic = asRecord(args.simulatorDiagnostic);

  return {
    identityContext: {
      callerType: args.callerType,
      sourceHouseId: meaningfulString(lockboxTrace.sourceHouseId, sourceContext.sourceHouseId),
      profileHouseId: meaningfulString(lockboxTrace.profileHouseId, profileContext.profileHouseId),
      scenarioId: args.scenarioId,
      simulatorMode: meta.mode ?? lockboxInput.mode ?? null,
      usageInputMode: args.usageInputMode ?? lockboxInput.mode ?? null,
      validationPolicyOwner: args.validationPolicyOwner ?? null,
      weatherLogicMode:
        args.weatherLogicMode ??
        sourceContext.weatherLogicMode ??
        meta.weatherLogicMode ??
        null,
      correlationId: args.correlationId ?? asRecord(meta.lockboxRunContext).correlationId ?? null,
      buildPathKind:
        asRecord(meta.lockboxRunContext).buildPathKind ??
        (lockboxTrace.runContext
          ? asRecord(lockboxTrace.runContext).buildPathKind
          : null) ??
        meta.buildPathKind ??
        null,
      inputHash: lockboxTrace.inputHash ?? null,
      fullChainHash: lockboxTrace.fullChainHash ?? meta.fullChainHash ?? null,
    },
    sourceTruthContext: {
      sourceHouseId: meaningfulString(lockboxTrace.sourceHouseId, sourceContext.sourceHouseId),
      profileHouseId: meaningfulString(lockboxTrace.profileHouseId, profileContext.profileHouseId),
      canonicalCoverageWindow: sourceContext.window ?? {
        startDate: meta.coverageStart ?? dataset?.summary?.start ?? null,
        endDate: meta.coverageEnd ?? dataset?.summary?.end ?? null,
      },
      intervalSourceIdentity: sourceContext.intervalFingerprint ?? null,
      weatherSourceIdentity: meta.weatherSourceSummary ?? null,
      weatherDatasetIdentity:
        sourceContext.weatherIdentity ?? meta.weatherDatasetIdentity ?? null,
      sourceDerivedMonthlyTotalsKwhByMonth:
        sourceContext.sourceDerivedMonthlyTotalsKwhByMonth ??
        asRecord(meta.sourceDerivedMonthlyTotalsKwhByMonth) ??
        null,
      sourceDerivedAnnualTotalKwh:
        sourceContext.sourceDerivedAnnualTotalKwh ?? null,
      intervalUsageFingerprintIdentity:
        profileContext.usageShapeProfileIdentity ??
        meta.intervalUsageFingerprintIdentity ??
        null,
      intervalUsageFingerprintDiagnostics: {
        trustedIntervalFingerprintDayCount: meta.trustedIntervalFingerprintDayCount ?? null,
        excludedTravelVacantFingerprintDayCount: meta.excludedTravelVacantFingerprintDayCount ?? null,
        excludedIncompleteMeterFingerprintDayCount: meta.excludedIncompleteMeterFingerprintDayCount ?? null,
        excludedLeadingMissingFingerprintDayCount: meta.excludedLeadingMissingFingerprintDayCount ?? null,
        excludedOtherUntrustedFingerprintDayCount: meta.excludedOtherUntrustedFingerprintDayCount ?? null,
        fingerprintMonthBucketsUsed: Array.isArray(meta.fingerprintMonthBucketsUsed)
          ? meta.fingerprintMonthBucketsUsed
          : [],
        fingerprintWeekdayWeekendBucketsUsed: Array.isArray(meta.fingerprintWeekdayWeekendBucketsUsed)
          ? meta.fingerprintWeekdayWeekendBucketsUsed
          : [],
        fingerprintWeatherBucketsUsed: Array.isArray(meta.fingerprintWeatherBucketsUsed)
          ? meta.fingerprintWeatherBucketsUsed
          : [],
      },
      monthlyTargetConstructionDiagnostics: Array.isArray(meta.monthlyTargetConstructionDiagnostics)
        ? meta.monthlyTargetConstructionDiagnostics
        : null,
      manualMonthlyInputState: asRecord(meta.manualMonthlyInputState),
      manualMonthlyWeatherEvidenceSummary: asRecord(meta.manualMonthlyWeatherEvidenceSummary),
      manualTravelVacantDonorSource:
        typeof meta.manualTravelVacantDonorSource === "string" ? meta.manualTravelVacantDonorSource : null,
      manualTravelVacantDonorDayCount:
        typeof meta.manualTravelVacantDonorDayCount === "number" ? meta.manualTravelVacantDonorDayCount : null,
      manualBillPeriods: Array.isArray(meta.manualBillPeriods) ? meta.manualBillPeriods : [],
      manualBillPeriodTotalsKwhById: asRecord(meta.manualBillPeriodTotalsKwhById),
      travelRangesUsed: asRecord(lockboxInput.travelRanges).ranges ?? [],
      validationTestKeysUsed: validationKeys.localDateKeys ?? [],
      exclusionDrivingCanonicalInputsSummary: {
        excludedDateKeysCount: meta.excludedDateKeysCount ?? null,
        excludedDateKeysFingerprint: meta.excludedDateKeysFingerprint ?? null,
        actualContextHouseId: meta.actualContextHouseId ?? null,
      },
    },
    lockboxExecutionSummary: {
      exactStageListUsed: Object.keys(stageTimings).sort(),
      stageTimings,
      excludedDateKeyCount: meta.excludedDateKeysCount ?? null,
      simulatedDayResultsCount: meta.simulatedDayCount ?? null,
      keepRefUtcDateKeyCount: meta.gapfillForceModeledKeepRefUtcKeyCount ?? null,
      intervalCount: meta.intervalCount ?? null,
      dailyRowCount: meta.dailyRowCount ?? null,
      sharedProducerPathUsed: meta.sharedProducerPathUsed ?? null,
      artifactPersistenceOutcome: args.artifactPersistenceOutcome ?? null,
      artifactId: args.artifactId ?? null,
      artifactInputHash:
        args.artifactInputHash ??
        meta.artifactInputHashUsed ??
        meta.artifactInputHash ??
        null,
      artifactEngineVersion:
        args.artifactEngineVersion ??
        meta.artifactEngineVersion ??
        meta.simVersion ??
        null,
    },
    projectionReadSummary: {
      readMode: args.readMode ?? meta.artifactReadMode ?? null,
      projectionMode: args.projectionMode ?? asRecord(meta.lockboxReadContext).projectionMode ?? null,
      baselineProjectionSummary: {
        validationOnlyDateKeyCount: Array.isArray(meta.validationOnlyDateKeysLocal)
          ? meta.validationOnlyDateKeysLocal.length
          : 0,
        validationProjectionType: meta.validationProjectionType ?? null,
      },
      compareProjectionSummary: {
        validationRowsCount: normalizeRows(compareProjection?.rows).length,
        validationMetricsSummary: asRecord(compareProjection?.metrics),
      },
      manualMonthlyReconciliationSummary: args.manualMonthlyReconciliation
        ? {
            eligibleRangeCount: args.manualMonthlyReconciliation.eligibleRangeCount,
            ineligibleRangeCount: args.manualMonthlyReconciliation.ineligibleRangeCount,
            reconciledRangeCount: args.manualMonthlyReconciliation.reconciledRangeCount,
            deltaPresentRangeCount: args.manualMonthlyReconciliation.deltaPresentRangeCount,
          }
        : null,
      validationRowsCount: normalizeRows(compareProjection?.rows).length,
      validationMetricsSummary: asRecord(compareProjection?.metrics),
    },
    tuningSummary: {
      ...summarizeTuningRows(compareProjection),
      sourceDetailCountsByCategory: summarizeDailySources(dataset),
      dailySourceClassificationsSummary: summarizeDailySources(dataset),
      firstActualOnlyDayComparison:
        simulatorDiagnostic.firstActualOnlyDayComparison ?? null,
      stitchedVsRawIntervalSummary: {
        rawActualIntervalsMeta: simulatorDiagnostic.rawActualIntervalsMeta ?? null,
        stitchedPastIntervalsMeta: simulatorDiagnostic.stitchedPastIntervalsMeta ?? null,
      },
      fingerprintShapeSummaryByMonthDayType:
        asRecord(meta).fingerprintShapeSummaryByMonthDayType ?? null,
    },
  };
}
