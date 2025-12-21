import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

function jsonError(status: number, error: string, details?: unknown) {
  return NextResponse.json({ ok: false, error, ...(details ? { details } : {}) }, { status });
}

type HygieneBody = {
  limit?: number | null;
  apply?: boolean | null;
};

function normStr(v: unknown): string {
  return String(v ?? "").trim();
}

// Note: repPuctCertificate is intentionally NOT treated as required identity for “junk”.
// It's optional in the schema and some providers/portals omit it, but a template can still be valid.
function missingTemplateIdentityFields(r: any): string[] {
  const missing: string[] = [];
  if (!normStr(r.eflVersionCode)) missing.push("eflVersionCode");
  if (!normStr(r.eflPdfSha256)) missing.push("eflPdfSha256");
  if (!normStr(r.supplier)) missing.push("supplier");
  if (!normStr(r.planName)) missing.push("planName");
  if (typeof r.termMonths !== "number") missing.push("termMonths");
  return missing;
}

export async function POST(req: NextRequest) {
  try {
    if (!ADMIN_TOKEN) return jsonError(500, "ADMIN_TOKEN is not configured");
    const headerToken = req.headers.get("x-admin-token");
    if (!headerToken || headerToken !== ADMIN_TOKEN) {
      return jsonError(401, "Unauthorized (invalid admin token)");
    }

    let body: HygieneBody;
    try {
      body = (await req.json()) as HygieneBody;
    } catch {
      return jsonError(400, "Invalid JSON body");
    }

    const limitRaw = Number(body.limit ?? 500);
    const limit = Math.max(1, Math.min(5000, Number.isFinite(limitRaw) ? limitRaw : 500));
    const apply = body.apply === true;

    const rows = (await prisma.$queryRaw`
      WITH candidates AS (
        SELECT
          rp."id",
          rp."supplier",
          rp."planName",
          rp."termMonths",
          rp."repPuctCertificate",
          rp."eflVersionCode",
          rp."eflPdfSha256",
          rp."eflUrl",
          rp."eflSourceUrl",
          rp."eflRequiresManualReview" AS "eflRequiresManualReview",
          rp."planCalcStatus",
          rp."planCalcReasonCode",
          COALESCE(array_length(rp."requiredBucketKeys", 1), 0) AS "requiredBucketKeysCount",
          rp."updatedAt"
        FROM "RatePlan" rp
        WHERE
          rp."isUtilityTariff" = false
          AND (rp."rateStructure" IS NOT NULL AND rp."rateStructure"::text <> 'null')
          AND (
            rp."eflRequiresManualReview" = true
            OR rp."eflVersionCode" IS NULL
            OR rp."eflPdfSha256" IS NULL
            OR rp."supplier" IS NULL
            OR rp."planName" IS NULL
            OR rp."termMonths" IS NULL
          )
        ORDER BY rp."updatedAt" DESC
        LIMIT ${limit}
      )
      SELECT
        c.*,
        COALESCE(m."linkedOfferCount", 0)::int AS "linkedOfferCount"
      FROM candidates c
      LEFT JOIN (
        SELECT "ratePlanId", COUNT(*) AS "linkedOfferCount"
        FROM "OfferIdRatePlanMap"
        GROUP BY "ratePlanId"
      ) m ON m."ratePlanId" = c."id";
    `) as any[];

    const out: any[] = [];
    let scannedCandidates = 0;
    let orphanJunk = 0;
    let linkedNeedsReparse = 0;
    let appliedInvalidations = 0;

    const idsToInvalidate: string[] = [];

    for (const r of Array.isArray(rows) ? rows : []) {
      scannedCandidates++;
      const id = normStr(r.id);
      const linkedOfferCount = Number(r.linkedOfferCount ?? 0) || 0;

      const missing = missingTemplateIdentityFields(r);
      const missingMeta: string[] = [];
      if (!normStr(r.repPuctCertificate)) missingMeta.push("repPuctCertificate");

      const isJunk = missing.length > 0 || Boolean(r.eflRequiresManualReview);
      const orphan = linkedOfferCount === 0;

      const action =
        isJunk && orphan ? "INVALIDATE_ORPHAN" : isJunk && !orphan ? "KEEP_NEEDS_REPARSE" : "KEEP_OK";

      if (action === "INVALIDATE_ORPHAN") {
        orphanJunk++;
        idsToInvalidate.push(id);
      } else if (action === "KEEP_NEEDS_REPARSE") {
        linkedNeedsReparse++;
      }

      out.push({
        id,
        linkedOfferCount,
        action,
        missingIdentityFields: missing,
        missingMetaFields: missingMeta,
        supplier: r.supplier ?? null,
        planName: r.planName ?? null,
        termMonths: typeof r.termMonths === "number" ? r.termMonths : null,
        repPuctCertificate: r.repPuctCertificate ?? null,
        eflVersionCode: r.eflVersionCode ?? null,
        eflPdfSha256: r.eflPdfSha256 ?? null,
        eflUrl: r.eflUrl ?? null,
        eflSourceUrl: r.eflSourceUrl ?? null,
        eflRequiresManualReview: Boolean(r.eflRequiresManualReview),
        planCalcStatus: r.planCalcStatus ?? null,
        planCalcReasonCode: r.planCalcReasonCode ?? null,
        requiredBucketKeysCount: Number(r.requiredBucketKeysCount ?? 0) || 0,
        updatedAt: r.updatedAt ?? null,
      });
    }

    // Apply (safety-capped)
    const APPLY_CAP = 1000;
    if (apply && idsToInvalidate.length) {
      const ids = idsToInvalidate.slice(0, APPLY_CAP);
      const upd = await prisma.ratePlan.updateMany({
        where: { id: { in: ids } },
        data: {
          rateStructure: Prisma.DbNull,
          eflRequiresManualReview: true,
          eflValidationIssues: Prisma.DbNull,
          modeledEflAvgPriceValidation: Prisma.DbNull,
          modeledComputedAt: null,
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
      summary: {
        apply,
        limit,
        scannedCandidates,
        orphanJunk,
        linkedNeedsReparse,
        invalidationCap: 1000,
        appliedInvalidations,
        note:
          "This endpoint only invalidates orphan junk templates (no OfferIdRatePlanMap links). It never invalidates templates currently linked to offers.",
      },
      rows: out,
    });
  } catch (e: any) {
    return jsonError(500, "Failed to run template hygiene", {
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

