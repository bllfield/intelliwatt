import { describe, expect, it } from "vitest";

import { extractEflTdspCharges } from "@/lib/efl/eflValidator";

describe("EFL validator - CleanSky Oncor Charges TDSP extraction", () => {
  it("extracts monthly and per-kWh TDSP from an 'Oncor Charges' combined line", () => {
    const rawText = `
Electricity Facts Label
CleanSky Energy
Embrace Green 12 - Fixed
Oncor Service Area

Average Monthly Use 500 kWh 1,000 kWh 2,000 kWh
Average Price ¢ per kWh 14.4 14.0 13.8

Energy Charge 7.999 ¢ per kWh
Base Fee $0.00 per bill month
Oncor Charges $4.23 per bill month and 5.5833¢ per kWh
`.trim();

    const tdsp = extractEflTdspCharges(rawText);
    expect(tdsp.monthlyCents).toBe(423);
    expect(tdsp.perKwhCents).toBeCloseTo(5.5833, 6);
  });
});

