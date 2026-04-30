import type { OnePathKnownScenario } from "@/modules/onePathSim/knownHouseScenarios";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function sumNumericRecord(value: unknown): number | null {
  const entries = Object.values(asRecord(value))
    .map((entry) => (typeof entry === "number" && Number.isFinite(entry) ? entry : null))
    .filter((entry): entry is number => entry != null);
  if (!entries.length) return null;
  return Math.round(entries.reduce((sum, entry) => sum + entry, 0) * 1000) / 1000;
}

function sumMonthlyRows(rows: unknown): number | null {
  const values = asArray<Record<string, unknown>>(rows)
    .map((row) => (typeof row.kwh === "number" && Number.isFinite(row.kwh) ? row.kwh : null))
    .filter((value): value is number => value != null);
  if (!values.length) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) * 1000) / 1000;
}

export function buildOnePathSandboxHarnessSummary(args: {
  lookupSourceContext?: Record<string, unknown> | null;
  runResult?: Record<string, unknown> | null;
  knownScenario?: Partial<OnePathKnownScenario> | null;
}): {
  runStatus: Record<string, unknown>;
  monthlyTruthCompare: Record<string, unknown>;
  weatherAndShape: Record<string, unknown>;
  compareVisibility: Record<string, unknown>;
} {
  const lookupSourceContext = asRecord(args.lookupSourceContext);
  const runResult = asRecord(args.runResult);
  const knownScenario = asRecord(args.knownScenario);
  const engineInput = asRecord(runResult.engineInput);
  const artifact = asRecord(runResult.artifact);
  const readModel = asRecord(runResult.readModel);
  const runDisplayView = asRecord(runResult.runDisplayView);
  const dataset = asRecord(readModel.dataset);
  const datasetMeta = asRecord(dataset.meta);
  const datasetSummary = asRecord(dataset.summary);
  const compareProjection = asRecord(readModel.compareProjection);
  const compareRows = asArray(compareProjection.rows);
  const actualMonthlyReference = asRecord(engineInput.actualMonthlyReference);
  const datasetMonthlyRows =
    asArray<Record<string, unknown>>(dataset.monthly).length > 0
      ? asArray<Record<string, unknown>>(dataset.monthly)
      : asArray<Record<string, unknown>>(runDisplayView.monthlyRows);
  const runIdentity = asRecord(readModel.runIdentity);
  const effectiveSimulationVariablesUsed = asRecord(readModel.effectiveSimulationVariablesUsed);
  const upstreamUsageTruth = asRecord(lookupSourceContext.upstreamUsageTruth);
  const upstreamStatusSummary = asRecord(asRecord(upstreamUsageTruth.currentRun).statusSummary);
  const artifactDatasetMeta = asRecord(asRecord(artifact.dataset).meta);
  const baselinePassthrough =
    runResult.runType === "BASELINE_PASSTHROUGH" ||
    Boolean(datasetMeta.baselinePassthrough) ||
    Boolean(artifactDatasetMeta.baselinePassthrough);
  const scenarioId = engineInput.scenarioId ?? null;
  const runType =
    typeof runResult.runType === "string" && runResult.runType
      ? String(runResult.runType)
      : scenarioId
        ? "PAST_SIM"
        : baselinePassthrough
          ? "BASELINE_PASSTHROUGH"
          : "BASELINE_OR_UNSET";
  const displaySummary =
    Object.keys(datasetSummary).length > 0
      ? datasetSummary
      : {
          source: runDisplayView.summary && typeof runDisplayView.summary === "object" ? asRecord(runDisplayView.summary).source ?? null : null,
          intervalsCount:
            runDisplayView.summary && typeof runDisplayView.summary === "object"
              ? asRecord(runDisplayView.summary).intervalsCount ?? null
              : null,
          start:
            runDisplayView.summary && typeof runDisplayView.summary === "object"
              ? asRecord(runDisplayView.summary).coverageStart ?? null
              : null,
          end:
            runDisplayView.summary && typeof runDisplayView.summary === "object"
              ? asRecord(runDisplayView.summary).coverageEnd ?? null
              : null,
        };

  return {
    runStatus: {
      selectedMode: engineInput.inputType ?? null,
      simulatorMode: engineInput.simulatorMode ?? null,
      scenarioId,
      runType,
      baselinePassthrough,
      baselineSimulationBlocked:
        datasetMeta.baselineSimulationBlocked ?? artifactDatasetMeta.baselineSimulationBlocked ?? null,
      sharedProducerPathUsed:
        runIdentity.sharedProducerPathUsed ??
        datasetMeta.sharedProducerPathUsed ??
        artifactDatasetMeta.sharedProducerPathUsed ??
        engineInput.sharedProducerPathUsed ??
        null,
      knownScenarioKey: knownScenario.scenarioKey ?? null,
      knownScenarioLabel: knownScenario.label ?? null,
      knownScenarioType: knownScenario.scenarioType ?? null,
      knownScenarioExpectedTruthSource: knownScenario.expectedTruthSource ?? null,
      knownScenarioExpectations: knownScenario.expectations ?? null,
      actualContextHouseId: engineInput.actualContextHouseId ?? null,
      artifactId: runIdentity.artifactId ?? null,
      artifactInputHash: runIdentity.artifactInputHash ?? null,
    },
    monthlyTruthCompare: {
      upstreamUsageTruthStatus: upstreamStatusSummary.usageTruthStatus ?? null,
      lookupActualDatasetSummary: lookupSourceContext.actualDatasetSummary ?? null,
      actualMonthlyReference,
      actualMonthlyReferenceTotalKwh: sumNumericRecord(actualMonthlyReference),
      datasetSummary: displaySummary,
      datasetMonthlyRows,
      datasetMonthlyTotalKwh: sumMonthlyRows(datasetMonthlyRows),
      compareProjectionMetrics: compareProjection.metrics ?? null,
      manualMonthlyReconciliation: readModel.manualMonthlyReconciliation ?? null,
      manualParitySummary: readModel.manualParitySummary ?? null,
    },
    weatherAndShape: {
      lookupWeatherScore: lookupSourceContext.weatherScore ?? null,
      lookupWeatherDerivedInput: lookupSourceContext.weatherDerivedInput ?? null,
      weatherEfficiencyDerivedInput:
        engineInput.weatherEfficiencyDerivedInput ?? datasetMeta.weatherEfficiencyDerivedInput ?? null,
      resolvedWeatherShapingMode: effectiveSimulationVariablesUsed.resolvedWeatherShapingMode ?? null,
      resolvedIntradayReconstructionControls:
        effectiveSimulationVariablesUsed.resolvedIntradayReconstructionControls ?? null,
      dailyShapeTuning: readModel.dailyShapeTuning ?? null,
      tuningSummary: readModel.tuningSummary ?? null,
      effectiveSimulationVariablesUsed,
    },
    compareVisibility: {
      compareProjectionRowsCount: compareRows.length,
      compareProjectionMetrics: compareProjection.metrics ?? null,
      actualCurveIntervalsCount: asArray(readModel.curveCompareActualIntervals15).length,
      simulatedCurveIntervalsCount: asArray(readModel.curveCompareSimulatedIntervals15).length,
      simulatedCurveDailyRowsCount: asArray(readModel.curveCompareSimulatedDailyRows).length,
      actualCurveIntervalsPreview: asArray(readModel.curveCompareActualIntervals15).slice(0, 3),
      simulatedCurveIntervalsPreview: asArray(readModel.curveCompareSimulatedIntervals15).slice(0, 3),
      simulatedCurveDailyRowsPreview: asArray(readModel.curveCompareSimulatedDailyRows).slice(0, 3),
    },
  };
}
