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
  computeWholeHomeSourceHashFromInputs,
  pickWholeHomeFingerprintInputs,
  WHOLE_HOME_FINGERPRINT_ALGORITHM_VERSION,
} from "@/modules/usageSimulator/wholeHomeFingerprintBuilder";
export {
  buildAndPersistUsageFingerprint,
  computeUsageFingerprintSourceHash,
  USAGE_FINGERPRINT_ALGORITHM_VERSION,
} from "@/modules/usageSimulator/usageFingerprintBuilder";
export { fingerprintIsStaleForExpectedSourceHash } from "@/modules/usageSimulator/fingerprintFreshness";
export {
  resolveSimFingerprint,
  RESOLVED_SIM_FINGERPRINT_VERSION,
} from "@/modules/usageSimulator/resolveSimFingerprint";
export type {
  ResolvedSimFingerprint,
  ResolvedSimFingerprintBlendMode,
} from "@/modules/usageSimulator/resolvedSimFingerprintTypes";
