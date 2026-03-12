export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireSharedSecret } from '@/lib/auth/shared';
import { loadSmtRawRows, normalizeAndPersistSmtIntervals, RAW_MODEL_CANDIDATES } from '@/lib/usage/normalizeSmtIntervals';

export async function POST(req: NextRequest) {
  const guard = requireSharedSecret(req);
  if (guard) return guard;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'BAD_JSON' }, { status: 400 });
  }

  const { esiid, meter, rows, from, to, debug = false, saveFilled = true } = body || {};

  // 1) Load raw rows (direct rows preferred)
  let raws: any[] = [];

  if (Array.isArray(rows) && rows.length) {
    raws = rows;
  } else {
    const loaded = await loadSmtRawRows({
      esiid,
      meter,
      from,
      to,
      take: 5000,
    });
    if (!loaded.modelName) {
      return NextResponse.json({ ok: false, error: 'NO_RAW_MODEL', tried: RAW_MODEL_CANDIDATES }, { status: 500 });
    }
    raws = loaded.rows;
  }

  if (!raws.length) {
    return NextResponse.json({ ok: true, processed: 0, normalizedPoints: 0, persisted: 0, note: 'NO_RAWS' });
  }

  // 2) Normalize + persist via canonical shared module
  const out = await normalizeAndPersistSmtIntervals({
    rows: raws,
    esiid,
    meter,
    saveFilled: saveFilled !== false,
    source: 'smt',
  });

  const res: any = { ok: true, processed: raws.length, normalizedPoints: out.normalizedPoints, persisted: out.persisted };
  if (debug) res.debug = { sample: out.sample.slice(0, 3) };
  return NextResponse.json(res);
}
