import { Buffer } from "node:buffer";

import { openaiFactCardParser } from "@/lib/ai/openaiFactCardParser";

export interface EflAiParseResult {
  planRules: any | null;
  rateStructure: any | null;
  parseConfidence: number;
  parseWarnings: string[];
}

export async function parseEflPdfWithAi(opts: {
  pdfBytes: Uint8Array | Buffer;
  eflPdfSha256: string;
}): Promise<EflAiParseResult> {
  const { pdfBytes, eflPdfSha256 } = opts;

  if (!process.env.OPENAI_IntelliWatt_Fact_Card_Parser) {
    return {
      planRules: null,
      rateStructure: null,
      parseConfidence: 0,
      parseWarnings: [
        "OPENAI_IntelliWatt_Fact_Card_Parser is not configured; cannot run EFL AI PDF parser.",
      ],
    };
  }

  try {
    // Wrap pdfBytes into something acceptable by the OpenAI Node SDK.
    // If you already have a helper for file uploads, reuse it here instead of this direct call.
    const file = await (openaiFactCardParser as any).files.create({
      file: {
        // Adjust if your SDK expects a different shape; this is a common pattern.
        name: `${eflPdfSha256}.pdf`,
        content: Buffer.isBuffer(pdfBytes) ? pdfBytes : Buffer.from(pdfBytes),
      } as any,
      purpose: "vision",
    });

    const systemPrompt = `
You are an expert Texas Electricity Facts Label (EFL) parser.

You will be given an EFL PDF file as input. Using ONLY the content of that PDF as the source of truth, extract detailed pricing rules into a JSON object with this structure.

CRITICAL GUARDRAILS:
- You MUST NOT guess, approximate, or invent any numeric value (rates, fees, credits, thresholds).
- If the EFL does not clearly provide a value, you MUST leave that field null or omit it,
  and you may include a parse warning instead.
- Do not fill in 'typical' values or make assumptions beyond what the EFL explicitly states.

IDENTITY CONTEXT:
EFL PDF SHA-256: ${eflPdfSha256}

OUTPUT CONTRACT:
Return a single JSON object with the following top-level fields:

{
  "planRules": {
    "planType": string,
    "defaultRateCentsPerKwh": number | null,
    "baseChargePerMonthCents": number | null,
    "rateType": "FIXED" | "VARIABLE" | "TIME_OF_USE" | null,
    "variableIndexType": "ERCOT" | "FUEL" | "OTHER" | null,
    "currentBillEnergyRateCents": number | null,
    "timeOfUsePeriods": [
      {
        "label": string,
        "startHour": number,
        "endHour": number,
        "daysOfWeek": number[],
        "months": number[] | null,
        "rateCentsPerKwh": number | null,
        "isFree": boolean
      }
    ],
    "solarBuyback": {
      "hasBuyback": boolean,
      "creditCentsPerKwh": number | null,
      "matchesImportRate": boolean | null,
      "maxMonthlyExportKwh": number | null,
      "notes": string | null
    } | null,
    "usageTiers": [
      {
        "minKwh": number,
        "maxKwh": number | null,
        "rateCentsPerKwh": number
      }
    ] | null,
    "billCredits": [
      {
        "label": string,
        "creditDollars": number,
        "thresholdKwh": number | null,
        "monthsOfYear": number[] | null,
        "type": "USAGE_THRESHOLD" | "BEHAVIOR" | "OTHER" | null
      }
    ]
  },
  "rateStructure": {
    "type": "FIXED" | "VARIABLE" | "TIME_OF_USE" | null,
    "baseMonthlyFeeCents": number | null,
    "fixed": {
      "energyRateCents": number | null
    } | null,
    "variable": {
      "currentBillEnergyRateCents": number | null,
      "indexType": "ERCOT" | "FUEL" | "OTHER" | null,
      "variableNotes": string | null
    } | null,
    "timeOfUse": {
      "tiers": [
        {
          "label": string,
          "priceCents": number | null,
          "startTime": string | null,
          "endTime": string | null,
          "daysOfWeek": number[] | null,
          "monthsOfYear": number[] | null
        }
      ] | null
    } | null,
    "billCredits": {
      "rules": [
        {
          "label": string,
          "creditAmountCents": number | null,
          "minUsageKWh": number | null,
          "maxUsageKWh": number | null,
          "monthsOfYear": number[] | null
        }
      ] | null
    } | null
  } | null,
  "parseConfidence": number,
  "parseWarnings": string[],
  "source": "efl_pdf"
}

RULES:
- Use ONLY the EFL PDF to determine prices, TOU windows, base charges,
  bill credits, solar buyback rules, and any identifying fields such as the Ver. # code,
  PUCT certificate number if present, and plan name/label.
- If a field is not explicitly stated, set it to null or an empty array.
- Do NOT guess, approximate, or invent any numeric value (rates, fees, credits, thresholds).
- For free nights/weekends, represent the free window as a timeOfUsePeriod
  with isFree = true and rateCentsPerKwh = null (or 0 only if the EFL explicitly says 0),
  and set planRules.rateType = "TIME_OF_USE".
- For kWh tiered plans, express each band in usageTiers with correct minKwh, maxKwh, and rateCentsPerKwh.
- For usage-based bill credits and behavioral credits, fill billCredits appropriately as described.
- Do NOT fold TDSP delivery charges into defaultRateCentsPerKwh unless the EFL clearly presents a combined rate.
- Always return STRICT JSON with double-quoted keys/strings and no comments or trailing commas.
  `;

    const response = await (openaiFactCardParser as any).responses.create({
      model: "gpt-5.1-mini",
      response_format: { type: "json_object" },
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
              text: "Here is the EFL PDF file. Use ONLY this PDF as the source of truth.",
            },
            {
              type: "input_file",
              file_id: file.id,
            },
          ],
        },
      ],
    });

    const output = (response as any).output?.[0]?.content?.[0]?.text ?? "{}";
    let parsed: any;
    try {
      parsed = JSON.parse(output);
    } catch (err) {
      return {
        planRules: null,
        rateStructure: null,
        parseConfidence: 0,
        parseWarnings: [
          `Failed to parse EFL AI response JSON: ${
            err instanceof Error ? err.message : String(err)
          }`,
        ],
      };
    }

    return {
      planRules: parsed.planRules ?? null,
      rateStructure: parsed.rateStructure ?? null,
      parseConfidence:
        typeof parsed.parseConfidence === "number" ? parsed.parseConfidence : 0,
      parseWarnings: Array.isArray(parsed.parseWarnings)
        ? parsed.parseWarnings
        : [],
    };
  } catch (err) {
    return {
      planRules: null,
      rateStructure: null,
      parseConfidence: 0,
      parseWarnings: [
        `EFL AI PDF parser failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      ],
    };
  }
}
