import { describe, it, expect } from "vitest";

import { applyBillCreditsToMonth, extractDeterministicBillCredits } from "@/lib/plan-engine/billCredits";
import { calculatePlanCostForUsage } from "@/lib/plan-engine/calculatePlanCostForUsage";

describe("billCredits: extractDeterministicBillCredits", () => {
  it("extracts a flat monthly credit when min=0 and no max", () => {
    const rs: any = {
      billCredits: {
        hasBillCredit: true,
        rules: [{ label: "Flat credit", creditAmountCents: 5000, minUsageKWh: 0 }],
      },
    };

    const out = extractDeterministicBillCredits(rs);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.credits.rules).toHaveLength(1);
      expect(out.credits.rules[0].type).toBe("FLAT_MONTHLY_CREDIT");
    }
  });

  it("extracts a usage range credit with min/max", () => {
    const rs: any = {
      billCredits: {
        hasBillCredit: true,
        rules: [{ label: "$100 at 1000-2000", creditAmountCents: 10000, minUsageKWh: 1000, maxUsageKWh: 2000 }],
      },
    };

    const out = extractDeterministicBillCredits(rs);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.credits.rules[0]).toMatchObject({
        type: "USAGE_RANGE_CREDIT",
        minKwhInclusive: 1000,
        maxKwhExclusive: 2000,
      });
    }
  });

  it("fails on overlapping usage ranges (ambiguous)", () => {
    const rs: any = {
      billCredits: {
        hasBillCredit: true,
        rules: [
          { label: "A", creditAmountCents: 5000, minUsageKWh: 0, maxUsageKWh: 2000 },
          { label: "B", creditAmountCents: 10000, minUsageKWh: 1000, maxUsageKWh: 3000 },
        ],
      },
    };
    const out = extractDeterministicBillCredits(rs);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("UNSUPPORTED_CREDIT_COMBINATION");
  });

  it("returns NO_CREDITS when only minimum usage fee (negative) rules exist", () => {
    const rs: any = {
      billCredits: {
        hasBillCredit: true,
        rules: [{ label: "Minimum Usage Fee $9.95 if usage < 1000 kWh", creditAmountCents: -995, minUsageKWh: 1000 }],
      },
    };
    const out = extractDeterministicBillCredits(rs);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("NO_CREDITS");
  });
});

describe("billCredits: applyBillCreditsToMonth", () => {
  it("applies range credit using max exclusive semantics", () => {
    const credits = {
      rules: [
        { type: "USAGE_RANGE_CREDIT" as const, creditDollars: 100, minKwhInclusive: 1000, maxKwhExclusive: 2000, label: "credit" },
      ],
      notes: [],
    };

    const at1999 = applyBillCreditsToMonth({ monthlyKwh: 1999, credits });
    expect(at1999.creditCentsTotal).toBe(-10000);

    const at2000 = applyBillCreditsToMonth({ monthlyKwh: 2000, credits });
    expect(at2000.creditCentsTotal).toBe(0);
  });
});

describe("calculatePlanCostForUsage: bill credits bucket gating", () => {
  it("returns NOT_COMPUTABLE when credits exist but usageBucketsByMonth missing (fixed rate)", () => {
    const rs: any = {
      type: "FIXED",
      energyRateCents: 10,
      billCredits: { hasBillCredit: true, rules: [{ label: "Flat credit", creditAmountCents: 1000, minUsageKWh: 0 }] },
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

