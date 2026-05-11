import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  lookupTdspCharges: vi.fn(),
}));

vi.mock("@/lib/utility/tdspTariffs", () => ({
  lookupTdspCharges: mocks.lookupTdspCharges,
}));

import { validateEflAvgPriceTable } from "@/lib/efl/eflValidator";

describe("EFL validator - Constellation TNMP TDU tariff fallback", () => {
  it("treats TDU tariff + pass-through wording as utility-backed TDSP fallback", async () => {
    mocks.lookupTdspCharges.mockResolvedValue({
      tdspCode: "TNMP",
      asOfDate: new Date("2026-05-06T00:00:00.000Z"),
      tariffVersionId: "tariff-1",
      effectiveStart: new Date("2026-03-01T00:00:00.000Z"),
      effectiveEnd: null,
      monthlyCents: 785,
      perKwhCents: 7.237,
      components: [],
      confidence: "MED",
    });

    const rawText = `
Electricity Facts Label (EFL)

Constellation NewEnergy, Inc. (Constellation)
Texas New Mexico Power Service Area
12 MONTH RESIDENTIAL FIXED RATE
5/6/2026

Average Monthly Use               500kWh                    1,000kWh                    2,000kWh
Average price per kWh              18.5¢                       17.7¢                         17.3¢

This estimated average Price per kWh disclosure is an example and is calculated using: (i) a Fixed
Energy Charge of 10.44¢ per kWh, (ii) the applicable Transmission and Distribution Service Provider
("TDU") tariff as established by the Public Utility Commission of Texas ("PUCT"), (iii) a monthly Base
Charge per ESI-ID of $0.00, and (iv) all recurring charges.
Your actual Price for electricity may vary according to your exact monthly usage and TDU pass-through charges.
`.trim();

    const validation = await validateEflAvgPriceTable({
      rawText,
      planRules: {
        planType: "flat",
        rateType: "FIXED",
        termMonths: 12,
        defaultRateCentsPerKwh: 10.44,
        baseChargePerMonthCents: 0,
        billCredits: [],
      },
      rateStructure: {
        type: "FIXED",
        energyRateCents: 10.44,
        baseMonthlyFeeCents: 0,
        billCredits: { hasBillCredit: false, rules: [] },
        usageTiers: null,
      },
      toleranceCentsPerKwh: 0.25,
    });

    expect(mocks.lookupTdspCharges).toHaveBeenCalledWith({
      tdspCode: "TNMP",
      asOfDate: new Date("2026-05-06T00:00:00.000Z"),
    });
    expect(validation.status).toBe("PASS");
    expect(validation.assumptionsUsed?.tdspAppliedMode).toBe("UTILITY_TABLE");
    expect(validation.assumptionsUsed?.tdspFromUtilityTable).toMatchObject({
      tdspCode: "TNMP",
      effectiveDateUsed: "derived_from_avg_table",
      perKwhCents: 6.46,
      monthlyCents: 800,
      confidence: "LOW",
    });
  });
});
