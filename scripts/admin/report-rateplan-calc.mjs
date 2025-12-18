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
    const rows = await prisma.$queryRaw`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE "planCalcStatus" = 'COMPUTABLE')::int AS computable,
        COUNT(*) FILTER (WHERE "planCalcStatus" = 'NOT_COMPUTABLE')::int AS not_computable,
        COUNT(*) FILTER (WHERE COALESCE(array_length("requiredBucketKeys",1),0) > 0)::int AS has_required_buckets,
        COUNT(*) FILTER (WHERE "planCalcDerivedAt" IS NOT NULL)::int AS derived
      FROM "RatePlan";
    `;

    const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    console.log(JSON.stringify(row ?? { error: "no_rows" }, null, 2));
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

await main();


