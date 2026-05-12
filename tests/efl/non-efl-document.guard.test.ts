import { describe, expect, it } from "vitest";

import { classifyEflDocument } from "@/lib/efl/eflDocumentGuard";
import { runEflPipelineFromRawTextNoStore } from "@/lib/efl/runEflPipelineFromRawTextNoStore";
import { runEflPipelineNoStore } from "@/lib/efl/runEflPipelineNoStore";

const championTosText = `
TERMS OF SERVICE
ERCOT Residential
Terms of Service
The following Terms of Service (TOS) will apply to residential customers who select Champion Energy Services, LLC.
This TOS, combined with Your Rights as a Customer (YRAC), Electricity Facts Label (EFL), and welcome letter collectively
constitute your contract with Champion.
REP: Champion Energy Services, LLC
PUCT No. 10098
PRODUCT TYPES
Champion offers the following product types. Your product will be as specified on your EFL.
PRICING
Champion will bill you the Energy Charge for your Contract Term. Your Energy Charge is a per kWh charge as set forth in
the Electricity Price section of your EFL. Champion will bill you for your TDU Delivery Charges, which will be passed through
to you at cost and are subject to change during or after the Contract Term.
Version: Champion-RES-TX-TOS-062424
`.trim();

const minimalEflText = `
Electricity Facts Label (EFL)
Champion Energy Services
Green Energy-24
Average Monthly Use (Residential) 500 kWh 1000 kWh 2000 kWh
Average Price per Kilowatt-hour 17.1¢ 16.4¢ 16.0¢
Electricity Price
Energy Charge 10.0¢ per kWh
Base Charge $0.00 per month
TDU Delivery Charges are passed through without markup.
`.trim();

describe("non-EFL document guard", () => {
  it("classifies Champion Terms of Service text as a non-EFL document", () => {
    const result = classifyEflDocument(championTosText);

    expect(result.isEfl).toBe(false);
    expect(result.documentKind).toBe("TERMS_OF_SERVICE");
    expect(result.reason).toContain("NON_EFL_DOCUMENT");
  });

  it("does not reject a real EFL that has an average price table", () => {
    const result = classifyEflDocument(minimalEflText);

    expect(result.isEfl).toBe(true);
    expect(result.documentKind).toBe("EFL");
  });

  it("raw-text pipeline skips TOS documents before parser/solver work", async () => {
    const result = await runEflPipelineFromRawTextNoStore({
      rawText: championTosText,
      eflPdfSha256: "tos_sha",
      source: "queue_rawtext",
    });

    expect(result.finalValidation?.status).toBe("SKIP");
    expect(result.finalValidation?.queueReason).toContain("Terms of Service");
    expect(result.planRules).toBeNull();
    expect(result.rateStructure).toBeNull();
    expect(result.needsAdminReview).toBe(true);
  });

  it("PDF-backed pipeline skips TOS documents after text extraction", async () => {
    const result = await runEflPipelineNoStore({
      pdfBytes: Buffer.from("fake-pdf"),
      source: "wattbuy",
      extractPdfText: async () => championTosText,
    });

    expect(result.finalValidation?.status).toBe("SKIP");
    expect(result.finalValidation?.queueReason).toContain("Terms of Service");
    expect(result.deterministic.rawText).toContain("TERMS OF SERVICE");
    expect(result.planRules).toBeNull();
  });
});

