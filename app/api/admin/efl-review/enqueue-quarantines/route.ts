import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { isPlanCalcQuarantineWorthyReasonCode } from "@/lib/plan-engine/planCalcQuarantine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(status: number, error: string, details?: unknown) {
  return NextResponse.json(
    {
      ok: false,
      error,
      ...(details ? { details } : {}),
    },
    { status },
  );
}

function clampInt(v: any, fallback: number, lo: number, hi: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, Math.trunc(n)));
}

type Body = {
  utilityId?: string; // e.g. "oncor"
  limit?: number;
  forceReopen?: boolean;
};

export async function POST(req: NextRequest) {
  try {
    const adminToken = process.env.ADMIN_TOKEN;
    if (!adminToken) return jsonError(500, "ADMIN_TOKEN is not configured");

    const headerToken = req.headers.get("x-admin-token");
    if (!headerToken || headerToken !== adminToken) {
      return jsonError(401, "Unauthorized (invalid admin token)");
    }

    let body: Body = {};
    try {
      body = (await req.json().catch(() => ({}))) as any;
    } catch {
      body = {};
    }

    const utilityId = typeof body.utilityId === "string" ? body.utilityId.trim().toLowerCase() : "";
    const limit = clampInt(body.limit, 200, 1, 1000);
    const forceReopen = body.forceReopen !== false; // default true

    const where: any = {
      ratePlanId: { not: null },
      ratePlan: {
        OR: [{ planCalcStatus: { not: "COMPUTABLE" } }, { planCalcStatus: null }],
        ...(utilityId ? { utilityId } : {}),
      },
    };

    const rows = await (prisma as any).offerIdRatePlanMap.findMany({
      where,
      take: limit,
      select: {
        offerId: true,
        ratePlanId: true,
        ratePlan: {
          select: {
            id: true,
            utilityId: true,
            supplier: true,
            planName: true,
            termMonths: true,
            eflUrl: true,
            eflSourceUrl: true,
            planCalcStatus: true,
            planCalcReasonCode: true,
            rateStructure: true,
          },
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    let scanned = 0;
    let upserted = 0;
    let skippedNonDefect = 0;

    for (const r of rows as any[]) {
      scanned += 1;
      const offerId = String(r?.offerId ?? "").trim();
      const ratePlanId = String(r?.ratePlanId ?? "").trim();
      if (!offerId || !ratePlanId) continue;

      const rp = r?.ratePlan ?? null;
      const planCalcStatus = typeof rp?.planCalcStatus === "string" ? String(rp.planCalcStatus) : "UNKNOWN";
      const planCalcReasonCode =
        typeof rp?.planCalcReasonCode === "string" && rp.planCalcReasonCode.trim()
          ? String(rp.planCalcReasonCode)
          : "UNKNOWN";

      // Only enqueue TRUE plan defects. Do not create review-noise for bucket-gated plans
      // (credits/tiered/TOU/minimum rules) which are supported in non-dashboard calculators.
      if (!isPlanCalcQuarantineWorthyReasonCode(planCalcReasonCode)) {
        skippedNonDefect += 1;
        continue;
      }

      const queueReasonPayload = {
        type: "PLAN_CALC_QUARANTINE",
        planCalcStatus,
        planCalcReasonCode,
        ratePlanId,
        offerId,
        utilityId: rp?.utilityId ?? null,
      };

      const baseUpdate: any = {
        supplier: rp?.supplier ?? null,
        planName: rp?.planName ?? null,
        eflUrl: rp?.eflUrl ?? rp?.eflSourceUrl ?? null,
        tdspName: rp?.utilityId ?? null,
        termMonths: typeof rp?.termMonths === "number" ? rp.termMonths : null,
        ratePlanId,
        derivedForValidation: queueReasonPayload,
        finalStatus: "OPEN",
        queueReason: JSON.stringify(queueReasonPayload),
        resolutionNotes: planCalcReasonCode,
      };

      const reopenFields = forceReopen
        ? {
            resolvedAt: null,
            resolvedBy: null,
            resolutionNotes: planCalcReasonCode,
          }
        : {};

      try {
        await (prisma as any).eflParseReviewQueue.upsert({
          where: { kind_dedupeKey: { kind: "PLAN_CALC_QUARANTINE", dedupeKey: offerId } },
          create: {
            source: "admin_enqueue_quarantines",
            kind: "PLAN_CALC_QUARANTINE",
            dedupeKey: offerId,
            // Required NOT NULL unique field; use stable synthetic value for quarantines.
            eflPdfSha256: `plan_calc_quarantine:${offerId}`,
            offerId,
            supplier: rp?.supplier ?? null,
            planName: rp?.planName ?? null,
            eflUrl: rp?.eflUrl ?? rp?.eflSourceUrl ?? null,
            tdspName: rp?.utilityId ?? null,
            termMonths: typeof rp?.termMonths === "number" ? rp.termMonths : null,
            ratePlanId,
            rawText: null,
            planRules: null,
            rateStructure: rp?.rateStructure ?? null,
            validation: null,
            derivedForValidation: queueReasonPayload,
            finalStatus: "OPEN",
            queueReason: JSON.stringify(queueReasonPayload),
            solverApplied: [],
            resolvedAt: null,
            resolvedBy: null,
            resolutionNotes: planCalcReasonCode,
          },
          update: {
            ...baseUpdate,
            ...reopenFields,
          },
        });
        upserted += 1;
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("[ADMIN_EFL_REVIEW_ENQUEUE_QUARANTINES] Upsert failed", {
          offerId,
          ratePlanId,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return NextResponse.json({
      ok: true,
      utilityId: utilityId || null,
      limit,
      forceReopen,
      scanned,
      upserted,
      skippedNonDefect,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[ADMIN_EFL_REVIEW_ENQUEUE_QUARANTINES] Error", error);
    return jsonError(500, "Failed to enqueue quarantines", error instanceof Error ? error.message : String(error));
  }
}

