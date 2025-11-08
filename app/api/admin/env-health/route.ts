import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic';

function requireAdminHeader(req: NextRequest) {
  const token = req.headers.get("x-admin-token") || "";
  const expected = process.env.ADMIN_TOKEN || "";
  if (!expected || token !== expected) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return null;
}

const present = (v?: string) => Boolean(v && v.length > 0);

export async function GET(req: NextRequest) {
  const guard = requireAdminHeader(req);
  if (guard) return guard;

  return NextResponse.json({
    ok: true,
    now: new Date().toISOString(),
    env: {
      DATABASE_URL: present(process.env.DATABASE_URL),
      ADMIN_TOKEN: present(process.env.ADMIN_TOKEN),
      CRON_SECRET: present(process.env.CRON_SECRET),
      ERCOT_PAGE_URL: present(process.env.ERCOT_PAGE_URL),
      PROD_BASE_URL: present(process.env.PROD_BASE_URL),
      NODE_ENV: process.env.NODE_ENV || "unknown"
    }
  });
}
