import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const routeLevelEflProcessors = [
  "app/api/admin/efl/manual-url/route.ts",
  "app/api/admin/efl/manual-upload/route.ts",
  "app/api/admin/efl/manual-text/route.ts",
  "app/api/admin/wattbuy/offers-batch-efl-parse/route.ts",
  "app/api/admin/efl-review/process-open/route.ts",
  "app/api/admin/efl-review/process-quarantine/route.ts",
  "app/api/admin/efl-review/process-open-current-plan/route.ts",
  "app/api/current-plan/efl-parse/route.ts",
  "app/api/dashboard/plans/prefetch/route.ts",
];

function readRoute(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function stripComments(source: string) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "");
}

describe("route-level EFL processing architecture", () => {
  it("uses runEflPipeline as the top-level orchestrator", () => {
    for (const route of routeLevelEflProcessors) {
      const source = readRoute(route);
      const activeSource = stripComments(source);

      expect(activeSource, route).toContain("runEflPipeline");
      expect(activeSource, route).not.toContain("runEflPipelineNoStore");
      expect(activeSource, route).not.toContain("runEflPipelineFromRawTextNoStore");
    }
  });
});
