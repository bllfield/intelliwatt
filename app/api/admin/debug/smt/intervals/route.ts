export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/admin';
import { resolveAdminHouseSelection } from '@/lib/admin/adminHouseLookup';

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

  const selectedHouse = await resolveAdminHouseSelection({
    esiid: searchParams.get('esiid'),
    houseId: searchParams.get('houseId'),
    email: searchParams.get('email'),
  });
  const requestedHouseId = (searchParams.get('houseId') ?? '').trim() || null;
  const requestedEsiid = (searchParams.get('esiid') ?? '').trim() || null;
  const requestedEmail = (searchParams.get('email') ?? '').trim() || null;
  if ((requestedHouseId || requestedEmail) && !selectedHouse) {
    return NextResponse.json(
      { ok: false, error: 'HOUSE_NOT_FOUND', details: 'No active house found for the provided email/houseId.' },
      { status: 404 },
    );
  }
  const esiid = selectedHouse?.esiid ?? requestedEsiid ?? undefined;
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
    resolvedHouse: selectedHouse
      ? {
          id: selectedHouse.id,
          esiid: selectedHouse.esiid,
          label: selectedHouse.label,
        }
      : null,
    meta: {
      filters: {
        esiid: esiid ?? null,
        houseId: selectedHouse?.id ?? requestedHouseId,
        meter: meter ?? null,
        dateStart: dateStart ? dateStart.toISOString() : null,
        dateEnd: dateEnd ? dateEnd.toISOString() : null,
      },
      limit,
      returned: data.length,
    },
  });
}

export async function POST(req: NextRequest) {
  const gate = requireAdmin(req);
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'INVALID_JSON', details: 'Request body must be valid JSON.' },
      { status: 400 },
    );
  }

  const esiidRaw = body?.esiid;
  const meterRaw = body?.meter;
  const dateStartRaw = body?.dateStart ?? null;
  const dateEndRaw = body?.dateEnd ?? null;
  const selectedHouse = await resolveAdminHouseSelection({
    esiid: typeof esiidRaw === 'string' ? esiidRaw : null,
    houseId: typeof body?.houseId === 'string' ? body.houseId : null,
    email: typeof body?.email === 'string' ? body.email : null,
  });
  if ((typeof body?.houseId === 'string' || typeof body?.email === 'string') && !selectedHouse) {
    return NextResponse.json(
      { ok: false, error: 'HOUSE_NOT_FOUND', details: 'No active house found for the provided email/houseId.' },
      { status: 404 },
    );
  }

  const resolvedEsiid = selectedHouse?.esiid ?? (typeof esiidRaw === 'string' ? esiidRaw.trim() : '');

  if (!resolvedEsiid) {
    return NextResponse.json(
      { ok: false, error: 'INVALID_ESIID', details: 'Provide esiid, houseId, or email for a resolvable ESIID.' },
      { status: 400 },
    );
  }

  if (meterRaw != null && (typeof meterRaw !== 'string' || !meterRaw.trim())) {
    return NextResponse.json(
      { ok: false, error: 'INVALID_METER', details: 'meter must be a non-empty string if provided.' },
      { status: 400 },
    );
  }

  const dateStart = parseDate(dateStartRaw);
  if (dateStartRaw && !dateStart) {
    return NextResponse.json(
      { ok: false, error: 'INVALID_DATE_START', details: 'dateStart must be a valid ISO timestamp.' },
      { status: 400 },
    );
  }

  const dateEnd = parseDate(dateEndRaw);
  if (dateEndRaw && !dateEnd) {
    return NextResponse.json(
      { ok: false, error: 'INVALID_DATE_END', details: 'dateEnd must be a valid ISO timestamp.' },
      { status: 400 },
    );
  }

  const where: Prisma.SmtIntervalWhereInput = {
    esiid: resolvedEsiid,
  };

  if (meterRaw && meterRaw.trim()) {
    where.meter = meterRaw.trim();
  }

  if (dateStart || dateEnd) {
    where.ts = {};
    if (dateStart) where.ts.gte = dateStart;
    if (dateEnd) where.ts.lt = dateEnd;
  }

  try {
    const result = await prisma.smtInterval.deleteMany({ where });

    return NextResponse.json({
      ok: true,
      deletedCount: result.count,
      filters: {
        esiid: resolvedEsiid,
        houseId: selectedHouse?.id ?? (typeof body?.houseId === 'string' ? body.houseId.trim() : null),
        meter: meterRaw ? meterRaw.trim() : null,
        dateStart: dateStart ? dateStart.toISOString() : null,
        dateEnd: dateEnd ? dateEnd.toISOString() : null,
      },
    });
  } catch (err) {
    console.error('[debug/smt/intervals:delete] failed', err);
    return NextResponse.json(
      { ok: false, error: 'INTERNAL_ERROR', details: 'Failed to delete intervals.' },
      { status: 500 },
    );
  }
}

