import { prisma } from "@/lib/db";
import { ensureWorkspaceScenariosForHouse } from "@/lib/usage/ensureWorkspaceScenarios";
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

export async function scenarioBelongsToHouse(args: {
  scenarioId: string;
  userId: string;
  houseId: string;
}): Promise<boolean> {
  const scenarioId = String(args.scenarioId ?? "").trim();
  const userId = String(args.userId ?? "").trim();
  const houseId = String(args.houseId ?? "").trim();
  if (!scenarioId || !userId || !houseId) return false;
  const row = await (prisma as any).usageSimulatorScenario
    .findFirst({
      where: { id: scenarioId, userId, houseId, archivedAt: null },
      select: { id: true },
    })
    .catch(() => null);
  return Boolean(row?.id);
}

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

export type PrepareModelIntelligenceDispatchStepFailure = {
  ok: false;
  error: string;
  message: string;
  scenarioHouseMismatch?: boolean;
  expectedScenarioHouseId?: string;
  actualContextHouseId?: string;
};

export type PrepareModelIntelligenceDispatchStepResult =
  | {
      ok: true;
      stepId: string;
      runMode: ModelIntelligenceRunMode;
      onePathRunRequest: Record<string, unknown>;
    }
  | PrepareModelIntelligenceDispatchStepFailure;

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
  const belongsToDispatchHouse = await scenarioBelongsToHouse({
    scenarioId,
    userId: ownerUserId,
    houseId: dispatchHouseId,
  });
  if (belongsToDispatchHouse) {
    return { ok: true };
  }

  return {
    ok: false,
    error: "scenario_house_mismatch",
    message: "Model Intelligence refused to dispatch a lab-home run with a source-house scenarioId.",
    scenarioHouseMismatch: true,
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
  if (onePathMode) {
    scenarioId = await resolveOrchestrationPastScenarioId({
      context: args.context,
      ownerUserId: args.ownerUserId,
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
  };
}
