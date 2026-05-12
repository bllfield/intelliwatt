import { describe, expect, it } from "vitest";

import { extractEflTdspCharges, validateEflAvgPriceTable } from "@/lib/efl/eflValidator";
import { solveEflValidationGaps } from "@/lib/efl/validation/solveEflValidationGaps";

const rawText = `
Electricity Facts Label (EFL)
Spark Energy, LLC
Oncor Service Area
Opendoor Select
ISSUE DATE: 05/12/2026
Average Monthly Use (Residential)                      500 kWh                1000 kWh               2000 kWh
Average Price per Kilowatt-hour (¢ per kWh)              29.5¢                  29.0¢                     28.8¢
The average price examples shown above include your Transmission and Distribution Utility (TDU) delivery costs,
which will be passed through to you in accordance with the rates charged by your TDU.
Energy Charge                                 22.99¢                        ¢ per kWh
Base Charge                                   $0.00                         $ per bill month
Minimum Usage Fee                             $0.00                         $ per bill month if usage < 1000 kWh
Electricity       TDU Delivery Charge                           5.61830¢                      ¢ per kWh
Price             TDU Delivery Charge                           $4.23                         $ per bill month
There is no incentive for this product.
Type of Product                                                  Fixed
Contract Term                                                    4 Months
PUCT Certificate Number          10046
Version Number                   REFE_Opendoor Select_Oncor_06162025
`.trim();

describe("Spark Opendoor Select Oncor TDSP extraction", () => {
  it("extracts the repeated-unit per-kWh TDU line", () => {
    const tdsp = extractEflTdspCharges(rawText);
    expect(tdsp.monthlyCents).toBe(423);
    expect(tdsp.perKwhCents).toBeCloseTo(5.6183, 6);
  });

  it("passes avg-price validation when the repeated-unit TDU line is present", async () => {
    const validation = await validateEflAvgPriceTable({
      rawText,
      planRules: {
        planType: "flat",
        rateType: "FIXED",
        defaultRateCentsPerKwh: 22.99,
        baseChargePerMonthCents: 0,
        billCredits: [],
        timeOfUsePeriods: [],
      },
      rateStructure: {
        type: "FIXED",
        energyRateCents: 22.99,
        baseMonthlyFeeCents: 0,
        billCredits: { hasBillCredit: false, rules: [] },
      },
    });

    expect(validation.status).toBe("PASS");
    expect(validation.assumptionsUsed?.tdspFromEfl?.perKwhCents).toBeCloseTo(5.6183, 6);
    expect(validation.assumptionsUsed?.tdspAppliedMode).toBe("ADDED_FROM_EFL");
  });

  it("solver rerun also passes once the repeated-unit TDU line is recognized", async () => {
    const solved = await solveEflValidationGaps({
      rawText,
      planRules: {
        baseChargePerMonthCents: 0,
        rateType: "FIXED",
        planType: "flat",
        termMonths: 4,
      },
      rateStructure: {
        baseCharge: { amount: 0, per: "month" },
        energyCharges: [
          {
            rate: 0.2299,
            unit: "kWh",
            minUsage: null,
            maxUsage: null,
            tierName: null,
          },
        ],
        minimumUsageFee: {
          amount: 0,
          appliesUnder: "usage < 1000 kWh",
        },
        billCredits: [],
      },
      validation: {
        status: "SKIP",
        toleranceCentsPerKwh: 0.25,
        points: [
          { usageKwh: 500, expectedAvgCentsPerKwh: 29.5, modeledAvgCentsPerKwh: null, diffCentsPerKwh: null, ok: false, modeled: null },
          { usageKwh: 1000, expectedAvgCentsPerKwh: 29.0, modeledAvgCentsPerKwh: null, diffCentsPerKwh: null, ok: false, modeled: null },
          { usageKwh: 2000, expectedAvgCentsPerKwh: 28.8, modeledAvgCentsPerKwh: null, diffCentsPerKwh: null, ok: false, modeled: null },
        ],
        assumptionsUsed: {
          tdspFromEfl: {
            perKwhCents: null,
            monthlyCents: 423,
            confidence: "MED",
          },
          usedEngineTdspFallback: false,
        },
        fail: false,
        notes: ["Canonical plan-cost calculator could not be applied for any avg-price point; skipping validation."],
        avgTableFound: true,
        avgTableRows: [
          { kwh: 500, avgPriceCentsPerKwh: 29.5 },
          { kwh: 1000, avgPriceCentsPerKwh: 29.0 },
          { kwh: 2000, avgPriceCentsPerKwh: 28.8 },
        ],
      },
    });

    expect(solved.validationAfter?.status).toBe("PASS");
    expect(solved.validationAfter?.assumptionsUsed?.tdspFromEfl?.perKwhCents).toBeCloseTo(5.6183, 6);
  });
});
