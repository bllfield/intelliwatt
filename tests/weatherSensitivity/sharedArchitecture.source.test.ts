import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("weather sensitivity shared architecture", () => {
  it("keeps one shared owner with only the two intended scoring paths", () => {
    const source = readRepoFile("modules/weatherSensitivity/shared.ts");

    expect(source).toContain('scoringMode: "INTERVAL_BASED" | "BILLING_PERIOD_BASED"');
    expect(source).toContain("function buildIntervalBasedScore");
    expect(source).toContain("function buildBillingPeriodBasedScore");
    expect(source).toContain("export function buildSharedWeatherSensitivityScore");
    expect(source).not.toContain("ESTIMATE_BASED");
    expect(source).not.toContain("PROFILE_BASED");
  });

  it("keeps scoring out of GapFill pages, admin routes, and the weather lab page", () => {
    const gapfillClient = readRepoFile("app/admin/tools/gapfill-lab/GapFillLabCanonicalClient.tsx");
    const gapfillRoute = readRepoFile("app/api/admin/tools/gapfill-lab/route.ts");
    const weatherLabRoute = readRepoFile("app/api/admin/tools/weather-sensitivity-lab/route.ts");
    const weatherLabView = readRepoFile("components/admin/WeatherSensitivityLabView.tsx");
    const manualLab = readRepoFile("components/admin/ManualMonthlyLab.tsx");

    for (const source of [gapfillClient, gapfillRoute, weatherLabRoute, weatherLabView, manualLab]) {
      expect(source).not.toContain("function buildIntervalBasedScore");
      expect(source).not.toContain("function buildBillingPeriodBasedScore");
      expect(source).not.toContain("function buildSharedWeatherSensitivityScore");
    }
  });

  it("routes both manual and interval simulations through one shared calculation consumer", () => {
    const pastDaySimulator = readRepoFile("modules/simulatedUsage/pastDaySimulator.ts");
    const simulatePastUsageDataset = readRepoFile("modules/simulatedUsage/simulatePastUsageDataset.ts");
    const gapfillClient = readRepoFile("app/admin/tools/gapfill-lab/GapFillLabCanonicalClient.tsx");

    expect(pastDaySimulator).toContain("applySharedWeatherEfficiencySimulation");
    expect(simulatePastUsageDataset).toContain("activateWeatherEfficiencyDerivedInputForSimulation");
    expect(gapfillClient).not.toContain("applySharedWeatherEfficiencySimulation");
    expect(gapfillClient).not.toContain("activateWeatherEfficiencyDerivedInputForSimulation");
  });
});
