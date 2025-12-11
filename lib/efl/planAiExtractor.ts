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
import { openaiFactCardParser } from "@/lib/ai/openaiFactCardParser";
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
  if (!process.env.OPENAI_IntelliWatt_Fact_Card_Parser) {
    throw new Error(
      "OPENAI_IntelliWatt_Fact_Card_Parser is not configured; cannot run EFL Fact Card AI extraction.",
    );
  }

  const completion = await openaiFactCardParser.chat.completions.create({
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

    void logOpenAIUsage({
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
