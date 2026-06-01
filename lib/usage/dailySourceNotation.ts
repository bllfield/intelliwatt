/** True when a daily row carries simulator-owned kWh usable for validation compare / canonical totals. */
export function isSimulatedDailySourceForCompare(args: {
  source?: unknown;
  sourceDetail?: unknown;
}): boolean {
  const source = String(args.source ?? "").trim().toUpperCase();
  if (source.startsWith("SIMULATED")) return true;
  const detail = String(args.sourceDetail ?? "").trim().toUpperCase();
  return detail.startsWith("SIMULATED");
}
