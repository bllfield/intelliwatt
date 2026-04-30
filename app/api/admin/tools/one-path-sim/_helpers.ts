import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { prisma } from "@/lib/db";
import { normalizeEmailSafe } from "@/lib/utils/email";
import { lookupAdminHousesByEmail, resolveAdminHouseSelection } from "@/lib/admin/adminHouseLookup";
import { listScenarios } from "@/modules/usageSimulator/service";
import { ensureGlobalOnePathLabTestHomeHouse, getOnePathLabTestHomeLink } from "@/modules/usageSimulator/labTestHome";

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

export async function resolveOnePathSimOwnerUserId(request: NextRequest): Promise<string | null> {
  const cookieEmail = normalizeEmailSafe(request.cookies.get("intelliwatt_admin")?.value ?? "");
  if (cookieEmail) {
    const cookieUser = await prisma.user
      .findFirst({
        where: { email: { equals: cookieEmail, mode: "insensitive" } },
        select: { id: true },
      })
      .catch(() => null);
    if (cookieUser?.id) return String(cookieUser.id);
  }
  for (const adminEmail of ADMIN_EMAILS) {
    const fallback = await prisma.user
      .findFirst({
        where: { email: { equals: adminEmail, mode: "insensitive" } },
        select: { id: true },
      })
      .catch(() => null);
    if (fallback?.id) return String(fallback.id);
  }
  return null;
}

export async function resolveOnePathWriteTarget(args: {
  request: NextRequest;
  requestedHouseId?: string | null;
}): Promise<
  | {
      ok: true;
      ownerUserId: string;
      testHomeHouseId: string;
      sourceHouseId: string | null;
      sourceUserId: string | null;
    }
  | { ok: false; response: NextResponse }
> {
  const denied = gateOnePathSimAdmin(args.request);
  if (denied) return { ok: false, response: denied };
  const ownerUserId = await resolveOnePathSimOwnerUserId(args.request);
  if (!ownerUserId) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "lab_owner_not_found" }, { status: 400 }),
    };
  }
  const ensuredHome = await ensureGlobalOnePathLabTestHomeHouse(ownerUserId);
  const link = await getOnePathLabTestHomeLink(ownerUserId);
  if (!link?.testHomeHouseId) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "test_home_not_ready", message: "Replace the One Path test home from the selected source first." },
        { status: 409 }
      ),
    };
  }
  const requestedHouseId = typeof args.requestedHouseId === "string" ? args.requestedHouseId.trim() : "";
  if (
    requestedHouseId &&
    requestedHouseId !== link.testHomeHouseId &&
    requestedHouseId !== link.sourceHouseId
  ) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          ok: false,
          error: "invalid_one_path_target_house",
          message: "One Path admin writes are pinned to the linked test home only.",
          testHomeHouseId: link.testHomeHouseId,
          sourceHouseId: link.sourceHouseId ?? null,
        },
        { status: 409 }
      ),
    };
  }
  return {
    ok: true,
    ownerUserId,
    testHomeHouseId: String(link.testHomeHouseId || ensuredHome.id),
    sourceHouseId: link.sourceHouseId ? String(link.sourceHouseId) : null,
    sourceUserId: link.sourceUserId ? String(link.sourceUserId) : null,
  };
}
