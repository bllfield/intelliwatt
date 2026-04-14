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
    expect(componentSource).toContain("Donor selection mode");
    expect(componentSource).toContain("Selected donor day(s)");
    expect(componentSource).toContain("Donor weights + variance guardrail");
    expect(componentSource).toContain("Thermal similarity + adjustment");
    expect(componentSource).toContain("Final selected shape path");
    expect(manualMonthlySource).toContain("GapFillDailyCurveCompare");
    expect(manualMonthlySource).toContain("buildDailyCurveCompareSummary");
    expect(source).toContain("showTestDayCurveCompare");
    expect(source).toContain("curveCompareActualIntervals15");
    expect(source).toContain('selectedTreatmentMode === "MANUAL_MONTHLY"');
  });

  it("adds manual-usage reconciliation compare panels without replacing exact-interval UI", () => {
    const source = readRepoFile("app/admin/tools/gapfill-lab/GapFillLabCanonicalClient.tsx");

    expect(source).toContain("Manual monthly parity / reconciliation");
    expect(source).toContain("Manual annual parity / reconciliation");
    expect(source).toContain("Manual Stage 1 contract");
    expect(source).toContain("UsageChartsPanel");
    expect(source).toContain("selectedTreatmentMode === \"MANUAL_ANNUAL\"");
    expect(source).toContain("Raw actual-source bill-period totals, manual Stage 1 bill-period targets, and manual Stage 2 simulated totals.");
    expect(source).toContain("Raw actual annual total, manual Stage 1 annual target, and manual Stage 2 simulated annual total.");
    expect(source).toContain("LockboxFlowPanel");
    expect(source).toContain("sharedDiagnostics={testSharedDiagnostics}");
  });

  it("shows the canonical manual Stage 1 UI for both monthly and annual manual modes", () => {
    const source = readRepoFile("app/admin/tools/gapfill-lab/GapFillLabCanonicalClient.tsx");

    expect(source).toContain('selectedTreatmentMode === "MANUAL_MONTHLY"');
    expect(source).toContain('selectedTreatmentMode === "MANUAL_ANNUAL"');
    expect(source).toContain("Canonical test-home bill-period / statement-total contract for this persisted run.");
    expect(source).toContain("manualStageOnePresentation?.mode === \"MONTHLY\"");
    expect(source).toContain("manualStageOnePresentation?.mode === \"ANNUAL\"");
  });

  it("keeps Actual House on the shared persisted Past Sim path while adding manual Stage 1 UI only for test-home manual modes", () => {
    const source = readRepoFile("app/admin/tools/gapfill-lab/GapFillLabCanonicalClient.tsx");

    expect(source).toContain("<h2 className=\"text-lg font-semibold text-brand-navy\">Actual House</h2>");
    expect(source).toContain("Source-house Past Sim results are not loaded yet. Run the source-home Past Sim action to load the Actual House chart.");
    expect(source).toContain("Actual House compare rows");
    expect(source).toContain("Manual Stage 1 contract");
    expect(source).not.toContain("Manual Stage 1 contract</div>\n            <div className=\"text-sm font-semibold text-brand-navy\">Actual House");
  });

  it("shows separate source, test-home, and effective travel-range visibility in GapFill", () => {
    const source = readRepoFile("app/admin/tools/gapfill-lab/GapFillLabCanonicalClient.tsx");

    expect(source).toContain("Travel range visibility");
    expect(source).toContain("Source Home");
    expect(source).toContain("Test Home saved");
    expect(source).toContain("Effective latest recalc");
    expect(source).toContain("The Effective latest recalc bucket reflects the exact travel ranges");
  });

  it("hydrates Actual House lockbox flow from shared diagnostics when attached", () => {
    const source = readRepoFile("app/admin/tools/gapfill-lab/GapFillLabCanonicalClient.tsx");

    expect(source).toContain("Actual House shared diagnostics");
    expect(source).toContain("actualSharedDiagnostics");
    expect(source).toContain("buildActualDiagnosticsHeaderReadout");
    expect(source).toContain("artifactEngineVersion");
    expect(source).toContain("Source house ID");
    expect(source).toContain("Profile house ID");
    expect(source).toContain("Same corrected Actual House Past Sim path");
  });

  it("renders shared weather sensitivity diagnostics from existing GapFill dataset metadata", () => {
    const source = readRepoFile("app/admin/tools/gapfill-lab/GapFillLabCanonicalClient.tsx");
    const compareSource = readRepoFile("components/admin/WeatherSensitivityComparePanel.tsx");

    expect(source).toContain("WeatherSensitivityAdminDiagnostics");
    expect(source).toContain("WeatherSensitivityComparePanel");
    expect(source).toContain("(actualHouseBaselineDataset as any)?.meta?.weatherSensitivityScore");
    expect(source).toContain("(actualHouseBaselineDataset as any)?.meta?.weatherEfficiencyDerivedInput");
    expect(source).toContain("(testHouseBaselineDataset as any)?.meta?.weatherSensitivityScore");
    expect(source).toContain("(testHouseBaselineDataset as any)?.meta?.weatherEfficiencyDerivedInput");
    expect(source).toContain("manualMonthlyWeatherCompare");
    expect(compareSource).toContain("Source Interval Weather");
    expect(compareSource).toContain("Manual-Monthly Weather");
    expect(compareSource).toContain("Tuning deltas");
    expect(source).toContain("sharedWeatherUnavailableMessage");
    expect(source).toContain("unavailableMessage={actualHouseWeatherUnavailableMessage}");
    expect(source).toContain("unavailableMessage={testHouseWeatherUnavailableMessage}");
    expect(source).not.toContain("/api/admin/tools/weather-sensitivity-lab");
    expect(source).not.toContain("resolveSharedWeatherSensitivityEnvelope");
  });

  it("adds the full tuning payload copy action through one shared shaper", () => {
    const source = readRepoFile("app/admin/tools/gapfill-lab/GapFillLabCanonicalClient.tsx");

    expect(source).toContain("Copy Full Tuning Payload");
    expect(source).toContain("buildGapfillFullTuningPayload");
    expect(source).toContain('from "@/modules/usageSimulator/tuningPayload"');
    expect(source).not.toContain("function buildFullTuningPayload");
    expect(source).not.toContain("const fullTuningPayload = {");
  });

  it("adds a single canonical orchestration action that reuses the existing shared GapFill steps", () => {
    const source = readRepoFile("app/admin/tools/gapfill-lab/GapFillLabCanonicalClient.tsx");

    expect(source).toContain("async function onRunCanonicalFlow()");
    expect(source).toContain('await runAction("lookup_source_houses")');
    expect(source).toContain('await runAction("replace_test_home_from_source")');
    expect(source).toContain('await runAction("save_test_home_inputs"');
    expect(source).toContain('const sourcePastSimResult = await runAction(');
    expect(source).toContain('"run_source_home_past_sim_snapshot"');
    expect(source).toContain("await onRunRecalc()");
    expect(source).toContain("Run Canonical Flow");
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
