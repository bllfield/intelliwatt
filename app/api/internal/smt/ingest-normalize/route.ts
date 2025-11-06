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

  const { esiid, meter, rows, from, to, debug = false } = body || {};

  // -------- 1) Load candidate raws --------
  let raws: any[] = [];

  if (Array.isArray(rows) && rows.length) {
    raws = rows;
  } else {
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

  // -------- 2) Shape for normalizer --------
  const shaped = raws.map((r, idx) => ({
    __idx: idx,
    esiid: r.esiid ?? esiid,
    meter: r.meter ?? meter,
    timestamp: r.timestamp ?? undefined,
    kwh: r.kwh ?? r.value ?? undefined,
    start: r.start ?? undefined,
    end: r.end ?? undefined,
  }));

  // --- DEBUG instrumentation wrapper around normalizeSmtTo15Min ---
  const debugSkips: Array<{ idx: number; reason: string; raw: any }> = [];

  function safeNormalize(input: any[]) {
    // We call the library one-by-one to catch which rows fail parsing.
    const out: any[] = [];
    for (const r of input) {
      let accepted = false;
      // emulate the library logic minimally for debug
      const num = (v: any) => {
        if (typeof v === 'number') return Number.isFinite(v) ? v : null;
        if (typeof v === 'string') {
          const n = Number(v.trim());
          return Number.isFinite(n) ? n : null;
        }
        return null;
      };
      const parse = (s?: string | null) => {
        if (!s) return null;
        try {
          const isoish = s.includes('T') ? s : s.replace(' ', 'T');
          const d = new Date(isoish);
          return Number.isFinite(d.getTime()) ? d : null;
        } catch {
          return null;
        }
      };

      // GB shape
      if (r.start || r.end) {
        const k = num(r.kwh ?? r.value);
        const sd = parse(r.start ?? undefined);
        const ed = parse(r.end ?? undefined);
        const startD = sd ?? (ed ? new Date(ed.getTime() - 15 * 60 * 1000) : null);
        if (k !== null && startD) {
          out.push({ ts: new Date(startD.getTime()).toISOString(), kwh: k, esiid: r.esiid, meter: r.meter });
          accepted = true;
        } else {
          debugSkips.push({
            idx: r.__idx ?? -1,
            reason: `GB_SHAPE_INVALID k=${k} sd=${!!sd} ed=${!!ed}`,
            raw: r,
          });
        }
      } else {
        // adhoc END timestamp
        const k = num(r.kwh);
        const ed = parse(r.timestamp ?? undefined);
        if (k !== null && ed) {
          const startD = new Date(ed.getTime() - 15 * 60 * 1000);
          out.push({ ts: new Date(startD.getTime()).toISOString(), kwh: k, esiid: r.esiid, meter: r.meter });
          accepted = true;
        } else {
          debugSkips.push({
            idx: r.__idx ?? -1,
            reason: `ADHOC_INVALID k=${k} endParsed=${!!ed}`,
            raw: r,
          });
        }
      }
      if (!accepted && !debug) {
        // ignore; we only report in debug mode
      }
    }
    // De-dupe & sort like the library
    const map = new Map<string, any>();
    for (const p of out) map.set(`${p.esiid}|${p.meter}|${p.ts}`, p);
    return Array.from(map.values()).sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  }

  const points = safeNormalize(shaped);

  // -------- 3) Persist (idempotent upsert) --------
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

  const res: any = { ok: true, processed: raws.length, normalizedPoints: points.length, persisted };
  if (debug) res.debug = { skips: debugSkips.slice(0, 50) }; // return first 50 reasons
  return NextResponse.json(res);
}
