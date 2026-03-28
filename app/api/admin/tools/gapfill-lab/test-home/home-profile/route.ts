import { NextRequest, NextResponse } from "next/server";
import { homeDetailsPrisma } from "@/lib/db/homeDetailsClient";
import { validateHomeProfile } from "@/modules/homeProfile/validation";
import { resolveReadyTestHome } from "../_helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const ctx = await resolveReadyTestHome(request);
  if (!ctx.ok) return ctx.response;
  const { ownerUserId, testHomeHouseId } = ctx;

  const rec = await (homeDetailsPrisma as any).homeProfileSimulated
    .findUnique({
      where: { userId_houseId: { userId: ownerUserId, houseId: testHomeHouseId } },
    })
    .catch(() => null);

  if (!rec) {
    return NextResponse.json({ ok: true, houseId: testHomeHouseId, profile: null, updatedAt: null });
  }

  return NextResponse.json({
    ok: true,
    houseId: testHomeHouseId,
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
  const ctx = await resolveReadyTestHome(request);
  if (!ctx.ok) return ctx.response;
  const { ownerUserId, testHomeHouseId } = ctx;

  const body = await request.json().catch(() => ({}));
  const v = validateHomeProfile(body?.profile ?? body, { requirePastBaselineFields: true });
  if (!v.ok) {
    return NextResponse.json({ ok: false, error: v.error }, { status: 400 });
  }

  const rec = await (homeDetailsPrisma as any).homeProfileSimulated.upsert({
    where: { userId_houseId: { userId: ownerUserId, houseId: testHomeHouseId } },
    create: {
      userId: ownerUserId,
      houseId: testHomeHouseId,
      ...v.value,
      provenanceJson: body?.provenance ?? null,
      prefillJson: body?.prefill ?? null,
    },
    update: {
      ...v.value,
      provenanceJson: body?.provenance ?? null,
      prefillJson: body?.prefill ?? null,
    },
    select: { updatedAt: true },
  });

  return NextResponse.json({
    ok: true,
    houseId: testHomeHouseId,
    updatedAt: rec?.updatedAt ? new Date(rec.updatedAt).toISOString() : new Date().toISOString(),
  });
}
