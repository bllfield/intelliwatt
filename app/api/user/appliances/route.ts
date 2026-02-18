import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { appliancesPrisma } from "@/lib/db/appliancesClient";
import { normalizeEmail } from "@/lib/utils/email";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ApplianceRow = { id: string; type: string; data: Record<string, any> };
type ApplianceProfilePayloadV1 = {
  version: 1;
  fuelConfiguration: string;
  appliances: ApplianceRow[];
};

function requireNonEmptyString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length ? s : null;
}

function normalizeStoredProfile(raw: any): ApplianceProfilePayloadV1 {
  // Back-compat: older records stored just an array of rows.
  if (Array.isArray(raw)) {
    return {
      version: 1,
      fuelConfiguration: "",
      appliances: raw as any,
    };
  }

  const version = raw?.version === 1 ? 1 : 1;
  const fuelConfiguration = typeof raw?.fuelConfiguration === "string" ? raw.fuelConfiguration : "";
  const appliances = Array.isArray(raw?.appliances) ? raw.appliances : [];

  return { version, fuelConfiguration, appliances };
}

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
    const appliances = Array.isArray(incomingProfile?.appliances)
      ? incomingProfile.appliances
      : Array.isArray(body?.appliances)
        ? body.appliances
        : [];
    const fuelConfiguration =
      requireNonEmptyString(incomingProfile?.fuelConfiguration) ??
      requireNonEmptyString(body?.fuelConfiguration) ??
      null;

    // Mandatory: fuel configuration selection (everything else is optional).
    if (!fuelConfiguration) {
      return NextResponse.json({ ok: false, error: "fuelConfiguration_required" }, { status: 400 });
    }

    // Minimal validation: require a type on each row.
    for (let i = 0; i < appliances.length; i++) {
      const t = appliances[i]?.type;
      if (typeof t !== "string" || !t.trim()) {
        return NextResponse.json({ ok: false, error: "appliance_type_required" }, { status: 400 });
      }
    }

    const profileToStore: ApplianceProfilePayloadV1 = {
      version: 1,
      fuelConfiguration,
      appliances,
    };

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

