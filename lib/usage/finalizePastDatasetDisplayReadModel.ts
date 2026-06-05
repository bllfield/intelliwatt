import { sageActualDailyKwhByDate } from "@/lib/usage/sageActualDailyTruth";
import { applyPastSimDisplayTruthToDataset } from "@/lib/usage/pastSimStaleIncompleteMeter";
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

  applyPastSimDisplayTruthToDataset(dataset, {
    sageByDate: sageActualDailyKwhByDate(args.sageActualDataset),
    smtSlotCompleteDateKeys: args.smtSlotCompleteDateKeys,
    greenButtonTrustedHomeDateKeys: args.greenButtonTrustedHomeDateKeys,
  });
  reconcilePastDatasetDisplayTotals(dataset);
  await attachPastSimDisplayWeatherToDataset({
    dataset,
    homeProfile: args.homeProfile,
    applianceProfile: args.applianceProfile,
    weatherHouseId: args.weatherHouseId,
  });
}
