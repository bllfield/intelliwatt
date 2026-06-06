import { createHash } from "crypto";

import { buildPastArtifactDatasetJsonForStorage } from "@/modules/onePathSim/usageSimulator/artifactStorage";
import {
  getCachedPastDataset,
  saveCachedPastDataset,
} from "@/modules/onePathSim/usageSimulator/pastCache";
import {
  hasPersistedPastDisplayWeatherScore,
  readPastSimDisplayWeatherSensitivityScore,
} from "@/lib/usage/pastSimDisplayWeather";
import { readPastValidationPolicyRevisionFromMeta } from "@/lib/usage/pastSimulationCoreLabel";
import { readGreenButtonTrustedHomeDateKeysFromPastMeta } from "@/lib/usage/greenButtonPastTrustedPool";
import {
  pastDisplayScoreMatchesPreSimDiagnostic,
  PAST_DISPLAY_WEATHER_META_FIELD,
} from "@/lib/usage/weatherScoringOwnership";

export const PAST_DISPLAY_WEATHER_FINALIZE_VERSION = "past_display_weather_finalize_v2";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function readArtifactCacheIdentity(meta: Record<string, unknown>): {
  inputHash: string | null;
  scenarioId: string | null;
  houseId: string | null;
  engineVersion: string | null;
  windowStartUtc: string | null;
  windowEndUtc: string | null;
} {
  return {
    inputHash:
      String(
        meta.artifactInputHash ??
          meta.artifactInputHashUsed ??
          meta.inputHash ??
          meta.fullChainHash ??
          ""
      ).trim() || null,
    scenarioId: String(meta.artifactScenarioId ?? meta.scenarioId ?? "").trim() || null,
    houseId: String(meta.artifactHouseId ?? meta.houseId ?? "").trim() || null,
    engineVersion: String(meta.engineVersion ?? meta.pastEngineVersion ?? "").trim() || null,
    windowStartUtc:
      String(meta.coverageStart ?? meta.windowStartUtc ?? meta.coverageStartDate ?? "").slice(0, 10) || null,
    windowEndUtc:
      String(meta.coverageEnd ?? meta.windowEndUtc ?? meta.coverageEndDate ?? "").slice(0, 10) || null,
  };
}

/** Stable fingerprint of finalized display daily rows + weather scoring inputs. */
export function computePastDisplayTruthRevision(args: {
  dataset: Record<string, unknown>;
  weatherHouseId?: string | null;
}): string {
  const meta = asRecord(args.dataset.meta);
  const daily = Array.isArray(args.dataset.daily)
    ? (args.dataset.daily as Array<{ date?: unknown; kwh?: unknown; source?: unknown }>)
    : [];
  const dailyFingerprint = daily
    .map((row) => {
      const date = String(row.date ?? "").slice(0, 10);
      const kwh = round2(Number(row.kwh) || 0);
      const source = String(row.source ?? "").trim().toUpperCase();
      return `${date}|${kwh}|${source}`;
    })
    .sort()
    .join(";");

  const trustedKeys = Array.from(readGreenButtonTrustedHomeDateKeysFromPastMeta(meta)).sort().join(",");
  const coverageStart = String(meta.coverageStart ?? asRecord(args.dataset.summary).start ?? "").slice(0, 10);
  const coverageEnd = String(meta.coverageEnd ?? asRecord(args.dataset.summary).end ?? "").slice(0, 10);
  const weatherHouseId = String(args.weatherHouseId ?? meta.actualContextHouseId ?? "").trim();
  const validationRevision = readPastValidationPolicyRevisionFromMeta(meta) ?? "";
  const dailyWeatherKeys = Object.keys(asRecord(args.dataset.dailyWeather ?? meta.dailyWeatherByDateKey))
    .sort()
    .join(",");

  const canonical = [
    PAST_DISPLAY_WEATHER_FINALIZE_VERSION,
    dailyFingerprint,
    trustedKeys,
    coverageStart,
    coverageEnd,
    weatherHouseId,
    validationRevision,
    dailyWeatherKeys,
  ].join("\n");

  return createHash("sha256").update(canonical, "utf8").digest("base64url").slice(0, 22);
}

export function shouldRecomputePastDisplayWeather(args: {
  dataset: Record<string, unknown>;
  displayTruthRevision: string;
}): boolean {
  const meta = asRecord(args.dataset.meta);
  if (!hasPersistedPastDisplayWeatherScore(args.dataset)) return true;
  if (pastDisplayScoreMatchesPreSimDiagnostic(meta)) return true;
  const persistedRevision = String(meta.pastDisplayWeatherDisplayTruthRevision ?? "").trim();
  if (!persistedRevision || persistedRevision !== args.displayTruthRevision) return true;
  const finalizeVersion = String(meta.pastDisplayWeatherFinalizeVersion ?? "").trim();
  if (finalizeVersion !== PAST_DISPLAY_WEATHER_FINALIZE_VERSION) return true;
  return false;
}

export type PastDisplayWeatherFinalizeOutcome = {
  displayTruthRevision: string;
  weatherRecomputed: boolean;
  weatherReadPath: "past_display_artifact_warm" | "past_display_finalize_recompute";
  cachePersisted: boolean;
  cachePersistReason: string | null;
};

export function readPastDisplayWeatherFinalizeOutcomeFromMeta(
  meta: Record<string, unknown>
): Pick<
  PastDisplayWeatherFinalizeOutcome,
  "displayTruthRevision" | "weatherRecomputed" | "weatherReadPath" | "cachePersisted"
> {
  const recomputeCount = Number(meta.displayWeatherRecomputeCount);
  const weatherRecomputed = Number.isFinite(recomputeCount) && recomputeCount > 0;
  return {
    displayTruthRevision: String(meta.pastDisplayWeatherDisplayTruthRevision ?? "").trim(),
    weatherRecomputed,
    weatherReadPath: weatherRecomputed ? "past_display_finalize_recompute" : "past_display_artifact_warm",
    cachePersisted: meta.pastDisplayWeatherCachePersisted === true,
  };
}

function readCanonicalTotals(dataset: Record<string, unknown>): Record<string, number> {
  const direct = asRecord(dataset.canonicalArtifactSimulatedDayTotalsByDate);
  if (Object.keys(direct).length > 0) return direct as Record<string, number>;
  const metaTotals = asRecord(asRecord(dataset.meta).canonicalArtifactSimulatedDayTotalsByDate);
  return Object.keys(metaTotals).length > 0 ? (metaTotals as Record<string, number>) : {};
}

/**
 * Persist finalized display truth + bundle C back to the artifact cache row so warm reads stabilize.
 * Non-fatal when cache row or identity is missing.
 */
export async function persistPastDisplayWeatherToArtifactCache(args: {
  dataset: Record<string, unknown>;
  houseId: string;
  scenarioId: string;
}): Promise<{ ok: boolean; reason: string | null }> {
  const meta = asRecord(args.dataset.meta);
  const identity = readArtifactCacheIdentity(meta);
  const inputHash = identity.inputHash;
  if (!inputHash) return { ok: false, reason: "missing_artifact_input_hash" };

  const cached = await getCachedPastDataset({
    houseId: args.houseId,
    scenarioId: args.scenarioId,
    inputHash,
  });
  if (!cached?.intervalsCompressed) return { ok: false, reason: "cache_miss" };

  const canonicalArtifactSimulatedDayTotalsByDate = readCanonicalTotals(args.dataset);
  const datasetJsonForStorage = buildPastArtifactDatasetJsonForStorage({
    dataset: args.dataset,
    canonicalArtifactSimulatedDayTotalsByDate,
  });

  const windowStartUtc =
    identity.windowStartUtc ??
    String(asRecord(args.dataset.summary).start ?? "").slice(0, 10) ??
    "1970-01-01";
  const windowEndUtc =
    identity.windowEndUtc ?? String(asRecord(args.dataset.summary).end ?? "").slice(0, 10) ?? "1970-01-01";

  await saveCachedPastDataset({
    houseId: args.houseId,
    scenarioId: args.scenarioId,
    inputHash,
    engineVersion: identity.engineVersion ?? "production_past_stitched_v16",
    windowStartUtc,
    windowEndUtc,
    datasetJson: datasetJsonForStorage,
    intervalsCodec: cached.intervalsCodec,
    intervalsCompressed: cached.intervalsCompressed,
  });

  meta.pastDisplayWeatherCachePersisted = true;
  meta.pastDisplayWeatherCachePersistedAt = new Date().toISOString();
  meta.pastDisplayWeatherCachePersistField = PAST_DISPLAY_WEATHER_META_FIELD;
  args.dataset.meta = meta;

  return { ok: true, reason: null };
}

export function stampPastDisplayWeatherFinalizeMeta(args: {
  dataset: Record<string, unknown>;
  displayTruthRevision: string;
  weatherRecomputed: boolean;
}): void {
  const meta = asRecord(args.dataset.meta);
  meta.pastDisplayWeatherDisplayTruthRevision = args.displayTruthRevision;
  meta.pastDisplayWeatherFinalizeVersion = PAST_DISPLAY_WEATHER_FINALIZE_VERSION;
  if (!args.weatherRecomputed && readPastSimDisplayWeatherSensitivityScore(args.dataset)) {
    meta.displayWeatherRecomputeCount = 0;
  }
  args.dataset.meta = meta;
}
