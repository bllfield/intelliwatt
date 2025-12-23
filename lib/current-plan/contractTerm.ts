const DAY_MS = 24 * 60 * 60 * 1000;

function clampInt(n: number, min: number, max: number): number {
  const x = Math.trunc(n);
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, x));
}

/**
 * Best-effort months remaining until contract end.
 *
 * This is intentionally simple and stable (no timezone tricks):
 * - Uses a 30-day month approximation (ceil(daysRemaining / 30))
 * - Clamps to [0, 120]
 *
 * This is used to support "reducing termination fee" logic (fee per month remaining),
 * and for general UX display. If you need exact provider-specific semantics later,
 * add a dedicated rule type (do NOT change this function's meaning silently).
 */
export function computeMonthsRemainingOnContract(args: {
  contractEndDate: Date | string | null | undefined;
  asOf: Date;
}): number | null {
  try {
    const asOf = args.asOf instanceof Date ? args.asOf : new Date(args.asOf);
    const end =
      args.contractEndDate instanceof Date
        ? args.contractEndDate
        : typeof args.contractEndDate === "string"
          ? new Date(args.contractEndDate)
          : null;

    if (!asOf || Number.isNaN(asOf.getTime())) return null;
    if (!end || Number.isNaN(end.getTime())) return null;

    const ms = end.getTime() - asOf.getTime();
    if (ms <= 0) return 0;
    const days = ms / DAY_MS;
    const months = Math.ceil(days / 30);
    return clampInt(months, 0, 120);
  } catch {
    return null;
  }
}


