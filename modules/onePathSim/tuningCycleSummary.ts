import type { OnePathKnownScenario } from "@/modules/onePathSim/knownHouseScenarios";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function firstFailedManualParityReason(manualParitySummary: Record<string, unknown>): string | null {
  const verdicts = asRecord(manualParitySummary.parity_verdicts);
  if (verdicts.stage1Parity === false) return String(verdicts.stage1ParityReason ?? "Manual stage 1 parity failed.");
  if (verdicts.travelRangeParity === false) return String(verdicts.travelRangeParityReason ?? "Manual travel range parity failed.");
  if (verdicts.stage2PathParity === false) return String(verdicts.stage2PathParityReason ?? "Manual stage 2 path parity failed.");
  return null;
}

function monthlyDriftReason(monthlyTruthCompare: Record<string, unknown>): string | null {
  const actual = asRecord(monthlyTruthCompare.actualMonthlyReference);
  const rows = Array.isArray(monthlyTruthCompare.datasetMonthlyRows)
    ? (monthlyTruthCompare.datasetMonthlyRows as Array<Record<string, unknown>>)
    : [];
  let biggest: { month: string; delta: number } | null = null;
  for (const row of rows) {
    const month = typeof row.month === "string" ? row.month : null;
    const simulated = asNumber(row.kwh);
    const actualValue = month ? asNumber(actual[month]) : null;
    if (!month || simulated == null || actualValue == null) continue;
    const delta = Math.round((simulated - actualValue) * 100) / 100;
    if (!biggest || Math.abs(delta) > Math.abs(biggest.delta)) biggest = { month, delta };
  }
  if (!biggest || Math.abs(biggest.delta) < 0.01) return null;
  return `Monthly drift is largest in ${biggest.month} (${biggest.delta > 0 ? "+" : ""}${biggest.delta} kWh).`;
}

export function buildOnePathTuningCycleSummary(args: {
  knownScenario?: Partial<OnePathKnownScenario> | null;
  sandboxSummary?: Record<string, unknown> | null;
  selectedMode?: string | null;
  runError?: string | null;
}): Record<string, unknown> {
  const knownScenario = asRecord(args.knownScenario);
  const sandboxSummary = asRecord(args.sandboxSummary);
  const runStatus = asRecord(sandboxSummary.runStatus);
  const monthlyTruthCompare = asRecord(sandboxSummary.monthlyTruthCompare);
  const weatherAndShape = asRecord(sandboxSummary.weatherAndShape);
  const compareVisibility = asRecord(sandboxSummary.compareVisibility);
  const expectations = asRecord(knownScenario.expectations);
  const compareMetrics = asRecord(monthlyTruthCompare.compareProjectionMetrics);
  const manualParitySummary = asRecord(monthlyTruthCompare.manualParitySummary);
  const compareAvailable = Number(compareVisibility.compareProjectionRowsCount ?? 0) > 0;
  const baselinePassthrough = Boolean(runStatus.baselinePassthrough);
  const wape = asNumber(compareMetrics.wape);
  const mae = asNumber(compareMetrics.mae);
  const rmse = asNumber(compareMetrics.rmse);

  const thresholdStatus = {
    baselineParity: expectations.expectedBaselineParity == null ? null : baselinePassthrough === Boolean(expectations.expectedBaselineParity),
    compareAvailability:
      expectations.expectedPastSimCompareAvailable == null ? null : compareAvailable === Boolean(expectations.expectedPastSimCompareAvailable),
    wape: expectations.targetWapeMax == null || wape == null ? null : wape <= Number(expectations.targetWapeMax),
    mae: expectations.targetMaeMax == null || mae == null ? null : mae <= Number(expectations.targetMaeMax),
    rmse: expectations.targetRmseMax == null || rmse == null ? null : rmse <= Number(expectations.targetRmseMax),
  };

  const biggestDriftReason =
    (args.runError && args.runError.trim()) ||
    firstFailedManualParityReason(manualParitySummary) ||
    (expectations.expectedPastSimCompareAvailable === true && !compareAvailable
      ? "Expected compare surfaces are not available for this preset yet."
      : null) ||
    (thresholdStatus.wape === false ? `WAPE exceeds target (${wape} > ${expectations.targetWapeMax}).` : null) ||
    monthlyDriftReason(monthlyTruthCompare) ||
    (asRecord(weatherAndShape.lookupWeatherScore).recommendationFlags &&
    asRecord(asRecord(weatherAndShape.lookupWeatherScore).recommendationFlags).needsEnvelopeDetail === true
      ? "Weather scoring still recommends more envelope detail for this home."
      : null) ||
    knownScenario.notes ||
    null;

  return {
    presetName: knownScenario.label ?? null,
    presetKey: knownScenario.scenarioKey ?? null,
    mode: runStatus.selectedMode ?? args.selectedMode ?? knownScenario.mode ?? null,
    runType: runStatus.runType ?? null,
    compareMetrics: {
      wape,
      mae,
      rmse,
    },
    biggestDriftReason,
    thresholdStatus,
    keyVariablesUsed: {
      resolvedWeatherShapingMode: weatherAndShape.resolvedWeatherShapingMode ?? null,
      resolvedIntradayReconstructionControls: weatherAndShape.resolvedIntradayReconstructionControls ?? null,
      weatherEfficiencyDerivedInput: weatherAndShape.weatherEfficiencyDerivedInput ?? null,
    },
  };
}
