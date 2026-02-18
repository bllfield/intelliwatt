import { validateApplianceProfile, type ApplianceProfilePayloadV1 } from "@/modules/applianceProfile/validation";
import { validateHomeProfile, type HomeProfileInput } from "@/modules/homeProfile/validation";
import { validateManualUsagePayload } from "@/modules/manualUsage/validation";
import type { ManualUsagePayload } from "@/modules/simulatedUsage/types";

export type SimulatorMode = "MANUAL_TOTALS" | "NEW_BUILD_ESTIMATE" | "SMT_BASELINE";

export type SimulatorInputs = {
  manualUsagePayload: ManualUsagePayload | null;
  homeProfile: HomeProfileInput | null;
  applianceProfile: ApplianceProfilePayloadV1 | null;
  hasSmtIntervals: boolean;
};

export function computeRequirements(inputs: SimulatorInputs, mode: SimulatorMode): { canRecalc: boolean; missingItems: string[] } {
  const missingItems: string[] = [];

  const homeOk = inputs.homeProfile ? validateHomeProfile(inputs.homeProfile).ok : false;
  if (!homeOk) missingItems.push("Complete Home Details (required fields).");

  const appliancesOk = inputs.applianceProfile ? validateApplianceProfile(inputs.applianceProfile).ok : false;
  if (!appliancesOk) missingItems.push("Complete Appliances (select fuel configuration, add appliance types as needed).");

  if (mode === "SMT_BASELINE") {
    if (!inputs.hasSmtIntervals) missingItems.push("Connect Smart Meter Texas (15‑minute intervals required).");
    return { canRecalc: missingItems.length === 0, missingItems };
  }

  if (mode === "NEW_BUILD_ESTIMATE") {
    return { canRecalc: missingItems.length === 0, missingItems };
  }

  // MANUAL_TOTALS
  const manualOk = inputs.manualUsagePayload ? validateManualUsagePayload(inputs.manualUsagePayload).ok : false;
  if (!manualOk) missingItems.unshift("Save manual usage totals (monthly or annual).");

  return { canRecalc: missingItems.length === 0, missingItems };
}

