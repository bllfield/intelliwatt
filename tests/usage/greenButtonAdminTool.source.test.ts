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

  it("uses the Droplet upload ticket path and never posts the file through Vercel", () => {
    const clientSource = readRepoFile("app/admin/tools/green-button-pipeline/GreenButtonPipelineClient.tsx");
    const uploadRouteSource = readRepoFile("app/api/green-button/upload/route.ts");
    const ticketRouteSource = readRepoFile("app/api/admin/tools/one-path-sim/green-button/upload-ticket/route.ts");

    expect(clientSource).toContain("/api/admin/tools/one-path-sim/green-button/upload-ticket");
    expect(clientSource).toContain("ticket.uploadUrl");
    expect(clientSource).toContain('credentials: "omit"');
    expect(clientSource).not.toContain('/api/admin/tools/green-button-pipeline",');
    expect(clientSource).toContain("isolated One Path admin test home");
    expect(ticketRouteSource).toContain("resolveOnePathWriteTarget");
    expect(ticketRouteSource).toContain("testHomeHouseId");
    expect(uploadRouteSource).toContain("runGreenButtonUsagePipeline");
  });
});
