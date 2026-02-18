import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/utils/email";
import { archiveScenario, renameScenario } from "@/modules/usageSimulator/service";

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

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ scenarioId: string }> }) {
  try {
    const u = await requireUser();
    if (!u.ok) return NextResponse.json(u.body, { status: u.status });

    const { scenarioId } = await ctx.params;
    const body = await request.json().catch(() => ({}));
    const houseId = typeof body?.houseId === "string" ? body.houseId.trim() : "";
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!houseId) return NextResponse.json({ ok: false, error: "houseId_required" }, { status: 400 });
    if (!scenarioId) return NextResponse.json({ ok: false, error: "scenarioId_required" }, { status: 400 });
    if (!name) return NextResponse.json({ ok: false, error: "name_required" }, { status: 400 });

    const out = await renameScenario({ userId: u.user.id, houseId, scenarioId, name });
    if (!out.ok) return NextResponse.json(out, { status: 400 });
    return NextResponse.json(out);
  } catch (e) {
    console.error("[user/simulator/scenarios/:id] PATCH failed", e);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, ctx: { params: Promise<{ scenarioId: string }> }) {
  try {
    const u = await requireUser();
    if (!u.ok) return NextResponse.json(u.body, { status: u.status });

    const { scenarioId } = await ctx.params;
    const { searchParams } = new URL(request.url);
    const houseId = String(searchParams.get("houseId") ?? "").trim();
    if (!houseId) return NextResponse.json({ ok: false, error: "houseId_required" }, { status: 400 });
    if (!scenarioId) return NextResponse.json({ ok: false, error: "scenarioId_required" }, { status: 400 });

    const out = await archiveScenario({ userId: u.user.id, houseId, scenarioId });
    if (!out.ok) return NextResponse.json(out, { status: 400 });
    return NextResponse.json(out);
  } catch (e) {
    console.error("[user/simulator/scenarios/:id] DELETE failed", e);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

