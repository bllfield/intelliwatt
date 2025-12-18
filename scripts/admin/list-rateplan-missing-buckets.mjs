import { PrismaClient } from "@prisma/client";

function hasDatabaseUrl() {
  const v = process.env.DATABASE_URL;
  return typeof v === "string" && v.trim().length > 0;
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
    // Use SQL to avoid Prisma list-filter edge cases; this reliably finds empty arrays.
    const rows = await prisma.$queryRaw`
      SELECT
        "id",
        "planName",
        "repPuctCertificate",
        "eflVersionCode",
        "planCalcStatus",
        "planCalcReasonCode",
        "requiredBucketKeys",
        "planCalcDerivedAt",
        ("rateStructure" IS NOT NULL) AS "rateStructurePresent"
      FROM "RatePlan"
      WHERE COALESCE(array_length("requiredBucketKeys", 1), 0) = 0
      ORDER BY "updatedAt" DESC
      LIMIT 100;
    `;

    const out = (Array.isArray(rows) ? rows : []).map((r) => ({
      id: r.id ?? null,
      planName: r.planName ?? null,
      repPuctCertificate: r.repPuctCertificate ?? null,
      eflVersionCode: r.eflVersionCode ?? null,
      planCalcStatus: r.planCalcStatus ?? null,
      planCalcReasonCode: r.planCalcReasonCode ?? null,
      requiredBucketKeys: Array.isArray(r.requiredBucketKeys) ? r.requiredBucketKeys : [],
      planCalcDerivedAt: r.planCalcDerivedAt ? new Date(r.planCalcDerivedAt).toISOString() : null,
      rateStructurePresent: Boolean(r.rateStructurePresent),
    }));

    console.log(JSON.stringify(out, null, 2));
  } catch (err) {
    console.error("Query failed:", err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

await main();


