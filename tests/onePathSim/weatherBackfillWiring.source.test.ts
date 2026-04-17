import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

describe("one path weather backfill wiring", () => {
  it("uses the shared real-weather backfill owners instead of one-path no-op hooks", () => {
    const source = readRepoFile("modules/onePathSim/simulatedUsage/simulatePastUsageDataset.ts");
    const liveUsageRouteSource = readRepoFile("app/api/user/usage/route.ts");

    expect(source).toContain('from "@/modules/weather/backfill"');
    expect(source).toContain("ensureHouseWeatherBackfill");
    expect(source).toContain("ensureHouseWeatherNormalAvgBackfill");
    expect(source).not.toContain("ensureOnePathWeatherBackfillNoOp");
    expect(source).not.toContain("ensureOnePathWeatherNormalAvgBackfillNoOp");
    expect(liveUsageRouteSource).not.toContain("loadWeatherForPastWindow");
    expect(liveUsageRouteSource).not.toContain("simulatePastUsageDataset");
  });

  it("keeps the hard-stop scoped to trusted simulation outputs, not baseline passthrough reads", () => {
    const onePathSource = readRepoFile("modules/onePathSim/usageSimulator/service.ts");
    const weatherSource = readRepoFile("modules/onePathSim/weatherAvailability.ts");
    const liveUsageRouteSource = readRepoFile("app/api/user/usage/route.ts");

    expect(weatherSource).toContain("resolveOnePathWeatherGuardDecision");
    expect(onePathSource).toContain('scope: scenarioKey === "BASELINE" ? "baseline_passthrough_or_lookup" : "trusted_simulation_output"');
    expect(onePathSource).toContain("weatherTrustStatus");
    expect(onePathSource).toContain("weatherCoverageStatus");
    expect(liveUsageRouteSource).not.toContain("resolveOnePathWeatherGuardDecision");
    expect(liveUsageRouteSource).not.toContain("summarizeOnePathWeatherAvailability");
  });
});
