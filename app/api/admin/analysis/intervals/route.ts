// app/api/admin/analysis/intervals/route.ts
export const runtime = 'nodejs';

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin';
import { prisma } from '@/lib/db';
import { DateTime } from 'luxon';
import { TZ_BUILD_ID } from '@/lib/time/tz';

function expectedSlotsForLocalDay(dateStr: string, zone: string): number {
  const start = DateTime.fromISO(dateStr, { zone }).startOf('day');
  const end = start.plus({ days: 1 });

  const minutes = end.diff(start, 'minutes').minutes;

  return Math.round(minutes / 15); // 96 normal, 92 spring-forward, 100 fall-back
}

export async function GET(req: NextRequest) {
  const gate = requireAdmin(req);
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  const url = new URL(req.url);
  const esiid = url.searchParams.get('esiid') ?? '';
  const meter = url.searchParams.get('meter') ?? '';
  const date = url.searchParams.get('date'); // YYYY-MM-DD (local day in tz)
  const tz = url.searchParams.get('tz') || 'America/Chicago';
  const limit = Math.min(Number(url.searchParams.get('limit') || 5000), 50000);

  if (!esiid || !meter) {
    return NextResponse.json(
      { ok: false, error: 'MISSING_KEYS', details: 'esiid and meter are required', tzBuild: TZ_BUILD_ID },
      { status: 400 }
    );
  }

  if (!date) {
    return NextResponse.json(
      { ok: false, error: 'MISSING_DATE', details: 'date (YYYY-MM-DD) is required', tzBuild: TZ_BUILD_ID },
      { status: 400 }
    );
  }

  // Compute UTC window for the requested local day
  const dayStartLocal = DateTime.fromISO(date, { zone: tz }).startOf('day');
  if (!dayStartLocal.isValid) {
    return NextResponse.json(
      { ok: false, error: 'BAD_DATE', details: 'Invalid date or tz', tzBuild: TZ_BUILD_ID },
      { status: 400 }
    );
  }
  const dayEndLocal = dayStartLocal.plus({ days: 1 });

  const fromUTC = dayStartLocal.toUTC().toJSDate();
  const toUTC = dayEndLocal.toUTC().toJSDate();

  const rows = await prisma.smtInterval.findMany({
    where: {
      esiid,
      meter,
      ts: { gte: fromUTC, lt: toUTC },
    },
    orderBy: { ts: 'asc' },
    take: limit,
  });

  // Summaries
  const expected = expectedSlotsForLocalDay(date, tz);
  const actual = rows.length;
  const missing = Math.max(0, expected - actual);
  const kwhTotal = rows.reduce((sum: number, r: { kwh: unknown }) => sum + Number(r.kwh), 0);
  const filledCount = rows.reduce((sum: number, r: { filled: boolean }) => sum + (r.filled ? 1 : 0), 0);

  return NextResponse.json({
    ok: true,
    tzBuild: TZ_BUILD_ID,
    esiid,
    meter,
    tz,
    date,
    expected,
    actual,
    missing,
    kwhTotal,
    filledCount,
    points: rows.map((r: { ts: Date; kwh: unknown; filled: boolean; source: string | null }) => ({
      ts: r.ts.toISOString(), // UTC start
      kwh: Number(r.kwh),
      filled: r.filled,
      source: r.source ?? undefined,
    })),
  });
}

