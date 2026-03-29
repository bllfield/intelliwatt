/**
 * Public barrel for shared fingerprint builders (Phase 2b). Single implementations only.
 */

export {
  ensureSimulatorFingerprintsForRecalc,
  prebuildSimulatorFingerprints,
  type EnsureSimulatorFingerprintsArgs,
} from "@/modules/usageSimulator/fingerprintOrchestration";
export {
  buildAndPersistWholeHomeFingerprint,
  prepareWholeHomeFingerprintBuild,
  computeWholeHomeSourceHashFromInputs,
  pickWholeHomeFingerprintInputs,
  WHOLE_HOME_FINGERPRINT_ALGORITHM_VERSION,
} from "@/modules/usageSimulator/wholeHomeFingerprintBuilder";
export {
  buildAndPersistUsageFingerprint,
  prepareUsageFingerprintBuild,
  computeUsageFingerprintSourceHash,
  USAGE_FINGERPRINT_ALGORITHM_VERSION,
} from "@/modules/usageSimulator/usageFingerprintBuilder";
export {
  evaluateWholeHomeFingerprintPolicy,
  evaluateUsageFingerprintPolicy,
} from "@/modules/usageSimulator/fingerprintArtifactPolicy";
export { fingerprintIsStaleForExpectedSourceHash } from "@/modules/usageSimulator/fingerprintFreshness";
export {
  resolveSimFingerprint,
  RESOLVED_SIM_FINGERPRINT_VERSION,
} from "@/modules/usageSimulator/resolveSimFingerprint";
export { buildCohortPriorV1, COHORT_PRIOR_VERSION } from "@/modules/usageSimulator/cohortPriorBuilder";
export { inferManualTotalsConstraintKind } from "@/modules/usageSimulator/manualUsageConstraint";
export { computeWholeHomeSourceHashWithCohort } from "@/modules/usageSimulator/wholeHomeFingerprintInputs";
export type {
  ResolvedSimFingerprint,
  ResolvedSimFingerprintBlendMode,
  ResolvedSimFingerprintUnderlyingMix,
} from "@/modules/usageSimulator/resolvedSimFingerprintTypes";
