import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("ManualMonthlyLab shared runtime payload wiring", () => {
  it("prefers artifact-backed read_result payload when deriving the active Stage 1 manual contract", () => {
    const source = readRepoFile("components/admin/ManualMonthlyLab.tsx");

    expect(source).toContain("displayedReadResult?.payload");
    expect(source).toContain("activePayload: displayedReadResult?.payload");
  });

  it("labels raw source payload as context only instead of presenting it as the active lab contract", () => {
    const source = readRepoFile("components/admin/ManualMonthlyLab.tsx");

    expect(source).toContain("Active lab payload and prefill context");
    expect(source).toContain("sourcePayloadContextOnly");
    expect(source).toContain("sourcePayloadContextUpdatedAt");
    expect(source).toContain("prefillSeed");
  });

  it("lists the active lab date-source mode in the source and lab context section", () => {
    const source = readRepoFile("components/admin/ManualMonthlyLab.tsx");

    expect(source).toContain("Source vs lab-home target context");
    expect(source).toContain("activeLabDateSourceModeRunning");
    expect(source).toContain('(activeManualPayload.dateSourceMode ?? "AUTO_DATES")');
  });

  it("shows the active date source in the visible isolated lab home context card", () => {
    const source = readRepoFile("components/admin/ManualMonthlyLab.tsx");

    expect(source).toContain("Isolated lab home context");
    expect(source).toContain("Date source being run:");
    expect(source).toContain('{compactSummary(activeManualPayload?.mode === "MONTHLY" ? (activeManualPayload.dateSourceMode ?? "AUTO_DATES") : null)}');
  });

  it("opens the manual editor in a modal shell instead of only rendering inline", () => {
    const source = readRepoFile("components/admin/ManualMonthlyLab.tsx");

    expect(source).toContain('ModalShell title="Lab-home Manual Usage"');
    expect(source).toContain("{showManualEditor && labReady ? (");
    expect(source).toContain("Manual editor");
    expect(source).toContain("Use the `Manual editor` button above, next to `Appliances`, to open the popup");
  });

  it("does not immediately close the manual editor during transport load", () => {
    const source = readRepoFile("components/admin/ManualMonthlyLab.tsx");

    expect(source).toContain('setStatus("Manual payload loaded from the isolated lab home.")');
    expect(source).not.toContain('setShowManualEditor(false);\n        setStatus("Manual payload loaded from the isolated lab home.")');
  });

  it("supports customer, auto, and admin custom monthly date-source modes in the lab popup", () => {
    const source = readRepoFile("components/admin/ManualMonthlyLab.tsx");
    const editorSource = readRepoFile("components/manual/ManualUsageEntry.tsx");

    expect(source).toContain("Manual editor");
    expect(editorSource).toContain("CUSTOMER_DATES");
    expect(editorSource).toContain("AUTO_DATES");
    expect(editorSource).toContain("ADMIN_CUSTOM_DATES");
  });

  it("publishes Stage 1 from the canonical manual read model when artifact-backed totals are available", () => {
    const source = readRepoFile("components/admin/ManualMonthlyLab.tsx");

    expect(source).toContain("displayedReadResult?.manualReadModel");
    expect(source).toContain("buildManualStageOnePresentationFromReadModel");
    expect(source).not.toContain("return stageOnePreviewPayload;");
    expect(source).not.toContain("manualMonthlyStageOneRowsOverride={stageOnePreviewRows}");
    expect(source).toContain("Canonical shared manual Stage 1 contract");
    expect(source).toContain("Manual Stage 1 contract");
  });

  it("keeps the Manual Usage Stage 1 chart and table toggle interactive", () => {
    const source = readRepoFile("components/admin/ManualMonthlyLab.tsx");

    expect(source).toContain('const [stageOneMonthlyView, setStageOneMonthlyView] = useState<"chart" | "table">("chart")');
    expect(source).toContain("monthlyView={stageOneMonthlyView}");
    expect(source).toContain("onMonthlyViewChange={setStageOneMonthlyView}");
    expect(source).not.toContain('monthlyView="chart"\n                onMonthlyViewChange={() => undefined}');
  });

  it("keeps the stage labels aligned with the shared admin workflow wording", () => {
    const source = readRepoFile("components/admin/ManualMonthlyLab.tsx");

    expect(source).toContain("Manual Stage 1 contract");
    expect(source).toContain("Manual Stage 2 simulated result");
    expect(source).toContain("Manual monthly parity / reconciliation");
    expect(source).toContain("bill-period / statement-total semantics");
  });

  it("renders shared weather sensitivity diagnostics from the persisted manual lab dataset metadata", () => {
    const source = readRepoFile("components/admin/ManualMonthlyLab.tsx");

    expect(source).toContain("WeatherSensitivityAdminDiagnostics");
    expect(source).toContain("displayedReadResult?.dataset?.meta?.weatherSensitivityScore");
    expect(source).toContain("displayedReadResult?.dataset?.meta?.weatherEfficiencyDerivedInput");
    expect(source).toContain("manualLabWeatherUnavailableMessage");
    expect(source).toContain("unavailableMessage={manualLabWeatherUnavailableMessage}");
    expect(source).not.toContain("resolveSharedWeatherSensitivityEnvelope");
    expect(source).not.toContain("buildSharedWeatherSensitivityScore");
  });

  it("renders the shared daily curve compare from artifact-backed compare payloads", () => {
    const source = readRepoFile("components/admin/ManualMonthlyLab.tsx");

    expect(source).toContain("GapFillDailyCurveCompare");
    expect(source).toContain("buildDailyCurveCompareSummary");
    expect(source).toContain("displayedReadResult?.curveCompareActualIntervals15");
    expect(source).toContain("displayedReadResult?.curveCompareSimulatedIntervals15");
    expect(source).toContain("displayedReadResult?.curveCompareSimulatedDailyRows");
    expect(source).toContain("displayedReadResult?.compareProjection?.rows");
    expect(source).toContain("shouldShowManualCurveCompare");
    expect(source).toContain("rawReadStatus={manualCurveCompareReadStatus}");
  });
});
