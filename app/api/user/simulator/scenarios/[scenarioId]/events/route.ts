import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/utils/email";
import { addScenarioEvent, listScenarioEvents } from "@/modules/usageSimulator/service";

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

export async function GET(request: NextRequest, ctx: { params: Promise<{ scenarioId: string }> }) {
  try {
    const u = await requireUser();
    if (!u.ok) return NextResponse.json(u.body, { status: u.status });

    const { scenarioId } = await ctx.params;
    const { searchParams } = new URL(request.url);
    const houseId = String(searchParams.get("houseId") ?? "").trim();
    if (!houseId) return NextResponse.json({ ok: false, error: "houseId_required" }, { status: 400 });
    if (!scenarioId) return NextResponse.json({ ok: false, error: "scenarioId_required" }, { status: 400 });

    const out = await listScenarioEvents({ userId: u.user.id, houseId, scenarioId });
    if (!out.ok) return NextResponse.json(out, { status: 400 });
    return NextResponse.json(out);
  } catch (e) {
    console.error("[user/simulator/scenarios/:id/events] GET failed", e);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ scenarioId: string }> }) {
  try {
    const u = await requireUser();
    if (!u.ok) return NextResponse.json(u.body, { status: u.status });

    const { scenarioId } = await ctx.params;
    const body = await request.json().catch(() => ({}));
    const houseId = typeof body?.houseId === "string" ? body.houseId.trim() : "";
    const effectiveMonth = typeof body?.effectiveMonth === "string" ? body.effectiveMonth.trim() : "";
    const kind = typeof body?.kind === "string" ? body.kind.trim() : "MONTHLY_ADJUSTMENT";

    const multiplier = typeof body?.multiplier === "number" && Number.isFinite(body.multiplier) ? body.multiplier : undefined;
    const adderKwh = typeof body?.adderKwh === "number" && Number.isFinite(body.adderKwh) ? body.adderKwh : undefined;

    if (!houseId) return NextResponse.json({ ok: false, error: "houseId_required" }, { status: 400 });
    if (!scenarioId) return NextResponse.json({ ok: false, error: "scenarioId_required" }, { status: 400 });
    if (!effectiveMonth) return NextResponse.json({ ok: false, error: "effectiveMonth_required" }, { status: 400 });

    const payloadJson =
      kind === "TRAVEL_RANGE"
        ? {
            startDate:
              typeof body?.startDate === "string"
                ? body.startDate.trim()
                : typeof body?.payloadJson?.startDate === "string"
                  ? body.payloadJson.startDate.trim()
                  : "",
            endDate:
              typeof body?.endDate === "string"
                ? body.endDate.trim()
                : typeof body?.payloadJson?.endDate === "string"
                  ? body.payloadJson.endDate.trim()
                  : "",
          }
        : { multiplier, adderKwh };
    const out = await addScenarioEvent({ userId: u.user.id, houseId, scenarioId, effectiveMonth, kind, payloadJson });
    if (!out.ok) return NextResponse.json(out, { status: 400 });
    return NextResponse.json(out);
  } catch (e) {
    console.error("[user/simulator/scenarios/:id/events] POST failed", e);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

