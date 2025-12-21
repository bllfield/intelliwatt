import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { derivePlanCalcRequirementsFromTemplate } from "@/lib/plan-engine/planComputability";

// Prisma requires Node.js runtime (not Edge).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

function jsonError(status: number, error: string, details?: unknown) {
  return NextResponse.json(
    { ok: false, error, ...(details ? { details } : {}) },
    { status },
  );
}

type Body = {
  ratePlanId?: string;
  offerId?: string | null;
  mode?: "FORCE_COMPUTABLE" | "RESET_DERIVED";
};

export async function POST(req: NextRequest) {
  try {
    if (!ADMIN_TOKEN) return jsonError(500, "ADMIN_TOKEN is not configured");
    const headerToken = req.headers.get("x-admin-token");
    if (!headerToken || headerToken !== ADMIN_TOKEN) {
      return jsonError(401, "Unauthorized (invalid admin token)");
    }

    let body: Body = {};
    try {
      body = (await req.json().catch(() => ({}))) as any;
    } catch {
      body = {};
    }

    const ratePlanId = String(body.ratePlanId ?? "").trim();
    if (!ratePlanId) return jsonError(400, "ratePlanId is required");

    const offerId = body.offerId ? String(body.offerId).trim() : null;
    const mode = body.mode === "RESET_DERIVED" ? "RESET_DERIVED" : "FORCE_COMPUTABLE";

    const rp = await (prisma as any).ratePlan.findUnique({
      where: { id: ratePlanId },
      select: {
        id: true,
        planCalcVersion: true,
        planCalcStatus: true,
        planCalcReasonCode: true,
        requiredBucketKeys: true,
        supportedFeatures: true,
        rateStructure: true,
      },
    });
    if (!rp) return jsonError(404, "RatePlan not found", { ratePlanId });

    const derived = derivePlanCalcRequirementsFromTemplate({
      rateStructure: rp.rateStructure ?? null,
    });

    const now = new Date();
    const next =
      mode === "FORCE_COMPUTABLE"
        ? {
            planCalcVersion: derived.planCalcVersion,
            planCalcStatus: "COMPUTABLE" as const,
            planCalcReasonCode: "ADMIN_OVERRIDE_COMPUTABLE",
            requiredBucketKeys: derived.requiredBucketKeys,
            supportedFeatures: derived.supportedFeatures as any,
            planCalcDerivedAt: now,
          }
        : {
            planCalcVersion: derived.planCalcVersion,
            planCalcStatus: derived.planCalcStatus,
            planCalcReasonCode: derived.planCalcReasonCode,
            requiredBucketKeys: derived.requiredBucketKeys,
            supportedFeatures: derived.supportedFeatures as any,
            planCalcDerivedAt: now,
          };

    await (prisma as any).ratePlan.update({
      where: { id: ratePlanId },
      data: next,
      select: { id: true },
    });

    // Best-effort: if we override to COMPUTABLE, resolve any existing plan-calc quarantine rows
    // tied to this offerId/ratePlanId so the ops queue reflects the manual approval.
    let resolvedQueueCount = 0;
    if (mode === "FORCE_COMPUTABLE") {
      try {
        const or = [
          { ratePlanId },
          offerId ? { offerId } : undefined,
          offerId ? { dedupeKey: offerId } : undefined,
        ].filter(Boolean);
        if (or.length > 0) {
          const upd = await (prisma as any).eflParseReviewQueue.updateMany({
            where: {
              kind: "PLAN_CALC_QUARANTINE",
              resolvedAt: null,
              OR: or,
            },
            data: {
              resolvedAt: now,
              resolvedBy: "admin_override_computable",
              resolutionNotes: "ADMIN_OVERRIDE_COMPUTABLE",
            },
          });
          resolvedQueueCount = Number(upd?.count ?? 0) || 0;
        }
      } catch {
        resolvedQueueCount = 0;
      }
    }

    return NextResponse.json({
      ok: true,
      ratePlanId,
      offerId,
      mode,
      before: {
        planCalcStatus: rp.planCalcStatus ?? null,
        planCalcReasonCode: rp.planCalcReasonCode ?? null,
      },
      after: {
        planCalcStatus: next.planCalcStatus,
        planCalcReasonCode: next.planCalcReasonCode,
      },
      resolvedQueueCount,
    });
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error("[ADMIN_WATTBUY_TEMPLATED_PLANS_OVERRIDE_COMPUTABLE] error:", err);
    return jsonError(500, "Internal error while updating RatePlan plan-calc gate", err?.message);
  }
}

