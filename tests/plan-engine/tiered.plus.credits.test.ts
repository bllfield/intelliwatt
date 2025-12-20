import { describe, it, expect } from "vitest";

import { calculatePlanCostForUsage } from "@/lib/plan-engine/calculatePlanCostForUsage";

function makeUsageBucketsByMonth(values: number[]): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  // Produce a stable 12-month window ending 2025-12.
  for (let i = 0; i < values.length; i++) {
    const month = i + 1;
    const ym = `2025-${String(month).padStart(2, "0")}`;
    out[ym] = { "kwh.m.all.total": values[i]! };
  }
  return out;
}

describe("tiered + bill credits combo (Phase 1)", () => {
  it("applies deterministic credits on top of tiered energy (range credit max exclusive)", () => {
    const rs: any = {
      usageTiers: [
        { minKWh: 0, maxKWh: 500, centsPerKWh: 10 },
        { minKWh: 500, maxKWh: 1000, centsPerKWh: 12 },
        { minKWh: 1000, maxKWh: null, centsPerKWh: 15 },
      ],
      billCredits: {
        hasBillCredit: true,
        rules: [{ label: "$50 credit at 1000-2000", creditAmountCents: 5000, minUsageKWh: 1000, maxUsageKWh: 2000 }],
      },
    };

    // 11 months at 900 (no credit), 1 month at 1200 (credit applies).
    const monthly = Array.from({ length: 12 }, (_, idx) => (idx === 11 ? 1200 : 900));
    const usageBucketsByMonth = makeUsageBucketsByMonth(monthly);

    const out = calculatePlanCostForUsage({
      annualKwh: monthly.reduce((a, b) => a + b, 0),
      monthsCount: 12,
      tdsp: { perKwhDeliveryChargeCents: 0, monthlyCustomerChargeDollars: 0 },
      rateStructure: rs,
      usageBucketsByMonth,
    });

    expect(out.status).toBe("OK");
    if (out.status !== "OK") return;

    // Tiered monthly energy:
    // - 900 kWh => 500*10 + 400*12 = 9800 cents ($98.00)
    // - 1200 kWh => 500*10 + 500*12 + 200*15 = 14000 cents ($140.00)
    // Apply one $50 credit for the 1200 kWh month => -5000 cents.
    const expectedTotalCents = 11 * 9800 + (14000 - 5000);
    expect(out.annualCostDollars).toBeCloseTo(expectedTotalCents / 100, 6);
    // Ensure credits are reflected as negative dollars.
    expect(out.componentsV2?.creditsDollars).toBeCloseTo(-50, 6);
  });

  it("propagates UNSUPPORTED_CREDIT_DIMENSION when credits include monthsOfYear", () => {
    const rs: any = {
      usageTiers: [{ minKWh: 0, maxKWh: null, centsPerKWh: 10 }],
      billCredits: {
        hasBillCredit: true,
        rules: [{ label: "Seasonal credit", creditAmountCents: 1000, minUsageKWh: 0, maxUsageKWh: null, monthsOfYear: [6, 7] }],
      },
    };

    const usageBucketsByMonth = makeUsageBucketsByMonth(Array(12).fill(1000));
    const out = calculatePlanCostForUsage({
      annualKwh: 12000,
      monthsCount: 12,
      tdsp: { perKwhDeliveryChargeCents: 0, monthlyCustomerChargeDollars: 0 },
      rateStructure: rs,
      usageBucketsByMonth,
    });

    expect(out.status).toBe("NOT_COMPUTABLE");
    if (out.status === "NOT_COMPUTABLE") {
      expect(out.reason).toBe("UNSUPPORTED_CREDIT_DIMENSION");
    }
  });

  it("returns MISSING_USAGE_BUCKETS when tiered+credits exist but usageBucketsByMonth is missing", () => {
    const rs: any = {
      usageTiers: [{ minKWh: 0, maxKWh: null, centsPerKWh: 10 }],
      billCredits: { hasBillCredit: true, rules: [{ label: "Flat credit", creditAmountCents: 1000, minUsageKWh: 0 }] },
    };

    const out = calculatePlanCostForUsage({
      annualKwh: 12000,
      monthsCount: 12,
      tdsp: { perKwhDeliveryChargeCents: 0, monthlyCustomerChargeDollars: 0 },
      rateStructure: rs,
    });

    expect(out.status).toBe("NOT_COMPUTABLE");
    if (out.status === "NOT_COMPUTABLE") expect(out.reason).toContain("MISSING_USAGE_BUCKETS");
  });

  it("treats NO_CREDITS (e.g., only minimum-usage-fee negative rules) as tiered-only (no credits applied)", () => {
    const rs: any = {
      usageTiers: [{ minKWh: 0, maxKWh: null, centsPerKWh: 10 }],
      // This will be filtered out by billCredits extractor and handled by minimumRules instead.
      billCredits: { hasBillCredit: true, rules: [{ label: "Minimum Usage Fee $9.95 if usage < 1000 kWh", creditAmountCents: -995, minUsageKWh: 1000 }] },
    };

    const usageBucketsByMonth = makeUsageBucketsByMonth(Array(12).fill(1000));
    const out = calculatePlanCostForUsage({
      annualKwh: 12000,
      monthsCount: 12,
      tdsp: { perKwhDeliveryChargeCents: 0, monthlyCustomerChargeDollars: 0 },
      rateStructure: rs,
      usageBucketsByMonth,
    });

    expect(out.status).toBe("OK");
    if (out.status !== "OK") return;
    // No bill credits should be applied.
    expect(out.componentsV2?.creditsDollars).toBeUndefined();
  });
});

