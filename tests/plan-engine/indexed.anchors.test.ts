import { describe, it, expect } from "vitest";

import { chooseEffectiveCentsPerKwhFromAnchors, extractEflAveragePriceAnchors } from "@/lib/plan-engine/indexedPricing";
import { calculatePlanCostForUsage } from "@/lib/plan-engine/calculatePlanCostForUsage";

describe("indexedPricing: chooseEffectiveCentsPerKwhFromAnchors", () => {
  it("picks exact 1000 kWh anchor when annualKwh maps to 1000/month", () => {
    const res = chooseEffectiveCentsPerKwhFromAnchors({
      annualKwh: 12000,
      anchors: { centsPerKwhAt500: 20, centsPerKwhAt1000: 18, centsPerKwhAt2000: 16 },
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.centsPerKwh).toBeCloseTo(18, 8);
      expect(res.method).toBe("EXACT_1000");
    }
  });

  it("interpolates between 500 and 1000 anchors", () => {
    // 750/month => halfway between 500 and 1000
    const res = chooseEffectiveCentsPerKwhFromAnchors({
      annualKwh: 9000,
      anchors: { centsPerKwhAt500: 20, centsPerKwhAt1000: 10, centsPerKwhAt2000: null },
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.method).toBe("INTERP_500_1000");
      expect(res.centsPerKwh).toBeCloseTo(15, 8);
    }
  });

  it("fails when all anchors are missing", () => {
    const res = chooseEffectiveCentsPerKwhFromAnchors({
      annualKwh: 12000,
      anchors: { centsPerKwhAt500: null, centsPerKwhAt1000: null, centsPerKwhAt2000: null },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("MISSING_EFL_ANCHORS");
  });
});

describe("indexedPricing: extractEflAveragePriceAnchors", () => {
  it("reads anchors from __eflAvgPriceValidation.points", () => {
    const rs: any = {
      __eflAvgPriceValidation: {
        points: [
          { usageKwh: 500, modeledAvgCentsPerKwh: 21.1 },
          { usageKwh: 1000, modeledAvgCentsPerKwh: 19.9 },
          { usageKwh: 2000, modeledAvgCentsPerKwh: 18.2 },
        ],
      },
    };
    const a = extractEflAveragePriceAnchors(rs);
    expect(a.centsPerKwhAt500).toBeCloseTo(21.1, 6);
    expect(a.centsPerKwhAt1000).toBeCloseTo(19.9, 6);
    expect(a.centsPerKwhAt2000).toBeCloseTo(18.2, 6);
  });
});

describe("calculatePlanCostForUsage: indexed approx mode", () => {
  it("returns NOT_COMPUTABLE by default for VARIABLE/INDEXED", () => {
    const rs: any = {
      type: "VARIABLE",
      __eflAvgPriceValidation: {
        points: [{ usageKwh: 1000, modeledAvgCentsPerKwh: 20 }],
      },
    };

    const res = calculatePlanCostForUsage({
      annualKwh: 12000,
      monthsCount: 12,
      tdsp: { perKwhDeliveryChargeCents: 5, monthlyCustomerChargeDollars: 0 },
      rateStructure: rs,
    });

    expect(res.status).toBe("NOT_COMPUTABLE");
    expect(res.reason).toBe("NON_DETERMINISTIC_PRICING_INDEXED");
  });

  it("returns APPROXIMATE when estimateMode is enabled and anchors exist", () => {
    const rs: any = {
      type: "VARIABLE",
      __eflAvgPriceValidation: {
        points: [{ usageKwh: 1000, modeledAvgCentsPerKwh: 20 }],
      },
    };

    const res = calculatePlanCostForUsage({
      annualKwh: 12000,
      monthsCount: 12,
      tdsp: { perKwhDeliveryChargeCents: 5, monthlyCustomerChargeDollars: 0 },
      rateStructure: rs,
      estimateMode: "INDEXED_EFL_ANCHOR_APPROX",
    });

    expect(res.status).toBe("APPROXIMATE");
    expect(res.estimateMode).toBe("INDEXED_EFL_ANCHOR_APPROX");
    // REP energy = 12000 * $0.20 = 2400; TDSP delivery = 12000 * $0.05 = 600
    expect(res.annualCostDollars).toBeCloseTo(3000, 6);
  });
});

