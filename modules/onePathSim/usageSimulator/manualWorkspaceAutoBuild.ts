export type SimulatorMode = "MANUAL_TOTALS" | "NEW_BUILD_ESTIMATE" | "SMT_BASELINE";

function workspaceReady(args: {
  baselineReady: boolean;
  workspacePrereqReady?: boolean;
}): boolean {
  return args.workspacePrereqReady ?? args.baselineReady;
}

export function shouldAutoPreparePastWorkspace(args: {
  mode: SimulatorMode;
  canRecalc: boolean;
  baselineReady: boolean;
  /** When actual intervals are connected, baseline build may lag behind viewable usage. */
  workspacePrereqReady?: boolean;
  pastScenarioId?: string | null;
  pastBuildLastBuiltAt?: string | null;
}): "create" | "recalc" | "none" {
  const ready = workspaceReady(args);
  if (!args.canRecalc || !ready) return "none";

  if (args.mode === "MANUAL_TOTALS" || args.mode === "SMT_BASELINE") {
    if (!args.pastScenarioId) return "create";
    if (!args.pastBuildLastBuiltAt) return "recalc";
  }
  return "none";
}

export function shouldRecalcPastWorkspaceWithoutEvents(args: {
  mode: SimulatorMode;
  pastScenarioId?: string | null;
}): boolean {
  return (args.mode === "MANUAL_TOTALS" || args.mode === "SMT_BASELINE") && Boolean(args.pastScenarioId);
}
