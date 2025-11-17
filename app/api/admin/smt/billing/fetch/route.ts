import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin';
import { getSmtAccessToken } from '@/lib/smt/jwt';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function defaultDateRange(): { start: string; end: string } {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const prevMonth = month === 0 ? 11 : month - 1;
  const prevYear = month === 0 ? year - 1 : year;

  const start = new Date(prevYear, prevMonth, 1);
  const end = new Date(prevYear, prevMonth + 1, 0);

  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);

  return {
    start: `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`,
    end: `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}`,
  };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = requireAdmin(req);
  if (!gate.ok) {
    return NextResponse.json(gate.body, { status: gate.status });
  }

  let raw: any;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!raw || typeof raw !== 'object') {
    return NextResponse.json({ ok: false, error: 'Body must be a JSON object' }, { status: 400 });
  }

  const esiid = typeof raw.esiid === 'string' ? raw.esiid.trim() : '';
  if (!esiid) {
    return NextResponse.json({ ok: false, error: "Field 'esiid' is required and must be a non-empty string." }, { status: 400 });
  }

  const includeInterval = Boolean(raw.includeInterval);
  const includeDaily = Boolean(raw.includeDaily);
  const includeMonthly = raw.includeMonthly === undefined ? true : Boolean(raw.includeMonthly);

  const range = defaultDateRange();
  const startIso =
    typeof raw.startDate === 'string' && raw.startDate.trim().length > 0
      ? raw.startDate.trim()
      : range.start;
  const endIso =
    typeof raw.endDate === 'string' && raw.endDate.trim().length > 0
      ? raw.endDate.trim()
      : range.end;

  const dataTypes: string[] = [];
  if (includeInterval) dataTypes.push('INTERVAL');
  if (includeDaily) dataTypes.push('DAILY');
  if (includeMonthly) dataTypes.push('MONTHLY');
  if (dataTypes.length === 0) dataTypes.push('MONTHLY');

  const requestorId =
    process.env.SMT_REQUESTOR_ID ??
    process.env.SMT_CSP_ID ??
    process.env.SMT_REQUESTOR ??
    'INTELLIPATH';
  const requestorType = process.env.SMT_REQUESTOR_TYPE ?? 'CSP';

  const smtBaseUrl = process.env.SMT_API_BASE_URL ?? 'https://services.smartmetertexas.net';
  const smtUrl = `${smtBaseUrl.replace(/\/+$/, '')}/v2/energydata/`;

  const payload = {
    requestorID: requestorId,
    requestorType,
    filter: {
      esiidList: [esiid],
      startDate: startIso,
      endDate: endIso,
    },
    options: {
      dataTypes,
    },
  };

  try {
    const token = await getSmtAccessToken();

    const smtRes = await fetch(smtUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const text = await smtRes.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      // keep raw text if JSON parse fails
    }

    if (!smtRes.ok) {
      return NextResponse.json(
        {
          ok: false,
          status: smtRes.status,
          statusText: smtRes.statusText,
          payload,
          smtJson: json,
          smtText: json ? undefined : text,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      esiid,
      startDate: startIso,
      endDate: endIso,
      includeInterval,
      includeDaily,
      includeMonthly,
      smtUrl,
      payloadUsed: payload,
      smtJson: json,
      smtText: json ? undefined : text,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        error: err?.message ?? 'Unexpected error while calling SMT /v2/energydata',
      },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = requireAdmin(req);
  if (!gate.ok) {
    return NextResponse.json(gate.body, { status: gate.status });
  }

  return NextResponse.json({
    ok: true,
    message: 'Use POST with JSON { esiid, startDate, endDate, include* } to fetch SMT billing reads.',
  });
}


