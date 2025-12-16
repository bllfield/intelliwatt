import { describe, expect, it } from "vitest";

import { validateEflAvgPriceTable } from "@/lib/efl/eflValidator";
import { solveEflValidationGaps } from "@/lib/efl/validation/solveEflValidationGaps";

describe("EFL solver - prepaid daily charge + max-usage monthly credit", () => {
  it("turns FAIL->PASS by modeling Daily Charge as monthly base fee and Monthly Credit as <=kWh negative credit", async () => {
    const rawText = `
ELECTRICITY FACTS LABEL (EFL)
12 Month - prepaid
Oncor Electric Delivery Service Area effective as of December 7, 2025

ELECTRICITY     Average Monthly Use                                        500 kWh                    1000 kWh                    2000 kWh
PRICE
Average Price per kWh                                        19.6¢                      19.6¢                       18.1¢

This price disclosure is based on the following:
Daily Charge      $0.85      per day.
Monthly Credit     -$15.00     Applies: 500 kWh usage or less, prorated if under 30 days.
Energy Charge 10.9000¢          per kWh.
TDSP Delivery Charge 5.7059¢            per kWh; passed through based on daily usage.
TDSP Monthly Charge          $4.23      per month; prorated and passed through daily.
`.trim();

    const planRules = {
      rateType: "FIXED",
      planType: "flat",
      termMonths: 12,
      currentBillEnergyRateCents: 10.9,
      defaultRateCentsPerKwh: 10.9,
      baseChargePerMonthCents: null,
      billCredits: [],
    };
    const rateStructure = {
      type: "FIXED",
      energyRateCents: 10.9,
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

    expect(solved.solverApplied).toContain("DAILY_CHARGE_PER_DAY_TO_MONTHLY_BASE_FEE");
    expect(solved.solverApplied).toContain("MONTHLY_CREDIT_MAX_USAGE_TO_THRESHOLD_MAX_CREDIT");
    expect(solved.validationAfter?.status).toBe("PASS");
  });
});


