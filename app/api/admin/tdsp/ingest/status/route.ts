import { NextRequest, NextResponse } from "next/server";

import { TdspCode } from "@prisma/client";
import { db } from "@/lib/db";

function jsonError(status: number, error: string, meta?: any) {
  return NextResponse.json(
    {
      ok: false,
      error,
      ...(meta ?? {}),
    },
    { status },
  );
}

export const dynamic = "force-dynamic";

function getAdminToken(): string | null {
  return (
    process.env.TDSP_TARIFF_INGEST_ADMIN_TOKEN || process.env.ADMIN_TOKEN || null
  );
}

export async function GET(req: NextRequest) {
  try {
    const adminToken = getAdminToken();
    if (!adminToken) {
      return jsonError(500, "TDSP_TARIFF_INGEST_ADMIN_TOKEN/ADMIN_TOKEN not configured");
    }

    const headerToken = req.headers.get("x-admin-token")?.trim() || null;
    if (!headerToken || headerToken !== adminToken) {
      return jsonError(401, "Unauthorized (invalid admin token)");
    }

    const lastRun = await (db as any).tdspTariffIngestRun.findFirst({
      orderBy: { createdAt: "desc" },
    });

    const recentRuns = await (db as any).tdspTariffIngestRun.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    const recentTariffVersions = await (db as any).tdspTariffVersion.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        tdsp: true,
      },
    });

    return NextResponse.json({
      ok: true,
      lastRun,
      recentRuns,
      recentTariffVersions,
    });
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : String(err ?? "unknown error");
    return jsonError(500, `Unexpected error: ${msg}`);
  }
}


