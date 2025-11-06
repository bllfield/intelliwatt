// app/api/admin/cron/normalize-smt-catch/route.ts
// Quick catch-up worker: 1-minute sweep to advance any stragglers
export const runtime = 'nodejs';

export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireVercelCron } from '@/lib/auth/cron';

export async function POST(req: NextRequest) {
  const guard = requireVercelCron(req);
  if (guard) return guard;

  // TODO: optionally scan last N minutes from raw table and persist intervals
  // For now, this is a no-op placeholder
  return NextResponse.json({ ok: true, note: 'noop-catchup' });
}

