import { PrismaClient } from "@prisma/client";

function hasDatabaseUrl() {
  const v = process.env.DATABASE_URL;
  return typeof v === "string" && v.trim().length > 0;
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function safeNum(n) {
  const x = typeof n === "number" ? n : typeof n === "string" ? Number(n) : NaN;
  return Number.isFinite(x) ? x : null;
}

// Mirrors the runtime extractor in lib/plan-engine/calculatePlanCostForUsage.ts (keep conservative).
function extractFixedRepEnergyCentsPerKwh(rateStructure) {
  if (!rateStructure || typeof rateStructure !== "object") return null;

  const candidates = [];
  candidates.push(rateStructure?.repEnergyCentsPerKwh);
  candidates.push(rateStructure?.energyCentsPerKwh);
  candidates.push(rateStructure?.fixedEnergyCentsPerKwh);
  candidates.push(rateStructure?.rateCentsPerKwh);
  candidates.push(rateStructure?.baseRateCentsPerKwh);
  candidates.push(rateStructure?.energyRateCents);
  candidates.push(rateStructure?.energyChargeCentsPerKwh);
  candidates.push(rateStructure?.defaultRateCentsPerKwh);
  candidates.push(rateStructure?.charges?.energy?.centsPerKwh);
  candidates.push(rateStructure?.charges?.rep?.energyCentsPerKwh);
  candidates.push(rateStructure?.energy?.centsPerKwh);

  const maybeDollars = safeNum(rateStructure?.charges?.energy?.dollarsPerKwh);
  if (maybeDollars !== null && maybeDollars > 0 && maybeDollars < 1) {
    return maybeDollars * 100;
  }

  const nums = candidates
    .map(safeNum)
    .filter((x) => x !== null)
    .filter((x) => x > 0 && x < 200);

  const uniq = Array.from(new Set(nums.map((n) => round2(n))));
  if (uniq.length !== 1) return null;
  return uniq[0];
}

function inferSupportedFeaturesFromTemplate(rateStructure) {
  const notes = [];
  const fixedCents = extractFixedRepEnergyCentsPerKwh(rateStructure);
  const supportsFixedEnergyRate = fixedCents != null;
  if (!supportsFixedEnergyRate) {
    notes.push("Could not confidently extract a single fixed REP ¢/kWh rate from rateStructure (fail-closed).");
  }

  const supportsTouEnergy = false;
  const supportsTieredEnergy = false;

  const supportsCredits =
    rateStructure && typeof rateStructure === "object" && Array.isArray(rateStructure?.billCredits) && rateStructure.billCredits.length > 0;
  const supportsBaseFees =
    rateStructure && typeof rateStructure === "object" && safeNum(rateStructure?.baseMonthlyFeeCents) != null;
  const supportsMinUsageFees = false;
  const supportsTdspDelivery = true;
  const supportsSolarBuyback = false;

  return {
    features: {
      supportsFixedEnergyRate,
      supportsTouEnergy,
      supportsTieredEnergy,
      supportsCredits,
      supportsBaseFees,
      supportsMinUsageFees,
      supportsTdspDelivery,
      supportsSolarBuyback,
    },
    notes,
  };
}

// Mirrors derivePlanCalcRequirementsFromTemplate() in lib/plan-engine/planComputability.ts.
function derivePlanCalcRequirementsFromTemplate(rateStructure) {
  const planCalcVersion = 1;

  if (!rateStructure) {
    return {
      planCalcVersion,
      planCalcStatus: "UNKNOWN",
      planCalcReasonCode: "MISSING_TEMPLATE",
      requiredBucketKeys: [],
      supportedFeatures: {},
    };
  }

  const inferred = inferSupportedFeaturesFromTemplate(rateStructure);
  const fixed = extractFixedRepEnergyCentsPerKwh(rateStructure);

  if (fixed != null) {
    return {
      planCalcVersion,
      planCalcStatus: "COMPUTABLE",
      planCalcReasonCode: "FIXED_RATE_OK",
      requiredBucketKeys: ["kwh.m.all.total"],
      supportedFeatures: { ...inferred.features, notes: inferred.notes },
    };
  }

  return {
    planCalcVersion,
    planCalcStatus: "NOT_COMPUTABLE",
    planCalcReasonCode: "UNSUPPORTED_RATE_STRUCTURE",
    requiredBucketKeys: ["kwh.m.all.total"],
    supportedFeatures: { ...inferred.features, notes: inferred.notes },
  };
}

async function reportCounts(prisma) {
  const rows = await prisma.$queryRaw`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE "planCalcStatus" = 'COMPUTABLE')::int AS computable,
      COUNT(*) FILTER (WHERE "planCalcStatus" = 'NOT_COMPUTABLE')::int AS not_computable,
      COUNT(*) FILTER (WHERE COALESCE(array_length("requiredBucketKeys",1),0) > 0)::int AS has_required_buckets,
      COUNT(*) FILTER (WHERE "planCalcDerivedAt" IS NOT NULL)::int AS derived
    FROM "RatePlan";
  `;
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
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
    const before = await reportCounts(prisma);
    console.log("Before:");
    console.log(JSON.stringify(before ?? { error: "no_rows" }, null, 2));

    const take = 500;
    let cursor = null;
    let scanned = 0;
    let updated = 0;
    let skipped = 0;
    let errors = 0;

    while (true) {
      const rows = await prisma.ratePlan.findMany({
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        take,
        orderBy: { id: "asc" },
        where: {
          OR: [
            { planCalcDerivedAt: null },
            { planCalcStatus: null },
            // Prisma list filter supports isEmpty for Postgres lists; safe fallback is the other ORs.
            { requiredBucketKeys: { isEmpty: true } },
          ],
        },
        select: {
          id: true,
          rateStructure: true,
          planCalcStatus: true,
          requiredBucketKeys: true,
          planCalcDerivedAt: true,
        },
      });

      if (!rows || rows.length === 0) break;
      cursor = rows[rows.length - 1].id;

      for (const rp of rows) {
        scanned++;
        try {
          const needs =
            rp.planCalcDerivedAt == null ||
            rp.planCalcStatus == null ||
            !Array.isArray(rp.requiredBucketKeys) ||
            rp.requiredBucketKeys.length === 0;

          if (!needs) {
            skipped++;
            continue;
          }

          const req = derivePlanCalcRequirementsFromTemplate(rp.rateStructure);

          await prisma.ratePlan.update({
            where: { id: rp.id },
            data: {
              planCalcVersion: req.planCalcVersion,
              planCalcStatus: req.planCalcStatus,
              planCalcReasonCode: req.planCalcReasonCode,
              requiredBucketKeys: req.requiredBucketKeys,
              supportedFeatures: req.supportedFeatures,
              planCalcDerivedAt: new Date(),
            },
          });

          updated++;
        } catch (e) {
          errors++;
        }

        if (scanned % 200 === 0) {
          console.log(JSON.stringify({ scanned, updated, skipped, errors }));
        }
      }
    }

    console.log(JSON.stringify({ scanned, updated, skipped, errors }, null, 2));

    const after = await reportCounts(prisma);
    console.log("After:");
    console.log(JSON.stringify(after ?? { error: "no_rows" }, null, 2));
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

await main();


