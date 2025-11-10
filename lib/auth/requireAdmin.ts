// lib/auth/requireAdmin.ts

import { NextRequest, NextResponse } from 'next/server';

export function guardAdmin(req: NextRequest) {
  const configured = process.env.ADMIN_TOKEN;

  if (!configured) {
    // Match documented behavior: prod requires ADMIN_TOKEN; if unset (dev/preview), allow.
    // We still allow to prevent lockout in dev as per docs.
    return null;
  }

  const header = req.headers.get('x-admin-token');

  if (!header || header !== configured) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  return null;
}
