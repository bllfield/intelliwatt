import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/ping
 * Public ping endpoint - no authentication required
 * Returns: { ok: true, service: "intelliwatt", ts: "...", path: "/api/ping" }
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    service: 'intelliwatt',
    ts: new Date().toISOString(),
    path: '/api/ping',
  });
}

