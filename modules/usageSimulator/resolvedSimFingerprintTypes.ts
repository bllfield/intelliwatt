/**
 * Shared contract for `resolveSimFingerprint` output (UNIFIED_SIM_FINGERPRINT_PLAN §17).
 */

export type ResolvedSimFingerprintBlendMode =
  | "usage_only"
  | "whole_home_only"
  | "blended"
  | "insufficient_inputs"
  | "constrained_monthly_totals"
  | "constrained_annual_total";

/** How usage vs whole-home sources combine under the hood (for constrained modes, still meaningful). */
export type ResolvedSimFingerprintUnderlyingMix =
  | "usage_only"
  | "whole_home_only"
  | "blended"
  | "insufficient_inputs";

export type ResolvedSimFingerprint = {
  resolverVersion: string;
  /** Stable hash of blend inputs + artifact ids + resolution mode for this resolution. */
  resolvedHash: string;
  blendMode: ResolvedSimFingerprintBlendMode;
  /**
   * When `blendMode` is `constrained_*`, identifies usage vs whole-home readiness mix.
   * For `NEW_BUILD_ESTIMATE` success path, `whole_home_only`.
   */
  underlyingSourceMix: ResolvedSimFingerprintUnderlyingMix;
  /** Manual mode only: which hard constraint applies (from manual usage payload). */
  manualTotalsConstraint: "none" | "monthly" | "annual";
  /** Operator/debug notes (e.g. unspecified manual constraint). */
  resolutionNotes: string[];
  wholeHomeHouseId: string;
  usageFingerprintHouseId: string;
  wholeHomeFingerprintArtifactId: string | null;
  usageFingerprintArtifactId: string | null;
  wholeHomeStatus: string | null;
  usageStatus: string | null;
  wholeHomeSourceHash: string | null;
  usageSourceHash: string | null;
  /** Weight on usage-derived components when underlying mix is blended (0–1). */
  usageBlendWeight: number;
};
