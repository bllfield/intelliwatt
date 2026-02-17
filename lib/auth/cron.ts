// lib/auth/cron.ts
import { NextRequest, NextResponse } from 'next/server';

export function requireVercelCron(req: NextRequest) {
  // Vercel adds x-vercel-cron to scheduled invocations
  const cronHeader = req.headers.get('x-vercel-cron');
  const secret = process.env.CRON_SECRET;
  const providedHeader = req.headers.get('x-cron-secret');
  const auth = req.headers.get('authorization') || req.headers.get('Authorization');
  const providedBearer =
    typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')
      ? auth.slice('bearer '.length).trim()
      : null;
  const provided = (providedBearer || providedHeader || '').trim() || null;

  // If CRON_SECRET is configured, require it as well.
  if (!cronHeader) {
    return NextResponse.json({ ok: false, error: 'UNAUTHORIZED_CRON' }, { status: 401 });
  }
  if (secret && provided !== secret) {
    return NextResponse.json({ ok: false, error: 'BAD_CRON_SECRET' }, { status: 401 });
  }
  return null; // ok
}

