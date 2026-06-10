import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

describe("Manual GapFill Lab retarget (ML-1–ML-4)", () => {
  it("loads GapFill Lab as Manual GapFill Lab primary surface", () => {
    const pageSource = readRepoFile("app/admin/tools/gapfill-lab/page.tsx");
    const clientSource = readRepoFile("app/admin/tools/gapfill-lab/GapFillLabCanonicalClient.tsx");
    expect(pageSource).toContain("GapFillLabCanonicalClient");
    expect(clientSource).toContain("Manual GapFill Lab");
    expect(clientSource).toContain("ManualGapfillLabWorkflow");
  });

  it("defaults manual monthly/annual modes and hides legacy EXACT_INTERVALS behind advanced section", () => {
    const clientSource = readRepoFile("app/admin/tools/gapfill-lab/GapFillLabCanonicalClient.tsx");
    expect(clientSource).toContain('useState<ManualGapfillSeedMode>("MONTHLY_FROM_SOURCE_INTERVALS")');
    expect(clientSource).toContain("showLegacyAdvanced");
    expect(clientSource).toContain("Advanced Legacy GapFill");
    expect(clientSource).toContain("EXACT_INTERVALS");
  });

  it("wires manual workflow to MG routes only, not legacy gapfill-lab recalc or compare_core", () => {
    const workflowSource = readRepoFile("components/admin/ManualGapfillLabWorkflow.tsx");
    const clientSource = readRepoFile("app/admin/tools/gapfill-lab/GapFillLabCanonicalClient.tsx");
    expect(workflowSource).toContain("fetchManualGapfillSourceContext");
    expect(workflowSource).toContain("fetchValidationDayPolicyPreview");
    expect(workflowSource).toContain("fetchManualGapfillPrepareSeed");
    expect(workflowSource).toContain("fetchManualGapfillRunReadback");
    expect(workflowSource).toContain("fetchManualGapfillCompare");
    expect(workflowSource).not.toContain("buildGapfillCompareSimShared");
    expect(workflowSource).not.toContain("run_test_home_canonical_recalc");
    expect(workflowSource).toContain("localGapFillSelectorUsed");
    expect(workflowSource).toContain("ValidationDayCompareScoringPanel");
    expect(clientSource).toContain("No legacy gapfill-lab recalc or compare_core on this path");
  });

  it("demotes separate manual-gapfill page to API debug in nav", () => {
    const adminPageSource = readRepoFile("app/admin/page.tsx");
    const gridSource = readRepoFile("components/admin/AdminToolsGrid.tsx");
    const debugAdminSource = readRepoFile("components/admin/ManualGapfillAdmin.tsx");
    expect(adminPageSource).toContain("Manual GapFill Lab");
    expect(adminPageSource).toContain("Manual GapFill API Debug");
    expect(gridSource).toContain("Manual GapFill Lab");
    expect(gridSource).toContain("Manual GapFill API Debug");
    expect(debugAdminSource).toContain("Manual GapFill API Debug");
    expect(debugAdminSource).toContain("ManualGapfillLabWorkflow");
  });

  it("requires SMT source actual kind for manual lab workflow", () => {
    const workflowSource = readRepoFile("components/admin/ManualGapfillLabWorkflow.tsx");
    expect(workflowSource).toContain('sourceActualKind !== "SMT"');
    expect(workflowSource).toContain("Manual GapFill Lab requires SMT source actual usage");
  });

  it("preserves legacy gapfill-lab route code path inside advanced section only", () => {
    const clientSource = readRepoFile("app/admin/tools/gapfill-lab/GapFillLabCanonicalClient.tsx");
    expect(clientSource).toContain("run_test_home_canonical_recalc");
    expect(clientSource).toContain("showLegacyAdvanced ?");
  });
});
