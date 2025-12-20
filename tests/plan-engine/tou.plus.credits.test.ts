import { describe, it, expect } from "vitest";

import { calculatePlanCostForUsage } from "@/lib/plan-engine/calculatePlanCostForUsage";

function makeTouBucketsByMonth(values: number[]): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (let i = 0; i < values.length; i++) {
    const month = i + 1;
    const ym = `2025-${String(month).padStart(2, "0")}`;
    const total = values[i]!;
    out[ym] = {
      "kwh.m.all.total": total,
      "kwh.m.all.0000-1200": total / 2,
      "kwh.m.all.1200-2400": total / 2,
    };
  }
  return out;
}

describe("TOU + bill credits combo (Phase 1)", () => {
  it("applies deterministic credits after TOU REP energy + TDSP (range credit max exclusive)", () => {
    const rs: any = {
      timeOfUsePeriods: [
        { label: "A", startHHMM: "0000", endHHMM: "1200", rateCentsPerKwh: 10 },
        { label: "B", startHHMM: "1200", endHHMM: "2400", rateCentsPerKwh: 10 },
      ],
      billCredits: {
        hasBillCredit: true,
        rules: [{ label: "$50 credit at 1000-2000", creditAmountCents: 5000, minUsageKWh: 1000, maxUsageKWh: 2000 }],
      },
    };

    // 11 months at 900 (no credit), 1 month at 1200 (credit applies).
    const monthly = Array.from({ length: 12 }, (_, idx) => (idx === 11 ? 1200 : 900));
    const usageBucketsByMonth = makeTouBucketsByMonth(monthly);

    const out = calculatePlanCostForUsage({
      annualKwh: monthly.reduce((a, b) => a + b, 0),
      monthsCount: 12,
      tdsp: { perKwhDeliveryChargeCents: 0, monthlyCustomerChargeDollars: 0 },
      rateStructure: rs,
      usageBucketsByMonth,
    });

    expect(out.status).toBe("OK");
    if (out.status !== "OK") return;

    // Month costs:
    // - 900 kWh @ 10¢ => 9000 cents
    // - 1200 kWh @ 10¢ => 12000 cents, then -5000 credit => 7000 cents
    const expectedTotalCents = 11 * 9000 + 7000;
    expect(out.annualCostDollars).toBeCloseTo(expectedTotalCents / 100, 6);
    expect(out.componentsV2?.creditsDollars).toBeCloseTo(-50, 6);
  });

  it("propagates UNSUPPORTED_CREDIT_DIMENSION when credits include monthsOfYear", () => {
    const rs: any = {
      timeOfUsePeriods: [
        { label: "A", startHHMM: "0000", endHHMM: "1200", rateCentsPerKwh: 10 },
        { label: "B", startHHMM: "1200", endHHMM: "2400", rateCentsPerKwh: 10 },
      ],
      billCredits: {
        hasBillCredit: true,
        rules: [{ label: "Seasonal credit", creditAmountCents: 1000, minUsageKWh: 0, maxUsageKWh: null, monthsOfYear: [6, 7] }],
      },
    };

    const out = calculatePlanCostForUsage({
      annualKwh: 12000,
      monthsCount: 12,
      tdsp: { perKwhDeliveryChargeCents: 0, monthlyCustomerChargeDollars: 0 },
      rateStructure: rs,
      usageBucketsByMonth: makeTouBucketsByMonth(Array(12).fill(1000)),
    });

    expect(out.status).toBe("NOT_COMPUTABLE");
    if (out.status === "NOT_COMPUTABLE") expect(out.reason).toBe("UNSUPPORTED_CREDIT_DIMENSION");
  });

  it("returns MISSING_USAGE_BUCKETS when a required TOU window bucket is missing", () => {
    const rs: any = {
      timeOfUsePeriods: [
        { label: "A", startHHMM: "0000", endHHMM: "1200", rateCentsPerKwh: 10 },
        { label: "B", startHHMM: "1200", endHHMM: "2400", rateCentsPerKwh: 10 },
      ],
      billCredits: {
        hasBillCredit: true,
        rules: [{ label: "Flat credit", creditAmountCents: 1000, minUsageKWh: 0 }],
      },
    };

    const usageBucketsByMonth = makeTouBucketsByMonth(Array(12).fill(1000));
    delete (usageBucketsByMonth["2025-12"] as any)["kwh.m.all.1200-2400"];

    const out = calculatePlanCostForUsage({
      annualKwh: 12000,
      monthsCount: 12,
      tdsp: { perKwhDeliveryChargeCents: 0, monthlyCustomerChargeDollars: 0 },
      rateStructure: rs,
      usageBucketsByMonth,
    });

    expect(out.status).toBe("NOT_COMPUTABLE");
    if (out.status === "NOT_COMPUTABLE") expect(out.reason).toContain("MISSING_USAGE_BUCKETS");
  });

  it("treats NO_CREDITS (min-usage-fee-only negative rules) as TOU-only (no credits applied)", () => {
    const rs: any = {
      timeOfUsePeriods: [
        { label: "A", startHHMM: "0000", endHHMM: "1200", rateCentsPerKwh: 10 },
        { label: "B", startHHMM: "1200", endHHMM: "2400", rateCentsPerKwh: 10 },
      ],
      billCredits: {
        hasBillCredit: true,
        rules: [{ label: "Minimum Usage Fee $9.95 if usage < 1000 kWh", creditAmountCents: -995, minUsageKWh: 1000 }],
      },
    };

    const usageBucketsByMonth = makeTouBucketsByMonth(Array(12).fill(1000));
    const out = calculatePlanCostForUsage({
      annualKwh: 12000,
      monthsCount: 12,
      tdsp: { perKwhDeliveryChargeCents: 0, monthlyCustomerChargeDollars: 0 },
      rateStructure: rs,
      usageBucketsByMonth,
    });

    expect(out.status).toBe("OK");
    if (out.status !== "OK") return;
    expect(out.componentsV2?.creditsDollars).toBeUndefined();
  });
});

