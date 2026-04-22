import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

describe("one path manual monthly source isolation", () => {
  it("keeps manual weather sensitivity on the manual bill-period path", () => {
    const serviceSource = readRepoFile("modules/onePathSim/usageSimulator/service.ts");
    const adapterSource = readRepoFile("modules/onePathSim/onePathSim.ts");

    expect(serviceSource).toContain('mode !== "MANUAL_TOTALS"');
    expect(adapterSource).toContain('weatherScoringMode?: "interval" | "manual"');
    expect(adapterSource).toContain('actualDataset: args.weatherScoringMode === "manual" ? null : upstreamUsageTruth.dataset');
    expect(adapterSource).toContain('weatherScoringMode: "manual"');
  });
});
