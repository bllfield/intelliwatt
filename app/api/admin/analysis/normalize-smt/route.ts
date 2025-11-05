// app/api/admin/analysis/normalize-smt/route.ts
export const runtime = 'nodejs';

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin';
import { normalizeSmtTo15Min, fillMissing15Min } from '@/lib/analysis/normalizeSmt';
import { TZ_BUILD_ID } from '@/lib/time/tz';

export async function POST(req: NextRequest) {
  const gate = requireAdmin(req);
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'BAD_JSON', tzBuild: TZ_BUILD_ID }, { status: 400 });
  }

  const rows = body?.rows;
  if (!Array.isArray(rows)) {
    return NextResponse.json(
      { ok: false, error: 'VALIDATION', details: 'Body must be { rows: Array }', tzBuild: TZ_BUILD_ID },
      { status: 400 }
    );
  }

  const tz = typeof body?.tz === 'string' ? body.tz : 'America/Chicago';
  const strictTz = body?.strictTz !== false;
  const ambiguous = body?.ambiguous === 'later' ? 'later' : 'earlier';

  const doFill = body?.fill === true;
  const start = typeof body?.start === 'string' ? body.start : undefined;
  const end   = typeof body?.end === 'string' ? body.end   : undefined;

  const points = normalizeSmtTo15Min(rows, { tz, strictTz, ambiguous });
  const finalPoints = doFill ? fillMissing15Min(points, { start, end }) : points;

  return NextResponse.json({
    ok: true,
    count: finalPoints.length,
    filled: doFill,
    tz,
    ambiguous,
    tzBuild: TZ_BUILD_ID,
    points: finalPoints,
  });
}
