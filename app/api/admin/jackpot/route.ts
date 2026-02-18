import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { db } from "@/lib/db";
import { normalizeEmailSafe } from "@/lib/utils/email";

export const dynamic = "force-dynamic";

// Keep consistent with `app/admin/magic/route.ts` + `app/api/send-admin-magic-link/route.ts`
const ADMIN_EMAILS = ["brian@intelliwatt.com", "brian@intellipath-solutions.com"];

function hasAdminSessionCookie(request: NextRequest): boolean {
  const raw = request.cookies.get("intelliwatt_admin")?.value ?? "";
  const email = normalizeEmailSafe(raw);
  if (!email) return false;
  return ADMIN_EMAILS.includes(email);
}

export async function GET(request: NextRequest) {
  try {
    if (!hasAdminSessionCookie(request)) {
      const gate = requireAdmin(request);
      if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });
    }

    const jackpotPayouts = await db.jackpotPayout.findMany({
      include: { user: { select: { id: true, email: true, createdAt: true } } },
      orderBy: { createdAt: "desc" },
    });

    // Keep response backwards-compatible with the old admin UI (plain array).
    return NextResponse.json(jackpotPayouts);
  } catch (error) {
    console.error("Error fetching jackpot payouts:", error);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}