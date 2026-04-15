import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

describe("One Path Sim Admin harness wiring", () => {
  it("adds the admin harness page and tool navigation entry", () => {
    const pageSource = readRepoFile("app/admin/tools/one-path-sim/page.tsx");
    const toolsGridSource = readRepoFile("components/admin/AdminToolsGrid.tsx");
    const adminPageSource = readRepoFile("app/admin/page.tsx");

    expect(pageSource).toContain("OnePathSimAdmin");
    expect(toolsGridSource).toContain('/admin/tools/one-path-sim');
    expect(toolsGridSource).toContain("One Path Sim Admin");
    expect(adminPageSource).toContain('/admin/tools/one-path-sim');
  });

  it("keeps the harness thin and reuses shared editors", () => {
    const source = readRepoFile("components/admin/OnePathSimAdmin.tsx");
    const policySource = readRepoFile("modules/usageSimulator/simulationVariablePolicy.ts");

    expect(source).toContain("Home Details popup/editor");
    expect(source).toContain("Appliance Details popup/editor");
    expect(source).toContain("Travel/Vacant Dates popup/editor");
    expect(source).toContain("Manual Usage Entry popup/editor");
    expect(source).toContain("HomeDetailsClient");
    expect(source).toContain("AppliancesClient");
    expect(source).toContain("ManualUsageEntry");
    expect(source).toContain('fetch("/api/admin/tools/one-path-sim"');
    expect(source).toContain("render from the shared read model only");
    expect(source).toContain("VALIDATION_SELECTION_OPTIONS");
    expect(source).toContain('value: "random_simple"');
    expect(source).toContain('value: "customer_style_seasonal_mix"');
    expect(source).toContain('value: "stratified_weather_balanced"');
    expect(source).toContain('useState("stratified_weather_balanced")');
    expect(source).toContain("Validation mode popup");
    expect(source).toContain("VALIDATION_SELECTION_MODE_DETAILS");
    expect(source).toContain("Current admin adjustments");
    expect(source).toContain("Use this mode");
    expect(source).toContain("shared selector path");
    expect(source).toContain("<select");
    expect(source).toContain("sourceContext?.travelRangesFromDb");
    expect(source).toContain("Shared calculation variable popups");
    expect(source).toContain("openVariableFamily");
    expect(source).toContain("Copy all variables for AI");
    expect(source).toContain("Copy this family for AI");
    expect(source).toContain("readModel: (runResult?.readModel");
    expect(source).toContain("artifact: (runResult?.artifact");
    expect(source).toContain("Resolved value used by sim");
    expect(source).toContain("Adjust this value");
    expect(source).toContain("Raw code / JSON editor");
    expect(source).toContain("OVERRIDE field");
    expect(source).toContain('fetch("/api/admin/tools/one-path-sim/variables"');
    expect(source).toContain("Save shared override");
    expect(policySource).toContain("Adapter / Canonical Input");
    expect(policySource).toContain("Constraint / Rebalance");
    expect(policySource).toContain("Donor / Fallback / Exclusions");
    expect(policySource).toContain("Intraday Shape Reconstruction");
    expect(policySource).toContain("Compare / Tuning Metrics");
    expect(source).toContain("Effective Variables Used By Last Run");
    expect(source).toContain("runResult.readModel?.effectiveSimulationVariablesUsed");
    expect(source).toContain("explicit admin override");
    const presentationSource = readRepoFile("modules/usageSimulator/simulationVariablePresentation.ts");
    expect(presentationSource).toContain("curveShapingSummary");
    expect(presentationSource).toContain("Highest-priority shape-sensitive shared variables first");
  });
});
