// app/api/admin/analysis/daily-summary/route.ts
import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { DateTime } from "luxon";
import { expectedIntervalsForDateISO } from "@/lib/analysis/dst";

export const runtime = 'nodejs';

export const dynamic = "force-dynamic";

function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function normalizeDateRange({ dateStart, dateEnd }: { dateStart?: string | null; dateEnd?: string | null }) {
  const zone = "America/Chicago";
  const todayLocal = DateTime.now().setZone(zone).startOf("day");
  const defaultStart = todayLocal.minus({ days: 7 });
  const defaultEnd = todayLocal.plus({ days: 1 });

  const start = dateStart ? DateTime.fromISO(dateStart, { zone }) : defaultStart;
  const end = dateEnd ? DateTime.fromISO(dateEnd, { zone }) : defaultEnd;
  return { start, end, zone };
}

export async function GET(req: NextRequest) {
  const admin = req.headers.get("x-admin-token");
  if (!process.env.ADMIN_TOKEN || admin !== process.env.ADMIN_TOKEN) {
    return jsonError("Unauthorized", 401);
  }

  const url = new URL(req.url);
  const esiid = url.searchParams.get("esiid");
  const meter = url.searchParams.get("meter");
  const dateStart = url.searchParams.get("dateStart");
  const dateEnd = url.searchParams.get("dateEnd");

  const { start, end, zone } = normalizeDateRange({ dateStart, dateEnd });
  if (!start.isValid || !end.isValid || end <= start) {
    return jsonError("Invalid dateStart/dateEnd");
  }

  const rawTable = process.env.SMT_INTERVAL_TABLE || 'SmtInterval';
  const SMT_TABLE = `"${rawTable.replace(/"/g, '""')}"`;
  const prisma = new PrismaClient();

  try {
    const params: any[] = [];
    let idx = 1;
    const where: string[] = [];

    where.push(`ts >= $${idx++} AND ts < $${idx++}`);
    params.push(start.toUTC().toISO(), end.toUTC().toISO());

    if (esiid) {
      where.push(`esiid = $${idx++}`);
      params.push(esiid);
    }
    if (meter) {
      where.push(`meter = $${idx++}`);
      params.push(meter);
    }

    const sql = `
      SELECT
        to_char((ts AT TIME ZONE 'America/Chicago')::date, 'YYYY-MM-DD') AS day_local,
        esiid,
        meter,
        COUNT(*)::int AS found
      FROM ${SMT_TABLE}
      WHERE ${where.join(' AND ')}
      GROUP BY day_local, esiid, meter
      ORDER BY day_local, esiid, meter
    `;

    const rows = await prisma.$queryRawUnsafe<any[]>(sql, ...params);

    const days: string[] = [];
    for (let d = start.startOf('day'); d < end; d = d.plus({ days: 1 })) {
      days.push(d.toFormat('yyyy-LL-dd'));
    }

    const byKey = new Map<string, any>();
    for (const r of rows) {
      byKey.set(`${r.day_local}||${r.esiid || ''}||${r.meter || ''}`, r);
    }

    const pairs = new Set<string>();
    for (const r of rows) {
      pairs.add(`${r.esiid || ''}||${r.meter || ''}`);
    }

    if (pairs.size === 0) {
      return NextResponse.json({
        ok: true,
        rows: [],
        meta: {
          filters: { esiid: esiid || null, meter: meter || null },
          range: { start: start.toISO(), end: end.toISO(), zone },
          table: SMT_TABLE,
        },
      });
    }

    const pairList = Array.from(pairs);
    const out: any[] = [];
    for (const pair of pairList) {
      const [pairEsiid, pairMeter] = pair.split('||');
      if (!pairEsiid && esiid) continue;
      if (!pairMeter && meter) continue;

      for (const day of days) {
        const rec = byKey.get(`${day}||${pairEsiid || ''}||${pairMeter || ''}`);
        const found = rec?.found ?? 0;
        const expected = expectedIntervalsForDateISO(day);
        const completeness = expected > 0 ? +(found / expected).toFixed(4) : 0;
        out.push({ date: day, esiid: pairEsiid || null, meter: pairMeter || null, found, expected, completeness });
      }
    }

    return NextResponse.json({
      ok: true,
      rows: out,
      meta: {
        filters: { esiid: esiid || null, meter: meter || null },
        range: { start: start.toISO(), end: end.toISO(), zone },
        table: SMT_TABLE,
      },
    });
  } catch (err: any) {
    return jsonError(err?.message || 'daily-summary failed', 500);
  } finally {
    await prisma.$disconnect();
  }
}
