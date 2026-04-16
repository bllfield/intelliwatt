/**
 * Public barrel for shared fingerprint builders (Phase 2b). Single implementations only.
 */

export {
  ensureSimulatorFingerprintsForRecalc,
  prebuildSimulatorFingerprints,
  type EnsureSimulatorFingerprintsArgs,
} from "@/modules/onePathSim/usageSimulator/fingerprintOrchestration";
export {
  buildAndPersistWholeHomeFingerprint,
  prepareWholeHomeFingerprintBuild,
  computeWholeHomeSourceHashFromInputs,
  pickWholeHomeFingerprintInputs,
  WHOLE_HOME_FINGERPRINT_ALGORITHM_VERSION,
} from "@/modules/onePathSim/usageSimulator/wholeHomeFingerprintBuilder";
export {
  buildAndPersistUsageFingerprint,
  prepareUsageFingerprintBuild,
  computeUsageFingerprintSourceHash,
  USAGE_FINGERPRINT_ALGORITHM_VERSION,
} from "@/modules/onePathSim/usageSimulator/usageFingerprintBuilder";
export {
  evaluateWholeHomeFingerprintPolicy,
  evaluateUsageFingerprintPolicy,
} from "@/modules/onePathSim/usageSimulator/fingerprintArtifactPolicy";
export { fingerprintIsStaleForExpectedSourceHash } from "@/modules/onePathSim/usageSimulator/fingerprintFreshness";
export {
  resolveSimFingerprint,
  RESOLVED_SIM_FINGERPRINT_VERSION,
} from "@/modules/onePathSim/usageSimulator/resolveSimFingerprint";
export { buildCohortPriorV1, COHORT_PRIOR_VERSION } from "@/modules/onePathSim/usageSimulator/cohortPriorBuilder";
export { inferManualTotalsConstraintKind } from "@/modules/onePathSim/usageSimulator/manualUsageConstraint";
export { computeWholeHomeSourceHashWithCohort } from "@/modules/onePathSim/usageSimulator/wholeHomeFingerprintInputs";
export type {
  ResolvedSimFingerprint,
  ResolvedSimFingerprintBlendMode,
  ResolvedSimFingerprintUnderlyingMix,
} from "@/modules/onePathSim/usageSimulator/resolvedSimFingerprintTypes";

