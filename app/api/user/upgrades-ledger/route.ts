import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/utils/email";
import { listLedger, createLedger } from "@/modules/upgradesLedger/service";

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

async function resolveHouseId(userId: string, houseIdRaw: string | null): Promise<string | null> {
  const prismaAny = prisma as any;
  if (houseIdRaw && houseIdRaw.trim()) {
    const h = await prismaAny.houseAddress.findFirst({
      where: { id: houseIdRaw.trim(), userId, archivedAt: null },
      select: { id: true },
    });
    return h?.id ?? null;
  }
  return null;
}

export async function GET(request: NextRequest) {
  try {
    const u = await requireUser();
    if (!u.ok) return NextResponse.json(u.body, { status: u.status });

    const url = new URL(request.url);
    const houseIdParam = url.searchParams.get("houseId");
    const scenarioIdParam = url.searchParams.get("scenarioId");
    const houseId = houseIdParam ? await resolveHouseId(u.user.id, houseIdParam) ?? undefined : undefined;
    const scenarioId = scenarioIdParam && scenarioIdParam.trim() ? scenarioIdParam.trim() : undefined;

    const result = await listLedger(u.user.id, { houseId, scenarioId });
    if (!result.ok) {
      const status = result.error.startsWith("upgrades_db_") ? 503 : 400;
      return NextResponse.json({ ok: false, error: result.error, message: result.message }, { status });
    }
    return NextResponse.json({ ok: true, data: result.data });
  } catch (e) {
    console.error("[user/upgrades-ledger] GET failed", e);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const u = await requireUser();
    if (!u.ok) return NextResponse.json(u.body, { status: u.status });

    const body = await request.json().catch(() => ({}));
    const houseIdParam = typeof body?.houseId === "string" ? body.houseId : null;
    const houseId = houseIdParam ? await resolveHouseId(u.user.id, houseIdParam) ?? undefined : undefined;
    const payload = { ...body, houseId };

    const result = await createLedger(u.user.id, payload);
    if (!result.ok) {
      const status = result.error.startsWith("upgrades_db_") ? 503 : 400;
      return NextResponse.json({ ok: false, error: result.error, message: result.message }, { status });
    }
    return NextResponse.json({ ok: true, data: result.data });
  } catch (e) {
    console.error("[user/upgrades-ledger] POST failed", e);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
