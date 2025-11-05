// app/api/admin/analysis/normalize-smt/route.ts
export const runtime = 'nodejs';

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin';
import {
  normalizeSmtTo15Min,
  fillMissing15Min,
  groupNormalize,
  buildDailyCompleteness,
} from '@/lib/analysis/normalizeSmt';
import { TZ_BUILD_ID } from '@/lib/time/tz';
import { prisma } from '@/lib/db';

type GroupBy = 'none' | 'esiid' | 'meter' | 'esiid_meter';

function splitKey(key: string): { esiid?: string; meter?: string } {
  const [esiid, meter] = key.split('|');
  return {
    esiid: esiid && esiid !== 'unknown' ? esiid : undefined,
    meter: meter && meter !== 'unknown' ? meter : undefined,
  };
}

export async function POST(req: NextRequest) {
  const gate = requireAdmin(req);
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'BAD_JSON', tzBuild: TZ_BUILD_ID }, { status: 400 });
  }

  const rows = body?.rows;
  if (!Array.isArray(rows)) {
    return NextResponse.json(
      { ok: false, error: 'VALIDATION', details: 'Body must be { rows: Array }', tzBuild: TZ_BUILD_ID },
      { status: 400 }
    );
  }

  const tz = typeof body?.tz === 'string' ? body.tz : 'America/Chicago';
  const strictTz = body?.strictTz !== false;
  const ambiguous = body?.ambiguous === 'later' ? 'later' : 'earlier';

  const doFill = body?.fill === true;
  const start = typeof body?.start === 'string' ? body.start : undefined;
  const end = typeof body?.end === 'string' ? body.end : undefined;

  const groupBy: GroupBy =
    body?.groupBy === 'esiid' || body?.groupBy === 'meter' || body?.groupBy === 'esiid_meter'
      ? body.groupBy
      : 'none';

  const wantDaily = body?.report === 'daily';

  // Non-save path (existing behavior preserved)
  const doSave: boolean = body?.save === true;
  const dryRun: boolean = body?.dryRun === true;
  const source: string | undefined = typeof body?.source === 'string' ? body.source : undefined;

  // GROUPED branch
  if (groupBy !== 'none') {
    const { groups, totalCount } = groupNormalize(
      rows,
      groupBy,
      { tz, strictTz, ambiguous },
      { fill: doFill, start, end }
    );

    let daily: Record<string, ReturnType<typeof buildDailyCompleteness>> | undefined;

    if (wantDaily) {
      daily = {};
      for (const [key, val] of Object.entries(groups)) {
        daily[key] = buildDailyCompleteness(val.points, tz);
      }
    }

    // SAVE logic (only allowed for esiid_meter)
    if (doSave) {
      if (groupBy !== 'esiid_meter') {
        return NextResponse.json(
          {
            ok: false,
            error: 'SAVE_REQUIRES_ESIID_METER',
            details: 'Use groupBy:"esiid_meter" when save:true',
            tzBuild: TZ_BUILD_ID,
          },
          { status: 400 }
        );
      }

      // Build rows to persist
      type SaveRow = { esiid: string; meter: string; ts: string; kwh: number; filled: boolean; source?: string };
      const toSave: SaveRow[] = [];

      for (const [key, val] of Object.entries(groups)) {
        const { esiid, meter } = splitKey(key);
        if (!esiid || !meter) continue; // skip unknown identifiers

        for (const p of val.points) {
          toSave.push({
            esiid,
            meter,
            ts: p.ts,
            kwh: p.kwh,
            filled: !!p.filled,
            source,
          });
        }
      }

      if (dryRun) {
        return NextResponse.json({
          ok: true,
          grouped: true,
          groupBy,
          tz,
          ambiguous,
          filled: doFill,
          tzBuild: TZ_BUILD_ID,
          daily,
          totalCount,
          save: { requested: toSave.length, persisted: 0, dryRun: true, sample: toSave.slice(0, 50) },
          groups,
        });
      }

      // Chunk upserts (simple first pass)
      let persisted = 0;
      const chunkSize = 500;
      for (let i = 0; i < toSave.length; i += chunkSize) {
        const chunk = toSave.slice(i, i + chunkSize);
        // Use upsert per row (safe initial implementation)
        for (const r of chunk) {
          await prisma.smtInterval.upsert({
            where: { esiid_meter_ts: { esiid: r.esiid, meter: r.meter, ts: new Date(r.ts) } },
            update: { kwh: r.kwh, filled: r.filled, source: r.source },
            create: {
              esiid: r.esiid,
              meter: r.meter,
              ts: new Date(r.ts),
              kwh: r.kwh,
              filled: r.filled,
              source: r.source,
            },
          });
          persisted++;
        }
      }

      return NextResponse.json({
        ok: true,
        grouped: true,
        groupBy,
        tz,
        ambiguous,
        filled: doFill,
        tzBuild: TZ_BUILD_ID,
        daily,
        totalCount,
        save: { requested: toSave.length, persisted, dryRun: false },
        groups,
      });
    }

    // Non-save grouped response
    return NextResponse.json({
      ok: true,
      grouped: true,
      groupBy,
      tz,
      ambiguous,
      filled: doFill,
      tzBuild: TZ_BUILD_ID,
      ...(wantDaily ? { daily } : {}),
      totalCount,
      groups,
    });
  }

  // NON-GROUPED branch (no save here)
  const points = normalizeSmtTo15Min(rows, { tz, strictTz, ambiguous });
  const finalPoints = doFill ? fillMissing15Min(points, { start, end }) : points;
  const report = wantDaily ? buildDailyCompleteness(finalPoints, tz) : undefined;

  return NextResponse.json({
    ok: true,
    count: finalPoints.length,
    filled: doFill,
    tz,
    ambiguous,
    tzBuild: TZ_BUILD_ID,
    ...(wantDaily ? { daily: report } : {}),
    points: finalPoints,
  });
}
