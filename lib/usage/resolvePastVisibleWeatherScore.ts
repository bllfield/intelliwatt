import {
  buildWeatherEfficiencyDerivedInput,
  type WeatherSensitivityEnvelope,
} from "@/modules/weatherSensitivity/shared";
import { applyManualPastWeatherExplanationCopy } from "@/lib/usage/manualPastDisplayPolicy";
import { buildUsageDisplayTotalsAudit } from "@/modules/onePathSim/usageDisplayTotalsAudit";
import { buildUserUsageDashboardViewModel } from "@/lib/usage/userUsageDashboardViewModel";
import { PAST_DISPLAY_WEATHER_META_FIELD } from "@/lib/usage/pastSimDisplayWeather";
import {
  PAST_DISPLAY_WEATHER_FINALIZE_VERSION,
  readPastDisplayWeatherFinalizeOutcomeFromMeta,
  type PastDisplayWeatherFinalizeOutcome,
} from "@/lib/usage/pastDisplayWeatherFinalizeGuard";
import {
  buildPastVisibleWeatherReadDiagnostics,
  pastDisplayWeatherReadPathFromMeta,
  resolvePastVisibleWeatherEnvelopeFromDataset,
  type PastDisplayWeatherReadPath,
  type PastVisibleWeatherReadDiagnostics,
} from "@/lib/usage/pastVisibleWeatherReadDiagnostics";
import {
  buildWeatherScoringAudit,
  resolveUsageSourceTypeFromDataset,
  type WeatherScoringAudit,
} from "@/lib/usage/weatherScoringOwnership";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asDateKey(value: unknown): string | null {
  const text = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function pickNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export type PastParityAuditDiagnostics = PastVisibleWeatherReadDiagnostics & {
  requestedHouseId: string;
  sourceHouseId: string | null;
  testHouseId: string | null;
  scenarioName: string | null;
  artifactCreatedAt: string | null;
  artifactUpdatedAt: string | null;
  artifactFamily: string | null;
  artifactSource: string | null;
  readModelVersion: string | null;
  finalizeVersion: string | null;
  validationSelectedDateKeys: string[] | null;
  displayTotalsAudit: ReturnType<typeof buildUsageDisplayTotalsAudit> | null;
  timeOfDayBuckets: Array<Record<string, unknown>> | null;
  monthlyTotalKwh: number | null;
  netKwh: number | null;
  wape: number | null;
  mae: number | null;
  rmse: number | null;
  coldRecalcTriggered: boolean;
};

export type ResolvePastVisibleWeatherScoreResult = {
  weatherSensitivity: WeatherSensitivityEnvelope;
  weatherCardsSourceOwner: string;
  weatherScoringAudit: WeatherScoringAudit;
  weatherReadPath: PastDisplayWeatherReadPath;
  diagnostics: PastParityAuditDiagnostics;
};

function readValidationSelectedDateKeys(
  dataset: Record<string, unknown>,
  compareProjection?: Record<string, unknown> | null
): string[] | null {
  const tuning = asRecord(compareProjection?.tuningSummary);
  const fromTuning = Array.isArray(tuning.selectedValidationRows)
    ? tuning.selectedValidationRows
        .map((row) => asDateKey(asRecord(row).date))
        .filter((value): value is string => Boolean(value))
    : [];
  if (fromTuning.length > 0) return fromTuning.sort();

  const meta = asRecord(dataset.meta);
  const fromMeta = Array.isArray(meta.validationSelectedDateKeys)
    ? meta.validationSelectedDateKeys
        .map((value) => asDateKey(value))
        .filter((value): value is string => Boolean(value))
    : [];
  return fromMeta.length > 0 ? fromMeta.sort() : null;
}

function readCompareMetrics(
  compareProjection?: Record<string, unknown> | null
): { wape: number | null; mae: number | null; rmse: number | null } {
  const metrics = asRecord(compareProjection?.metrics);
  return {
    wape: pickNumber(metrics.wape ?? metrics.mape),
    mae: pickNumber(metrics.mae),
    rmse: pickNumber(metrics.rmse),
  };
}

/**
 * Single Past visible weather read resolver for User + Admin after display-truth finalize.
 * Reads bundle C from meta.pastDisplayWeatherSensitivityScore only — never bundle B.
 */
export function resolvePastVisibleWeatherScore(args: {
  finalizedDataset: Record<string, unknown>;
  routeOwner: string;
  scenarioName?: string | null;
  scenarioId?: string | null;
  requestedHouseId: string;
  sourceHouseId?: string | null;
  testHouseId?: string | null;
  weatherHouseId?: string | null;
  preferredActualSource?: string | null;
  compareProjection?: Record<string, unknown> | null;
  finalizeOutcome?: PastDisplayWeatherFinalizeOutcome | null;
}): ResolvePastVisibleWeatherScoreResult {
  const dataset = args.finalizedDataset;
  const meta = asRecord(dataset.meta);
  const visible = resolvePastVisibleWeatherEnvelopeFromDataset({
    dataset,
    scenarioName: args.scenarioName ?? null,
  });
  const finalizeFromMeta = readPastDisplayWeatherFinalizeOutcomeFromMeta(meta);
  const weatherReadPath =
    args.finalizeOutcome?.weatherReadPath ??
    (finalizeFromMeta.weatherReadPath as PastDisplayWeatherReadPath) ??
    pastDisplayWeatherReadPathFromMeta(meta);
  const pastSourceType = resolveUsageSourceTypeFromDataset(dataset, {
    preferredActualSource: args.preferredActualSource ?? null,
  });

  const storedDerivedInput =
    meta.pastDisplayWeatherEfficiencyDerivedInput as WeatherSensitivityEnvelope["derivedInput"] | undefined;
  const weatherSensitivity: WeatherSensitivityEnvelope = {
    score: applyManualPastWeatherExplanationCopy(
      visible.score as Record<string, unknown> | null,
      meta
    ) as WeatherSensitivityEnvelope["score"],
    derivedInput:
      storedDerivedInput ??
      (visible.score &&
      Array.isArray((visible.score as { requiredInputAdjustmentsApplied?: unknown }).requiredInputAdjustmentsApplied)
        ? buildWeatherEfficiencyDerivedInput(visible.score as never)
        : null),
  };

  const weatherScoringAudit =
    visible.scoringAudit ??
    buildWeatherScoringAudit({
      scoringContext: "PAST_DISPLAY",
      scoringDataset: dataset,
      datasetKind: "SIMULATED",
      sourceType: pastSourceType,
      preferredActualSource: args.preferredActualSource ?? null,
      outputField: PAST_DISPLAY_WEATHER_META_FIELD,
      envelope: weatherSensitivity,
    });

  const viewModel = buildUserUsageDashboardViewModel({
    dataset,
    weatherSensitivityScore: weatherSensitivity.score as never,
  });
  const displayTotalsAudit = buildUsageDisplayTotalsAudit({ dataset });
  const compareMetrics = readCompareMetrics(args.compareProjection);
  const monthlyTotalKwh =
    displayTotalsAudit.monthlyDisplayTotalKwh ??
    displayTotalsAudit.monthlyRawTotalKwh ??
    (Array.isArray(dataset.monthly)
      ? round2(
          (dataset.monthly as Array<{ kwh?: unknown }>).reduce(
            (sum, row) => sum + (Number(row.kwh) || 0),
            0
          )
        )
      : null);

  const baseDiagnostics = buildPastVisibleWeatherReadDiagnostics({
    routeOwner: args.routeOwner,
    dataset,
    scenarioName: args.scenarioName ?? null,
    scenarioId: args.scenarioId ?? null,
    requestedHouseId: args.requestedHouseId,
    weatherHouseId: args.weatherHouseId,
    topLevelWeatherSensitivityScore: weatherSensitivity.score,
    weatherCardsSourceOwner: visible.sourceOwner,
    weatherScoringAudit,
    weatherReadPath,
  });

  const lockbox = asRecord(meta.lockboxRunContext);
  const diagnostics: PastParityAuditDiagnostics = {
    ...baseDiagnostics,
    requestedHouseId: args.requestedHouseId,
    sourceHouseId:
      String(args.sourceHouseId ?? meta.artifactHouseId ?? meta.houseId ?? args.requestedHouseId).trim() || null,
    testHouseId: String(args.testHouseId ?? lockbox.testHouseId ?? meta.testHouseId ?? "").trim() || null,
    scenarioName: args.scenarioName ?? null,
    artifactCreatedAt: String(meta.artifactCreatedAt ?? meta.createdAt ?? "").trim() || null,
    artifactUpdatedAt: String(meta.artifactUpdatedAt ?? meta.updatedAt ?? "").trim() || null,
    artifactFamily: String(meta.artifactFamily ?? meta.pastArtifactFamily ?? "PAST_SIM").trim() || null,
    artifactSource: String(meta.artifactSource ?? meta.actualSource ?? asRecord(dataset.summary).source ?? "").trim() || null,
    readModelVersion: String(meta.pastDisplayReadModelVersion ?? meta.readModelVersion ?? "").trim() || null,
    finalizeVersion:
      String(meta.pastDisplayWeatherFinalizeVersion ?? "").trim() || PAST_DISPLAY_WEATHER_FINALIZE_VERSION,
    validationSelectedDateKeys: readValidationSelectedDateKeys(dataset, args.compareProjection),
    displayTotalsAudit,
    timeOfDayBuckets: viewModel?.derived.timeOfDayBuckets ?? null,
    monthlyTotalKwh,
    netKwh: viewModel?.derived.totals.netKwh ?? displayTotalsAudit.canonicalTotalKwh ?? null,
    wape: compareMetrics.wape,
    mae: compareMetrics.mae,
    rmse: compareMetrics.rmse,
    coldRecalcTriggered:
      args.finalizeOutcome?.weatherRecomputed === true ||
      (args.finalizeOutcome == null && finalizeFromMeta.weatherRecomputed === true),
  };

  return {
    weatherSensitivity,
    weatherCardsSourceOwner: visible.sourceOwner,
    weatherScoringAudit,
    weatherReadPath,
    diagnostics,
  };
}

/** Keep Admin runDisplayView weather cards aligned with bundle C after finalize. */
export function applyFinalizedPastVisibleWeatherToRunDisplayView<
  T extends { weatherScore?: unknown } | null | undefined,
>(view: T, weather: Pick<ResolvePastVisibleWeatherScoreResult, "weatherSensitivity">): T {
  if (!view || !weather.weatherSensitivity.score) return view;
  return {
    ...view,
    weatherScore: weather.weatherSensitivity.score,
  };
}

export function buildAdminPastWeatherApiFields(
  weather: ResolvePastVisibleWeatherScoreResult
): {
  weatherSensitivityScore: WeatherSensitivityEnvelope["score"];
  weatherEfficiencyDerivedInput: WeatherSensitivityEnvelope["derivedInput"];
  weatherCardsSourceOwner: string;
  weatherScoringAudit: WeatherScoringAudit;
  weatherReadPath: PastDisplayWeatherReadPath;
  pastWeatherDiagnostics: PastParityAuditDiagnostics;
} {
  return {
    weatherSensitivityScore: weather.weatherSensitivity.score,
    weatherEfficiencyDerivedInput: weather.weatherSensitivity.derivedInput,
    weatherCardsSourceOwner: weather.weatherCardsSourceOwner,
    weatherScoringAudit: weather.weatherScoringAudit,
    weatherReadPath: weather.weatherReadPath,
    pastWeatherDiagnostics: weather.diagnostics,
  };
}
