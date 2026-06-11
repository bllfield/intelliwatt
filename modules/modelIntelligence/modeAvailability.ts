import {
  GREEN_BUTTON_UNAVAILABLE_DEFAULT_REASON,
  NEW_BUILD_ORCHESTRATION_UNAVAILABLE_REASON,
  type ModelIntelligenceLabContext,
  type ModelIntelligenceModeAvailability,
  type ModelIntelligenceRunMode,
  MODEL_INTELLIGENCE_RUN_MODES,
} from "@/modules/modelIntelligence/types";

function hasIntervalBackedTruth(context: ModelIntelligenceLabContext): boolean {
  return context.sourceTruthAvailable && context.intervalCount > 0;
}

function hasGreenButtonTruth(context: ModelIntelligenceLabContext): boolean {
  return context.greenButtonAvailable || context.actualSourceKind === "GREEN_BUTTON";
}

function hasSmtIntervalTruth(context: ModelIntelligenceLabContext): boolean {
  return context.smtIntervalTruthAvailable;
}

function labReadyForMaskedRuns(context: ModelIntelligenceLabContext): { ok: boolean; reason: string | null } {
  if (!hasIntervalBackedTruth(context)) {
    return { ok: false, reason: "Source actual interval-backed usage truth is not available for this house." };
  }
  if (!context.labTestHome.testHomeHouseId) {
    return { ok: false, reason: "One Path lab test home is not provisioned for this admin user." };
  }
  if (!context.labTestHome.isPinnedToSource) {
    return {
      ok: false,
      reason:
        "Lab test home is not pinned to the selected source house. Replace/link the One Path lab test home before masked runs.",
    };
  }
  return { ok: true, reason: null };
}

export function resolveModelIntelligenceModeAvailability(
  context: ModelIntelligenceLabContext
): ModelIntelligenceModeAvailability[] {
  const maskedLab = labReadyForMaskedRuns(context);

  return MODEL_INTELLIGENCE_RUN_MODES.map((mode): ModelIntelligenceModeAvailability => {
    switch (mode) {
      case "SMT_INTERVAL_TRUTH": {
        const available = hasSmtIntervalTruth(context);
        return {
          mode,
          selectable: true,
          available,
          unavailableReason: available
            ? null
            : context.actualSourceKind === "GREEN_BUTTON"
              ? "Committed source is Green Button; use Green Button truth mode or select an SMT-backed house."
              : "SMT interval-backed source actual truth is not available for this house.",
          usesLabTestHome: false,
          writesToLabHomeOnly: false,
        };
      }
      case "GREEN_BUTTON_TRUTH": {
        const available = hasGreenButtonTruth(context);
        return {
          mode,
          selectable: true,
          available,
          unavailableReason: available ? null : GREEN_BUTTON_UNAVAILABLE_DEFAULT_REASON,
          usesLabTestHome: true,
          writesToLabHomeOnly: false,
        };
      }
      case "MONTHLY_MASKED":
      case "ANNUAL_MASKED":
        return {
          mode,
          selectable: true,
          available: maskedLab.ok,
          unavailableReason: maskedLab.reason,
          usesLabTestHome: true,
          writesToLabHomeOnly: true,
        };
      case "NEW_BUILD":
        return {
          mode,
          selectable: true,
          available: false,
          unavailableReason: NEW_BUILD_ORCHESTRATION_UNAVAILABLE_REASON,
          usesLabTestHome: true,
          writesToLabHomeOnly: true,
        };
      default:
        return {
          mode,
          selectable: false,
          available: false,
          unavailableReason: "Unknown run mode.",
          usesLabTestHome: false,
          writesToLabHomeOnly: false,
        };
    }
  });
}

export function isRunModeSelected(
  selectedRuns: Partial<Record<ModelIntelligenceRunMode, boolean>>,
  mode: ModelIntelligenceRunMode
): boolean {
  return selectedRuns[mode] === true;
}
