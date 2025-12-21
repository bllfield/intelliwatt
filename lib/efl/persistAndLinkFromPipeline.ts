import { derivePlanCalcRequirementsFromTemplate } from "@/lib/plan-engine/planComputability";
import { validatePlanRules } from "@/lib/efl/planEngine";
import { upsertRatePlanFromEfl } from "@/lib/efl/planPersistence";
import { inferTdspTerritoryFromEflText } from "@/lib/efl/eflValidator";
import { normalizeTdspCode } from "@/lib/utility/tdspCode";
import { ensureBucketsExist } from "@/lib/usage/aggregateMonthlyBuckets";
import { prisma } from "@/lib/db";

export type PersistAndLinkFromPipelineArgs = {
  mode: "test" | "live";
  source:
    | "manual_url"
    | "manual_upload"
    | "manual_text"
    | "queue_process_open"
    | "queue_process_quarantine"
    | "dashboard_prefetch"
    | "dashboard_plans"
    | "batch";
  eflUrl: string | null;
  eflSourceUrl?: string | null;
  offerId?: string | null;
  offerMeta?: {
    supplier?: string | null;
    planName?: string | null;
    termMonths?: number | null;
    tdspName?: string | null;
  } | null;
  deterministic: {
    eflPdfSha256: string | null;
    repPuctCertificate: string | null;
    eflVersionCode: string | null;
    rawText: string;
  };
  pipeline: {
    planRules: any | null;
    rateStructure: any | null;
    validation: any | null;
    derivedForValidation: any | null;
    finalValidation: any | null;
    passStrength?: "STRONG" | "WEAK" | "INVALID" | null;
  };
};

export type PersistAndLinkFromPipelineResult = {
  templatePersisted: boolean;
  persistedRatePlanId: string | null;
  utilityId: string | null;
  planCalc: {
    planCalcStatus: string | null;
    planCalcReasonCode: string | null;
    requiredBucketKeys: string[];
  } | null;
  bucketsEnsured: { ensured: number; skipped: number } | null;
  offerIdLinked: boolean;
  offerIdBackfill: { matchedOfferIds: number; linkedOfferIds: number } | null;
  notes: string[];
};

function normalizeUrl(u: string | null | undefined): string | null {
  const s = String(u ?? "").trim();
  if (!s) return null;
  try {
    return new URL(s).toString();
  } catch {
    return null;
  }
}

function canonicalUrlKey(u: string): string | null {
  try {
    const url = new URL(u);
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

function pickAvgRowCentsPerKwh(avgTableRows: any[], kwh: number): number | null {
  const row = avgTableRows.find((r: any) => Number(r?.usageKwh ?? r?.kwh ?? r?.usage) === kwh);
  const v = Number(row?.avgPriceCentsPerKwh);
  return Number.isFinite(v) ? v : null;
}

function pickModeledPointCentsPerKwh(finalValidation: any, kwh: number): number | null {
  const pts = Array.isArray(finalValidation?.points) ? (finalValidation.points as any[]) : [];
  const row = pts.find((r: any) => Number(r?.usageKwh ?? r?.kwh ?? r?.usage) === kwh);
  const v = Number(
    row?.modeledAvgCentsPerKwh ??
      row?.modeledAvgPriceCentsPerKwh ??
      row?.modeledCentsPerKwh,
  );
  return Number.isFinite(v) ? v : null;
}

function normalizeUtilityIdMaybe(rawText: string): string | null {
  try {
    const tdsp = inferTdspTerritoryFromEflText(rawText);
    const norm = normalizeTdspCode(tdsp);
    return norm;
  } catch {
    return null;
  }
}

/**
 * Canonical persistence+linking step shared across all runners.
 * This is the enforcement point for: "if admin sees it, site sees it the same way."
 */
export async function persistAndLinkFromPipeline(
  args: PersistAndLinkFromPipelineArgs,
): Promise<PersistAndLinkFromPipelineResult> {
  const notes: string[] = [];

  if (args.mode === "test") {
    return {
      templatePersisted: false,
      persistedRatePlanId: null,
      utilityId: null,
      planCalc: null,
      bucketsEnsured: null,
      offerIdLinked: false,
      offerIdBackfill: null,
      notes: ["test_mode:no_persistence"],
    };
  }

  const eflUrl = normalizeUrl(args.eflUrl);
  const eflSourceUrl = normalizeUrl(args.eflSourceUrl ?? null) ?? eflUrl;
  const offerId = String(args.offerId ?? "").trim() || null;

  const rawText = String(args.deterministic.rawText ?? "");
  const sha = String(args.deterministic.eflPdfSha256 ?? "").trim() || null;
  const repPuctCertificate = args.deterministic.repPuctCertificate ?? null;
  const eflVersionCode = args.deterministic.eflVersionCode ?? null;

  const finalValidation = args.pipeline.finalValidation ?? null;
  const finalStatus: string | null = finalValidation?.status ?? null;
  const passStrength = args.pipeline.passStrength ?? null;

  const effectivePlanRules = args.pipeline.planRules ?? null;
  const effectiveRateStructure = args.pipeline.rateStructure ?? null;

  const prValidation = effectivePlanRules ? validatePlanRules(effectivePlanRules as any) : null;
  const requiresManualReview = prValidation?.requiresManualReview === true;

  const eligibleForTemplatePersist =
    finalStatus === "PASS" &&
    passStrength === "STRONG" &&
    !requiresManualReview &&
    Boolean(sha) &&
    Boolean(eflUrl) &&
    Boolean(effectivePlanRules) &&
    Boolean(effectiveRateStructure);

  if (!eligibleForTemplatePersist) {
    notes.push(
      `not_persisted:status=${finalStatus ?? "—"} strength=${passStrength ?? "—"} manualReview=${requiresManualReview ? "1" : "0"}`,
    );
    return {
      templatePersisted: false,
      persistedRatePlanId: null,
      utilityId: null,
      planCalc: null,
      bucketsEnsured: null,
      offerIdLinked: false,
      offerIdBackfill: null,
      notes,
    };
  }

  const utilityId =
    normalizeUtilityIdMaybe(rawText) ?? normalizeTdspCode(args.offerMeta?.tdspName ?? null);
  if (!utilityId) {
    notes.push("utility_unmapped_or_unknown");
    return {
      templatePersisted: false,
      persistedRatePlanId: null,
      utilityId: null,
      planCalc: null,
      bucketsEnsured: null,
      offerIdLinked: false,
      offerIdBackfill: null,
      notes,
    };
  }

  const avgTableRows = Array.isArray(finalValidation?.avgTableRows) ? finalValidation.avgTableRows : [];
  const modeledEflAvgPriceValidation = finalValidation ?? null;
  const modeledRate500 = pickModeledPointCentsPerKwh(finalValidation, 500);
  const modeledRate1000 = pickModeledPointCentsPerKwh(finalValidation, 1000);
  const modeledRate2000 = pickModeledPointCentsPerKwh(finalValidation, 2000);

  const expectedRate500 = pickAvgRowCentsPerKwh(avgTableRows, 500);
  const expectedRate1000 = pickAvgRowCentsPerKwh(avgTableRows, 1000);
  const expectedRate2000 = pickAvgRowCentsPerKwh(avgTableRows, 2000);

  const saved = await upsertRatePlanFromEfl({
    eflUrl: eflUrl as string,
    eflSourceUrl: eflSourceUrl ?? undefined,
    repPuctCertificate,
    eflVersionCode,
    eflPdfSha256: sha as string,
    utilityId: utilityId ?? args.offerMeta?.tdspName ?? null,
    state: "TX",
    termMonths: args.offerMeta?.termMonths ?? null,
    rate500: expectedRate500,
    rate1000: expectedRate1000,
    rate2000: expectedRate2000,
    modeledRate500,
    modeledRate1000,
    modeledRate2000,
    modeledEflAvgPriceValidation,
    passStrength,
    modeledComputedAt: new Date(),
    cancelFee: null,
    providerName: args.offerMeta?.supplier ?? null,
    planName: args.offerMeta?.planName ?? null,
    planRules: effectivePlanRules,
    rateStructure: effectiveRateStructure,
    validation: prValidation,
    mode: "live",
  });

  const persistedRatePlanId = String((saved as any)?.ratePlan?.id ?? "").trim() || null;
  const templatePersisted = Boolean((saved as any)?.templatePersisted);

  if (!persistedRatePlanId) {
    notes.push("persist_failed:no_ratePlanId");
    return {
      templatePersisted: false,
      persistedRatePlanId: null,
      utilityId,
      planCalc: null,
      bucketsEnsured: null,
      offerIdLinked: false,
      offerIdBackfill: null,
      notes,
    };
  }

  // Always re-derive plan-calc fields from what we *actually stored* (single source of truth).
  const rp = await (prisma as any).ratePlan.findUnique({
    where: { id: persistedRatePlanId },
    select: {
      id: true,
      rateStructure: true,
      planCalcStatus: true,
      planCalcReasonCode: true,
      requiredBucketKeys: true,
      eflUrl: true,
      eflSourceUrl: true,
    } as any,
  });

  const derived = derivePlanCalcRequirementsFromTemplate({ rateStructure: (rp as any)?.rateStructure ?? null });
  try {
    await (prisma as any).ratePlan.update({
      where: { id: persistedRatePlanId },
      data: {
        planCalcVersion: derived.planCalcVersion,
        planCalcStatus: derived.planCalcStatus,
        planCalcReasonCode: derived.planCalcReasonCode,
        requiredBucketKeys: derived.requiredBucketKeys,
        supportedFeatures: derived.supportedFeatures as any,
        planCalcDerivedAt: new Date(),
      },
    });
  } catch {
    // best-effort; do not fail persistence
  }

  let bucketsEnsured: { ensured: number; skipped: number } | null = null;
  try {
    const ensured = await ensureBucketsExist({ bucketKeys: derived.requiredBucketKeys });
    bucketsEnsured = {
      ensured: Array.isArray(ensured?.ensured) ? ensured.ensured.length : 0,
      skipped: Array.isArray(ensured?.skipped) ? ensured.skipped.length : 0,
    };
  } catch {
    bucketsEnsured = null;
  }

  // Link exact offerId (if provided).
  let offerIdLinked = false;
  if (offerId) {
    try {
      const now = new Date();
      await (prisma as any).offerIdRatePlanMap.upsert({
        where: { offerId },
        create: {
          offerId,
          ratePlanId: persistedRatePlanId,
          lastLinkedAt: now,
          linkedBy: args.source,
        },
        update: {
          ratePlanId: persistedRatePlanId,
          lastLinkedAt: now,
          linkedBy: args.source,
        },
      });
      offerIdLinked = true;
    } catch {
      offerIdLinked = false;
    }
    try {
      await (prisma as any).offerRateMap.updateMany({
        where: { offerId },
        data: { ratePlanId: persistedRatePlanId, lastSeenAt: new Date() },
      });
    } catch {
      // ignore
    }
  }

  // Backfill all offers that reference this EFL URL in OfferRateMap.
  let offerIdBackfill: { matchedOfferIds: number; linkedOfferIds: number } | null = null;
  try {
    const urls = Array.from(
      new Set(
        [eflUrl, eflSourceUrl, String((rp as any)?.eflUrl ?? "").trim() || null, String((rp as any)?.eflSourceUrl ?? "").trim() || null]
          .map((u) => normalizeUrl(u))
          .filter((v): v is string => typeof v === "string" && v.length > 0),
      ),
    );
    const canonical = Array.from(new Set(urls.map((u) => canonicalUrlKey(u)).filter((v): v is string => !!v)));
    const where: any = canonical.length
      ? {
          OR: [
            { eflUrl: { in: urls } },
            ...canonical.map((c) => ({ eflUrl: { startsWith: c } })),
          ],
        }
      : { eflUrl: { in: urls } };

    const rows = await (prisma as any).offerRateMap.findMany({
      where,
      select: { offerId: true },
      take: 2000,
    });
    const offerIds = Array.from(
      new Set(
        (Array.isArray(rows) ? rows : [])
          .map((r: any) => String(r?.offerId ?? "").trim())
          .filter(Boolean),
      ),
    );
    let linked = 0;
    if (offerIds.length) {
      const now = new Date();
      try {
        await (prisma as any).offerRateMap.updateMany({
          where: { offerId: { in: offerIds } },
          data: { ratePlanId: persistedRatePlanId, lastSeenAt: now },
        });
      } catch {
        // ignore
      }
      for (const oid of offerIds) {
        try {
          await (prisma as any).offerIdRatePlanMap.upsert({
            where: { offerId: oid },
            create: {
              offerId: oid,
              ratePlanId: persistedRatePlanId,
              lastLinkedAt: now,
              linkedBy: `${args.source}:eflUrl-backfill`,
            },
            update: {
              ratePlanId: persistedRatePlanId,
              lastLinkedAt: now,
              linkedBy: `${args.source}:eflUrl-backfill`,
            },
          });
          linked += 1;
        } catch {
          // ignore per offer
        }
      }
    }
    offerIdBackfill = { matchedOfferIds: offerIds.length, linkedOfferIds: linked };
  } catch {
    offerIdBackfill = null;
  }

  return {
    templatePersisted,
    persistedRatePlanId,
    utilityId,
    planCalc: {
      planCalcStatus: derived.planCalcStatus,
      planCalcReasonCode: derived.planCalcReasonCode,
      requiredBucketKeys: derived.requiredBucketKeys,
    },
    bucketsEnsured,
    offerIdLinked,
    offerIdBackfill,
    notes,
  };
}

