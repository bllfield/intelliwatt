import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

describe("actual usage dataset weather backfill wiring", () => {
  it("backfills actual weather before reading daily weather rows for the user usage dataset", () => {
    const source = readRepoFile("lib/usage/actualDatasetForHouse.ts");

    expect(source).toContain('from "@/modules/weather/backfill"');
    expect(source).toContain("ensureHouseWeatherBackfill");
    expect(source).toContain("kind: \"ACTUAL_LAST_YEAR\"");
  });
});
