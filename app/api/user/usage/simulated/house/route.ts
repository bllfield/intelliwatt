import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/utils/email";
import { getSimulatedUsageForHouseScenario } from "@/modules/usageSimulator/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function requireUser() {
  const cookieStore = cookies();
  const rawEmail = cookieStore.get("intelliwatt_user")?.value;
  if (!rawEmail) return { ok: false as const, status: 401, body: { ok: false, error: "Not authenticated" } };
  const userEmail = normalizeEmail(rawEmail);
  const user = await prisma.user.findUnique({ where: { email: userEmail }, select: { id: true } });
  if (!user) return { ok: false as const, status: 404, body: { ok: false, error: "User not found" } };
  return { ok: true as const, user };
}

export async function GET(request: NextRequest) {
  try {
    const u = await requireUser();
    if (!u.ok) return NextResponse.json(u.body, { status: u.status });

    const { searchParams } = new URL(request.url);
    const houseId = String(searchParams.get("houseId") ?? "").trim();
    const scenarioIdRaw = searchParams.get("scenarioId");
    const scenarioId = scenarioIdRaw == null ? null : String(scenarioIdRaw).trim();

    if (!houseId) return NextResponse.json({ ok: false, error: "houseId_required" }, { status: 400 });

    const out = await getSimulatedUsageForHouseScenario({ userId: u.user.id, houseId, scenarioId });
    // Past/Future: never cache so each open uses latest state (e.g. Future always sees latest Past).
    const cacheControl = scenarioId ? "private, no-store" : "private, max-age=30";
    if (out.ok) return NextResponse.json(out, { headers: { "Cache-Control": cacheControl } });

    if (out.code === "NO_BUILD") return NextResponse.json(out, { status: 404 });
    if (out.code === "HOUSE_NOT_FOUND") return NextResponse.json(out, { status: 403 });
    if (out.code === "SCENARIO_NOT_FOUND") return NextResponse.json(out, { status: 404 });
    return NextResponse.json(out, { status: 500 });
  } catch (e) {
    console.error("[user/usage/simulated/house] failed", e);
    return NextResponse.json({ ok: false, code: "INTERNAL_ERROR", message: "Internal error" }, { status: 500 });
  }
}

