// lib/auth/cron.ts
import { NextRequest, NextResponse } from 'next/server';

export function requireVercelCron(req: NextRequest) {
  // Vercel adds x-vercel-cron to scheduled invocations
  const cronHeader = req.headers.get('x-vercel-cron');
  const secret = process.env.CRON_SECRET;
  const provided = req.headers.get('x-cron-secret');

  // If CRON_SECRET is configured, require it as well.
  if (!cronHeader) {
    return NextResponse.json({ ok: false, error: 'UNAUTHORIZED_CRON' }, { status: 401 });
  }
  if (secret && provided !== secret) {
    return NextResponse.json({ ok: false, error: 'BAD_CRON_SECRET' }, { status: 401 });
  }
  return null; // ok
}

