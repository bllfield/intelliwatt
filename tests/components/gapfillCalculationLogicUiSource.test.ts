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

  it("adds the admin-only Daily Curve Compare section to GapFill", () => {
    const source = readRepoFile("app/admin/tools/gapfill-lab/GapFillLabCanonicalClient.tsx");
    const componentSource = readRepoFile("components/admin/GapFillDailyCurveCompare.tsx");
    const manualMonthlySource = readRepoFile("components/admin/ManualMonthlyLab.tsx");

    expect(source).toContain("GapFillDailyCurveCompare");
    expect(source).toContain("buildDailyCurveCompareSummary");
    expect(componentSource).toContain("Daily Curve Compare");
    expect(componentSource).toContain("Raw Interval kWh Compare");
    expect(componentSource).toContain("Normalized Shape Compare");
    expect(componentSource).toContain("Per-day curve overlay");
    expect(componentSource).toContain("Representative-day overlays");
    expect(componentSource).toContain("Slot-level metrics");
    expect(componentSource).toContain("Hour-block bias summary");
    expect(componentSource).toContain("Why this day looks the way it does");
    expect(manualMonthlySource).not.toContain("Daily Curve Compare");
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
    expect(source).toContain("What Is Actual Vs What Is Simulated");
    expect(source).toContain("Inputs / Variables Used");
    expect(source).toContain("Daily Total Logic");
    expect(source).toContain("Interval Curve Logic");
    expect(source).toContain("How Weather Changes The Result");
    expect(source).toContain("active driver");
    expect(source).toContain("modeled-subset-only");
    expect(source).toContain("context only");
    expect(source).toContain("inactive");
    expect(source).toContain("Calculation Flow By Layer");
    expect(source).toContain("Influence / Priority Hierarchy");
    expect(source).toContain("Exclusions / Disqualifiers");
    expect(source).toContain("Main Tuning Levers");
    expect(source).toContain("Current Artifact Decision Summary");
    expect(source).toContain("What Changed The Result Most In This Run");
    expect(source).toContain("Fingerprint Curve Shape Summary");
    expect(source).toContain("Raw Diagnostics");
  });
});
