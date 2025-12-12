import { Buffer } from "node:buffer";

import { openaiFactCardParser } from "@/lib/ai/openaiFactCardParser";

export interface EflAiParseResult {
  planRules: any | null;
  rateStructure: any | null;
  parseConfidence: number;
  parseWarnings: string[];
}

function filterParseWarnings(warnings: string[]): string[] {
  const ignorePatterns = [
    /TDU\b/i,
    /\bTDSP\b/i,
    /transmission and distribution/i,
    /underground facilities and cost recovery/i,
    /sales taxes? (are )?not included/i,
    /non-recurring fees?/i,
    /deposit requirements?/i,
    /terms of service/i,
  ];

  return warnings.filter(
    (w) => !ignorePatterns.some((rx) => rx.test(w)),
  );
}

// Guardrail: the slicer below may ONLY change the AI INPUT text. It must never
// remove or alter any fields from the EflAiParseResult output. If normalization
// produces text that is too small, we fail-open back to the original text.
function normalizeEflTextForAi(rawText: string): {
  text: string;
  notes: string[];
  droppedHints: string[];
  keptSections: string[];
  usedFallback: boolean;
} {
  const lines = rawText.split(/\r?\n/);
  const out: string[] = [];
  const notes: string[] = [];
  const droppedHints: string[] = [];
  const keptSections: string[] = [];

  let skippingAverages = false;
  let skippedAverages = false;
  let skippingTdu = false;
  let skippedTdu = false;

  for (const line of lines) {
    const trimmed = line.trim();
    const lower = trimmed.toLowerCase();

    // Start skipping "Average Monthly Use / Average Price per kWh" block.
    if (!skippingAverages && /average monthly use/i.test(trimmed)) {
      skippingAverages = true;
      skippedAverages = true;
      const hint = "Removed Average Monthly Use / Average Price per kWh table.";
      notes.push(hint);
      droppedHints.push(hint);
      continue;
    }

    if (skippingAverages) {
      // End of averages block: when we hit Base Charge, Type of Product, or Other Key terms.
      if (
        /base charge/i.test(trimmed) ||
        /your average price per kwh/i.test(trimmed) ||
        /^type of product/i.test(lower) ||
        /^other key/i.test(lower) ||
        /^terms and questions/i.test(lower)
      ) {
        skippingAverages = false;
        // Fall through to normal processing for this line.
      } else {
        continue;
      }
    }

    // Start skipping TDU Delivery Charges block.
    if (!skippingTdu && /tdu delivery charges/i.test(trimmed)) {
      skippingTdu = true;
      skippedTdu = true;
      notes.push("Removed TDU Delivery Charges passthrough block.");
      continue;
    }

    if (skippingTdu) {
      // End TDU block at blank or new section headers.
      if (
        trimmed === "" ||
        /^other key/i.test(lower) ||
        /^terms and questions/i.test(lower) ||
        /^type of product/i.test(lower)
      ) {
        skippingTdu = false;
        // Skip the current header line as well if it's just a section transition.
        if (trimmed === "") {
          continue;
        }
      } else {
        continue;
      }
    }

    // Drop known noisy lines even outside explicit blocks.
    if (/average prices per kwh listed above do not include/i.test(trimmed)) {
      const hint = "Removed average price disclaimer line.";
      notes.push(hint);
      droppedHints.push(hint);
      continue;
    }
    if (/for updated tdu delivery charges/i.test(lower)) {
      const hint = "Removed TDU delivery charges URL line.";
      notes.push(hint);
      droppedHints.push(hint);
      continue;
    }
    if (
      /passed through to customer as billed/i.test(lower) &&
      /tdu/i.test(lower)
    ) {
      const hint = "Removed generic TDU passthrough language.";
      notes.push(hint);
      droppedHints.push(hint);
      continue;
    }
    if (/sales tax|municipalfees|municipal fees/i.test(lower)) {
      const hint = "Removed generic tax/municipal fee language.";
      notes.push(hint);
      droppedHints.push(hint);
      continue;
    }

    out.push(line);
  }

  let normalized = out.join("\n");
  let usedFallback = false;

  // Fail-open safeguard: if the normalized text is too short, fall back
  // to the original raw text so downstream consumers still see a full EFL.
  const rawTrimmed = rawText.trim();
  if (normalized.trim().length < 200 && rawTrimmed.length > 0) {
    normalized = rawTrimmed;
    usedFallback = true;
    notes.push(
      "Slicer fallback: normalized EFL text was too short; using original text for AI input.",
    );
  } else {
    if (skippedAverages) {
      keptSections.push("Pricing components without Average Monthly Use table.");
    }
    if (skippedTdu) {
      keptSections.push("REP pricing sections without TDU passthrough blocks.");
    }
  }

  return {
    text: normalized,
    notes: Array.from(new Set(notes)),
    droppedHints: Array.from(new Set(droppedHints)),
    keptSections: Array.from(new Set(keptSections)),
    usedFallback,
  };
}

export async function parseEflTextWithAi(opts: {
  rawText: string;
  eflPdfSha256: string;
  extraWarnings?: string[];
}): Promise<EflAiParseResult> {
  const { rawText, eflPdfSha256, extraWarnings = [] } = opts;
  const {
    text: normalizedText,
    notes: normalizationNotes,
    usedFallback,
  } = normalizeEflTextForAi(rawText);

  const baseWarnings = [...extraWarnings, ...normalizationNotes];
  if (usedFallback) {
    baseWarnings.push(
      "Slicer fail-open: AI input uses original EFL text because normalized text was too short.",
    );
  }

  if (!process.env.OPENAI_IntelliWatt_Fact_Card_Parser) {
    return {
      planRules: null,
      rateStructure: null,
      parseConfidence: 0,
      // Infra/config error → do not filter; keep full message.
      parseWarnings: [
        ...baseWarnings,
        "OPENAI_IntelliWatt_Fact_Card_Parser is not configured; cannot run EFL AI text parser.",
      ],
    };
  }

  const systemPrompt = `
You are an expert Texas Electricity Facts Label (EFL) parser.

You will be given the normalized plain-text contents of an EFL PDF. Using ONLY this normalized text as the source of truth, extract detailed pricing rules into a JSON object with this structure.

CRITICAL GUARDRAILS:
- You MUST NOT guess, approximate, or invent any numeric value (rates, fees, credits, thresholds).
- If the EFL does not clearly provide a value, you MUST leave that field null or omit it,
  and you may include a parse warning instead.
- Do not fill in 'typical' values or make assumptions beyond what the EFL explicitly states.

SCOPE:
- Focus ONLY on REP (retail provider) energy charges, base monthly fees, usage tiers,
  bill credits, and core plan metadata (plan name, Ver. #, PUCT certificate number if present).
- Ignore any “Average Monthly Use / Average Price per kWh” tables.
- Ignore TDU/TDSP delivery charges entirely (handled by the Utility module), including passthrough
  language and underground facility charges.
- Ignore generic taxes/municipal fees and Terms of Service disclaimers unless they directly change
  the recurring REP charges in a way that cannot be represented in the contract.

PRICING COMPONENT FOCUS:
- Base Charge per month ($)
- Energy Charge tiered rates (¢/kWh) with min/max kWh
- Bill credits (e.g., "$50 if usage >= 800 kWh") as billCredits rules
- Product type (Fixed/Variable/TOU)
- Contract term
- Early cancellation fee amount

If any of these pricing components are missing from the normalized text:
- Set the corresponding field(s) to null.
- Add a parse warning describing what could not be extracted.

IDENTITY CONTEXT:
EFL PDF SHA-256: ${eflPdfSha256}

OUTPUT CONTRACT:
(same as the PDF-based contract; see planRules/rateStructure fields below)
`;

  let rawJson = "{}";
  try {
    const response = await (openaiFactCardParser as any).responses.create({
      model: process.env.OPENAI_EFL_MODEL || "gpt-4.1",
      text: { format: { type: "json_object" } },
      input: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Here is the normalized EFL text. Use ONLY this text as the source of truth.\n\n${normalizedText}`,
            },
          ],
        },
      ],
    });

    rawJson = (response as any).output?.[0]?.content?.[0]?.text ?? "{}";
  } catch (err: any) {
    const msg =
      err?.message ??
      (typeof err === "object" ? JSON.stringify(err) : String(err));

    return {
      planRules: null,
      rateStructure: null,
      parseConfidence: 0,
      // Infra/API error → do not filter; keep full message.
      parseWarnings: [
        ...baseWarnings,
        `EFL AI text call failed: ${msg}`,
      ],
    };
  }

  let parsed: any;
  try {
    parsed = JSON.parse(rawJson);
  } catch (err) {
    return {
      planRules: null,
      rateStructure: null,
      parseConfidence: 0,
      // JSON parse error → do not filter; keep full message.
      parseWarnings: [
        ...baseWarnings,
        `Failed to parse EFL AI text response JSON: ${
          err instanceof Error ? err.message : String(err)
        }`,
      ],
    };
  }

  const modelWarnings = Array.isArray(parsed.parseWarnings)
    ? parsed.parseWarnings
    : [];

  return {
    planRules: parsed.planRules ?? null,
    rateStructure: parsed.rateStructure ?? null,
    parseConfidence:
      typeof parsed.parseConfidence === "number" ? parsed.parseConfidence : 0,
    // Domain-level warnings from model are filtered; extraWarnings are kept verbatim.
    parseWarnings: [
      ...baseWarnings,
      ...filterParseWarnings(modelWarnings),
    ],
  };
}

export async function parseEflPdfWithAi(opts: {
  pdfBytes: Uint8Array | Buffer;
  eflPdfSha256: string;
  rawText?: string;
}): Promise<EflAiParseResult> {
  const { rawText, eflPdfSha256 } = opts;
  const text = (rawText ?? "").trim();

  if (!text) {
    return {
      planRules: null,
      rateStructure: null,
      parseConfidence: 0,
      parseWarnings: [
        "EFL rawText is empty; AI parse skipped.",
      ],
    };
  }

  return parseEflTextWithAi({
    rawText: text,
    eflPdfSha256,
  });
}
