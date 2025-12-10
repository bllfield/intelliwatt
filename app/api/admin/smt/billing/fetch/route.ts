import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin';
import { prisma } from '@/lib/db';
import { getSmtAccessToken } from '@/lib/smt/token';
import { resolveSmtEsiid } from '@/lib/smt/esiid';
import crypto from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function defaultDateRange(): { start: string; end: string } {
  const today = new Date();
  const end = today;
  const start = new Date(today);
  // Pull a full 365-day window ending today to ensure 12 months of intervals.
  start.setDate(start.getDate() - 365);

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

  const esiid = await resolveSmtEsiid({
    prismaClient: prisma,
    explicitEsiid: typeof raw.esiid === 'string' ? raw.esiid : null,
    houseId: typeof raw.houseId === 'string' ? raw.houseId : null,
  });
  if (!esiid) {
    return NextResponse.json({ ok: false, error: "Field 'esiid' is required and must be resolvable." }, { status: 400 });
  }

  const includeInterval = raw.includeInterval === undefined ? true : Boolean(raw.includeInterval);
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
  if (dataTypes.length === 0) dataTypes.push('INTERVAL');

  const requestorId =
    process.env.SMT_REQUESTOR_ID?.trim() ??
    process.env.SMT_USERNAME?.trim() ??
    '';
  if (!requestorId) {
    return NextResponse.json(
      { ok: false, error: 'Missing SMT_REQUESTOR_ID/SMT_USERNAME configuration.' },
      { status: 500 },
    );
  }
  const requestorType = process.env.SMT_REQUESTOR_TYPE ?? 'CSP';
  const requestorAuthId = process.env.SMT_REQUESTOR_AUTH_ID;

  if (!requestorAuthId) {
    return NextResponse.json(
      { ok: false, error: 'Missing SMT_REQUESTOR_AUTH_ID environment variable.' },
      { status: 500 },
    );
  }

  const smtBaseUrl = process.env.SMT_API_BASE_URL ?? 'https://services.smartmetertexas.net';
  const smtUrl = `${smtBaseUrl.replace(/\/+$/, '')}/v2/energydata/`;

  const transId = `TX${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`.slice(0, 32);

  const payload = {
    trans_id: transId,
    requestorID: requestorId,
    requestorType,
    requesterAuthenticationID: requestorAuthId,
    // Guide-aligned fields
    startDate: startIso,
    endDate: endIso,
    deliveryMode: 'API',
    reportFormat: 'JSON',
    // A = All, L = Latest. Use A so SMT does not silently reduce the dataset.
    version: 'A',
    readingType: includeInterval ? 'A' : 'C', // A = consumption+gen, C = consumption
    ESIIDList: [esiid],
    SMTTermsandConditions: 'Y',
    // Keep existing options for compatibility with prior schema
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


