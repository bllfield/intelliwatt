import { NextRequest, NextResponse } from "next/server";
import { guardAdmin } from "@/lib/auth/requireAdmin";
import { getCurrentPlanPrisma } from "@/lib/prismaCurrentPlan";

export const dynamic = "force-dynamic";

function jsonError(status: number, error: string, extra?: Record<string, any>) {
  return NextResponse.json({ ok: false, error, ...(extra ?? {}) }, { status });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  const req = _req;
  const unauthorized = guardAdmin(req);
  if (unauthorized) return unauthorized;

  if (!process.env.CURRENT_PLAN_DATABASE_URL) {
    return jsonError(500, "CURRENT_PLAN_DATABASE_URL not configured");
  }

  const params = await Promise.resolve(ctx.params);
  const id = String(params?.id ?? "").trim();
  if (!id) {
    return jsonError(400, "Template id is required");
  }

  try {
    const currentPlanPrisma = getCurrentPlanPrisma() as any;
    const delegate = currentPlanPrisma.billPlanTemplate as any;

    const deleted = await delegate.delete({ where: { id } });
    return NextResponse.json({ ok: true, deleted: { id: String(deleted?.id ?? id) } });
  } catch (e: any) {
    const code = String(e?.code ?? "");
    if (code === "P2025") {
      return jsonError(404, "Template not found", { id });
    }
    return jsonError(500, "Failed to delete template", {
      id,
      code: code || undefined,
      details: String(e?.message ?? e).slice(0, 500),
    });
  }
}

