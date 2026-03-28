import { NextRequest, NextResponse } from "next/server";
import { appliancesPrisma } from "@/lib/db/appliancesClient";
import { normalizeStoredApplianceProfile, validateApplianceProfile } from "@/modules/applianceProfile/validation";
import { resolveReadyTestHome } from "../_helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const ctx = await resolveReadyTestHome(request);
  if (!ctx.ok) return ctx.response;
  const { ownerUserId, testHomeHouseId } = ctx;

  const rec = await (appliancesPrisma as any).applianceProfileSimulated
    .findUnique({
      where: { userId_houseId: { userId: ownerUserId, houseId: testHomeHouseId } },
      select: { appliancesJson: true, updatedAt: true },
    })
    .catch(() => null);

  const profile = normalizeStoredApplianceProfile((rec?.appliancesJson as any) ?? null);
  return NextResponse.json({
    ok: true,
    houseId: testHomeHouseId,
    profile,
    appliances: profile.appliances,
    fuelConfiguration: profile.fuelConfiguration,
    updatedAt: rec?.updatedAt ? new Date(rec.updatedAt).toISOString() : null,
  });
}

export async function POST(request: NextRequest) {
  const ctx = await resolveReadyTestHome(request);
  if (!ctx.ok) return ctx.response;
  const { ownerUserId, testHomeHouseId } = ctx;

  const body = await request.json().catch(() => ({}));
  const incomingProfile = body?.profile ?? null;
  const v = validateApplianceProfile({
    fuelConfiguration: incomingProfile?.fuelConfiguration ?? body?.fuelConfiguration ?? "",
    appliances: incomingProfile?.appliances ?? body?.appliances ?? [],
  });
  if (!v.ok) return NextResponse.json({ ok: false, error: v.error }, { status: 400 });

  const rec = await (appliancesPrisma as any).applianceProfileSimulated.upsert({
    where: { userId_houseId: { userId: ownerUserId, houseId: testHomeHouseId } },
    create: { userId: ownerUserId, houseId: testHomeHouseId, appliancesJson: v.value },
    update: { appliancesJson: v.value },
    select: { updatedAt: true },
  });

  return NextResponse.json({
    ok: true,
    houseId: testHomeHouseId,
    updatedAt: rec?.updatedAt ? new Date(rec.updatedAt).toISOString() : new Date().toISOString(),
  });
}
