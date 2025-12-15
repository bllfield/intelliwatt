import { Buffer } from "node:buffer";

import { deterministicEflExtract } from "@/lib/efl/eflExtractor";
import { parseEflTextWithAi } from "@/lib/efl/eflAiParser";
import { solveEflValidationGaps } from "@/lib/efl/validation/solveEflValidationGaps";

const MAX_PREVIEW_CHARS = 20000;

export type RunEflPipelineNoStoreArgs = {
  pdfBytes: Buffer;
  source?: "wattbuy" | "manual";
  offerMeta?: {
    supplier?: string | null;
    planName?: string | null;
    termMonths?: number | null;
    tdspName?: string | null;
    offerId?: string | null;
  } | null;
};

export type RunEflPipelineNoStoreResult = {
  deterministic: {
    eflPdfSha256: string | null;
    repPuctCertificate: string | null;
    eflVersionCode: string | null;
    extractorMethod: string;
    warnings: string[];
    rawText: string;
    rawTextPreview: string;
    rawTextLength: number;
    rawTextTruncated: boolean;
  };
  /**
   * PlanRules/RateStructure to present to callers. When the solver produces a
   * PASS `validationAfter`, these will reflect the derivedPlanRules/
   * derivedRateStructure from the solver; otherwise they mirror the raw AI
   * output.
   */
  planRules: any | null;
  rateStructure: any | null;
  parseConfidence: number | null;
  parseWarnings: string[];
  /**
   * Raw validator envelope as returned by the AI + validator stack.
   * Typically { eflAvgPriceValidation: EflAvgPriceValidation }.
   */
  validation: any | null;
  /**
   * Result from solveEflValidationGaps, if applied.
   * Contains derivedPlanRules/RateStructure + validationAfter + solverApplied[].
   */
  derivedForValidation: any | null;
  /**
   * Final validation object chosen for decision‑making:
   * derivedForValidation.validationAfter ?? validation.eflAvgPriceValidation ?? null
   */
  finalValidation: any | null;
  /**
   * When true, the solver's final validation status is FAIL and this EFL
   * should be queued for manual admin review rather than auto-presented.
   */
  needsAdminReview?: boolean;
};

/**
 * Run the full EFL pipeline (deterministic extract → AI parse → avg‑price
 * validator → validation gap solver) **without** persisting any template.
 *
 * This is the canonical entrypoint for batch tooling (e.g. WattBuy harnesses)
 * that need PASS/FAIL/SKIP signals but want to control when templates are
 * actually stored.
 */
export async function runEflPipelineNoStore(
  args: RunEflPipelineNoStoreArgs,
): Promise<RunEflPipelineNoStoreResult> {
  const { pdfBytes } = args;

  const extract = await deterministicEflExtract(pdfBytes);
  const rawText = extract.rawText ?? "";

  if (!rawText.trim()) {
    throw new Error("EFL rawText empty; cannot run EFL pipeline.");
  }

  const aiResult = await parseEflTextWithAi({
    rawText,
    eflPdfSha256: extract.eflPdfSha256,
    extraWarnings: extract.warnings ?? [],
  });

  let derivedForValidation: any = null;
  try {
    const baseValidation = (aiResult.validation as any)?.eflAvgPriceValidation ?? null;
    derivedForValidation = await solveEflValidationGaps({
      rawText,
      planRules: aiResult.planRules,
      rateStructure: aiResult.rateStructure,
      validation: baseValidation,
    });
  } catch {
    derivedForValidation = null;
  }

  const baseValidation = (aiResult.validation as any)?.eflAvgPriceValidation ?? null;
  const validationAfter = (derivedForValidation as any)?.validationAfter ?? null;
  const finalValidation = validationAfter ?? baseValidation ?? null;

  const finalStatus: string | null = finalValidation?.status ?? null;

  // Decide which shapes to surface. When the solver succeeds (PASS), prefer
  // its derivedPlanRules/RateStructure; otherwise, keep the original AI
  // output so admins can see exactly what the model produced.
  const finalPlanRules =
    finalStatus === "PASS" && derivedForValidation?.derivedPlanRules
      ? derivedForValidation.derivedPlanRules
      : aiResult.planRules ?? null;

  const finalRateStructure =
    finalStatus === "PASS" && derivedForValidation?.derivedRateStructure
      ? derivedForValidation.derivedRateStructure
      : aiResult.rateStructure ?? null;

  const needsAdminReview = finalStatus === "FAIL";

  const rawTextLength = rawText.length;
  const rawTextTruncated = rawTextLength > MAX_PREVIEW_CHARS;
  const rawTextPreview = rawTextTruncated
    ? rawText.slice(0, MAX_PREVIEW_CHARS)
    : rawText;

  return {
    deterministic: {
      eflPdfSha256: extract.eflPdfSha256 ?? null,
      repPuctCertificate: extract.repPuctCertificate ?? null,
      eflVersionCode: extract.eflVersionCode ?? null,
      extractorMethod: extract.extractorMethod ?? "pdftotext",
      warnings: extract.warnings ?? [],
      rawText,
      rawTextPreview,
      rawTextLength,
      rawTextTruncated,
    },
    planRules: finalPlanRules,
    rateStructure: finalRateStructure,
    parseConfidence:
      typeof aiResult.parseConfidence === "number" ? aiResult.parseConfidence : null,
    parseWarnings: aiResult.parseWarnings ?? [],
    validation: aiResult.validation ?? null,
    derivedForValidation,
    finalValidation,
    needsAdminReview,
  };
}


