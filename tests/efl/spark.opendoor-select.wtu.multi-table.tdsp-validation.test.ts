import { describe, expect, it } from "vitest";

import { extractEflTdspCharges, validateEflAvgPriceTable } from "@/lib/efl/eflValidator";
import { runEflPipeline } from "@/lib/efl/runEflPipeline";
import { runEflPipelineFromRawTextNoStore } from "@/lib/efl/runEflPipelineFromRawTextNoStore";
import { solveEflValidationGaps } from "@/lib/efl/validation/solveEflValidationGaps";

const rawText = `
Electricity Facts Label (EFL)
Spark Energy, LLC
West Texas Utilities [WTU / AEP] Service Area
Opendoor Select
ISSUE DATE: 05/12/2026
Average Monthly Use (Residential)                      500 kWh                1000 kWh               2000 kWh
Average Price per Kilowatt-hour (¢ per kWh)              29.3¢                  29.0¢                     28.8¢
Average Monthly Use (Small Commercial)                 1500 kWh               2500 kWh               3500 kWh
Non-Demand Meter Average Price per
Kilowatt-hour (¢ per kWh)                                27.8¢                  27.6¢                     27.5¢
Demand Meter Average Price per Kilowatt-
hour (¢ per kWh)                                         30.3¢                  29.4¢                     29.4¢
The average price examples shown above include your Transmission and Distribution Utility (TDU) delivery costs,
which will be passed through to you in accordance with the rates charged by your TDU.
Energy Charge                                 22.99¢                        ¢ per kWh
Base Charge                                   $0.00                         $ per bill month
Minimum Usage Fee                             $0.00                         $ per bill month if usage < 1000 kWh
Electricity       TDU Delivery Charge                           5.66770¢                      ¢ per kWh
Price             TDU Delivery Charge                           $3.24                         $ per bill month
There is no incentive for this product.
If Small Commercial
TDU Delivery Charge Demand Meter                       0.07430¢                                ¢ per kWh
TDU Delivery Charge Demand Meter                       $22.00                                  $ per bill month
TDU Delivery Charge Non-Demand                         4.39590¢                                ¢ per kWh
TDU Delivery Charge Non-Demand                         $5.66                                   $ per bill month
TDU Demand Charges                                     $12.38                                  $ per kW/kVa
Type of Product                                                  Fixed
Contract Term                                                    4 Months
PUCT Certificate Number          10046
Version Number                   REFE_Opendoor Select_West Texas Utilities [WTU / AEP]_06162025
`.trim();

describe("Spark Opendoor Select WTU residential TDSP extraction", () => {
  it("extracts the residential split-unit TDU per-kWh row before commercial demand rows", () => {
    const tdsp = extractEflTdspCharges(rawText);

    expect(tdsp.monthlyCents).toBe(324);
    expect(tdsp.perKwhCents).toBeCloseTo(5.6677, 6);
    expect(tdsp.snippet).toContain("5.66770");
    expect(tdsp.snippet).not.toContain("Demand Meter Average Price");
  });

  it("passes avg-price validation when residential TDU per-kWh and monthly rows are recognized", async () => {
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
    expect(validation.assumptionsUsed?.tdspFromEfl?.perKwhCents).toBeCloseTo(5.6677, 6);
    expect(validation.assumptionsUsed?.tdspFromEfl?.monthlyCents).toBe(324);
    expect(validation.assumptionsUsed?.tdspAppliedMode).toBe("ADDED_FROM_EFL");
  });

  it("extracts a delivery cents row even when the per-kWh unit column is lost", () => {
    const rawWithoutInlineUnit = rawText.replace(
      "Electricity       TDU Delivery Charge                           5.66770¢                      ¢ per kWh",
      "Electricity       TDU Delivery Charge                           5.66770¢",
    );

    const tdsp = extractEflTdspCharges(rawWithoutInlineUnit);

    expect(tdsp.monthlyCents).toBe(324);
    expect(tdsp.perKwhCents).toBeCloseTo(5.6677, 6);
  });

  it("raw-text pipeline carries the residential TDU per-kWh row through solver validation", async () => {
    const result = await runEflPipelineFromRawTextNoStore({
      rawText,
      eflPdfSha256: "fixture-multi-table-tdsp-raw-text",
      repPuctCertificate: "10046",
      source: "queue_rawtext",
      offerMeta: {
        supplier: "Fixture REP",
        planName: "Fixture Plan",
        termMonths: 4,
        tdspName: "AEP_NORTH",
        offerId: "fixture-offer",
      },
    });

    expect(result.finalValidation?.status).toBe("PASS");
    expect(result.finalValidation?.assumptionsUsed?.tdspFromEfl?.perKwhCents).toBeCloseTo(5.6677, 6);
    expect(result.finalValidation?.assumptionsUsed?.tdspFromEfl?.monthlyCents).toBe(324);
  });

  it("shared solver refreshes stale monthly-only TDSP validation even without rule edits", async () => {
    const planRules = {
      rateType: "FIXED",
      planType: "flat",
      termMonths: 4,
      defaultRateCentsPerKwh: 22.99,
      baseChargePerMonthCents: 0,
      billCredits: [],
      timeOfUsePeriods: [],
    };
    const rateStructure = {
      type: "FIXED",
      energyRateCents: 22.99,
      baseMonthlyFeeCents: 0,
      billCredits: { hasBillCredit: false, rules: [] },
    };

    const solved = await solveEflValidationGaps({
      rawText,
      planRules,
      rateStructure,
      validation: {
        status: "FAIL",
        assumptionsUsed: {
          tdspFromEfl: {
            monthlyCents: 324,
            perKwhCents: null,
          },
        },
        queueReason: "stale monthly-only validation fixture",
      } as any,
    });

    expect(solved.solverApplied).toEqual([]);
    expect(solved.validationAfter?.status).toBe("PASS");
    expect(solved.validationAfter?.assumptionsUsed?.tdspFromEfl?.perKwhCents).toBeCloseTo(5.6677, 6);
    expect(solved.validationAfter?.assumptionsUsed?.tdspFromEfl?.monthlyCents).toBe(324);
  });

  it("canonical orchestrator used by manual text stays out of queue for the same pattern", async () => {
    const result = await runEflPipeline({
      source: "manual_text",
      actor: "admin",
      dryRun: true,
      rawText,
      identity: {
        eflPdfSha256: "fixture-canonical-orchestrator-multi-table-tdsp",
        repPuctCertificate: "10046",
      },
      offerMeta: {
        supplier: "Fixture REP",
        planName: "Fixture Plan",
        termMonths: 4,
        tdspName: "AEP_NORTH",
      },
    });

    expect(result.ok).toBe(true);
    expect(result.queued).toBe(false);
    expect(result.finalValidation?.status).toBe("PASS");
    expect(result.finalValidation?.assumptionsUsed?.tdspFromEfl?.perKwhCents).toBeCloseTo(5.6677, 6);
    expect(result.finalValidation?.assumptionsUsed?.tdspFromEfl?.monthlyCents).toBe(324);
  });
});

