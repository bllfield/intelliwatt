import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("one path compare read source esiid fallback", () => {
  it("falls back to persisted lockbox sourceEsiid for validation actual lookup", () => {
    const source = readFileSync(
      path.join(process.cwd(), "modules/onePathSim/usageSimulator/service.ts"),
      "utf8"
    );

    expect(source).toContain("const persistedSourceEsiid = String(");
    expect(source).toContain("args.dataset?.meta?.actualSourceEsiid ??");
    expect(source).toContain("lockboxInput?.sourceContext?.sourceEsiid");
    expect(source).toContain("lockboxPerRunTrace?.lockboxInput?.sourceContext?.sourceEsiid");
    expect(source).toContain("actualSourceEsiid = buildSourceEsiid");
  });
});
