import { describe, expect, it } from "vitest";

import { extractEflTdspCharges, validateEflAvgPriceTable } from "@/lib/efl/eflValidator";

describe("EFL validator - Champion variable saver-1 (tdsp table + avg table)", () => {
  it("extracts TDSP per-kWh + monthly charges from side-by-side tables (¢/kWh) and validates avg table", async () => {
    // Snippet captured from manual loader rawText preview for:
    // https://docs.championenergyservices.com/ExternalDocs?planName=PN1342&state=TX&language=EN
    const rawText = `
Electricity Facts Label
                                     Champion Energy Services, LLC PUC #10098
                                        Residential Service ⇒ Champ Saver-1
                                                Oncor Electric Delivery
                                                      12/16/2025

Average Monthly Use:                         500 kWh               1,000 kWh               2,000 kWh
Average price per kilowatt-hour :
Oncor Electric Delivery                        20.7¢                    20.3¢                 20.1¢

                                                     Electricity Price

                  Champion Energy Charges
                                                                                   Delivery Charges from
                                                                                   Oncor Electric Delivery
            Energy Charge (per
                                     Base Charge                                  per kWh          per month
                  kWh)
                                                                                5.6032¢/kWh           $4.23
                14.3¢/kWh                 $0.00

Type of Product                                         Variable Rate

Contract Term                                           1 Month
`.trim();

    const tdsp = extractEflTdspCharges(rawText);
    expect(tdsp.monthlyCents).toBe(423);
    expect(tdsp.perKwhCents).toBeCloseTo(5.6032, 6);
    expect(tdsp.snippet ?? "").toContain("5.6032");
    expect(tdsp.snippet ?? "").toContain("$4.23");

    // This test intentionally mirrors the "admin pipeline output" shape where rateStructure
    // may be a tier array rather than the canonical contract, and field names can vary.
    const v = await validateEflAvgPriceTable({
      rawText,
      planRules: {},
      rateStructure: [
        // Common variant names seen in real-world outputs:
        { energyChargeCentsPerkWh: 14.3, minimumUsageKWh: null, maximumUsageKWh: null },
      ],
    });

    expect(v.status).toBe("PASS");
    expect(v.points).toHaveLength(3);
    expect(v.points.every((p) => p.modeledAvgCentsPerKwh != null)).toBe(true);
  });
});


