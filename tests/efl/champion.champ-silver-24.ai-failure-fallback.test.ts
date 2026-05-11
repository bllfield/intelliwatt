import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/openaiFactCardParser", () => ({
  factCardAiEnabled: () => true,
  getOpenAiClient: () => ({
    responses: {
      create: vi.fn(async () => {
        throw new Error("429 quota exceeded");
      }),
    },
  }),
}));

vi.mock("@/lib/admin/openaiUsage", () => ({
  logOpenAIUsage: vi.fn(async () => undefined),
}));

import { parseEflTextWithAi } from "@/lib/efl/eflAiParser";

const CHAMP_SILVER_24_RAW_TEXT = `
Electricity Facts Label
Champion Energy Services, LLC PUC #10098
Residential Service => Champ Silver-24
Oncor Electric Delivery
5/11/2026
Electricity Price
Average Monthly Use:                        500 kWh                1,000 kWh              2,000 kWh
Average price per kilowatt-hour :
Oncor Electric Delivery                       14.7¢                  14.2¢                   14.0¢
This price disclosure reflects the total average price for electric service including all applicable charges listed below and
PUC Assessment, and is exclusive of state and local sales taxes. Your average price per kilowatt-hour will vary based
on your actual usage.
Champion Energy Charges                                         Delivery Charges from
Energy Charge                                                    Oncor Electric Delivery
Base Charge                                      per kWh       per month
(per kWh)
8.2¢/kWh         $0.00                                      5.6183¢/kWh        $4.23
Disclosure Chart
Type of Product                                       Fixed Rate
Contract Term                                         24 Month(s)
EFL Version: FIXED-EFL-20251211
`.trim();

describe("EFL parser fallback - Champion Champ Silver-24 on AI failure", () => {
  it("falls back to deterministic fixed-rate parsing when the AI call fails", async () => {
    const res = await parseEflTextWithAi({
      rawText: CHAMP_SILVER_24_RAW_TEXT,
      eflPdfSha256: "fixture-champion-champ-silver-24",
      extraWarnings: [],
    });

    expect(res.planRules).toBeTruthy();
    expect(res.rateStructure).toBeTruthy();

    expect(res.planRules.rateType).toBe("FIXED");
    expect((res.planRules as any).planType).toBe("flat");
    expect((res.planRules as any).termMonths).toBe(24);
    expect((res.planRules as any).defaultRateCentsPerKwh).toBeCloseTo(8.2, 6);
    expect((res.planRules as any).currentBillEnergyRateCents).toBeCloseTo(8.2, 6);

    const validation = (res.validation as any)?.eflAvgPriceValidation ?? null;
    expect(validation).toBeTruthy();
    expect(validation.status).toBe("PASS");
    expect(
      Array.isArray(res.parseWarnings) &&
        res.parseWarnings.some((w: string) => w.includes("EFL AI text call failed: 429 quota exceeded")),
    ).toBe(true);
  });
});
