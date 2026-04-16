export type SimulatorMode = "MANUAL_TOTALS" | "NEW_BUILD_ESTIMATE" | "SMT_BASELINE";

export function shouldAutoPreparePastWorkspace(args: {
  mode: SimulatorMode;
  canRecalc: boolean;
  baselineReady: boolean;
  pastScenarioId?: string | null;
  pastBuildLastBuiltAt?: string | null;
}): "create" | "recalc" | "none" {
  if (args.mode !== "MANUAL_TOTALS") return "none";
  if (!args.canRecalc || !args.baselineReady) return "none";
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

