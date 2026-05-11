import { describe, expect, test } from "vitest";

import { scoreEflPassStrength } from "@/lib/efl/eflValidator";

describe("eflValidator - PASS strength scoring", () => {
  test("does not flag OFFPOINT_DEVIATION for threshold-max credit plans (discontinuous curve at threshold)", async () => {
    // Payless Power prepaid example:
    // - Daily charge converted to monthly in solver output
    // - Bill credit applies only when usage <= 500 kWh
    const planRules = {
      rateType: "FIXED",
      planType: "flat",
      termMonths: 12,
      currentBillEnergyRateCents: 10.9,
      defaultRateCentsPerKwh: 10.9,
      baseChargePerMonthCents: 2550,
      billCredits: [
        {
          label: "Monthly credit $15.00 applies <= 500 kWh",
          creditDollars: 15,
          thresholdKwh: 500,
          type: "THRESHOLD_MAX",
        },
      ],
      usageTiers: [],
    };

    const rateStructure = {
      type: "FIXED",
      energyRateCents: 10.9,
      baseMonthlyFeeCents: 2550,
      billCredits: { hasBillCredit: false, rules: [] },
      usageTiers: null,
    };

    const validation = {
      status: "PASS",
      assumptionsUsed: {
        tdspFromEfl: { perKwhCents: 5.7059, monthlyCents: 423 },
        tdspAppliedMode: "ADDED_FROM_EFL",
      },
      points: [
        { usageKwh: 500, expectedAvgCentsPerKwh: 19.6, modeledAvgCentsPerKwh: 19.55 },
        { usageKwh: 1000, expectedAvgCentsPerKwh: 19.6, modeledAvgCentsPerKwh: 19.58 },
        { usageKwh: 2000, expectedAvgCentsPerKwh: 18.1, modeledAvgCentsPerKwh: 18.09 },
      ],
    };

    const scored = await scoreEflPassStrength({
      rawText: "Electricity Facts Label ...",
      validation,
      planRules,
      rateStructure,
    });

    expect(scored.strength).toBe("STRONG");
    expect(scored.reasons ?? []).not.toContain("OFFPOINT_DEVIATION");
  });

  test("treats usage-charge waivers encoded in rateStructure billCredits as STRONG", async () => {
    const planRules = {
      rateType: "FIXED",
      planType: "flat",
      termMonths: 12,
      defaultRateCentsPerKwh: 9.6136,
      billCredits: [],
      usageTiers: [],
    };

    const rateStructure = {
      type: "FIXED",
      energyRateCents: 9.6136,
      baseMonthlyFeeCents: 995,
      billCredits: {
        hasBillCredit: true,
        rules: [
          {
            label: "Usage charge waived at >= 1000 kWh (derived from Usage Charge < 1000)",
            creditAmountCents: 995,
            minUsageKWh: 1000,
          },
        ],
      },
      usageTiers: null,
    };

    const validation = {
      status: "PASS",
      assumptionsUsed: {
        usedEngineTdspFallback: true,
        tdspAppliedMode: "UTILITY_TABLE",
      },
      points: [
        { usageKwh: 500, expectedAvgCentsPerKwh: 17.6, modeledAvgCentsPerKwh: 17.79 },
        { usageKwh: 1000, expectedAvgCentsPerKwh: 15.2, modeledAvgCentsPerKwh: 15.2 },
        { usageKwh: 2000, expectedAvgCentsPerKwh: 14.9, modeledAvgCentsPerKwh: 14.9 },
      ],
    };

    const scored = await scoreEflPassStrength({
      rawText: "Electricity Facts Label ... Usage Charge: $9.95 per billing cycle < 1,000 kWh",
      validation,
      planRules,
      rateStructure,
    });

    expect(scored.strength).toBe("STRONG");
    expect(scored.reasons ?? []).not.toContain("OFFPOINT_DEVIATION");
  });
});


