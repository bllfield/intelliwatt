import { describe, it, expect } from "vitest";

import { extractDeterministicTierSchedule, computeRepEnergyCostForMonthlyKwhTiered } from "@/lib/plan-engine/tieredPricing";
import { calculatePlanCostForUsage } from "@/lib/plan-engine/calculatePlanCostForUsage";

describe("tieredPricing: extractDeterministicTierSchedule", () => {
  it("extracts deterministic tiers from RateStructure.usageTiers (minKWh/maxKWh/centsPerKWh)", () => {
    const rs: any = {
      usageTiers: [
        { minKWh: 0, maxKWh: 500, centsPerKWh: 10 },
        { minKWh: 500, maxKWh: 1000, centsPerKWh: 12 },
        { minKWh: 1000, maxKWh: null, centsPerKWh: 15 },
      ],
    };

    const out = extractDeterministicTierSchedule(rs);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.schedule.tiers).toHaveLength(3);
      expect(out.schedule.tiers[0]).toEqual({ startKwhInclusive: 0, endKwhExclusive: 500, repEnergyCentsPerKwh: 10 });
      expect(out.schedule.tiers[2]).toEqual({ startKwhInclusive: 1000, endKwhExclusive: null, repEnergyCentsPerKwh: 15 });
    }
  });

  it("rejects TOU + usage tiers as UNSUPPORTED_COMBINED_STRUCTURES", () => {
    const rs: any = {
      timeOfUsePeriods: [{ label: "peak", startHour: 14, endHour: 20, daysOfWeek: [1, 2, 3, 4, 5], rateCentsPerKwh: 30 }],
      usageTiers: [{ minKWh: 0, maxKWh: null, centsPerKWh: 10 }],
    };
    const out = extractDeterministicTierSchedule(rs);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("UNSUPPORTED_COMBINED_STRUCTURES");
  });
});

describe("tieredPricing: computeRepEnergyCostForMonthlyKwhTiered", () => {
  it("computes tier breakdown for 1200 kWh", () => {
    const schedule = {
      tiers: [
        { startKwhInclusive: 0, endKwhExclusive: 500, repEnergyCentsPerKwh: 10 },
        { startKwhInclusive: 500, endKwhExclusive: 1000, repEnergyCentsPerKwh: 12 },
        { startKwhInclusive: 1000, endKwhExclusive: null, repEnergyCentsPerKwh: 15 },
      ],
      notes: [],
    };

    const res = computeRepEnergyCostForMonthlyKwhTiered({ monthlyKwh: 1200, schedule });
    expect(res.repEnergyCentsTotal).toBeCloseTo(14000, 8);
    expect(res.tierBreakdown.map((b) => b.kwh)).toEqual([500, 500, 200]);
  });
});

describe("calculatePlanCostForUsage: tiered pricing path", () => {
  it("returns NOT_COMPUTABLE when usageBucketsByMonth missing", () => {
    const rs: any = {
      usageTiers: [
        { minKWh: 0, maxKWh: 500, centsPerKWh: 10 },
        { minKWh: 500, maxKWh: 1000, centsPerKWh: 12 },
        { minKWh: 1000, maxKWh: null, centsPerKWh: 15 },
      ],
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

  it("returns OK when provided monthly totals (tiered REP + TDSP total-based)", () => {
    const rs: any = {
      usageTiers: [
        { minKWh: 0, maxKWh: 500, centsPerKWh: 10 },
        { minKWh: 500, maxKWh: 1000, centsPerKWh: 12 },
        { minKWh: 1000, maxKWh: null, centsPerKWh: 15 },
      ],
    };

    const usageBucketsByMonth: any = {};
    for (let m = 1; m <= 12; m++) {
      const ym = `2025-${String(m).padStart(2, "0")}`;
      usageBucketsByMonth[ym] = { "kwh.m.all.total": 1200 };
    }

    const out = calculatePlanCostForUsage({
      annualKwh: 14400,
      monthsCount: 12,
      tdsp: { perKwhDeliveryChargeCents: 0, monthlyCustomerChargeDollars: 0 },
      rateStructure: rs,
      usageBucketsByMonth,
    });

    expect(out.status).toBe("OK");
    // 1200 kWh => 14000¢ = $140 per month, 12 months => $1680 total.
    expect(out.annualCostDollars).toBeCloseTo(1680, 6);
  });
});

