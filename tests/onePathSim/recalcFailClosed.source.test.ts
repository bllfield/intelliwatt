import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import path from "node:path";

describe("one path recalc fail-closed source guard", () => {
  it("returns the real Past producer failure instead of falling through to direct-build packaging", () => {
    const source = readFileSync(
      path.join(process.cwd(), "modules/onePathSim/usageSimulator/service.ts"),
      "utf8"
    );

    expect(source).toContain("const failClosedPastSharedProducer = isPastScenario && simMode === \"SMT_BASELINE\";");
    expect(source).toContain('"past_shared_producer_no_dataset"');
    expect(source).toContain('simMode === "MANUAL_TOTALS" || failClosedPastSharedProducer');
  });
});
