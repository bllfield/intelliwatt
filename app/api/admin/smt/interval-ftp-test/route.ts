import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin';
import { getRollingBackfillRange, requestSmtBackfillForAuthorization } from '@/lib/smt/agreements';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function formatDateMDY(date: Date): string {
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  const y = String(date.getUTCFullYear());
  return `${m}/${d}/${y}`;
}

export async function POST(req: NextRequest) {
  const gate = requireAdmin(req);
  if (!gate.ok) {
    return NextResponse.json(gate.body, { status: gate.status });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, any>;
  const esiid = typeof body.esiid === 'string' && body.esiid.trim() ? body.esiid.trim() : null;

  if (!esiid) {
    return NextResponse.json(
      { ok: false, error: 'ESIID_REQUIRED', message: 'Provide esiid in JSON body.' },
      { status: 400 },
    );
  }

  const { startDate, endDate } = getRollingBackfillRange(12);
  const startMDY = formatDateMDY(startDate);
  const endMDY = formatDateMDY(endDate);

  const backfillReq = {
    authorizationId: body.authorizationId || 'admin-interval-ftp-test',
    esiid,
    meterNumber: typeof body.meterNumber === 'string' ? body.meterNumber : null,
    startDate,
    endDate,
  };

  const backfillResult = await requestSmtBackfillForAuthorization(backfillReq);

  // This mirrors the SMT 15-Min Interval Data request body that the droplet
  // builds for /v2/15minintervalreads/ (FTP CSV delivery). trans_id is generated
  // on the droplet side, so we just document the structure here.
  const intervalPayload = {
    trans_id: '<generated-on-droplet>',
    requestorID:
      process.env.SMT_REQUESTOR_ID?.trim() ||
      process.env.SMT_USERNAME?.trim() ||
      'INTELLIPATH',
    requesterType: 'CSP',
    requesterAuthenticationID: process.env.SMT_REQUESTOR_AUTH_ID?.trim() || 'DUNS_NOT_SET',
    startDate: startMDY,
    endDate: endMDY,
    deliveryMode: 'FTP',
    reportFormat: 'CSV',
    version: 'L',
    readingType: 'C',
    esiid,
    SMTTermsandConditions: 'Y',
  };

  return NextResponse.json({
    ok: backfillResult.ok,
    message: backfillResult.message,
    esiid,
    startDateIso: startDate.toISOString(),
    endDateIso: endDate.toISOString(),
    startDate: startMDY,
    endDate: endMDY,
    intervalPayload,
  });
}


