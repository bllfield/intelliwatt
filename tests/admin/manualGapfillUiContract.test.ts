import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

describe("Manual GapFill admin UI contract (MG-6)", () => {
  it("lists compare day policy in admin tools navigation", () => {
    const adminPageSource = readRepoFile("app/admin/page.tsx");
    const toolsGridSource = readRepoFile("components/admin/AdminToolsGrid.tsx");
    const policyPageSource = readRepoFile("app/admin/tools/validation-day-policy/page.tsx");

    expect(adminPageSource).toContain("/admin/tools/validation-day-policy");
    expect(adminPageSource).toContain("Compare Day Policy");
    expect(toolsGridSource).toContain("/admin/tools/validation-day-policy");
    expect(toolsGridSource).toContain("Compare Day Policy");
    expect(policyPageSource).toContain("ValidationDayPolicyAdmin");
  });

  it("adds the manual-gapfill debug page and demotes it below Manual GapFill Lab", () => {
    const pageSource = readRepoFile("app/admin/tools/manual-gapfill/page.tsx");
    const adminSource = readRepoFile("components/admin/ManualGapfillAdmin.tsx");
    const clientSource = readRepoFile("lib/admin/manualGapfillClient.ts");
    const adminPageSource = readRepoFile("app/admin/page.tsx");

    expect(pageSource).toContain("ManualGapfillAdmin");
    expect(adminPageSource).toContain("/admin/tools/manual-gapfill");
    expect(adminPageSource).toContain("Manual GapFill API Debug");
    expect(adminPageSource).toContain("Manual GapFill Lab");
    expect(adminSource).toContain("Manual GapFill API Debug");
    expect(adminSource).toContain("ManualGapfillLabWorkflow");
    expect(clientSource).toContain("/api/admin/tools/manual-gapfill/source-context");
    expect(clientSource).toContain("/api/admin/tools/manual-gapfill/prepare-seed");
    expect(clientSource).toContain("/api/admin/tools/manual-gapfill/run-readback");
    expect(clientSource).toContain("/api/admin/tools/manual-gapfill/compare");
    expect(clientSource).toContain("/api/admin/tools/validation-day-policy");
  });

  it("wires MG-1 through MG-5 client helpers without new orchestration route", () => {
    const clientSource = readRepoFile("lib/admin/manualGapfillClient.ts");
    const workflowSource = readRepoFile("components/admin/ManualGapfillLabWorkflow.tsx");

    expect(clientSource).toContain("fetchManualGapfillSourceContext");
    expect(clientSource).toContain("fetchManualGapfillPrepareSeed");
    expect(clientSource).toContain("fetchManualGapfillRunReadback");
    expect(clientSource).toContain("fetchManualGapfillCompare");
    expect(workflowSource).not.toContain("/api/admin/tools/manual-gapfill/run-all");
    expect(workflowSource).toContain("Run pipeline");
  });

  it("uses required admin labeling on debug page and primary Manual GapFill Lab client", () => {
    const adminSource = readRepoFile("components/admin/ManualGapfillAdmin.tsx");
    const workflowSource = readRepoFile("components/admin/ManualGapfillLabWorkflow.tsx");
    const gapfillLabSource = readRepoFile("app/admin/tools/gapfill-lab/GapFillLabCanonicalClient.tsx");

    expect(workflowSource).toContain("source actual usage");
    expect(workflowSource).toContain("lab simulated usage");
    expect(workflowSource).toContain("Dry run — Prepare seed");
    expect(workflowSource).toContain("Persist seed to lab home");
    expect(workflowSource).toContain("Run Past Sim on lab home");
    expect(workflowSource).toContain("Compare source actual vs lab simulated");
    expect(workflowSource).toContain("localGapFillSelectorUsed");
    expect(adminSource).toContain("/admin/tools/gapfill-lab");
    expect(gapfillLabSource).toContain("Manual GapFill Lab");
    expect(gapfillLabSource).toContain("Advanced Legacy GapFill");
    expect(workflowSource).toContain("Diagnostic WAPE (admin-only)");
    expect(workflowSource).toContain("Does not change production Simulation");
    expect(workflowSource).toContain("Accuracy or WAPE labels");
  });

  it("defaults keeper email, house ids, and monthly mode", () => {
    const clientSource = readRepoFile("lib/admin/manualGapfillClient.ts");
    const workflowSource = readRepoFile("components/admin/ManualGapfillLabWorkflow.tsx");
    expect(clientSource).toContain("bllfield32@icloud.com");
    expect(clientSource).toContain("4da5d9d3-f139-4d3a-a602-3250d933c71c");
    expect(clientSource).toContain("29a3d820-2593-4673-9dd6-cd161bbd7f6f");
    expect(clientSource).toContain("MONTHLY_FROM_SOURCE_INTERVALS");
    expect(clientSource).toContain("fetchAdminUserByEmail");
    expect(workflowSource).toContain("User email (source house owner)");
    expect(workflowSource).toContain("MANUAL_GAPFILL_DEFAULT_USER_EMAIL");
  });

  it("marks stale downstream state when identity changes", () => {
    const workflowSource = readRepoFile("components/admin/ManualGapfillLabWorkflow.tsx");
    const stepSource = readRepoFile("components/admin/manual-gapfill/StepSection.tsx");
    expect(workflowSource).toContain("buildManualGapfillIdentityKey");
    expect(stepSource).toContain("Stale — re-run after ID/mode change");
    expect(workflowSource).toContain("downstream step results were cleared");
  });

  it("MF-UI-1 pipeline stops after dry-run seed without calling run-readback in admin source", () => {
    const adminSource = readRepoFile("components/admin/ManualGapfillAdmin.tsx");
    const workflowSource = readRepoFile("components/admin/ManualGapfillLabWorkflow.tsx");
    const clientSource = readRepoFile("lib/admin/manualGapfillClient.ts");

    expect(clientSource).toContain("MANUAL_GAPFILL_PIPELINE_STOP_AFTER_DRY_RUN_MESSAGE");
    expect(clientSource).toContain("canContinuePipelineAfterPrepareSeed");
    expect(workflowSource).toContain("canContinuePipelineAfterPrepareSeed");
    expect(workflowSource).toContain("MANUAL_GAPFILL_PIPELINE_STOP_AFTER_DRY_RUN_MESSAGE");
    expect(workflowSource).toContain("persistedSeedInSession");
    expect(adminSource).not.toContain("GapFillLabCanonicalClient");
    expect(workflowSource).not.toContain("gapfill-lab/route");
    expect(workflowSource).not.toContain("buildGapfillCompareSimShared");
    expect(adminSource).toContain("/admin/tools/gapfill-lab");
  });

  it("MF-UI-1 renders seed preview, bill match panel, and monthly compare table", () => {
    const workflowSource = readRepoFile("components/admin/ManualGapfillLabWorkflow.tsx");
    const seedPreviewSource = readRepoFile("components/admin/manual-gapfill/SeedPreview.tsx");
    const billMatchSource = readRepoFile("components/admin/manual-gapfill/BillMatchReconciliationPanel.tsx");
    const monthlyTableSource = readRepoFile("components/admin/manual-gapfill/MonthlyCompareRowsTable.tsx");

    expect(workflowSource).toContain("SeedPreview");
    expect(workflowSource).toContain("BillMatchReconciliationPanel");
    expect(workflowSource).toContain("MonthlyCompareRowsTable");
    expect(seedPreviewSource).toContain("Resolved anchor:");
    expect(seedPreviewSource).toContain("Statement ranges generated from resolved anchor");
    expect(seedPreviewSource).toContain("monthlyTotalsKwhByMonth");
    expect(billMatchSource).toContain("Bill Match / Reconciliation");
    expect(billMatchSource).toContain("Step 5 Compare");
    expect(monthlyTableSource).toContain("Source actual kWh");
    expect(monthlyTableSource).toContain("Lab simulated kWh");
    expect(monthlyTableSource).toContain("Compare source actual vs lab simulated");
  });

  it("MF-UI-1 debug page links primary Manual GapFill Lab workflow", () => {
    const adminSource = readRepoFile("components/admin/ManualGapfillAdmin.tsx");
    const workflowSource = readRepoFile("components/admin/ManualGapfillLabWorkflow.tsx");
    expect(workflowSource).toContain("One Path SMT source truth");
    expect(adminSource).toContain("/admin/tools/gapfill-lab");
    expect(adminSource).toContain("Manual GapFill Lab");
    expect(workflowSource).toContain("Blank uses the source coverage/latest available Manual GapFill default");
  });
});
