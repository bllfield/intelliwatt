import { sageActualDailyKwhByDate } from "@/lib/usage/sageActualDailyTruth";
import { applyPastSimValidationBaselineProjectionToDataset } from "@/lib/usage/pastSimValidationBaselineProjection";
import { applyPastSimDisplayTruthToDataset } from "@/lib/usage/pastSimStaleIncompleteMeter";
import { syncPastSimDisplayInsightsFromCanonicalIntervals } from "@/lib/usage/pastSimCanonicalDisplayInsights";
import {
  attachPastSimDisplayWeatherToDataset,
  hasPersistedPastDisplayWeatherScore,
} from "@/lib/usage/pastSimDisplayWeather";
import { reconcilePastDatasetDisplayTotals } from "@/lib/usage/reconcilePastDatasetDisplayTotals";

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
  /** When true, never recompute past display weather (warm artifact read). */
  skipWeatherRecompute?: boolean;
}): Promise<void> {
  const dataset = args.dataset;
  if (!dataset || typeof dataset !== "object") return;

  const meta = asRecord(dataset.meta);
  if (meta.datasetKind !== "SIMULATED" || meta.baselinePassthrough === true) return;

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

  const refreshedMeta = asRecord(dataset.meta);
  if (hasPersistedPastDisplayWeatherScore(dataset)) {
    refreshedMeta.displayWeatherCardsSourceOwner =
      String(asRecord(refreshedMeta.pastDisplayWeatherSensitivityScore).sourceOwner ?? "").trim() ||
      "past_artifact_build";
    refreshedMeta.displayWeatherRecomputeCount = 0;
    refreshedMeta.weatherWindowComplete = refreshedMeta.weatherWindowComplete ?? true;
    dataset.meta = refreshedMeta;
    return;
  }

  if (args.skipWeatherRecompute) return;

  const pastDisplayWeather = asRecord(refreshedMeta.pastDisplayWeatherSensitivityScore);
  if (
    Object.keys(pastDisplayWeather).length === 0 &&
    (args.homeProfile != null || args.weatherHouseId != null)
  ) {
    refreshedMeta.displayWeatherCardsSourceOwner = "fallback_recompute";
    refreshedMeta.displayWeatherRecomputeCount = 1;
    dataset.meta = refreshedMeta;
    const preferredActualSource = String(
      refreshedMeta.preferredActualSource ??
        asRecord(refreshedMeta.lockboxRunContext).preferredActualSource ??
        asRecord(dataset.summary).source ??
        ""
    ).trim() || null;
    await attachPastSimDisplayWeatherToDataset({
      dataset,
      homeProfile: args.homeProfile,
      applianceProfile: args.applianceProfile,
      weatherHouseId: args.weatherHouseId,
      preferredActualSource,
      forceRecompute: true,
    });
  }
}
