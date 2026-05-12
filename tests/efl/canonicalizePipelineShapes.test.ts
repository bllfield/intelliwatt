import { describe, expect, it } from "vitest";

import { canonicalizeRateStructureForPipeline } from "@/lib/efl/canonicalizePipelineShapes";

describe("canonicalizeRateStructureForPipeline", () => {
  it("fills canonical fixed-rate fields from plan rules for non-fail results", () => {
    const res = canonicalizeRateStructureForPipeline({
      finalStatus: "SKIP",
      planRules: {
        rateType: "FIXED",
        planType: "flat",
        defaultRateCentsPerKwh: 22.99,
        baseChargePerMonthCents: 0,
      },
      rateStructure: {
        type: "FIXED",
        baseMonthlyFeeCents: 0,
      },
    });

    expect(res).toMatchObject({
      type: "FIXED",
      energyRateCents: 22.99,
      baseMonthlyFeeCents: 0,
    });
  });

  it("does not override fail results", () => {
    const original = {
      type: "FIXED",
      baseMonthlyFeeCents: 0,
    };

    const res = canonicalizeRateStructureForPipeline({
      finalStatus: "FAIL",
      planRules: {
        rateType: "FIXED",
        defaultRateCentsPerKwh: 22.99,
      },
      rateStructure: original,
    });

    expect(res).toBe(original);
  });
});
