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
});
