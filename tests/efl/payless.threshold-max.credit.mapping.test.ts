import { describe, expect, it } from "vitest";

import { planRulesToRateStructure } from "@/lib/efl/planEngine";

describe("PlanRules -> RateStructure mapping: THRESHOLD_MAX credits", () => {
  it("maps THRESHOLD_MAX (usage <= N) into a maxUsageKWh exclusive bound (N+1)", () => {
    const planRules: any = {
      planType: "flat",
      rateType: "FIXED",
      defaultRateCentsPerKwh: 11.4,
      baseChargePerMonthCents: 2190,
      timeOfUsePeriods: [],
      solarBuyback: null,
      billCredits: [
        {
          label: "Monthly credit $15 applies <= 500 kWh",
          creditDollars: 15,
          thresholdKwh: 500,
          monthsOfYear: null,
          type: "THRESHOLD_MAX",
        },
      ],
    };

    const rs: any = planRulesToRateStructure(planRules);
    expect(rs.type).toBe("FIXED");
    expect(rs.billCredits?.hasBillCredit).toBe(true);
    expect(Array.isArray(rs.billCredits?.rules)).toBe(true);
    expect(rs.billCredits.rules.length).toBe(1);

    const r = rs.billCredits.rules[0]!;
    expect(r.minUsageKWh).toBe(0);
    expect(r.maxUsageKWh).toBe(501);
    expect(r.creditAmountCents).toBe(1500);
  });
});

