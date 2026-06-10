import { applyManualPastWeatherExplanationCopy } from "@/lib/usage/manualPastDisplayPolicy";
import { readPastSimDisplayWeatherSensitivityScore } from "@/lib/usage/pastSimDisplayWeather";
import { WORKSPACE_PAST_SCENARIO_NAME } from "@/lib/usage/onePathPastUserSiteParityTypes";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function isPastSimulatedDisplayDatasetMeta(meta: Record<string, unknown>): boolean {
  return meta.datasetKind === "SIMULATED" && meta.baselinePassthrough !== true;
}

export function shouldUsePastDisplayWeatherCards(args: {
  scenarioName?: string | null;
  meta?: Record<string, unknown> | null;
}): boolean {
  if (String(args.scenarioName ?? "").trim() === WORKSPACE_PAST_SCENARIO_NAME) return true;
  const meta = asRecord(args.meta);
  return isPastSimulatedDisplayDatasetMeta(meta);
}

export function resolveUserPastVisibleWeatherSensitivityScore(args: {
  dataset: Record<string, unknown> | null | undefined;
  scenarioName?: string | null;
}): {
  score: Record<string, unknown> | null;
  sourceOwner: string;
} {
  const dataset = asRecord(args.dataset);
  const meta = asRecord(dataset.meta);
  if (!shouldUsePastDisplayWeatherCards({ scenarioName: args.scenarioName, meta })) {
    return { score: null, sourceOwner: "not_past_workspace" };
  }

  const score = readPastSimDisplayWeatherSensitivityScore(dataset);
  if (score && Object.keys(score).length > 0 && typeof score.weatherEfficiencyScore0to100 === "number") {
    const displayScore = applyManualPastWeatherExplanationCopy(score, meta);
    return {
      score: displayScore,
      sourceOwner:
        String(displayScore?.sourceOwner ?? meta.displayWeatherCardsSourceOwner ?? "").trim() ||
        "past_artifact_build",
    };
  }

  return { score: null, sourceOwner: "missing_past_display_weather" };
}
