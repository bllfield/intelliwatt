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

  it("adds the manual-gapfill admin page and dashboard navigation", () => {
    const pageSource = readRepoFile("app/admin/tools/manual-gapfill/page.tsx");
    const adminSource = readRepoFile("components/admin/ManualGapfillAdmin.tsx");
    const clientSource = readRepoFile("lib/admin/manualGapfillClient.ts");
    const adminPageSource = readRepoFile("app/admin/page.tsx");

    expect(pageSource).toContain("ManualGapfillAdmin");
    expect(adminPageSource).toContain("/admin/tools/manual-gapfill");
    expect(adminPageSource).toContain("Manual GapFill");
    expect(adminSource).toContain("manualGapfillClient");
    expect(clientSource).toContain("/api/admin/tools/manual-gapfill/source-context");
    expect(clientSource).toContain("/api/admin/tools/manual-gapfill/prepare-seed");
    expect(clientSource).toContain("/api/admin/tools/manual-gapfill/run-readback");
    expect(clientSource).toContain("/api/admin/tools/manual-gapfill/compare");
    expect(clientSource).toContain("/api/admin/tools/validation-day-policy");
  });

  it("wires MG-1 through MG-5 client helpers without new orchestration route", () => {
    const clientSource = readRepoFile("lib/admin/manualGapfillClient.ts");
    const adminSource = readRepoFile("components/admin/ManualGapfillAdmin.tsx");

    expect(clientSource).toContain("fetchManualGapfillSourceContext");
    expect(clientSource).toContain("fetchManualGapfillPrepareSeed");
    expect(clientSource).toContain("fetchManualGapfillRunReadback");
    expect(clientSource).toContain("fetchManualGapfillCompare");
    expect(adminSource).not.toContain("/api/admin/tools/manual-gapfill/run-all");
    expect(adminSource).toContain("Run pipeline");
  });

  it("uses required admin labeling and keeps legacy GapFill untouched", () => {
    const adminSource = readRepoFile("components/admin/ManualGapfillAdmin.tsx");
    const gapfillLabSource = readRepoFile("app/admin/tools/gapfill-lab/page.tsx");

    expect(adminSource).toContain("source actual usage");
    expect(adminSource).toContain("lab simulated usage");
    expect(adminSource).toContain("Dry run — Prepare seed");
    expect(adminSource).toContain("Persist seed to lab home");
    expect(adminSource).toContain("Run Past Sim on lab home");
    expect(adminSource).toContain("Compare source actual vs lab simulated");
    expect(adminSource).toContain("localGapFillSelectorUsed");
    expect(adminSource).toContain("GapFill Lab");
    expect(adminSource).toContain("EXACT_INTERVALS");
    expect(adminSource).not.toContain("WAPE");
    expect(gapfillLabSource).toContain("GapFillLabCanonicalClient");
  });

  it("defaults keeper email, house ids, and monthly mode", () => {
    const clientSource = readRepoFile("lib/admin/manualGapfillClient.ts");
    const adminSource = readRepoFile("components/admin/ManualGapfillAdmin.tsx");
    expect(clientSource).toContain("bllfield32@icloud.com");
    expect(clientSource).toContain("4da5d9d3-f139-4d3a-a602-3250d933c71c");
    expect(clientSource).toContain("29a3d820-2593-4673-9dd6-cd161bbd7f6f");
    expect(clientSource).toContain("MONTHLY_FROM_SOURCE_INTERVALS");
    expect(clientSource).toContain("fetchAdminUserByEmail");
    expect(adminSource).toContain("User email (source house owner)");
    expect(adminSource).toContain("MANUAL_GAPFILL_DEFAULT_USER_EMAIL");
  });

  it("marks stale downstream state when identity changes", () => {
    const adminSource = readRepoFile("components/admin/ManualGapfillAdmin.tsx");
    const stepSource = readRepoFile("components/admin/manual-gapfill/StepSection.tsx");
    expect(adminSource).toContain("buildManualGapfillIdentityKey");
    expect(stepSource).toContain("Stale — re-run after ID/mode change");
    expect(adminSource).toContain("downstream step results were cleared");
  });

  it("MF-UI-1 pipeline stops after dry-run seed without calling run-readback in admin source", () => {
    const adminSource = readRepoFile("components/admin/ManualGapfillAdmin.tsx");
    const clientSource = readRepoFile("lib/admin/manualGapfillClient.ts");

    expect(clientSource).toContain("MANUAL_GAPFILL_PIPELINE_STOP_AFTER_DRY_RUN_MESSAGE");
    expect(clientSource).toContain("canContinuePipelineAfterPrepareSeed");
    expect(adminSource).toContain("canContinuePipelineAfterPrepareSeed");
    expect(adminSource).toContain("MANUAL_GAPFILL_PIPELINE_STOP_AFTER_DRY_RUN_MESSAGE");
    expect(adminSource).toContain("persistedSeedInSession");
    expect(adminSource).not.toContain("GapFillLabCanonicalClient");
    expect(adminSource).not.toContain("gapfill-lab/route");
    expect(adminSource).not.toContain("compare_core");
    expect(adminSource).toContain("/admin/tools/gapfill-lab");
  });

  it("MF-UI-1 renders seed preview, bill match panel, and monthly compare table", () => {
    const adminSource = readRepoFile("components/admin/ManualGapfillAdmin.tsx");
    const seedPreviewSource = readRepoFile("components/admin/manual-gapfill/SeedPreview.tsx");
    const billMatchSource = readRepoFile("components/admin/manual-gapfill/BillMatchReconciliationPanel.tsx");
    const monthlyTableSource = readRepoFile("components/admin/manual-gapfill/MonthlyCompareRowsTable.tsx");

    expect(adminSource).toContain("SeedPreview");
    expect(adminSource).toContain("BillMatchReconciliationPanel");
    expect(adminSource).toContain("MonthlyCompareRowsTable");
    expect(seedPreviewSource).toContain("Resolved anchor:");
    expect(seedPreviewSource).toContain("Statement ranges generated from resolved anchor");
    expect(seedPreviewSource).toContain("monthlyTotalsKwhByMonth");
    expect(billMatchSource).toContain("Bill Match / Reconciliation");
    expect(billMatchSource).toContain("Step 5 Compare");
    expect(monthlyTableSource).toContain("Source actual kWh");
    expect(monthlyTableSource).toContain("Lab simulated kWh");
    expect(monthlyTableSource).toContain("Compare source actual vs lab simulated");
  });

  it("MF-UI-1 orientation note links EXACT_INTERVALS work to GapFill Lab", () => {
    const adminSource = readRepoFile("components/admin/ManualGapfillAdmin.tsx");
    expect(adminSource).toContain("One Path source actual truth");
    expect(adminSource).toContain("EXACT_INTERVALS");
    expect(adminSource).toContain("/admin/tools/gapfill-lab");
    expect(adminSource).toContain("Blank uses the source coverage/latest available Manual GapFill default");
  });
});
