import { ensureWorkspaceScenariosForHouse } from "@/lib/usage/ensureWorkspaceScenarios";
import {
  buildModelIntelligenceOnePathRunRequest,
  listOrchestrationDispatchSteps,
  mapModelIntelligenceRunModeToOnePathMode,
} from "@/modules/modelIntelligence/onePathDispatchPlan";
import { resolveModelIntelligenceModeAvailability } from "@/modules/modelIntelligence/modeAvailability";
import type {
  ModelIntelligenceLabContext,
  ModelIntelligenceManualGapfillOptions,
  ModelIntelligenceOnePathOptions,
  ModelIntelligenceRunMode,
  ModelIntelligenceSequencePreview,
} from "@/modules/modelIntelligence/types";

export async function resolveOrchestrationPastScenarioId(args: {
  context: ModelIntelligenceLabContext;
  ownerUserId: string | null;
}): Promise<string | null> {
  const pinned = args.context.labTestHome.isPinnedToSource && Boolean(args.context.labTestHome.testHomeHouseId);
  const effectiveUserId = pinned && args.ownerUserId ? args.ownerUserId : args.context.userId;
  const effectiveHouseId =
    pinned && args.context.labTestHome.testHomeHouseId
      ? args.context.labTestHome.testHomeHouseId
      : args.context.sourceHouseId;
  if (!effectiveHouseId) return null;
  const ensured = await ensureWorkspaceScenariosForHouse({
    userId: effectiveUserId,
    houseId: effectiveHouseId,
  }).catch(() => ({ pastScenarioId: null, futureScenarioId: null }));
  return ensured.pastScenarioId ? String(ensured.pastScenarioId) : null;
}

export type PrepareModelIntelligenceDispatchStepResult =
  | {
      ok: true;
      stepId: string;
      runMode: ModelIntelligenceRunMode;
      onePathRunRequest: Record<string, unknown>;
    }
  | { ok: false; error: string; message: string };

export async function prepareModelIntelligenceDispatchStep(args: {
  context: ModelIntelligenceLabContext;
  preview: ModelIntelligenceSequencePreview;
  runMode: ModelIntelligenceRunMode;
  onePathOptions: ModelIntelligenceOnePathOptions;
  manualGapfillOptions: ModelIntelligenceManualGapfillOptions;
  ownerUserId: string | null;
}): Promise<PrepareModelIntelligenceDispatchStepResult> {
  const step = listOrchestrationDispatchSteps(args.preview).find((entry) => entry.runMode === args.runMode);
  if (!step) {
    return {
      ok: false,
      error: "dispatch_step_not_runnable",
      message: "Selected run mode is not a runnable One Path dispatch step in the current preview.",
    };
  }

  const availability =
    args.preview.modeAvailability.find((row) => row.mode === args.runMode) ??
    resolveModelIntelligenceModeAvailability(args.context).find((row) => row.mode === args.runMode);
  if (!availability || !availability.available) {
    return {
      ok: false,
      error: "mode_unavailable",
      message: availability?.unavailableReason ?? "Selected run mode is unavailable.",
    };
  }

  const onePathMode = mapModelIntelligenceRunModeToOnePathMode(args.runMode);
  let scenarioId: string | null = null;
  if (onePathMode) {
    scenarioId = await resolveOrchestrationPastScenarioId({
      context: args.context,
      ownerUserId: args.ownerUserId,
    });
    if (!scenarioId) {
      return {
        ok: false,
        error: "past_scenario_missing",
        message:
          "Past (Corrected) scenario is missing on the effective One Path house. Load context again or replace/link the lab test home.",
      };
    }
  }

  const built = buildModelIntelligenceOnePathRunRequest({
    context: args.context,
    runMode: args.runMode,
    availability,
    onePathOptions: args.onePathOptions,
    manualGapfillOptions: args.manualGapfillOptions,
    scenarioId,
    ownerUserId: args.ownerUserId,
  });
  if (!built.ok) return built;

  return {
    ok: true,
    stepId: step.stepId,
    runMode: args.runMode,
    onePathRunRequest: built.request,
  };
}
