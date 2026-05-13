import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

describe("Green Button admin pipeline tool wiring", () => {
  it("is discoverable from admin tool cards", () => {
    const adminPageSource = readRepoFile("app/admin/page.tsx");
    const toolsGridSource = readRepoFile("components/admin/AdminToolsGrid.tsx");
    const pageSource = readRepoFile("app/admin/tools/green-button-pipeline/page.tsx");

    expect(adminPageSource).toContain("/admin/tools/green-button-pipeline");
    expect(toolsGridSource).toContain("/admin/tools/green-button-pipeline");
    expect(pageSource).toContain("GreenButtonPipelineClient");
  });

  it("reuses the shared usage pipeline and avoids home-scoped persistence", () => {
    const routeSource = readRepoFile("app/api/admin/tools/green-button-pipeline/route.ts");
    const clientSource = readRepoFile("app/admin/tools/green-button-pipeline/GreenButtonPipelineClient.tsx");
    const uploadRouteSource = readRepoFile("app/api/green-button/upload/route.ts");

    expect(routeSource).toContain("runGreenButtonUsagePipeline");
    expect(routeSource).toContain("dry_run_no_database_writes");
    expect(routeSource).not.toContain("greenButtonInterval.createMany");
    expect(routeSource).not.toContain("rawGreenButton.create");
    expect(routeSource).not.toContain("manualUsageUpload.create");
    expect(clientSource).toContain("No home email is required");
    expect(uploadRouteSource).toContain("runGreenButtonUsagePipeline");
  });
});
