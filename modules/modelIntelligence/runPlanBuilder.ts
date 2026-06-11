import { isRunModeSelected, resolveModelIntelligenceModeAvailability } from "@/modules/modelIntelligence/modeAvailability";
import type {
  ModelIntelligenceLabContext,
  ModelIntelligenceManualGapfillOptions,
  ModelIntelligenceOnePathOptions,
  ModelIntelligenceOrchestrationFlags,
  ModelIntelligenceRunMode,
  ModelIntelligenceRunStepKind,
  ModelIntelligenceSelectedRuns,
  ModelIntelligenceSequencePreview,
  ModelIntelligenceSequenceStep,
} from "@/modules/modelIntelligence/types";
import { MODEL_INTELLIGENCE_RUN_MODES } from "@/modules/modelIntelligence/types";

function defaultSelectedRuns(): ModelIntelligenceSelectedRuns {
  return {
    SMT_INTERVAL_TRUTH: false,
    GREEN_BUTTON_TRUTH: false,
    MONTHLY_MASKED: false,
    ANNUAL_MASKED: false,
    NEW_BUILD: false,
  };
}

export function normalizeSelectedRuns(
  input: Partial<Record<ModelIntelligenceRunMode, boolean>> | null | undefined
): ModelIntelligenceSelectedRuns {
  const base = defaultSelectedRuns();
  for (const mode of MODEL_INTELLIGENCE_RUN_MODES) {
    if (input?.[mode] === true) base[mode] = true;
  }
  return base;
}

function pushStep(
  steps: ModelIntelligenceSequenceStep[],
  args: {
    kind: ModelIntelligenceRunStepKind;
    label: string;
    runMode?: ModelIntelligenceRunMode | null;
    status?: ModelIntelligenceSequenceStep["status"];
    unavailableReason?: string | null;
    clientRunnable?: boolean;
    notes?: string[];
  }
) {
  steps.push({
    stepId: `${String(steps.length + 1).padStart(2, "0")}_${args.kind}${args.runMode ? `_${args.runMode}` : ""}`,
    order: steps.length + 1,
    kind: args.kind,
    label: args.label,
    runMode: args.runMode ?? null,
    status: args.status ?? "planned",
    unavailableReason: args.unavailableReason ?? null,
    clientRunnable: args.clientRunnable ?? false,
    notes: args.notes ?? [],
  });
}

export function buildModelIntelligenceSequencePreview(args: {
  context: ModelIntelligenceLabContext;
  selectedRuns: Partial<Record<ModelIntelligenceRunMode, boolean>>;
  onePathOptions: ModelIntelligenceOnePathOptions;
  manualGapfillOptions: ModelIntelligenceManualGapfillOptions;
  flags: ModelIntelligenceOrchestrationFlags;
}): ModelIntelligenceSequencePreview {
  const selectedRuns = normalizeSelectedRuns(args.selectedRuns);
  const modeAvailability = resolveModelIntelligenceModeAvailability(args.context);
  const availabilityByMode = new Map(modeAvailability.map((row) => [row.mode, row]));
  const steps: ModelIntelligenceSequenceStep[] = [];

  pushStep(steps, {
    kind: "resolve_context",
    label: "Resolve user/house, source actual truth, actualContextHouseId, and lab test-home pin state",
    clientRunnable: true,
    notes: [
      `sourceHouseId=${args.context.sourceHouseId}`,
      `actualContextHouseId=${args.context.actualContextHouseId}`,
      `labTestHomeId=${args.context.labTestHome.testHomeHouseId ?? "none"}`,
      args.context.labTestHome.isPinnedToSource
        ? "Lab test home pinned to selected source."
        : "Lab test home not pinned to selected source.",
    ],
  });

  const selectedModes = MODEL_INTELLIGENCE_RUN_MODES.filter((mode) => selectedRuns[mode]);
  for (const mode of selectedModes) {
    const availability = availabilityByMode.get(mode)!;
    const unavailable = !availability.available;
    pushStep(steps, {
      kind: "build_masked_input",
      label: `Build masked input variant for ${mode}`,
      runMode: mode,
      status: unavailable ? "unavailable" : "planned",
      unavailableReason: unavailable ? availability.unavailableReason : null,
      clientRunnable: !unavailable,
      notes: availability.writesToLabHomeOnly
        ? ["Writes/runs against lab test home only; source actual truth remains read-only."]
        : ["Reads source actual truth from actualContextHouseId; no source usage mutation."],
    });
    pushStep(steps, {
      kind: "dispatch_one_path_sim",
      label: `Dispatch ${mode} through One Path only (Phase 2+)`,
      runMode: mode,
      status: unavailable ? "unavailable" : "not_started",
      unavailableReason: unavailable ? availability.unavailableReason : "Phase 1 preview only — simulation not executed.",
      clientRunnable: false,
      notes: ["One Path is the only simulation producer."],
    });
  }

  if (args.flags.runCompareDiagnostics) {
    if (selectedModes.length === 0) {
      pushStep(steps, {
        kind: "compare_diagnostics",
        label: "Compare diagnostics (no run modes selected)",
        status: "skipped",
        unavailableReason: "Select at least one run mode to compare.",
        clientRunnable: false,
      });
    } else {
      for (const mode of selectedModes) {
        const availability = availabilityByMode.get(mode)!;
        const unavailable = !availability.available;
        pushStep(steps, {
          kind: "compare_diagnostics",
          label: `Compare source actual vs simulated artifact for ${mode}`,
          runMode: mode,
          status: unavailable ? "unavailable" : "planned",
          unavailableReason: unavailable ? availability.unavailableReason : null,
          clientRunnable: !unavailable,
          notes: [
            mode === "SMT_INTERVAL_TRUTH" || mode === "GREEN_BUTTON_TRUTH"
              ? "Uses One Path interval diagnostics owner for truth modes."
              : "Uses Manual GapFill compare/diagnostics layer for masked manual modes.",
          ],
        });
      }
    }
  }

  if (selectedModes.length > 0) {
    pushStep(steps, {
      kind: "aggregate_results_matrix",
      label: "Aggregate Results Matrix from completed run + compare outputs (Phase 3+)",
      status: "not_started",
      unavailableReason: "Phase 1 preview only — matrix not populated.",
      clientRunnable: false,
    });
  }

  if (args.flags.buildCohortSnapshot) {
    pushStep(steps, {
      kind: "cohort_snapshot",
      label: "Build cohort intelligence snapshot (analytics only, Phase 5+)",
      status: "not_started",
      unavailableReason: "Phase 1 placeholder — cohort analytics not executed.",
      clientRunnable: false,
      notes: ["Aggregate learning only; does not simulate customer results."],
    });
  }

  if (args.flags.updateTuningQueue) {
    pushStep(steps, {
      kind: "tuning_queue_update",
      label: "Update tuning queue recommendations (Phase 6+)",
      status: "not_started",
      unavailableReason: "Phase 1 placeholder — tuning queue persistence starts in Phase 6.",
      clientRunnable: false,
    });
  }

  if (args.flags.includeAiExportBundle) {
    pushStep(steps, {
      kind: "export_ai_bundle",
      label: "Export AI review bundle (Phase 4+)",
      status: "not_started",
      unavailableReason: "Phase 1 preview only — export bundle not generated until runs exist.",
      clientRunnable: false,
    });
  }

  const unavailableStepCount = steps.filter((step) => step.status === "unavailable").length;
  const selectedModeCount = selectedModes.length;

  return {
    previewVersion: "model_intelligence_sequence_preview_v1",
    generatedAt: new Date().toISOString(),
    phase: "phase_1_preview_only",
    executionEnabled: false,
    selectedRuns,
    flags: args.flags,
    modeAvailability,
    steps,
    summary: {
      plannedStepCount: steps.filter((step) => step.status === "planned").length,
      unavailableStepCount,
      selectedModeCount,
      compareDiagnosticsPlanned: args.flags.runCompareDiagnostics && selectedModeCount > 0,
      simulationWillRun: false,
    },
    guardrails: {
      onePathOnlySimulation: true,
      manualGapfillCompareOnlyDiagnostics: true,
      noParallelSimulator: true,
      noParallelDiagnosticsEngine: true,
      maskedRunsWriteToLabHomeOnly: true,
    },
  };
}

export function summarizeSelectedRunsForDisplay(selectedRuns: ModelIntelligenceSelectedRuns): string[] {
  return MODEL_INTELLIGENCE_RUN_MODES.filter((mode) => isRunModeSelected(selectedRuns, mode));
}
