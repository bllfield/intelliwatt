import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

function jsonError(status: number, error: string, details?: unknown) {
  return NextResponse.json(
    {
      ok: false,
      error,
      ...(details ? { details } : {}),
    },
    { status },
  );
}

export async function POST(req: NextRequest) {
  try {
    const adminToken = process.env.ADMIN_TOKEN;
    if (!adminToken) {
      return jsonError(500, "ADMIN_TOKEN is not configured");
    }

    const headerToken = req.headers.get("x-admin-token");
    if (!headerToken || headerToken !== adminToken) {
      return jsonError(401, "Unauthorized (invalid admin token)");
    }

    let body: { id?: string; resolutionNotes?: string | null; resolvedBy?: string | null };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return jsonError(400, "Invalid JSON body");
    }

    const id = (body.id || "").trim();
    if (!id) {
      return jsonError(400, "Missing required field: id");
    }

    const resolutionNotes =
      typeof body.resolutionNotes === "string" ? body.resolutionNotes.trim() : null;
    const resolvedBy =
      typeof body.resolvedBy === "string" && body.resolvedBy.trim().length > 0
        ? body.resolvedBy.trim()
        : "admin";

    const updated = await (prisma as any).eflParseReviewQueue.update({
      where: { id },
      data: {
        resolvedAt: new Date(),
        resolutionNotes,
        resolvedBy,
      },
    });

    return NextResponse.json({
      ok: true,
      item: updated,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[ADMIN_EFL_REVIEW_RESOLVE] Error resolving EFL review item", error);
    return jsonError(
      500,
      "Failed to resolve EFL review item",
      error instanceof Error ? error.message : String(error),
    );
  }
}


