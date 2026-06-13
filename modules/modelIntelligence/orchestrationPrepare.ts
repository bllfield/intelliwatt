import {
  validateDispatchScenarioOwnership,
  scenarioBelongsToDispatchHouse,
} from "@/lib/usage/labDispatchScenarioOwnership";
import {
  ensureModelIntelligenceScenarioForRunMode,
  scenarioNameForModelIntelligenceRunMode,
} from "@/modules/modelIntelligence/modelIntelligenceScenarios";
import {
  buildModelIntelligenceOnePathRunRequest,
  listOrchestrationDispatchSteps,
  mapModelIntelligenceRunModeToOnePathMode,
  resolveOrchestrationHouseTargets,
} from "@/modules/modelIntelligence/onePathDispatchPlan";
import { resolveModelIntelligenceModeAvailability } from "@/modules/modelIntelligence/modeAvailability";
import type {
  ModelIntelligenceLabContext,
  ModelIntelligenceManualGapfillOptions,
  ModelIntelligenceModeAvailability,
  ModelIntelligenceOnePathOptions,
  ModelIntelligenceRunMode,
  ModelIntelligenceSequencePreview,
} from "@/modules/modelIntelligence/types";

export { scenarioBelongsToDispatchHouse as scenarioBelongsToHouse };

export async function resolveOrchestrationPastScenarioId(args: {
  context: ModelIntelligenceLabContext;
  ownerUserId: string | null;
  runMode: ModelIntelligenceRunMode;
}): Promise<string | null> {
  const pinned = args.context.labTestHome.isPinnedToSource && Boolean(args.context.labTestHome.testHomeHouseId);
  const effectiveUserId = pinned && args.ownerUserId ? args.ownerUserId : args.context.userId;
  const effectiveHouseId =
    pinned && args.context.labTestHome.testHomeHouseId
      ? args.context.labTestHome.testHomeHouseId
      : args.context.sourceHouseId;
  if (!effectiveUserId || !effectiveHouseId) return null;
  return ensureModelIntelligenceScenarioForRunMode({
    userId: effectiveUserId,
    houseId: effectiveHouseId,
    runMode: args.runMode,
  });
}

export type PrepareModelIntelligenceDispatchStepFailure = {
  ok: false;
  error: string;
  message: string;
  scenarioHouseMismatch?: boolean;
  expectedScenarioHouseId?: string;
  actualContextHouseId?: string;
  scenarioIdHealed?: boolean;
};

export type PrepareModelIntelligenceDispatchStepResult =
  | {
      ok: true;
      stepId: string;
      runMode: ModelIntelligenceRunMode;
      onePathRunRequest: Record<string, unknown>;
      scenarioIdHealed?: boolean;
    }
  | PrepareModelIntelligenceDispatchStepFailure;

function resolveEffectiveLabDispatchIdentity(args: {
  context: ModelIntelligenceLabContext;
  ownerUserId: string | null;
}): { ownerUserId: string; dispatchHouseId: string } | null {
  const pinned = args.context.labTestHome.isPinnedToSource && Boolean(args.context.labTestHome.testHomeHouseId);
  const ownerUserId = String(
    pinned && args.ownerUserId ? args.ownerUserId : args.context.userId
  ).trim();
  const dispatchHouseId = String(
    pinned && args.context.labTestHome.testHomeHouseId
      ? args.context.labTestHome.testHomeHouseId
      : args.context.sourceHouseId
  ).trim();
  if (!ownerUserId || !dispatchHouseId) return null;
  return { ownerUserId, dispatchHouseId };
}

export async function resolveOwnedLabDispatchScenarioForRunMode(args: {
  context: ModelIntelligenceLabContext;
  ownerUserId: string | null;
  runMode: ModelIntelligenceRunMode;
}): Promise<
  | { ok: true; scenarioId: string; healed: boolean }
  | PrepareModelIntelligenceDispatchStepFailure
> {
  const identity = resolveEffectiveLabDispatchIdentity(args);
  if (!identity) {
    return {
      ok: false,
      error: "past_scenario_missing",
      message: "Past scenario could not be resolved for the current lab home.",
    };
  }

  const expectedScenarioName = scenarioNameForModelIntelligenceRunMode(args.runMode);
  let healed = false;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const scenarioId = await ensureModelIntelligenceScenarioForRunMode({
      userId: identity.ownerUserId,
      houseId: identity.dispatchHouseId,
      runMode: args.runMode,
    });
    if (!scenarioId) {
      const pinned =
        args.context.labTestHome.isPinnedToSource && Boolean(args.context.labTestHome.testHomeHouseId);
      return {
        ok: false,
        error: "past_scenario_missing",
        message: pinned
          ? "Pinned lab home has no Past scenario. Run replace_test_home_from_source first."
          : "Past (Corrected) scenario is missing on the effective One Path house. Load context again or replace/link the lab test home.",
      };
    }

    const ownership = await validateDispatchScenarioOwnership({
      scenarioId,
      dispatchHouseId: identity.dispatchHouseId,
      ownerUserId: identity.ownerUserId,
      expectedScenarioName,
    });
    if (ownership.ok) {
      return { ok: true, scenarioId: ownership.scenario.id, healed };
    }

    healed = true;
  }

  return {
    ok: false,
    error: "scenario_house_mismatch",
    message:
      "Model Intelligence could not resolve a Past scenario owned by the current pinned lab home.",
    scenarioHouseMismatch: true,
    expectedScenarioHouseId: identity.dispatchHouseId,
    actualContextHouseId: args.context.actualContextHouseId,
    scenarioIdHealed: true,
  };
}

export async function validateLabDispatchScenarioHouseMatch(args: {
  scenarioId: string | null;
  dispatchHouseId: string;
  sourceHouseId: string;
  actualContextHouseId: string;
  ownerUserId: string | null;
  contextUserId: string;
}): Promise<{ ok: true } | PrepareModelIntelligenceDispatchStepFailure> {
  const scenarioId = String(args.scenarioId ?? "").trim();
  const dispatchHouseId = String(args.dispatchHouseId ?? "").trim();
  const sourceHouseId = String(args.sourceHouseId ?? "").trim();
  const actualContextHouseId = String(args.actualContextHouseId ?? "").trim();
  if (!scenarioId || !dispatchHouseId || dispatchHouseId === sourceHouseId) {
    return { ok: true };
  }

  const ownerUserId = String(args.ownerUserId ?? args.contextUserId).trim();
  const ownership = await validateDispatchScenarioOwnership({
    scenarioId,
    dispatchHouseId,
    ownerUserId,
  });
  if (ownership.ok) {
    return { ok: true };
  }

  return {
    ok: false,
    error: ownership.errorCode === "scenario_not_found" ? "scenario_not_found" : "scenario_house_mismatch",
    message:
      ownership.errorCode === "scenario_not_found"
        ? "Model Intelligence refused to dispatch a missing Past scenarioId."
        : "Model Intelligence refused to dispatch a lab-home run with a source-house scenarioId.",
    scenarioHouseMismatch: ownership.errorCode === "scenario_not_owned_by_dispatch_house",
    expectedScenarioHouseId: dispatchHouseId,
    actualContextHouseId,
  };
}

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
  let scenarioIdHealed = false;
  if (onePathMode) {
    const resolved = await resolveOwnedLabDispatchScenarioForRunMode({
      context: args.context,
      ownerUserId: args.ownerUserId,
      runMode: args.runMode,
    });
    if (!resolved.ok) return resolved;
    scenarioId = resolved.scenarioId;
    scenarioIdHealed = resolved.healed;
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

  const targets = resolveOrchestrationHouseTargets({
    context: args.context,
    availability: availability as ModelIntelligenceModeAvailability,
    ownerUserId: args.ownerUserId,
  });
  const dispatchHouseId = String(built.request.houseId ?? targets.houseId ?? "").trim();
  const actualContextHouseId = String(
    built.request.actualContextHouseId ?? targets.actualContextHouseId ?? args.context.actualContextHouseId
  ).trim();
  const scenarioGuard = await validateLabDispatchScenarioHouseMatch({
    scenarioId,
    dispatchHouseId,
    sourceHouseId: args.context.sourceHouseId,
    actualContextHouseId,
    ownerUserId: args.ownerUserId,
    contextUserId: args.context.userId,
  });
  if (!scenarioGuard.ok) return scenarioGuard;

  return {
    ok: true,
    stepId: step.stepId,
    runMode: args.runMode,
    onePathRunRequest: built.request,
    scenarioIdHealed: scenarioIdHealed || undefined,
  };
}
