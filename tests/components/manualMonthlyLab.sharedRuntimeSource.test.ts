import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("ManualMonthlyLab shared runtime payload wiring", () => {
  it("prefers artifact-backed read_result payload when deriving the active Stage 1 manual contract", () => {
    const source = readRepoFile("components/admin/ManualMonthlyLab.tsx");

    expect(source).toContain("displayedReadResult?.payload");
    expect(source).toContain("activePayload: displayedReadResult?.payload");
  });

  it("labels raw source payload as context only instead of presenting it as the active lab contract", () => {
    const source = readRepoFile("components/admin/ManualMonthlyLab.tsx");

    expect(source).toContain("Active lab payload and prefill context");
    expect(source).toContain("sourcePayloadContextOnly");
    expect(source).toContain("sourcePayloadContextUpdatedAt");
    expect(source).toContain("prefillSeed");
  });
});
