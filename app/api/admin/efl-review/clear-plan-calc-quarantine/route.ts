import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

function jsonError(status: number, error: string, details?: unknown) {
  return NextResponse.json({ ok: false, error, ...(details ? { details } : {}) }, { status });
}

type Body = {
  confirm?: string | null;
  resolvedBy?: string | null;
  resolutionNotes?: string | null;
};

export async function POST(req: NextRequest) {
  try {
    const adminToken = process.env.ADMIN_TOKEN;
    if (!adminToken) return jsonError(500, "ADMIN_TOKEN is not configured");

    const headerToken = req.headers.get("x-admin-token");
    if (!headerToken || headerToken !== adminToken) {
      return jsonError(401, "Unauthorized (invalid admin token)");
    }

    let body: Body;
    try {
      body = (await req.json()) as Body;
    } catch {
      return jsonError(400, "Invalid JSON body");
    }

    const confirm = String(body.confirm ?? "").trim();
    if (confirm !== "CLEAR_PLAN_CALC_QUARANTINE") {
      return jsonError(400, "Missing confirmation (type CLEAR_PLAN_CALC_QUARANTINE)", {
        expected: "CLEAR_PLAN_CALC_QUARANTINE",
      });
    }

    const resolvedBy =
      typeof body.resolvedBy === "string" && body.resolvedBy.trim().length > 0
        ? body.resolvedBy.trim()
        : "admin_bulk_clear";
    const resolutionNotes =
      typeof body.resolutionNotes === "string" && body.resolutionNotes.trim().length > 0
        ? body.resolutionNotes.trim()
        : "Bulk cleared by admin.";

    const now = new Date();

    const r = await (prisma as any).eflParseReviewQueue.updateMany({
      where: { kind: "PLAN_CALC_QUARANTINE", resolvedAt: null },
      data: {
        resolvedAt: now,
        resolvedBy,
        resolutionNotes,
      },
    });

    return NextResponse.json({
      ok: true,
      clearedCount: Number((r as any)?.count ?? 0) || 0,
      resolvedAt: now.toISOString(),
    });
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.error("[ADMIN_EFL_REVIEW_CLEAR_PLAN_CALC_QUARANTINE] Error", e);
    return jsonError(500, "Failed to clear PLAN_CALC_QUARANTINE", {
      message: e instanceof Error ? e.message : String(e),
    });
  }
}


