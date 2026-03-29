import { describe, expect, it } from "vitest";
import { getMemoryRssMb } from "@/modules/usageSimulator/simObservability";

describe("sim measurement helpers (Slice 11)", () => {
  it("getMemoryRssMb returns finite non-negative RSS in MiB", () => {
    const m = getMemoryRssMb();
    expect(Number.isFinite(m)).toBe(true);
    expect(m).toBeGreaterThanOrEqual(0);
  });
});
