import { NextRequest, NextResponse } from 'next/server';

import { terminateSmtAgreement } from '@/lib/smt/agreements';

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

  const agreementNumber = body?.agreementNumber;
  const retailCustomerEmail =
    typeof body?.retailCustomerEmail === 'string'
      ? body.retailCustomerEmail.trim()
      : '';

  const validAgreementNumber =
    typeof agreementNumber === 'number' || typeof agreementNumber === 'string';

  if (!validAgreementNumber) {
    return NextResponse.json(
      {
        ok: false,
        error: 'InvalidRequest',
        message: 'agreementNumber is required',
      },
      { status: 400 },
    );
  }

  if (!retailCustomerEmail) {
    return NextResponse.json(
      {
        ok: false,
        error: 'InvalidRequest',
        message: 'retailCustomerEmail is required',
      },
      { status: 400 },
    );
  }

  try {
    const result = await terminateSmtAgreement(
      agreementNumber,
      retailCustomerEmail,
    );
    return NextResponse.json(
      {
        ok: true,
        agreementNumber,
        retailCustomerEmail,
        result,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error('[ADMIN SMT] /agreements/terminate error', error);
    return NextResponse.json(
      {
        ok: false,
        error: 'InternalError',
        message: 'Failed to terminate SMT agreement',
      },
      { status: 500 },
    );
  }
}

