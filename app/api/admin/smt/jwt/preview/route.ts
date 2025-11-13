import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin';
import { getSmtAccessTokenWithMeta } from '@/lib/smt/jwt';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/smt/jwt/preview
 *
 * Admin-only SMT JWT preview endpoint.
 * Uses the shared SMT JWT helper and reports whether
 * the token came from cache or a fresh fetch.
 *
 * This is for ops/debug only and must never be exposed
 * in customer-facing flows.
 */
export async function GET(req: NextRequest) {
  const gate = requireAdmin(req);
  if (!gate.ok) {
    return NextResponse.json(gate.body, { status: gate.status });
  }

  try {
    const meta = await getSmtAccessTokenWithMeta();
    return NextResponse.json(
      {
        ok: true,
        fromCache: meta.fromCache,
        expiresAt: meta.expiresAt,
        expiresAtIso: meta.expiresAtIso,
        remainingSec: meta.remainingSec,
        rawExpiresInSec: meta.rawExpiresInSec,
        tokenType: meta.tokenType ?? null,
        token: meta.token,
      },
      { status: 200 },
    );
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        error: err?.message ?? String(err),
      },
      { status: 500 },
    );
  }
}

