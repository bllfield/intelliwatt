import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { refreshAllUsersAndBuildExpiryDigest } from "@/lib/hitthejackwatt/entryLifecycle";
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

export async function POST(request: NextRequest) {
  try {
    if (!hasAdminSessionCookie(request)) {
      const gate = requireAdmin(request);
      if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });
    }

    const digest = await refreshAllUsersAndBuildExpiryDigest();
    return NextResponse.json({
      ok: true,
      flaggedCount: digest.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error recalculating entry statuses:", error);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

