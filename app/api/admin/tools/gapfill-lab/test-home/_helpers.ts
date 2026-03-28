import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { prisma } from "@/lib/db";
import { normalizeEmailSafe } from "@/lib/utils/email";
import { getLabTestHomeLink } from "@/modules/usageSimulator/labTestHome";

const ADMIN_EMAILS = ["brian@intelliwatt.com", "brian@intellipath-solutions.com"];

function hasAdminSessionCookie(request: NextRequest): boolean {
  const raw = request.cookies.get("intelliwatt_admin")?.value ?? "";
  const email = normalizeEmailSafe(raw);
  return Boolean(email && ADMIN_EMAILS.includes(email));
}

export function gateGapfillLabAdmin(req: NextRequest): NextResponse | null {
  if (!hasAdminSessionCookie(req)) {
    const gate = requireAdmin(req);
    if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });
  }
  return null;
}

export async function resolveLabOwnerUserId(request: NextRequest): Promise<string | null> {
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

export async function resolveReadyTestHome(request: NextRequest): Promise<
  | { ok: true; ownerUserId: string; testHomeHouseId: string }
  | { ok: false; response: NextResponse }
> {
  const denied = gateGapfillLabAdmin(request);
  if (denied) return { ok: false, response: denied };
  const ownerUserId = await resolveLabOwnerUserId(request);
  if (!ownerUserId) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "lab_owner_not_found" }, { status: 400 }),
    };
  }
  const link = await getLabTestHomeLink(ownerUserId);
  if (!link?.testHomeHouseId) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "test_home_not_ready", message: "Load/replace test home first." },
        { status: 409 }
      ),
    };
  }
  return {
    ok: true,
    ownerUserId,
    testHomeHouseId: String(link.testHomeHouseId),
  };
}
