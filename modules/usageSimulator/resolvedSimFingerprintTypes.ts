/**
 * Phase 2c: shared contract for `resolveSimFingerprint` output (UNIFIED_SIM_FINGERPRINT_PLAN §17).
 */

export type ResolvedSimFingerprintBlendMode = "usage_only" | "whole_home_only" | "blended" | "insufficient_inputs";

export type ResolvedSimFingerprint = {
  resolverVersion: string;
  /** Stable hash of blend inputs + artifact ids for this resolution. */
  resolvedHash: string;
  blendMode: ResolvedSimFingerprintBlendMode;
  /** House id used for WholeHomeFingerprint row lookup. */
  wholeHomeHouseId: string;
  /** House id used for UsageFingerprint row lookup (often actual-context house). */
  usageFingerprintHouseId: string;
  wholeHomeFingerprintArtifactId: string | null;
  usageFingerprintArtifactId: string | null;
  wholeHomeStatus: string | null;
  usageStatus: string | null;
  wholeHomeSourceHash: string | null;
  usageSourceHash: string | null;
  /** Weight on usage-derived components when blendMode is blended (placeholder for cohort work). */
  usageBlendWeight: number;
};
