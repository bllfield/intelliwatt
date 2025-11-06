// app/api/internal/smt/ingest-normalize/route.ts
// Fast path: on-demand normalize+save used right after raw ingest
// Called by the droplet immediately after it POSTs the raw rows (or after it writes to raw table).
// Fast path: accepts either explicit rows OR a small time window (from/to) + esiid/meter filter.
// Uses saved WattBuy rates later in your analysis route—no need to call WattBuy here.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { DateTime } from 'luxon';
import { prisma } from '@/lib/db';
import { requireSharedSecret } from '@/lib/auth/shared';
import { normalizeSmtTo15Min, type SmtAdhocRow, type SmtGbRow } from '@/lib/analysis/normalizeSmt';

export async function POST(req: NextRequest) {
  const guard = requireSharedSecret(req);
  if (guard) return guard;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'BAD_JSON' }, { status: 400 });
  }

  const {
    tz = 'America/Chicago',
    strictTz = true,
    esiid,
    meter,
    from, // ISO local or UTC
    to, // ISO local or UTC
    rows, // optional immediate rows [{ esiid, meter, timestamp|start|end, kwh|value }, ...]
  } = body || {};

  // 1) Load candidate raws
  let raws: any[] = [];

  if (Array.isArray(rows) && rows.length) {
    raws = rows;
  } else {
    // Fallback: pull recent raws from RawSmtFile by created_at
    // Note: RawSmtFile is metadata only; actual data would need to be parsed from content
    // For now, we'll return an error if rows aren't provided
    // In production, you might have a separate raw data table or parse from content
    if (!from || !to) {
      return NextResponse.json(
        {
          ok: false,
          error: 'MISSING_DATA',
          details: 'Either provide rows array or from/to timestamps with esiid/meter',
        },
        { status: 400 }
      );
    }

    // Try to find raw files in the time window
    const fromDate = new Date(from);
    const toDate = new Date(to);

    const rawFiles = await prisma.rawSmtFile.findMany({
      where: {
        created_at: {
          gte: fromDate,
          lte: toDate,
        },
      },
      orderBy: { created_at: 'asc' },
      take: 100, // Limit to avoid huge queries
    });

    // Note: RawSmtFile.content is Bytes, would need parsing
    // For now, return error suggesting rows parameter
    if (rawFiles.length === 0) {
      return NextResponse.json({
        ok: true,
        processed: 0,
        persisted: 0,
        note: 'NO_RAWS_FOUND',
        hint: 'Provide rows array for immediate processing',
      });
    }

    return NextResponse.json(
      {
        ok: false,
        error: 'RAW_FILE_PARSING_NOT_IMPLEMENTED',
        details:
          'RawSmtFile contains metadata only. Please provide rows array directly, or implement content parsing.',
        foundFiles: rawFiles.length,
      },
      { status: 501 }
    );
  }

  if (!raws.length) {
    return NextResponse.json({ ok: true, processed: 0, persisted: 0, note: 'NO_RAWS' });
  }

  // 2) Shape → normalize to 15-min START UTC (no fill here for speed)
  const shaped: Array<SmtAdhocRow | SmtGbRow> = raws.map((r) => ({
    esiid: r.esiid ?? esiid,
    meter: r.meter ?? meter,
    timestamp: r.timestamp ?? undefined,
    kwh: r.kwh ?? r.value ?? undefined,
    start: r.start ?? undefined,
    end: r.end ?? undefined,
    value: r.value ?? r.kwh ?? undefined,
  }));

  const points = normalizeSmtTo15Min(shaped, { tz, strictTz });

  // Extract esiid/meter from first row or use provided defaults
  const firstRow = shaped[0] as SmtAdhocRow | SmtGbRow;
  const defaultEsiid = esiid ?? ('esiid' in firstRow ? firstRow.esiid : undefined) ?? 'unknown';
  const defaultMeter = meter ?? ('meter' in firstRow ? firstRow.meter : undefined) ?? 'unknown';

  // 3) Persist quickly (upsert on { esiid, meter, ts })
  let persisted = 0;
  for (const p of points) {
    const pointEsiid = (p as any).esiid ?? defaultEsiid;
    const pointMeter = (p as any).meter ?? defaultMeter;

    if (!pointEsiid || pointEsiid === 'unknown' || !pointMeter || pointMeter === 'unknown') {
      continue;
    }

    try {
      await (prisma as any).smtInterval.upsert({
        where: { esiid_meter_ts: { esiid: pointEsiid, meter: pointMeter, ts: new Date(p.ts) } },
        update: { kwh: p.kwh, filled: false, source: 'smt' },
        create: {
          esiid: pointEsiid,
          meter: pointMeter,
          ts: new Date(p.ts),
          kwh: p.kwh,
          filled: false,
          source: 'smt',
        },
      });
      persisted++;
    } catch (error: any) {
      // Log error but continue processing
      console.error('[ingest-normalize] upsert failed', { esiid: pointEsiid, meter: pointMeter, ts: p.ts, error });
    }
  }

  // 4) Return fast so frontend can run the analysis immediately using cached WattBuy plans
  return NextResponse.json({
    ok: true,
    tz,
    strictTz,
    processed: raws.length,
    normalizedPoints: points.length,
    persisted,
  });
}

