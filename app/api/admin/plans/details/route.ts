import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/admin";
import { introspectPlanFromRateStructure } from "@/lib/plan-engine/introspectPlanFromRateStructure";

export const dynamic = "force-dynamic";

function jsonError(status: number, error: string, detail?: any) {
  return NextResponse.json({ ok: false, error, detail: detail ?? null }, { status });
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
            eflUrl: ratePlan.eflUrl,
            eflSourceUrl: ratePlan.eflSourceUrl,
            tosUrl: ratePlan.tosUrl,
            yracUrl: ratePlan.yracUrl,
            repPuctCertificate: ratePlan.repPuctCertificate,
            eflVersionCode: ratePlan.eflVersionCode,
            eflPdfSha256: ratePlan.eflPdfSha256,
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
      introspection,
    });
  } catch (e: any) {
    return jsonError(500, "unexpected_error", { message: e?.message ?? String(e) });
  }
}

