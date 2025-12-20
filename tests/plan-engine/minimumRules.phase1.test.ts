import { describe, it, expect } from "vitest";

import { applyMinimumRulesToMonth, extractDeterministicMinimumRules } from "@/lib/plan-engine/minimumRules";
import { calculatePlanCostForUsage } from "@/lib/plan-engine/calculatePlanCostForUsage";

describe("minimumRules: extractDeterministicMinimumRules", () => {
  it("extracts MIN_USAGE_FEE from negative Minimum Usage Fee billCredits rule", () => {
    const rs: any = {
      billCredits: {
        hasBillCredit: true,
        rules: [
          {
            label: "Minimum Usage Fee $9.95 if usage < 1000 kWh",
            creditAmountCents: -995,
            minUsageKWh: 1000,
            maxUsageKWh: null,
          },
        ],
      },
    };

    const out = extractDeterministicMinimumRules({ rateStructure: rs });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.minimum.rules).toHaveLength(1);
      expect(out.minimum.rules[0]).toMatchObject({
        type: "MIN_USAGE_FEE",
        thresholdKwhExclusive: 1000,
        feeDollars: 9.95,
      });
    }
  });

  it("extracts MINIMUM_BILL from structured minimumBill fields when present", () => {
    const rs: any = { minimumBill: 50 };
    const out = extractDeterministicMinimumRules({ rateStructure: rs });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.minimum.rules).toEqual([{ type: "MINIMUM_BILL", minimumBillDollars: 50, label: "Minimum bill" }]);
    }
  });
});

describe("minimumRules: applyMinimumRulesToMonth", () => {
  it("applies MIN_USAGE_FEE only when usage is below threshold (exclusive)", () => {
    const minimum = {
      rules: [{ type: "MIN_USAGE_FEE" as const, thresholdKwhExclusive: 1000, feeDollars: 9.95, label: "fee" }],
      notes: [],
    };

    const below = applyMinimumRulesToMonth({ monthlyKwh: 999, minimum, subtotalCents: 10000 });
    expect(below.minUsageFeeCents).toBe(995);
    expect(below.totalCentsAfter).toBe(10995);

    const at = applyMinimumRulesToMonth({ monthlyKwh: 1000, minimum, subtotalCents: 10000 });
    expect(at.minUsageFeeCents).toBe(0);
    expect(at.totalCentsAfter).toBe(10000);
  });

  it("applies MINIMUM_BILL as a clamp after MIN_USAGE_FEE", () => {
    const minimum = {
      rules: [
        { type: "MIN_USAGE_FEE" as const, thresholdKwhExclusive: 1000, feeDollars: 10, label: "fee" },
        { type: "MINIMUM_BILL" as const, minimumBillDollars: 50, label: "min" },
      ],
      notes: [],
    };

    // subtotal 30.00, fee adds 10.00 => 40.00, clamp to 50.00 => top-up 10.00
    const out = applyMinimumRulesToMonth({ monthlyKwh: 500, minimum, subtotalCents: 3000 });
    expect(out.minUsageFeeCents).toBe(1000);
    expect(out.minimumBillTopUpCents).toBe(1000);
    expect(out.totalCentsAfter).toBe(5000);
  });
});

describe("calculatePlanCostForUsage: minimum rules bucket gating", () => {
  it("returns NOT_COMPUTABLE when minimum rules exist but usageBucketsByMonth is missing (fixed rate)", () => {
    const rs: any = {
      type: "FIXED",
      energyRateCents: 10,
      billCredits: {
        hasBillCredit: true,
        rules: [{ label: "Minimum Usage Fee $9.95 if usage < 1000 kWh", creditAmountCents: -995, minUsageKWh: 1000 }],
      },
    };

    const out = calculatePlanCostForUsage({
      annualKwh: 12000,
      monthsCount: 12,
      tdsp: { perKwhDeliveryChargeCents: 0, monthlyCustomerChargeDollars: 0 },
      rateStructure: rs,
    });

    expect(out.status).toBe("NOT_COMPUTABLE");
    expect(out.reason).toContain("MISSING_USAGE_BUCKETS");
  });
});

