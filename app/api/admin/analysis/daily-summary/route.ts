import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { DateTime } from "luxon";
import { expectedIntervalsForDateISO } from "@/lib/analysis/dst";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function requireAdmin(req: NextRequest) {
  const token = req.headers.get("x-admin-token") || "";
  const expected = process.env.ADMIN_TOKEN || "";
  if (!expected || token !== expected) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return null;
}

function normalizeDateRange(params: { dateStart?: string | null; dateEnd?: string | null }) {
  const zone = "America/Chicago";
  const todayLocal = DateTime.now().setZone(zone).startOf("day");
  // last 7 *full* days ending today; but our query end is tomorrow 00:00 to include "today"
  const defaultStart = todayLocal.minus({ days: 7 });
  const defaultEnd = todayLocal.plus({ days: 1 });

  const start = params.dateStart ? DateTime.fromISO(params.dateStart, { zone }) : defaultStart;
  const end = params.dateEnd ? DateTime.fromISO(params.dateEnd, { zone }) : defaultEnd;
  return { start, end, zone };
}

export async function GET(req: NextRequest) {
  const guard = requireAdmin(req);
  if (guard) return guard;

  const url = new URL(req.url);
  const esiid = url.searchParams.get("esiid") || undefined;
  const meter = url.searchParams.get("meter") || undefined;
  const dateStart = url.searchParams.get("dateStart");
  const dateEnd = url.searchParams.get("dateEnd");

  const { start, end, zone } = normalizeDateRange({ dateStart, dateEnd });
  if (!start.isValid || !end.isValid || end <= start) {
    return jsonError("Invalid dateStart/dateEnd");
  }

  const rawTable = process.env.SMT_INTERVAL_TABLE || "SmtInterval";
  const SMT_TABLE = `"${rawTable.replace(/"/g, '""')}"`;
  const prisma = new PrismaClient();

  try {
    // Build WHERE and params for a safe raw query
    const params: any[] = [];
    let idx = 1;
    const where: string[] = [];
    where.push(`ts >= $${idx++}::timestamptz AND ts < $${idx++}::timestamptz`);
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
      WHERE ${where.join(" AND ")}
      GROUP BY day_local, esiid, meter
      ORDER BY day_local, esiid, meter
    `;

    const rows = await prisma.$queryRawUnsafe<any[]>(sql, ...params);

    // Build the full day list (inclusive of start..end-1 day)
    const days: string[] = [];
    for (let d = start.startOf("day"); d < end; d = d.plus({ days: 1 })) {
      days.push(d.toFormat("yyyy-LL-dd"));
    }

    // Index returned rows for quick lookup
    const byKey = new Map<string, any>();
    for (const r of rows) {
      byKey.set(`${r.day_local}||${r.esiid || ""}||${r.meter || ""}`, r);
    }

    // Collect all observed (esiid,meter) pairs from the query
    const pairSet = new Set<string>();
    for (const r of rows) {
      pairSet.add(`${r.esiid || ""}||${r.meter || ""}`);
    }

    // If nothing found, return an empty set with meta
    if (pairSet.size === 0) {
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

    // Avoid downlevel iteration issues by expanding to an array
    const pairs = Array.from(pairSet);
    const out: Array<{
      date: string;
      esiid: string | null;
      meter: string | null;
      found: number;
      expected: number;
      completeness: number;
    }> = [];

    for (const pair of pairs) {
      const [pairEsiid, pairMeter] = pair.split("||");
      // Respect explicit filters if provided
      if (esiid && pairEsiid !== esiid) continue;
      if (meter && pairMeter !== meter) continue;

      for (const day of days) {
        const rec = byKey.get(`${day}||${pairEsiid || ""}||${pairMeter || ""}`);
        const found = rec?.found ?? 0;
        const expected = expectedIntervalsForDateISO(day);
        const completeness = expected > 0 ? +(found / expected).toFixed(4) : 0;
        out.push({
          date: day,
          esiid: pairEsiid || null,
          meter: pairMeter || null,
          found,
          expected,
          completeness,
        });
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
  } catch (e: any) {
    return jsonError(e?.message || "daily-summary failed", 500);
  } finally {
    await prisma.$disconnect();
  }
}
