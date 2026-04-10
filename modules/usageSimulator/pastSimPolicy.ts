import type { AdminLabTreatmentMode } from "@/modules/usageSimulator/adminLabTreatment";
import type { SimulatorMode } from "@/modules/usageSimulator/requirements";
import type { ValidationDaySelectionMode } from "@/modules/usageSimulator/validationSelection";

export type ValidationPolicyOwner = "userValidationPolicy" | "adminValidationPolicy";

export type TestHomeUsageInputMode =
  | "EXACT_INTERVALS"
  | "MANUAL_MONTHLY"
  | "MONTHLY_FROM_SOURCE_INTERVALS"
  | "ANNUAL_FROM_SOURCE_INTERVALS"
  | "PROFILE_ONLY_NEW_BUILD";

export type ResolvedValidationPolicy = {
  owner: ValidationPolicyOwner;
  selectionMode: ValidationDaySelectionMode;
  validationDayCount: number;
};

export function resolveUserValidationPolicy(args: {
  defaultSelectionMode: ValidationDaySelectionMode;
  validationDayCount?: number | null;
}): ResolvedValidationPolicy {
  return {
    owner: "userValidationPolicy",
    selectionMode: args.defaultSelectionMode,
    validationDayCount: normalizeValidationDayCount(args.validationDayCount),
  };
}

export function resolveAdminValidationPolicy(args: {
  selectionMode: ValidationDaySelectionMode;
  validationDayCount?: number | null;
}): ResolvedValidationPolicy {
  return {
    owner: "adminValidationPolicy",
    selectionMode: args.selectionMode,
    validationDayCount: normalizeValidationDayCount(args.validationDayCount),
  };
}

export function resolveTestHomeUsageInputMode(raw: unknown): TestHomeUsageInputMode {
  const value = String(raw ?? "").trim();
  switch (value) {
    case "MANUAL_MONTHLY":
      return "MANUAL_MONTHLY";
    case "MONTHLY_FROM_SOURCE_INTERVALS":
    case "manual_monthly_constrained":
      return "MONTHLY_FROM_SOURCE_INTERVALS";
    case "ANNUAL_FROM_SOURCE_INTERVALS":
    case "manual_annual_constrained":
      return "ANNUAL_FROM_SOURCE_INTERVALS";
    case "PROFILE_ONLY_NEW_BUILD":
    case "whole_home_prior_only":
      return "PROFILE_ONLY_NEW_BUILD";
    case "EXACT_INTERVALS":
    case "actual_data_fingerprint":
    default:
      return "EXACT_INTERVALS";
  }
}

export function resolveTestHomeUsageModeRecalcConfig(
  usageInputMode: TestHomeUsageInputMode
): {
  simulatorMode: SimulatorMode;
  adminLabTreatmentMode?: AdminLabTreatmentMode;
} {
  switch (usageInputMode) {
    case "MANUAL_MONTHLY":
      return {
        simulatorMode: "MANUAL_TOTALS",
      };
    case "MONTHLY_FROM_SOURCE_INTERVALS":
      return {
        simulatorMode: "MANUAL_TOTALS",
        adminLabTreatmentMode: "manual_monthly_constrained",
      };
    case "ANNUAL_FROM_SOURCE_INTERVALS":
      return {
        simulatorMode: "MANUAL_TOTALS",
        adminLabTreatmentMode: "manual_annual_constrained",
      };
    case "PROFILE_ONLY_NEW_BUILD":
      return {
        simulatorMode: "NEW_BUILD_ESTIMATE",
      };
    case "EXACT_INTERVALS":
    default:
      return {
        simulatorMode: "SMT_BASELINE",
      };
  }
}

function normalizeValidationDayCount(value: number | null | undefined): number {
  const normalized = Math.floor(Number(value) || 21);
  return Math.max(1, Math.min(365, normalized));
}
