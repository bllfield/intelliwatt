// app/api/admin/cron/normalize-smt-catch/route.ts
// Catch-up worker: looks back 3 days, finds days with missing data, triggers normalization
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireVercelCron } from '@/lib/auth/cron';
import { computeDailySummaries } from '@/lib/analysis/dailySummary';
import { DateTime } from 'luxon';
import { prisma } from '@/lib/db';
import { normalizeSmtTo15Min } from '@/lib/analysis/normalizeSmt';

function generateCorrId(): string {
  return `catch-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export async function POST(req: NextRequest) {
  const startMs = Date.now();
  const corrId = generateCorrId();

  const guard = requireVercelCron(req);
  if (guard) return guard;

  const tz = 'America/Chicago';
  const now = DateTime.now().setZone(tz);
  const dateEnd = now.toISODate() || '';
  const dateStart = now.minus({ days: 3 }).toISODate() || '';

  try {
    // 1) Find days with missing data
    const summaries = await computeDailySummaries({ dateStart, dateEnd, tz });
    const missingDays = summaries.filter((s) => s.has_missing);

    if (missingDays.length === 0) {
      const durationMs = Date.now() - startMs;
      return NextResponse.json({
        ok: true,
        corrId,
        route: 'normalize-smt-catch',
        durationMs,
        note: 'no-missing-days',
        checkedDays: summaries.length,
        missingDays: 0,
      });
    }

    // 2) For each missing day, try to fetch raw data and normalize
    const RAW_MODEL_CANDIDATES = ['rawSmtRow', 'rawSmtRows', 'rawSmtFile', 'rawSmtFiles', 'smtRawRow', 'smtRawRows'];
    let dao: any = null;
    for (const name of RAW_MODEL_CANDIDATES) {
      if ((prisma as any)[name]?.findMany) {
        dao = (prisma as any)[name];
        break;
      }
    }

    const results: Array<{ esiid: string; meter: string; date: string; processed: number; persisted: number }> = [];

    for (const day of missingDays) {
      // Skip if esiid or meter is null
      if (!day.esiid || !day.meter) {
        continue;
      }

      // Convert local day to UTC window
      const dayStartLocal = DateTime.fromISO(day.date, { zone: tz }).startOf('day');
      const dayEndLocal = dayStartLocal.plus({ days: 1 });
      const fromUTC = dayStartLocal.toUTC().toJSDate();
      const toUTC = dayEndLocal.toUTC().toJSDate();

      // Fetch raw rows for this ESIID/Meter/Date window
      if (!dao) {
        // No raw model available - skip
        continue;
      }

      const where: any = {
        esiid: day.esiid,
        meter: day.meter,
      };

      // Try to match by createdAt or received_at if available
      const rawRows = await dao.findMany({
        where,
        orderBy: { id: 'asc' },
        take: 10000, // reasonable limit
      });

      if (rawRows.length === 0) {
        continue; // No raw data available for this day
      }

      // Shape and normalize
      const shaped = rawRows.map((r: any) => ({
        esiid: r.esiid ?? day.esiid,
        meter: r.meter ?? day.meter,
        timestamp: r.timestamp ?? r.end ?? undefined,
        kwh: r.kwh ?? r.value ?? undefined,
        start: r.start ?? undefined,
        end: r.end ?? undefined,
      }));

      const norm = normalizeSmtTo15Min(shaped).map((p: any) => ({
        ...p,
        esiid: day.esiid,
        meter: day.meter,
        filled: p.filled ?? (p.kwh === 0),
        source: 'smt',
      }));

      // Filter to only intervals within the target day (in local time)
      const filtered = norm.filter((p: any) => {
        const localDt = DateTime.fromISO(p.ts).setZone(tz);
        const localDate = localDt.toISODate();
        return localDate === day.date;
      });

      if (filtered.length === 0) {
        continue; // No intervals for this day after filtering
      }

      // Persist with guards (same logic as ingest-normalize)
      let persisted = 0;
      for (const p of filtered) {
        const key = { esiid_meter_ts: { esiid: p.esiid, meter: p.meter, ts: new Date(p.ts) } };
        const existing = await prisma.smtInterval.findUnique({ where: key });

        if (!existing) {
          try {
            await prisma.smtInterval.create({
              data: {
                esiid: p.esiid,
                meter: p.meter,
                ts: new Date(p.ts),
                kwh: p.kwh,
                filled: !!p.filled,
                source: p.source,
              },
            });
            persisted++;
          } catch (err) {
            if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
              // duplicate key constraint; skip silently
            } else {
              throw err;
            }
          }
          continue;
        }

        const isExistingReal = existing.filled === false;
        const isIncomingReal = p.filled === false;

        if (isExistingReal && !isIncomingReal) {
          // don't overwrite real with zero
          continue;
        }

        // upgrade zero→real OR update real→real
        await prisma.smtInterval.update({
          where: key,
          data: {
            kwh: p.kwh,
            filled: isIncomingReal ? false : existing.filled,
            source: p.source ?? existing.source ?? 'smt',
          },
        });
        persisted++;
      }

      results.push({
        esiid: day.esiid,
        meter: day.meter,
        date: day.date,
        processed: rawRows.length,
        persisted,
      });
    }

    const durationMs = Date.now() - startMs;
    return NextResponse.json({
      ok: true,
      corrId,
      route: 'normalize-smt-catch',
      durationMs,
      checkedDays: summaries.length,
      missingDays: missingDays.length,
      processed: results.length,
      results,
    });
  } catch (error: any) {
    const durationMs = Date.now() - startMs;
    return NextResponse.json(
      {
        ok: false,
        corrId,
        route: 'normalize-smt-catch',
        durationMs,
        error: error?.message || 'UNKNOWN_ERROR',
      },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  // Allow GET for manual testing (still requires cron auth)
  return POST(req);
}
