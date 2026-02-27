import { describe, expect, it } from "vitest";

import { extractEflAvgPricePoints } from "@/lib/efl/eflValidator";

describe("EFL avg table extraction - header cents without row cents", () => {
  it("extracts 500/1000/2000 avg prices when values do not repeat the cent symbol", () => {
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

    const points = extractEflAvgPricePoints(rawText);
    expect(points).not.toBeNull();
    expect(points).toEqual([
      { kwh: 500, eflAvgCentsPerKwh: 14.4 },
      { kwh: 1000, eflAvgCentsPerKwh: 14.0 },
      { kwh: 2000, eflAvgCentsPerKwh: 13.8 },
    ]);
  });
});

