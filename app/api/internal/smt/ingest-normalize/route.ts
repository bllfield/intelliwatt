export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { normalizeSmtTo15Min } from '@/lib/analysis/normalizeSmt';
import { requireSharedSecret } from '@/lib/auth/shared';

// Optional: adjust these to your actual raw model & column names if you want windowed fetch:
const RAW_MODEL_CANDIDATES = ['rawSmtRow', 'rawSmtRows', 'rawSmtFile', 'rawSmtFiles', 'smtRawRow', 'smtRawRows'];

export async function POST(req: NextRequest) {
  const guard = requireSharedSecret(req);
  if (guard) return guard;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'BAD_JSON' }, { status: 400 });
  }

  const { esiid, meter, rows, from, to, debug = false, saveFilled = true } = body || {};

  // 1) Load candidate raws (direct rows preferred)
  let raws: any[] = [];

  if (Array.isArray(rows) && rows.length) {
    raws = rows;
  } else {
    // Fallback: windowed fetch from raw model
    let dao: any = null;
    for (const name of RAW_MODEL_CANDIDATES) {
      if ((prisma as any)[name]?.findMany) {
        dao = (prisma as any)[name];
        break;
      }
    }
    if (!dao) {
      return NextResponse.json({ ok: false, error: 'NO_RAW_MODEL', tried: RAW_MODEL_CANDIDATES }, { status: 500 });
    }

    const where: any = {};
    if (esiid) where.esiid = esiid;
    if (meter) where.meter = meter;
    if (from || to) {
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

  // 2) Shape → normalize
  const shaped = raws.map((r: any) => ({
    esiid: r.esiid ?? esiid,
    meter: r.meter ?? meter,
    timestamp: r.timestamp ?? r.end ?? undefined, // accept either explicit end or generic timestamp as END
    kwh: r.kwh ?? r.value ?? undefined,
    start: r.start ?? undefined,
    end: r.end ?? undefined,
  }));

  const norm = normalizeSmtTo15Min(shaped).map((p: any) => ({
    ...p,
    esiid: esiid ?? shaped[0]?.esiid ?? 'unknown',
    meter: meter ?? shaped[0]?.meter ?? 'unknown',
    filled: p.filled ?? (p.kwh === 0),
    source: 'smt',
  }));

  // 3) Persist with guards (zeros persist; never overwrite real with zero; upgrade zero→real)
  let persisted = 0;
  for (const p of norm) {
    if (!p.esiid || !p.meter) continue;
    if (!saveFilled && p.filled) continue;

    const key = { esiid_meter_ts: { esiid: p.esiid, meter: p.meter, ts: new Date(p.ts) } };
    const existing = await prisma.smtInterval.findUnique({ where: key });

    if (!existing) {
      await prisma.smtInterval.create({
        data: { esiid: p.esiid, meter: p.meter, ts: new Date(p.ts), kwh: p.kwh, filled: !!p.filled, source: p.source },
      });
      persisted++;
      continue;
    }

    const isExistingReal = existing.filled === false;
    const isIncomingReal = p.filled === false;

    if (isExistingReal && !isIncomingReal) {
      // don't overwrite real with zero
      continue;
    }

    // upgrade zero→real OR update real→real (or zero→zero idempotently)
    await prisma.smtInterval.update({
      where: key,
      data: { kwh: p.kwh, filled: isIncomingReal ? false : existing.filled, source: p.source ?? existing.source ?? 'smt' },
    });
    persisted++;
  }

  const res: any = { ok: true, processed: raws.length, normalizedPoints: norm.length, persisted };
  if (debug) res.debug = { sample: norm.slice(0, 3) };
  return NextResponse.json(res);
}
