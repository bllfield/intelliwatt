import { describe, expect, it } from "vitest";

import { inferTdspTerritoryFromEflText } from "@/lib/efl/eflValidator";

describe("inferTdspTerritoryFromEflText - AEP Texas N/C abbreviations", () => {
  it("infers AEP_NORTH from 'AEP Texas N Service Area'", () => {
    const raw = `
Electricity Facts Label (EFL)
AEP Texas N Service Area (TDU)
Electricity AEP Texas N Delivery Charges 5.9233¢ per kWh and $3.24 per month
`.trim();
    expect(inferTdspTerritoryFromEflText(raw)).toBe("AEP_NORTH");
  });
});

