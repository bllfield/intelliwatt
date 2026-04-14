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

    expect(source).toContain("Home Details popup/editor");
    expect(source).toContain("Appliance Details popup/editor");
    expect(source).toContain("Travel/Vacant Dates popup/editor");
    expect(source).toContain("Manual Usage Entry popup/editor");
    expect(source).toContain("HomeDetailsClient");
    expect(source).toContain("AppliancesClient");
    expect(source).toContain("ManualUsageEntry");
    expect(source).toContain('fetch("/api/admin/tools/one-path-sim"');
    expect(source).toContain("render from the shared read model only");
  });
});
