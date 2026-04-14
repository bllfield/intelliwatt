import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { normalizeEmailSafe } from "@/lib/utils/email";
import { lookupAdminHousesByEmail, resolveAdminHouseSelection } from "@/lib/admin/adminHouseLookup";
import { listScenarios } from "@/modules/usageSimulator/service";

const ADMIN_EMAILS = ["brian@intelliwatt.com", "brian@intellipath-solutions.com"];

function hasAdminSessionCookie(request: NextRequest): boolean {
  const raw = request.cookies.get("intelliwatt_admin")?.value ?? "";
  const email = normalizeEmailSafe(raw);
  return Boolean(email && ADMIN_EMAILS.includes(email));
}

export function gateOnePathSimAdmin(request: NextRequest): NextResponse | null {
  if (hasAdminSessionCookie(request)) return null;
  const gate = requireAdmin(request);
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });
  return null;
}

export async function resolveOnePathSimUserSelection(args: {
  email?: string | null;
  houseId?: string | null;
}) {
  const email = normalizeEmailSafe(args.email ?? "");
  if (!email) return { ok: false as const, error: "email_required" };
  const lookup = await lookupAdminHousesByEmail(email);
  if (!lookup.ok) return lookup;
  const selectedHouse =
    (await resolveAdminHouseSelection({ email, houseId: args.houseId ?? null })) ??
    lookup.houses[0] ??
    null;
  if (!selectedHouse) return { ok: false as const, error: "house_not_found" };
  const scenarios = await listScenarios({ userId: lookup.userId, houseId: selectedHouse.id }).catch(() => ({ ok: false as const, scenarios: [] }));
  return {
    ok: true as const,
    email: lookup.email,
    userId: lookup.userId,
    houses: lookup.houses,
    selectedHouse,
    scenarios: scenarios.ok ? scenarios.scenarios : [],
  };
}
