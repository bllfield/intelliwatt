import { derivePeakHourFromFifteenMinuteCurve } from "@/lib/usage/fifteenMinuteLoadCurve";

function hasNonEmptyInsightArray(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

export function isGreenButtonUsageDataset(dataset: unknown): boolean {
  if (dataset == null || typeof dataset !== "object") return false;
  const record = dataset as Record<string, unknown>;
  const summarySource = String((record.summary as Record<string, unknown> | undefined)?.source ?? "")
    .trim()
    .toUpperCase();
  const metaSource = String((record.meta as Record<string, unknown> | undefined)?.actualSource ?? "")
    .trim()
    .toUpperCase();
  return summarySource === "GREEN_BUTTON" || metaSource === "GREEN_BUTTON";
}

type ResolvedUsageLayer<TDataset = unknown> = {
  dataset: TDataset | null;
  alternatives: { smt: unknown; greenButton: unknown };
};

/**
 * User Usage and sim baseline reads already use the full shared actual layer
 * (`getActualUsageDatasetForHouse`), including GB file-anchored coverage and DB insights.
 * Do not run One Path `runSharedSimulation` here — it duplicates work and can hang the page past route limits.
 */
export async function prepareUserSiteGreenButtonDisplayUsage<T extends ResolvedUsageLayer>(
  resolvedUsage: T,
): Promise<T> {
  return resolvedUsage;
}

/**
 * Green Button baseline passthrough uses lightweight upstream truth (no intervals15 / DB curve).
 * User Usage first resolves the full actual dataset with chart insights; merge them when passthrough omits them.
 */
export function mergeGreenButtonChartInsightsOntoPassthroughDataset(args: {
  passthroughDataset: unknown;
  resolvedDataset: unknown;
}): Record<string, unknown> {
  const passthrough =
    args.passthroughDataset != null && typeof args.passthroughDataset === "object"
      ? (args.passthroughDataset as Record<string, unknown>)
      : {};
  const resolvedInsights =
    args.resolvedDataset != null &&
    typeof args.resolvedDataset === "object" &&
    (args.resolvedDataset as Record<string, unknown>).insights != null &&
    typeof (args.resolvedDataset as Record<string, unknown>).insights === "object"
      ? ((args.resolvedDataset as Record<string, unknown>).insights as Record<string, unknown>)
      : {};
  const passthroughInsights =
    passthrough.insights != null && typeof passthrough.insights === "object"
      ? (passthrough.insights as Record<string, unknown>)
      : {};
  // Full actual-layer insights (SQL + home calendar) win over One Path passthrough stubs.
  const fifteenMinuteAverages = hasNonEmptyInsightArray(resolvedInsights.fifteenMinuteAverages)
    ? resolvedInsights.fifteenMinuteAverages
    : passthroughInsights.fifteenMinuteAverages;
  const timeOfDayBuckets = hasNonEmptyInsightArray(resolvedInsights.timeOfDayBuckets)
    ? resolvedInsights.timeOfDayBuckets
    : passthroughInsights.timeOfDayBuckets;
  const peakHour = hasNonEmptyInsightArray(fifteenMinuteAverages)
    ? derivePeakHourFromFifteenMinuteCurve(
        fifteenMinuteAverages as Array<{ hhmm: string; avgKw: number }>
      ) ??
      (resolvedInsights.peakHour as { hour: number; kw: number } | null | undefined) ??
      null
    : (passthroughInsights.peakHour as { hour: number; kw: number } | null | undefined) ??
      (resolvedInsights.peakHour as { hour: number; kw: number } | null | undefined) ??
      null;
  const baseload =
    typeof passthroughInsights.baseload === "number" && Number.isFinite(passthroughInsights.baseload)
      ? passthroughInsights.baseload
      : resolvedInsights.baseload ?? null;
  return {
    ...passthrough,
    insights: {
      ...passthroughInsights,
      ...(hasNonEmptyInsightArray(fifteenMinuteAverages) ? { fifteenMinuteAverages } : {}),
      ...(hasNonEmptyInsightArray(timeOfDayBuckets) ? { timeOfDayBuckets } : {}),
      ...(peakHour != null ? { peakHour } : {}),
      ...(baseload != null ? { baseload } : {}),
    },
  };
}
