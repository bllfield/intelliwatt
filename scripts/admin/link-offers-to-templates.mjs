import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

function hasText(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function normStr(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function normUrl(v) {
  const s = normStr(v);
  return s ? s : '';
}

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

function parseCsvEnv(value) {
  const raw = (value || '').trim();
  if (!raw) return null;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function pickMostRecent(rows) {
  if (!rows.length) return null;
  if (rows.length === 1) return rows[0];
  const sorted = [...rows].sort((a, b) => {
    const a1 = a.planCalcDerivedAt ? new Date(a.planCalcDerivedAt).getTime() : 0;
    const b1 = b.planCalcDerivedAt ? new Date(b.planCalcDerivedAt).getTime() : 0;
    if (b1 !== a1) return b1 - a1;
    const a2 = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const b2 = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    return b2 - a2;
  });
  return sorted[0] || null;
}

async function main() {
  const DATABASE_URL_SET = !!process.env.DATABASE_URL;
  console.log(`DATABASE_URL set? ${DATABASE_URL_SET ? 'yes' : 'no'}`);
  if (!DATABASE_URL_SET) process.exit(2);

  const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
  const ALLOW_AMBIGUOUS =
    process.env.ALLOW_AMBIGUOUS === '1' || process.env.ALLOW_AMBIGUOUS === 'true';
  const OFFER_IDS = parseCsvEnv(process.env.OFFER_IDS);
  const LIMIT = Number(process.env.LIMIT || 2000) || 2000;

  if (!prisma.offerIdRatePlanMap) {
    console.error('ERROR: Prisma client has no model "offerIdRatePlanMap".');
    process.exit(2);
  }
  if (!prisma.offerRateMap) {
    console.error('ERROR: Prisma client has no model "offerRateMap".');
    process.exit(2);
  }

  /**
   * Build a set of offers that are *known in DB* and currently unmapped in OfferIdRatePlanMap.
   * We merge metadata from:
   * - MasterPlan (offerId, supplierPuctNo, planName, termMonths, eflUrl)
   * - OfferRateMap + RateConfig (offerId, eflUrl, planName, termMonths)
   */

  const offerMetaById = new Map();

  // 1) From MasterPlan (best for repPuctCertificate via supplierPuctNo).
  const masterPlans = await prisma.masterPlan.findMany({
    where: {
      offerId: OFFER_IDS?.length ? { in: OFFER_IDS } : { not: null },
    },
    select: {
      offerId: true,
      supplierPuctNo: true,
      planName: true,
      termMonths: true,
      eflUrl: true,
      supplierName: true,
      updatedAt: true,
    },
    take: LIMIT,
    orderBy: { updatedAt: 'desc' },
  });

  for (const mp of masterPlans) {
    const offerId = mp.offerId ? String(mp.offerId) : null;
    if (!offerId) continue;
    offerMetaById.set(offerId, {
      offerId,
      repPuctCertificate: hasText(mp.supplierPuctNo) ? String(mp.supplierPuctNo) : null,
      planName: hasText(mp.planName) ? String(mp.planName) : null,
      termMonths: typeof mp.termMonths === 'number' ? mp.termMonths : null,
      eflUrl: hasText(mp.eflUrl) ? String(mp.eflUrl) : null,
      supplierName: hasText(mp.supplierName) ? String(mp.supplierName) : null,
      source: 'MasterPlan',
    });
  }

  // 2) From OfferRateMap + RateConfig (may include offers not in MasterPlan).
  const offerRateMaps = await prisma.offerRateMap.findMany({
    where: {
      offerId: OFFER_IDS?.length ? { in: OFFER_IDS } : { not: '' },
    },
    select: {
      offerId: true,
      eflUrl: true,
      ratePlanId: true,
      rateConfig: { select: { planName: true, termMonths: true, supplierName: true, supplierSlug: true } },
      updatedAt: true,
      lastSeenAt: true,
    },
    take: LIMIT,
    orderBy: { lastSeenAt: 'desc' },
  });

  for (const orm of offerRateMaps) {
    const offerId = orm.offerId ? String(orm.offerId) : null;
    if (!offerId) continue;
    const existing = offerMetaById.get(offerId) || { offerId };
    offerMetaById.set(offerId, {
      ...existing,
      eflUrl: existing.eflUrl ?? (hasText(orm.eflUrl) ? String(orm.eflUrl) : null),
      planName:
        existing.planName ??
        (hasText(orm.rateConfig?.planName) ? String(orm.rateConfig.planName) : null),
      termMonths:
        existing.termMonths ??
        (typeof orm.rateConfig?.termMonths === 'number' ? orm.rateConfig.termMonths : null),
      supplierName:
        existing.supplierName ??
        (hasText(orm.rateConfig?.supplierName) ? String(orm.rateConfig.supplierName) : null),
      source: existing.source ?? 'OfferRateMap',
      existingOfferRateMapRatePlanId: orm.ratePlanId ? String(orm.ratePlanId) : null,
    });
  }

  const offerIdsAll = Array.from(offerMetaById.keys());
  if (!offerIdsAll.length) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          note:
            'No DB-backed offers found to link (MasterPlan/OfferRateMap empty). This script only links offers that already exist in the DB.',
          nextSteps: [
            'If you want the dashboard (/dashboard/plans) to show templates, run the in-app prefetch which upserts OfferIdRatePlanMap for live offers:',
            "In browser DevTools (while logged in): await fetch('/api/dashboard/plans/prefetch?maxOffers=10&timeBudgetMs=25000', { method: 'POST' }).then(r => r.json())",
            'If you want OfferRateMap/RateConfig populated in DB for scripting, run POST /api/wattbuy/offers/sync (writes OfferRateMap).',
          ],
        },
        null,
        2,
      ),
    );
    return;
  }

  // Pull current OfferIdRatePlanMap for those offers, then keep only missing/null links.
  const existingMaps = await prisma.offerIdRatePlanMap.findMany({
    where: { offerId: { in: offerIdsAll } },
    select: { offerId: true, ratePlanId: true },
  });
  const mappedOfferIds = new Map(existingMaps.map((m) => [String(m.offerId), m.ratePlanId ? String(m.ratePlanId) : null]));

  const candidates = offerIdsAll
    .map((offerId) => ({
      ...offerMetaById.get(offerId),
      currentOfferIdRatePlanId: mappedOfferIds.get(offerId) ?? null,
    }))
    .filter((row) => row.currentOfferIdRatePlanId == null);

  // Load template RatePlans (rateStructure present only).
  const templates = await prisma.ratePlan.findMany({
    where: { isUtilityTariff: false },
    select: {
      id: true,
      repPuctCertificate: true,
      planName: true,
      termMonths: true,
      eflUrl: true,
      eflSourceUrl: true,
      eflVersionCode: true,
      eflPdfSha256: true,
      planCalcDerivedAt: true,
      updatedAt: true,
      rateStructure: true,
    },
    take: 10000,
    orderBy: { updatedAt: 'desc' },
  });

  const templateRows = templates.filter((t) => isRateStructurePresent(t.rateStructure));

  const byEflUrl = new Map();
  for (const t of templateRows) {
    const urls = [normUrl(t.eflUrl), normUrl(t.eflSourceUrl)].filter(Boolean);
    for (const u of urls) {
      const arr = byEflUrl.get(u) || [];
      arr.push(t);
      byEflUrl.set(u, arr);
    }
  }

  const summary = {
    dryRun: DRY_RUN,
    allowAmbiguous: ALLOW_AMBIGUOUS,
    offersConsidered: offerIdsAll.length,
    unmappedOffersConsidered: candidates.length,
    linked: 0,
    ambiguousSkipped: 0,
    noTemplate: 0,
    offerIdRatePlanMapUpserts: 0,
    offerRateMapUpdates: 0,
    details: [],
  };

  const now = new Date();

  for (const row of candidates) {
    const offerId = String(row.offerId);
    const eflUrl = hasText(row.eflUrl) ? normUrl(row.eflUrl) : '';
    const rep = hasText(row.repPuctCertificate) ? String(row.repPuctCertificate) : null;
    const planName = hasText(row.planName) ? String(row.planName) : null;
    const termMonths = typeof row.termMonths === 'number' ? row.termMonths : null;

    // Match strategy priority:
    // 1) exact EFL URL match (strongest)
    // 2) rep + planName + termMonths
    // 3) rep + planName
    let matches = [];
    let strategy = null;

    if (eflUrl) {
      const found = byEflUrl.get(eflUrl) || [];
      if (found.length) {
        matches = found;
        strategy = 'eflUrl';
      }
    }

    if (!matches.length && rep && planName && termMonths != null) {
      matches = templateRows.filter(
        (t) =>
          String(t.repPuctCertificate || '') === rep &&
          String(t.planName || '') === planName &&
          (typeof t.termMonths === 'number' ? t.termMonths : null) === termMonths,
      );
      if (matches.length) strategy = 'rep+plan+term';
    }

    if (!matches.length && rep && planName) {
      matches = templateRows.filter(
        (t) => String(t.repPuctCertificate || '') === rep && String(t.planName || '') === planName,
      );
      if (matches.length) strategy = 'rep+plan';
    }

    if (!matches.length) {
      summary.noTemplate += 1;
      summary.details.push({
        offerId,
        action: 'NO_TEMPLATE',
        repPuctCertificate: rep,
        planName,
        termMonths,
        eflUrl: eflUrl || null,
        source: row.source,
      });
      continue;
    }

    if (matches.length > 1 && !ALLOW_AMBIGUOUS) {
      summary.ambiguousSkipped += 1;
      summary.details.push({
        offerId,
        action: 'AMBIGUOUS_SKIPPED',
        strategy,
        matches: matches.length,
        repPuctCertificate: rep,
        planName,
        termMonths,
        eflUrl: eflUrl || null,
        candidateRatePlanIds: matches.slice(0, 10).map((m) => String(m.id)),
      });
      continue;
    }

    const chosen = pickMostRecent(matches);
    if (!chosen) {
      summary.noTemplate += 1;
      summary.details.push({ offerId, action: 'NO_TEMPLATE_AFTER_PICK', strategy });
      continue;
    }

    if (!DRY_RUN) {
      // Canonical mapping (works even without OfferRateMap rows)
      await prisma.offerIdRatePlanMap.upsert({
        where: { offerId },
        create: {
          offerId,
          ratePlanId: String(chosen.id),
          lastLinkedAt: now,
          linkedBy: 'scripts/admin/link-offers-to-templates.mjs',
          notes: `linked via ${strategy}`,
        },
        update: {
          ratePlanId: String(chosen.id),
          lastLinkedAt: now,
          linkedBy: 'scripts/admin/link-offers-to-templates.mjs',
          notes: `linked via ${strategy}`,
        },
      });
      summary.offerIdRatePlanMapUpserts += 1;

      // Secondary enrichment (never create OfferRateMap rows; only update existing)
      const upd = await prisma.offerRateMap.updateMany({
        where: { offerId },
        data: { ratePlanId: String(chosen.id), lastSeenAt: now },
      });
      summary.offerRateMapUpdates += Number(upd?.count ?? 0) || 0;
    }

    summary.linked += 1;
    summary.details.push({
      offerId,
      action: DRY_RUN ? 'WOULD_LINK' : 'LINKED',
      strategy,
      matches: matches.length,
      chosenRatePlanId: String(chosen.id),
      repPuctCertificate: rep,
      planName,
      termMonths,
      eflUrl: eflUrl || null,
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


