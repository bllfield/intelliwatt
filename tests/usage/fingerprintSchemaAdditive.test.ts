import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("usage schema Slice 8 additive invariants", () => {
  it("keeps a single PastSimulatedDatasetCache model (no second baseline cache family)", () => {
    const schemaPath = join(__dirname, "../../prisma/usage/schema.prisma");
    const raw = readFileSync(schemaPath, "utf8");
    const matches = raw.match(/^model PastSimulatedDatasetCache/gm);
    expect(matches?.length).toBe(1);
  });

  it("declares WholeHomeFingerprint and UsageFingerprint with Section 13 status enum", () => {
    const schemaPath = join(__dirname, "../../prisma/usage/schema.prisma");
    const raw = readFileSync(schemaPath, "utf8");
    expect(raw).toContain("model WholeHomeFingerprint");
    expect(raw).toContain("model UsageFingerprint");
    expect(raw).toContain("enum SimulatorFingerprintStatus");
    expect(raw).toContain("sourceHash");
    expect(raw).toContain("staleReason");
    expect(raw).toContain("builtAt");
  });
});
