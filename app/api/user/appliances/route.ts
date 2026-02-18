import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { appliancesPrisma } from "@/lib/db/appliancesClient";
import { normalizeEmail } from "@/lib/utils/email";
import {
  normalizeStoredApplianceProfile,
  validateApplianceProfile,
  type ApplianceProfilePayloadV1,
  type ApplianceRow,
} from "@/modules/applianceProfile/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const normalizeStoredProfile = normalizeStoredApplianceProfile;

async function requireUser() {
  const cookieStore = cookies();
  const rawEmail = cookieStore.get("intelliwatt_user")?.value ?? null;
  if (!rawEmail) return { ok: false as const, status: 401, body: { ok: false, error: "Not authenticated" } };
  const email = normalizeEmail(rawEmail);
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) return { ok: false as const, status: 404, body: { ok: false, error: "User not found" } };
  return { ok: true as const, user };
}

async function resolveHouseId(userId: string, houseIdRaw: string | null): Promise<string | null> {
  const prismaAny = prisma as any;
  if (houseIdRaw && houseIdRaw.trim()) {
    const h = await prismaAny.houseAddress.findFirst({
      where: { id: houseIdRaw.trim(), userId, archivedAt: null },
      select: { id: true },
    });
    return h?.id ?? null;
  }
  const primary =
    (await prismaAny.houseAddress.findFirst({
      where: { userId, archivedAt: null, isPrimary: true },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    })) ??
    (await prismaAny.houseAddress.findFirst({
      where: { userId, archivedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    }));
  return primary?.id ?? null;
}

export async function GET(request: NextRequest) {
  try {
    const u = await requireUser();
    if (!u.ok) return NextResponse.json(u.body, { status: u.status });

    const url = new URL(request.url);
    const houseId = await resolveHouseId(u.user.id, url.searchParams.get("houseId"));
    if (!houseId) return NextResponse.json({ ok: false, error: "house_required" }, { status: 400 });

    const rec = await (appliancesPrisma as any).applianceProfileSimulated
      .findUnique({
        where: { userId_houseId: { userId: u.user.id, houseId } },
        select: { appliancesJson: true, updatedAt: true },
      })
      .catch(() => null);

    const profile = normalizeStoredProfile((rec?.appliancesJson as any) ?? null);

    return NextResponse.json({
      ok: true,
      houseId,
      profile,
      // Back-compat: keep these top-level keys for older clients.
      appliances: profile.appliances,
      fuelConfiguration: profile.fuelConfiguration,
      updatedAt: rec?.updatedAt ? new Date(rec.updatedAt).toISOString() : null,
    });
  } catch (e) {
    console.error("[user/appliances] GET failed", e);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const u = await requireUser();
    if (!u.ok) return NextResponse.json(u.body, { status: u.status });

    const body = await request.json().catch(() => ({}));
    const houseId = await resolveHouseId(u.user.id, typeof body?.houseId === "string" ? body.houseId : null);
    if (!houseId) return NextResponse.json({ ok: false, error: "house_required" }, { status: 400 });

    const incomingProfile = body?.profile ?? null;
    const v = validateApplianceProfile({
      fuelConfiguration: incomingProfile?.fuelConfiguration ?? body?.fuelConfiguration ?? "",
      appliances: incomingProfile?.appliances ?? body?.appliances ?? [],
    });
    if (!v.ok) return NextResponse.json({ ok: false, error: v.error }, { status: 400 });

    const profileToStore: ApplianceProfilePayloadV1 = v.value;

    const rec = await (appliancesPrisma as any).applianceProfileSimulated.upsert({
      where: { userId_houseId: { userId: u.user.id, houseId } },
      create: { userId: u.user.id, houseId, appliancesJson: profileToStore },
      update: { appliancesJson: profileToStore },
      select: { updatedAt: true },
    });

    return NextResponse.json({ ok: true, houseId, updatedAt: new Date(rec.updatedAt).toISOString() });
  } catch (e) {
    console.error("[user/appliances] POST failed", e);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

