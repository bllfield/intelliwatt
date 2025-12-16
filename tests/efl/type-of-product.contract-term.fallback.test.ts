import { describe, expect, it } from "vitest";

import { parseEflTextWithAi } from "@/lib/efl/eflAiParser";

describe("EFL parser fallbacks - Type of Product / Contract Term (column format)", () => {
  it("detects VARIABLE rateType and 1-month term when disclosure chart is column-aligned (no colon)", async () => {
    delete process.env.OPENAI_IntelliWatt_Fact_Card_Parser;
    delete process.env.OPENAI_FACT_CARD_API_KEY;
    delete process.env.OPENAI_API_KEY;

    const rawText = `
Electricity Facts Label

Disclosure Chart
Type of Product                                         Variable Rate
Contract Term                                           1 Month

Electricity Price
Energy Charge                                            14.3000 ¢ per kWh
`.trim();

    const res = await parseEflTextWithAi({
      rawText,
      eflPdfSha256: "fixture-type-of-product-column",
      extraWarnings: [],
    });

    expect(res.planRules).toBeTruthy();
    expect(res.planRules.rateType).toBe("VARIABLE");
    expect((res.planRules as any).termMonths).toBe(1);
  });
});


