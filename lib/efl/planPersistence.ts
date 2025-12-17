import { prisma } from "@/lib/db";
import type {
  PlanRules,
  RateStructure,
  PlanRulesValidationResult,
} from "@/lib/efl/planEngine";
import { getTemplateKey } from "@/lib/efl/templateIdentity";

export interface UpsertEflRatePlanArgs {
  /**
   * Canonical EFL URL (prefer the resolved PDF URL when available).
   */
  eflUrl: string;
  /**
   * Original upstream URL that led us to the EFL (landing page or enroll page).
   * When omitted, defaults to eflUrl.
   */
  eflSourceUrl?: string | null;
  repPuctCertificate: string | null;
  eflVersionCode: string | null;
  eflPdfSha256: string;
  // Optional offer context so templated-plans UI is useful.
  utilityId?: string | null;
  state?: string | null;
  termMonths?: number | null;
  rate500?: number | null;
  rate1000?: number | null;
  rate2000?: number | null;
  modeledRate500?: number | null;
  modeledRate1000?: number | null;
  modeledRate2000?: number | null;
  modeledEflAvgPriceValidation?: any | null;
  modeledComputedAt?: Date | string | null;
  cancelFee?: string | null;
  providerName?: string | null;
  planName?: string | null;
  planRules: PlanRules | null;
  rateStructure: RateStructure | null;
  validation?: PlanRulesValidationResult | null;
  mode: "test" | "live";
}

/**
 * Upsert a RatePlan row from EFL-derived PlanRules + RateStructure.
 *
 * Guardrails:
 * - NEVER invent or guess values; we only persist what the extractor produced.
 * - If validation.requiresManualReview === true:
 *     - We persist the EFL fingerprint and validation issues.
 *     - We DO NOT write rateStructure (leaves it null).
 *     - eflRequiresManualReview is set to true.
 *     - This plan MUST NOT be auto-used by the rate engine until an admin clears it.
 * - If validation is clean (no ERROR issues):
 *     - We upsert the row and write rateStructure.
 *     - eflRequiresManualReview is false, but we still store validationIssues as an audit trail.
 *
 * In "test" mode, this function should not be called.
 */
export async function upsertRatePlanFromEfl(
  args: UpsertEflRatePlanArgs,
) {
  if (args.mode === "test") {
    throw new Error(
      "upsertRatePlanFromEfl must not be called in test mode (no persistence).",
    );
  }

  const {
    eflUrl,
    eflSourceUrl,
    repPuctCertificate,
    eflVersionCode,
    eflPdfSha256,
    utilityId,
    state,
    termMonths,
    rate500,
    rate1000,
    rate2000,
    modeledRate500,
    modeledRate1000,
    modeledRate2000,
    modeledEflAvgPriceValidation,
    modeledComputedAt,
    cancelFee,
    providerName,
    planName,
    planRules,
    rateStructure,
    validation,
  } = args;

  if (!eflPdfSha256) {
    throw new Error(
      "eflPdfSha256 is required to upsert RatePlan from EFL.",
    );
  }

  // ---------------- Persistence guardrails ----------------
  // Even if PlanRules are structurally valid, we refuse to persist a *template*
  // (rateStructure) unless we have enough identity/display fields to avoid
  // collisions and "mystery rows" in Templates.
  //
  // If these fields are missing, we force manual review and clear rateStructure.
  const missingTemplateFields: string[] = [];
  if (!(planName ?? "").trim()) missingTemplateFields.push("planName");
  if (typeof termMonths !== "number") missingTemplateFields.push("termMonths");
  if (!(eflVersionCode ?? "").trim()) missingTemplateFields.push("eflVersionCode");
  if (!(providerName ?? "").trim()) missingTemplateFields.push("providerName");

  const forcedManualReviewForMissingFields = missingTemplateFields.length > 0;

  const requiresManualReview =
    forcedManualReviewForMissingFields || validation?.requiresManualReview === true;

  const validationIssues = [
    ...(validation?.issues ?? []),
    ...(forcedManualReviewForMissingFields
      ? ([
          {
            code: "TEMPLATE_ID_FIELDS_MISSING",
            severity: "ERROR",
            message: `Template not persisted: missing required fields: ${missingTemplateFields.join(", ")}.`,
          },
        ] satisfies PlanRulesValidationResult["issues"])
      : []),
  ];

  // When manual review is required, DO NOT write rateStructure.
  const safeRateStructure = requiresManualReview
    ? null
    : rateStructure;

  // Modeled proof columns are only meaningful when we persisted a usable template.
  const canPersistModeledProof = Boolean(!requiresManualReview && safeRateStructure);

  const modeledAt =
    modeledComputedAt == null
      ? null
      : modeledComputedAt instanceof Date
        ? modeledComputedAt
        : new Date(String(modeledComputedAt));

  const dataCommon = {
    // EFL identity + source URL
    eflUrl: eflUrl,
    eflSourceUrl: (eflSourceUrl ?? "").trim() ? (eflSourceUrl as string) : eflUrl,
    repPuctCertificate: repPuctCertificate ?? null,
    eflVersionCode: eflVersionCode ?? null,
    eflPdfSha256,

    // Offer/display metadata (best-effort)
    ...(typeof termMonths === "number" ? { termMonths } : {}),
    ...(typeof rate500 === "number" ? { rate500 } : {}),
    ...(typeof rate1000 === "number" ? { rate1000 } : {}),
    ...(typeof rate2000 === "number" ? { rate2000 } : {}),
    ...(canPersistModeledProof && typeof modeledRate500 === "number" ? { modeledRate500 } : {}),
    ...(canPersistModeledProof && typeof modeledRate1000 === "number" ? { modeledRate1000 } : {}),
    ...(canPersistModeledProof && typeof modeledRate2000 === "number" ? { modeledRate2000 } : {}),
    ...(canPersistModeledProof && modeledEflAvgPriceValidation != null
      ? { modeledEflAvgPriceValidation: modeledEflAvgPriceValidation as any }
      : {}),
    ...(canPersistModeledProof && modeledAt != null ? { modeledComputedAt: modeledAt } : {}),
    ...(cancelFee ? { cancelFee } : {}),

    // Validation + gating
    eflRequiresManualReview: requiresManualReview,
    eflValidationIssues:
      validationIssues.length > 0 ? (validationIssues as any) : null,

    // Pricing structure (only when safe)
    rateStructure: safeRateStructure as any,

    // Optional display helpers; we do not override existing values if absent
    supplier: providerName ?? undefined,
    planName: planName ?? undefined,
  } as const;

  // Compute a stable template identity for this EFL so we can dedupe RatePlan
  // rows even when the same EFL arrives via multiple URLs or ingest paths.
  const identity = getTemplateKey({
    repPuctCertificate,
    eflVersionCode,
    eflPdfSha256,
    wattbuy: null,
  });

  let existing = null as Awaited<
    ReturnType<(typeof prisma)["ratePlan"]["findFirst"]>
  >;

  // IMPORTANT: Only treat REP+EFL version as a safe dedupe key when the extracted
  // version code looks like a real "Ver. #" token. Some PDFs contain the word
  // "ENGLISH" or the plan family name near the "EFL Version" label; if we dedupe
  // on that, unrelated plans will overwrite each other and "CREATED" rows won't
  // show up as distinct templates.
  const isLikelyRealEflVersionCode = (v: string | null | undefined): boolean => {
    const s = String(v ?? "").trim();
    if (!s) return false;
    const upper = s.toUpperCase();

    // Reject obvious non-version placeholders.
    if (upper === "ENGLISH" || upper === "NGLISH" || upper === "ISH") return false;

    // Most real EFL version codes include a date-like token (e.g. 20251215 / 20230918)
    // or a substantial digit payload. Generic strings like "5_ENGLISH" are *not* unique.
    const digits = (s.match(/\d/g) ?? []).length;
    if (digits < 6) return false;

    // Prefer codes that explicitly look like EFL version IDs.
    if (upper.includes("EFL")) return true;

    // Otherwise allow long, structured, digit-heavy codes.
    const hasSeparators = /[-_]/.test(s);
    return s.length >= 12 && hasSeparators;
  };

  // 1) Prefer an existing RatePlan with the same REP PUCT Certificate + EFL
  // Version Code, scoped by planName when available (prevents different plans
  // from overwriting each other when a supplier reuses version tokens).
  //
  // User-facing guardrail: fingerprint = REP + PlanName + EFL Version.
  if (
    repPuctCertificate &&
    eflVersionCode &&
    isLikelyRealEflVersionCode(eflVersionCode) &&
    (planName ?? "").trim()
  ) {
    existing = await prisma.ratePlan.findFirst({
      where: {
        repPuctCertificate: repPuctCertificate,
        eflVersionCode: eflVersionCode,
        planName: { equals: planName as string, mode: "insensitive" },
      },
    });
  }

  // 2) Next-best: REP PUCT Certificate + EFL Version Code (when it looks real),
  // ONLY when we do not have a planName. When planName is present, falling back
  // to REP+Version re-introduces cross-plan overwrites (exactly what we're preventing).
  if (
    !existing &&
    !(planName ?? "").trim() &&
    repPuctCertificate &&
    eflVersionCode &&
    isLikelyRealEflVersionCode(eflVersionCode)
  ) {
    existing = await prisma.ratePlan.findFirst({
      where: {
        repPuctCertificate: repPuctCertificate,
        eflVersionCode: eflVersionCode,
      },
    });
  }

  // 3) If not found, fall back to the EFL PDF SHA-256 fingerprint.
  if (!existing && eflPdfSha256) {
    // Note: we use a raw where cast here because the generated types may not yet
    // include eflPdfSha256 until after Prisma client regeneration.
    existing = await prisma.ratePlan.findFirst({
      where: { eflPdfSha256: eflPdfSha256 } as any,
    });
  }

  if (!existing) {
    const created = await prisma.ratePlan.create({
      data: {
        // utilityId/state are required; use provided context if available.
        utilityId: (utilityId ?? "").trim() ? String(utilityId) : "UNKNOWN",
        state: (state ?? "").trim() ? String(state) : "TX",
        ...dataCommon,
      },
    });
    return {
      ratePlan: created,
      templatePersisted: Boolean(!requiresManualReview && safeRateStructure),
      forcedManualReviewForMissingFields,
      missingTemplateFields,
    };
  }

  const updated = await prisma.ratePlan.update({
    where: { id: existing.id },
    data: {
      ...(utilityId && utilityId.trim() ? { utilityId } : {}),
      ...(state && state.trim() ? { state } : {}),
      ...dataCommon,
    },
  });
  return {
    ratePlan: updated,
    templatePersisted: Boolean(!requiresManualReview && safeRateStructure),
    forcedManualReviewForMissingFields,
    missingTemplateFields,
  };
}


