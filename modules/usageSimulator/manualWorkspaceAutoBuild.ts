export type SimulatorMode = "MANUAL_TOTALS" | "NEW_BUILD_ESTIMATE" | "SMT_BASELINE";

export function shouldAutoPreparePastWorkspace(args: {
  mode: SimulatorMode;
  canRecalc: boolean;
  baselineReady: boolean;
  /** When actual intervals are connected, baseline build may lag behind viewable usage. */
  workspacePrereqReady?: boolean;
  pastScenarioId?: string | null;
  pastBuildLastBuiltAt?: string | null;
}): "create" | "recalc" | "none" {
  if (args.mode !== "MANUAL_TOTALS") return "none";
  const workspaceReady = args.workspacePrereqReady ?? args.baselineReady;
  if (!args.canRecalc || !workspaceReady) return "none";
  if (!args.pastScenarioId) return "create";
  if (!args.pastBuildLastBuiltAt) return "recalc";
  return "none";
}

export function shouldRecalcPastWorkspaceWithoutEvents(args: {
  mode: SimulatorMode;
  pastScenarioId?: string | null;
}): boolean {
  return args.mode === "MANUAL_TOTALS" && Boolean(args.pastScenarioId);
}
