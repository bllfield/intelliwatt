import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

describe("past corrected baseline guardrails", () => {
  it("does not mirror Past SMT scenarios from Baseline", () => {
    const servicePath = resolve(process.cwd(), "modules/usageSimulator/service.ts");
    const src = readFileSync(servicePath, "utf8");

    // Past (Corrected) must always use the stitched shared path, even with no Past events.
    expect(src).not.toContain("mirroredFromBaseline: true");
    expect(src).not.toContain("const baselineRes = await getSimulatedUsageForHouseScenario({");
  });

  it("keeps SMT baseline packaging on canonical coverage instead of raw anchor periods", () => {
    const servicePath = resolve(process.cwd(), "modules/usageSimulator/service.ts");
    const src = readFileSync(servicePath, "utf8");

    expect(src).toContain('simMode === "SMT_BASELINE"');
    expect(src).toContain('id: "canonical_usage_365_coverage"');
    expect(src).not.toContain(": smtAnchorPeriods ?? undefined,");
    expect(src).toContain('recalc_post_baseline_direct_builder_window');
  });

  it("routes one path baseline runs through the shared producer and artifact persistence gates", () => {
    const servicePath = resolve(process.cwd(), "modules/usageSimulator/service.ts");
    const src = readFileSync(servicePath, "utf8");

    expect(src).toContain('const isOnePathSimAdminRun = args.runContext?.callerLabel === "one_path_sim_admin";');
    expect(src).toContain('(scenario?.name === WORKSPACE_PAST_NAME || isOnePathSimAdminRun)');
    expect(src).toContain('simMode === "SMT_BASELINE" && (scenario?.name === WORKSPACE_PAST_NAME || isOnePathSimAdminRun)');
    expect(src).toContain('const shouldPersistCanonicalPastArtifact =');
    expect(src).toContain('const shouldPersistPastSeries =');
  });
});

