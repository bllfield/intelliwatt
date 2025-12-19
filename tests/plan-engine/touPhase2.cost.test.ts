import { describe, it, expect } from "vitest";

import { calculatePlanCostForUsage } from "@/lib/plan-engine/calculatePlanCostForUsage";

describe("TOU Phase-2 (arbitrary windows) cost math", () => {
  it("computes TOU REP energy from window buckets and applies TDSP delivery on total", () => {
    const rateStructure = {
      timeOfUsePeriods: [
        { startHHMM: "0000", endHHMM: "1200", rateCentsPerKwh: 10 },
        { startHHMM: "1200", endHHMM: "2400", rateCentsPerKwh: 20 },
      ],
    };

    const usageBucketsByMonth = {
      "2025-01": {
        "kwh.m.all.total": 1000,
        "kwh.m.all.0000-1200": 400,
        "kwh.m.all.1200-2400": 600,
      },
    };

    const res = calculatePlanCostForUsage({
      annualKwh: 12000,
      monthsCount: 1,
      tdsp: { perKwhDeliveryChargeCents: 5, monthlyCustomerChargeDollars: 4 },
      rateStructure,
      usageBucketsByMonth,
    });

    expect(res.status).toBe("OK");
    // REP energy: 400*0.10 + 600*0.20 = 40 + 120 = 160
    // TDSP delivery: 1000 * 0.05 = 50
    // TDSP fixed: 4
    expect(res.annualCostDollars).toBeCloseTo(214, 6);
    expect(res.components?.energyOnlyDollars).toBeCloseTo(160, 6);
    expect(res.components?.deliveryDollars).toBeCloseTo(50, 6);
    expect(res.components?.baseFeesDollars).toBeCloseTo(4, 6);
  });

  it("fails closed when sum(period buckets) != total", () => {
    const rateStructure = {
      timeOfUsePeriods: [
        { startHHMM: "0000", endHHMM: "1200", rateCentsPerKwh: 10 },
        { startHHMM: "1200", endHHMM: "2400", rateCentsPerKwh: 20 },
      ],
    };

    const usageBucketsByMonth = {
      "2025-01": {
        "kwh.m.all.total": 1000,
        "kwh.m.all.0000-1200": 400,
        "kwh.m.all.1200-2400": 500, // sum=900, mismatch
      },
    };

    const res = calculatePlanCostForUsage({
      annualKwh: 12000,
      monthsCount: 1,
      tdsp: { perKwhDeliveryChargeCents: 5, monthlyCustomerChargeDollars: 0 },
      rateStructure,
      usageBucketsByMonth,
    });

    expect(res.status).toBe("NOT_COMPUTABLE");
    expect(res.reason).toMatch(/USAGE_BUCKET_SUM_MISMATCH/);
  });

  it("fails closed when a required window bucket is missing", () => {
    const rateStructure = {
      timeOfUsePeriods: [
        { startHHMM: "0000", endHHMM: "1200", rateCentsPerKwh: 10 },
        { startHHMM: "1200", endHHMM: "2400", rateCentsPerKwh: 20 },
      ],
    };

    const usageBucketsByMonth = {
      "2025-01": {
        "kwh.m.all.total": 1000,
        "kwh.m.all.0000-1200": 400,
        // missing 1200-2400
      },
    };

    const res = calculatePlanCostForUsage({
      annualKwh: 12000,
      monthsCount: 1,
      tdsp: { perKwhDeliveryChargeCents: 5, monthlyCustomerChargeDollars: 0 },
      rateStructure,
      usageBucketsByMonth,
    });

    expect(res.status).toBe("NOT_COMPUTABLE");
    expect(res.reason).toMatch(/MISSING_USAGE_BUCKETS/);
  });
});

