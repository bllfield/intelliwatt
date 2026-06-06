import { sageActualDailyKwhByDate } from "@/lib/usage/sageActualDailyTruth";
import { applyPastSimValidationBaselineProjectionToDataset } from "@/lib/usage/pastSimValidationBaselineProjection";
import { applyPastSimDisplayTruthToDataset } from "@/lib/usage/pastSimStaleIncompleteMeter";
import { syncPastSimDisplayInsightsFromCanonicalIntervals } from "@/lib/usage/pastSimCanonicalDisplayInsights";
import { attachPastSimDisplayWeatherToDataset } from "@/lib/usage/pastSimDisplayWeather";
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
  const pastDisplayWeather = asRecord(refreshedMeta.pastDisplayWeatherSensitivityScore);
  if (
    Object.keys(pastDisplayWeather).length === 0 &&
    (args.homeProfile != null || args.weatherHouseId != null)
  ) {
    await attachPastSimDisplayWeatherToDataset({
      dataset,
      homeProfile: args.homeProfile,
      applianceProfile: args.applianceProfile,
      weatherHouseId: args.weatherHouseId,
    });
  }
}
