import { describe, expect, it } from "vitest";

import { validateEflAvgPriceTable } from "@/lib/efl/eflValidator";
import { solveEflValidationGaps } from "@/lib/efl/validation/solveEflValidationGaps";

describe("EFL solver - side-by-side Electricity Price table (avoid TDSP as REP energy)", () => {
  it("does not persist TDSP delivery ¢/kWh as energyRateCents (Champion Champ Saver-1 TNMP)", async () => {
    // Snippet based on a real Champ Saver-1 EFL where the Electricity Price table is side-by-side:
    // - TDSP delivery appears before the REP energy charge on nearby lines
    // - naive extraction can incorrectly pick TDSP (7.2370) as the REP energy rate
    const rawText = `
Electricity Facts Label
                                     Champion Energy Services, LLC PUC #10098
                                        Residential Service ⇒ Champ Saver-1
                                              Texas-New Mexico Power
                                                        2/6/2026


Average Monthly Use:                         500 kWh               1,000 kWh               2,000 kWh
Average price per kilowatt-hour :
Texas-New Mexico Power                         21.7¢                    20.9¢                 20.5¢

                                                     Electricity Price


                  Champion Energy Charges
                                                                                   Delivery Charges from
                                                                                 Texas-New Mexico Power
            Energy Charge (per
                                     Base Charge                                  per kWh         per month
                  kWh)
                                                                                7.2370¢/kWh          $7.85
                12.9¢/kWh                 $0.00

Type of Product                                         Variable Rate

Contract Term                                           1 Month
`.trim();

    const planRules: any = {
      rateType: "VARIABLE",
      planType: "flat",
      termMonths: 1,
      currentBillEnergyRateCents: 12.9,
      // Intentionally missing defaultRateCentsPerKwh to trigger the solver fallback.
      defaultRateCentsPerKwh: null,
      baseChargePerMonthCents: null,
      billCredits: [],
    };

    // Simulate a broken upstream parse that incorrectly stored TDSP delivery as the "energyRateCents".
    const rateStructure: any = {
      type: "FIXED",
      energyRateCents: 7.237,
      baseMonthlyFeeCents: 0,
      billCredits: { hasBillCredit: false, rules: [] },
      usageTiers: null,
    };

    const v0 = await validateEflAvgPriceTable({
      rawText,
      planRules,
      rateStructure,
      toleranceCentsPerKwh: 0.25,
    });
    expect(v0.status).toBe("PASS");

    const solved = await solveEflValidationGaps({
      rawText,
      planRules,
      rateStructure,
      validation: v0,
    });

    expect(solved.solverApplied).toContain("FALLBACK_FIXED_ENERGY_CHARGE_FROM_EFL_TEXT");
    expect((solved.derivedPlanRules as any)?.defaultRateCentsPerKwh).toBeCloseTo(12.9, 6);
    expect((solved.derivedRateStructure as any)?.energyRateCents).toBeCloseTo(12.9, 6);
  });
});

