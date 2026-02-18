import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/utils/email";
import { deleteScenarioEvent, updateScenarioEvent } from "@/modules/usageSimulator/service";

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

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ scenarioId: string; eventId: string }> }) {
  try {
    const u = await requireUser();
    if (!u.ok) return NextResponse.json(u.body, { status: u.status });

    const { scenarioId, eventId } = await ctx.params;
    const body = await request.json().catch(() => ({}));
    const houseId = typeof body?.houseId === "string" ? body.houseId.trim() : "";
    if (!houseId) return NextResponse.json({ ok: false, error: "houseId_required" }, { status: 400 });

    const effectiveMonth = typeof body?.effectiveMonth === "string" ? body.effectiveMonth.trim() : undefined;
    const kind = typeof body?.kind === "string" ? body.kind.trim() : undefined;
    const multiplier = typeof body?.multiplier === "number" && Number.isFinite(body.multiplier) ? body.multiplier : undefined;
    const adderKwh = typeof body?.adderKwh === "number" && Number.isFinite(body.adderKwh) ? body.adderKwh : undefined;

    const payloadJson = body?.payloadJson !== undefined ? body.payloadJson : { multiplier, adderKwh };

    const out = await updateScenarioEvent({ userId: u.user.id, houseId, scenarioId, eventId, effectiveMonth, kind, payloadJson });
    if (!out.ok) return NextResponse.json(out, { status: 400 });
    return NextResponse.json(out);
  } catch (e) {
    console.error("[user/simulator/scenarios/:id/events/:eventId] PATCH failed", e);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, ctx: { params: Promise<{ scenarioId: string; eventId: string }> }) {
  try {
    const u = await requireUser();
    if (!u.ok) return NextResponse.json(u.body, { status: u.status });

    const { scenarioId, eventId } = await ctx.params;
    const { searchParams } = new URL(request.url);
    const houseId = String(searchParams.get("houseId") ?? "").trim();
    if (!houseId) return NextResponse.json({ ok: false, error: "houseId_required" }, { status: 400 });

    const out = await deleteScenarioEvent({ userId: u.user.id, houseId, scenarioId, eventId });
    if (!out.ok) return NextResponse.json(out, { status: 400 });
    return NextResponse.json(out);
  } catch (e) {
    console.error("[user/simulator/scenarios/:id/events/:eventId] DELETE failed", e);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

