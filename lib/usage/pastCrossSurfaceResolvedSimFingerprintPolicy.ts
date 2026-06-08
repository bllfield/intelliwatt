/**
 * Cross-surface dual-run rule for house-local `resolvedSimFingerprint`.
 * Canonical display/weather truth must still match — see acceptanceComparedInstead.
 */
export const PAST_CROSS_SURFACE_RESOLVED_SIM_FINGERPRINT_RULE =
  "resolvedSimFingerprint may differ between source and lab artifacts because it is house-local. Cross-surface acceptance does not waive parity. It compares canonical display/weather truth instead: finalizedDailyRowsHash, displayTruthRevision, Bundle C, TOD/monthly read-model parity, weather hash, profile identity, usage shape identity, validation/travel-vacant fingerprints, scorer/calculation versions, and source interval/trusted-date fingerprints." as const;

/** Fields enforced when crossSurfaceWeatherInputsOnly — fail closed if any differ. */
export const PAST_CROSS_SURFACE_ACCEPTANCE_COMPARED_INSTEAD = [
  "finalizedDailyRowsHash",
  "displayTruthRevision",
  "pastDisplayWeatherSensitivityScore",
  "timeOfDayBuckets",
  "monthlyRows",
  "usageShapeProfileIdentity",
  "intervalDataFingerprint",
  "trustedDateKeys",
] as const;

export const RESOLVED_SIM_FINGERPRINT_HOUSE_LOCAL_REASON = "house_local_artifact_identity" as const;

export type ResolvedSimFingerprintCrossSurfaceAudit = {
  user: string | null;
  admin: string | null;
  matches: boolean;
  parityRequired: false;
  reason: typeof RESOLVED_SIM_FINGERPRINT_HOUSE_LOCAL_REASON;
  acceptanceComparedInstead: readonly string[];
  rule: typeof PAST_CROSS_SURFACE_RESOLVED_SIM_FINGERPRINT_RULE;
};

export function buildResolvedSimFingerprintCrossSurfaceAudit(args: {
  user: string | null;
  admin: string | null;
}): ResolvedSimFingerprintCrossSurfaceAudit {
  const user = args.user ?? null;
  const admin = args.admin ?? null;
  return {
    user,
    admin,
    matches: user != null && admin != null && user === admin,
    parityRequired: false,
    reason: RESOLVED_SIM_FINGERPRINT_HOUSE_LOCAL_REASON,
    acceptanceComparedInstead: PAST_CROSS_SURFACE_ACCEPTANCE_COMPARED_INSTEAD,
    rule: PAST_CROSS_SURFACE_RESOLVED_SIM_FINGERPRINT_RULE,
  };
}
