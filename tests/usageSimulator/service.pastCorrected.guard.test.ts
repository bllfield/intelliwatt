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
});

