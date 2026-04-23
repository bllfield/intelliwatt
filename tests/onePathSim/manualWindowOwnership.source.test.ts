import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

describe("one path manual past window ownership", () => {
  it("keeps manual non-baseline coverage on the bill-date window instead of rewriting to canonical coverage", () => {
    const source = readRepoFile("modules/onePathSim/usageSimulator/service.ts");

    expect(source).toContain("function resolveManualCoverageWindowFromBuildInputs");
    expect(source).toContain("args.mode === \"MANUAL_TOTALS\"");
    expect(source).toContain("manualCanonicalPeriods?: Array<{ startDate: string; endDate: string }> | undefined");
    expect(source).toContain("source: \"manual_bill_period_window\"");
    expect(source).toContain("manualCanonicalPeriods: simMode === \"MANUAL_TOTALS\" ? manualCanonicalPeriods : undefined");
    expect(source).toContain("const manualCoverage = resolveManualCoverageWindowFromBuildInputs(options?.buildInputs);");
  });
});
