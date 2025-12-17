import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

function jsonError(status: number, error: string, detail?: any) {
  return NextResponse.json({ ok: false, error, detail: detail ?? null }, { status });
}

type Row = {
  id: string;
  supplier: string | null;
  planName: string | null;
  termMonths: number | null;
  utilityId: string | null;
  state: string | null;
  eflUrl: string | null;
  repPuctCertificate: string | null;
  eflVersionCode: string | null;
  eflPdfSha256: string | null;
  updatedAt: Date;
};

export async function GET(req: NextRequest) {
  try {
    if (!ADMIN_TOKEN) return jsonError(500, "ADMIN_TOKEN is not configured");
    const headerToken = req.headers.get("x-admin-token");
    if (!headerToken || headerToken !== ADMIN_TOKEN) return jsonError(401, "Unauthorized");

    const sp = req.nextUrl.searchParams;
    const limit = Math.max(1, Math.min(1000, Number(sp.get("limit") ?? 200) || 200));
    const q = (sp.get("q") ?? "").trim();

    // Avoid String.prototype.replaceAll for compatibility with older TS lib targets.
    const qEsc = q ? q.replace(/%/g, "\\%").replace(/_/g, "\\_") : "";
    const qLike = q ? `%${qEsc}%` : null;

    // "Unmapped templates" means: RatePlan has a stored rateStructure, but no OfferIdRatePlanMap row points at it.
    // These are orphans that won't light up as "templateAvailable" for any WattBuy offer_id.
    const whereQ = qLike
      ? prisma.$queryRaw<{ count: number }[]>`
          SELECT COUNT(*)::int AS "count"
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
        `
      : prisma.$queryRaw<{ count: number }[]>`
          SELECT COUNT(*)::int AS "count"
          FROM "RatePlan" rp
          WHERE rp."isUtilityTariff" = false
            AND rp."rateStructure" IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM "OfferIdRatePlanMap" m
              WHERE m."ratePlanId" = rp."id"
            )
        `;

    const countRows = await whereQ;
    const totalCount = Number(countRows?.[0]?.count ?? 0) || 0;

    const rows = qLike
      ? await prisma.$queryRaw<Row[]>`
          SELECT
            rp."id",
            rp."supplier",
            rp."planName",
            rp."termMonths",
            rp."utilityId",
            rp."state",
            rp."eflUrl",
            rp."repPuctCertificate",
            rp."eflVersionCode",
            rp."eflPdfSha256",
            rp."updatedAt"
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
      : await prisma.$queryRaw<Row[]>`
          SELECT
            rp."id",
            rp."supplier",
            rp."planName",
            rp."termMonths",
            rp."utilityId",
            rp."state",
            rp."eflUrl",
            rp."repPuctCertificate",
            rp."eflVersionCode",
            rp."eflPdfSha256",
            rp."updatedAt"
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

    return NextResponse.json({
      ok: true,
      q: q || null,
      limit,
      totalCount,
      rows: Array.isArray(rows) ? rows : [],
    });
  } catch (e) {
    return jsonError(500, "Unexpected error listing unmapped templates", {
      message: e instanceof Error ? e.message : String(e),
    });
  }
}


