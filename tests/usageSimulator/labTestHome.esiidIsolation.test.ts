import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const labTestHomePaths = [
  "modules/usageSimulator/labTestHome.ts",
  "modules/onePathSim/usageSimulator/labTestHome.ts",
] as const;

describe("lab test home ESIID isolation", () => {
  it.each(labTestHomePaths)("%s keeps esiid null when copying source identity", (relativePath) => {
    const source = readFileSync(resolve(process.cwd(), relativePath), "utf8");
    const copyBlock = source.slice(
      source.indexOf("async function copySourceHouseIdentityToLabHome"),
      source.indexOf("export async function upsertLabTestHomeLink")
    );
    expect(copyBlock).toContain("esiid: null");
    expect(copyBlock).not.toMatch(/esiid:\s*args\.sourceHouse\.esiid/);
  });
});
