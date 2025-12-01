import { NextRequest, NextResponse } from 'next/server';

import { terminateSmtAgreement } from '@/lib/smt/agreements';

// TODO: integrate user-session auth to ensure the caller owns the agreement.

export async function POST(req: NextRequest) {
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
    console.error('[SMT] /api/smt/agreements/terminate-self error', error);
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


