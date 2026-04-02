import { describe, expect, it } from "vitest";
import {
  shouldAutoPreparePastWorkspace,
  shouldRecalcPastWorkspaceWithoutEvents,
} from "@/modules/usageSimulator/manualWorkspaceAutoBuild";

describe("manual workspace auto build", () => {
  it("auto-creates a Past workspace for manual totals once baseline is ready", () => {
    expect(
      shouldAutoPreparePastWorkspace({
        mode: "MANUAL_TOTALS",
        canRecalc: true,
        baselineReady: true,
        pastScenarioId: null,
        pastBuildLastBuiltAt: null,
      })
    ).toBe("create");
  });

  it("auto-recalculates Past for manual totals when the workspace exists but has no build", () => {
    expect(
      shouldAutoPreparePastWorkspace({
        mode: "MANUAL_TOTALS",
        canRecalc: true,
        baselineReady: true,
        pastScenarioId: "past-1",
        pastBuildLastBuiltAt: null,
      })
    ).toBe("recalc");
  });

  it("does not auto-prepare Past for non-manual modes", () => {
    expect(
      shouldAutoPreparePastWorkspace({
        mode: "SMT_BASELINE",
        canRecalc: true,
        baselineReady: true,
        pastScenarioId: null,
        pastBuildLastBuiltAt: null,
      })
    ).toBe("none");
  });

  it("recalculates Past on manual-mode saves even with zero timeline events", () => {
    expect(
      shouldRecalcPastWorkspaceWithoutEvents({
        mode: "MANUAL_TOTALS",
        pastScenarioId: "past-1",
      })
    ).toBe(true);
    expect(
      shouldRecalcPastWorkspaceWithoutEvents({
        mode: "MANUAL_TOTALS",
        pastScenarioId: null,
      })
    ).toBe(false);
    expect(
      shouldRecalcPastWorkspaceWithoutEvents({
        mode: "NEW_BUILD_ESTIMATE",
        pastScenarioId: "past-1",
      })
    ).toBe(false);
  });
});
