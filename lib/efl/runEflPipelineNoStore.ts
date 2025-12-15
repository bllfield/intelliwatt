import { Buffer } from "node:buffer";

import { deterministicEflExtract } from "@/lib/efl/eflExtractor";
import { parseEflTextWithAi } from "@/lib/efl/eflAiParser";
import { scoreEflPassStrength } from "@/lib/efl/eflValidator";
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
  /**
   * Explicit copies of the effective PlanRules/RateStructure used for
   * decision-making. These mirror `planRules`/`rateStructure` but are
   * provided for callers that want to differentiate between raw AI output
   * and solver-adjusted shapes.
   */
  effectivePlanRules?: any | null;
  effectiveRateStructure?: any | null;
  /**
   * Strength of a PASS result based on off-point checks and sanity bounds.
   * STRONG => safe to drive user-facing pricing (subject to confidence gate).
   * WEAK/INVALID => should be quarantined / admin-only, not user-facing.
   */
  passStrength?: "STRONG" | "WEAK" | "INVALID" | null;
  passStrengthReasons?: string[];
  passStrengthOffPointDiffs?: Array<{
    usageKwh: number;
    expectedInterp: number;
    modeled: number | null;
    diff: number | null;
    ok: boolean;
  }> | null;
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

  let passStrength: "STRONG" | "WEAK" | "INVALID" | null = null;
  let passStrengthReasons: string[] = [];
  let passStrengthOffPointDiffs:
    | Array<{
        usageKwh: number;
        expectedInterp: number;
        modeled: number | null;
        diff: number | null;
        ok: boolean;
      }>
    | null = null;

  if (finalValidation && finalPlanRules && finalRateStructure) {
    try {
      const scored = await scoreEflPassStrength({
        rawText,
        validation: finalValidation,
        planRules: finalPlanRules,
        rateStructure: finalRateStructure,
      });
      passStrength = scored.strength;
      passStrengthReasons = scored.reasons ?? [];
      passStrengthOffPointDiffs = scored.offPointDiffs ?? null;

      if (
        finalValidation.status === "PASS" &&
        scored.strength &&
        scored.strength !== "STRONG"
      ) {
        const extra =
          "EFL PASS flagged as WEAK/INVALID (possible cancellation pass or out-of-bounds values) — manual admin review required.";
        const existing = (finalValidation as any).queueReason as
          | string
          | undefined;
        (finalValidation as any).queueReason = existing
          ? `${existing} | ${extra}`
          : extra;
      }
    } catch {
      // Best-effort only; if scoring fails, leave strength fields null.
      passStrength = null;
      passStrengthReasons = [];
      passStrengthOffPointDiffs = null;
    }
  }

  const needsAdminReview =
    finalStatus === "FAIL" ||
    (finalStatus === "PASS" &&
      passStrength != null &&
      passStrength !== "STRONG");

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
    effectivePlanRules: finalPlanRules,
    effectiveRateStructure: finalRateStructure,
    passStrength,
    passStrengthReasons,
    passStrengthOffPointDiffs,
  };
}


