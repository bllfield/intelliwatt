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

  // In raw-text-only mode we may not have deterministic PDF extract metadata (PUCT cert / Ver. #)
  // available from upstream. These identifiers are commonly present in the EFL text itself,
  // so we best-effort extract them here to avoid "PASS but not persisted" failures.
  const repPuctCertificate =
    String(args.repPuctCertificate ?? "").trim() ||
    extractRepPuctCertificateFromEflText(rawText) ||
    null;
  const eflVersionCode =
    String(args.eflVersionCode ?? "").trim() ||
    extractEflVersionCodeFromEflText(rawText) ||
    null;

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
      repPuctCertificate,
      eflVersionCode,
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

function extractRepPuctCertificateFromEflText(text: string): string | null {
  const t = String(text ?? "");
  if (!t.trim()) return null;
  const m =
    t.match(
      /\b(?:PUCT\s*(?:Certificate\s*(?:No\.?|Number)?|Cert\.?|License)|REP\s*No\.)\s*[#:.\s]*([0-9]{4,6})\b/i,
    ) ??
    t.match(/\bPUC\s*license\s*#\s*([0-9]{4,6})\b/i);
  return m?.[1] ?? null;
}

function extractEflVersionCodeFromEflText(text: string): string | null {
  const raw = String(text ?? "");
  if (!raw.trim()) return null;

  const lines = raw.split(/\r?\n/).map((l) => l.trim());

  const normalizeToken = (s: string): string => {
    // Keep characters commonly seen in EFL version codes.
    return s
      .replace(/\s+/g, " ")
      .replace(/[^\w+\-./]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  };

  // Common forms:
  // - "Version # TXSUMBRK24ENRL_..."
  // - "Ver. #: SOME_CODE"
  // - "Version #:" on one line, code on the next.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!line) continue;

    const mInline =
      line.match(/\b(?:Version|Ver\.?)\s*#\s*:?\s*(.+)$/i) ??
      line.match(/\bEFL\s*Ver\.?\s*#\s*:?\s*(.+)$/i);
    if (mInline?.[1]) {
      const token = normalizeToken(mInline[1]);
      if (token) return token;
    }

    const isHeaderOnly =
      /\b(?:Version|Ver\.?)\s*#\s*:?\s*$/i.test(line) ||
      /\bEFL\s*Ver\.?\s*#\s*:?\s*$/i.test(line);
    if (isHeaderOnly) {
      const next = lines[i + 1] ?? "";
      const token = normalizeToken(next);
      if (token) return token;
    }
  }

  // Fallback: some EFLs (notably certain REPs) do not include a "Version #"
  // label, but do include a stable document/form identifier near the footer,
  // e.g. "M1F00163039360A". Prefer this over returning null so the pipeline can
  // persist the template deterministically (especially in raw-text-queue mode).
  //
  // Guardrails:
  // - require a specific prefix (M1F) to avoid matching phone numbers / addresses.
  // - require a substantial trailing payload.
  {
    const m1fAll = Array.from(raw.matchAll(/\bM1F[0-9A-Z]{8,24}\b/g));
    if (m1fAll.length > 0) {
      const token = normalizeToken(m1fAll[m1fAll.length - 1]?.[0] ?? "");
      if (token) return token;
    }
  }

  return null;
}
