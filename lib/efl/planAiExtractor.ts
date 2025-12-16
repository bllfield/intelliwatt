/**
 * EFL AI Extraction Layer backed by OpenAI (production implementation).
 *
 * Wraps the generic extraction contract in `lib/efl/aiExtraction.ts` with a
 * concrete OpenAI caller that uses the dedicated fact-card env var
 * OPENAI_IntelliWatt_Fact_Card_Parser.
 */

import type {
  PlanRules,
  RateStructure,
  PlanRulesValidationResult,
} from "@/lib/efl/planEngine";
import {
  type EflDeterministicExtractInput,
  type ExtractPlanRulesResult,
  extractPlanRulesFromEflText as coreExtractPlanRulesFromEflText,
} from "@/lib/efl/aiExtraction";
import { getOpenAiClient } from "@/lib/ai/openaiFactCardParser";
import { planRulesToRateStructure, validatePlanRules } from "@/lib/efl/planEngine";
import { logOpenAIUsage } from "@/lib/admin/openaiUsage";

export type EflTextExtractionInput = EflDeterministicExtractInput;

export interface PlanRulesExtractionOptions {
  planTypeHint?: string | null;
  conservative?: boolean;
}

export interface PlanRulesExtractionMeta {
  parseConfidence: number;
  parseWarnings: string[];
  source: "efl_pdf" | string;
  // Optional validation summary indicating whether the plan is safe to auto-use.
  validation?: PlanRulesValidationResult;
}

export interface PlanRulesExtractionResult {
  ok: boolean;
  input: EflTextExtractionInput;
  planRules: PlanRules | null;
  meta: PlanRulesExtractionMeta;
  error?: string;
}

async function callOpenAiPlanRulesModel(args: {
  prompt: string;
  extract: EflDeterministicExtractInput;
}): Promise<unknown> {
  if (process.env.OPENAI_IntelliWatt_Fact_Card_Parser !== "1") {
    throw new Error(
      "OPENAI_IntelliWatt_Fact_Card_Parser is not enabled; cannot run EFL Fact Card AI extraction.",
    );
  }

  const client = getOpenAiClient();
  if (!client) {
    throw new Error(
      "OPENAI_API_KEY is not configured; cannot run EFL Fact Card AI extraction.",
    );
  }

  const completion = await (client as any).chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      {
        role: "system",
        content:
          "You are an expert Texas Electricity Facts Label (EFL) parser. " +
          "You MUST return ONLY strict JSON matching the requested schema. " +
          "Do not include explanations or commentary.",
      },
      {
        role: "user",
        content: args.prompt,
      },
    ],
    temperature: 0,
    response_format: { type: "json_object" },
  });

  const usage = (completion as any).usage;
  if (usage) {
    const inputTokens = usage.prompt_tokens ?? usage.input_tokens ?? 0;
    const outputTokens = usage.completion_tokens ?? usage.output_tokens ?? 0;
    const totalTokens = usage.total_tokens ?? inputTokens + outputTokens;

    const inputCost = (inputTokens / 1000) * 0.00025;
    const outputCost = (outputTokens / 1000) * 0.00075;
    const costUsd = inputCost + outputCost;

    await logOpenAIUsage({
      module: "efl-fact-card",
      operation: "plan-rules-extract-v1",
      model: (completion as any).model ?? "gpt-4.1-mini",
      inputTokens,
      outputTokens,
      totalTokens,
      costUsd,
      requestId: (completion as any).id ?? null,
      userId: null,
      houseId: null,
      metadata: {
        source: "efl-fact-card",
      },
    });
  }

  const content = completion.choices[0]?.message?.content ?? "";
  if (!content) {
    throw new Error("Empty response from OpenAI fact card model.");
  }

  return JSON.parse(content);
}

export async function extractPlanRulesFromEflText(
  input: EflTextExtractionInput,
  _opts: PlanRulesExtractionOptions = {},
): Promise<PlanRulesExtractionResult> {
  try {
    const coreResult: ExtractPlanRulesResult = await coreExtractPlanRulesFromEflText(
      input,
      callOpenAiPlanRulesModel,
    );

    const validation = validatePlanRules(coreResult.planRules);

    return {
      ok: true,
      input,
      planRules: coreResult.planRules,
      meta: {
        parseConfidence: coreResult.parseConfidence,
        parseWarnings: coreResult.parseWarnings,
        source: coreResult.source,
        validation,
      },
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to extract PlanRules from EFL text.";

    return {
      ok: false,
      input,
      planRules: null,
      meta: {
        parseConfidence: 0,
        parseWarnings: [message],
        source: "efl_pdf",
      },
      error: message,
    };
  }
}

export async function extractPlanRulesAndRateStructureFromEflText(args: {
  input: EflTextExtractionInput;
  options?: PlanRulesExtractionOptions;
}): Promise<{
  planRules: PlanRules | null;
  rateStructure: RateStructure | null;
  meta: PlanRulesExtractionMeta;
}> {
  const result = await extractPlanRulesFromEflText(args.input, args.options);

  if (!result.ok || !result.planRules) {
    return {
      planRules: null,
      rateStructure: null,
      meta: result.meta,
    };
  }

  const validation = result.meta.validation;
  const requiresManualReview = validation?.requiresManualReview === true;

  // If the plan is structurally incomplete or ambiguous, do NOT produce a RateStructure.
  if (requiresManualReview) {
    return {
      planRules: result.planRules,
      rateStructure: null,
      meta: result.meta,
    };
  }

  const rateStructure = planRulesToRateStructure(result.planRules);

  return {
    planRules: result.planRules,
    rateStructure,
    meta: result.meta,
  };
}

/**
 * Vision-based fallback: when PDF text extraction fails or is unusable,
 * call OpenAI with the EFL URL as an image/document source and ask it
 * to produce PlanRules JSON directly.
 *
 * NOTE: We assume the EFL URL is publicly accessible so OpenAI can fetch it.
 */
export async function extractPlanRulesAndRateStructureFromEflUrlVision(args: {
  eflUrl: string;
  inputMeta: EflTextExtractionInput;
}): Promise<{
  planRules: PlanRules | null;
  rateStructure: RateStructure | null;
  meta: PlanRulesExtractionMeta;
}> {
  if (process.env.OPENAI_IntelliWatt_Fact_Card_Parser !== "1") {
    return {
      planRules: null,
      rateStructure: null,
      meta: {
        parseConfidence: 0,
        parseWarnings: [
          "Vision fallback skipped: OPENAI_IntelliWatt_Fact_Card_Parser is not enabled.",
        ],
        source: "efl_pdf",
      },
    };
  }

  const client = getOpenAiClient();
  if (!client) {
    return {
      planRules: null,
      rateStructure: null,
      meta: {
        parseConfidence: 0,
        parseWarnings: [
          "Vision fallback skipped: OPENAI_API_KEY is not configured.",
        ],
        source: "efl_pdf",
      },
    };
  }

  const systemPrompt =
    "You are an expert Texas Electricity Facts Label (EFL) parser. " +
    "You are given a link to an EFL document (PDF or image). " +
    "Read the EFL visually and return ONLY strict JSON matching the PlanRules schema " +
    "defined for the IntelliWatt EFL Fact Card engine. " +
    "Do NOT guess values; leave unknown fields null or omit them.";

  const completion = await (client as any).chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: "Parse this EFL from the link and return PlanRules JSON only.",
          },
          {
            type: "input_image_url",
            image_url: args.eflUrl,
          },
        ],
      } as any,
    ],
    temperature: 0,
    response_format: { type: "json_object" },
  });

  const usage = (completion as any).usage;
  if (usage) {
    const inputTokens = usage.prompt_tokens ?? usage.input_tokens ?? 0;
    const outputTokens = usage.completion_tokens ?? usage.output_tokens ?? 0;
    const totalTokens = usage.total_tokens ?? inputTokens + outputTokens;
    const inputCost = (inputTokens / 1000) * 0.00025;
    const outputCost = (outputTokens / 1000) * 0.00075;
    const costUsd = inputCost + outputCost;

    await logOpenAIUsage({
      module: "efl-fact-card",
      operation: "plan-rules-vision-fallback-v1",
      model: (completion as any).model ?? "gpt-4.1-mini",
      inputTokens,
      outputTokens,
      totalTokens,
      costUsd,
      requestId: (completion as any).id ?? null,
      userId: null,
      houseId: null,
      metadata: {
        source: "efl-fact-card-vision",
        eflUrl: args.eflUrl,
        eflPdfSha256: args.inputMeta.eflPdfSha256,
        repPuctCertificate: args.inputMeta.repPuctCertificate,
        eflVersionCode: args.inputMeta.eflVersionCode,
      },
    });
  }

  const content = completion.choices[0]?.message?.content ?? "";
  if (!content) {
    return {
      planRules: null,
      rateStructure: null,
      meta: {
        parseConfidence: 0,
        parseWarnings: ["Empty response from OpenAI vision fallback."],
        source: "efl_pdf",
      },
    };
  }

  try {
    const parsed = JSON.parse(content);
    const planRules = (parsed.planRules ?? parsed) as PlanRules | null;
    const parseConfidence =
      typeof parsed.parseConfidence === "number" ? parsed.parseConfidence : 0.7;
    const parseWarnings: string[] = Array.isArray(parsed.parseWarnings)
      ? parsed.parseWarnings
      : [];

    const validation = planRules ? validatePlanRules(planRules) : undefined;
    const requiresManualReview = validation?.requiresManualReview === true;

    if (!planRules) {
      return {
        planRules: null,
        rateStructure: null,
        meta: {
          parseConfidence,
          parseWarnings: [
            ...parseWarnings,
            "Vision fallback did not return a planRules object.",
          ],
          source: "efl_pdf",
          validation,
        },
      };
    }

    if (requiresManualReview) {
      return {
        planRules,
        rateStructure: null,
        meta: {
          parseConfidence,
          parseWarnings,
          source: "efl_pdf",
          validation,
        },
      };
    }

    const rateStructure = planRulesToRateStructure(planRules);

    return {
      planRules,
      rateStructure,
      meta: {
        parseConfidence,
        parseWarnings,
        source: "efl_pdf",
        validation,
      },
    };
  } catch (err) {
    return {
      planRules: null,
      rateStructure: null,
      meta: {
        parseConfidence: 0,
        parseWarnings: [
          `Vision fallback JSON parse error: ${
            err instanceof Error ? err.message : String(err)
          }`,
        ],
        source: "efl_pdf",
      },
    };
  }
}
