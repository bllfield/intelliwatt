import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/utils/email";
import { getSimulatorRequirements } from "@/modules/usageSimulator/service";
import type { SimulatorMode } from "@/modules/usageSimulator/requirements";

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

export async function GET(request: NextRequest) {
  try {
    const u = await requireUser();
    if (!u.ok) return NextResponse.json(u.body, { status: u.status });

    const { searchParams } = new URL(request.url);
    const houseId = String(searchParams.get("houseId") ?? "").trim();
    const mode = String(searchParams.get("mode") ?? "").trim() as SimulatorMode;
    if (!houseId) return NextResponse.json({ ok: false, error: "houseId_required" }, { status: 400 });
    if (mode !== "MANUAL_TOTALS" && mode !== "NEW_BUILD_ESTIMATE" && mode !== "SMT_BASELINE") {
      return NextResponse.json({ ok: false, error: "mode_invalid" }, { status: 400 });
    }

    const out = await getSimulatorRequirements({ userId: u.user.id, houseId, mode });
    if (!out.ok) return NextResponse.json(out, { status: 400 });
    return NextResponse.json(out);
  } catch (e) {
    console.error("[user/simulator/requirements] failed", e);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

