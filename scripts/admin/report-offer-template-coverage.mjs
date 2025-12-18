import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

function isJsonNullLike(v) {
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

async function main() {
  const DATABASE_URL_SET = !!process.env.DATABASE_URL;
  console.log(`DATABASE_URL set? ${DATABASE_URL_SET ? 'yes' : 'no'}`);
  if (!DATABASE_URL_SET) process.exit(2);

  const LIMIT = Number(process.env.LIMIT || 200) || 200;

  // Pull all mapped offers and their templates. (This is what dashboard uses.)
  const maps = await prisma.offerIdRatePlanMap.findMany({
    where: { ratePlanId: { not: null } },
    select: { offerId: true, ratePlanId: true, updatedAt: true },
    take: 50_000,
    orderBy: { updatedAt: 'desc' },
  });

  const ratePlanIds = Array.from(
    new Set(maps.map((m) => (m.ratePlanId ? String(m.ratePlanId) : null)).filter(Boolean)),
  );

  const ratePlans = await prisma.ratePlan.findMany({
    where: { id: { in: ratePlanIds } },
    select: {
      id: true,
      repPuctCertificate: true,
      planName: true,
      termMonths: true,
      eflVersionCode: true,
      eflPdfSha256: true,
      eflUrl: true,
      rateStructure: true,
      planCalcStatus: true,
      planCalcReasonCode: true,
      requiredBucketKeys: true,
      planCalcDerivedAt: true,
      updatedAt: true,
    },
  });

  const rpById = new Map(ratePlans.map((r) => [String(r.id), r]));

  const rows = maps
    .map((m) => {
      const rp = m.ratePlanId ? rpById.get(String(m.ratePlanId)) : null;
      const requiredKeys = Array.isArray(rp?.requiredBucketKeys) ? rp.requiredBucketKeys : [];
      const rsPresent = rp ? isRateStructurePresent(rp.rateStructure) : false;
      return {
        offerId: String(m.offerId),
        ratePlanId: m.ratePlanId ? String(m.ratePlanId) : null,
        ratePlanFound: Boolean(rp),
        rateStructurePresent: rsPresent,
        planCalcStatus: typeof rp?.planCalcStatus === 'string' ? rp.planCalcStatus : null,
        planCalcReasonCode: typeof rp?.planCalcReasonCode === 'string' ? rp.planCalcReasonCode : null,
        requiredBucketKeysCount: requiredKeys.length,
        requiredBucketKeys: requiredKeys.map(String),
        repPuctCertificate: rp?.repPuctCertificate ?? null,
        planName: rp?.planName ?? null,
        termMonths: typeof rp?.termMonths === 'number' ? rp.termMonths : null,
        eflVersionCode: rp?.eflVersionCode ?? null,
        eflPdfSha256: rp?.eflPdfSha256 ?? null,
      };
    })
    .filter((x) => x.ratePlanId); // only mapped

  const counts = {
    mappedOffers: rows.length,
    ratePlanMissingRow: rows.filter((r) => !r.ratePlanFound).length,
    missingRateStructure: rows.filter((r) => r.ratePlanFound && !r.rateStructurePresent).length,
    requiredBucketKeysEmpty: rows.filter((r) => r.ratePlanFound && r.requiredBucketKeysCount === 0).length,
    planCalcStatusComputable: rows.filter((r) => r.planCalcStatus === 'COMPUTABLE').length,
    planCalcStatusNotComputable: rows.filter((r) => r.planCalcStatus === 'NOT_COMPUTABLE').length,
    planCalcStatusUnknown: rows.filter((r) => !r.planCalcStatus || r.planCalcStatus === 'UNKNOWN').length,
  };

  const offenders = {
    missingRateStructure: rows
      .filter((r) => r.ratePlanFound && !r.rateStructurePresent)
      .slice(0, LIMIT),
    requiredBucketKeysEmpty: rows
      .filter((r) => r.ratePlanFound && r.requiredBucketKeysCount === 0)
      .slice(0, LIMIT),
    notComputable: rows
      .filter((r) => r.planCalcStatus === 'NOT_COMPUTABLE')
      .slice(0, LIMIT),
    unknown: rows
      .filter((r) => !r.planCalcStatus || r.planCalcStatus === 'UNKNOWN')
      .slice(0, LIMIT),
  };

  console.log(
    JSON.stringify(
      {
        ok: true,
        note:
          'This report is offer-level: it only considers RatePlans referenced by OfferIdRatePlanMap (what /api/dashboard/plans uses).',
        counts,
        offenders,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error('ERROR:', e?.message || e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });


