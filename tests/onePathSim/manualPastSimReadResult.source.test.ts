import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

describe("one path manual past sim read result source", () => {
  it("skips legacy read-time remap for canonical-stamped manual artifacts", () => {
    const source = readRepoFile("modules/onePathSim/manualPastSimReadResult.ts");

    expect(source).toContain("isCanonicalManualPastArtifact(displayDatasetRaw)");
    expect(source).toContain("resolveManualDisplayDatasetForRead");
    expect(source).not.toContain('projectionMode: "raw"');
    expect(source).not.toContain("loadManualUsageRawDisplayDataset(");
  });
});
