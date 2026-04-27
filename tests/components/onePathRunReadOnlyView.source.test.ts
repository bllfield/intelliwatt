import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

describe("OnePathRunReadOnlyView source contract", () => {
  it("mirrors the user Past page sections and shared component owners", () => {
    const source = readRepoFile("components/admin/OnePathRunReadOnlyView.tsx");
    const chartsSource = readRepoFile("components/usage/UsageChartsPanel.tsx");
    const compareSource = readRepoFile("components/usage/ValidationComparePanel.tsx");

    expect(source).toContain("useMemo(");
    expect(source).toContain("buildOnePathRunReadOnlyView({");
    expect(source).toContain("UsageChartsPanel");
    expect(source).toContain("WeatherSensitivityCard");
    expect(source).toContain("Past simulated usage");
    expect(source).toContain("Baseline usage");
    expect(source).toContain("persisted actual usage truth selected by the shared usage layer for baseline passthrough");
    expect(source).toContain("Household energy insights");
    expect(source).toContain("Data coverage:");
    expect(source).toContain("Simulation core:");
    expect(source).toContain("Scenario variables");
    expect(source).toContain("Travel/Vacant:");
    expect(source).toContain("Weather Efficiency Score");
    expect(source).toContain("Net usage");
    expect(source).toContain("Exported to grid");
    expect(source).toContain("Imported from grid");
    expect(source).toContain("Average daily");
    expect(source).toContain("Baseload (15-min)");
    expect(source).toContain("Baseload (daily)");
    expect(source).toContain("Baseload (monthly)");
    expect(source).toContain("Peak pattern");
    expect(source).toContain("weekdayKwh");
    expect(source).toContain("weekendKwh");
    expect(source).toContain("timeOfDayBuckets");
    expect(source).toContain("weatherBasisLabel");
    expect(source).toContain("dailyWeather");
    expect(source).toContain("fifteenCurve");
    expect(source).toContain("coverageStart");
    expect(source).toContain("coverageEnd");
    expect(chartsSource).toContain("Daily usage (all {daily.length} days)");
    expect(chartsSource).toContain("Source notation:");
    expect(chartsSource).toContain("Avg °F");
    expect(chartsSource).toContain("Min °F");
    expect(chartsSource).toContain("Max °F");
    expect(chartsSource).toContain("HDD65");
    expect(chartsSource).toContain("CDD65");
    expect(chartsSource).toContain("15-minute load curve");
    expect(chartsSource).toContain("Average kW by time of day");
    expect(source).toContain("ValidationComparePanel");
    expect(source).toContain("Validation / Test Day Compare");
    expect(source).toContain("scored validation day(s). Compare uses the same canonical simulated-day totals as the Past artifact; weather columns mirror the Past daily table when available.");
    expect(source).toContain("WAPE");
    expect(source).toContain("MAE");
    expect(source).toContain("RMSE");
    expect(source).toContain("Show details");
    expect(source).toContain("Hide details");
    expect(compareSource).toContain("Day Type");
    expect(compareSource).toContain("Actual kWh");
    expect(compareSource).toContain("Sim kWh");
    expect(compareSource).toContain("% Error");
    expect(compareSource).toContain("Weather columns use the same day-level values as the Past daily table when");
  });
});
