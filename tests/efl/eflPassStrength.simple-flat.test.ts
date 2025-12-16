import { describe, expect, test } from "vitest";

import { scoreEflPassStrength } from "@/lib/efl/eflValidator";

describe("eflValidator - PASS strength scoring", () => {
  test("does not flag OFFPOINT_DEVIATION for simple flat FIXED plans with only base fee (non-linear curve)", async () => {
    const planRules = {
      rateType: "FIXED",
      planType: "flat",
      termMonths: 36,
      currentBillEnergyRateCents: 12.4,
      defaultRateCentsPerKwh: 12.4,
      baseChargePerMonthCents: 2995,
      billCredits: [],
      usageTiers: [],
    };

    const rateStructure = {
      type: "FIXED",
      energyRateCents: 12.4,
      baseMonthlyFeeCents: 2995,
      billCredits: { hasBillCredit: false, rules: [] },
      usageTiers: null,
    };

    // Anchor points from the Chariot GreenVolt 36 example.
    const validation = {
      status: "PASS",
      assumptionsUsed: {
        tdspFromEfl: { perKwhCents: 5.5833, monthlyCents: 423 },
        tdspAppliedMode: "ADDED_FROM_EFL",
      },
      points: [
        { usageKwh: 500, expectedAvgCentsPerKwh: 24.8, modeledAvgCentsPerKwh: 24.82 },
        { usageKwh: 1000, expectedAvgCentsPerKwh: 21.4, modeledAvgCentsPerKwh: 21.4 },
        { usageKwh: 2000, expectedAvgCentsPerKwh: 19.7, modeledAvgCentsPerKwh: 19.69 },
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
});


