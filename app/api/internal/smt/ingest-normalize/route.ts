export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { normalizeSmtTo15Min } from '@/lib/analysis/normalizeSmt';
import { requireSharedSecret } from '@/lib/auth/shared';

function groupByEsidMeter(points: Array<any>) {
  const map = new Map<string, any[]>();
  for (const p of points) {
    const key = `${p.esiid ?? 'unknown'}|${p.meter ?? 'unknown'}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(p);
  }
  return map;
}

export async function POST(req: NextRequest) {
  const guard = requireSharedSecret(req);
  if (guard) return guard;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'BAD_JSON' }, { status: 400 });
  }

  const { esiid, meter, rows, from, to } = body || {};

  // 1) Load candidate raws
  let raws: any[] = [];

  if (Array.isArray(rows) && rows.length) {
    raws = rows;
  } else {
    // autodetect raw model; replace later if you know the exact model
    const candidates = ['rawSmtRow', 'rawSmtRows', 'rawSmtFile', 'rawSmtFiles', 'smtRawRow', 'smtRawRows'];
    let dao: any = null;
    for (const name of candidates) {
      if ((prisma as any)[name]?.findMany) {
        dao = (prisma as any)[name];
        break;
      }
    }
    if (!dao) {
      return NextResponse.json({ ok: false, error: 'NO_RAW_MODEL', tried: candidates }, { status: 500 });
    }

    const where: any = {};
    if (esiid) where.esiid = esiid;
    if (meter) where.meter = meter;
    if (from || to) {
      // adjust this timestamp field to your schema if different
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }
    raws = await dao.findMany({
      where: Object.keys(where).length ? where : undefined,
      orderBy: { id: 'asc' },
      take: 5000,
    });
  }

  if (!raws.length) {
    return NextResponse.json({ ok: true, processed: 0, normalizedPoints: 0, persisted: 0, note: 'NO_RAWS' });
  }

  // 2) Shape → normalize to 15-min UTC START slots
  const shaped = raws.map((r) => ({
    esiid: r.esiid ?? esiid,
    meter: r.meter ?? meter,
    timestamp: r.timestamp ?? undefined, // end timestamp form
    kwh: r.kwh ?? r.value ?? undefined,
    start: r.start ?? undefined, // GB shape
    end: r.end ?? undefined,
  }));

  const points = normalizeSmtTo15Min(shaped).map((p) => ({
    ...p,
    esiid: (p as any).esiid ?? esiid ?? shaped[0]?.esiid ?? 'unknown',
    meter: (p as any).meter ?? meter ?? shaped[0]?.meter ?? 'unknown',
  }));

  // 3) Persist fast (idempotent upsert on { esiid, meter, ts })
  let persisted = 0;
  for (const p of points) {
    if (!p.esiid || !p.meter) continue;
    await (prisma as any).smtInterval.upsert({
      where: { esiid_meter_ts: { esiid: p.esiid, meter: p.meter, ts: new Date(p.ts) } },
      update: { kwh: p.kwh, filled: false, source: 'smt' },
      create: { esiid: p.esiid, meter: p.meter, ts: new Date(p.ts), kwh: p.kwh, filled: false, source: 'smt' },
    });
    persisted++;
  }

  return NextResponse.json({ ok: true, processed: raws.length, normalizedPoints: points.length, persisted });
}
