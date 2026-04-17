import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

describe("upstream usage truth owner boundaries", () => {
  it("keeps the live shared upstream owner free of One Path wording", () => {
    const liveSource = readRepoFile("modules/usageSimulator/upstreamUsageTruth.ts");

    expect(liveSource).not.toContain("One Path only consumes persisted usage truth or requests the existing shared usage refresh path before running.");
    expect(liveSource).not.toContain("pre-cutover harness");
    expect(liveSource).toContain("live shared upstream-usage owner");
    expect(liveSource).toContain("modules/onePathSim/upstreamUsageTruth.ts");
  });

  it("keeps the live shared upstream behavior test framed as the live owner only", () => {
    const liveTestSource = readRepoFile("tests/usageSimulator/upstreamUsageTruth.test.ts");

    expect(liveTestSource).toContain('describe("live shared upstream usage truth owner"');
    expect(liveTestSource).not.toContain("One Path");
  });

  it("keeps the One Path owner explicitly fail-closed and separate from the live shared owner", () => {
    const onePathSource = readRepoFile("modules/onePathSim/upstreamUsageTruth.ts");
    const onePathSnapshotTestSource = readRepoFile("tests/usageSimulator/onePathSim.variableSnapshot.source.test.ts");

    expect(onePathSource).toContain("One Path quarantine mode does not trigger the live usage refresh owner directly.");
    expect(onePathSource).not.toContain("requestUsageRefreshForUserHouse");
    expect(onePathSnapshotTestSource).toContain("One Path quarantine mode does not trigger the live usage refresh owner directly.");
  });
});
