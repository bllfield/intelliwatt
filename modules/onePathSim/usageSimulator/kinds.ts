export enum IntervalSeriesKind {
  ACTUAL_USAGE_INTERVALS = "ACTUAL_USAGE_INTERVALS",
  // BASELINE_INTERVALS is an alias/view, do not persist as IntervalSeries rows.
  BASELINE_INTERVALS = "BASELINE_INTERVALS",
  PAST_SIM_BASELINE = "PAST_SIM_BASELINE",
  FUTURE_SIM_BASELINE = "FUTURE_SIM_BASELINE",
  FUTURE_SIM_USAGE = "FUTURE_SIM_USAGE",
}

export function isIntervalSeriesKind(value: unknown): value is IntervalSeriesKind {
  return typeof value === "string" && Object.values(IntervalSeriesKind).includes(value as IntervalSeriesKind);
}


