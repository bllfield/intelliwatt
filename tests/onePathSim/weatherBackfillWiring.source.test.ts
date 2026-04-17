import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

describe("one path weather backfill wiring", () => {
  it("uses the shared real-weather backfill owners instead of one-path no-op hooks", () => {
    const source = readRepoFile("modules/onePathSim/usageSimulator/service.ts");

    expect(source).toContain('from "@/modules/weather/backfill"');
    expect(source).toContain("ensureHouseWeatherBackfill");
    expect(source).toContain("ensureHouseWeatherNormalAvgBackfill");
    expect(source).not.toContain("ensureOnePathWeatherBackfillNoOp");
    expect(source).not.toContain("ensureOnePathWeatherNormalAvgBackfillNoOp");
  });
});
