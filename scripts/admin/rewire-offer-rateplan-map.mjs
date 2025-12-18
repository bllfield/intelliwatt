import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

function hasText(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function isJsonNullLike(v) {
  // Prisma can represent JSON null as special sentinel objects.
  return v === null || v === Prisma.DbNull || v === Prisma.JsonNull || v === Prisma.AnyNull;
}

function isRateStructurePresent(rs) {
  if (isJsonNullLike(rs)) return false;
  if (typeof rs !== 'object') return false;
  try {
    return Object.keys(rs).length > 0;
  } catch {
    return false;
  }
}

function parseIdsEnv(value) {
  const raw = (value || '').trim();
  if (!raw) return null;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function pickMostRecentByDerivedAt(cands) {
  if (cands.length <= 1) return cands[0] || null;
  const sorted = [...cands].sort((a, b) => {
    const da = a.planCalcDerivedAt ? new Date(a.planCalcDerivedAt).getTime() : 0;
    const db = b.planCalcDerivedAt ? new Date(b.planCalcDerivedAt).getTime() : 0;
    return db - da;
  });
  return sorted[0] || null;
}

async function main() {
  const DATABASE_URL_SET = !!process.env.DATABASE_URL;
  console.log(`DATABASE_URL set? ${DATABASE_URL_SET ? 'yes' : 'no'}`);
  if (!DATABASE_URL_SET) process.exit(2);

  const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
  const targetIds = parseIdsEnv(process.env.IDS);

  if (!prisma.offerIdRatePlanMap) {
    console.error('ERROR: Prisma client has no model "offerIdRatePlanMap". Check Prisma model name.');
    process.exit(2);
  }
  if (!prisma.offerRateMap) {
    console.error('ERROR: Prisma client has no model "offerRateMap". Check Prisma model name.');
    process.exit(2);
  }

  /**
   * Find "orphans":
   * - (planCalcReasonCode = 'MISSING_TEMPLATE' OR requiredBucketKeys empty)
   * - AND rateStructure is JSON null-like
   *
   * NOTE: We use SQL here because Prisma empty-array filtering has been unreliable in this repo.
   */
  const whereIdsSql = targetIds?.length
    ? Prisma.sql`AND rp.id = ANY(${targetIds})`
    : Prisma.empty;

  const orphans = await prisma.$queryRaw`
    SELECT
      rp.id,
      rp."planName",
      rp."repPuctCertificate",
      rp."eflVersionCode",
      rp."planCalcReasonCode",
      rp."requiredBucketKeys",
      rp."planCalcDerivedAt",
      rp."rateStructure"
    FROM "RatePlan" rp
    WHERE (
      rp."planCalcReasonCode" = 'MISSING_TEMPLATE'
      OR COALESCE(array_length(rp."requiredBucketKeys", 1), 0) = 0
    )
    ${whereIdsSql}
  `;

  const orphansFiltered = (orphans || []).filter((r) => !isRateStructurePresent(r.rateStructure));

  const summary = {
    dryRun: DRY_RUN,
    scanned: orphansFiltered.length,
    rewiredMaps: 0,
    rewiredOfferIdMaps: 0,
    rewiredOfferRateMaps: 0,
    affectedOffers: 0,
    skippedNoMap: 0,
    skippedNoTemplate: 0,
    ambiguous: 0,
    details: [],
    trulyMissing: [],
  };

  // Preload templates by REP cert for performance.
  const reps = Array.from(
    new Set(orphansFiltered.map((o) => o.repPuctCertificate).filter((v) => hasText(v)))
  );

  const templatesByRep = new Map();
  for (const rep of reps) {
    const rows = await prisma.ratePlan.findMany({
      where: { repPuctCertificate: rep },
      select: {
        id: true,
        planName: true,
        repPuctCertificate: true,
        eflVersionCode: true,
        planCalcDerivedAt: true,
        rateStructure: true,
      },
      take: 5000,
    });

    templatesByRep.set(
      rep,
      rows.filter((t) => isRateStructurePresent(t.rateStructure))
    );
  }

  for (const orphan of orphansFiltered) {
    const rep = orphan.repPuctCertificate;
    const templates = hasText(rep) ? templatesByRep.get(rep) || [] : [];

    const planName = orphan.planName;
    const ver = orphan.eflVersionCode;

    const byRepPlanVersion =
      hasText(rep) && hasText(planName) && hasText(ver)
        ? templates.filter(
            (t) =>
              t.repPuctCertificate === rep && t.planName === planName && t.eflVersionCode === ver
          )
        : [];

    const byRepVersion =
      hasText(rep) && hasText(ver)
        ? templates.filter((t) => t.repPuctCertificate === rep && t.eflVersionCode === ver)
        : [];

    const byRepPlan =
      hasText(rep) && hasText(planName)
        ? templates.filter((t) => t.repPuctCertificate === rep && t.planName === planName)
        : [];

    let chosen = null;
    let strategy = null;
    let matchCount = 0;

    if (byRepPlanVersion.length > 0) {
      chosen = pickMostRecentByDerivedAt(byRepPlanVersion);
      strategy = 'rep+plan+version';
      matchCount = byRepPlanVersion.length;
    } else if (byRepVersion.length > 0) {
      chosen = pickMostRecentByDerivedAt(byRepVersion);
      strategy = 'rep+version';
      matchCount = byRepVersion.length;
    } else if (byRepPlan.length > 0) {
      chosen = pickMostRecentByDerivedAt(byRepPlan);
      strategy = 'rep+plan';
      matchCount = byRepPlan.length;
    }

    if (!chosen) {
      summary.skippedNoTemplate += 1;
      summary.trulyMissing.push({
        orphanId: orphan.id,
        planName: orphan.planName ?? null,
        repPuctCertificate: orphan.repPuctCertificate ?? null,
        eflVersionCode: orphan.eflVersionCode ?? null,
        reason: 'NO_TEMPLATE_MATCH',
      });
      continue;
    }

    if (matchCount > 1) summary.ambiguous += 1;

    const idMaps = await prisma.offerIdRatePlanMap.findMany({
      where: { ratePlanId: orphan.id },
      select: { id: true, offerId: true, ratePlanId: true },
      take: 5000,
    });

    const rateMaps = await prisma.offerRateMap.findMany({
      where: { ratePlanId: orphan.id },
      select: { id: true, offerId: true, ratePlanId: true },
      take: 5000,
    });

    const totalMaps = idMaps.length + rateMaps.length;

    if (!totalMaps) {
      summary.skippedNoMap += 1;
      summary.details.push({
        orphanId: orphan.id,
        templateId: chosen.id,
        strategy,
        matches: matchCount,
        offerIdRatePlanMapUpdated: 0,
        offerRateMapUpdated: 0,
        mapsUpdated: 0,
        note: 'No OfferIdRatePlanMap or OfferRateMap rows referenced this orphan (safe to ignore or delete later).',
      });
      continue;
    }

    if (!DRY_RUN) {
      const resOfferId = await prisma.offerIdRatePlanMap.updateMany({
        where: { ratePlanId: orphan.id },
        data: {
          ratePlanId: chosen.id,
          lastLinkedAt: new Date(),
          linkedBy: 'scripts/admin/rewire-offer-rateplan-map.mjs',
          notes: `rewired from orphan RatePlan ${orphan.id} via ${strategy}`,
        },
      });
      const resOfferRate = await prisma.offerRateMap.updateMany({
        where: { ratePlanId: orphan.id },
        data: {
          ratePlanId: chosen.id,
        },
      });
      summary.rewiredOfferIdMaps += resOfferId.count;
      summary.rewiredOfferRateMaps += resOfferRate.count;
      summary.rewiredMaps += resOfferId.count + resOfferRate.count;
    } else {
      summary.rewiredOfferIdMaps += idMaps.length;
      summary.rewiredOfferRateMaps += rateMaps.length;
      summary.rewiredMaps += totalMaps;
    }

    summary.affectedOffers += totalMaps;
    summary.details.push({
      orphanId: orphan.id,
      templateId: chosen.id,
      strategy,
      matches: matchCount,
      offerIdRatePlanMapUpdated: idMaps.length,
      offerRateMapUpdated: rateMaps.length,
      mapsUpdated: totalMaps,
      offerIdsSample: [...idMaps, ...rateMaps].slice(0, 10).map((m) => m.offerId),
      dryRun: DRY_RUN,
    });
  }

  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((e) => {
    console.error('ERROR:', e?.message || e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });


