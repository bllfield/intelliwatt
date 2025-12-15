import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parseEflTextWithAi } from "@/lib/efl/eflAiParser";

describe("EFL pipeline (deterministic) — Champion Free Weekends 24", () => {
  it("extracts weekday/weekend TOU, base charge $0, and PASSes avg-price validation using weekend/weekday split", async () => {
    // Force deterministic-only path (no OpenAI calls). This codebase only
    // treats the flag as enabled when it is exactly "1".
    delete process.env.OPENAI_IntelliWatt_Fact_Card_Parser;
    delete process.env.OPENAI_FACT_CARD_API_KEY;
    delete process.env.OPENAI_API_KEY;

    const rawText = readFileSync(
      resolve(process.cwd(), "fixtures/efl/champion-free-weekends-24.txt"),
      "utf8",
    );

    const res = await parseEflTextWithAi({
      rawText,
      eflPdfSha256: "fixture-champion-free-weekends-24",
      extraWarnings: [],
    });

    expect(res.planRules).toBeTruthy();
    expect(res.planRules.rateType).toBe("TIME_OF_USE");
    expect((res.planRules as any).planType).toBe("free-weekends");
    expect(res.planRules.baseChargePerMonthCents).toBe(0);

    expect(Array.isArray(res.planRules.timeOfUsePeriods)).toBe(true);
    expect(res.planRules.timeOfUsePeriods.length).toBeGreaterThanOrEqual(2);

    const validation = (res.validation as any)?.eflAvgPriceValidation ?? null;
    expect(validation).toBeTruthy();
    expect(validation.status).toBe("PASS");

    const pts = Array.isArray(validation.points) ? validation.points : [];
    expect(pts.length).toBe(3);
    for (const p of pts) {
      expect(p.modeledAvgCentsPerKwh).not.toBeNull();
      expect(p.ok).toBe(true);
    }
  });
});


