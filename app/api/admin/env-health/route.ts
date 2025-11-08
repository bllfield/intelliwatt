import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

function requireAdmin(req: NextRequest) {
  const token = req.headers.get('x-admin-token') || '';
  const expected = process.env.ADMIN_TOKEN || '';
  if (!expected || token !== expected) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  return null;
}

export async function GET(req: NextRequest) {
  const guard = requireAdmin(req);
  if (guard) return guard;

  const present = (value?: string) => Boolean(value && value.length > 0);

  return NextResponse.json({
    ok: true,
    now: new Date().toISOString(),
    env: {
      DATABASE_URL: present(process.env.DATABASE_URL),
      ADMIN_TOKEN: present(process.env.ADMIN_TOKEN),
      CRON_SECRET: present(process.env.CRON_SECRET),
      ERCOT_PAGE_URL: present(process.env.ERCOT_PAGE_URL),
      PROD_BASE_URL: present(process.env.PROD_BASE_URL),
      NODE_ENV: process.env.NODE_ENV || 'unknown',
    },
  });
}

