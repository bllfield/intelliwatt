import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

describe("one path sim canonical variable snapshot source", () => {
  it("publishes effectiveSimulationVariablesUsed on the shared artifact and read model", () => {
    const source = readRepoFile("modules/usageSimulator/onePathSim.ts");
    const policySource = readRepoFile("modules/usageSimulator/simulationVariablePolicy.ts");

    expect(source).toContain("effectiveSimulationVariablesUsed");
    expect(policySource).toContain("valueSource");
    expect(policySource).toContain("resolvedWeatherShapingMode");
    expect(policySource).toContain("resolvedRebalanceMode");
    expect(policySource).toContain("resolvedFallbackMode");
    expect(policySource).toContain("resolvedIntradayReconstructionControls");
    expect(policySource).toContain("resolvedCompareTuningThresholds");
  });
});
