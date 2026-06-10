import type { WeatherSensitivityEnvelope } from "@/modules/weatherSensitivity/shared";
import type { PastDisplayWeatherFinalizeOutcome } from "@/lib/usage/pastDisplayWeatherFinalizeGuard";
import { applyManualPastWeatherExplanationCopy } from "@/lib/usage/manualPastDisplayPolicy";
import {
  resolvePastVisibleWeatherScore,
  type PastParityAuditDiagnostics,
} from "@/lib/usage/resolvePastVisibleWeatherScore";
import type { PastDisplayWeatherReadPath } from "@/lib/usage/pastVisibleWeatherReadDiagnostics";
import {
  PAST_DISPLAY_WEATHER_META_FIELD as PAST_DISPLAY_FIELD,
  readPreSimBuildDiagnosticScore,
  scoreCardValues,
  weatherScoreCardValuesMatch,
  type WeatherScoringAudit,
} from "@/lib/usage/weatherScoringOwnership";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** @deprecated Use PastParityAuditDiagnostics from resolvePastVisibleWeatherScore.ts */
export type UserPastApiWeatherDiagnostics = PastParityAuditDiagnostics;

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
  compareProjection?: Record<string, unknown> | null;
  finalizeOutcome?: PastDisplayWeatherFinalizeOutcome | null;
}): Promise<{
  weatherSensitivity: WeatherSensitivityEnvelope;
  weatherCardsSourceOwner: string;
  weatherScoringAudit: WeatherScoringAudit;
  weatherReadPath: PastDisplayWeatherReadPath;
  diagnostics: PastParityAuditDiagnostics;
}> {
  return resolvePastVisibleWeatherScore({
    finalizedDataset: args.dataset,
    routeOwner: "app/api/user/usage/simulated/house/route.ts",
    scenarioName: args.scenarioName,
    scenarioId: args.scenarioId,
    requestedHouseId: args.requestedHouseId,
    weatherHouseId: args.weatherHouseId,
    preferredActualSource: args.preferredActualSource ?? null,
    compareProjection: args.compareProjection ?? null,
    finalizeOutcome: args.finalizeOutcome ?? null,
  });
}

function readDatasetMeta(dataset: unknown): Record<string, unknown> {
  if (!dataset || typeof dataset !== "object" || Array.isArray(dataset)) return {};
  return asRecord((dataset as { meta?: unknown }).meta);
}

function withManualPastWeatherDisplayCopy(
  score: Record<string, unknown> | null,
  meta: Record<string, unknown>
): Record<string, unknown> | null {
  return applyManualPastWeatherExplanationCopy(score, meta);
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
  const isPastSimulatedDisplay = meta.datasetKind === "SIMULATED" && meta.baselinePassthrough !== true;

  if (isPastSimulatedDisplay && pastDisplay) {
    const pastDisplayValues = scoreCardValues(pastDisplay);
    const topValues = scoreCardValues(topLevel);
    const preSimValues = scoreCardValues(preSim);
    const topMatchesPreSim =
      preSimValues.weatherEfficiency != null &&
      topValues.weatherEfficiency === preSimValues.weatherEfficiency &&
      topValues.cooling === preSimValues.cooling &&
      topValues.heating === preSimValues.heating &&
      topValues.confidence === preSimValues.confidence;
    const topDiffersFromC =
      pastDisplayValues.weatherEfficiency != null &&
      (topValues.weatherEfficiency !== pastDisplayValues.weatherEfficiency ||
        topValues.cooling !== pastDisplayValues.cooling ||
        topValues.heating !== pastDisplayValues.heating ||
        topValues.confidence !== pastDisplayValues.confidence);

    return {
      score: withManualPastWeatherDisplayCopy(pastDisplay, meta),
      sourceField: PAST_DISPLAY_FIELD,
      sourceOwner: "past_artifact_build",
      rejectedPreSimFallback: topMatchesPreSim || topDiffersFromC,
    };
  }

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
          score: withManualPastWeatherDisplayCopy(pastDisplay, meta),
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
          score: withManualPastWeatherDisplayCopy(pastDisplay, meta),
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
        score: withManualPastWeatherDisplayCopy(pastDisplay, meta),
        sourceField: PAST_DISPLAY_FIELD,
        sourceOwner: "past_artifact_build",
        rejectedPreSimFallback: false,
      };
    }

    return {
      score: withManualPastWeatherDisplayCopy(topLevel, meta),
      sourceField: PAST_DISPLAY_FIELD,
      sourceOwner: "past_artifact_build",
      rejectedPreSimFallback: false,
    };
  }

  if (pastDisplay) {
    return {
      score: withManualPastWeatherDisplayCopy(pastDisplay, meta),
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
