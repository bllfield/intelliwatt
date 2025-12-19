import { PrismaClient, Prisma } from "@prisma/client";

function hasDatabaseUrl() {
  const v = process.env.DATABASE_URL;
  return typeof v === "string" && v.trim().length > 0;
}

function isJsonNullLike(v) {
  return v === null || v === Prisma.DbNull || v === Prisma.JsonNull || v === Prisma.AnyNull;
}

function isRateStructurePresent(rs) {
  if (isJsonNullLike(rs)) return false;
  if (typeof rs !== "object") return false;
  try {
    return Object.keys(rs).length > 0;
  } catch {
    return false;
  }
}

function safeString(v) {
  return typeof v === "string" ? v : v == null ? null : String(v);
}

async function main() {
  console.log(`DATABASE_URL set? ${hasDatabaseUrl() ? "yes" : "no"}`);
  if (!hasDatabaseUrl()) {
    console.error("Missing DATABASE_URL env var. Set it in your PowerShell session before running this script.");
    process.exitCode = 1;
    return;
  }

  const prisma = new PrismaClient();
  try {
    const totalRatePlansRow = await prisma.$queryRaw`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE "planCalcStatus" = 'COMPUTABLE')::int AS computable,
        COUNT(*) FILTER (WHERE "planCalcStatus" = 'NOT_COMPUTABLE')::int AS not_computable,
        COUNT(*) FILTER (WHERE "planCalcStatus" = 'UNKNOWN' OR "planCalcStatus" IS NULL)::int AS unknown,
        COUNT(*) FILTER (WHERE COALESCE(array_length("requiredBucketKeys",1),0) > 0)::int AS has_required_buckets,
        COUNT(*) FILTER (WHERE "planCalcDerivedAt" IS NOT NULL)::int AS derived
      FROM "RatePlan";
    `;

    const byReason = await prisma.$queryRaw`
      SELECT
        COALESCE("planCalcReasonCode", 'NULL') AS reason,
        COUNT(*)::int AS count
      FROM "RatePlan"
      GROUP BY 1
      ORDER BY count DESC, reason ASC;
    `;

    // Offer-level: mapped offers (OfferIdRatePlanMap) grouped by the template's calc status.
    const mappedOffersByStatus = await prisma.$queryRaw`
      SELECT
        COALESCE(rp."planCalcStatus", 'NULL') AS status,
        COUNT(*)::int AS mapped_offers
      FROM "OfferIdRatePlanMap" m
      JOIN "RatePlan" rp ON rp."id" = m."ratePlanId"
      WHERE m."ratePlanId" IS NOT NULL
      GROUP BY 1
      ORDER BY mapped_offers DESC, status ASC;
    `;

    // Top 20 most-used NOT_COMPUTABLE templates among mapped offers.
    const topNotComputableTemplates = await prisma.$queryRaw`
      SELECT
        rp."id" AS "ratePlanId",
        rp."repPuctCertificate" AS "repPuctCertificate",
        rp."planName" AS "planName",
        rp."eflVersionCode" AS "eflVersionCode",
        rp."planCalcReasonCode" AS "planCalcReasonCode",
        COUNT(*)::int AS "mappedOffers"
      FROM "OfferIdRatePlanMap" m
      JOIN "RatePlan" rp ON rp."id" = m."ratePlanId"
      WHERE m."ratePlanId" IS NOT NULL
        AND rp."planCalcStatus" = 'NOT_COMPUTABLE'
      GROUP BY 1,2,3,4,5
      ORDER BY "mappedOffers" DESC, "repPuctCertificate" ASC, "planName" ASC
      LIMIT 20;
    `;

    // rateStructure presence counts (computed client-side due to Prisma JSON null sentinels)
    const allRatePlans = await prisma.ratePlan.findMany({
      select: {
        id: true,
        rateStructure: true,
        planCalcStatus: true,
        planCalcReasonCode: true,
        requiredBucketKeys: true,
      },
      take: 50_000,
      orderBy: { updatedAt: "desc" },
    });

    const rateStructurePresent = allRatePlans.filter((rp) => isRateStructurePresent(rp.rateStructure)).length;
    const rateStructureMissing = allRatePlans.length - rateStructurePresent;

    const requiredKeysEmpty = allRatePlans.filter(
      (rp) => !Array.isArray(rp.requiredBucketKeys) || rp.requiredBucketKeys.length === 0,
    ).length;

    const output = {
      ok: true,
      ratePlans: {
        counts: Array.isArray(totalRatePlansRow) && totalRatePlansRow.length ? totalRatePlansRow[0] : totalRatePlansRow,
        rateStructurePresent,
        rateStructureMissing,
        requiredBucketKeysEmpty: requiredKeysEmpty,
        byReasonCode: byReason,
      },
      offers: {
        mappedOffersByPlanCalcStatus: mappedOffersByStatus,
        topNotComputableTemplates,
      },
      notes: [
        "This script is read-only.",
        "rateStructurePresent is computed in JS so Prisma JSON null sentinels are treated as missing.",
      ],
    };

    // Ensure no accidental leakage of env vars in output.
    console.log(JSON.stringify(output, null, 2));
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

await main();


