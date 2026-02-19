import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/utils/email";
import { recalcSimulatorBuild } from "@/modules/usageSimulator/service";
import type { SimulatorMode } from "@/modules/usageSimulator/requirements";
import type { WeatherPreference } from "@/modules/weatherNormalization/normalizer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function requireUser() {
  const cookieStore = cookies();
  const rawEmail = cookieStore.get("intelliwatt_user")?.value ?? null;
  if (!rawEmail) return { ok: false as const, status: 401, body: { ok: false, error: "Not authenticated" } };
  const email = normalizeEmail(rawEmail);
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) return { ok: false as const, status: 404, body: { ok: false, error: "User not found" } };
  return { ok: true as const, user };
}

async function requireHouse(userId: string, houseId: string) {
  const h = await prisma.houseAddress.findFirst({
    where: { id: houseId, userId, archivedAt: null },
    select: { id: true, esiid: true },
  });
  return h ?? null;
}

export async function POST(request: NextRequest) {
  try {
    const u = await requireUser();
    if (!u.ok) return NextResponse.json(u.body, { status: u.status });

    const body = await request.json().catch(() => ({}));
    const houseId = typeof body?.houseId === "string" ? body.houseId.trim() : "";
    const mode = typeof body?.mode === "string" ? (body.mode.trim() as SimulatorMode) : null;
    const scenarioId = typeof body?.scenarioId === "string" ? body.scenarioId.trim() : null;
    const weatherPreferenceRaw = typeof body?.weatherPreference === "string" ? body.weatherPreference.trim() : "";
    const weatherPreference: WeatherPreference | undefined =
      weatherPreferenceRaw === "NONE" || weatherPreferenceRaw === "LAST_YEAR_WEATHER" || weatherPreferenceRaw === "LONG_TERM_AVERAGE"
        ? (weatherPreferenceRaw as WeatherPreference)
        : undefined;
    if (!houseId) return NextResponse.json({ ok: false, error: "houseId_required" }, { status: 400 });
    if (mode !== "MANUAL_TOTALS" && mode !== "NEW_BUILD_ESTIMATE" && mode !== "SMT_BASELINE") {
      return NextResponse.json({ ok: false, error: "mode_invalid" }, { status: 400 });
    }

    const house = await requireHouse(u.user.id, houseId);
    if (!house) return NextResponse.json({ ok: false, error: "House not found for user" }, { status: 403 });
    const out = await recalcSimulatorBuild({
      userId: u.user.id,
      houseId,
      esiid: house.esiid ?? null,
      mode,
      scenarioId,
      weatherPreference,
    });
    if (!out.ok) return NextResponse.json(out, { status: 400 });
    return NextResponse.json(out);
  } catch (e) {
    console.error("[user/simulator/recalc] failed", e);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

