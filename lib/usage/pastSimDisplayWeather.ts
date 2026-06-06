import {
  buildWeatherEfficiencyDerivedInput,
  type WeatherSensitivityEnvelope,
} from "@/modules/weatherSensitivity/shared";
import {
  PAST_DISPLAY_WEATHER_META_FIELD,
  persistPastDisplayWeatherScoringAudit,
  resolvePastDisplayWeatherScore,
} from "@/lib/usage/weatherScoringOwnership";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function isPastSimulatedDisplayDataset(dataset: Record<string, unknown>): boolean {
  const meta = asRecord(dataset.meta);
  return meta.datasetKind === "SIMULATED" && meta.baselinePassthrough !== true;
}

/**
 * Score weather cards from the stitched Past display series (all daily kWh rows),
 * not from pre-sim actual-usage snapshots used by the engine.
 */
export async function resolvePastSimDisplayWeatherSensitivityEnvelope(args: {
  dataset: Record<string, unknown>;
  homeProfile?: unknown;
  applianceProfile?: unknown;
  weatherHouseId?: string | null;
  preferredActualSource?: string | null;
}): Promise<WeatherSensitivityEnvelope> {
  const { audit: _audit, ...envelope } = await resolvePastDisplayWeatherScore(args);
  return envelope;
}

export function hasPersistedPastDisplayWeatherScore(dataset: Record<string, unknown> | null | undefined): boolean {
  const score = readPastSimDisplayWeatherSensitivityScore(dataset);
  return (
    score != null &&
    Object.keys(score).length > 0 &&
    typeof score.weatherEfficiencyScore0to100 === "number"
  );
}

export async function attachPastSimDisplayWeatherToDataset(args: {
  dataset: Record<string, unknown>;
  homeProfile?: unknown;
  applianceProfile?: unknown;
  weatherHouseId?: string | null;
  preferredActualSource?: string | null;
  forceRecompute?: boolean;
}): Promise<WeatherSensitivityEnvelope> {
  if (!args.forceRecompute && hasPersistedPastDisplayWeatherScore(args.dataset)) {
    const meta = asRecord(args.dataset.meta);
    meta.displayWeatherCardsSourceOwner =
      String(asRecord(meta.pastDisplayWeatherSensitivityScore).sourceOwner ?? "").trim() ||
      "past_artifact_build";
    meta.displayWeatherRecomputeCount = 0;
    args.dataset.meta = meta;
    const score = readPastSimDisplayWeatherSensitivityScore(args.dataset);
    const derivedInput =
      (meta.pastDisplayWeatherEfficiencyDerivedInput as WeatherSensitivityEnvelope["derivedInput"] | undefined) ??
      (score
        ? buildWeatherEfficiencyDerivedInput(score as NonNullable<WeatherSensitivityEnvelope["score"]>)
        : null);
    return {
      score: score as WeatherSensitivityEnvelope["score"],
      derivedInput,
    };
  }

  const scored = await resolvePastDisplayWeatherScore(args);
  if (!isPastSimulatedDisplayDataset(args.dataset)) return scored;

  const meta = asRecord(args.dataset.meta);
  if (scored.score) {
    meta.pastDisplayWeatherSensitivityScore = {
      ...scored.score,
      sourceOwner: "past_artifact_build",
      displayOwner: "past_artifact_build",
      scoringContext: "PAST_DISPLAY",
    };
    meta.pastDisplayWeatherEfficiencyDerivedInput =
      scored.derivedInput ?? buildWeatherEfficiencyDerivedInput(scored.score);
    meta.displayWeatherCardsSourceOwner = "past_artifact_build";
    meta.displayWeatherRecomputeCount = 1;
    persistPastDisplayWeatherScoringAudit(args.dataset, scored.audit);
    args.dataset.meta = meta;
  }
  return scored;
}

export function readPastSimDisplayWeatherSensitivityScore(
  dataset: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  if (!dataset || typeof dataset !== "object") return null;
  const meta = asRecord(dataset.meta);
  const pastDisplay = asRecord(meta.pastDisplayWeatherSensitivityScore);
  if (Object.keys(pastDisplay).length > 0) return pastDisplay;
  // Past display datasets must never fall back to pre-sim build diagnostic scores.
  return isPastSimulatedDisplayDataset(dataset) ? null : asRecord(meta.weatherSensitivityScore);
}

export { PAST_DISPLAY_WEATHER_META_FIELD };
