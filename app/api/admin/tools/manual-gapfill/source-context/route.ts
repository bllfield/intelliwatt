import { NextRequest, NextResponse } from "next/server";
import { resolveManualGapfillSmtSourceContext } from "@/modules/manualUsage/manualGapfillSourceContext";
import { gateManualGapfillAdmin } from "../_helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
    const sourceHouseId = String(body.sourceHouseId ?? "").trim();
    const userId = String(body.userId ?? "").trim();
    const esiid = typeof body.esiid === "string" ? body.esiid : null;
    const includeDiagnostics = body.includeDiagnostics === true;
    const window = normalizeWindow(body);

    if (!sourceHouseId || !userId) {
      return NextResponse.json(
        { ok: false, error: "sourceHouseId and userId are required." },
        { status: 400 }
      );
    }

    const context = await resolveManualGapfillSmtSourceContext({
      sourceHouseId,
      userId,
      esiid,
      window,
      includeDiagnostics,
    });

    return NextResponse.json({ ok: true, context });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "manual_gapfill_source_context_failed",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
