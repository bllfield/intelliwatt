import { describe, expect, it } from "vitest";

import { validateEflAvgPriceTable } from "@/lib/efl/eflValidator";
import { solveEflValidationGaps } from "@/lib/efl/validation/solveEflValidationGaps";

describe("EFL solver - Peak/Off-Peak TOU with decimal Off-Peak usage % (OhmConnect Half-price Nights 24)", () => {
  it("upgrades FIXED -> TIME_OF_USE when Off-Peak % is decimal (37.5%)", async () => {
    const rawText = `
Electricity Facts Label (EFL)
ONCOR Service Area (TDU)
Half-price Nights 24
08-Dec-2025

Average Monthly Use: 500 KWh 1000 KWh 2000 KWh
Average Price per kWh 16.2¢ 15.8¢ 15.6¢

Energy Charge Peak 12.03¢ / kWh
Energy Charge Off-Peak 6.02¢ / kWh

ONCOR Delivery Charges* 5.6032¢ per kWh and $4.23 per month
Average price is based on usage profile over 12 months of 37.5% of Off-Peak consumption per formula below.
Off-Peak hours are 9:00 PM - 5:59 AM. Peak hours are 6:00 AM - 8:59 PM
`.trim();

    const planRules = {
      rateType: "FIXED",
      planType: "flat",
      termMonths: 24,
      currentBillEnergyRateCents: 6.02,
      defaultRateCentsPerKwh: 6.02,
      baseChargePerMonthCents: null,
      timeOfUsePeriods: [],
      billCredits: [],
      solarBuyback: null,
    };
    const rateStructure = {
      type: "FIXED",
      energyRateCents: 6.02,
      billCredits: { hasBillCredit: false, rules: [] },
      usageTiers: null,
    };

    const v0 = await validateEflAvgPriceTable({
      rawText,
      planRules: planRules as any,
      rateStructure: rateStructure as any,
      toleranceCentsPerKwh: 0.25,
    });

    // The validator should correctly parse the decimal percent (37.5% => 0.375).
    expect((v0 as any).assumptionsUsed?.nightUsagePercent).toBeCloseTo(0.375, 6);
    expect((v0 as any).assumptionsUsed?.nightStartHour).toBe(21);
    expect((v0 as any).assumptionsUsed?.nightEndHour).toBe(6);

    const solved = await solveEflValidationGaps({
      rawText,
      planRules: planRules as any,
      rateStructure: rateStructure as any,
      validation: v0 as any,
    });

    expect(solved.solverApplied).toContain("TOU_PEAK_OFFPEAK_FROM_EFL_TEXT");
    expect((solved.derivedPlanRules as any)?.rateType).toBe("TIME_OF_USE");
    expect((solved.derivedRateStructure as any)?.type).toBe("TIME_OF_USE");

    const periods = (solved.derivedPlanRules as any)?.timeOfUsePeriods ?? [];
    expect(Array.isArray(periods)).toBe(true);
    expect(periods.length).toBe(2);
  });
});

