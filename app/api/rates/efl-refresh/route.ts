// app/api/rates/efl-refresh/route.ts
// Step 10: Nightly EFL refresher — fetch EFL URLs, parse, and update RateConfig.
// Usage examples (DEV/ops):
//   POST {}                                  -> refresh missing fields for all known EFL URLs (safe default, capped)
//   POST { limit: 50 }                        -> limit batch size
//   POST { supplier: "gexa" }                 -> only this REP
//   POST { tdsp: "oncor" }                    -> only this TDSP
//   POST { offerIds: ["wbdb-abc", ...] }      -> refresh only plans referenced by these offer IDs
//   POST { force: true }                      -> re-parse even if fields/checksum exist
//   POST { dryRun: true }                     -> no DB writes; just returns what would change
//
// Hook this up to your scheduler/cron after testing in dev.

import { NextRequest, NextResponse } from 'next/server';
import { requireVercelCron } from '@/lib/auth/cron';
import { prisma } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { fetchAndParseEfl, toRateConfigUpdate } from '@/lib/efl';

type Payload = {
  offerIds?: string[];
  supplier?: string;  // e.g., "gexa"
  tdsp?: string;      // e.g., "oncor"
  limit?: number;     // cap items processed this run
  force?: boolean;    // ignore checksum/fields and force update
  dryRun?: boolean;   // report-only
  whereMissingOnly?: boolean; // default true
};

const DEFAULT_LIMIT = 40;

export async function POST(req: NextRequest) {
  const guard = requireVercelCron(req);
  if (guard) return guard;

  const body = (await req.json().catch(() => ({}))) as Partial<Payload>;
  const limit = Math.min(Math.max(body.limit ?? DEFAULT_LIMIT, 1), 250);
  const dryRun = !!body.dryRun;
  const force = !!body.force;
  const whereMissingOnly = body.whereMissingOnly ?? true;

  try {
    // 1) Build candidate list
    let candidates: Array<{
      id: string;
      eflUrl: string | null;
      checksum: string | null;
      supplierSlug: string | null;
      tdspSlug: string | null;
    }> = [];

    if (Array.isArray(body.offerIds) && body.offerIds.length) {
      // From specific offers → map to RateConfig via OfferRateMap
      const maps = await prisma.offerRateMap.findMany({
        where: { offerId: { in: body.offerIds } },
        select: { rateConfigId: true },
      });
      const rateConfigIds = maps.map((m) => m.rateConfigId);
      if (rateConfigIds.length) {
        const whereClause: any = {
          id: { in: rateConfigIds },
          ...(body.supplier ? { supplierSlug: body.supplier.toLowerCase() } : {}),
          ...(body.tdsp ? { tdspSlug: body.tdsp.toLowerCase() } : {}),
          eflUrl: { not: null },
        };

        if (whereMissingOnly && !force) {
          whereClause.OR = [
            { baseMonthlyFeeCents: null },
            { centsPerKwhJson: Prisma.JsonNull },
            { billCreditsJson: Prisma.JsonNull },
            { touWindowsJson: Prisma.JsonNull },
          ];
        }

        candidates = await prisma.rateConfig.findMany({
          where: whereClause,
          select: { id: true, eflUrl: true, checksum: true, supplierSlug: true, tdspSlug: true },
          take: limit,
        });
      }
    } else {
      // General scan by supplier/tdsp and "missing-only" heuristic
      const whereClause2: any = {
        ...(body.supplier ? { supplierSlug: body.supplier.toLowerCase() } : {}),
        ...(body.tdsp ? { tdspSlug: body.tdsp.toLowerCase() } : {}),
        eflUrl: { not: null },
        isActive: true,
      };

      if (whereMissingOnly && !force) {
        whereClause2.OR = [
          { baseMonthlyFeeCents: null },
          { centsPerKwhJson: Prisma.JsonNull },
          { billCreditsJson: Prisma.JsonNull },
          { touWindowsJson: Prisma.JsonNull },
        ];
      }

      candidates = await prisma.rateConfig.findMany({
        where: whereClause2,
        select: { id: true, eflUrl: true, checksum: true, supplierSlug: true, tdspSlug: true },
        take: limit,
      });
    }

    if (!candidates.length) {
      return NextResponse.json({
        processed: 0,
        updated: 0,
        skipped: 0,
        dryRun,
        candidates: 0,
        message: 'No matching RateConfig rows to refresh.',
      });
    }

    // 2) Process sequentially (stable + kind to vendor sites)
    const results: Array<{
      rateConfigId: string;
      supplier?: string | null;
      tdsp?: string | null;
      eflUrl?: string | null;
      action: 'updated' | 'skipped' | 'error';
      reason?: string;
      parsedSummary?: {
        baseMonthlyFeeCents?: number;
        tduDeliveryCentsPerKwh?: number;
        bands?: number;
        credits?: number;
        tou?: number;
        avgPrice500?: number;
        avgPrice1000?: number;
        avgPrice2000?: number;
      };
    }> = [];

    let updated = 0;
    let skipped = 0;

    for (const row of candidates) {
      const rateConfigId = row.id;
      const eflUrl = row.eflUrl;

      if (!eflUrl) {
        results.push({ rateConfigId, supplier: row.supplierSlug, tdsp: row.tdspSlug, eflUrl, action: 'skipped', reason: 'no EFL URL' });
        skipped++;
        continue;
      }

      try {
        const fetched = await fetchAndParseEfl(eflUrl);

        // If checksum matches and not forcing, skip
        if (!force && row.checksum && fetched.checksum === row.checksum) {
          results.push({
            rateConfigId,
            supplier: row.supplierSlug,
            tdsp: row.tdspSlug,
            eflUrl: fetched.finalUrl,
            action: 'skipped',
            reason: 'checksum unchanged',
            parsedSummary: {
              baseMonthlyFeeCents: fetched.parsed.baseMonthlyFeeCents,
              tduDeliveryCentsPerKwh: fetched.parsed.tduDeliveryCentsPerKwh,
              bands: fetched.parsed.centsPerKwhBands?.length ?? 0,
              credits: fetched.parsed.usageCredits?.length ?? 0,
              tou: fetched.parsed.touWindows?.length ?? 0,
              avgPrice500: fetched.parsed.avgPrice500,
              avgPrice1000: fetched.parsed.avgPrice1000,
              avgPrice2000: fetched.parsed.avgPrice2000,
            },
          });
          skipped++;
          continue;
        }

        // Prepare DB update
        const update = toRateConfigUpdate(fetched.parsed);
        const dbUpdate = {
          ...update,
          checksum: fetched.checksum,
          eflUrl: fetched.finalUrl || eflUrl, // persist canonical link if viewer redirected
          validFrom: new Date(), // mark freshness
          // validTo left as-is (you can add logic later if EFL states an end period)
        };

        if (!dryRun) {
          await prisma.rateConfig.update({
            where: { id: rateConfigId },
            data: dbUpdate,
          });
        }

        results.push({
          rateConfigId,
          supplier: row.supplierSlug,
          tdsp: row.tdspSlug,
          eflUrl: fetched.finalUrl,
          action: dryRun ? 'skipped' : 'updated',
          reason: dryRun ? 'dryRun' : undefined,
          parsedSummary: {
            baseMonthlyFeeCents: fetched.parsed.baseMonthlyFeeCents,
            tduDeliveryCentsPerKwh: fetched.parsed.tduDeliveryCentsPerKwh,
            bands: fetched.parsed.centsPerKwhBands?.length ?? 0,
            credits: fetched.parsed.usageCredits?.length ?? 0,
            tou: fetched.parsed.touWindows?.length ?? 0,
            avgPrice500: fetched.parsed.avgPrice500,
            avgPrice1000: fetched.parsed.avgPrice1000,
            avgPrice2000: fetched.parsed.avgPrice2000,
          },
        });

        if (!dryRun) updated++;
        // Small politeness delay to avoid hammering REP doc servers
        await new Promise((r) => setTimeout(r, 250));
      } catch (err: any) {
        results.push({
          rateConfigId,
          supplier: row.supplierSlug,
          tdsp: row.tdspSlug,
          eflUrl,
          action: 'error',
          reason: typeof err?.message === 'string' ? err.message : 'parse/fetch error',
        });
      }
    }

    return NextResponse.json({
      processed: candidates.length,
      updated,
      skipped,
      dryRun,
      candidates: candidates.length,
      results,
      hint:
        'Schedule nightly with { whereMissingOnly:true, limit:100 }. For full re-index, run with { force:true }.',
    });
  } catch (e: any) {
    const message = typeof e?.message === 'string' ? e.message : 'efl refresh failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
