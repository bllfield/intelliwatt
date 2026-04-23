import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

describe("one path manual past sim read result source", () => {
  it("keeps manual display and reconciliation on the same projected dataset owner", () => {
    const source = readRepoFile("modules/onePathSim/manualPastSimReadResult.ts");

    expect(source).toContain("const displayDatasetRaw = out.dataset;");
    expect(source).not.toContain('projectionMode: "raw"');
    expect(source).not.toContain("loadManualUsageRawDisplayDataset(");
  });
});
