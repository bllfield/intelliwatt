import { NextRequest, NextResponse } from "next/server";
import {
  resolveManualGapfillSeedFromSourceContext,
  type ManualGapfillSeedMode,
} from "@/modules/manualUsage/manualGapfillSeed";
import { gateManualGapfillAdmin } from "../_helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MODES: ManualGapfillSeedMode[] = ["MONTHLY_FROM_SOURCE_INTERVALS", "ANNUAL_FROM_SOURCE_INTERVALS"];

function normalizeWindow(body: Record<string, unknown>) {
  const window = body.window;
  if (!window || typeof window !== "object" || Array.isArray(window)) return null;
  const startDate = String((window as Record<string, unknown>).startDate ?? "").slice(0, 10);
  const endDate = String((window as Record<string, unknown>).endDate ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return null;
  return { startDate, endDate };
}

export async function POST(request: NextRequest) {
  const denied = gateManualGapfillAdmin(request);
  if (denied) return denied;

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const userId = String(body.userId ?? "").trim();
    const sourceHouseId = String(body.sourceHouseId ?? "").trim();
    const labHouseId = String(body.labHouseId ?? "").trim();
    const esiid = typeof body.esiid === "string" ? body.esiid : null;
    const mode = String(body.mode ?? "").trim() as ManualGapfillSeedMode;
    const persistToLabHome = body.persistToLabHome === true;
    const includeDiagnostics = body.includeDiagnostics === true;
    const anchorEndDate = typeof body.anchorEndDate === "string" ? body.anchorEndDate : null;
    const window = normalizeWindow(body);

    if (!userId || !sourceHouseId || !labHouseId) {
      return NextResponse.json(
        { ok: false, error: "userId, sourceHouseId, and labHouseId are required." },
        { status: 400 }
      );
    }
    if (!MODES.includes(mode)) {
      return NextResponse.json(
        { ok: false, error: "mode must be MONTHLY_FROM_SOURCE_INTERVALS or ANNUAL_FROM_SOURCE_INTERVALS." },
        { status: 400 }
      );
    }

    const result = await resolveManualGapfillSeedFromSourceContext({
      userId,
      sourceHouseId,
      labHouseId,
      esiid,
      mode,
      window,
      anchorEndDate,
      persistToLabHome,
      includeDiagnostics,
    });

    return NextResponse.json({ ok: result.ok, result });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "manual_gapfill_prepare_seed_failed",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
