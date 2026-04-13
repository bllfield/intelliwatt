import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/utils/email";
import { getManualUsageInputForUserHouse, saveManualUsageInputForUserHouse } from "@/modules/manualUsage/store";
import type { ManualUsagePayload } from "@/modules/simulatedUsage/types";
import { getHomeProfileSimulatedByUserHouse } from "@/modules/homeProfile/repo";
import { getApplianceProfileSimulatedByUserHouse } from "@/modules/applianceProfile/repo";
import { normalizeStoredApplianceProfile } from "@/modules/applianceProfile/validation";
import { resolveSharedWeatherSensitivityEnvelope } from "@/modules/weatherSensitivity/shared";

async function requireUser() {
  const cookieStore = cookies();
  const userEmailRaw = cookieStore.get("intelliwatt_user")?.value ?? null;
  if (!userEmailRaw) return { ok: false as const, status: 401, body: { ok: false, error: "Not authenticated" } };

  const userEmail = normalizeEmail(userEmailRaw);
  const user = await prisma.user.findUnique({ where: { email: userEmail }, select: { id: true } });
  if (!user) return { ok: false as const, status: 404, body: { ok: false, error: "User not found" } };

  return { ok: true as const, user };
}

async function requireHouse(userId: string, houseId: string) {
  const h = await prisma.houseAddress.findFirst({
    where: { id: houseId, userId, archivedAt: null },
    select: { id: true },
  });
  return Boolean(h);
}

export async function GET(request: NextRequest) {
  try {
    const u = await requireUser();
    if (!u.ok) return NextResponse.json(u.body, { status: u.status });

    const url = new URL(request.url);
    const houseId = (url.searchParams.get("houseId") ?? "").trim();
    if (!houseId) {
      return NextResponse.json({ ok: false, error: "houseId_required" }, { status: 400 });
    }

    const owns = await requireHouse(u.user.id, houseId);
    if (!owns) return NextResponse.json({ ok: false, error: "House not found for user" }, { status: 403 });

    const rec = await getManualUsageInputForUserHouse({ userId: u.user.id, houseId });
    const [homeProfile, applianceProfileRec] = await Promise.all([
      getHomeProfileSimulatedByUserHouse({ userId: u.user.id, houseId }),
      getApplianceProfileSimulatedByUserHouse({ userId: u.user.id, houseId }),
    ]);
    const applianceProfile = normalizeStoredApplianceProfile((applianceProfileRec?.appliancesJson as any) ?? null);
    const weatherSensitivity = await resolveSharedWeatherSensitivityEnvelope({
      manualUsagePayload: rec.payload,
      homeProfile,
      applianceProfile,
      weatherHouseId: houseId,
    }).catch(() => ({ score: null, derivedInput: null }));

    return NextResponse.json({
      ok: true,
      houseId,
      payload: rec.payload,
      updatedAt: rec.updatedAt,
      weatherSensitivityScore: weatherSensitivity.score,
      weatherEfficiencyDerivedInput: weatherSensitivity.derivedInput,
    });
  } catch (error) {
    console.error("[user/manual-usage] GET error", error);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const u = await requireUser();
    if (!u.ok) return NextResponse.json(u.body, { status: u.status });

    const body = await request.json().catch(() => ({}));
    const houseId = typeof body?.houseId === "string" ? body.houseId.trim() : "";
    if (!houseId) return NextResponse.json({ ok: false, error: "houseId_required" }, { status: 400 });

    const owns = await requireHouse(u.user.id, houseId);
    if (!owns) return NextResponse.json({ ok: false, error: "House not found for user" }, { status: 403 });

    const payload = body?.payload as ManualUsagePayload | null;
    if (!payload || (payload as any).mode !== "MONTHLY" && (payload as any).mode !== "ANNUAL") {
      return NextResponse.json({ ok: false, error: "payload_required" }, { status: 400 });
    }

    const saved = await saveManualUsageInputForUserHouse({ userId: u.user.id, houseId, payload });
    if (!saved.ok) {
      return NextResponse.json({ ok: false, error: saved.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true, houseId, updatedAt: saved.updatedAt });
  } catch (error) {
    console.error("[user/manual-usage] POST error", error);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

