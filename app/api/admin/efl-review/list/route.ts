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

export async function GET(req: NextRequest) {
  try {
    const adminToken = process.env.ADMIN_TOKEN;
    if (!adminToken) {
      return jsonError(500, "ADMIN_TOKEN is not configured");
    }

    const headerToken = req.headers.get("x-admin-token");
    if (!headerToken || headerToken !== adminToken) {
      return jsonError(401, "Unauthorized (invalid admin token)");
    }

    const { searchParams } = req.nextUrl;
    const statusParam = (searchParams.get("status") || "OPEN").toUpperCase();
    const q = (searchParams.get("q") || "").trim();
    const limitRaw = Number(searchParams.get("limit") || "50");
    const limit = Math.max(1, Math.min(200, Number.isFinite(limitRaw) ? limitRaw : 50));

    const where: any = {};
    if (statusParam === "RESOLVED") {
      where.resolvedAt = { not: null };
    } else {
      // Treat anything else as OPEN.
      where.resolvedAt = null;
    }

    if (q) {
      where.OR = [
        { supplier: { contains: q, mode: "insensitive" } },
        { planName: { contains: q, mode: "insensitive" } },
        { offerId: { contains: q, mode: "insensitive" } },
        { eflPdfSha256: { contains: q, mode: "insensitive" } },
        { eflVersionCode: { contains: q, mode: "insensitive" } },
      ];
    }

    const items = await (prisma as any).eflParseReviewQueue.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    const totalCount = await (prisma as any).eflParseReviewQueue.count({ where });

    return NextResponse.json({
      ok: true,
      status: statusParam === "RESOLVED" ? "RESOLVED" : "OPEN",
      count: items.length,
      totalCount,
      limit,
      items,
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("[ADMIN_EFL_REVIEW_LIST] Error listing EFL review queue", error);
    return jsonError(
      500,
      "Failed to load EFL parse review queue",
      error instanceof Error ? error.message : String(error),
    );
  }
}


