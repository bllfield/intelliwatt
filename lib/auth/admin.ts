import { NextRequest, NextResponse } from 'next/server';
import { assertNodeRuntime } from '@/lib/node/_guard';

assertNodeRuntime();

export type AdminGate =
  | { ok: true }
  | { ok: false; status: number; body: Record<string, unknown> };

/**
 * Strict admin gate: requires ADMIN_TOKEN and header x-admin-token to match.
 * Works with both NextRequest and native Request.
 */
export function requireAdmin(req: Request | NextRequest): AdminGate {
  const token = process.env.ADMIN_TOKEN ?? '';
  const headerToken =
    (req.headers.get('x-admin-token') ??
     req.headers.get('X-Admin-Token') ??
     '').trim();

  // Optional preview bypass – flip to true ONLY if you need it
  const ALLOW_PREVIEW_WHEN_UNSET = false;
  const nodeEnv = process.env.NODE_ENV;

  if (!token) {
    if (ALLOW_PREVIEW_WHEN_UNSET && nodeEnv !== 'production') {
      return { ok: true };
    }
    return {
      ok: false,
      status: 503,
      body: { error: 'ADMIN_TOKEN not configured' },
    };
  }

  if (headerToken !== token) {
    return { ok: false, status: 401, body: { error: 'Unauthorized' } };
  }

  return { ok: true };
}

/**
 * Legacy wrapper so existing callers (returning NextResponse|null) keep working.
 */
export function guardAdmin(req: Request) {
  const gate = requireAdmin(req);
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });
  return null;
}


