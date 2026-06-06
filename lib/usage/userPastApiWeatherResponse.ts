import {
  buildWeatherEfficiencyDerivedInput,
  type WeatherSensitivityEnvelope,
} from "@/modules/weatherSensitivity/shared";
import {
  attachPastSimDisplayWeatherToDataset,
  hasPersistedPastDisplayWeatherScore,
  PAST_DISPLAY_WEATHER_META_FIELD,
} from "@/lib/usage/pastSimDisplayWeather";
import {
  resolveUserPastVisibleWeatherSensitivityScore,
  shouldUsePastDisplayWeatherCards,
} from "@/lib/usage/userPastVisibleWeather";
import {
  buildWeatherScoringAudit,
  detectPastVisibleWeatherOwnerViolation,
  PAST_DISPLAY_WEATHER_META_FIELD as PAST_DISPLAY_FIELD,
  readPreSimBuildDiagnosticScore,
  resolveUsageSourceTypeFromDataset,
  scoreCardValues,
  type WeatherScoringAudit,
} from "@/lib/usage/weatherScoringOwnership";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export type UserPastApiWeatherDiagnostics = {
  routeOwner: "app/api/user/usage/simulated/house/route.ts";
  scenarioName: string | null;
  scenarioId: string | null;
  requestedHouseId: string;
  sourceHouseId: string | null;
  testHouseId: string | null;
  actualContextHouseId: string | null;
  artifactId: string | null;
  artifactInputHash: string | null;
  visibleWeatherScoreRaw: Record<string, unknown> | null;
  visibleWeatherScoreSourceField: string;
  visibleWeatherScoreSourceOwner: string;
  preSimDiagnosticScoreRaw: Record<string, unknown> | null;
  pastDisplayScoreRaw: Record<string, unknown> | null;
  ownerViolation: string | null;
  weatherReadPath: string;
};

function readArtifactIdentity(meta: Record<string, unknown>): {
  artifactId: string | null;
  artifactInputHash: string | null;
  actualContextHouseId: string | null;
  sourceHouseId: string | null;
  testHouseId: string | null;
} {
  const lockboxRunContext = asRecord(meta.lockboxRunContext);
  return {
    artifactId:
      String(meta.artifactId ?? meta.usageSimulatorArtifactId ?? meta.pastArtifactId ?? "").trim() || null,
    artifactInputHash:
      String(meta.artifactInputHash ?? meta.inputHash ?? meta.fullChainHash ?? "").trim() || null,
    actualContextHouseId:
      String(meta.actualContextHouseId ?? lockboxRunContext.actualContextHouseId ?? "").trim() || null,
    sourceHouseId:
      String(
        meta.sourceHouseId ??
          lockboxRunContext.sourceHouseId ??
          meta.actualContextHouseId ??
          lockboxRunContext.actualContextHouseId ??
          ""
      ).trim() || null,
    testHouseId: String(meta.testHouseId ?? lockboxRunContext.testHouseId ?? "").trim() || null,
  };
}

function pastDisplayScoreFromMeta(meta: Record<string, unknown>): Record<string, unknown> | null {
  const pastDisplay = asRecord(meta.pastDisplayWeatherSensitivityScore);
  return Object.keys(pastDisplay).length > 0 ? pastDisplay : null;
}

function shouldForcePastDisplayWeatherRecompute(args: {
  meta: Record<string, unknown>;
  visibleScore: Record<string, unknown> | null;
  visibleSourceOwner: string;
}): string | null {
  const preSim = readPreSimBuildDiagnosticScore(args.meta);
  const pastDisplay = pastDisplayScoreFromMeta(args.meta);
  const ownerViolation = detectPastVisibleWeatherOwnerViolation({
    meta: args.meta,
    visibleScore: args.visibleScore,
    visibleSourceOwner: args.visibleSourceOwner,
    actualBaselineScore: null,
  });
  if (ownerViolation) return ownerViolation;

  const visible = scoreCardValues(args.visibleScore);
  const preSimValues = scoreCardValues(preSim);
  if (
    preSimValues.weatherEfficiency != null &&
    visible.weatherEfficiency != null &&
    visible.weatherEfficiency === preSimValues.weatherEfficiency &&
    visible.cooling === preSimValues.cooling &&
    visible.heating === preSimValues.heating &&
    visible.confidence === preSimValues.confidence &&
    (!pastDisplay ||
      scoreCardValues(pastDisplay).weatherEfficiency == null ||
      scoreCardValues(pastDisplay).weatherEfficiency !== visible.weatherEfficiency)
  ) {
    return "visible Past weather matches pre-sim build diagnostic (meta.weatherSensitivityScore)";
  }

  return null;
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
  weatherReadPath: string;
  diagnostics: UserPastApiWeatherDiagnostics;
}> {
  const dataset = args.dataset;
  let meta = asRecord(dataset.meta);
  const artifactIdentity = readArtifactIdentity(meta);
  const usePastDisplayWeather = shouldUsePastDisplayWeatherCards({
    scenarioName: args.scenarioName,
    meta,
  });

  if (!usePastDisplayWeather) {
    throw new Error("resolveUserPastApiWeatherResponse called for non-past dataset");
  }

  let visible = resolveUserPastVisibleWeatherSensitivityScore({
    dataset,
    scenarioName: args.scenarioName,
  });
  let weatherReadPath = hasPersistedPastDisplayWeatherScore(dataset)
    ? "past_display_artifact_warm"
    : "past_display_finalize";
  let ownerViolation = shouldForcePastDisplayWeatherRecompute({
    meta,
    visibleScore: visible.score,
    visibleSourceOwner: visible.sourceOwner,
  });

  const needsAttach =
    visible.sourceOwner === "missing_past_display_weather" ||
    visible.score == null ||
    ownerViolation != null;

  if (needsAttach) {
    await attachPastSimDisplayWeatherToDataset({
      dataset,
      homeProfile: args.homeProfile,
      applianceProfile: args.applianceProfile,
      weatherHouseId: args.weatherHouseId,
      preferredActualSource: args.preferredActualSource ?? null,
      forceRecompute: true,
    });
    meta = asRecord(dataset.meta);
    visible = resolveUserPastVisibleWeatherSensitivityScore({
      dataset,
      scenarioName: args.scenarioName,
    });
    weatherReadPath = "past_display_forced_attach";
    ownerViolation = shouldForcePastDisplayWeatherRecompute({
      meta,
      visibleScore: visible.score,
      visibleSourceOwner: visible.sourceOwner,
    });
  }

  const pastDisplayRaw = pastDisplayScoreFromMeta(meta);
  const preSimRaw = readPreSimBuildDiagnosticScore(meta);
  const sourceField =
    pastDisplayRaw && visible.score && scoreCardValues(visible.score).weatherEfficiency != null
      ? PAST_DISPLAY_FIELD
      : visible.sourceOwner === "missing_past_display_weather"
        ? "missing"
        : PAST_DISPLAY_FIELD;

  const pastDisplayDerivedInput =
    (meta.pastDisplayWeatherEfficiencyDerivedInput as WeatherSensitivityEnvelope["derivedInput"] | undefined) ??
    null;
  const weatherSensitivity: WeatherSensitivityEnvelope = {
    score: visible.score as WeatherSensitivityEnvelope["score"],
    derivedInput:
      pastDisplayDerivedInput ??
      (visible.score
        ? buildWeatherEfficiencyDerivedInput(visible.score as never)
        : null),
  };

  const pastSourceType = resolveUsageSourceTypeFromDataset(dataset, {
    preferredActualSource: args.preferredActualSource ?? null,
  });
  const weatherScoringAudit =
    (meta.pastDisplayWeatherScoringAudit as WeatherScoringAudit | undefined) ??
    buildWeatherScoringAudit({
      scoringContext: "PAST_DISPLAY",
      scoringDataset: dataset,
      datasetKind: "SIMULATED",
      sourceType: pastSourceType,
      preferredActualSource: args.preferredActualSource ?? null,
      outputField: PAST_DISPLAY_WEATHER_META_FIELD,
      envelope: weatherSensitivity,
    });

  const diagnostics: UserPastApiWeatherDiagnostics = {
    routeOwner: "app/api/user/usage/simulated/house/route.ts",
    scenarioName: args.scenarioName,
    scenarioId: args.scenarioId,
    requestedHouseId: args.requestedHouseId,
    sourceHouseId: artifactIdentity.sourceHouseId,
    testHouseId: artifactIdentity.testHouseId,
    actualContextHouseId: artifactIdentity.actualContextHouseId,
    artifactId: artifactIdentity.artifactId,
    artifactInputHash: artifactIdentity.artifactInputHash,
    visibleWeatherScoreRaw: visible.score,
    visibleWeatherScoreSourceField: sourceField,
    visibleWeatherScoreSourceOwner: visible.sourceOwner,
    preSimDiagnosticScoreRaw: preSimRaw,
    pastDisplayScoreRaw: pastDisplayRaw,
    ownerViolation,
    weatherReadPath,
  };

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
    const rejectedPreSimFallback =
      preSimValues.weatherEfficiency != null &&
      topValues.weatherEfficiency === preSimValues.weatherEfficiency &&
      topValues.cooling === preSimValues.cooling &&
      topValues.heating === preSimValues.heating &&
      topValues.confidence === preSimValues.confidence &&
      (pastDisplay == null ||
        pastDisplayValues.weatherEfficiency == null ||
        topValues.weatherEfficiency !== pastDisplayValues.weatherEfficiency);

    if (rejectedPreSimFallback) {
      if (pastDisplay) {
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
