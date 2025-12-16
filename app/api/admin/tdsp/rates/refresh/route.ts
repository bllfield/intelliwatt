import { NextRequest, NextResponse } from "next/server";

import { fetchTdspJsonFromEnv, normalizeTdspMap, storeTdspSnapshot } from "@/lib/tdsp/fetch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

function jsonError(status: number, error: string, details?: unknown) {
  return NextResponse.json(
    { ok: false, error, ...(details ? { details } : {}) },
    { status },
  );
}

/**
 * POST /api/admin/tdsp/rates/refresh
 * Pull TDSP delivery charges JSON from TDSP_RATE_JSON_URL and store a snapshot in tdspRateSnapshot.
 *
 * Optional query params:
 * - dryRun=1  (fetch + validate but do not write)
 */
export async function POST(req: NextRequest) {
  try {
    if (!ADMIN_TOKEN) return jsonError(500, "ADMIN_TOKEN is not configured");
    const headerToken = req.headers.get("x-admin-token");
    if (!headerToken || headerToken !== ADMIN_TOKEN) {
      return jsonError(401, "Unauthorized (invalid admin token)");
    }

    const dryRun = (req.nextUrl.searchParams.get("dryRun") ?? "") === "1";

    const { url, data } = await fetchTdspJsonFromEnv();
    const normalized = normalizeTdspMap(data);

    if (dryRun) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        sourceUrl: url,
        keys: Object.keys(normalized),
      });
    }

    const stored = await storeTdspSnapshot(url, normalized);
    return NextResponse.json({
      ok: true,
      dryRun: false,
      sourceUrl: url,
      createdCount: Array.isArray(stored.created) ? stored.created.length : 0,
      createdIds: stored.created ?? [],
      keys: Object.keys(normalized),
    });
  } catch (e: any) {
    return jsonError(500, "Failed to refresh TDSP snapshots", {
      message: e?.message ?? String(e),
    });
  }
}


