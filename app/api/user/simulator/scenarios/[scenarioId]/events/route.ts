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
    const kind = typeof body?.kind === "string" ? body.kind.trim() : "MONTHLY_ADJUSTMENT";

    let effectiveMonth = typeof body?.effectiveMonth === "string" ? body.effectiveMonth.trim() : "";
    let payloadJson: Record<string, unknown>;

    if (kind === "UPGRADE_ACTION") {
      const effectiveDate = typeof body?.effectiveDate === "string" ? body.effectiveDate.trim().slice(0, 10) : (body?.payloadJson as any)?.effectiveDate ?? "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate))
        return NextResponse.json({ ok: false, error: "effectiveDate_required" }, { status: 400 });
      effectiveMonth = effectiveDate.slice(0, 7);
      const effectiveEndDate =
        typeof body?.effectiveEndDate === "string" ? body.effectiveEndDate.trim().slice(0, 10) : (body?.payloadJson as any)?.effectiveEndDate ?? undefined;
      payloadJson = {
        ledgerId: typeof body?.ledgerId === "string" ? body.ledgerId.trim() : "",
        upgradeType: typeof body?.upgradeType === "string" ? body.upgradeType.trim() : "",
        changeType: typeof body?.changeType === "string" ? body.changeType.trim() : "",
        quantity: typeof body?.quantity === "number" && Number.isFinite(body.quantity) ? body.quantity : 0,
        units: typeof body?.units === "string" ? body.units.trim() : "",
        effectiveDate,
        ...(effectiveEndDate && /^\d{4}-\d{2}-\d{2}$/.test(effectiveEndDate) ? { effectiveEndDate } : {}),
        before: body?.before && typeof body.before === "object" && body.before !== null ? body.before : {},
        after: body?.after && typeof body.after === "object" && body.after !== null ? body.after : {},
        inputs: body?.inputs && typeof body.inputs === "object" && body.inputs !== null ? body.inputs : {},
        notes: typeof body?.notes === "string" ? body.notes.trim() : "",
      };
    } else if (kind === "TRAVEL_RANGE") {
      const startDate =
        typeof body?.startDate === "string"
          ? body.startDate.trim().slice(0, 10)
          : typeof (body?.payloadJson as any)?.startDate === "string"
            ? (body.payloadJson as any).startDate.trim().slice(0, 10)
            : "";
      const endDate =
        typeof body?.endDate === "string"
          ? body.endDate.trim().slice(0, 10)
          : typeof (body?.payloadJson as any)?.endDate === "string"
            ? (body.payloadJson as any).endDate.trim().slice(0, 10)
            : "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate))
        return NextResponse.json({ ok: false, error: "TRAVEL_RANGE requires both startDate and endDate (YYYY-MM-DD)" }, { status: 400 });
      effectiveMonth = startDate.slice(0, 7);
      payloadJson = { startDate, endDate };
    } else {
      const multiplier = typeof body?.multiplier === "number" && Number.isFinite(body.multiplier) ? body.multiplier : undefined;
      const adderKwh = typeof body?.adderKwh === "number" && Number.isFinite(body.adderKwh) ? body.adderKwh : undefined;
      payloadJson = { multiplier, adderKwh };
    }

    if (!houseId) return NextResponse.json({ ok: false, error: "houseId_required" }, { status: 400 });
    if (!scenarioId) return NextResponse.json({ ok: false, error: "scenarioId_required" }, { status: 400 });
    if (!effectiveMonth && kind !== "TRAVEL_RANGE") return NextResponse.json({ ok: false, error: "effectiveMonth_required" }, { status: 400 });

    const out = await addScenarioEvent({ userId: u.user.id, houseId, scenarioId, effectiveMonth, kind, payloadJson });
    if (!out.ok) return NextResponse.json(out, { status: 400 });
    return NextResponse.json(out);
  } catch (e) {
    console.error("[user/simulator/scenarios/:id/events] POST failed", e);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

