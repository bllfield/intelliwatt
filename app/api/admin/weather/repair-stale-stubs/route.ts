import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { repairStaleStubWeather } from "@/modules/weather/backfill";

export const dynamic = "force-dynamic";

/**
 * Admin-only: repair stale ACTUAL_LAST_YEAR STUB_V1 weather rows for a house.
 * Deletes stub rows in range and reruns backfill. Safe to rerun.
 * POST body: { houseId: string, startDate?: string, endDate?: string }
 */
export async function POST(req: NextRequest) {
  const gate = requireAdmin(req);
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  try {
    const body = await req.json().catch(() => ({}));
    const houseId = typeof body?.houseId === "string" ? body.houseId.trim() : "";
    const startDate = typeof body?.startDate === "string" ? body.startDate.trim().slice(0, 10) : undefined;
    const endDate = typeof body?.endDate === "string" ? body.endDate.trim().slice(0, 10) : undefined;

    if (!houseId) {
      return NextResponse.json(
        { ok: false, error: "houseId is required." },
        { status: 400 }
      );
    }

    const result = await repairStaleStubWeather({
      houseId,
      startDate: startDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate) ? startDate : undefined,
      endDate: endDate && /^\d{4}-\d{2}-\d{2}$/.test(endDate) ? endDate : undefined,
    });

    return NextResponse.json({
      ok: true,
      deleted: result.deleted,
      fetched: result.fetched,
      stubbed: result.stubbed,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }
}
