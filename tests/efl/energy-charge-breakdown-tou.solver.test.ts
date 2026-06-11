import { describe, expect, it } from "vitest";

import {
  applyEnergyChargeBreakdownTouToTemplateShapes,
  extractEnergyChargeBreakdownTou,
} from "@/lib/efl/energyChargeBreakdownTou";
import { validateEflAvgPriceTable } from "@/lib/efl/eflValidator";
import { solveEflValidationGaps } from "@/lib/efl/validation/solveEflValidationGaps";
import { requiredBucketsForRateStructure } from "@/lib/plan-engine/requiredBucketsForPlan";
import { extractDeterministicTouSchedule } from "@/lib/plan-engine/touPeriods";

const POWERSHIFT_EFL_INLINE = `
Electricity Facts Label
Average monthly use: 500 kWh 1000 kWh 2000 kWh
Average price per kWh: 16.5¢ 15.7¢ 15.3¢
Base Charge: $0 per month
Energy Charge: See chart below
TNMP Delivery Charge: 6.4665¢ per kWh and $7.85 per month
Energy Charge Breakdown
Off-peak 12:00am - 5:59pm, 10:00pm - 11:59pm 6.015¢ 77.00%
On-peak 6:00pm - 9:59pm 16.513¢ 23.00%
Other Key Terms and Questions
PUCT Certificate Number #10279. Version 10.0
`.trim();

const POWERSHIFT_EFL_TABLE_LAYOUT = `
Energy Charge Breakdown
Off-peak                                                                             6.015¢                                  77.00%
  12:00am - 5:59pm,
  10:00pm - 11:59pm,
On-peak                             6:00pm - 9:59pm,                                16.513¢                                  23.00%
On-peak: High-demand time when electricity costs more.
`.trim();

describe("EFL - Energy Charge Breakdown TOU extraction", () => {
  it("extracts three clock windows with correct rates (not fixed TDSP)", () => {
    for (const rawText of [POWERSHIFT_EFL_INLINE, POWERSHIFT_EFL_TABLE_LAYOUT]) {
      const breakdown = extractEnergyChargeBreakdownTou(rawText);
      expect(breakdown).not.toBeNull();
      expect(breakdown!.periods).toHaveLength(3);
      expect(breakdown!.periods).toEqual([
        expect.objectContaining({
          label: "Off-Peak 1",
          startHour: 0,
          endHour: 18,
          rateCentsPerKwh: 6.015,
        }),
        expect.objectContaining({
          label: "Off-Peak 2",
          startHour: 22,
          endHour: 24,
          rateCentsPerKwh: 6.015,
        }),
        expect.objectContaining({
          label: "Peak",
          startHour: 18,
          endHour: 22,
          rateCentsPerKwh: 16.513,
        }),
      ]);
      expect(breakdown!.offPeakUsagePercent).toBeCloseTo(0.77, 5);
    }
  });

  it("labels template as TIME_OF_USE and yields TOU bucket keys", () => {
    const breakdown = extractEnergyChargeBreakdownTou(POWERSHIFT_EFL_TABLE_LAYOUT)!;
    const planRules: Record<string, unknown> = {
      rateType: "FIXED",
      energyRateCents: 7.85,
    };
    const rateStructure: Record<string, unknown> = {
      type: "FIXED",
      energyRateCents: 7.85,
    };

    applyEnergyChargeBreakdownTouToTemplateShapes({
      planRules,
      rateStructure,
      breakdown,
    });

    expect(planRules.rateType).toBe("TIME_OF_USE");
    expect(rateStructure.type).toBe("TIME_OF_USE");
    expect(rateStructure.energyRateCents).toBeUndefined();

    const tou = extractDeterministicTouSchedule(rateStructure);
    expect(tou.schedule).not.toBeNull();

    const bucketKeys = requiredBucketsForRateStructure({ rateStructure }).map((b) => b.key);
    expect(bucketKeys).toEqual(
      expect.arrayContaining([
        "kwh.m.all.total",
        "kwh.m.all.0000-1800",
        "kwh.m.all.1800-2200",
        "kwh.m.all.2200-2400",
      ]),
    );
  });
});

describe("EFL solver - Energy Charge Breakdown peak/off-peak TOU", () => {
  it("derives TOU from breakdown table rows and turns FAIL->PASS using disclosed usage %", async () => {
    const rawText = POWERSHIFT_EFL_INLINE;

    const planRules = {
      rateType: "FIXED",
      planType: "flat",
      termMonths: 12,
      currentBillEnergyRateCents: 7.85,
      defaultRateCentsPerKwh: 7.85,
      baseChargePerMonthCents: 0,
      timeOfUsePeriods: [],
      billCredits: [],
      solarBuyback: null,
    };
    const rateStructure = {
      type: "FIXED",
      energyRateCents: 7.85,
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

    expect(solved.solverApplied).toContain("TOU_ENERGY_CHARGE_BREAKDOWN_FROM_EFL_TEXT");
    expect(solved.validationAfter?.status).toBe("PASS");
    expect((solved.derivedPlanRules as any)?.rateType).toBe("TIME_OF_USE");
    expect((solved.derivedRateStructure as any)?.type).toBe("TIME_OF_USE");
    expect((solved.derivedRateStructure as any)?.energyRateCents).toBeUndefined();
    expect((solved.derivedPlanRules as any)?.timeOfUsePeriods).toHaveLength(3);
  });
});
