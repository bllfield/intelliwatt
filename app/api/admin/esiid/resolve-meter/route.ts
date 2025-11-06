// app/api/admin/esiid/resolve-meter/route.ts
// ESIID -> most recent meterId(s) from normalized intervals.

import { NextRequest, NextResponse } from 'next/server';
import { getCorrelationId } from '@/lib/correlation';
import { requireAdmin } from '@/lib/auth/admin';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const corrId = getCorrelationId(req.headers);
  const t0 = Date.now();

  const gate = requireAdmin(req);
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  try {
    const body = await req.json();
    const { esiid } = body || {};

    if (!esiid) {
      return NextResponse.json({ ok: false, corrId, error: 'MISSING_ESIID' }, { status: 400 });
    }

    // Get distinct meters for that ESIID, ordered by most recent activity
    const rows = await prisma.$queryRawUnsafe<{ meter: string }[]>(
      `
      SELECT DISTINCT meter
      FROM "SmtInterval"
      WHERE esiid = $1
      ORDER BY meter
    `,
      esiid
    );

    const meterIds = rows.map((r) => r.meter).filter(Boolean);
    const meterId = meterIds[0] ?? null;

    const durationMs = Date.now() - t0;
    console.log(
      JSON.stringify({
        corrId,
        route: 'admin/esiid/resolve-meter',
        status: 200,
        durationMs,
        metersFound: meterIds.length,
      })
    );
    return NextResponse.json({ ok: true, corrId, esiid, meterId, meterIds }, { status: 200 });
  } catch (err: any) {
    const durationMs = Date.now() - t0;
    console.error(
      JSON.stringify({
        corrId,
        route: 'admin/esiid/resolve-meter',
        status: 500,
        durationMs,
        errorClass: 'BUSINESS_LOGIC',
        message: err?.message,
      })
    );
    return NextResponse.json({ ok: false, corrId, error: 'ESIID_METER_RESOLVE_FAILED' }, { status: 500 });
  }
}

