function hasNonEmptyInsightArray(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
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
  const fifteenMinuteAverages = hasNonEmptyInsightArray(passthroughInsights.fifteenMinuteAverages)
    ? passthroughInsights.fifteenMinuteAverages
    : resolvedInsights.fifteenMinuteAverages;
  const timeOfDayBuckets = hasNonEmptyInsightArray(passthroughInsights.timeOfDayBuckets)
    ? passthroughInsights.timeOfDayBuckets
    : resolvedInsights.timeOfDayBuckets;
  const peakHour =
    passthroughInsights.peakHour != null ? passthroughInsights.peakHour : resolvedInsights.peakHour ?? null;
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
