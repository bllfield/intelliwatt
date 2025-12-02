import { NextRequest, NextResponse } from 'next/server';

import { getSmtAgreementEsiids } from '@/lib/smt/agreements';

export const dynamic = 'force-dynamic';

function requireAdminToken(req: NextRequest): boolean {
  const token = req.headers.get('x-admin-token');
  const expected = process.env.ADMIN_TOKEN;
  return Boolean(expected && token && token === expected);
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

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const rawAgreementNumber = body?.agreementNumber;
  const isValidType =
    typeof rawAgreementNumber === 'string' ||
    typeof rawAgreementNumber === 'number';

  if (!isValidType) {
    return NextResponse.json(
      {
        ok: false,
        error: 'InvalidRequest',
        message: 'agreementNumber is required',
      },
      { status: 400 },
    );
  }

  try {
    const data = await getSmtAgreementEsiids(rawAgreementNumber);
    return NextResponse.json(
      {
        ok: true,
        agreementNumber: rawAgreementNumber,
        data,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error('[ADMIN SMT] /agreements/esiids error', error);
    return NextResponse.json(
      {
        ok: false,
        error: 'InternalError',
        message: 'Failed to fetch Agreement ESIIDs',
      },
      { status: 500 },
    );
  }
}

