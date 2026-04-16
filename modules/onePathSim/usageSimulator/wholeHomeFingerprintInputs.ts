/**
 * Shared audited feature pick + source hashing for WholeHomeFingerprint (plan §17).
 * Separated so cohort prior and builder share the same inputs without circular imports.
 */

import { sha256HexUtf8, stableStringify } from "@/modules/onePathSim/usageSimulator/fingerprintHash";

export const WHOLE_HOME_FINGERPRINT_ALGORITHM_VERSION = "whole_home_fp_v1";

/** Subset of cohort prior used for source hash (avoids circular imports). */
export type CohortPriorHashMaterial = {
  cohortPriorVersion: string;
  archetypeKey: string;
  featureVectorHash: string;
};

/** Audited home + appliance fields aligned to UNIFIED_SIM_FINGERPRINT_PLAN Section 17 (subset for hashing). */
export function pickWholeHomeFingerprintInputs(args: {
  homeProfile: Record<string, unknown> | null | undefined;
  applianceProfile: Record<string, unknown> | null | undefined;
}): Record<string, unknown> {
  const h = args.homeProfile ?? {};
  const a = args.applianceProfile ?? {};
  return {
    squareFeet: h.squareFeet,
    stories: h.stories,
    insulationType: h.insulationType,
    windowType: h.windowType,
    foundation: h.foundation,
    occupantsWork: h.occupantsWork,
    occupantsSchool: h.occupantsSchool,
    occupantsHomeAllDay: h.occupantsHomeAllDay,
    summerTemp: h.summerTemp,
    winterTemp: h.winterTemp,
    fuelConfiguration: h.fuelConfiguration,
    hvacType: h.hvacType,
    heatingType: h.heatingType,
    hasPool: h.hasPool,
    poolPumpType: h.poolPumpType,
    poolPumpHp: h.poolPumpHp,
    poolSummerRunHoursPerDay: h.poolSummerRunHoursPerDay,
    poolWinterRunHoursPerDay: h.poolWinterRunHoursPerDay,
    hasPoolHeater: h.hasPoolHeater,
    poolHeaterType: h.poolHeaterType,
    evHasVehicle: h.evHasVehicle,
    evCount: h.evCount,
    evChargerType: h.evChargerType,
    evAvgMilesPerDay: h.evAvgMilesPerDay,
    evAvgKwhPerDay: h.evAvgKwhPerDay,
    evChargingBehavior: h.evChargingBehavior,
    evPreferredStartHr: h.evPreferredStartHr,
    evPreferredEndHr: h.evPreferredEndHr,
    evSmartCharger: h.evSmartCharger,
    applianceFuelConfiguration: a.fuelConfiguration,
    appliances: a.appliances,
  };
}

/** Legacy hash over raw features only (tests / backward compat). */
export function computeWholeHomeSourceHashFromInputs(inputs: Record<string, unknown>): string {
  return sha256HexUtf8(
    stableStringify({
      algorithmVersion: WHOLE_HOME_FINGERPRINT_ALGORITHM_VERSION,
      inputs,
    })
  );
}

/** Canonical artifact identity: features + cohort prior archetype (plan §17 provenance). */
export function computeWholeHomeSourceHashWithCohort(args: {
  inputs: Record<string, unknown>;
  cohortPrior: CohortPriorHashMaterial;
}): string {
  return sha256HexUtf8(
    stableStringify({
      algorithmVersion: WHOLE_HOME_FINGERPRINT_ALGORITHM_VERSION,
      inputs: args.inputs,
      cohortPriorVersion: args.cohortPrior.cohortPriorVersion,
      cohortArchetypeKey: args.cohortPrior.archetypeKey,
      cohortFeatureVectorHash: args.cohortPrior.featureVectorHash,
    })
  );
}

