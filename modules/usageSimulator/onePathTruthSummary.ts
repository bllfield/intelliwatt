import {
  buildManualBillPeriodTargets,
  resolveManualStageOnePresentation,
} from "@/modules/manualUsage/statementRanges";
import type { ManualUsagePayload, ManualStatementRange } from "@/modules/simulatedUsage/types";
import {
  resolveCanonicalUsage365CoverageWindow,
  resolveReportedCoverageWindow,
} from "@/modules/usageSimulator/metadataWindow";

export type OnePathTruthOwner = {
  label: string;
  owner: string;
  whyItMatters: string;
};

export type OnePathTruthSection = {
  title: string;
  summary: string;
  currentRun: Record<string, unknown>;
  sharedOwners?: OnePathTruthOwner[];
};

export type OnePathTruthSummary = {
  preCutoverHarness: OnePathTruthSection;
  stageBoundaryMap: OnePathTruthSection;
  sharedDerivedInputs: OnePathTruthSection;
  sourceTruthIdentity: OnePathTruthSection;
  constraintRebalance: OnePathTruthSection;
  donorFallbackExclusions: OnePathTruthSection;
  intradayReconstruction: OnePathTruthSection;
  finalSharedOutputContract: OnePathTruthSection;
  chartWindowDisplay: OnePathTruthSection;
  manualStatementAnnual: OnePathTruthSection;
  annualModeTruth: OnePathTruthSection;
  newBuildModeTruth: OnePathTruthSection;
  controlSurface: OnePathTruthSection;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function normalizeStatementRanges(periods: unknown): ManualStatementRange[] {
  return asArray<Record<string, unknown>>(periods)
    .map((row) => ({
      month: String(row.month ?? row.id ?? "").trim(),
      startDate: row.startDate == null ? null : String(row.startDate ?? "").slice(0, 10),
      endDate: String(row.endDate ?? "").slice(0, 10),
    }))
    .filter((row) => /^\d{4}-\d{2}$/.test(row.month) && /^\d{4}-\d{2}-\d{2}$/.test(row.endDate));
}

function toNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toDateKeys(value: unknown): string[] {
  return asArray(value)
    .map((entry) => String(entry ?? "").slice(0, 10))
    .filter((entry) => /^\d{4}-\d{2}-\d{2}$/.test(entry));
}

function pickNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function countBy(rows: Array<Record<string, unknown>>, key: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const raw = row[key];
    const label = typeof raw === "string" && raw.trim() ? raw.trim() : "unknown";
    out[label] = (out[label] ?? 0) + 1;
  }
  return out;
}

function averageBy(rows: Array<Record<string, unknown>>, key: string): number | null {
  const values = rows.map((row) => pickNumber(row[key])).filter((value): value is number => value != null);
  if (!values.length) return null;
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.round(avg * 1000) / 1000;
}

function pickFirstNonNull(...values: unknown[]): unknown {
  for (const value of values) {
    if (value != null) return value;
  }
  return null;
}

function pickFamilyResolvedValues(
  snapshot: Record<string, unknown>,
  familyKey: string
): Record<string, unknown> {
  const family = asRecord(asRecord(snapshot.familyByFamilyResolvedValues)[familyKey]);
  return asRecord(family.resolvedValues);
}

function pickFamilyValueSources(
  snapshot: Record<string, unknown>,
  familyKey: string
): Record<string, unknown> {
  const family = asRecord(asRecord(snapshot.familyByFamilyResolvedValues)[familyKey]);
  const valuesByKey = asRecord(family.valuesByKey);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(valuesByKey)) {
    out[key] = asRecord(value).valueSource ?? null;
  }
  return out;
}

function summarizeSimulatedDayResults(value: unknown): Record<string, unknown> {
  const rows = asArray<Record<string, unknown>>(value);
  return {
    simulatedDayResultsCount: rows.length,
    weatherEfficiencyAppliedCount: rows.filter((row) => row.weatherEfficiencyApplied === true).length,
    weatherShapingModeCounts: countBy(rows, "weatherShapingMode"),
    weatherClassificationCounts: countBy(rows, "dayClassification"),
    donorSelectionModeCounts: countBy(rows, "donorSelectionModeUsed"),
    fallbackLevelCounts: countBy(rows, "fallbackLevel"),
    broadFallbackCount: rows.filter((row) => row.broadFallbackUsed === true).length,
    incompleteMeterSimulatedCount: rows.filter((row) => row.sourceDetail === "SIMULATED_INCOMPLETE_METER").length,
    averageWeatherAmplitudeCompressionFactor: averageBy(rows, "weatherAmplitudeCompressionFactor"),
    averageIntradayPeakValleyCompressionFactor: averageBy(rows, "intradayPeakValleyCompressionFactor"),
    averageDailyExtremaConfidence: averageBy(rows, "dailyExtremaConfidence"),
  };
}

function buildManualPayload(args: {
  inputType: string | null | undefined;
  engineInput: Record<string, unknown>;
  artifact: Record<string, unknown>;
}): ManualUsagePayload | null {
  const travelRanges = asArray<{ startDate?: unknown; endDate?: unknown }>(args.engineInput.travelRanges).map((range) => ({
    startDate: String(range?.startDate ?? "").slice(0, 10),
    endDate: String(range?.endDate ?? "").slice(0, 10),
  }));
  if (args.inputType === "MANUAL_MONTHLY") {
    const statementRanges = normalizeStatementRanges(args.artifact.manualBillPeriods);
    const totalsById = asRecord(args.artifact.manualBillPeriodTotalsKwhById);
    return {
      mode: "MONTHLY",
      anchorEndDate: String(args.engineInput.anchorEndDate ?? "").slice(0, 10),
      monthlyKwh: statementRanges.map((range) => ({
        month: range.month,
        kwh: toNumberOrNull(totalsById[range.month]) ?? "",
      })),
      statementRanges,
      travelRanges,
      dateSourceMode: typeof args.engineInput.dateSourceMode === "string" ? (args.engineInput.dateSourceMode as any) : undefined,
      billEndDay: toNumberOrNull(args.engineInput.billEndDay) ?? undefined,
    };
  }
  if (args.inputType === "MANUAL_ANNUAL") {
    return {
      mode: "ANNUAL",
      anchorEndDate: String(args.engineInput.anchorEndDate ?? "").slice(0, 10),
      annualKwh: toNumberOrNull(args.engineInput.annualTargetKwh) ?? "",
      travelRanges,
    };
  }
  return null;
}

function pickAdapterNumber(snapshot: Record<string, unknown>, key: string): number | null {
  const family = asRecord(asRecord(snapshot.familyByFamilyResolvedValues).adapterCanonicalInput);
  const resolvedValues = asRecord(family.resolvedValues);
  return toNumberOrNull(resolvedValues[key]);
}

export function buildOnePathTruthSummary(args: {
  inputType: string | null | undefined;
  engineInput: Record<string, unknown>;
  artifact: Record<string, unknown>;
  readModel: Record<string, unknown> | null | undefined;
}): OnePathTruthSummary {
  const dataset = asRecord(args.artifact.dataset);
  const datasetSummary = asRecord(dataset.summary);
  const datasetMeta = asRecord(dataset.meta);
  const runSnapshot = asRecord(args.readModel?.effectiveSimulationVariablesUsed);
  const adapterLagDays = pickAdapterNumber(runSnapshot, "canonicalCoverageLagDays");
  const adapterTotalDays = pickAdapterNumber(runSnapshot, "canonicalCoverageTotalDays");
  const canonicalWindowFromPolicy =
    adapterLagDays != null && adapterTotalDays != null
      ? resolveCanonicalUsage365CoverageWindow(new Date(), {
          canonicalCoverageLagDays: adapterLagDays,
          canonicalCoverageTotalDays: adapterTotalDays,
          manualMonthlyDefaultBillEndDay: 15,
          manualAnnualWindowDays: 365,
          longTermWeatherBaselineStartYear: 1991,
          longTermWeatherBaselineEndYear: 2020,
        })
      : null;
  const reportedWindow = resolveReportedCoverageWindow({
    dataset,
    fallbackStartDate: String(args.engineInput.coverageWindowStart ?? datasetSummary.start ?? ""),
    fallbackEndDate: String(args.engineInput.coverageWindowEnd ?? datasetSummary.end ?? ""),
  });
  const validationOnlyDateKeys = toDateKeys(
    args.engineInput.validationOnlyDateKeysLocal ?? datasetMeta.validationOnlyDateKeysLocal
  );
  const compareProjection = asRecord(args.readModel?.compareProjection);
  const sharedDiagnostics = asRecord(args.readModel?.sharedDiagnostics);
  const identityContext = asRecord(sharedDiagnostics.identityContext);
  const sourceTruthContext = asRecord(sharedDiagnostics.sourceTruthContext);
  const lockboxExecutionSummary = asRecord(sharedDiagnostics.lockboxExecutionSummary);
  const projectionReadSummary = asRecord(sharedDiagnostics.projectionReadSummary);
  const tuningSummary = asRecord(sharedDiagnostics.tuningSummary);
  const manualPayload = buildManualPayload(args);
  const stageOnePresentation = resolveManualStageOnePresentation({
    surface: "admin_manual_monthly_stage_one",
    payload: manualPayload,
  });
  const manualBillTargets = manualPayload ? buildManualBillPeriodTargets(manualPayload) : [];
  const manualParitySummary = asRecord(args.readModel?.manualParitySummary);
  const runIdentity = asRecord(args.readModel?.runIdentity);
  const constraintRebalance = pickFamilyResolvedValues(runSnapshot, "constraintRebalance");
  const donorFallbackExclusions = pickFamilyResolvedValues(runSnapshot, "donorFallbackExclusions");
  const intradayReconstruction = pickFamilyResolvedValues(runSnapshot, "intradayShapeReconstruction");
  const adapterCanonicalInput = pickFamilyResolvedValues(runSnapshot, "adapterCanonicalInput");
  const compareTuningMetrics = pickFamilyResolvedValues(runSnapshot, "compareTuningMetrics");
  const simulatedDayResultsSummary = summarizeSimulatedDayResults(args.artifact.simulatedDayResults);
  const finalOutputContract = {
    datasetSummary: dataset.summary ?? null,
    datasetDaily: {
      rowCount: asArray(dataset.daily).length,
      sourceClassifications: tuningSummary.dailySourceClassificationsSummary ?? null,
    },
    datasetMonthly: {
      rowCount: asArray(dataset.monthly).length,
    },
    datasetSeriesIntervals15: {
      rowCount: asArray(asRecord(dataset.series).intervals15).length,
    },
    compareProjection: {
      rowsCount: asArray(compareProjection.rows).length,
      metrics: compareProjection.metrics ?? null,
    },
    manualMonthlyReconciliation: args.readModel?.manualMonthlyReconciliation ?? null,
    manualParitySummary: args.readModel?.manualParitySummary ?? null,
    sharedDiagnostics: {
      identityContext,
      sourceTruthContext,
      lockboxExecutionSummary,
      projectionReadSummary,
    },
    dailyShapeTuning: args.readModel?.dailyShapeTuning ?? null,
    tuningSummary: args.readModel?.tuningSummary ?? null,
  };

  return {
    preCutoverHarness: {
      title: "Pre-Cutover Harness Status",
      summary:
        "This page is the pre-cutover canonical simulation truth console only. It proves the shared owners, boundaries, inputs, and outputs without rerouting older admin or user surfaces yet.",
      currentRun: {
        status: "pre-cutover canonical harness",
        rerouteStatus: "Older surfaces are not rerouted to this harness yet.",
        sharedProducerPathUsed: args.engineInput.sharedProducerPathUsed ?? null,
        readModelOnly: true,
        selectedMode: args.inputType ?? null,
        selectedHouseId: args.engineInput.houseId ?? null,
        artifactId: runIdentity.artifactId ?? null,
      },
      sharedOwners: [
        {
          label: "Canonical harness owner",
          owner: "runSharedSimulation",
          whyItMatters: "Keeps the harness on the same shared producer/readback chain without cutting older pages over in this pass.",
        },
        {
          label: "Persisted read-model owner",
          owner: "buildSharedSimulationReadModel",
          whyItMatters: "All truth panels read from shared artifact/readback output instead of page-local recompute.",
        },
      ],
    },
    stageBoundaryMap: {
      title: "Stage Boundary Map",
      summary:
        "This maps the selected run through the one shared producer chain: raw harness input, shared adapter choice, canonical engine input, shared derived inputs, shared simulation stages, post-sim formatter output, and persisted artifact identity.",
      currentRun: {
        rawInputSnapshot: {
          selectedHouseId: args.engineInput.houseId ?? null,
          actualContextHouseId: args.engineInput.actualContextHouseId ?? null,
          scenarioId: args.engineInput.scenarioId ?? null,
          inputType: args.inputType ?? null,
          weatherPreference: args.engineInput.weatherPreference ?? null,
          validationSelectionMode: args.engineInput.validationSelectionMode ?? null,
          validationOnlyDateKeysCount: validationOnlyDateKeys.length,
          travelRangesCount: asArray(args.engineInput.travelRanges).length,
        },
        adapterSelected: {
          manualConstraintMode: args.engineInput.manualConstraintMode ?? null,
          sourceDerivedMode: args.engineInput.sourceDerivedMode ?? null,
          adapterCanonicalInput,
        },
        canonicalSimulationEngineInput: {
          simulatorMode: args.engineInput.simulatorMode ?? null,
          coverageWindowStart: args.engineInput.coverageWindowStart ?? null,
          coverageWindowEnd: args.engineInput.coverageWindowEnd ?? null,
          canonicalMonthsCount: asArray(args.engineInput.canonicalMonths).length,
          anchorEndDate: args.engineInput.anchorEndDate ?? null,
          billEndDay: args.engineInput.billEndDay ?? null,
          weatherLogicMode: args.engineInput.weatherLogicMode ?? null,
        },
        sharedDerivedInputsResolved: {
          weatherEfficiencyDerivedInput:
            args.engineInput.weatherEfficiencyDerivedInput ?? datasetMeta.weatherEfficiencyDerivedInput ?? null,
          manualMonthlyWeatherEvidenceSummary:
            sourceTruthContext.manualMonthlyWeatherEvidenceSummary ?? datasetMeta.manualMonthlyWeatherEvidenceSummary ?? null,
          monthlyTargetConstructionDiagnosticsCount:
            asArray(args.engineInput.monthlyTargetConstructionDiagnostics).length ||
            asArray(sourceTruthContext.monthlyTargetConstructionDiagnostics).length,
          resolvedWeatherShapingMode: runSnapshot.resolvedWeatherShapingMode ?? null,
          resolvedFallbackMode: runSnapshot.resolvedFallbackMode ?? null,
        },
        sharedSimulationCoreStagesUsed: {
          exactStageListUsed: lockboxExecutionSummary.exactStageListUsed ?? [],
          stageTimings: lockboxExecutionSummary.stageTimings ?? {},
        },
        sharedPostSimFormatterOutput: {
          projectionReadSummary,
          dailyShapeTuning: args.readModel?.dailyShapeTuning ?? null,
          tuningSummary: args.readModel?.tuningSummary ?? null,
        },
        persistedArtifactIdentity: {
          artifactId: runIdentity.artifactId ?? null,
          artifactInputHash: runIdentity.artifactInputHash ?? null,
          buildInputsHash: runIdentity.buildInputsHash ?? null,
          engineVersion: runIdentity.engineVersion ?? null,
          sharedProducerPathUsed: runIdentity.sharedProducerPathUsed ?? null,
        },
      },
      sharedOwners: [
        {
          label: "Shared adapter owner",
          owner: "adapt*RawInput",
          whyItMatters: "All modes normalize into one canonical engine-input contract before the producer runs.",
        },
        {
          label: "Shared producer owner",
          owner: "recalcSimulatorBuild -> simulatePastUsageDataset",
          whyItMatters: "Keeps the stage boundary between normalized input and persisted simulation truth shared across entrypoints.",
        },
        {
          label: "Readback owner",
          owner: "buildSharedSimulationReadModel",
          whyItMatters: "Projects the persisted artifact into the same canonical read model the truth console consumes.",
        },
      ],
    },
    sharedDerivedInputs: {
      title: "Shared Derived Inputs Used By Run",
      summary:
        "These are the shared derived inputs and resolved tuning controls actually consumed by the selected run. They are surfaced from shared readback and shared diagnostics, not rebuilt in the page.",
      currentRun: {
        weatherEfficiencyDerivedInput:
          args.engineInput.weatherEfficiencyDerivedInput ?? datasetMeta.weatherEfficiencyDerivedInput ?? null,
        weatherEfficiencyApplied: simulatedDayResultsSummary.weatherEfficiencyAppliedCount,
        weatherShapingMode: pickFirstNonNull(
          runSnapshot.resolvedWeatherShapingMode,
          countBy(asArray<Record<string, unknown>>(args.artifact.simulatedDayResults), "weatherShapingMode")
        ),
        weatherAmplitudeCompressionFactor:
          simulatedDayResultsSummary.averageWeatherAmplitudeCompressionFactor,
        dailyExtremaConfidence: simulatedDayResultsSummary.averageDailyExtremaConfidence,
        intradayPeakValleyCompressionFactor:
          simulatedDayResultsSummary.averageIntradayPeakValleyCompressionFactor,
        monthlyTargetConstructionDiagnostics:
          sourceTruthContext.monthlyTargetConstructionDiagnostics ??
          args.engineInput.monthlyTargetConstructionDiagnostics ??
          null,
        resolvedDonorFallbackMode: runSnapshot.resolvedFallbackMode ?? null,
        resolvedExclusions: sourceTruthContext.exclusionDrivingCanonicalInputsSummary ?? null,
        resolvedConstraintRebalanceMode: runSnapshot.resolvedRebalanceMode ?? null,
        resolvedIntradayReconstructionControls:
          runSnapshot.resolvedIntradayReconstructionControls ?? intradayReconstruction,
        resolvedCompareTuningThresholds:
          runSnapshot.resolvedCompareTuningThresholds ?? compareTuningMetrics,
      },
      sharedOwners: [
        {
          label: "Derived weather-input owner",
          owner: "resolveSharedWeatherSensitivityEnvelope / buildWeatherEfficiencyDerivedInput",
          whyItMatters: "Attaches shared weather-efficiency truth before the producer runs.",
        },
        {
          label: "Simulation variable owner",
          owner: "resolveSimulationVariablePolicyForInputType",
          whyItMatters: "Publishes the exact resolved shared config and value sources used for the run.",
        },
        {
          label: "Shared diagnostics owner",
          owner: "buildSharedPastSimDiagnostics",
          whyItMatters: "Carries shared evidence summaries and execution diagnostics through readback.",
        },
      ],
    },
    sourceTruthIdentity: {
      title: "Source Truth / Compare Truth Identity",
      summary:
        "This panel pins the selected run to the exact source, profile, weather, fingerprint, validation, and artifact identities used by the shared producer and later readers.",
      currentRun: {
        selectedHouseId: args.engineInput.houseId ?? null,
        sourceHouseId: identityContext.sourceHouseId ?? sourceTruthContext.sourceHouseId ?? null,
        actualContextHouseId: args.engineInput.actualContextHouseId ?? null,
        profileHouseId: identityContext.profileHouseId ?? sourceTruthContext.profileHouseId ?? null,
        scenarioId: args.engineInput.scenarioId ?? null,
        runId: identityContext.correlationId ?? null,
        artifactId: runIdentity.artifactId ?? null,
        artifactInputHash: runIdentity.artifactInputHash ?? null,
        buildInputsHash: runIdentity.buildInputsHash ?? null,
        engineVersion: runIdentity.engineVersion ?? null,
        intervalFingerprint:
          sourceTruthContext.intervalSourceIdentity ?? args.engineInput.actualIntervalFingerprint ?? null,
        weatherIdentity:
          sourceTruthContext.weatherDatasetIdentity ?? args.engineInput.weatherIdentity ?? null,
        usageShapeIdentity:
          sourceTruthContext.intervalUsageFingerprintIdentity ?? args.engineInput.usageShapeIdentity ?? null,
        validationKeysUsed:
          sourceTruthContext.validationTestKeysUsed ?? args.engineInput.validationOnlyDateKeysLocal ?? [],
        travelRangesUsed:
          sourceTruthContext.travelRangesUsed ?? args.engineInput.travelRanges ?? [],
      },
      sharedOwners: [
        {
          label: "Identity context owner",
          owner: "buildSharedPastSimDiagnostics.identityContext",
          whyItMatters: "Publishes the caller/source/profile/run identity used by the shared producer.",
        },
        {
          label: "Source truth context owner",
          owner: "buildSharedPastSimDiagnostics.sourceTruthContext",
          whyItMatters: "Carries fingerprint, weather, validation, and travel identities through shared readback.",
        },
      ],
    },
    constraintRebalance: {
      title: "Constraint / Rebalance Logic",
      summary:
        "This panel shows the shared parity, clamp, and tension controls used by the run, including which shared thresholds and post-shaping guardrails are active.",
      currentRun: {
        preRebalanceTotals:
          sourceTruthContext.manualBillPeriodTotalsKwhById ??
          args.engineInput.normalizedMonthTargetsByMonth ??
          null,
        postRebalanceTotals:
          args.readModel?.manualMonthlyReconciliation ?? dataset.summary ?? null,
        parityStatus: manualParitySummary.status ?? null,
        reconciliationThresholds: compareTuningMetrics,
        exactMatchVsNearMatchThresholds: pickFamilyValueSources(runSnapshot, "compareTuningMetrics"),
        maxRebalanceCorrectionLimits: {
          weatherModifierConfidenceMin: constraintRebalance.weatherModifierConfidenceMin ?? null,
          weatherModifierConfidenceMax: constraintRebalance.weatherModifierConfidenceMax ?? null,
          intervalResponsivenessMax: constraintRebalance.intervalResponsivenessMax ?? null,
          billingAmplitudeMax: constraintRebalance.billingAmplitudeMax ?? null,
          billingPeakValleyMax: constraintRebalance.billingPeakValleyMax ?? null,
          billingResponsivenessMax: constraintRebalance.billingResponsivenessMax ?? null,
          billingDailyExtremaMax: constraintRebalance.billingDailyExtremaMax ?? null,
        },
        shapePreservationVsTargetPreservationBehavior: {
          shapeSkipThreshold: constraintRebalance.shapeSkipThreshold ?? null,
          shapeFlattenBlendMin: constraintRebalance.shapeFlattenBlendMin ?? null,
          shapeFlattenBlendMax: constraintRebalance.shapeFlattenBlendMax ?? null,
          weekdayWeekendProfileRatioMin: constraintRebalance.weekdayWeekendProfileRatioMin ?? null,
          weekdayWeekendProfileRatioMax: constraintRebalance.weekdayWeekendProfileRatioMax ?? null,
        },
        parityVsShapeOutcome:
          args.inputType === "MANUAL_MONTHLY" || args.inputType === "MANUAL_ANNUAL"
            ? "Eligible manual bill periods preserve target parity first; excluded periods remain visible but non-scored."
            : "Observed-history shape remains primary unless shared guardrails clamp the modeled response.",
      },
      sharedOwners: [
        {
          label: "Constraint policy owner",
          owner: "effectiveSimulationVariablesUsed.constraintRebalance",
          whyItMatters: "Publishes the shared clamp and rebalance controls actually used by the run.",
        },
        {
          label: "Manual parity owner",
          owner: "manualParitySummary / manualMonthlyReconciliation",
          whyItMatters: "Shows whether the shared post-sim output satisfied manual parity requirements.",
        },
      ],
    },
    donorFallbackExclusions: {
      title: "Donor / Fallback / Exclusion Logic",
      summary:
        "This panel exposes the shared donor-pool, fallback, exclusion, and low-data activation truth for the selected run.",
      currentRun: {
        donorPoolMode:
          args.engineInput.manualTravelVacantDonorPoolMode ??
          sourceTruthContext.manualTravelVacantDonorSource ??
          null,
        donorSourceEligibility: sourceTruthContext.manualMonthlySimulationPoolIsolation ?? null,
        fallbackModeSelected: runSnapshot.resolvedFallbackMode ?? null,
        fallbackSeverityAndConfidence: {
          broadFallbackCount: simulatedDayResultsSummary.broadFallbackCount,
          fallbackLevelCounts: simulatedDayResultsSummary.fallbackLevelCounts,
          donorSelectionModeCounts: simulatedDayResultsSummary.donorSelectionModeCounts,
        },
        incompleteMeterHandling: {
          incompleteMeterSimulatedCount: simulatedDayResultsSummary.incompleteMeterSimulatedCount,
          dailySourceClassificationsSummary: tuningSummary.dailySourceClassificationsSummary ?? null,
        },
        excludedDateKeys: {
          excludedDateKeysCount: datasetMeta.excludedDateKeysCount ?? null,
          excludedDateKeysFingerprint: datasetMeta.excludedDateKeysFingerprint ?? null,
          excludedDateKeysLocal: args.engineInput.excludedDateKeysLocal ?? [],
        },
        travelVacantHandling: {
          travelRanges: args.engineInput.travelRanges ?? [],
          manualTravelVacantDonorDayCount: sourceTruthContext.manualTravelVacantDonorDayCount ?? null,
        },
        lowDataBranchActivation: {
          manualMonthlyWeatherEvidenceSummary:
            sourceTruthContext.manualMonthlyWeatherEvidenceSummary ?? null,
          sourceDerivedMode: args.engineInput.sourceDerivedMode ?? null,
          donorFallbackConfig: donorFallbackExclusions,
        },
      },
      sharedOwners: [
        {
          label: "Donor/fallback policy owner",
          owner: "effectiveSimulationVariablesUsed.donorFallbackExclusions",
          whyItMatters: "Publishes the resolved donor and fallback config bucket used by the run.",
        },
        {
          label: "Shared low-data evidence owner",
          owner: "manualMonthlyWeatherEvidenceSummary",
          whyItMatters: "Explains when manual low-data evidence activated and which bill periods were eligible.",
        },
      ],
    },
    intradayReconstruction: {
      title: "Intraday Reconstruction Logic",
      summary:
        "This panel surfaces the shared intraday shaping controls and the run-level peak/valley compression outcomes that determine the final 15-minute curve behavior.",
      currentRun: {
        peakValleyScaling: {
          weatherAmplitudeCompressionFactor:
            simulatedDayResultsSummary.averageWeatherAmplitudeCompressionFactor,
          intradayPeakValleyCompressionFactor:
            simulatedDayResultsSummary.averageIntradayPeakValleyCompressionFactor,
        },
        dampingAndConfidence: {
          dailyExtremaConfidence: simulatedDayResultsSummary.averageDailyExtremaConfidence,
          weatherShapingModeCounts: simulatedDayResultsSummary.weatherShapingModeCounts,
        },
        weekdayWeekendBlending: {
          weekdayWeekendShapeSplitAvailable:
            constraintRebalance.weekdayWeekendProfileRatioMin != null ||
            constraintRebalance.weekdayWeekendProfileRatioMax != null,
          weekdayWeekendProfileRatioMin: constraintRebalance.weekdayWeekendProfileRatioMin ?? null,
          weekdayWeekendProfileRatioMax: constraintRebalance.weekdayWeekendProfileRatioMax ?? null,
        },
        seasonalBlendAndShoulderControls: {
          syntheticWinterSeasonMultiplier: intradayReconstruction.syntheticWinterSeasonMultiplier ?? null,
          syntheticSummerSeasonMultiplier: intradayReconstruction.syntheticSummerSeasonMultiplier ?? null,
          shapeFlattenBlendMin: constraintRebalance.shapeFlattenBlendMin ?? null,
          shapeFlattenBlendMax: constraintRebalance.shapeFlattenBlendMax ?? null,
        },
        hotColdExpansionAndHourBlocks: {
          coolingBoostHoursStart: intradayReconstruction.coolingBoostHoursStart ?? null,
          coolingBoostHoursEnd: intradayReconstruction.coolingBoostHoursEnd ?? null,
          heatingMorningBoostHoursStart: intradayReconstruction.heatingMorningBoostHoursStart ?? null,
          heatingMorningBoostHoursEnd: intradayReconstruction.heatingMorningBoostHoursEnd ?? null,
          heatingEveningBoostHoursStart: intradayReconstruction.heatingEveningBoostHoursStart ?? null,
          heatingEveningBoostHoursEnd: intradayReconstruction.heatingEveningBoostHoursEnd ?? null,
        },
        slotGuardrails: {
          weatherAwareHvacSetpointClampMin:
            intradayReconstruction.weatherAwareHvacSetpointClampMin ?? null,
          weatherAwareHvacSetpointClampMax:
            intradayReconstruction.weatherAwareHvacSetpointClampMax ?? null,
          syntheticWeekdayMinKwh: intradayReconstruction.syntheticWeekdayMinKwh ?? null,
          syntheticWeekdayMaxKwh: intradayReconstruction.syntheticWeekdayMaxKwh ?? null,
          syntheticEvDailyCapKwh: intradayReconstruction.syntheticEvDailyCapKwh ?? null,
        },
      },
      sharedOwners: [
        {
          label: "Intraday policy owner",
          owner: "effectiveSimulationVariablesUsed.intradayShapeReconstruction",
          whyItMatters: "Publishes the resolved shared intraday controls and caps for the selected run.",
        },
        {
          label: "Per-day shaping outcome owner",
          owner: "simulatedDayResults",
          whyItMatters: "Shows the actual compression and confidence outcomes the shared engine produced.",
        },
      ],
    },
    finalSharedOutputContract: {
      title: "Final Shared Output Contract",
      summary:
        "This is the final named contract later readers are expected to consume: summary, daily, monthly, intervals15, compare, reconciliation, parity, diagnostics, shape tuning, and tuning summary.",
      currentRun: finalOutputContract,
      sharedOwners: [
        {
          label: "Persisted artifact owner",
          owner: "CanonicalSimulationArtifact",
          whyItMatters: "Defines the saved shared output later readers will consume after cutover.",
        },
        {
          label: "Canonical read-model owner",
          owner: "CanonicalSimulationReadModel",
          whyItMatters: "Projects the persisted artifact into named consumer-facing output sections without page-local reshaping.",
        },
      ],
    },
    chartWindowDisplay: {
      title: "Chart / Window / Display Logic",
      summary:
        "This panel makes the shared chart/window/display owners first-class: canonical coverage, reported coverage, chart lag, compare projection windowing, and latest-month display normalization.",
      currentRun: {
        actualContextHouseId: String(args.engineInput.actualContextHouseId ?? ""),
        coverageWindowStart: args.engineInput.coverageWindowStart ?? null,
        coverageWindowEnd: args.engineInput.coverageWindowEnd ?? null,
        canonicalMonths: asArray<string>(args.engineInput.canonicalMonths),
        canonicalEndMonth: args.engineInput.canonicalEndMonth ?? null,
        datasetSummaryStart: datasetSummary.start ?? null,
        datasetSummaryEnd: datasetSummary.end ?? null,
        datasetMetaCoverageStart: datasetMeta.coverageStart ?? null,
        datasetMetaCoverageEnd: datasetMeta.coverageEnd ?? null,
        reportedWindowStart: reportedWindow.startDate,
        reportedWindowEnd: reportedWindow.endDate,
        validationSelectionMode: args.engineInput.validationSelectionMode ?? null,
        validationOnlyDateKeys,
        validationOnlyDateKeysCount: validationOnlyDateKeys.length,
        compareProjectionRowsCount: asArray(compareProjection.rows).length,
        sharedAdapterCoverageLagDays: adapterLagDays,
        sharedAdapterCoverageTotalDays: adapterTotalDays,
        currentPolicyCanonicalWindowPreview: canonicalWindowFromPolicy,
        chartLagOwnership: {
          canonicalCoverageLagDays: adapterLagDays,
          canonicalCoverageTotalDays: adapterTotalDays,
        },
        compareProjectionWindowing: projectionReadSummary.compareProjectionSummary ?? null,
        latestMonthDisplayNormalization: {
          datasetSummaryStart: datasetSummary.start ?? null,
          datasetSummaryEnd: datasetSummary.end ?? null,
          reportedWindowStart: reportedWindow.startDate,
          reportedWindowEnd: reportedWindow.endDate,
        },
      },
      sharedOwners: [
        {
          label: "Canonical coverage owner",
          owner: "resolveCanonicalUsage365CoverageWindow",
          whyItMatters: "Owns the shared today-minus-lag framing used before the canonical producer runs.",
        },
        {
          label: "Reported chart window owner",
          owner: "resolveReportedCoverageWindow",
          whyItMatters: "Keeps summary/chart framing aligned to the shared dataset window instead of page-local date math.",
        },
        {
          label: "Display projection owner",
          owner: "projectBaselineFromCanonicalDataset",
          whyItMatters: "Applies shared validation-day masking and meter-backed display normalization for compare/chart surfaces.",
        },
        {
          label: "Coverage metadata owner",
          owner: "applyCanonicalCoverageMetadataForNonBaseline",
          whyItMatters: "Keeps dataset summary and coverage metadata aligned to the same shared canonical window source.",
        },
      ],
    },
    manualStatementAnnual: {
      title: "Manual Statement / Annual Logic",
      summary:
        "This panel makes manual statement and annual ownership first-class: anchor end date, bill-end day, statement ranges, stage-one normalization, bill-period generation, and annual spreading/window helpers.",
      currentRun: {
        inputType: args.inputType ?? null,
        anchorEndDate: args.engineInput.anchorEndDate ?? null,
        billEndDay: args.engineInput.billEndDay ?? null,
        dateSourceMode: args.engineInput.dateSourceMode ?? null,
        statementRangesCount: asArray(args.engineInput.statementRanges).length,
        statementRangesPreview: asArray(args.engineInput.statementRanges).slice(0, 4),
        manualBillPeriodCount: asArray(args.artifact.manualBillPeriods).length,
        manualBillPeriodTotalsKwhById: args.artifact.manualBillPeriodTotalsKwhById ?? {},
        annualTargetKwh: args.engineInput.annualTargetKwh ?? null,
        normalizedMonthTargetsByMonth: args.engineInput.normalizedMonthTargetsByMonth ?? {},
        stageOnePresentation,
        manualBillTargets,
        manualParityStatus: manualParitySummary.status ?? null,
        manualParitySummary,
      },
      sharedOwners: [
        {
          label: "Manual stage-one presentation owner",
          owner: "resolveManualStageOnePresentation",
          whyItMatters: "Explains the shared monthly or annual bill-entry contract before the canonical adapter runs.",
        },
        {
          label: "Bill-period target owner",
          owner: "buildManualBillPeriodTargets",
          whyItMatters: "Determines which manual periods are eligible constraints and why some periods are excluded.",
        },
        {
          label: "Statement normalization owner",
          owner: "deriveStatementRangesFromMonthlyPayload",
          whyItMatters: "Normalizes explicit statements or auto-built statement windows into the same shared monthly contract.",
        },
        {
          label: "Annual spreading/window owner",
          owner: "buildUniformMonthlyTotalsFromAnnualWindow",
          whyItMatters: "Keeps annual-only runs on a shared window helper instead of page-local annual month spreading.",
        },
      ],
    },
    annualModeTruth: {
      title: "Annual Shared Truth",
      summary:
        "This panel shows the shared annual target and spreading truth. It stays visible for all runs so annual ownership is auditable before cutover.",
      currentRun: {
        selectedRunUsesThisMode: args.inputType === "MANUAL_ANNUAL",
        annualTargetKwh: args.engineInput.annualTargetKwh ?? null,
        anchorEndDate: args.engineInput.anchorEndDate ?? null,
        manualAnnualWindowDays: adapterCanonicalInput.manualAnnualWindowDays ?? null,
        normalizedMonthTargetsByMonth: args.engineInput.normalizedMonthTargetsByMonth ?? {},
        parityStatus: manualParitySummary.status ?? null,
        annualReadbackContract: args.readModel?.manualMonthlyReconciliation ?? null,
      },
      sharedOwners: [
        {
          label: "Annual adapter owner",
          owner: "adaptManualAnnualRawInput",
          whyItMatters: "Normalizes annual Stage 1 input into the shared canonical engine contract.",
        },
        {
          label: "Annual spreading owner",
          owner: "buildUniformMonthlyTotalsFromAnnualWindow",
          whyItMatters: "Keeps shared annual window spreading visible and auditable before cutover.",
        },
      ],
    },
    newBuildModeTruth: {
      title: "New Build Shared Truth",
      summary:
        "This panel shows the shared new-build evidence weighting, fallback, and confidence truth even when the selected run is not NEW_BUILD yet.",
      currentRun: {
        selectedRunUsesThisMode: args.inputType === "NEW_BUILD",
        simulatorMode: args.engineInput.simulatorMode ?? null,
        fallbackMode: runSnapshot.resolvedFallbackMode ?? null,
        newBuildEvidenceWeighting: {
          thermostatSummerReferenceF: compareTuningMetrics.thermostatSummerReferenceF ?? null,
          thermostatWinterReferenceF: compareTuningMetrics.thermostatWinterReferenceF ?? null,
          squareFootageReference: compareTuningMetrics.squareFootageReference ?? null,
          squareFootageFactorMin: compareTuningMetrics.squareFootageFactorMin ?? null,
          squareFootageFactorMax: compareTuningMetrics.squareFootageFactorMax ?? null,
        },
        confidenceTruth: {
          weatherEfficiencyScoreAnchor: compareTuningMetrics.weatherEfficiencyScoreAnchor ?? null,
          lowConfidencePenaltyReference: compareTuningMetrics.lowConfidencePenaltyReference ?? null,
          applianceDetailRichMinimumCount: compareTuningMetrics.applianceDetailRichMinimumCount ?? null,
        },
        profileInputsVisible: {
          homeProfilePresent: !!args.engineInput.homeProfile,
          applianceProfilePresent: !!args.engineInput.applianceProfile,
          occupantProfilePresent: !!args.engineInput.occupantProfile,
          poolProfilePresent: !!args.engineInput.poolProfile,
          evProfilePresent: !!args.engineInput.evProfile,
        },
      },
      sharedOwners: [
        {
          label: "New-build adapter owner",
          owner: "adaptNewBuildRawInput",
          whyItMatters: "Keeps new-build inputs on the same canonical engine contract as the other modes.",
        },
        {
          label: "Shared sparse-data config owner",
          owner: "effectiveSimulationVariablesUsed.compareTuningMetrics",
          whyItMatters: "Surfaces the shared evidence weighting and confidence thresholds the new-build path would use.",
        },
      ],
    },
    controlSurface: {
      title: "Shared source-of-truth summary",
      summary:
        "These are the editable shared config and input controls only. They feed the shared adapter path without moving simulation logic into the page.",
      currentRun: {
        selectedHouseId: args.engineInput.houseId ?? null,
        actualContextHouseId: args.engineInput.actualContextHouseId ?? null,
        validationSelectionMode: args.engineInput.validationSelectionMode ?? null,
        validationOnlyDateKeys,
        validationOnlyDateKeysCount: validationOnlyDateKeys.length,
        travelRangesCount: asArray(args.engineInput.travelRanges).length,
      },
    },
  };
}
