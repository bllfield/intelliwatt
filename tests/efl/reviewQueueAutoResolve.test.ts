import { describe, expect, test } from "vitest";

import { requiresStrongTemplateMatchForQueueItem } from "@/lib/efl/reviewQueueAutoResolve";

describe("review queue auto-resolve guardrails", () => {
  test("requires a strong match for WattBuy fetch-failed rows with no parsed identity", () => {
    expect(
      requiresStrongTemplateMatchForQueueItem({
        source: "wattbuy_batch",
        finalStatus: "SKIP",
        queueReason:
          "EFL fetch failed: EFL URL did not return a PDF, and no 'Electricity Facts Label' PDF link was found on the page.",
        rawText: null,
        planRules: null,
        rateStructure: null,
        repPuctCertificate: null,
        eflVersionCode: null,
      }),
    ).toBe(true);
  });

  test("allows URL-based self-heal after a real parse produced identity evidence", () => {
    expect(
      requiresStrongTemplateMatchForQueueItem({
        source: "wattbuy_batch",
        finalStatus: "SKIP",
        queueReason: "PIPELINE_NOT_ELIGIBLE: status=SKIP",
        rawText: "Electricity Facts Label ...",
        planRules: { rateType: "INDEXED" },
        rateStructure: { type: "INDEXED" },
        repPuctCertificate: "10123",
        eflVersionCode: "EFL_SAMPLE_20260101",
      }),
    ).toBe(false);
  });
});
