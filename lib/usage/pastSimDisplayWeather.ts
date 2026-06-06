import {
  buildWeatherEfficiencyDerivedInput,
  resolveSharedWeatherSensitivityEnvelope,
  type WeatherSensitivityEnvelope,
} from "@/modules/weatherSensitivity/shared";

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
}): Promise<WeatherSensitivityEnvelope> {
  const daily = Array.isArray(args.dataset.daily) ? args.dataset.daily : [];
  const scoringDataset = {
    daily: daily.map((row) => {
      const record = asRecord(row);
      return {
        ...record,
        source: "ACTUAL",
        sourceDetail: "ACTUAL",
      };
    }),
    dailyWeather: args.dataset.dailyWeather,
  };
  return resolveSharedWeatherSensitivityEnvelope({
    actualDataset: scoringDataset,
    homeProfile: args.homeProfile,
    applianceProfile: args.applianceProfile,
    weatherHouseId: args.weatherHouseId ?? null,
  });
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

  const envelope = await resolvePastSimDisplayWeatherSensitivityEnvelope(args);
  if (!isPastSimulatedDisplayDataset(args.dataset)) return envelope;

  const meta = asRecord(args.dataset.meta);
  if (envelope.score) {
    meta.pastDisplayWeatherSensitivityScore = {
      ...envelope.score,
      sourceOwner: "past_artifact_build",
    };
    meta.pastDisplayWeatherEfficiencyDerivedInput =
      envelope.derivedInput ?? buildWeatherEfficiencyDerivedInput(envelope.score);
    meta.displayWeatherCardsSourceOwner = "past_artifact_build";
    meta.displayWeatherRecomputeCount = 1;
    args.dataset.meta = meta;
  }
  return envelope;
}

export function readPastSimDisplayWeatherSensitivityScore(
  dataset: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  if (!dataset || typeof dataset !== "object") return null;
  const meta = asRecord(dataset.meta);
  const pastDisplay = asRecord(meta.pastDisplayWeatherSensitivityScore);
  if (Object.keys(pastDisplay).length > 0) return pastDisplay;
  return isPastSimulatedDisplayDataset(dataset) ? null : asRecord(meta.weatherSensitivityScore);
}
