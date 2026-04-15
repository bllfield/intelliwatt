import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

describe("one path ownership audit source", () => {
  it("defines a shared ownership audit used by the page and AI copy payload", () => {
    const auditSource = readRepoFile("modules/usageSimulator/onePathOwnershipAudit.ts");
    const pageSource = readRepoFile("components/admin/OnePathSimAdmin.tsx");
    const copySource = readRepoFile("modules/usageSimulator/simulationVariablePresentation.ts");

    expect(auditSource).toContain("pageSurfaceAuditMatrix");
    expect(auditSource).toContain("aiCopyPayloadInventory");
    expect(auditSource).toContain("sharedWiringFlow");
    expect(auditSource).toContain("externalSurfaceClassification");
    expect(auditSource).toContain("driftRiskWatchlist");
    expect(auditSource).toContain("app/api/admin/tools/gapfill-lab/route.ts");
    expect(auditSource).toContain("app/api/user/usage/simulated/house/route.ts");
    expect(auditSource).toContain("app/api/admin/tools/weather-sensitivity-lab/route.ts");
    expect(pageSource).toContain("buildOnePathOwnershipAudit");
    expect(pageSource).toContain("One Path Hard Audit");
    expect(pageSource).toContain("One Path surface audit matrix");
    expect(pageSource).toContain("AI copy payload inventory");
    expect(pageSource).toContain("Shared wiring flow");
    expect(pageSource).toContain("External surface classification");
    expect(pageSource).toContain("Drift-risk watchlist");
    expect(pageSource).toContain("pre-cutover canonical simulation truth console");
    expect(pageSource).toContain("Older surfaces are not rerouted to this harness yet.");
    expect(auditSource).toContain("Pre-cutover harness status");
    expect(auditSource).toContain("Stage Boundary Map");
    expect(auditSource).toContain("Shared Derived Inputs Used By Run");
    expect(auditSource).toContain("Final Shared Output Contract");
    expect(copySource).toContain("ownershipAudit");
    expect(copySource).toContain("buildOnePathOwnershipAudit");
    expect(copySource).toContain("truthConsole");
  });

  it("reuses the shared travel-range helper in the gapfill source-home route", () => {
    const routeSource = readRepoFile("app/api/admin/tools/gapfill-lab/source-home-past-sim/route.ts");

    expect(routeSource).toContain('from "@/app/api/admin/tools/gapfill-lab/gapfillLabRouteHelpers"');
    expect(routeSource).not.toContain("async function getTravelRangesFromDb");
  });
});
