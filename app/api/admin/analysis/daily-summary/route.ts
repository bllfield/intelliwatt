// app/api/admin/analysis/daily-summary/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getDailySummary } from '@/lib/analysis/dailySummary';
import { requireAdmin } from '@/lib/auth/admin';
import { getCorrelationId } from '@/lib/correlation';
import { DateTime } from 'luxon';

function defaults(range?: { start?: string; end?: string }) {
  const tz = 'America/Chicago';
  const now = DateTime.now().setZone(tz);
  
  // If end is provided, parse it; otherwise use today
  const endDate = range?.end 
    ? DateTime.fromISO(range.end, { zone: tz })
    : now;
  
  // If start is provided, parse it; otherwise use 7 days before end
  const startDate = range?.start
    ? DateTime.fromISO(range.start, { zone: tz })
    : endDate.minus({ days: 7 });
  
  // Return as YYYY-MM-DD strings in local timezone
  return {
    startIso: startDate.toISODate() || '',
    endIso: endDate.toISODate() || '',
  };
}

async function handle(req: NextRequest) {
  const corrId = getCorrelationId(req.headers);
  const t0 = Date.now();

  const gate = requireAdmin(req);
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  try {
    let esiid: string | undefined;
    let meter: string | undefined;
    let dateStart: string | undefined;
    let dateEnd: string | undefined;

    if (req.method === 'GET') {
      const sp = new URL(req.url).searchParams;
      esiid = sp.get('esiid') ?? undefined;
      meter = sp.get('meter') ?? undefined;
      dateStart = sp.get('dateStart') ?? undefined;
      dateEnd = sp.get('dateEnd') ?? undefined;
    } else {
      const body = await req.json().catch(() => ({}));
      esiid = body.esiid ?? undefined;
      meter = body.meter ?? undefined;
      dateStart = body.dateStart ?? undefined;
      dateEnd = body.dateEnd ?? undefined;
    }

    const { startIso, endIso } = defaults({ start: dateStart, end: dateEnd });

    const rows = await getDailySummary({
      esiid,
      meter,
      dateStart: startIso,
      dateEnd: endIso,
    });

    const durationMs = Date.now() - t0;
    console.log(
      JSON.stringify({
        corrId,
        route: 'admin/analysis/daily-summary',
        method: req.method,
        status: 200,
        durationMs,
        count: rows.length,
      })
    );
    return NextResponse.json({ ok: true, corrId, rows }, { status: 200 });
  } catch (err: any) {
    const durationMs = Date.now() - t0;
    console.error(
      JSON.stringify({
        corrId,
        route: 'admin/analysis/daily-summary',
        method: req.method,
        status: 500,
        durationMs,
        errorClass: 'BUSINESS_LOGIC',
        message: err?.message,
      })
    );
    return NextResponse.json({ ok: false, corrId, error: 'DAILY_SUMMARY_FAILED' }, { status: 500 });
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handle;
export const POST = handle;
