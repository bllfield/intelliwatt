import { validateApplianceProfile } from "@/modules/applianceProfile/validation";
import { validateHomeProfile } from "@/modules/homeProfile/validation";
import { hasUsableAnnualPayload, hasUsableMonthlyPayload } from "@/modules/onePathSim/manualPrefill";
import type { OnePathKnownScenario } from "@/modules/onePathSim/knownHouseScenarios";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

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
  const manualUsagePayload = lookupSourceContext.manualUsagePayload;
  const mode = String(scenario.mode ?? "");
  const scenarioSelectionStrategy = String(scenario.scenarioSelectionStrategy ?? "");

  const homeDetailsReady = Boolean(validateHomeProfile(homeProfile, { requirePastBaselineFields: true }).ok);
  const applianceProfileReady = Boolean(validateApplianceProfile(applianceProfile).ok);
  const manualMonthlyPayloadReady = hasUsableMonthlyPayload(manualUsagePayload as any);
  const manualAnnualPayloadReady = hasUsableAnnualPayload(manualUsagePayload as any);
  const usageTruthReady =
    statusSummary.downstreamSimulationAllowed === true ||
    String(lookupSourceContext.usageTruthSource ?? "") === "persisted_usage_output";

  const blockingReasons: string[] = [];
  if (!usageTruthReady) blockingReasons.push("Upstream usage truth is not ready.");
  if (!homeDetailsReady) blockingReasons.push("Complete Home Details (required fields).");

  if (mode !== "INTERVAL" && mode !== "NEW_BUILD" && !applianceProfileReady) {
    blockingReasons.push("Complete Appliances (select fuel configuration, add appliance types as needed).");
  }
  if (mode === "MANUAL_MONTHLY" && !manualMonthlyPayloadReady) {
    blockingReasons.push("Save filled manual monthly usage totals before running MANUAL_MONTHLY.");
  }
  if (mode === "MANUAL_ANNUAL" && !manualAnnualPayloadReady) {
    blockingReasons.push("Save a MANUAL_ANNUAL payload before running MANUAL_ANNUAL.");
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
  if (!homeDetailsReady || !applianceProfileReady) availablePrepActions.push("prepare_home_details");
  if (mode === "MANUAL_MONTHLY" && !manualMonthlyPayloadReady) availablePrepActions.push("prepare_manual_monthly");
  if (mode === "MANUAL_ANNUAL" && !manualAnnualPayloadReady) availablePrepActions.push("prepare_manual_annual");

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
  };
}
