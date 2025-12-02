import { NextRequest, NextResponse } from 'next/server';

import { listSmtSubscriptions } from '@/lib/smt/agreements';

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

  const serviceType =
    typeof body?.serviceType === 'string' && body.serviceType.length > 0
      ? body.serviceType
      : undefined;

  try {
    const subscriptions = await listSmtSubscriptions(serviceType);
    return NextResponse.json(
      {
        ok: true,
        serviceType,
        subscriptions,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error('[ADMIN SMT] /subscriptions/list error', error);
    return NextResponse.json(
      {
        ok: false,
        error: 'InternalError',
        message: 'Failed to fetch SMT subscriptions',
      },
      { status: 500 },
    );
  }
}

