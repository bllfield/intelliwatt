import { NextRequest, NextResponse } from 'next/server';

import {
  normalizeRawUsageToMaster,
  type UsageSourceFilter,
} from '@/lib/usage/normalize';

function requireAdminToken(req: NextRequest): boolean {
  const token = req.headers.get('x-admin-token');
  const expected = process.env.ADMIN_TOKEN;
  return Boolean(expected && token && token === expected);
}

function parseDate(value: unknown): Date | undefined {
  if (typeof value !== 'string' || !value.trim()) {
    return undefined;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export async function POST(req: NextRequest) {
  if (!requireAdminToken(req)) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Unauthorized',
        message: 'Missing or invalid x-admin-token',
      },
      { status: 401 },
    );
  }

  let payload: any = {};
  try {
    payload = await req.json();
  } catch {
    payload = {};
  }

  const houseId =
    typeof payload.houseId === 'string' && payload.houseId.trim()
      ? payload.houseId.trim()
      : undefined;
  const esiid =
    typeof payload.esiid === 'string' && payload.esiid.trim()
      ? payload.esiid.trim()
      : undefined;

  if (!houseId && !esiid) {
    return NextResponse.json(
      {
        ok: false,
        error: 'InvalidRequest',
        message: 'houseId or esiid is required',
      },
      { status: 400 },
    );
  }

  const source =
    typeof payload.source === 'string' && payload.source.length > 0
      ? (payload.source as UsageSourceFilter['source'])
      : undefined;

  const filter: UsageSourceFilter = {
    houseId,
    esiid,
    source,
    start: parseDate(payload.start),
    end: parseDate(payload.end),
  };

  try {
    const summary = await normalizeRawUsageToMaster(filter);
    return NextResponse.json(
      {
        ok: true,
        filter,
        summary,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error('[ADMIN USAGE] normalize error', error);
    return NextResponse.json(
      {
        ok: false,
        error: 'InternalError',
        message: 'Failed to normalize usage',
      },
      { status: 500 },
    );
  }
}

