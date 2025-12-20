import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/admin";
import { introspectPlanFromRateStructure } from "@/lib/plan-engine/introspectPlanFromRateStructure";

export const dynamic = "force-dynamic";

function jsonError(status: number, error: string, detail?: any) {
  return NextResponse.json({ ok: false, error, detail: detail ?? null }, { status });
}

function mapUtilityIdToTdspCode(utilityId: string | null | undefined): string | null {
  const u = String(utilityId ?? "").trim();
  if (!u) return null;
  const upper = u.toUpperCase();
  if (["ONCOR", "CENTERPOINT", "AEP_NORTH", "AEP_CENTRAL", "TNMP"].includes(upper)) return upper;
  // WattBuy utility IDs we see in practice.
  const byWattbuyId: Record<string, string> = {
    "44372": "ONCOR",
    "8901": "CENTERPOINT",
    "20404": "AEP_NORTH",
    "3278": "AEP_CENTRAL",
    "40051": "TNMP",
  };
  return byWattbuyId[u] ?? null;
}

export async function GET(req: NextRequest) {
  const gate = requireAdmin(req);
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  const sp = req.nextUrl.searchParams;
  const offerId = String(sp.get("offerId") ?? "").trim();
  if (!offerId) return jsonError(400, "offerId_required");

  try {
    const link = await prisma.offerIdRatePlanMap.findUnique({
      where: { offerId },
      include: { ratePlan: true },
    });

    const ratePlan = link?.ratePlan ?? null;
    const rateStructure = (ratePlan as any)?.rateStructure ?? null;

    const eflRawText = (() => {
      const sha = String((ratePlan as any)?.eflPdfSha256 ?? "").trim();
      return sha ? sha : null;
    })();
    const queueRow =
      eflRawText
        ? await (prisma as any).eflParseReviewQueue.findUnique({
            where: { eflPdfSha256: eflRawText },
            select: { rawText: true },
          })
        : null;

    // Best-effort offer snapshot if we have one in MasterPlan (admin QA table).
    const masterPlan = await prisma.masterPlan.findFirst({
      where: { offerId },
      select: {
        id: true,
        source: true,
        offerId: true,
        supplierName: true,
        tdsp: true,
        planName: true,
        termMonths: true,
        productType: true,
        eflUrl: true,
        tosUrl: true,
        yracUrl: true,
        docs: true,
        rateModel: true,
        effectiveAt: true,
        expiresAt: true,
        updatedAt: true,
      },
    });

    const introspection = rateStructure ? introspectPlanFromRateStructure({ rateStructure }) : null;

    // TDSP snapshot used for “validator/model proof” display (admin QA only).
    const tdspCode = mapUtilityIdToTdspCode((ratePlan as any)?.utilityId ?? null);
    const tdspSnapshot =
      tdspCode
        ? await (prisma as any).tdspRateSnapshot.findFirst({
            where: { tdsp: tdspCode, effectiveAt: { lte: new Date() } },
            orderBy: { effectiveAt: "desc" },
          })
        : null;
    const tdspSnapshotMeta = tdspSnapshot
      ? {
          tdspCode,
          effectiveAt: tdspSnapshot.effectiveAt ? new Date(tdspSnapshot.effectiveAt).toISOString() : null,
          createdAt: tdspSnapshot.createdAt ? new Date(tdspSnapshot.createdAt).toISOString() : null,
          monthlyFeeCents: Number((tdspSnapshot.payload as any)?.monthlyFeeCents ?? 0) || 0,
          deliveryCentsPerKwh: Number((tdspSnapshot.payload as any)?.deliveryCentsPerKwh ?? 0) || 0,
        }
      : null;

    return NextResponse.json({
      ok: true,
      offerId,
      link: link
        ? {
            id: link.id,
            ratePlanId: link.ratePlanId,
            lastLinkedAt: link.lastLinkedAt,
            linkedBy: link.linkedBy,
            notes: link.notes,
          }
        : null,
      ratePlan: ratePlan
        ? {
            id: ratePlan.id,
            utilityId: ratePlan.utilityId,
            state: ratePlan.state,
            supplier: ratePlan.supplier,
            planName: ratePlan.planName,
            termMonths: ratePlan.termMonths,
            rate500: (ratePlan as any).rate500 ?? null,
            rate1000: (ratePlan as any).rate1000 ?? null,
            rate2000: (ratePlan as any).rate2000 ?? null,
            modeledRate500: (ratePlan as any).modeledRate500 ?? null,
            modeledRate1000: (ratePlan as any).modeledRate1000 ?? null,
            modeledRate2000: (ratePlan as any).modeledRate2000 ?? null,
            modeledEflAvgPriceValidation: (ratePlan as any).modeledEflAvgPriceValidation ?? null,
            modeledComputedAt: (ratePlan as any).modeledComputedAt ?? null,
            cancelFee: (ratePlan as any).cancelFee ?? null,
            eflUrl: ratePlan.eflUrl,
            eflSourceUrl: ratePlan.eflSourceUrl,
            tosUrl: ratePlan.tosUrl,
            yracUrl: ratePlan.yracUrl,
            repPuctCertificate: ratePlan.repPuctCertificate,
            eflVersionCode: ratePlan.eflVersionCode,
            eflPdfSha256: ratePlan.eflPdfSha256,
            eflRequiresManualReview: (ratePlan as any).eflRequiresManualReview ?? null,
            eflValidationIssues: (ratePlan as any).eflValidationIssues ?? null,
            rateStructure: ratePlan.rateStructure,
            planCalcVersion: ratePlan.planCalcVersion,
            planCalcStatus: ratePlan.planCalcStatus,
            planCalcReasonCode: ratePlan.planCalcReasonCode,
            requiredBucketKeys: ratePlan.requiredBucketKeys,
            supportedFeatures: ratePlan.supportedFeatures,
            planCalcDerivedAt: ratePlan.planCalcDerivedAt,
            updatedAt: ratePlan.updatedAt,
          }
        : null,
      masterPlan: masterPlan ?? null,
      eflRawText: queueRow?.rawText ?? null,
      tdspSnapshotForValidation: tdspSnapshotMeta,
      introspection,
    });
  } catch (e: any) {
    return jsonError(500, "unexpected_error", { message: e?.message ?? String(e) });
  }
}

