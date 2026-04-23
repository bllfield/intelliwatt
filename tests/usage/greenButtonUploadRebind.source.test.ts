import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

describe("green button upload house rebinding", () => {
  it("rebinds duplicate raw uploads to the current house in both upload entrypoints", () => {
    const dropletSource = readRepoFile("scripts/droplet/green-button-upload-server.ts");
    const userRouteSource = readRepoFile("app/api/green-button/upload/route.ts");

    expect(dropletSource).toContain("findUnique({");
    expect(dropletSource).toContain("select: { id: true, homeId: true }");
    expect(dropletSource).toContain("await usagePrisma.rawGreenButton.update({");
    expect(dropletSource).toContain("homeId: house.id");
    expect(dropletSource).toContain("reboundFromHouseId");
    expect(dropletSource).toContain("homeId: previousRawHomeId, rawId: rawRecordId");

    expect(userRouteSource).toContain("findUnique({");
    expect(userRouteSource).toContain("select: { id: true, homeId: true }");
    expect(userRouteSource).toContain("await usagePrisma.rawGreenButton.update({");
    expect(userRouteSource).toContain("homeId: house.id");
    expect(userRouteSource).toContain("homeId: previousRawHomeId, rawId: rawRecord.id");
  });
});
