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

  it("infers AEP_NORTH from legacy West Texas Utilities service-area labels", () => {
    const raw = `
Electricity Facts Label (EFL)
Constellation NewEnergy, Inc. (Constellation)
West Texas Utilities Company Service Area
DH EFL - 4949329 – AEP-WTU12 MONTH RESIDENTIAL FIXED RATE 5/6/2026
`.trim();
    expect(inferTdspTerritoryFromEflText(raw)).toBe("AEP_NORTH");
  });

  it("infers AEP_CENTRAL from legacy Central Power and Light service-area labels", () => {
    const raw = `
Electricity Facts Label (EFL)
Central Power and Light Company Service Area
DH EFL - 1234567 – AEP-CPL12 MONTH RESIDENTIAL FIXED RATE 5/6/2026
`.trim();
    expect(inferTdspTerritoryFromEflText(raw)).toBe("AEP_CENTRAL");
  });

  it("infers AEP_CENTRAL from Central Power & Light / CP&L service-area labels", () => {
    const raw = `
Electricity Facts Label (EFL)
Spark Energy, LLC
Central Power & Light [CP&L / AEP] Service Area
Opendoor Select
`.trim();
    expect(inferTdspTerritoryFromEflText(raw)).toBe("AEP_CENTRAL");
  });
});

