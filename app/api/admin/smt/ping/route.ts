import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

/**
 * GET /api/admin/smt/ping
 *
 * Admin-gated ping endpoint for SMT module.
 * Requires x-admin-token header.
 * Returns "ok" or JSON status.
 */
export async function GET(req: NextRequest) {
  const adminToken = process.env.ADMIN_TOKEN;

  if (!adminToken) {
    return NextResponse.json(
      { ok: false, error: 'ADMIN_TOKEN_NOT_CONFIGURED' },
      { status: 503 }
    );
  }

  const hdr = req.headers.get('x-admin-token');
  if (!hdr || hdr !== adminToken) {
    return NextResponse.json(
      { ok: false, error: 'UNAUTHORIZED' },
      { status: 401 }
    );
  }

  return NextResponse.json({ ok: true, service: 'smt', timestamp: new Date().toISOString() });
}

