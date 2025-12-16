import { describe, expect, it } from "vitest";

import { validateEflAvgPriceTable } from "@/lib/efl/eflValidator";
import { solveEflValidationGaps } from "@/lib/efl/validation/solveEflValidationGaps";

describe("EFL solver - Monthly Service Fee cutoff (<=1999 kWh) modeled as base+credit", () => {
  it("turns FAIL->PASS by applying base fee for <=1999 and waiving at >=2000 via derived credit", async () => {
    // Snippet captured from admin manual loader rawText preview for Frontier Light Saver 12+ (Oncor).
    const rawText = `
Electricity Facts Label (EFL)
Frontier Utilities
Light Saver 12+
Oncor Electric
Date:12/15/2025

Average Monthly Use                                            500 kWh             1000 kWh        2000 kWh
Average Price per kWh                                           17.8 ¢              16.6 ¢           15.6 ¢
The above price disclosure is based on the following prices:
Energy Charge                                            9.8000 ¢ per kWh

Monthly Service Fee                                      $8.00 per billing cycle for usage ( <=1999) kWh
Electricity Price       TDU Delivery Charges                                     $4.23 per billing cycle
TDU Delivery Charges                                     5.5833 ¢ per kWh

Type of Product:                                         Fixed Rate
Contract Term:                                           12 Months

PUCT Certificate No:                              10169
EFL Version:                                      EFL_ONCOR_ELEC_LS12+_20251215_ENGLISH
`.trim();

    const planRules = {
      rateType: "FIXED",
      planType: "flat",
      termMonths: 12,
      currentBillEnergyRateCents: 9.8,
      defaultRateCentsPerKwh: 9.8,
      baseChargePerMonthCents: null,
      billCredits: [],
    };
    const rateStructure = {
      type: "FIXED",
      energyRateCents: 9.8,
      baseMonthlyFeeCents: null,
      billCredits: { hasBillCredit: false, rules: [] },
      usageTiers: null,
    };

    const v0 = await validateEflAvgPriceTable({
      rawText,
      planRules,
      rateStructure,
      toleranceCentsPerKwh: 0.25,
    });
    expect(v0.status).toBe("FAIL");

    const solved = await solveEflValidationGaps({
      rawText,
      planRules,
      rateStructure,
      validation: v0,
    });

    expect(solved.solverApplied).toContain("SERVICE_FEE_CUTOFF_MAXKWH_TO_BASE_PLUS_CREDIT");
    expect(solved.validationAfter?.status).toBe("PASS");
  });
});


