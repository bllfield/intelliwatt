import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

describe("Manual GapFill admin UI contract (MG-6)", () => {
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
    expect(adminSource).toContain("legacy GapFill");
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
});
