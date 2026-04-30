import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { appliancesPrisma } from "@/lib/db/appliancesClient";
import { normalizeStoredApplianceProfile, validateApplianceProfile } from "@/modules/applianceProfile/validation";
import { resolveOnePathWriteTarget } from "../_helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function resolveHouseOwner(houseId: string) {
  return (prisma as any).houseAddress.findFirst({
    where: { id: houseId, archivedAt: null },
    select: { id: true, userId: true },
  });
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const houseId = String(url.searchParams.get("houseId") ?? "").trim();
  if (!houseId) return NextResponse.json({ ok: false, error: "house_required" }, { status: 400 });
  const target = await resolveOnePathWriteTarget({ request, requestedHouseId: houseId });
  if (!target.ok) return target.response;
  const house = await resolveHouseOwner(target.testHomeHouseId);
  if (!house?.userId) return NextResponse.json({ ok: false, error: "house_not_found" }, { status: 404 });

  const rec = await (appliancesPrisma as any).applianceProfileSimulated
    .findUnique({
      where: { userId_houseId: { userId: house.userId, houseId: target.testHomeHouseId } },
      select: { appliancesJson: true, updatedAt: true },
    })
    .catch(() => null);
  const profile = normalizeStoredApplianceProfile((rec?.appliancesJson as any) ?? null);
  return NextResponse.json({
    ok: true,
    houseId: target.testHomeHouseId,
    profile,
    appliances: profile.appliances,
    fuelConfiguration: profile.fuelConfiguration,
    updatedAt: rec?.updatedAt ? new Date(rec.updatedAt).toISOString() : null,
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const houseId = typeof body?.houseId === "string" ? body.houseId.trim() : "";
  if (!houseId) return NextResponse.json({ ok: false, error: "house_required" }, { status: 400 });
  const target = await resolveOnePathWriteTarget({ request, requestedHouseId: houseId });
  if (!target.ok) return target.response;
  const house = await resolveHouseOwner(target.testHomeHouseId);
  if (!house?.userId) return NextResponse.json({ ok: false, error: "house_not_found" }, { status: 404 });
  const incomingProfile = body?.profile ?? null;
  const validated = validateApplianceProfile({
    fuelConfiguration: incomingProfile?.fuelConfiguration ?? body?.fuelConfiguration ?? "",
    appliances: incomingProfile?.appliances ?? body?.appliances ?? [],
  });
  if (!validated.ok) return NextResponse.json({ ok: false, error: validated.error }, { status: 400 });

  const rec = await (appliancesPrisma as any).applianceProfileSimulated.upsert({
    where: { userId_houseId: { userId: house.userId, houseId: target.testHomeHouseId } },
    create: { userId: house.userId, houseId: target.testHomeHouseId, appliancesJson: validated.value },
    update: { appliancesJson: validated.value },
    select: { updatedAt: true },
  });
  return NextResponse.json({
    ok: true,
    houseId: target.testHomeHouseId,
    updatedAt: rec?.updatedAt ? new Date(rec.updatedAt).toISOString() : new Date().toISOString(),
  });
}
