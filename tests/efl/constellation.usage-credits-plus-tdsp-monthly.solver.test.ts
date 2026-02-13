import { describe, expect, it } from "vitest";

import { validateEflAvgPriceTable } from "@/lib/efl/eflValidator";
import { solveEflValidationGaps } from "@/lib/efl/validation/solveEflValidationGaps";

describe("EFL solver - additive usage credits + TDSP monthly fee (Constellation TNMP)", () => {
  it("adds threshold-min usage credits and passes avg-price validation", async () => {
    const rawText = `
Electricity Facts Label (EFL)

Average Monthly Use               500kWh                    1,000kWh                    2,000kWh
Average price per kWh              20.4¢                       16.1¢                         16.7¢

Energy Charge                                 11.58        ¢ per kWh

Electricity    TDU Delivery Charge*                          7.2370       ¢ per kWh
  Price        TDU Delivery Charge*                          7.85         $ per bill month

Residential Usage Credit                      35.00        $ per bill month if usage >= 1000kWh
Additional Residential Usage Credit           15.00        $ per bill month if usage >= 2000kWh
    `.trim();

    const planRules: any = {
      planType: "flat",
      rateType: "FIXED",
      termMonths: 24,
      defaultRateCentsPerKwh: 11.58,
      // No billCredits in the AI parse (simulating the bug).
      billCredits: [],
    };

    const rateStructure: any = {
      type: "FIXED",
      energyRateCents: 11.58,
      billCredits: { hasBillCredit: false, rules: [] },
      usageTiers: null,
    };

    const baseValidation = await validateEflAvgPriceTable({
      rawText,
      planRules,
      rateStructure,
      toleranceCentsPerKwh: 0.25,
    });
    expect(baseValidation.status).toBe("FAIL");

    const solved = await solveEflValidationGaps({
      rawText,
      planRules,
      rateStructure,
      validation: baseValidation,
    });

    expect(solved.solverApplied).toContain("SYNC_USAGE_BILL_CREDITS_THRESHOLD_MIN_FROM_EFL_TEXT");
    expect(solved.validationAfter?.status).toBe("PASS");

    const rs: any = solved.derivedRateStructure;
    expect(rs?.billCredits?.hasBillCredit).toBe(true);
    expect(Array.isArray(rs?.billCredits?.rules)).toBe(true);

    // Non-overlapping additive segments:
    // 1000-2000 => $35, 2000+ => $50
    const rules = rs.billCredits.rules;
    expect(rules.length).toBe(2);
    expect(rules[0]).toMatchObject({ creditAmountCents: 3500, minUsageKWh: 1000, maxUsageKWh: 2000 });
    expect(rules[1]).toMatchObject({ creditAmountCents: 5000, minUsageKWh: 2000 });
  });
});

