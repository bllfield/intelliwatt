import { describe, expect, it } from "vitest";

import { validateEflAvgPriceTable } from "@/lib/efl/eflValidator";
import { solveEflValidationGaps } from "@/lib/efl/validation/solveEflValidationGaps";

describe("EFL solver - upgrades RateStructure when PlanRules already contain TOU periods (OhmConnect EVConnect)", () => {
  it("upgrades derivedRateStructure to TIME_OF_USE even when timeOfUsePeriods already exist", async () => {
    const rawText = `
Electricity Facts Label (EFL)
ONCOR Service Area (TDU)
EVConnect 12
08-Dec-2025

Average Monthly Use: 500 KWh 1000 KWh 2000 KWh
Average Price per kWh 16.4¢ 15.9¢ 15.7¢

Energy Charge Peak 11.79¢ / kWh
Energy Charge Off-Peak 5.9¢ / kWh

ONCOR Delivery Charges* 5.6032¢ per kWh and $4.23 per month
Average price is based on usage profile over 12 months of 32% of Off-Peak consumption per formula below.
Off-Peak hours are 9:00 PM - 4:59 AM. Peak hours are 5:00 AM - 8:59 PM
`.trim();

    // Simulate an earlier extractor that already found TOU periods in planRules,
    // but rateStructure was not upgraded (the exact unsafe state we want to fix).
    const planRules = {
      rateType: "FIXED",
      planType: "flat",
      termMonths: 12,
      currentBillEnergyRateCents: 5.9,
      defaultRateCentsPerKwh: 5.9,
      baseChargePerMonthCents: null,
      timeOfUsePeriods: [
        {
          label: "Off-Peak",
          startHour: 21,
          endHour: 5,
          daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
          months: undefined,
          rateCentsPerKwh: 5.9,
          isFree: false,
        },
        {
          label: "Peak",
          startHour: 5,
          endHour: 21,
          daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
          months: undefined,
          rateCentsPerKwh: 11.79,
          isFree: false,
        },
      ],
      billCredits: [],
      solarBuyback: null,
    };

    const rateStructure = {
      type: "FIXED",
      energyRateCents: 5.9,
      billCredits: { hasBillCredit: false, rules: [] },
      usageTiers: null,
    };

    const v0 = await validateEflAvgPriceTable({
      rawText,
      planRules: planRules as any,
      rateStructure: rateStructure as any,
      toleranceCentsPerKwh: 0.25,
    });

    const solved = await solveEflValidationGaps({
      rawText,
      planRules: planRules as any,
      rateStructure: rateStructure as any,
      validation: v0 as any,
    });

    expect(solved.solverApplied).toContain("TOU_UPGRADE_FROM_EXISTING_PERIODS");
    expect((solved.derivedRateStructure as any)?.type).toBe("TIME_OF_USE");
    expect(Array.isArray((solved.derivedRateStructure as any)?.timeOfUsePeriods)).toBe(true);
    expect(((solved.derivedRateStructure as any).timeOfUsePeriods ?? []).length).toBeGreaterThan(0);
  });
});

