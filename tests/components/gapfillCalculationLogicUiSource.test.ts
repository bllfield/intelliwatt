import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

describe("GapFill calculation logic UI wiring", () => {
  it("adds a Calculation Logic trigger to the GapFill client", () => {
    const source = readRepoFile("app/admin/tools/gapfill-lab/GapFillLabCanonicalClient.tsx");

    expect(source).toContain("GapFillCalculationLogicLauncher");
    expect(source).toContain("setOpenCalculationLogic(true)");
    expect(source).toContain("The calculation-logic popup explains the current GapFill mode");
  });

  it("defines the modal sections for the admin-only calculation logic view", () => {
    const source = readRepoFile("components/admin/GapFillCalculationLogicModal.tsx");

    expect(source).toContain("GapFill Calculation Logic");
    expect(source).toContain("Mode Overview");
    expect(source).toContain("Inputs / Variables Used");
    expect(source).toContain("Calculation Flow By Layer");
    expect(source).toContain("Priority / Weighting / Fallback Visuals");
    expect(source).toContain("Exclusions / Disqualifiers");
    expect(source).toContain("Main Tuning Levers");
    expect(source).toContain("Raw Diagnostics");
  });
});
