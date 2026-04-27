import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

describe("green button usable raw selection", () => {
  it("prefers the newest raw id owned by persisted interval rows", () => {
    const greenButtonSource = readRepoFile("modules/realUsageAdapter/greenButton.ts");
    const actualDatasetSource = readRepoFile("lib/usage/actualDatasetForHouse.ts");

    expect(greenButtonSource).toContain('FROM "GreenButtonInterval" i');
    expect(greenButtonSource).toContain('SELECT i."rawId" AS "id"');
    expect(greenButtonSource).toContain('WHERE i."homeId" = ${houseId}');
    expect(greenButtonSource).toContain('ORDER BY MAX(i."timestamp") DESC');
    expect(greenButtonSource).toContain('FROM "RawGreenButton" r');
    expect(greenButtonSource).toContain("export async function getLatestUsableRawGreenButtonIdForHouse");

    expect(actualDatasetSource).toContain("getLatestUsableRawGreenButtonIdForHouse");
    expect(actualDatasetSource).not.toContain('rawGreenButton.findFirst({ where: { homeId: houseId }, orderBy: { createdAt: "desc" }, select: { id: true } })');
  });
});
