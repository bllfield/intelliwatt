import { NextRequest, NextResponse } from 'next/server';

import { getSmtReportStatus } from '@/lib/smt/agreements';

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

  const correlationId =
    typeof body.correlationId === 'string' ? body.correlationId.trim() : '';
  const serviceType =
    typeof body.serviceType === 'string' && body.serviceType.length > 0
      ? body.serviceType
      : undefined;

  if (!correlationId) {
    return NextResponse.json(
      {
        ok: false,
        error: 'InvalidRequest',
        message: 'correlationId is required',
      },
      { status: 400 },
    );
  }

  try {
    const reportStatus = await getSmtReportStatus(correlationId, serviceType);
    return NextResponse.json(
      {
        ok: true,
        correlationId,
        serviceType: serviceType ?? null,
        reportStatus,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error('[ADMIN SMT] /report-status error', error);
    return NextResponse.json(
      {
        ok: false,
        error: 'InternalError',
        message: 'Failed to fetch SMT report status',
      },
      { status: 500 },
    );
  }
}

