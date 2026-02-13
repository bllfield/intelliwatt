import { describe, expect, it } from "vitest";

import { extractEflTdspCharges } from "@/lib/efl/eflValidator";

describe("EFL validator - TDSP extraction parses '$ per bill month' tables (Constellation TNMP)", () => {
  it("extracts TDSP per-kWh and monthly charge when $ appears after the number", () => {
    const rawText = `
Electricity Facts Label (EFL)

Electricity    TDU Delivery Charge*                          7.2370       ¢ per kWh
  Price        TDU Delivery Charge*                          7.85         $ per bill month
    `.trim();

    const tdsp = extractEflTdspCharges(rawText);
    expect(tdsp.perKwhCents).toBeCloseTo(7.237, 6);
    expect(tdsp.monthlyCents).toBe(785);
  });
});

