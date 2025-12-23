import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

function jsonError(status: number, error: string, details?: unknown) {
  return NextResponse.json({ ok: false, error, ...(details ? { details } : {}) }, { status });
}

type Body = {
  q?: string | null;
  limit?: number | null;
  apply?: boolean | null;
  confirm?: string | null;
};

export async function POST(req: NextRequest) {
  try {
    if (!ADMIN_TOKEN) return jsonError(500, "ADMIN_TOKEN is not configured");
    const headerToken = req.headers.get("x-admin-token");
    if (!headerToken || headerToken !== ADMIN_TOKEN) {
      return jsonError(401, "Unauthorized (invalid admin token)");
    }

    let body: Body;
    try {
      body = (await req.json()) as Body;
    } catch {
      return jsonError(400, "Invalid JSON body");
    }

    const q = String(body.q ?? "").trim();
    const limitRaw = Number(body.limit ?? 200);
    const limit = Math.max(1, Math.min(5000, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 200));
    const apply = body.apply === true;
    const confirm = String(body.confirm ?? "").trim();

    const APPLY_CAP = 2000;
    if (apply && confirm !== "INVALIDATE_UNMAPPED_TEMPLATES") {
      return jsonError(400, "Missing confirmation (type INVALIDATE_UNMAPPED_TEMPLATES)", {
        expected: "INVALIDATE_UNMAPPED_TEMPLATES",
      });
    }

    // Avoid String.prototype.replaceAll for compatibility with older TS lib targets.
    const qEsc = q ? q.replace(/%/g, "\\%").replace(/_/g, "\\_") : "";
    const qLike = q ? `%${qEsc}%` : null;

    // Pick candidate IDs via raw SQL (same selection semantics as the unmapped list).
    const ids = qLike
      ? await prisma.$queryRaw<{ id: string }[]>`
          SELECT rp."id"
          FROM "RatePlan" rp
          WHERE rp."isUtilityTariff" = false
            AND rp."rateStructure" IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM "OfferIdRatePlanMap" m
              WHERE m."ratePlanId" = rp."id"
            )
            AND (
              rp."supplier" ILIKE ${qLike} ESCAPE '\\'
              OR rp."planName" ILIKE ${qLike} ESCAPE '\\'
              OR rp."repPuctCertificate" ILIKE ${qLike} ESCAPE '\\'
              OR rp."eflVersionCode" ILIKE ${qLike} ESCAPE '\\'
              OR rp."eflPdfSha256" ILIKE ${qLike} ESCAPE '\\'
              OR rp."utilityId" ILIKE ${qLike} ESCAPE '\\'
            )
          ORDER BY rp."updatedAt" DESC
          LIMIT ${limit}
        `
      : await prisma.$queryRaw<{ id: string }[]>`
          SELECT rp."id"
          FROM "RatePlan" rp
          WHERE rp."isUtilityTariff" = false
            AND rp."rateStructure" IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM "OfferIdRatePlanMap" m
              WHERE m."ratePlanId" = rp."id"
            )
          ORDER BY rp."updatedAt" DESC
          LIMIT ${limit}
        `;

    const idsTrimmed = Array.from(
      new Set((Array.isArray(ids) ? ids : []).map((r) => String((r as any)?.id ?? "").trim()).filter(Boolean)),
    );

    let appliedInvalidations = 0;
    if (apply && idsTrimmed.length) {
      const slice = idsTrimmed.slice(0, APPLY_CAP);
      const upd = await prisma.ratePlan.updateMany({
        where: { id: { in: slice }, isUtilityTariff: false } as any,
        data: {
          // Clearing these makes them disappear from "Templates" and "Unmapped Templates".
          rateStructure: Prisma.DbNull,
          eflRequiresManualReview: true,
          eflValidationIssues: Prisma.DbNull,
          modeledEflAvgPriceValidation: Prisma.DbNull,
          modeledComputedAt: null,
          // Reset derived plan-calc so re-parses start clean.
          planCalcStatus: "UNKNOWN",
          planCalcReasonCode: "MISSING_TEMPLATE",
          requiredBucketKeys: [],
          planCalcDerivedAt: null,
        } as any,
      });
      appliedInvalidations = Number((upd as any)?.count ?? 0) || 0;
    }

    return NextResponse.json({
      ok: true,
      q: q || null,
      limit,
      apply,
      invalidationCap: APPLY_CAP,
      candidates: idsTrimmed.length,
      appliedInvalidations,
      note:
        "This bulk action clears RatePlan.rateStructure for UNMAPPED templates only (no OfferIdRatePlanMap links). It does not delete rows; it removes the stored template so it must be re-parsed to return.",
    });
  } catch (e: any) {
    return jsonError(500, "Failed to bulk invalidate unmapped templates", {
      message: e instanceof Error ? e.message : String(e),
    });
  }
}


