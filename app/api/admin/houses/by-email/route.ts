import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { lookupAdminHousesByEmail } from "@/lib/admin/adminHouseLookup";
import { normalizeEmailSafe } from "@/lib/utils/email";

export const dynamic = "force-dynamic";

const ADMIN_EMAILS = ["brian@intelliwatt.com", "brian@intellipath-solutions.com"];

function hasAdminSessionCookie(request: NextRequest): boolean {
  const raw = request.cookies.get("intelliwatt_admin")?.value ?? "";
  const email = normalizeEmailSafe(raw);
  return Boolean(email && ADMIN_EMAILS.includes(email));
}

export async function GET(req: NextRequest) {
  if (!hasAdminSessionCookie(req)) {
    const gate = requireAdmin(req);
    if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });
  }

  const email = String(req.nextUrl.searchParams.get("email") ?? "");
  const lookup = await lookupAdminHousesByEmail(email);
  if (!lookup.ok) {
    return NextResponse.json(
      { ok: false, error: lookup.error },
      { status: lookup.error === "email_required" ? 400 : 404 }
    );
  }

  return NextResponse.json({
    ok: true,
    email: lookup.email,
    userId: lookup.userId,
    houses: lookup.houses,
  });
}
