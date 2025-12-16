import { describe, expect, it } from "vitest";

import { validateEflAvgPriceTable } from "@/lib/efl/eflValidator";
import { solveEflValidationGaps } from "@/lib/efl/validation/solveEflValidationGaps";

describe("EFL solver - Peak/Off-Peak TOU with disclosed Off-Peak usage % (OhmConnect EVConnect)", () => {
  it("derives TOU periods from text and turns FAIL->PASS using Off-Peak usage % assumption", async () => {
    const rawText = `
Electricity Facts Label (EFL)
ONCOR Service Area (TDU)
EVConnect 24
08-Dec-2025

Average Monthly Use: 500 KWh 1000 KWh 2000 KWh
Average Price per kWh 16.4¢ 16¢ 15.8¢

Energy Charge Peak 11.84¢ / kWh
Energy Charge Off-Peak 5.92¢ / kWh

ONCOR Delivery Charges* 5.6032¢ per kWh and $4.23 per month
Average price is based on usage profile over 12 months of 32% of Off-Peak consumption per formula below.
Off-Peak hours are 9:00 PM - 4:59 AM. Peak hours are 5:00 AM - 8:59 PM
`.trim();

    const planRules = {
      rateType: "FIXED",
      planType: "flat",
      termMonths: 24,
      currentBillEnergyRateCents: 5.92,
      defaultRateCentsPerKwh: 5.92,
      baseChargePerMonthCents: null,
      timeOfUsePeriods: [],
      billCredits: [],
      solarBuyback: null,
    };
    const rateStructure = {
      type: "FIXED",
      energyRateCents: 5.92,
      billCredits: { hasBillCredit: false, rules: [] },
      usageTiers: null,
    };

    const v0 = await validateEflAvgPriceTable({
      rawText,
      planRules: planRules as any,
      rateStructure: rateStructure as any,
      toleranceCentsPerKwh: 0.25,
    });
    expect(v0.status).toBe("FAIL");

    const solved = await solveEflValidationGaps({
      rawText,
      planRules: planRules as any,
      rateStructure: rateStructure as any,
      validation: v0 as any,
    });

    expect(solved.solverApplied).toContain("TOU_PEAK_OFFPEAK_FROM_EFL_TEXT");
    expect(solved.validationAfter?.status).toBe("PASS");
  });
});


