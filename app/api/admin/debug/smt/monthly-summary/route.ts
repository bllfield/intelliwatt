export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/admin';

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

export async function GET(req: NextRequest) {
  const gate = requireAdmin(req);
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  const { searchParams } = new URL(req.url);
  const esiid = (searchParams.get('esiid') ?? '').trim();
  if (!esiid) {
    return NextResponse.json({ ok: false, error: 'missing_esiid' }, { status: 400 });
  }

  const dateStartRaw = searchParams.get('dateStart');
  const dateEndRaw = searchParams.get('dateEnd');
  const dateStart = parseDate(dateStartRaw);
  const dateEnd = parseDate(dateEndRaw);

  if (dateStartRaw && !dateStart) {
    return NextResponse.json(
      { ok: false, error: 'INVALID_DATE_START', details: 'dateStart must be a valid ISO timestamp' },
      { status: 400 },
    );
  }

  if (dateEndRaw && !dateEnd) {
    return NextResponse.json(
      { ok: false, error: 'INVALID_DATE_END', details: 'dateEnd must be a valid ISO timestamp' },
      { status: 400 },
    );
  }

  const where = Prisma.sql`
    WHERE "esiid" = ${esiid}
    ${dateStart ? Prisma.sql` AND "ts" >= ${dateStart}` : Prisma.empty}
    ${dateEnd ? Prisma.sql` AND "ts" < ${dateEnd}` : Prisma.empty}
  `;

  const rows = await prisma.$queryRaw<
    Array<{
      month: string;
      intervals: number;
      minTs: Date | null;
      maxTs: Date | null;
      netKwh: number;
      importKwh: number;
      exportKwh: number;
      negativeIntervals: number;
    }>
  >(Prisma.sql`
    SELECT
      to_char(date_trunc('month', ("ts" AT TIME ZONE 'America/Chicago'))::date, 'YYYY-MM') AS month,
      COUNT(*)::int AS intervals,
      MIN("ts") AS "minTs",
      MAX("ts") AS "maxTs",
      COALESCE(SUM("kwh")::float, 0)::float AS "netKwh",
      COALESCE(SUM(CASE WHEN "kwh" >= 0 THEN "kwh" ELSE 0 END)::float, 0)::float AS "importKwh",
      COALESCE(SUM(CASE WHEN "kwh" < 0 THEN ABS("kwh") ELSE 0 END)::float, 0)::float AS "exportKwh",
      COALESCE(SUM(CASE WHEN "kwh" < 0 THEN 1 ELSE 0 END)::int, 0)::int AS "negativeIntervals"
    FROM "SmtInterval"
    ${where}
    GROUP BY 1
    ORDER BY 1 ASC
  `);

  return NextResponse.json({
    ok: true,
    esiid,
    filters: {
      dateStart: dateStart ? dateStart.toISOString() : null,
      dateEnd: dateEnd ? dateEnd.toISOString() : null,
      tz: 'America/Chicago',
    },
    months: rows.map((r) => ({
      month: String(r.month),
      intervals: Number(r.intervals ?? 0),
      minTs: r.minTs ? new Date(r.minTs).toISOString() : null,
      maxTs: r.maxTs ? new Date(r.maxTs).toISOString() : null,
      netKwh: Number(r.netKwh ?? 0),
      importKwh: Number(r.importKwh ?? 0),
      exportKwh: Number(r.exportKwh ?? 0),
      negativeIntervals: Number(r.negativeIntervals ?? 0),
    })),
  });
}

