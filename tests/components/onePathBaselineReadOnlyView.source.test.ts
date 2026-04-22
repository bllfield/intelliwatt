import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

describe("OnePathBaselineReadOnlyView source contract", () => {
  it("mirrors the shared user usage chart surfaces for interval baseline", () => {
    const source = readRepoFile("components/admin/OnePathBaselineReadOnlyView.tsx");
    const viewModelSource = readRepoFile("modules/onePathSim/baselineReadOnlyView.ts");

    expect(source).toContain("UsageChartsPanel");
    expect(source).toContain("WeatherSensitivityCard");
    expect(source).toContain("Household energy insights");
    expect(source).toContain("Data coverage:");
    expect(source).toContain("Source:");
    expect(source).toContain("weatherBasisLabel");
    expect(source).toContain("dailyWeather");
    expect(source).toContain("weekdayKwh");
    expect(source).toContain("weekendKwh");
    expect(source).toContain("timeOfDayBuckets");
    expect(source).toContain("fifteenCurve");
    expect(source).toContain("coverageStart");
    expect(source).toContain("coverageEnd");
    expect(viewModelSource).toContain("weatherBasisLabel");
    expect(viewModelSource).toContain("dailyWeather");
    expect(viewModelSource).toContain("stitchedMonth");
    expect(viewModelSource).toContain("avgDailyKwh");
    expect(viewModelSource).toContain("baseloadDaily");
    expect(viewModelSource).toContain("baseloadMonthly");
  });
});
