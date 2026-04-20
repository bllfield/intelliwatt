import { validateApplianceProfile, type ApplianceProfilePayloadV1 } from "@/modules/applianceProfile/validation";
import { validateHomeProfile, type HomeProfileInput } from "@/modules/homeProfile/validation";
import { validateManualUsagePayload } from "@/modules/onePathSim/manualValidation";
import type { ManualUsagePayload } from "@/modules/onePathSim/simulatedUsage/types";

export type SimulatorMode = "MANUAL_TOTALS" | "NEW_BUILD_ESTIMATE" | "SMT_BASELINE";

export type SimulatorInputs = {
  manualUsagePayload: ManualUsagePayload | null;
  homeProfile: HomeProfileInput | null;
  applianceProfile: ApplianceProfilePayloadV1 | null;
  hasActualIntervals: boolean;
};

export function computeRequirements(inputs: SimulatorInputs, mode: SimulatorMode): { canRecalc: boolean; missingItems: string[] } {
  const missingItems: string[] = [];

  const homeOk = inputs.homeProfile
    ? validateHomeProfile(inputs.homeProfile, { requirePastBaselineFields: mode === "SMT_BASELINE" }).ok
    : false;
  if (!homeOk) missingItems.push("Complete Home Details (required fields).");

  const appliancesOk = inputs.applianceProfile ? validateApplianceProfile(inputs.applianceProfile).ok : false;
  if (mode !== "SMT_BASELINE" && !appliancesOk) {
    missingItems.push("Complete Appliances (select fuel configuration, add appliance types as needed).");
  }

  if (mode === "SMT_BASELINE") {
    if (!inputs.hasActualIntervals) {
      missingItems.push("Connect Smart Meter Texas or upload Green Button usage (15‑minute intervals required).");
    }
    return { canRecalc: missingItems.length === 0, missingItems };
  }

  if (mode === "NEW_BUILD_ESTIMATE") {
    return { canRecalc: missingItems.length === 0, missingItems };
  }

  // MANUAL_TOTALS
  const manualOk = inputs.manualUsagePayload ? validateManualUsagePayload(inputs.manualUsagePayload).ok : false;
  if (!manualOk) missingItems.unshift("Provide a usable manual Stage 1 payload before running MANUAL_TOTALS.");

  return { canRecalc: missingItems.length === 0, missingItems };
}


