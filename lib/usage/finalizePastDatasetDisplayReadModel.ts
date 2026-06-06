import { sageActualDailyKwhByDate } from "@/lib/usage/sageActualDailyTruth";
import { applyPastSimValidationBaselineProjectionToDataset } from "@/lib/usage/pastSimValidationBaselineProjection";
import { applyPastSimDisplayTruthToDataset } from "@/lib/usage/pastSimStaleIncompleteMeter";
import { syncPastSimDisplayInsightsFromCanonicalIntervals } from "@/lib/usage/pastSimCanonicalDisplayInsights";
import { attachPastSimDisplayWeatherToDataset } from "@/lib/usage/pastSimDisplayWeather";
import { reconcilePastDatasetDisplayTotals } from "@/lib/usage/reconcilePastDatasetDisplayTotals";
import {
  computePastDisplayTruthRevision,
  persistPastDisplayWeatherToArtifactCache,
  shouldRecomputePastDisplayWeather,
  stampPastDisplayWeatherFinalizeMeta,
  type PastDisplayWeatherFinalizeOutcome,
} from "@/lib/usage/pastDisplayWeatherFinalizeGuard";
import {
  resolvePreferredActualSourceFromDataset,
  resolvePastWeatherHouseIdFromDataset,
} from "@/lib/usage/pastVisibleWeatherReadDiagnostics";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export async function finalizePastDatasetDisplayReadModel(args: {
  dataset: Record<string, unknown> | null | undefined;
  sageActualDataset?: Record<string, unknown> | null;
  smtSlotCompleteDateKeys?: ReadonlySet<string>;
  greenButtonTrustedHomeDateKeys?: ReadonlySet<string>;
  homeProfile?: unknown;
  applianceProfile?: unknown;
  weatherHouseId?: string | null;
  /** @deprecated Weather is always synced from finalized display daily rows for Past parity. */
  skipWeatherRecompute?: boolean;
  fallbackHouseId?: string | null;
  scenarioId?: string | null;
  persistDisplayWeatherToCache?: boolean;
}): Promise<PastDisplayWeatherFinalizeOutcome | null> {
  const dataset = args.dataset;
  if (!dataset || typeof dataset !== "object") return null;

  const meta = asRecord(dataset.meta);
  if (meta.datasetKind !== "SIMULATED" || meta.baselinePassthrough === true) return null;

  applyPastSimValidationBaselineProjectionToDataset({
    dataset,
    sageActualDataset: args.sageActualDataset,
  });
  applyPastSimDisplayTruthToDataset(dataset, {
    sageByDate: sageActualDailyKwhByDate(args.sageActualDataset),
    smtSlotCompleteDateKeys: args.smtSlotCompleteDateKeys,
    greenButtonTrustedHomeDateKeys: args.greenButtonTrustedHomeDateKeys,
  });
  reconcilePastDatasetDisplayTotals(dataset);
  syncPastSimDisplayInsightsFromCanonicalIntervals(dataset);
  reconcilePastDatasetDisplayTotals(dataset);

  const weatherHouseId =
    String(args.weatherHouseId ?? "").trim() ||
    resolvePastWeatherHouseIdFromDataset({
      dataset,
      fallbackHouseId: String(args.fallbackHouseId ?? "").trim() || "house",
    });
  const preferredActualSource = resolvePreferredActualSourceFromDataset(dataset);
  const displayTruthRevision = computePastDisplayTruthRevision({ dataset, weatherHouseId });
  const forceRecompute =
    args.skipWeatherRecompute === true
      ? false
      : shouldRecomputePastDisplayWeather({ dataset, displayTruthRevision });

  if (args.homeProfile != null || weatherHouseId) {
    await attachPastSimDisplayWeatherToDataset({
      dataset,
      homeProfile: args.homeProfile,
      applianceProfile: args.applianceProfile,
      weatherHouseId,
      preferredActualSource,
      forceRecompute,
    });
  }
  const weatherRecomputed = Number(asRecord(dataset.meta).displayWeatherRecomputeCount) > 0;

  stampPastDisplayWeatherFinalizeMeta({
    dataset,
    displayTruthRevision,
    weatherRecomputed,
  });

  let cachePersisted = asRecord(dataset.meta).pastDisplayWeatherCachePersisted === true;
  let cachePersistReason: string | null = cachePersisted ? null : "not_attempted";
  const shouldPersist =
    args.persistDisplayWeatherToCache !== false &&
    (weatherRecomputed || !cachePersisted) &&
    String(args.scenarioId ?? "").trim().length > 0;
  if (shouldPersist) {
    const houseIdForCache =
      String(args.fallbackHouseId ?? "").trim() ||
      String(meta.artifactHouseId ?? meta.houseId ?? "").trim();
    const persistResult = await persistPastDisplayWeatherToArtifactCache({
      dataset,
      houseId: houseIdForCache,
      scenarioId: String(args.scenarioId).trim(),
    });
    cachePersisted = persistResult.ok;
    cachePersistReason = persistResult.reason;
  }

  return {
    displayTruthRevision,
    weatherRecomputed,
    weatherReadPath: weatherRecomputed ? "past_display_finalize_recompute" : "past_display_artifact_warm",
    cachePersisted,
    cachePersistReason,
  };
}
