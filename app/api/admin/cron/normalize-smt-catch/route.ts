// app/api/admin/cron/normalize-smt-catch/route.ts
// Catch-up worker: looks back 3 days, finds days with missing data, triggers normalization
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireVercelCron } from '@/lib/auth/cron';
import { computeDailySummaries } from '@/lib/analysis/dailySummary';
import { DateTime } from 'luxon';
import { loadSmtRawRows, normalizeAndPersistSmtIntervals } from '@/lib/usage/normalizeSmtIntervals';

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

    // 2) For each missing day, fetch raw rows then normalize + persist via shared module

    const results: Array<{ esiid: string; meter: string; date: string; processed: number; persisted: number }> = [];

    for (const day of missingDays) {
      // Skip if esiid or meter is null
      if (!day.esiid || !day.meter) {
        continue;
      }

      const loaded = await loadSmtRawRows({
        esiid: day.esiid,
        meter: day.meter,
        take: 10000,
      });
      if (!loaded.modelName) {
        // No raw model available
        continue;
      }
      const rawRows = loaded.rows;

      if (rawRows.length === 0) {
        continue; // No raw data available for this day
      }

      const out = await normalizeAndPersistSmtIntervals({
        rows: rawRows,
        esiid: day.esiid,
        meter: day.meter,
        source: 'smt',
        filterLocalDate: { date: day.date, timezone: tz },
      });
      if (out.consideredPoints === 0) {
        continue; // No intervals for this day after filtering
      }

      results.push({
        esiid: day.esiid,
        meter: day.meter,
        date: day.date,
        processed: rawRows.length,
        persisted: out.persisted,
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
