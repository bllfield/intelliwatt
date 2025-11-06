import { NextRequest, NextResponse } from 'next/server';

export function requireSharedSecret(req: NextRequest) {
  const shared = process.env.SHARED_INGEST_SECRET || '';
  if (!shared) {
    return NextResponse.json({ ok: false, error: 'SERVER_MISCONFIG_NO_SHARED_INGEST_SECRET' }, { status: 500 });
  }
  const provided = req.headers.get('x-shared-secret') || '';
  if (provided !== shared) {
    return NextResponse.json({ ok: false, error: 'UNAUTHORIZED_SHARED' }, { status: 401 });
  }
  return null;
}
