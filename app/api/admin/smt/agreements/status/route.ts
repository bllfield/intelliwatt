import { NextRequest, NextResponse } from 'next/server';

import { getSmtAgreementStatus } from '@/lib/smt/agreements';

export const dynamic = 'force-dynamic';

function requireAdminToken(req: NextRequest): boolean {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) {
    console.warn('[ADMIN SMT] Missing ADMIN_TOKEN env');
    return false;
  }

  const provided = req.headers.get('x-admin-token');
  return typeof provided === 'string' && provided === expected;
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

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    payload = {};
  }

  let esiidValue: unknown = null;
  if (payload && typeof payload === 'object') {
    const data = payload as Record<string, unknown>;
    esiidValue = data.esiid ?? data.ESIID;
  }

  if (typeof esiidValue !== 'string' || !esiidValue.trim()) {
    return NextResponse.json(
      {
        ok: false,
        error: 'InvalidRequest',
        message: 'esiid is required',
      },
      { status: 400 },
    );
  }

  const esiid = esiidValue.trim();

  try {
    const status = await getSmtAgreementStatus(esiid);
    return NextResponse.json(
      {
        ok: true,
        esiid,
        status,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error('[ADMIN SMT] agreements/status failed', error);
    return NextResponse.json(
      {
        ok: false,
        error: 'InternalError',
        message: 'Failed to retrieve SMT agreement status',
      },
      { status: 500 },
    );
  }
}

