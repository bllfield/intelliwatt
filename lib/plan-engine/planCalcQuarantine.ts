/**
 * Plan-calc "quarantine" is intended ONLY for true template defects:
 * - Unsupported / invalid shapes
 * - Non-deterministic pricing that cannot be computed deterministically
 * - Suspicious evidence mismatches (e.g. TOU evidence found but treated as fixed)
 *
 * It must NOT be used for "availability gates" or "dashboard gating":
 * - Plans that require usage buckets (tiered, credits, minimum rules, TOU) are supported
 *   by non-dashboard calculators when buckets exist, but remain plan-level NOT_COMPUTABLE
 *   to preserve dashboard semantics.
 */
export function isPlanCalcQuarantineWorthyReasonCode(reasonCode: string | null | undefined): boolean {
  const rc = String(reasonCode ?? "").trim();
  if (!rc) return false;

  // Common non-defect / housekeeping statuses.
  if (rc === "FIXED_RATE_OK" || rc === "MISSING_TEMPLATE" || rc === "UNKNOWN") return false;

  // Dashboard-safe gating reasons (supported in non-dashboard flows when usage buckets exist).
  // Keep this list explicit and conservative to avoid review-noise and accidental template quarantine.
  const bucketGating = new Set<string>([
    "BILL_CREDITS_REQUIRES_USAGE_BUCKETS",
    "MINIMUM_RULES_REQUIRES_USAGE_BUCKETS",
    "TIERED_REQUIRES_USAGE_BUCKETS",
    "TIERED_PLUS_CREDITS_REQUIRES_USAGE_BUCKETS",
    "TOU_REQUIRES_USAGE_BUCKETS_PHASE2",
    "TOU_PLUS_CREDITS_REQUIRES_USAGE_BUCKETS",
    // Some callers may still use earlier/non-canonical names; treat them as gating.
    "TOU_REQUIRES_USAGE_BUCKETS",
  ]);
  if (bucketGating.has(rc)) return false;

  // Indexed/variable pricing is intentionally fail-closed by default but can be estimated in APPROX mode.
  if (rc === "NON_DETERMINISTIC_PRICING_INDEXED") return false;

  // True-defect buckets: unsupported shapes, non-deterministic (other than indexed default),
  // suspicious evidence, and hard unsupported structures.
  if (rc === "UNSUPPORTED_RATE_STRUCTURE") return true;
  if (rc.startsWith("UNSUPPORTED_")) return true;
  if (rc.startsWith("SUSPECT_")) return true;
  if (rc.startsWith("NON_DETERMINISTIC_")) return true;

  // Default: do not quarantine unknown reason codes (avoid destructive/noisy behavior).
  return false;
}

