import { NextResponse } from 'next/server';

/**
 * Guard for sensitive endpoints using an ADMIN_TOKEN.
 * - In Production: requires header x-admin-token === process.env.ADMIN_TOKEN
 * - In Preview/Dev: if ADMIN_TOKEN is set, require it; if not set, allow (prevents lockout)
 */
export function guardAdmin(req: Request) {
  const envToken = process.env.ADMIN_TOKEN || '';
  const headerToken = req.headers.get('x-admin-token') || '';
  const isProd = process.env.NODE_ENV === 'production';

  // If no token configured:
  if (!envToken) {
    // Fail safe in Prod, allow in non-Prod
    if (isProd) {
      return NextResponse.json({ error: 'Admin token not configured' }, { status: 503 });
    }
    return null; // allow in Preview/Dev to avoid lockout
  }

  if (headerToken !== envToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null; // ok
}

