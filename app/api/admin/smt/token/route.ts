import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin';
import { getSmtTokenMeta } from '@/lib/smt/token';

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const gate = requireAdmin(req);
  if (!gate.ok) {
    return NextResponse.json(gate.body, { status: gate.status });
  }

  try {
    const meta = await getSmtTokenMeta();
    const preview = meta.token ? `${meta.token.slice(0, 16)}…` : null;

    return NextResponse.json({
      ok: true,
      tokenPreview: preview,
      expiresAt: meta.expiresAtIso,
      expiresInSec: meta.remainingSec,
      rawExpiresInSec: meta.rawExpiresInSec,
      tokenType: meta.tokenType ?? null,
      fromCache: meta.fromCache,
    });
  } catch (err: any) {
    return bad(err?.message || 'Failed to obtain SMT token', 500);
  }
}

