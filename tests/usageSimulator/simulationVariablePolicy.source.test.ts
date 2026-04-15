import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

describe("shared simulation variable policy source", () => {
  it("defines the expanded variable families with mode-aware override buckets", () => {
    const source = readRepoFile("modules/usageSimulator/simulationVariablePolicy.ts");

    expect(source).toContain("adapterCanonicalInput");
    expect(source).toContain("constraintRebalance");
    expect(source).toContain("donorFallbackExclusions");
    expect(source).toContain("intradayShapeReconstruction");
    expect(source).toContain("compareTuningMetrics");
    expect(source).toContain("sharedDefaults");
    expect(source).toContain("intervalOverrides");
    expect(source).toContain("manualMonthlyOverrides");
    expect(source).toContain("manualAnnualOverrides");
    expect(source).toContain("newBuildOverrides");
  });
});
