import { validateApplianceProfile } from "@/modules/applianceProfile/validation";
import { validateHomeProfile } from "@/modules/homeProfile/validation";
import { buildKnownHouseScenarioPrereqStatus } from "@/modules/onePathSim/knownHouseScenarioPrereqs";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function clampInt(n: unknown, lo: number, hi: number): number {
  const x = typeof n === "number" && Number.isFinite(n) ? Math.trunc(n) : Number(n);
  const y = Number.isFinite(x) ? x : lo;
  return Math.max(lo, Math.min(hi, y));
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

type TraceClassification =
  | "real_bad_brian_data"
  | "unreadable_field_in_past_path_only"
  | "mapping_drift"
  | "validator_overreach"
  | "wrong_owner_path"
  | "scenario_config_issue"
  | "unknown";

export function buildIntervalPastReadinessTrace(args: {
  scenario?: Record<string, unknown> | null;
  lookupSourceContext?: Record<string, unknown> | null;
  baselineParityReport?: { overallMatch?: boolean; firstDivergenceField?: unknown } | null;
  environmentVisibility?: Record<string, unknown> | null;
}) {
  const scenario = asRecord(args.scenario);
  const lookupSourceContext = asRecord(args.lookupSourceContext);
  const baselineParityReport = asRecord(args.baselineParityReport);
  const environmentVisibility = asRecord(args.environmentVisibility);
  const prereqStatus = buildKnownHouseScenarioPrereqStatus({
    scenario,
    lookupSourceContext,
  });

  const homeProfile = asRecord(lookupSourceContext.homeProfile);
  const applianceProfile = asRecord(lookupSourceContext.applianceProfile);
  const homeValidation = validateHomeProfile(lookupSourceContext.homeProfile, { requirePastBaselineFields: true });
  const applianceValidation = validateApplianceProfile(lookupSourceContext.applianceProfile);
  const homeBlocker = prereqStatus.blockingDetails.find((detail) => detail.category === "homeDetails") ?? null;
  const applianceBlocker = prereqStatus.blockingDetails.find((detail) => detail.category === "applianceDetails") ?? null;
  const sourceReadPath = {
    homeDetails: {
      auditOwner: prereqStatus.readSourceComparison.homeDetails.onePathAuditOwner,
      runOwner: prereqStatus.readSourceComparison.homeDetails.onePathRunOwner,
      userSiteOwner: prereqStatus.readSourceComparison.homeDetails.userSiteOwner,
      sameRunOwnerAsUserSite: prereqStatus.readSourceComparison.homeDetails.sameRunOwnerAsUserSite,
      notes: prereqStatus.readSourceComparison.homeDetails.notes,
    },
    applianceDetails: {
      auditOwner: prereqStatus.readSourceComparison.applianceDetails.onePathAuditOwner,
      runOwner: prereqStatus.readSourceComparison.applianceDetails.onePathRunOwner,
      userSiteOwner: prereqStatus.readSourceComparison.applianceDetails.userSiteOwner,
      sameRunOwnerAsUserSite: prereqStatus.readSourceComparison.applianceDetails.sameRunOwnerAsUserSite,
      notes: prereqStatus.readSourceComparison.applianceDetails.notes,
    },
  };

  let classification: TraceClassification = "unknown";
  if (String(scenario.scenarioSelectionStrategy ?? "") === "baseline") {
    classification = "scenario_config_issue";
  } else if (homeBlocker) {
    const homeEnvPresent = Boolean(asRecord(environmentVisibility.homeDetails).envVarPresent);
    if (!homeEnvPresent && !Object.keys(homeProfile).length) {
      classification = "unreadable_field_in_past_path_only";
    } else if (!sourceReadPath.homeDetails.sameRunOwnerAsUserSite) {
      classification = "wrong_owner_path";
    } else if (baselineParityReport.overallMatch === true && homeValidation.ok === false && homeBlocker.failureCode !== "occupants_invalid") {
      classification = "validator_overreach";
    } else {
      classification = "real_bad_brian_data";
    }
  } else if (applianceBlocker) {
    const applianceEnvPresent = Boolean(asRecord(environmentVisibility.appliances).envVarPresent);
    if (!applianceEnvPresent && !Object.keys(applianceProfile).length) {
      classification = "unreadable_field_in_past_path_only";
    } else if (!sourceReadPath.applianceDetails.sameRunOwnerAsUserSite) {
      classification = "wrong_owner_path";
    } else {
      classification = "real_bad_brian_data";
    }
  } else if (baselineParityReport.firstDivergenceField != null) {
    classification = "mapping_drift";
  }

  const exactBlocker = homeBlocker ?? applianceBlocker;
  return {
    scenario: {
      scenarioKey: scenario.scenarioKey ?? null,
      mode: scenario.mode ?? null,
      scenarioSelectionStrategy: scenario.scenarioSelectionStrategy ?? null,
    },
    baselineParity: {
      overallMatch: baselineParityReport.overallMatch === true,
      firstDivergenceField: baselineParityReport.firstDivergenceField ?? null,
    },
    compareCapableNow: prereqStatus.compareCapableNow,
    exactBlocker: exactBlocker
      ? {
          ...exactBlocker,
          fieldValuesSeen:
            exactBlocker.category === "homeDetails"
              ? {
                  rawHomeProfilePresent: Object.keys(homeProfile).length > 0,
                  occupantsWork: clampInt(homeProfile.occupantsWork, 0, 50),
                  occupantsSchool: clampInt(homeProfile.occupantsSchool, 0, 50),
                  occupantsHomeAllDay: clampInt(homeProfile.occupantsHomeAllDay, 0, 50),
                  occupantsTotal:
                    clampInt(homeProfile.occupantsWork, 0, 50) +
                    clampInt(homeProfile.occupantsSchool, 0, 50) +
                    clampInt(homeProfile.occupantsHomeAllDay, 0, 50),
                  fuelConfiguration: nonEmptyString(homeProfile.fuelConfiguration),
                  hvacType: nonEmptyString(homeProfile.hvacType),
                  heatingType: nonEmptyString(homeProfile.heatingType),
                }
              : {
                  rawApplianceProfilePresent: Object.keys(applianceProfile).length > 0,
                  fuelConfiguration: nonEmptyString(applianceProfile.fuelConfiguration),
                  applianceCount: Array.isArray(applianceProfile.appliances) ? applianceProfile.appliances.length : 0,
                  applianceValidationError: applianceValidation.ok ? null : applianceValidation.error,
                },
        }
      : null,
    sourceReadPath,
    baselineVsPastReadsSameHomeApplianceTruth: {
      homeDetails: sourceReadPath.homeDetails.sameRunOwnerAsUserSite,
      applianceDetails: sourceReadPath.applianceDetails.sameRunOwnerAsUserSite,
    },
    classification,
  };
}
