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
    const upstreamUsageSource = readRepoFile("modules/usageSimulator/upstreamUsageTruth.ts");
    const usageRouteSource = readRepoFile("app/api/user/usage/route.ts");
    const usagePageSource = readRepoFile("app/dashboard/usage/page.tsx");

    expect(source).toContain("effectiveSimulationVariablesUsed");
    expect(source).toContain("sourceOfTruthSummary");
    expect(source).toContain("buildOnePathTruthSummary");
    expect(source).toContain("resolveUpstreamUsageTruthForSimulation");
    expect(source).toContain("upstreamUsageTruth");
    expect(source).toContain("exactArtifactInputHash");
    expect(source).toContain("requireExactArtifactMatch");
    expect(source).toContain("result.canonicalArtifactInputHash");
    expect(source).not.toContain("getActualUsageDatasetForHouse(");
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
    expect(truthSummarySource).toContain("upstreamUsageTruth");
    expect(truthSummarySource).toContain("annualModeTruth");
    expect(truthSummarySource).toContain("newBuildModeTruth");
    expect(upstreamUsageSource).toContain("resolveIntervalsLayer");
    expect(upstreamUsageSource).toContain("requestUsageRefreshForUserHouse");
    expect(upstreamUsageSource).toContain("buildUpstreamUsageTruthSummary");
    expect(upstreamUsageSource).toContain("downstreamSimulationAllowed");
    expect(upstreamUsageSource).toContain("existing_persisted_truth");
    expect(upstreamUsageSource).toContain("seeded_via_existing_refresh");
    expect(upstreamUsageSource).toContain("missing_after_seed_attempt");
    expect(upstreamUsageSource).toContain("persisted_usage_output");
    expect(upstreamUsageSource).toContain("seeded_via_existing_usage_orchestration");
    expect(usageRouteSource).toContain("resolveIntervalsLayer");
    expect(usagePageSource).toContain("UsageDashboard");
    expect(usagePageSource).not.toContain("one-path-sim");
  });
});
