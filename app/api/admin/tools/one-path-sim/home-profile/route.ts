import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { homeDetailsPrisma } from "@/lib/db/homeDetailsClient";
import { validateHomeProfile } from "@/modules/homeProfile/validation";
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

  const rec = await (homeDetailsPrisma as any).homeProfileSimulated
    .findUnique({
      where: { userId_houseId: { userId: house.userId, houseId: target.testHomeHouseId } },
    })
    .catch(() => null);
  if (!rec) return NextResponse.json({ ok: true, houseId: target.testHomeHouseId, profile: null, updatedAt: null });

  return NextResponse.json({
    ok: true,
    houseId: target.testHomeHouseId,
    profile: {
      homeAge: rec.homeAge,
      homeStyle: rec.homeStyle,
      squareFeet: rec.squareFeet,
      stories: rec.stories,
      insulationType: rec.insulationType,
      windowType: rec.windowType,
      foundation: rec.foundation,
      ledLights: rec.ledLights,
      smartThermostat: rec.smartThermostat,
      summerTemp: rec.summerTemp,
      winterTemp: rec.winterTemp,
      occupantsWork: rec.occupantsWork,
      occupantsSchool: rec.occupantsSchool,
      occupantsHomeAllDay: rec.occupantsHomeAllDay,
      fuelConfiguration: rec.fuelConfiguration,
      hvacType: rec.hvacType ?? null,
      heatingType: rec.heatingType ?? null,
      hasPool: Boolean(rec.hasPool),
      poolPumpType: rec.poolPumpType ?? null,
      poolPumpHp: rec.poolPumpHp ?? null,
      poolSummerRunHoursPerDay: rec.poolSummerRunHoursPerDay ?? null,
      poolWinterRunHoursPerDay: rec.poolWinterRunHoursPerDay ?? null,
      hasPoolHeater: Boolean(rec.hasPoolHeater),
      poolHeaterType: rec.poolHeaterType ?? null,
      ev: rec.evHasVehicle
        ? {
            hasVehicle: true,
            count: rec.evCount ?? undefined,
            chargerType: rec.evChargerType ?? undefined,
            avgMilesPerDay: rec.evAvgMilesPerDay ?? undefined,
            avgKwhPerDay: rec.evAvgKwhPerDay ?? undefined,
            chargingBehavior: rec.evChargingBehavior ?? undefined,
            preferredStartHr: rec.evPreferredStartHr ?? undefined,
            preferredEndHr: rec.evPreferredEndHr ?? undefined,
            smartCharger: rec.evSmartCharger ?? undefined,
          }
        : undefined,
    },
    provenance: rec.provenanceJson ?? null,
    prefill: rec.prefillJson ?? null,
    updatedAt: rec.updatedAt ? new Date(rec.updatedAt).toISOString() : null,
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
  const validated = validateHomeProfile(body?.profile ?? body, { requirePastBaselineFields: true });
  if (!validated.ok) return NextResponse.json({ ok: false, error: validated.error }, { status: 400 });

  const rec = await (homeDetailsPrisma as any).homeProfileSimulated.upsert({
    where: { userId_houseId: { userId: house.userId, houseId: target.testHomeHouseId } },
    create: {
      userId: house.userId,
      houseId: target.testHomeHouseId,
      ...validated.value,
      provenanceJson: body?.provenance ?? null,
      prefillJson: body?.prefill ?? null,
    },
    update: {
      ...validated.value,
      provenanceJson: body?.provenance ?? null,
      prefillJson: body?.prefill ?? null,
    },
    select: { updatedAt: true },
  });
  return NextResponse.json({
    ok: true,
    houseId: target.testHomeHouseId,
    updatedAt: rec?.updatedAt ? new Date(rec.updatedAt).toISOString() : new Date().toISOString(),
  });
}
