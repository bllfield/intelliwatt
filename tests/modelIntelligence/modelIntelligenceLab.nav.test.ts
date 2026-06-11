import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("model intelligence lab admin nav", () => {
  it("is linked from the admin dashboard and AdminToolsGrid", () => {
    const root = process.cwd();
    const adminPage = readFileSync(join(root, "app/admin/page.tsx"), "utf8");
    const toolsGrid = readFileSync(join(root, "components/admin/AdminToolsGrid.tsx"), "utf8");
    expect(adminPage).toContain("/admin/tools/model-intelligence-lab");
    expect(adminPage).toContain("Model Intelligence Lab");
    expect(toolsGrid).toContain("/admin/tools/model-intelligence-lab");
    expect(toolsGrid).toContain("Model Intelligence Lab");
  });
});
