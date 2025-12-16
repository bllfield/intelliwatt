import { describe, expect, it } from "vitest";

import { extractEflTdspCharges } from "@/lib/efl/eflValidator";

describe("EFL validator - TDSP extraction avoids Energy Charge false positives (Gexa Light Saver 12)", () => {
  it("extracts TDSP per-kWh from the explicit 'TDU Delivery Charges ... ¢ per kWh' line (not the Energy Charge)", () => {
    const rawText = `
Electricity Facts Label (EFL)
Gexa Energy, LP • PUCT Cert. #10027
Gexa Light Saver 12
Oncor Electric
Date:12/15/2025

Average Price per kWh 17.9 ¢ 16.7 ¢ 15.7 ¢
The price you pay each month includes the Energy Charge, Monthly Service Fee and TDU Delivery Charges
in effect for your monthly billing cycle.
Energy Charge                                            9.9000 ¢ per kWh

Monthly Service Fee                                      $8.00 per billing cycle for usage (<= 1999) kWh
Electricity Price       TDU Delivery Charges                                     $4.23 per billing cycle

TDU Delivery Charges                                     5.5833 ¢ per kWh
`.trim();

    const tdsp = extractEflTdspCharges(rawText);
    expect(tdsp.monthlyCents).toBe(423);
    expect(tdsp.perKwhCents).toBeCloseTo(5.5833, 6);
  });
});


