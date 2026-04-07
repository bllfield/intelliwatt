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
    expect(source).toContain("Run canonical recalc first to unlock the persisted calculation-logic explanation");
  });

  it("shows separate source, test-home, and effective travel-range visibility in GapFill", () => {
    const source = readRepoFile("app/admin/tools/gapfill-lab/GapFillLabCanonicalClient.tsx");

    expect(source).toContain("Travel range visibility");
    expect(source).toContain("Source Home");
    expect(source).toContain("Test Home saved");
    expect(source).toContain("Effective latest recalc");
    expect(source).toContain("The Effective latest recalc bucket reflects the exact travel ranges");
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
