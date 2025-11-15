export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/admin';

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

export async function GET(req: NextRequest) {
  const gate = requireAdmin(req);
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  const { searchParams } = new URL(req.url);

  const esiid = (searchParams.get('esiid') ?? '').trim() || undefined;
  const meter = (searchParams.get('meter') ?? '').trim() || undefined;

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

  const limitParam = Number(searchParams.get('limit') ?? '');
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(Math.floor(limitParam), 1), 500) : 50;

  const where: Prisma.SmtIntervalWhereInput = {};
  if (esiid) where.esiid = esiid;
  if (meter) where.meter = meter;

  if (dateStart || dateEnd) {
    where.ts = {};
    if (dateStart) where.ts.gte = dateStart;
    if (dateEnd) where.ts.lte = dateEnd;
  }

  const rows = await prisma.smtInterval.findMany({
    where,
    orderBy: { ts: 'asc' },
    take: limit,
  });

  const data = rows.map((row) => ({
    id: row.id,
    esiid: row.esiid,
    meter: row.meter,
    ts: row.ts.toISOString(),
    kwh: Number(row.kwh),
    filled: row.filled,
    source: row.source ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));

  return NextResponse.json({
    ok: true,
    rows: data,
    meta: {
      filters: {
        esiid: esiid ?? null,
        meter: meter ?? null,
        dateStart: dateStart ? dateStart.toISOString() : null,
        dateEnd: dateEnd ? dateEnd.toISOString() : null,
      },
      limit,
      returned: data.length,
    },
  });
}

