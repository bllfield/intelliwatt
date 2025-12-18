import { PrismaClient } from "@prisma/client";

function hasDatabaseUrl() {
  const v = process.env.DATABASE_URL;
  return typeof v === "string" && v.trim().length > 0;
}

function normStr(v) {
  return String(v ?? "").trim();
}

function lower(v) {
  return normStr(v).toLowerCase();
}

async function main() {
  console.log(`DATABASE_URL set? ${hasDatabaseUrl() ? "yes" : "no"}`);
  if (!hasDatabaseUrl()) {
    console.error("Missing DATABASE_URL env var. Set it in your PowerShell session before running this script.");
    process.exitCode = 1;
    return;
  }

  const LIMIT = Math.max(1, Math.min(500, Number(process.env.LIMIT ?? "100") || 100));

  const prisma = new PrismaClient();
  try {
    // Candidates: missing buckets OR explicitly marked MISSING_TEMPLATE
    const candidates = await prisma.$queryRaw`
      SELECT
        "id",
        "planName",
        "repPuctCertificate",
        "eflVersionCode",
        "planCalcStatus",
        "planCalcReasonCode",
        COALESCE(array_length("requiredBucketKeys", 1), 0) AS "requiredLen",
        ("rateStructure" IS NOT NULL AND "rateStructure"::text <> 'null') AS "rateStructurePresent"
      FROM "RatePlan"
      WHERE
        COALESCE(array_length("requiredBucketKeys", 1), 0) = 0
        OR "planCalcReasonCode" = 'MISSING_TEMPLATE'
      ORDER BY "updatedAt" DESC
      LIMIT ${LIMIT};
    `;

    const list = Array.isArray(candidates) ? candidates : [];

    const out = [];
    let missingBecauseNoTemplateFound = 0;
    let lookupMismatchSuspected = 0;

    for (const row of list) {
      const id = normStr(row.id);
      const planName = row.planName ?? null;
      const repPuctCertificate = row.repPuctCertificate ?? null;
      const eflVersionCode = row.eflVersionCode ?? null;
      const rateStructurePresent = Boolean(row.rateStructurePresent);

      const rep = lower(repPuctCertificate);
      const plan = lower(planName);
      const ver = lower(eflVersionCode);

      const hasRep = Boolean(rep);
      const hasPlan = Boolean(plan);
      const hasVer = Boolean(ver);

      const keyAReady = hasRep && hasPlan && hasVer;
      const keyBReady = hasRep && hasVer;
      const keyCReady = hasRep && hasPlan;

      // “Template” rows are RatePlans with a usable rateStructure (JSON not null) and not in manual-review gate.
      // We exclude the current row by id.
      const matchA = keyAReady
        ? await prisma.$queryRaw`
            SELECT COUNT(*)::int AS n, ARRAY(
              SELECT "id"
              FROM "RatePlan"
              WHERE
                "id" <> ${id}
                AND ("rateStructure" IS NOT NULL AND "rateStructure"::text <> 'null')
                AND "eflRequiresManualReview" = false
                AND lower("repPuctCertificate") = ${rep}
                AND lower("planName") = ${plan}
                AND lower("eflVersionCode") = ${ver}
              ORDER BY "updatedAt" DESC
              LIMIT 5
            ) AS ids;
          `
        : [{ n: 0, ids: [] }];

      const matchB = keyBReady
        ? await prisma.$queryRaw`
            SELECT COUNT(*)::int AS n, ARRAY(
              SELECT "id"
              FROM "RatePlan"
              WHERE
                "id" <> ${id}
                AND ("rateStructure" IS NOT NULL AND "rateStructure"::text <> 'null')
                AND "eflRequiresManualReview" = false
                AND lower("repPuctCertificate") = ${rep}
                AND lower("eflVersionCode") = ${ver}
              ORDER BY "updatedAt" DESC
              LIMIT 5
            ) AS ids;
          `
        : [{ n: 0, ids: [] }];

      const matchC = keyCReady
        ? await prisma.$queryRaw`
            SELECT COUNT(*)::int AS n, ARRAY(
              SELECT "id"
              FROM "RatePlan"
              WHERE
                "id" <> ${id}
                AND ("rateStructure" IS NOT NULL AND "rateStructure"::text <> 'null')
                AND "eflRequiresManualReview" = false
                AND lower("repPuctCertificate") = ${rep}
                AND lower("planName") = ${plan}
              ORDER BY "updatedAt" DESC
              LIMIT 5
            ) AS ids;
          `
        : [{ n: 0, ids: [] }];

      const a0 = Array.isArray(matchA) && matchA[0] ? matchA[0] : { n: 0, ids: [] };
      const b0 = Array.isArray(matchB) && matchB[0] ? matchB[0] : { n: 0, ids: [] };
      const c0 = Array.isArray(matchC) && matchC[0] ? matchC[0] : { n: 0, ids: [] };

      const byRepPlanVersion = Number(a0.n ?? 0) || 0;
      const byRepVersion = Number(b0.n ?? 0) || 0;
      const byRepPlan = Number(c0.n ?? 0) || 0;

      if (byRepPlanVersion === 0 && byRepVersion === 0 && byRepPlan === 0) {
        missingBecauseNoTemplateFound++;
      } else if (byRepPlanVersion === 0 && (byRepVersion > 0 || byRepPlan > 0)) {
        lookupMismatchSuspected++;
      }

      out.push({
        id,
        planName,
        repPuctCertificate,
        eflVersionCode,
        rateStructurePresent,
        matches: {
          byRepPlanVersion,
          byRepVersion,
          byRepPlan,
        },
        bestMatchTemplateIds: {
          byRepPlanVersion: Array.isArray(a0.ids) ? a0.ids : [],
          byRepVersion: Array.isArray(b0.ids) ? b0.ids : [],
          byRepPlan: Array.isArray(c0.ids) ? c0.ids : [],
        },
      });
    }

    const summary = {
      limit: LIMIT,
      totalMissing: out.length,
      missingBecauseNoTemplateFound,
      lookupMismatchSuspected,
    };

    console.log(JSON.stringify({ summary, rows: out }, null, 2));
  } catch (err) {
    console.error("diagnose failed:", err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

await main();


