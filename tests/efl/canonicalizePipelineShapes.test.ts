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

  it("preserves solver-normalized bill credit segments over canonical plan-rules credits", () => {
    const res = canonicalizeRateStructureForPipeline({
      finalStatus: "PASS",
      planRules: {
        rateType: "FIXED",
        planType: "flat",
        defaultRateCentsPerKwh: 11.44,
        billCredits: [
          { type: "THRESHOLD_MIN", thresholdKwh: 1000, creditDollars: 35 },
          { type: "THRESHOLD_MIN", thresholdKwh: 2000, creditDollars: 15 },
        ],
      },
      rateStructure: {
        type: "FIXED",
        energyRateCents: 11.44,
        billCredits: {
          hasBillCredit: true,
          rules: [
            { label: "$35 >= 1000", creditAmountCents: 3500, minUsageKWh: 1000, maxUsageKWh: 2000 },
            { label: "$50 >= 2000", creditAmountCents: 5000, minUsageKWh: 2000 },
          ],
        },
      },
    });

    expect((res as any)?.billCredits?.rules).toEqual([
      { label: "$35 >= 1000", creditAmountCents: 3500, minUsageKWh: 1000, maxUsageKWh: 2000 },
      { label: "$50 >= 2000", creditAmountCents: 5000, minUsageKWh: 2000 },
    ]);
  });
});
