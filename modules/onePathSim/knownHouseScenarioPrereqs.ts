import { validateApplianceProfile } from "@/modules/applianceProfile/validation";
import { validateHomeProfile } from "@/modules/homeProfile/validation";
import { hasUsableAnnualPayload, hasUsableMonthlyPayload } from "@/modules/onePathSim/manualPrefill";
import type { OnePathKnownScenario } from "@/modules/onePathSim/knownHouseScenarios";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function describeHomeProfileFailure(code: string | null): string | null {
  switch (code) {
    case "occupants_invalid":
      return "Home Details require at least one occupant across work, school, or home-all-day.";
    case "homeStyle_required":
      return "Home Details are missing `homeStyle`.";
    case "insulationType_required":
      return "Home Details are missing `insulationType`.";
    case "windowType_required":
      return "Home Details are missing `windowType`.";
    case "foundation_required":
      return "Home Details are missing `foundation`.";
    case "fuelConfiguration_required":
      return "Home Details are missing `fuelConfiguration`.";
    case "hvacType_required":
      return "Past/baseline Home Details require `hvacType`.";
    case "heatingType_required":
      return "Past/baseline Home Details require `heatingType`.";
    case "poolPumpType_required":
      return "Pool homes require `poolPumpType`.";
    case "poolPumpHp_required":
      return "Pool homes require `poolPumpHp`.";
    case "poolSummerRunHoursPerDay_required":
      return "Pool homes require `poolSummerRunHoursPerDay`.";
    case "poolWinterRunHoursPerDay_required":
      return "Pool homes require `poolWinterRunHoursPerDay`.";
    case "poolHeaterType_required":
      return "Pool-heater homes require `poolHeaterType`.";
    default:
      return code ? `Home Details validator failed with \`${code}\`.` : null;
  }
}

function inspectManualMonthlyPayload(payload: unknown): {
  ready: boolean;
  failureCode: string | null;
  failureSummary: string | null;
  failedChecks: string[];
} {
  const record = asRecord(payload);
  const failedChecks: string[] = [];
  if (record.mode !== "MONTHLY") {
    return {
      ready: false,
      failureCode: "manual_monthly_mode_mismatch",
      failureSummary: "Saved manual payload is not `MONTHLY`.",
      failedChecks: ["payload.mode !== 'MONTHLY'"],
    };
  }
  const anchorEndDate = String(record.anchorEndDate ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchorEndDate)) {
    failedChecks.push("payload.anchorEndDate is not a valid ISO date");
  }
  const monthlyKwh = Array.isArray(record.monthlyKwh) ? record.monthlyKwh : [];
  const hasFilledMonthlyRow = monthlyKwh.some((row) => {
    const rowRecord = asRecord(row);
    return /^\d{4}-\d{2}$/.test(String(rowRecord.month ?? "").trim()) && Number.isFinite(Number(rowRecord.kwh));
  });
  if (!hasFilledMonthlyRow) {
    failedChecks.push("payload.monthlyKwh has no numeric filled totals");
  }
  if (failedChecks.length > 0) {
    return {
      ready: false,
      failureCode: failedChecks[0]?.includes("anchorEndDate")
        ? "manual_monthly_anchor_end_date_missing"
        : "manual_monthly_totals_missing",
      failureSummary: `Manual monthly payload failed checks: ${failedChecks.join("; ")}.`,
      failedChecks,
    };
  }
  return { ready: true, failureCode: null, failureSummary: null, failedChecks: [] };
}

function inspectManualAnnualPayload(payload: unknown): {
  ready: boolean;
  failureCode: string | null;
  failureSummary: string | null;
  failedChecks: string[];
} {
  const record = asRecord(payload);
  if (record.mode !== "ANNUAL") {
    return {
      ready: false,
      failureCode: "manual_annual_mode_mismatch",
      failureSummary: "Saved manual payload is not `ANNUAL`.",
      failedChecks: ["payload.mode !== 'ANNUAL'"],
    };
  }
  const failedChecks: string[] = [];
  const anchorEndDate = String(record.anchorEndDate ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchorEndDate)) {
    failedChecks.push("payload.anchorEndDate is not a valid ISO date");
  }
  if (!Number.isFinite(Number(record.annualKwh))) {
    failedChecks.push("payload.annualKwh is not a finite number");
  }
  if (failedChecks.length > 0) {
    return {
      ready: false,
      failureCode: failedChecks[0]?.includes("anchorEndDate")
        ? "manual_annual_anchor_end_date_missing"
        : "manual_annual_kwh_missing",
      failureSummary: `Manual annual payload failed checks: ${failedChecks.join("; ")}.`,
      failedChecks,
    };
  }
  return { ready: true, failureCode: null, failureSummary: null, failedChecks: [] };
}

export type OnePathValidatorAuditDetail = {
  ready: boolean;
  validator: string;
  failureCode: string | null;
  failureSummary: string | null;
  sourceOwner: string;
  failedChecks?: string[];
};

export type OnePathBlockingDetail = {
  category: "usageTruth" | "homeDetails" | "applianceDetails" | "manualMonthlyPayload" | "manualAnnualPayload";
  validator: string;
  failureCode: string;
  failureSummary: string;
  sourceOwner: string;
};

export type OnePathReadSourceComparison = {
  onePathAuditOwner: string;
  onePathRunOwner: string;
  userSiteOwner: string;
  sameAuditOwnerAsUserSite: boolean;
  sameRunOwnerAsUserSite: boolean;
  sameBackingStoreAsUserSite: boolean;
  notes: string;
};

export type OnePathKnownScenarioPrereqStatus = {
  homeDetailsReady: boolean;
  manualMonthlyPayloadReady: boolean;
  manualAnnualPayloadReady: boolean;
  usageTruthReady: boolean;
  compareCapableNow: boolean;
  blockingReasons: string[];
  applianceProfileReady: boolean;
  baselineRunnableNow: boolean;
  availablePrepActions: string[];
  validatorAudit: {
    usageTruth: OnePathValidatorAuditDetail;
    homeDetails: OnePathValidatorAuditDetail;
    applianceDetails: OnePathValidatorAuditDetail;
    manualMonthlyPayload: OnePathValidatorAuditDetail;
    manualAnnualPayload: OnePathValidatorAuditDetail;
  };
  blockingDetails: OnePathBlockingDetail[];
  readSourceComparison: {
    usageTruth: OnePathReadSourceComparison;
    homeDetails: OnePathReadSourceComparison;
    applianceDetails: OnePathReadSourceComparison;
    manualUsage: OnePathReadSourceComparison;
  };
};

export function buildKnownHouseScenarioPrereqStatus(args: {
  scenario?: Partial<OnePathKnownScenario> | null;
  lookupSourceContext?: Record<string, unknown> | null;
}): OnePathKnownScenarioPrereqStatus {
  const scenario = asRecord(args.scenario);
  const lookupSourceContext = asRecord(args.lookupSourceContext);
  const upstreamUsageTruth = asRecord(lookupSourceContext.upstreamUsageTruth);
  const statusSummary = asRecord(asRecord(upstreamUsageTruth.currentRun).statusSummary);
  const homeProfile = lookupSourceContext.homeProfile;
  const applianceProfile = lookupSourceContext.applianceProfile;
  const manualUsagePayload =
    (lookupSourceContext.effectiveManualUsagePayload as typeof lookupSourceContext.manualUsagePayload) ??
    lookupSourceContext.manualUsagePayload;
  const mode = String(scenario.mode ?? "");
  const scenarioSelectionStrategy = String(scenario.scenarioSelectionStrategy ?? "");
  const homeValidation = validateHomeProfile(homeProfile, { requirePastBaselineFields: true });
  const applianceValidation = validateApplianceProfile(applianceProfile);
  const manualMonthlyInspection = inspectManualMonthlyPayload(manualUsagePayload);
  const manualAnnualInspection = inspectManualAnnualPayload(manualUsagePayload);
  const homeDetailsReady = Boolean(homeValidation.ok);
  const applianceProfileReady = Boolean(applianceValidation.ok);
  const manualMonthlyPayloadReady = hasUsableMonthlyPayload(manualUsagePayload as any);
  const manualAnnualPayloadReady = hasUsableAnnualPayload(manualUsagePayload as any);
  const usageTruthReady =
    statusSummary.downstreamSimulationAllowed === true ||
    String(lookupSourceContext.usageTruthSource ?? "") === "persisted_usage_output";
  const usageTruthFailureCode = usageTruthReady
    ? null
    : String(statusSummary.usageTruthStatus ?? lookupSourceContext.usageTruthSource ?? "usage_truth_unavailable");
  const usageTruthFailureSummary = usageTruthReady
    ? null
    : statusSummary.refreshFailureReason
      ? `Upstream usage truth is not ready: ${String(statusSummary.refreshFailureReason)}`
      : "Upstream usage truth is not ready.";

  const validatorAudit = {
    usageTruth: {
      ready: usageTruthReady,
      validator: "upstreamUsageTruth.currentRun.statusSummary.downstreamSimulationAllowed || usageTruthSource === persisted_usage_output",
      failureCode: usageTruthFailureCode,
      failureSummary: usageTruthFailureSummary,
      sourceOwner:
        String(asRecord(asRecord(upstreamUsageTruth.currentRun).sourceIdentity).sourceOwner ?? "") ||
        "modules/onePathSim/upstreamUsageTruth.ts -> resolveIntervalsLayer ACTUAL_USAGE_INTERVALS",
      failedChecks: usageTruthReady
        ? []
        : [
            "upstreamUsageTruth.currentRun.statusSummary.downstreamSimulationAllowed !== true",
            "usageTruthSource !== 'persisted_usage_output'",
          ],
    },
    homeDetails: {
      ready: homeDetailsReady,
      validator: "validateHomeProfile(requirePastBaselineFields=true)",
      failureCode: homeValidation.ok ? null : homeValidation.error,
      failureSummary: homeValidation.ok ? null : describeHomeProfileFailure(homeValidation.error),
      sourceOwner: "modules/homeProfile/repo.ts :: getHomeProfileSimulatedByUserHouse",
      failedChecks: homeValidation.ok ? [] : [homeValidation.error],
    },
    applianceDetails: {
      ready: applianceProfileReady,
      validator: "validateApplianceProfile",
      failureCode: applianceValidation.ok ? null : applianceValidation.error,
      failureSummary:
        applianceValidation.ok
          ? null
          : applianceValidation.error === "fuelConfiguration_required"
            ? "Appliance profile is missing `fuelConfiguration`."
            : applianceValidation.error === "appliance_type_required"
              ? "Appliance profile contains a row without `type`."
              : `Appliance validator failed with \`${applianceValidation.error}\`.`,
      sourceOwner: "modules/applianceProfile/repo.ts :: getApplianceProfileSimulatedByUserHouse",
      failedChecks: applianceValidation.ok ? [] : [applianceValidation.error],
    },
    manualMonthlyPayload: {
      ready: manualMonthlyPayloadReady,
      validator: "hasUsableMonthlyPayload",
      failureCode: manualMonthlyPayloadReady ? null : manualMonthlyInspection.failureCode,
      failureSummary: manualMonthlyPayloadReady ? null : manualMonthlyInspection.failureSummary,
      sourceOwner: "modules/onePathSim/manualStore.ts :: getManualUsageInputForUserHouse",
      failedChecks: manualMonthlyInspection.failedChecks,
    },
    manualAnnualPayload: {
      ready: manualAnnualPayloadReady,
      validator: "hasUsableAnnualPayload",
      failureCode: manualAnnualPayloadReady ? null : manualAnnualInspection.failureCode,
      failureSummary: manualAnnualPayloadReady ? null : manualAnnualInspection.failureSummary,
      sourceOwner: "modules/onePathSim/manualStore.ts :: getManualUsageInputForUserHouse",
      failedChecks: manualAnnualInspection.failedChecks,
    },
  } as const;

  const blockingReasons: string[] = [];
  const blockingDetails: OnePathBlockingDetail[] = [];
  const requiresHomeDetails =
    mode === "INTERVAL" || mode === "NEW_BUILD" || scenarioSelectionStrategy !== "baseline";
  const requiresApplianceDetails =
    mode !== "INTERVAL" && mode !== "NEW_BUILD" && scenarioSelectionStrategy !== "baseline";
  if (!usageTruthReady) blockingReasons.push("Upstream usage truth is not ready.");
  if (!usageTruthReady) {
    blockingDetails.push({
      category: "usageTruth",
      validator: validatorAudit.usageTruth.validator,
      failureCode: validatorAudit.usageTruth.failureCode ?? "usage_truth_unavailable",
      failureSummary: validatorAudit.usageTruth.failureSummary ?? "Upstream usage truth is not ready.",
      sourceOwner: validatorAudit.usageTruth.sourceOwner,
    });
  }
  if (requiresHomeDetails && !homeDetailsReady) {
    blockingReasons.push("Complete Home Details (required fields).");
    blockingDetails.push({
      category: "homeDetails",
      validator: validatorAudit.homeDetails.validator,
      failureCode: validatorAudit.homeDetails.failureCode ?? "home_profile_invalid",
      failureSummary: validatorAudit.homeDetails.failureSummary ?? "Complete Home Details (required fields).",
      sourceOwner: validatorAudit.homeDetails.sourceOwner,
    });
  }

  if (requiresApplianceDetails && !applianceProfileReady) {
    blockingReasons.push("Complete Appliances (select fuel configuration, add appliance types as needed).");
    blockingDetails.push({
      category: "applianceDetails",
      validator: validatorAudit.applianceDetails.validator,
      failureCode: validatorAudit.applianceDetails.failureCode ?? "appliance_profile_invalid",
      failureSummary:
        validatorAudit.applianceDetails.failureSummary ??
        "Complete Appliances (select fuel configuration, add appliance types as needed).",
      sourceOwner: validatorAudit.applianceDetails.sourceOwner,
    });
  }
  if (mode === "MANUAL_MONTHLY" && !manualMonthlyPayloadReady) {
    blockingReasons.push("Save filled manual monthly usage totals before running MANUAL_MONTHLY.");
    blockingDetails.push({
      category: "manualMonthlyPayload",
      validator: validatorAudit.manualMonthlyPayload.validator,
      failureCode: validatorAudit.manualMonthlyPayload.failureCode ?? "manual_monthly_payload_unusable",
      failureSummary:
        validatorAudit.manualMonthlyPayload.failureSummary ??
        "Save filled manual monthly usage totals before running MANUAL_MONTHLY.",
      sourceOwner: validatorAudit.manualMonthlyPayload.sourceOwner,
    });
  }
  if (mode === "MANUAL_ANNUAL" && !manualAnnualPayloadReady) {
    blockingReasons.push("Save a MANUAL_ANNUAL payload before running MANUAL_ANNUAL.");
    blockingDetails.push({
      category: "manualAnnualPayload",
      validator: validatorAudit.manualAnnualPayload.validator,
      failureCode: validatorAudit.manualAnnualPayload.failureCode ?? "manual_annual_payload_unusable",
      failureSummary:
        validatorAudit.manualAnnualPayload.failureSummary ??
        "Save a MANUAL_ANNUAL payload before running MANUAL_ANNUAL.",
      sourceOwner: validatorAudit.manualAnnualPayload.sourceOwner,
    });
  }

  const baselineRunnableNow =
    scenarioSelectionStrategy === "baseline" &&
    (mode === "INTERVAL"
      ? usageTruthReady && homeDetailsReady
      : mode === "MANUAL_ANNUAL"
        ? usageTruthReady && manualAnnualPayloadReady
        : mode === "MANUAL_MONTHLY"
          ? usageTruthReady && manualMonthlyPayloadReady
          : usageTruthReady && homeDetailsReady);

  const compareCapableNow =
    scenarioSelectionStrategy !== "baseline" &&
    (mode === "INTERVAL"
      ? usageTruthReady && homeDetailsReady
      : mode === "MANUAL_MONTHLY"
        ? usageTruthReady && homeDetailsReady && applianceProfileReady && manualMonthlyPayloadReady
        : mode === "MANUAL_ANNUAL"
          ? usageTruthReady && homeDetailsReady && applianceProfileReady && manualAnnualPayloadReady
          : usageTruthReady && homeDetailsReady);

  const availablePrepActions: string[] = [];
  if ((requiresHomeDetails && !homeDetailsReady) || (requiresApplianceDetails && !applianceProfileReady)) {
    availablePrepActions.push("prepare_home_details");
  }
  if (mode === "MANUAL_MONTHLY" && !manualMonthlyPayloadReady) availablePrepActions.push("prepare_manual_monthly");
  if (mode === "MANUAL_ANNUAL" && !manualAnnualPayloadReady) availablePrepActions.push("prepare_manual_annual");

  const readSourceComparison = {
    usageTruth: {
      onePathAuditOwner: "modules/onePathSim/upstreamUsageTruth.ts :: resolveUpstreamUsageTruthForSimulation(seedIfMissing=false)",
      onePathRunOwner: "modules/onePathSim/upstreamUsageTruth.ts :: resolveUpstreamUsageTruthForSimulation",
      userSiteOwner:
        "app/api/user/usage/route.ts + app/api/user/usage/simulated/house/route.ts :: resolveIntervalsLayer ACTUAL_USAGE_INTERVALS",
      sameAuditOwnerAsUserSite: true,
      sameRunOwnerAsUserSite: true,
      sameBackingStoreAsUserSite: true,
      notes: "Baseline truth stays on the shared ACTUAL_USAGE_INTERVALS owner for both user-site usage and One Path.",
    },
    homeDetails: {
      onePathAuditOwner: "modules/homeProfile/repo.ts :: getHomeProfileReadOnlyByUserHouse",
      onePathRunOwner: "modules/homeProfile/repo.ts :: getHomeProfileSimulatedByUserHouse",
      userSiteOwner: "modules/homeProfile/repo.ts :: getHomeProfileSimulatedByUserHouse",
      sameAuditOwnerAsUserSite: false,
      sameRunOwnerAsUserSite: true,
      sameBackingStoreAsUserSite: true,
      notes: "Audit uses a pure read-only reader; One Path runs and the user site still share the same simulated home-profile repo owner.",
    },
    applianceDetails: {
      onePathAuditOwner: "modules/applianceProfile/repo.ts :: getApplianceProfileSimulatedByUserHouse",
      onePathRunOwner: "modules/applianceProfile/repo.ts :: getApplianceProfileSimulatedByUserHouse",
      userSiteOwner: "modules/applianceProfile/repo.ts :: getApplianceProfileSimulatedByUserHouse",
      sameAuditOwnerAsUserSite: true,
      sameRunOwnerAsUserSite: true,
      sameBackingStoreAsUserSite: true,
      notes: "Appliance reads already share the same repo owner across One Path and the user site.",
    },
    manualUsage: {
      onePathAuditOwner: "modules/onePathSim/manualStore.ts :: getManualUsageInputForUserHouse",
      onePathRunOwner: "modules/onePathSim/manualStore.ts :: getManualUsageInputForUserHouse",
      userSiteOwner: "modules/manualUsage/store.ts :: getManualUsageInputForUserHouse",
      sameAuditOwnerAsUserSite: false,
      sameRunOwnerAsUserSite: false,
      sameBackingStoreAsUserSite: true,
      notes: "One Path and the user site use different wrapper modules, but both read the same `manualUsageInput` table keyed by `{ userId, houseId }`.",
    },
  } as const;

  return {
    homeDetailsReady,
    manualMonthlyPayloadReady,
    manualAnnualPayloadReady,
    usageTruthReady,
    compareCapableNow,
    blockingReasons,
    applianceProfileReady,
    baselineRunnableNow,
    availablePrepActions,
    validatorAudit,
    blockingDetails,
    readSourceComparison,
  };
}
