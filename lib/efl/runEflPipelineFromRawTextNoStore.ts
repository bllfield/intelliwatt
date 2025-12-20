import { parseEflTextWithAi } from "@/lib/efl/eflAiParser";
import { scoreEflPassStrength } from "@/lib/efl/eflValidator";
import { solveEflValidationGaps } from "@/lib/efl/validation/solveEflValidationGaps";
import type { RunEflPipelineNoStoreResult } from "@/lib/efl/runEflPipelineNoStore";

const MAX_PREVIEW_CHARS = 20000;

export type RunEflPipelineFromRawTextNoStoreArgs = {
  rawText: string;
  eflPdfSha256: string;
  repPuctCertificate?: string | null;
  eflVersionCode?: string | null;
  source?: "wattbuy" | "manual" | "queue_rawtext";
  offerMeta?: {
    supplier?: string | null;
    planName?: string | null;
    termMonths?: number | null;
    tdspName?: string | null;
    offerId?: string | null;
  } | null;
};

/**
 * Run the EFL pipeline when PDF bytes cannot be fetched (WAF / blocked), but we already
 * have extracted rawText + a known eflPdfSha256 identity stored in the queue.
 *
 * This mirrors runEflPipelineNoStore's behavior (AI parse -> avg-price validation -> gap solver -> pass strength),
 * but skips deterministic PDF extraction.
 */
export async function runEflPipelineFromRawTextNoStore(
  args: RunEflPipelineFromRawTextNoStoreArgs,
): Promise<RunEflPipelineNoStoreResult> {
  const rawText = String(args.rawText ?? "");
  if (!rawText.trim()) {
    throw new Error("EFL rawText empty; cannot run raw-text EFL pipeline.");
  }

  const eflPdfSha256 = String(args.eflPdfSha256 ?? "").trim();
  if (!eflPdfSha256) {
    throw new Error("Missing eflPdfSha256; cannot run raw-text EFL pipeline.");
  }

  const aiResult = await parseEflTextWithAi({
    rawText,
    eflPdfSha256,
    extraWarnings: ["Pipeline used stored rawText (PDF fetch unavailable)."],
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
        const existing = (finalValidation as any).queueReason as string | undefined;
        (finalValidation as any).queueReason = existing ? `${existing} | ${extra}` : extra;
      }
    } catch {
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
  const rawTextPreview = rawTextTruncated ? rawText.slice(0, MAX_PREVIEW_CHARS) : rawText;

  return {
    deterministic: {
      eflPdfSha256,
      repPuctCertificate: args.repPuctCertificate ?? null,
      eflVersionCode: args.eflVersionCode ?? null,
      extractorMethod: "raw_text_queue",
      warnings: ["Pipeline used stored rawText (PDF fetch unavailable)."],
      rawText,
      rawTextPreview,
      rawTextLength,
      rawTextTruncated,
    },
    planRules: finalPlanRules,
    rateStructure: finalRateStructure,
    parseConfidence: typeof aiResult.parseConfidence === "number" ? aiResult.parseConfidence : null,
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

