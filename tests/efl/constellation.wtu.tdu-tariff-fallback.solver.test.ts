import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  lookupTdspCharges: vi.fn(),
}));

vi.mock("@/lib/utility/tdspTariffs", () => ({
  lookupTdspCharges: mocks.lookupTdspCharges,
}));

import { validateEflAvgPriceTable } from "@/lib/efl/eflValidator";

const rawText = `
Electricity Facts Label (EFL)
Constellation NewEnergy, Inc. (Constellation)
West Texas Utilities Company Service Area
12 MONTH RESIDENTIAL FIXED RATE
5/6/2026
Average Monthly Use               500kWh                    1,000kWh                    2,000kWh
Average price per kWh              17.0¢                       16.7¢                         16.6¢
This estimated average Price per kWh disclosure is an example and is calculated using: (i) a Fixed
Energy Charge of 10.70¢ per kWh, (ii) the applicable Transmission and Distribution Service Provider
("TDU") tariff as established by the Public Utility Commission of Texas ("PUCT"), (iii) a monthly Base
Charge per ESI-ID of $0.00, and (iv) all recurring charges.
Your actual Price for electricity may vary according to your exact monthly usage and TDU pass-through charges.
DH EFL - 4949329 - AEP-WTU12 MONTH RESIDENTIAL FIXED RATE 5/6/2026
`.trim();

describe("EFL validator - Constellation WTU TDU tariff fallback", () => {
  it("maps WTU service area to AEP_NORTH before utility-backed TDSP fallback", async () => {
    mocks.lookupTdspCharges.mockResolvedValue({
      tdspCode: "AEP_NORTH",
      asOfDate: new Date("2026-05-06T00:00:00.000Z"),
      tariffVersionId: "tariff-aep-north",
      effectiveStart: new Date("2026-03-01T00:00:00.000Z"),
      effectiveEnd: null,
      monthlyCents: 324,
      perKwhCents: 5.9,
      components: [],
      confidence: "MED",
    });

    const validation = await validateEflAvgPriceTable({
      rawText,
      planRules: {
        planType: "flat",
        rateType: "FIXED",
        termMonths: 12,
        defaultRateCentsPerKwh: 10.7,
        baseChargePerMonthCents: 0,
        billCredits: [],
      },
      rateStructure: {
        type: "FIXED",
        energyRateCents: 10.7,
        baseMonthlyFeeCents: 0,
        billCredits: { hasBillCredit: false, rules: [] },
        usageTiers: null,
      },
      toleranceCentsPerKwh: 0.25,
    });

    expect(mocks.lookupTdspCharges).toHaveBeenCalledWith({
      tdspCode: "AEP_NORTH",
      asOfDate: new Date("2026-05-06T00:00:00.000Z"),
    });
    expect(validation.status).toBe("PASS");
    expect(validation.assumptionsUsed?.tdspAppliedMode).toBe("UTILITY_TABLE");
    expect(validation.assumptionsUsed?.tdspFromUtilityTable).toMatchObject({
      tdspCode: "AEP_NORTH",
      effectiveDateUsed: "derived_from_avg_table",
      confidence: "LOW",
    });
  });
});

