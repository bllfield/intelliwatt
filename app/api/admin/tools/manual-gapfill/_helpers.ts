import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { normalizeEmailSafe } from "@/lib/utils/email";

const ADMIN_EMAILS = ["brian@intelliwatt.com", "brian@intellipath-solutions.com"];

function hasAdminSessionCookie(request: NextRequest): boolean {
  const raw = request.cookies.get("intelliwatt_admin")?.value ?? "";
  const email = normalizeEmailSafe(raw);
  return Boolean(email && ADMIN_EMAILS.includes(email));
}

export function gateManualGapfillAdmin(req: NextRequest): NextResponse | null {
  if (!hasAdminSessionCookie(req)) {
    const gate = requireAdmin(req);
    if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });
  }
  return null;
}
