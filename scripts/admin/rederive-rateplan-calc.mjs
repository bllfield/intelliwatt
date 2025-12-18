import { PrismaClient, Prisma } from "@prisma/client";

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

function isPrismaJsonNullLike(v) {
  // Prisma sentinel objects for JSON null / DB null
  return v == null || v === Prisma.JsonNull || v === Prisma.DbNull || v === Prisma.AnyNull;
}

function derivePlanCalcRequirementsFromTemplate(rateStructure) {
  const planCalcVersion = 1;

  if (!rateStructure || isPrismaJsonNullLike(rateStructure)) {
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

    // Find rows that are missing buckets OR were marked missing template earlier.
    const ids = await prisma.$queryRaw`
      SELECT "id"
      FROM "RatePlan"
      WHERE COALESCE(array_length("requiredBucketKeys",1),0) = 0
         OR "planCalcReasonCode" = 'MISSING_TEMPLATE'
      ORDER BY "updatedAt" DESC
      LIMIT 5000;
    `;

    const idList = (Array.isArray(ids) ? ids : []).map((r) => r.id).filter(Boolean);
    let scanned = 0;
    let updated = 0;
    let skipped = 0;
    let errors = 0;

    for (const id of idList) {
      scanned++;
      try {
        const rp = await prisma.ratePlan.findUnique({
          where: { id },
          select: { id: true, rateStructure: true, requiredBucketKeys: true, planCalcReasonCode: true },
        });
        if (!rp) {
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
      } catch {
        errors++;
      }
      if (scanned % 200 === 0) console.log(JSON.stringify({ scanned, updated, skipped, errors }));
    }

    console.log(JSON.stringify({ scanned, updated, skipped, errors }, null, 2));

    const after = await reportCounts(prisma);
    console.log("After:");
    console.log(JSON.stringify(after ?? { error: "no_rows" }, null, 2));

    const remaining = await prisma.$queryRaw`
      SELECT "id"
      FROM "RatePlan"
      WHERE COALESCE(array_length("requiredBucketKeys",1),0) = 0
      ORDER BY "updatedAt" DESC
      LIMIT 200;
    `;
    const remainingIds = (Array.isArray(remaining) ? remaining : []).map((r) => r.id).filter(Boolean);
    console.log("Remaining missing-buckets ids (up to 200):");
    console.log(JSON.stringify(remainingIds, null, 2));
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

await main();


