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

  const requiresManualReview =
    validation?.requiresManualReview === true;
  const validationIssues = validation?.issues ?? [];

  // When manual review is required, DO NOT write rateStructure.
  const safeRateStructure = requiresManualReview
    ? null
    : rateStructure;

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

  // 1) Prefer an existing RatePlan with the same REP PUCT Certificate + EFL
  // Version Code, when available.
  if (repPuctCertificate && eflVersionCode) {
    existing = await prisma.ratePlan.findFirst({
      where: {
        repPuctCertificate: repPuctCertificate,
        eflVersionCode: eflVersionCode,
      },
    });
  }

  // 2) If not found, fall back to the EFL PDF SHA-256 fingerprint.
  if (!existing && eflPdfSha256) {
    // Note: we use a raw where cast here because the generated types may not yet
    // include eflPdfSha256 until after Prisma client regeneration.
    existing = await prisma.ratePlan.findFirst({
      where: { eflPdfSha256: eflPdfSha256 } as any,
    });
  }

  if (!existing) {
    return prisma.ratePlan.create({
      data: {
        // utilityId/state are required; use provided context if available.
        utilityId: (utilityId ?? "").trim() ? String(utilityId) : "UNKNOWN",
        state: (state ?? "").trim() ? String(state) : "TX",
        ...dataCommon,
      },
    });
  }

  return prisma.ratePlan.update({
    where: { id: existing.id },
    data: {
      ...(utilityId && utilityId.trim() ? { utilityId } : {}),
      ...(state && state.trim() ? { state } : {}),
      ...dataCommon,
    },
  });
}


