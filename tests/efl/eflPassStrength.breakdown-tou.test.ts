import { describe, expect, it } from "vitest";

import { applyEnergyChargeBreakdownTouToTemplateShapes, extractEnergyChargeBreakdownTou } from "@/lib/efl/energyChargeBreakdownTou";
import { scoreEflPassStrength, validateEflAvgPriceTable } from "@/lib/efl/eflValidator";
import { solveEflValidationGaps } from "@/lib/efl/validation/solveEflValidationGaps";

const POWERSHIFT_EFL_PDF_LAYOUT = `
Energy Charge Breakdown
  12:00am - 5:59pm,
Off-peak                                                                             6.015¢                                  77.00%
  10:00pm - 11:59pm,
On-peak                             6:00pm - 9:59pm,                                16.513¢                                  23.00%
Average monthly use: 500 kWh 1000 kWh 2000 kWh
Average price per kWh: 16.5¢ 15.7¢ 15.3¢
TNMP Delivery Charge: 6.4665¢ per kWh and $7.85 per month
On-peak: High-demand time when electricity costs more.
`.trim();

describe("EFL pass strength - Energy Charge Breakdown TOU", () => {
  it("scores STRONG when avg-price PASS uses disclosed off-peak usage profile", async () => {
    const breakdown = extractEnergyChargeBreakdownTou(POWERSHIFT_EFL_PDF_LAYOUT)!;
    const planRules: Record<string, unknown> = {
      rateType: "FIXED",
      baseChargePerMonthCents: 0,
      termMonths: 12,
    };
    const rateStructure: Record<string, unknown> = {
      type: "FIXED",
      energyRateCents: 7.85,
    };

    applyEnergyChargeBreakdownTouToTemplateShapes({ planRules, rateStructure, breakdown });

    const v0 = await validateEflAvgPriceTable({
      rawText: POWERSHIFT_EFL_PDF_LAYOUT,
      planRules: planRules as any,
      rateStructure: rateStructure as any,
      toleranceCentsPerKwh: 0.25,
    });
    expect(v0.status).toBe("PASS");

    const solved = await solveEflValidationGaps({
      rawText: POWERSHIFT_EFL_PDF_LAYOUT,
      planRules: planRules as any,
      rateStructure: rateStructure as any,
      validation: v0 as any,
    });
    expect(solved.validationAfter?.status).toBe("PASS");

    const scored = await scoreEflPassStrength({
      rawText: POWERSHIFT_EFL_PDF_LAYOUT,
      validation: solved.validationAfter,
      planRules: solved.derivedPlanRules,
      rateStructure: solved.derivedRateStructure,
    });

    expect(scored.strength).toBe("STRONG");
  });
});
