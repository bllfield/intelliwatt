import { readPastValidationPolicyRevisionFromMeta } from "@/lib/usage/pastSimulationCoreLabel";
import { readPastSimDisplayWeatherSensitivityScore } from "@/lib/usage/pastSimDisplayWeather";
import {
  PAST_DISPLAY_WEATHER_META_FIELD,
  readPreSimBuildDiagnosticScore,
  type WeatherScoringAudit,
} from "@/lib/usage/weatherScoringOwnership";
import { resolveUserPastVisibleWeatherSensitivityScore } from "@/lib/usage/userPastVisibleWeather";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asDateKey(value: unknown): string | null {
  const text = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

export type PastDisplayWeatherReadPath =
  | "past_display_artifact_warm"
  | "past_display_finalize_recompute"
  | "past_display_missing";

export type PastVisibleWeatherReadDiagnostics = {
  routeOwner: string;
  artifactId: string | null;
  artifactInputHash: string | null;
  scenarioId: string | null;
  actualContextHouseId: string | null;
  weatherHouseId: string | null;
  coverageStartDateKey: string | null;
  coverageEndDateKey: string | null;
  validationPolicyVersion: string | null;
  visibleWeatherScore: Record<string, unknown> | null;
  visibleWeatherScoreSourceField: string;
  visibleWeatherScoreSourceOwner: string;
  topLevelWeatherSensitivityScore: Record<string, unknown> | null;
  datasetMetaPastDisplayWeatherSensitivityScore: Record<string, unknown> | null;
  datasetMetaWeatherSensitivityScore: Record<string, unknown> | null;
  weatherScoringAudit: WeatherScoringAudit | null;
  weatherCardsSourceOwner: string | null;
  weatherReadPath: PastDisplayWeatherReadPath;
  displayTruthRevision: string | null;
  displayWeatherRecomputeCount: number | null;
  pastDisplayWeatherCachePersisted: boolean;
  clientPayloadCacheKey: string | null;
};

function readArtifactIdentity(meta: Record<string, unknown>): {
  artifactId: string | null;
  artifactInputHash: string | null;
} {
  return {
    artifactId:
      String(meta.artifactId ?? meta.usageSimulatorArtifactId ?? meta.pastArtifactId ?? "").trim() || null,
    artifactInputHash:
      String(meta.artifactInputHash ?? meta.inputHash ?? meta.fullChainHash ?? "").trim() || null,
  };
}

function coverageWindowFromDataset(dataset: Record<string, unknown>): {
  startDateKey: string | null;
  endDateKey: string | null;
} {
  const meta = asRecord(dataset.meta);
  const summary = asRecord(dataset.summary);
  const startDateKey =
    asDateKey(meta.coverageStart) ?? asDateKey(summary.start) ?? asDateKey(meta.coverageStartDate);
  const endDateKey = asDateKey(meta.coverageEnd) ?? asDateKey(summary.end) ?? asDateKey(meta.coverageEndDate);
  return { startDateKey, endDateKey };
}

export function buildPastVisibleWeatherClientCacheKey(args: {
  houseId: string;
  scenarioId?: string | null;
  artifactInputHash?: string | null;
}): string {
  const houseId = String(args.houseId ?? "").trim();
  const scenarioId = String(args.scenarioId ?? "BASELINE").trim() || "BASELINE";
  const artifactInputHash = String(args.artifactInputHash ?? "").trim() || "none";
  return `past-visible-weather:${houseId}:${scenarioId}:${artifactInputHash}`;
}

export function buildPastVisibleWeatherReadDiagnostics(args: {
  routeOwner: string;
  dataset: Record<string, unknown>;
  scenarioName?: string | null;
  scenarioId?: string | null;
  requestedHouseId: string;
  weatherHouseId?: string | null;
  topLevelWeatherSensitivityScore?: unknown;
  weatherCardsSourceOwner?: string | null;
  weatherScoringAudit?: WeatherScoringAudit | null;
  weatherReadPath: PastDisplayWeatherReadPath;
}): PastVisibleWeatherReadDiagnostics {
  const meta = asRecord(args.dataset.meta);
  const identity = readArtifactIdentity(meta);
  const coverage = coverageWindowFromDataset(args.dataset);
  const visible = resolveUserPastVisibleWeatherSensitivityScore({
    dataset: args.dataset,
    scenarioName: args.scenarioName ?? null,
  });
  const pastDisplay = readPastSimDisplayWeatherSensitivityScore(args.dataset);
  const preSim = readPreSimBuildDiagnosticScore(meta);
  const topLevel = asRecord(args.topLevelWeatherSensitivityScore);
  const persistedAudit = asRecord(meta.pastDisplayWeatherScoringAudit);
  const lockbox = asRecord(meta.lockboxRunContext);
  const actualContextHouseId =
    String(meta.actualContextHouseId ?? lockbox.actualContextHouseId ?? "").trim() || null;
  const weatherHouseId =
    String(args.weatherHouseId ?? actualContextHouseId ?? args.requestedHouseId).trim() || null;
  const recomputeCount = Number(meta.displayWeatherRecomputeCount);

  return {
    routeOwner: args.routeOwner,
    artifactId: identity.artifactId,
    artifactInputHash: identity.artifactInputHash,
    scenarioId: args.scenarioId ?? null,
    actualContextHouseId,
    weatherHouseId,
    coverageStartDateKey: coverage.startDateKey,
    coverageEndDateKey: coverage.endDateKey,
    validationPolicyVersion: readPastValidationPolicyRevisionFromMeta(meta),
    visibleWeatherScore: visible.score,
    visibleWeatherScoreSourceField: PAST_DISPLAY_WEATHER_META_FIELD,
    visibleWeatherScoreSourceOwner: visible.sourceOwner,
    topLevelWeatherSensitivityScore: Object.keys(topLevel).length > 0 ? topLevel : null,
    datasetMetaPastDisplayWeatherSensitivityScore: pastDisplay,
    datasetMetaWeatherSensitivityScore: preSim,
    weatherScoringAudit:
      args.weatherScoringAudit ??
      (Object.keys(persistedAudit).length > 0
        ? (persistedAudit as WeatherScoringAudit)
        : null),
    weatherCardsSourceOwner:
      String(args.weatherCardsSourceOwner ?? meta.displayWeatherCardsSourceOwner ?? visible.sourceOwner ?? "").trim() ||
      null,
    weatherReadPath: args.weatherReadPath,
    displayTruthRevision: String(meta.pastDisplayWeatherDisplayTruthRevision ?? "").trim() || null,
    displayWeatherRecomputeCount: Number.isFinite(recomputeCount) ? recomputeCount : null,
    pastDisplayWeatherCachePersisted: meta.pastDisplayWeatherCachePersisted === true,
    clientPayloadCacheKey: buildPastVisibleWeatherClientCacheKey({
      houseId: args.requestedHouseId,
      scenarioId: args.scenarioId,
      artifactInputHash: identity.artifactInputHash,
    }),
  };
}

export function resolvePastVisibleWeatherEnvelopeFromDataset(args: {
  dataset: Record<string, unknown>;
  scenarioName?: string | null;
}): {
  score: Record<string, unknown> | null;
  sourceOwner: string;
  sourceField: string;
  scoringAudit: WeatherScoringAudit | null;
  derivedInput: unknown;
} {
  const meta = asRecord(args.dataset.meta);
  const visible = resolveUserPastVisibleWeatherSensitivityScore({
    dataset: args.dataset,
    scenarioName: args.scenarioName ?? null,
  });
  const persistedAudit = asRecord(meta.pastDisplayWeatherScoringAudit);
  return {
    score: visible.score,
    sourceOwner: visible.sourceOwner,
    sourceField: PAST_DISPLAY_WEATHER_META_FIELD,
    scoringAudit:
      Object.keys(persistedAudit).length > 0 ? (persistedAudit as WeatherScoringAudit) : null,
    derivedInput: meta.pastDisplayWeatherEfficiencyDerivedInput ?? null,
  };
}

export function resolvePastWeatherHouseIdFromDataset(args: {
  dataset: Record<string, unknown>;
  fallbackHouseId: string;
}): string {
  const meta = asRecord(args.dataset.meta);
  const lockbox = asRecord(meta.lockboxRunContext);
  const lockboxInput = asRecord(meta.lockboxInput);
  const profileContext = asRecord(lockboxInput.profileContext);
  const sourceContext = asRecord(lockboxInput.sourceContext);
  // Past weather scoring profiles follow the sim build profile house, not GB actual-context house.
  const profileHouseId =
    String(profileContext.profileHouseId ?? sourceContext.sourceHouseId ?? "").trim() || null;
  if (profileHouseId) return profileHouseId;
  return (
    String(meta.actualContextHouseId ?? lockbox.actualContextHouseId ?? args.fallbackHouseId).trim() ||
    args.fallbackHouseId
  );
}

export function resolvePreferredActualSourceFromDataset(dataset: Record<string, unknown>): string | null {
  const meta = asRecord(dataset.meta);
  const lockbox = asRecord(meta.lockboxRunContext);
  const preferred = String(
    meta.preferredActualSource ?? lockbox.preferredActualSource ?? asRecord(dataset.summary).source ?? ""
  ).trim();
  return preferred || null;
}

export function pastDisplayWeatherReadPathFromMeta(meta: Record<string, unknown>): PastDisplayWeatherReadPath {
  if (readPastSimDisplayWeatherSensitivityScore({ meta }) == null) {
    return "past_display_missing";
  }
  const recomputeCount = Number(meta.displayWeatherRecomputeCount);
  if (Number.isFinite(recomputeCount) && recomputeCount > 0) {
    return "past_display_finalize_recompute";
  }
  return "past_display_artifact_warm";
}
