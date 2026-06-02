export type PastModeledDaySelectionStrategy = "calendar_first" | "weather_donor_first";

/**
 * Past simulated day totals: interval-backed runs (SMT or Green Button) use weather-similar
 * donors from the reference pool. calendar_first anchors to usage-shape month averages and
 * produces flat ~month-avg kWh on hot validation days when the shape profile is below actuals.
 */
export function resolvePastSimulatedModeledDaySelectionStrategy(args: {
  buildMode: string;
  intervalActualSource?: "SMT" | "GREEN_BUTTON" | null;
}): PastModeledDaySelectionStrategy {
  if (args.buildMode === "MANUAL_TOTALS") return "calendar_first";
  if (args.intervalActualSource === "SMT" || args.intervalActualSource === "GREEN_BUTTON") {
    return "weather_donor_first";
  }
  if (args.buildMode === "SMT_BASELINE") return "weather_donor_first";
  return "calendar_first";
}
