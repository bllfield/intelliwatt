import type { PlanRules } from "./planEngine";

/**
 * Input shape for AI extraction based on deterministicEflExtract.
 * Mirrors the planning doc contract.
 */
export interface EflDeterministicExtractInput {
  rawText: string;
  repPuctCertificate: string | null;
  eflVersionCode: string | null;
  eflPdfSha256: string;
  warnings?: string[];
}

/**
 * Result of AI-based PlanRules extraction for a single EFL version.
 */
export interface ExtractPlanRulesResult {
  planRules: PlanRules;
  parseConfidence: number;
  parseWarnings: string[];
  source: "efl_pdf";
}

/**
 * Injectable model caller abstraction. Higher layers decide how to call an LLM.
 */
export type PlanRulesModelCaller = (args: {
  prompt: string;
  extract: EflDeterministicExtractInput;
}) => Promise<unknown>;

/**
 * Build the strict prompt used to convert EFL text into PlanRules JSON.
 */
export function buildPlanRulesExtractionPrompt(
  extract: EflDeterministicExtractInput,
): string {
  const { repPuctCertificate, eflVersionCode, eflPdfSha256 } = extract;

  const identityLines: string[] = [];
  if (repPuctCertificate) {
    identityLines.push(`REP PUCT Certificate: ${repPuctCertificate}`);
  }
  if (eflVersionCode) {
    identityLines.push(`EFL Version Code (Ver. #): ${eflVersionCode}`);
  }
  identityLines.push(`EFL PDF SHA-256: ${eflPdfSha256}`);

  const identityBlock = identityLines.join("\n");

  return [
    "You are an expert Texas Electricity Facts Label (EFL) parser.",
    "You will be given normalized EFL text. Using ONLY that EFL text as the",
    "source of truth, you must extract detailed pricing rules into a JSON object",
    "with a specific structure. Do not invent data; if a field is missing or",
    "unclear in the EFL, you must use null or an empty array for that field.",
    "",
    "IDENTITY CONTEXT:",
    identityBlock,
    "",
    "OUTPUT CONTRACT:",
    "Return a single JSON object with the following top-level fields:",
    "",
    "  {",
    '    "planRules": {',
    '      "planType": string,',
    '      "defaultRateCentsPerKwh": number | null,',
    '      "baseChargePerMonthCents": number | null,',
    '      "timeOfUsePeriods": [',
    "        {",
    '          "label": string,',
    '          "startHour": number,',
    '          "endHour": number,',
    '          "daysOfWeek": number[],',
    '          "months": number[] | null,',
    '          "rateCentsPerKwh": number | null,',
    '          "isFree": boolean',
    "        }",
    "      ],",
    '      "solarBuyback": {',
    '        "hasBuyback": boolean,',
    '        "creditCentsPerKwh": number | null,',
    '        "matchesImportRate": boolean | null,',
    '        "maxMonthlyExportKwh": number | null,',
    '        "notes": string | null',
    "      } | null,",
    '      "billCredits": [',
    "        {",
    '          "thresholdKwh": number,',
    '          "creditDollars": number',
    "        }",
    "      ]",
    "    },",
    '    "parseConfidence": number,',
    '    "parseWarnings": string[],',
    '    "source": "efl_pdf"',
    "  }",
    "",
    "RULES:",
    "- Use ONLY the EFL text to determine prices, TOU windows, base charges,",
    "  bill credits, and solar buyback rules.",
    "- If a field is not explicitly stated, set it to null or an empty array.",
    "- Do NOT invent or approximate values.",
    "- For free nights/weekends, represent the free window as a timeOfUsePeriod",
    '  with isFree = true and rateCentsPerKwh = 0.',
    "- For non-free periods, use rateCentsPerKwh and isFree = false.",
    "- If the EFL describes TDSP delivery charges, do NOT fold them into",
    "  defaultRateCentsPerKwh unless the EFL clearly presents a combined rate.",
    '- Always return STRICT JSON, with double-quoted keys and strings, and no',
    "  comments or trailing commas.",
    "",
    "EFL TEXT (NORMALIZED):",
    extract.rawText,
  ].join("\n");
}

/**
 * Validate and normalize an arbitrary candidate value into ExtractPlanRulesResult.
 */
export function normalizeExtractPlanRulesResult(
  candidate: unknown,
): ExtractPlanRulesResult {
  if (!candidate || typeof candidate !== "object") {
    throw new Error("AI PlanRules response is not an object");
  }

  const anyCandidate = candidate as Record<string, unknown>;
  const planRules = anyCandidate.planRules as PlanRules | undefined;

  if (!planRules || typeof planRules !== "object") {
    throw new Error("AI PlanRules response is missing a valid 'planRules' object");
  }

  let parseConfidence = Number(anyCandidate.parseConfidence);
  if (!Number.isFinite(parseConfidence)) {
    parseConfidence = 0;
  }
  if (parseConfidence < 0) parseConfidence = 0;
  if (parseConfidence > 1) parseConfidence = 1;

  const rawWarnings = anyCandidate.parseWarnings;
  let parseWarnings: string[] = [];
  if (Array.isArray(rawWarnings)) {
    parseWarnings = rawWarnings
      .filter((w): w is string => typeof w === "string")
      .map((w) => w.trim())
      .filter((w) => w.length > 0);
  }

  return {
    planRules,
    parseConfidence,
    parseWarnings,
    source: "efl_pdf",
  };
}

/**
 * High-level helper implementing the Step 3 contract.
 */
export async function extractPlanRulesFromEflText(
  extract: EflDeterministicExtractInput,
  callModel: PlanRulesModelCaller,
): Promise<ExtractPlanRulesResult> {
  if (!extract || typeof extract.rawText !== "string" || !extract.rawText.trim()) {
    throw new Error("extractPlanRulesFromEflText: missing or empty rawText");
  }

  const prompt = buildPlanRulesExtractionPrompt(extract);

  const raw = await callModel({ prompt, extract });

  let parsed: unknown = raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      throw new Error(
        `Failed to parse AI PlanRules response as JSON: ${(err as Error).message}`,
      );
    }
  }

  return normalizeExtractPlanRulesResult(parsed);
}

