import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("validation selection coverage threshold", () => {
  it("requires full-day actual interval coverage for Past compare selection", () => {
    const root = process.cwd();
    const onePathSource = readFileSync(
      path.join(root, "modules/onePathSim/usageSimulator/service.ts"),
      "utf8"
    );
    const sharedSource = readFileSync(
      path.join(root, "modules/usageSimulator/service.ts"),
      "utf8"
    );

    expect(onePathSource).toContain("minDayCoveragePct: 1");
    expect(sharedSource).toContain("minDayCoveragePct: 1");
  });
});
