import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

describe("one path manual artifact payload wiring", () => {
  it("passes the effective engine-input manual payload into artifact readback decorations", () => {
    const source = readRepoFile("modules/onePathSim/onePathSim.ts");

    expect(source).toContain("manualUsagePayload:");
    expect(source).toContain("buildManualPayloadFromEngineInput(args.engineInput)");
  });
});
