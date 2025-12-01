import { NextRequest, NextResponse } from 'next/server';

import {
  getSmtMyAgreements,
  type SmtMyAgreementsFilter,
} from '@/lib/smt/agreements';

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

  const filter: SmtMyAgreementsFilter = {};

  if (
    body?.agreementNumber !== undefined &&
    body.agreementNumber !== null &&
    (typeof body.agreementNumber === 'string' ||
      typeof body.agreementNumber === 'number')
  ) {
    filter.agreementNumber = body.agreementNumber;
  }

  if (typeof body?.statusReason === 'string' && body.statusReason.trim()) {
    filter.statusReason = body.statusReason.trim();
  }

  try {
    const agreements = await getSmtMyAgreements(filter);
    return NextResponse.json(
      {
        ok: true,
        filter,
        agreements,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error('[ADMIN SMT] /agreements/myagreements error', error);
    return NextResponse.json(
      {
        ok: false,
        error: 'InternalError',
        message: 'Failed to fetch SMT agreements',
      },
      { status: 500 },
    );
  }
}

