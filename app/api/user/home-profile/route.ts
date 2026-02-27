import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { homeDetailsPrisma } from "@/lib/db/homeDetailsClient";
import { appliancesPrisma } from "@/lib/db/appliancesClient";
import { normalizeEmail } from "@/lib/utils/email";
import { validateHomeProfile, type HomeProfileInput } from "@/modules/homeProfile/validation";
import { normalizeStoredApplianceProfile, validateApplianceProfile } from "@/modules/applianceProfile/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function formatHomeDetailsDbError(e: any): string {
  const msg = typeof e?.message === "string" ? e.message : String(e ?? "");
  const rawCode = (e as any)?.code ?? (e as any)?.errorCode ?? null; // Prisma error codes like P1001 / P2002
  const code = typeof rawCode === "string" ? rawCode : null;
  if (code) return `home_details_db_error_${code}`;
  if (/HOME_DETAILS_DATABASE_URL/i.test(msg)) return "home_details_db_missing_env";
  if (/P1001/i.test(msg)) return "home_details_db_unreachable";
  if (/permission denied/i.test(msg)) return "home_details_db_permission_denied";
  if (/timeout/i.test(msg)) return "home_details_db_timeout";
  return "home_details_db_error";
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

const validate = validateHomeProfile;
const AUTO_POOL_SOURCE = "home_details_pool";
const AUTO_HVAC_SOURCE = "home_details_hvac";

function uid(): string {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

async function syncHomeDetailsToAppliances(args: { userId: string; houseId: string; profile: HomeProfileInput }) {
  const read = await (appliancesPrisma as any).applianceProfileSimulated
    .findUnique({
      where: { userId_houseId: { userId: args.userId, houseId: args.houseId } },
      select: { appliancesJson: true },
    })
    .catch(() => null);

  const normalized = normalizeStoredApplianceProfile((read?.appliancesJson as any) ?? null);
  const appliances = Array.isArray(normalized.appliances) ? [...normalized.appliances] : [];

  const nextFuelConfiguration = normalized.fuelConfiguration || args.profile.fuelConfiguration;
  const poolIdx = appliances.findIndex((a: any) => a?.type === "pool" && String(a?.data?._autoSource ?? "") === AUTO_POOL_SOURCE);
  const hvacIdx = appliances.findIndex((a: any) => a?.type === "hvac" && String(a?.data?._autoSource ?? "") === AUTO_HVAC_SOURCE);

  if (args.profile.hasPool) {
    const poolData = {
      ...(poolIdx >= 0 ? appliances[poolIdx]?.data : {}),
      _autoSource: AUTO_POOL_SOURCE,
      _autoUpdatedAt: new Date().toISOString(),
      pool_size: null,
      pump_type: args.profile.poolPumpType ?? "",
      pump_hp: args.profile.poolPumpHp ?? null,
      has_heater: Boolean(args.profile.hasPoolHeater),
      heater_type: args.profile.poolHeaterType ?? "",
      summer_run_time: args.profile.poolSummerRunHoursPerDay ?? null,
      winter_run_time: args.profile.poolWinterRunHoursPerDay ?? null,
    };
    if (poolIdx >= 0) {
      appliances[poolIdx] = { ...appliances[poolIdx], type: "pool", data: poolData };
    } else {
      appliances.push({ id: uid(), type: "pool", data: poolData });
    }
  } else if (poolIdx >= 0) {
    appliances.splice(poolIdx, 1);
  }

  if (args.profile.hvacType || args.profile.heatingType) {
    const hvacData = {
      ...(hvacIdx >= 0 ? appliances[hvacIdx]?.data : {}),
      _autoSource: AUTO_HVAC_SOURCE,
      _autoUpdatedAt: new Date().toISOString(),
      system_type: args.profile.hvacType ?? "",
      heat_source: args.profile.heatingType ?? "",
    };
    if (hvacIdx >= 0) {
      appliances[hvacIdx] = { ...appliances[hvacIdx], type: "hvac", data: hvacData };
    } else {
      appliances.push({ id: uid(), type: "hvac", data: hvacData });
    }
  }

  const validated = validateApplianceProfile({
    version: 1,
    fuelConfiguration: nextFuelConfiguration,
    appliances,
  });
  if (!validated.ok) return;

  await (appliancesPrisma as any).applianceProfileSimulated
    .upsert({
      where: { userId_houseId: { userId: args.userId, houseId: args.houseId } },
      create: { userId: args.userId, houseId: args.houseId, appliancesJson: validated.value },
      update: { appliancesJson: validated.value },
    })
    .catch(() => null);
}

export async function GET(request: NextRequest) {
  try {
    const u = await requireUser();
    if (!u.ok) return NextResponse.json(u.body, { status: u.status });

    const url = new URL(request.url);
    const houseId = await resolveHouseId(u.user.id, url.searchParams.get("houseId"));
    if (!houseId) return NextResponse.json({ ok: false, error: "house_required" }, { status: 400 });

    let rec: any = null;
    try {
      rec = await (homeDetailsPrisma as any).homeProfileSimulated.findUnique({
        where: { userId_houseId: { userId: u.user.id, houseId } },
      });
    } catch (e: any) {
      console.error("[user/home-profile] HomeDetails DB read failed", e);
      return NextResponse.json({ ok: false, error: formatHomeDetailsDbError(e) }, { status: 503 });
    }

    if (!rec) {
      return NextResponse.json({ ok: true, houseId, profile: null, updatedAt: null });
    }

    return NextResponse.json({
      ok: true,
      houseId,
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
      } satisfies HomeProfileInput,
      provenance: rec.provenanceJson ?? null,
      prefill: rec.prefillJson ?? null,
      updatedAt: rec.updatedAt ? new Date(rec.updatedAt).toISOString() : null,
    });
  } catch (e) {
    console.error("[user/home-profile] GET failed", e);
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

    const v = validate(body?.profile ?? body);
    if (!v.ok) return NextResponse.json({ ok: false, error: v.error }, { status: 400 });

    const provenanceJson = body?.provenance ?? null;
    const prefillJson = body?.prefill ?? null;

    let rec: any = null;
    try {
      rec = await (homeDetailsPrisma as any).homeProfileSimulated.upsert({
        where: { userId_houseId: { userId: u.user.id, houseId } },
        create: {
          userId: u.user.id,
          houseId,
          ...v.value,
          provenanceJson,
          prefillJson,
        },
        update: {
          ...v.value,
          provenanceJson,
          prefillJson,
        },
        select: { updatedAt: true },
      });
    } catch (e: any) {
      console.error("[user/home-profile] HomeDetails DB write failed", e);
      return NextResponse.json({ ok: false, error: formatHomeDetailsDbError(e) }, { status: 503 });
    }

    // Home Details is source-of-truth for pool/HVAC summary fields; sync to appliances best-effort.
    await syncHomeDetailsToAppliances({ userId: u.user.id, houseId, profile: v.value });

    return NextResponse.json({ ok: true, houseId, updatedAt: new Date(rec.updatedAt).toISOString() });
  } catch (e) {
    console.error("[user/home-profile] POST failed", e);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

