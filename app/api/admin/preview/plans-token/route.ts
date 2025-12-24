import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function requireAdminHeader(req: NextRequest) {
  const token = req.headers.get("x-admin-token") || "";
  const expected = process.env.ADMIN_TOKEN || "";
  if (!expected || token !== expected) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return null;
}

export async function GET(req: NextRequest) {
  const guard = requireAdminHeader(req);
  if (guard) return guard;

  // IMPORTANT: Do not expose this token in any public endpoint.
  // This endpoint is admin-gated and exists only to help copy/paste the share URL in the admin UI.
  const token = (process.env.PREVIEW_PLANS_TOKEN || "").trim();
  const base =
    process.env.NEXT_PUBLIC_BASE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://intelliwatt.com");

  return NextResponse.json({
    ok: true,
    token: token || null,
    url: token ? `${String(base).replace(/\/+$/, "")}/preview/plans/${token}` : null,
  });
}


