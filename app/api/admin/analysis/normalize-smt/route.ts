// app/api/admin/analysis/normalize-smt/route.ts
export const runtime = 'nodejs';

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin';
import { normalizeSmtTo15Min } from '@/lib/analysis/normalizeSmt';

export async function POST(req: NextRequest) {
  const gate = requireAdmin(req);
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'BAD_JSON' }, { status: 400 });
  }

  const rows = (body as any)?.rows;
  if (!Array.isArray(rows)) {
    return NextResponse.json(
      { ok: false, error: 'VALIDATION', details: 'Body must be { rows: Array }' },
      { status: 400 }
    );
  }

  const points = normalizeSmtTo15Min(rows);
  return NextResponse.json({ ok: true, count: points.length, points });
}

