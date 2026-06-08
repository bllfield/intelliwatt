/** Audit-readable baseline label — mode/baseKind stay generic; this names the interval source. */
export function resolveIntervalBaselineAuditLabel(args: {
  actualSource?: string | null;
  lockboxMode?: string | null;
  baseKind?: string | null;
  simulatorMode?: string | null;
}): string {
  const source = String(args.actualSource ?? "").trim().toUpperCase();
  if (source === "GREEN_BUTTON") return "GREEN_BUTTON_BASELINE";
  if (source === "SMT") return "SMT_BASELINE";
  const lockbox = String(args.lockboxMode ?? "").trim();
  if (lockbox === "ACTUAL_INTERVAL_BASELINE") return "ACTUAL_INTERVAL_BASELINE";
  const baseKind = String(args.baseKind ?? "").trim();
  if (baseKind === "SMT_ACTUAL_BASELINE") return "ACTUAL_INTERVAL_BASELINE";
  const mode = String(args.simulatorMode ?? "").trim();
  if (mode === "SMT_BASELINE") return "ACTUAL_INTERVAL_BASELINE";
  return baseKind || lockbox || mode || "unknown";
}
