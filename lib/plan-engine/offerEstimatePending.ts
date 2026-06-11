/**
 * Shared Plans UI semantics: which offers still have a realistic path to OK/APPROXIMATE estimates.
 * Terminal failures (no EFL URL, NOT_COMPUTABLE, etc.) must not inflate progress pending counts.
 */

export type OfferEstimateUiState = "AVAILABLE" | "NEED_USAGE" | "CALCULATING" | "UNAVAILABLE";

function strUpper(v: unknown): string {
  return String(v ?? "").trim().toUpperCase();
}

export function offerHasEflUrl(offer: any): boolean {
  const url = String(offer?.efl?.eflUrl ?? "").trim();
  return url.length > 0;
}

export function isTransientPlanEstimateEngineState(args: {
  tceStatus: string;
  tceReason: string;
}): boolean {
  const { tceStatus, tceReason } = args;
  if (!tceStatus) return true;
  if (tceStatus === "QUEUED" || tceStatus === "MISSING_TEMPLATE") return true;
  if (tceStatus === "NOT_IMPLEMENTED") {
    return (
      tceReason === "CACHE_MISS" ||
      tceReason === "PIPELINE_IN_PROGRESS" ||
      tceReason.includes("MISSING TEMPLATE") ||
      tceReason.includes("MISSING BUCKET")
    );
  }
  return false;
}

/** True only when the background pipeline/prefetch can still plausibly materialize an estimate. */
export function isOfferEstimateActivelyPending(offer: any): boolean {
  const tceStatus = strUpper(offer?.intelliwatt?.trueCostEstimate?.status);
  const tceReason = strUpper(
    offer?.intelliwatt?.trueCostEstimate?.reason ?? offer?.intelliwatt?.statusReason,
  );
  const statusLabel = strUpper(offer?.intelliwatt?.statusLabel);

  if (tceStatus === "OK" || tceStatus === "APPROXIMATE") return false;
  if (tceStatus === "NOT_COMPUTABLE") return false;
  if (tceStatus === "MISSING_USAGE") return false;
  if (tceStatus === "NOT_IMPLEMENTED" && tceReason === "MISSING_USAGE_TOTALS") return false;
  if (tceStatus === "NOT_IMPLEMENTED" && tceReason === "TEMPLATE_LOOKUP_ERROR") return false;

  // Unmapped / failed templates are queued for admin review — not user-facing "calculating".
  if (tceStatus === "MISSING_TEMPLATE" || (tceStatus === "NOT_IMPLEMENTED" && tceReason.includes("MISSING TEMPLATE"))) {
    return false;
  }

  if (statusLabel !== "QUEUED") return false;
  return isTransientPlanEstimateEngineState({ tceStatus, tceReason });
}

export function countActivelyPendingOffers(offers: unknown[]): number {
  return offers.filter((o) => isOfferEstimateActivelyPending(o)).length;
}

export function classifyOfferEstimateUiState(offer: any): OfferEstimateUiState {
  const tceStatus = strUpper(offer?.intelliwatt?.trueCostEstimate?.status);
  const tceReason = strUpper(
    offer?.intelliwatt?.trueCostEstimate?.reason ?? offer?.intelliwatt?.statusReason,
  );

  if (tceStatus === "OK" || tceStatus === "APPROXIMATE") return "AVAILABLE";
  if (tceStatus === "MISSING_USAGE") return "NEED_USAGE";
  if (tceStatus === "NOT_IMPLEMENTED" && tceReason === "MISSING_BUCKETS") return "NEED_USAGE";
  if (isOfferEstimateActivelyPending(offer)) return "CALCULATING";
  return "UNAVAILABLE";
}
