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
    const truthSummarySource = readRepoFile("modules/usageSimulator/onePathTruthSummary.ts");

    expect(source).toContain("effectiveSimulationVariablesUsed");
    expect(source).toContain("sourceOfTruthSummary");
    expect(source).toContain("buildOnePathTruthSummary");
    expect(source).toContain("stageBoundaryMap");
    expect(source).toContain("sharedDerivedInputs");
    expect(source).toContain("sourceTruthIdentity");
    expect(source).toContain("constraintRebalance");
    expect(source).toContain("donorFallbackExclusions");
    expect(source).toContain("intradayReconstruction");
    expect(source).toContain("finalSharedOutputContract");
    expect(policySource).toContain("valueSource");
    expect(policySource).toContain("resolvedWeatherShapingMode");
    expect(policySource).toContain("resolvedRebalanceMode");
    expect(policySource).toContain("resolvedFallbackMode");
    expect(policySource).toContain("resolvedIntradayReconstructionControls");
    expect(policySource).toContain("resolvedCompareTuningThresholds");
    expect(truthSummarySource).toContain("resolveReportedCoverageWindow");
    expect(truthSummarySource).toContain("buildManualBillPeriodTargets");
    expect(truthSummarySource).toContain("annualModeTruth");
    expect(truthSummarySource).toContain("newBuildModeTruth");
  });
});
