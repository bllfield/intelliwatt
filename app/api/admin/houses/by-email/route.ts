import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { lookupAdminHousesByEmail } from "@/lib/admin/adminHouseLookup";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const gate = requireAdmin(req);
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

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
