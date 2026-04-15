import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

describe("external simulation ownership sources", () => {
  it("keeps GapFill on shared run and read owners", () => {
    const source = readRepoFile("app/api/admin/tools/gapfill-lab/route.ts");

    expect(source).toContain("dispatchPastSimRecalc");
    expect(source).toContain("getSimulatedUsageForHouseScenario");
    expect(source).toContain("recalcSimulatorBuild");
  });

  it("keeps Manual Monthly Lab on shared recalc and manual readback owners", () => {
    const source = readRepoFile("app/api/admin/tools/manual-monthly/route.ts");

    expect(source).toContain("dispatchPastSimRecalc");
    expect(source).toContain("buildManualUsagePastSimReadResult");
    expect(source).not.toContain("simulatePastUsageDataset(");
  });

  it("keeps the user simulated-house route on shared artifact reads and shared weather enrichment", () => {
    const source = readRepoFile("app/api/user/usage/simulated/house/route.ts");

    expect(source).toContain("getSimulatedUsageForHouseScenario");
    expect(source).toContain("buildManualUsageReadDecorations");
    expect(source).toContain("resolveSharedWeatherSensitivityEnvelope");
  });

  it("keeps the user baseline usage route on shared weather scoring only, not past-sim recalc", () => {
    const source = readRepoFile("app/api/user/usage/route.ts");

    expect(source).toContain("resolveSharedWeatherSensitivityEnvelope");
    expect(source).not.toContain("recalcSimulatorBuild");
    expect(source).not.toContain("getSimulatedUsageForHouseScenario");
  });

  it("keeps the dedicated weather lab on the shared weather owner only", () => {
    const source = readRepoFile("app/api/admin/tools/weather-sensitivity-lab/route.ts");

    expect(source).toContain("resolveSharedWeatherSensitivityEnvelope");
    expect(source).not.toContain("recalcSimulatorBuild");
    expect(source).not.toContain("getSimulatedUsageForHouseScenario");
  });
});
