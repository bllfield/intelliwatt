import { NextResponse } from 'next/server';
import { guardAdmin } from '@/lib/auth/admin';

/**
 * Admin-only: returns booleans for required env vars (never reveals values).
 */
export async function GET(req: Request) {
  const gate = guardAdmin(req);
  if (gate) return gate;

  const keys = ['DATABASE_URL', 'NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', 'ADMIN_TOKEN'];
  const status: Record<string, boolean> = {};
  for (const k of keys) status[k] = !!process.env[k] && process.env[k]!.length > 0;

  return NextResponse.json({ ok: true, env: status });
}

