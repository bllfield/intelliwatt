import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/utils/email";
import { updateLedger, softDeleteLedger } from "@/modules/upgradesLedger/service";

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

export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const u = await requireUser();
    if (!u.ok) return NextResponse.json(u.body, { status: u.status });

    const { id } = await ctx.params;
    const body = await request.json().catch(() => ({}));

    const result = await updateLedger(u.user.id, id, body);
    if (!result.ok) {
      const status = result.error.startsWith("upgrades_db_") ? 503 : 400;
      return NextResponse.json({ ok: false, error: result.error, message: result.message }, { status });
    }
    return NextResponse.json({ ok: true, data: result.data });
  } catch (e) {
    console.error("[user/upgrades-ledger/:id] PATCH failed", e);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const u = await requireUser();
    if (!u.ok) return NextResponse.json(u.body, { status: u.status });

    const { id } = await ctx.params;

    const result = await softDeleteLedger(u.user.id, id);
    if (!result.ok) {
      const status = result.error.startsWith("upgrades_db_") ? 503 : 400;
      return NextResponse.json({ ok: false, error: result.error, message: result.message }, { status });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[user/upgrades-ledger/:id] DELETE failed", e);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
