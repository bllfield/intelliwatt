import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("shared compare read source esiid fallback", () => {
  it("rehydrates and reuses persisted sourceEsiid for validation actual lookup", () => {
    const source = readFileSync(
      path.join(process.cwd(), "modules/usageSimulator/service.ts"),
      "utf8"
    );

    expect(source).toContain("const buildSourceEsiid =");
    expect(source).toContain("actualSourceEsiid = buildSourceEsiid");
    expect(source).toContain("args.dataset?.meta?.actualSourceEsiid ??");
    expect(source).toContain("lockboxInput?.sourceContext?.sourceEsiid");
  });
});
