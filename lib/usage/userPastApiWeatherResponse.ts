import {
  buildWeatherEfficiencyDerivedInput,
  type WeatherSensitivityEnvelope,
} from "@/modules/weatherSensitivity/shared";
import { PAST_DISPLAY_WEATHER_META_FIELD } from "@/lib/usage/pastSimDisplayWeather";
import {
  buildPastVisibleWeatherReadDiagnostics,
  pastDisplayWeatherReadPathFromMeta,
  resolvePastVisibleWeatherEnvelopeFromDataset,
  type PastDisplayWeatherReadPath,
  type PastVisibleWeatherReadDiagnostics,
} from "@/lib/usage/pastVisibleWeatherReadDiagnostics";
import {
  buildWeatherScoringAudit,
  pastDisplayScoreMatchesPreSimDiagnostic,
  PAST_DISPLAY_WEATHER_META_FIELD as PAST_DISPLAY_FIELD,
  readPreSimBuildDiagnosticScore,
  resolveUsageSourceTypeFromDataset,
  scoreCardValues,
  weatherScoreCardValuesMatch,
  type WeatherScoringAudit,
} from "@/lib/usage/weatherScoringOwnership";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** @deprecated Use PastVisibleWeatherReadDiagnostics from pastVisibleWeatherReadDiagnostics.ts */
export type UserPastApiWeatherDiagnostics = PastVisibleWeatherReadDiagnostics;

function pastDisplayScoreFromMeta(meta: Record<string, unknown>): Record<string, unknown> | null {
  const pastDisplay = asRecord(meta.pastDisplayWeatherSensitivityScore);
  return Object.keys(pastDisplay).length > 0 ? pastDisplay : null;
}

export async function resolveUserPastApiWeatherResponse(args: {
  dataset: Record<string, unknown>;
  scenarioName: string | null;
  scenarioId: string | null;
  requestedHouseId: string;
  preferredActualSource?: string | null;
  homeProfile?: unknown;
  applianceProfile?: unknown;
  weatherHouseId: string;
}): Promise<{
  weatherSensitivity: WeatherSensitivityEnvelope;
  weatherCardsSourceOwner: string;
  weatherScoringAudit: WeatherScoringAudit;
  weatherReadPath: PastDisplayWeatherReadPath;
  diagnostics: PastVisibleWeatherReadDiagnostics;
}> {
  const dataset = args.dataset;
  const meta = asRecord(dataset.meta);
  const visible = resolvePastVisibleWeatherEnvelopeFromDataset({
    dataset,
    scenarioName: args.scenarioName,
  });
  const weatherReadPath = pastDisplayWeatherReadPathFromMeta(meta);
  const pastSourceType = resolveUsageSourceTypeFromDataset(dataset, {
    preferredActualSource: args.preferredActualSource ?? null,
  });

  const storedDerivedInput =
    meta.pastDisplayWeatherEfficiencyDerivedInput as WeatherSensitivityEnvelope["derivedInput"] | undefined;
  const weatherSensitivity: WeatherSensitivityEnvelope = {
    score: visible.score as WeatherSensitivityEnvelope["score"],
    derivedInput:
      storedDerivedInput ??
      (visible.score && Array.isArray((visible.score as { requiredInputAdjustmentsApplied?: unknown }).requiredInputAdjustmentsApplied)
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

  const diagnostics = buildPastVisibleWeatherReadDiagnostics({
    routeOwner: "app/api/user/usage/simulated/house/route.ts",
    dataset,
    scenarioName: args.scenarioName,
    scenarioId: args.scenarioId,
    requestedHouseId: args.requestedHouseId,
    weatherHouseId: args.weatherHouseId,
    topLevelWeatherSensitivityScore: weatherSensitivity.score,
    weatherCardsSourceOwner: visible.sourceOwner,
    weatherScoringAudit,
    weatherReadPath,
  });

  return {
    weatherSensitivity,
    weatherCardsSourceOwner: visible.sourceOwner,
    weatherScoringAudit,
    weatherReadPath,
    diagnostics,
  };
}

function readDatasetMeta(dataset: unknown): Record<string, unknown> {
  if (!dataset || typeof dataset !== "object" || Array.isArray(dataset)) return {};
  return asRecord((dataset as { meta?: unknown }).meta);
}

export function resolvePastWeatherScoreFromHouseApiBody(args: {
  weatherSensitivityScore: unknown;
  weatherCardsSourceOwner?: string | null;
  dataset?: unknown;
}): {
  score: Record<string, unknown> | null;
  sourceField: string;
  sourceOwner: string;
  rejectedPreSimFallback: boolean;
} {
  const meta = readDatasetMeta(args.dataset);
  const pastDisplay = pastDisplayScoreFromMeta(meta);
  const preSim = readPreSimBuildDiagnosticScore(meta);
  const topLevel = asRecord(args.weatherSensitivityScore);
  const owner = String(args.weatherCardsSourceOwner ?? "").trim() || "unknown";

  if (Object.keys(topLevel).length > 0 && typeof topLevel.weatherEfficiencyScore0to100 === "number") {
    const topValues = scoreCardValues(topLevel);
    const preSimValues = scoreCardValues(preSim);
    const pastDisplayValues = scoreCardValues(pastDisplay);
    const pastDisplayMatchesPreSim =
      pastDisplay != null &&
      preSimValues.weatherEfficiency != null &&
      weatherScoreCardValuesMatch(pastDisplay, preSim);
    const rejectedPreSimFallback =
      preSimValues.weatherEfficiency != null &&
      topValues.weatherEfficiency === preSimValues.weatherEfficiency &&
      topValues.cooling === preSimValues.cooling &&
      topValues.heating === preSimValues.heating &&
      topValues.confidence === preSimValues.confidence &&
      (pastDisplay == null ||
        pastDisplayValues.weatherEfficiency == null ||
        topValues.weatherEfficiency !== pastDisplayValues.weatherEfficiency ||
        pastDisplayMatchesPreSim);

    if (rejectedPreSimFallback) {
      if (pastDisplay && !pastDisplayMatchesPreSim) {
        return {
          score: pastDisplay,
          sourceField: PAST_DISPLAY_FIELD,
          sourceOwner: "past_artifact_build",
          rejectedPreSimFallback: true,
        };
      }
      return {
        score: null,
        sourceField: "missing",
        sourceOwner: "missing_past_display_weather",
        rejectedPreSimFallback: true,
      };
    }

    if (owner !== "past_artifact_build") {
      if (pastDisplay) {
        return {
          score: pastDisplay,
          sourceField: PAST_DISPLAY_FIELD,
          sourceOwner: "past_artifact_build",
          rejectedPreSimFallback: false,
        };
      }
      return {
        score: null,
        sourceField: "missing",
        sourceOwner: owner || "missing_past_display_weather",
        rejectedPreSimFallback: false,
      };
    }

    if (
      pastDisplay &&
      pastDisplayValues.weatherEfficiency != null &&
      (topValues.weatherEfficiency !== pastDisplayValues.weatherEfficiency ||
        topValues.cooling !== pastDisplayValues.cooling ||
        topValues.heating !== pastDisplayValues.heating ||
        topValues.confidence !== pastDisplayValues.confidence)
    ) {
      return {
        score: pastDisplay,
        sourceField: PAST_DISPLAY_FIELD,
        sourceOwner: "past_artifact_build",
        rejectedPreSimFallback: false,
      };
    }

    return {
      score: topLevel,
      sourceField: PAST_DISPLAY_FIELD,
      sourceOwner: "past_artifact_build",
      rejectedPreSimFallback: false,
    };
  }

  if (pastDisplay) {
    return {
      score: pastDisplay,
      sourceField: PAST_DISPLAY_FIELD,
      sourceOwner: "past_artifact_build",
      rejectedPreSimFallback: Boolean(preSim),
    };
  }

  return {
    score: null,
    sourceField: "missing",
    sourceOwner: owner || "missing_past_display_weather",
    rejectedPreSimFallback: false,
  };
}
