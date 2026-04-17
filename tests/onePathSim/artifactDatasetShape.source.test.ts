import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

describe("one path artifact dataset shape", () => {
  it("preserves the rich simulated dataset fields needed by the shared Past UI", () => {
    const source = readRepoFile("modules/onePathSim/onePathSim.ts");

    expect(source).toContain("dailyWeather:");
    expect(source).toContain("insights:");
    expect(source).toContain("totals:");
    expect(source).toContain("hourly:");
    expect(source).toContain("daily:");
    expect(source).toContain("monthly:");
    expect(source).toContain("annual:");
  });
});
