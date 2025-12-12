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

export async function parseEflTextWithAi(opts: {
  rawText: string;
  eflPdfSha256: string;
  extraWarnings?: string[];
}): Promise<EflAiParseResult> {
  const { rawText, eflPdfSha256, extraWarnings = [] } = opts;

  if (!process.env.OPENAI_IntelliWatt_Fact_Card_Parser) {
    return {
      planRules: null,
      rateStructure: null,
      parseConfidence: 0,
      // Infra/config error → do not filter; keep full message.
      parseWarnings: [
        ...extraWarnings,
        "OPENAI_IntelliWatt_Fact_Card_Parser is not configured; cannot run EFL AI text parser.",
      ],
    };
  }

  const systemPrompt = `
You are an expert Texas Electricity Facts Label (EFL) parser.

You will be given the full plain-text contents of an EFL PDF. Using ONLY this text as the source of truth, extract detailed pricing rules into a JSON object with this structure.

CRITICAL GUARDRAILS:
- You MUST NOT guess, approximate, or invent any numeric value (rates, fees, credits, thresholds).
- If the EFL does not clearly provide a value, you MUST leave that field null or omit it,
  and you may include a parse warning instead.
- Do not fill in 'typical' values or make assumptions beyond what the EFL explicitly states.

SCOPE:
- Focus ONLY on REP (retail provider) energy charges, base monthly fees, usage tiers,
  bill credits, and core plan metadata (plan name, Ver. #, PUCT certificate number if present).
- Ignore TDU/TDSP delivery charges, underground facility charges, municipal fees, generic
  non-recurring fee disclaimers, and "see Terms of Service" notes unless they change the
  customer's recurring REP charges in a way that cannot be represented in the contract.

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
              text: `Here is the full EFL text. Use ONLY this text as the source of truth.\n\n${rawText}`,
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
        ...extraWarnings,
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
        ...extraWarnings,
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
      ...extraWarnings,
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
