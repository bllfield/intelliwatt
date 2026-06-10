import { NextRequest, NextResponse } from "next/server";
import {
  getValidationDayPolicySnapshot,
  previewGlobalValidationDaySelection,
} from "@/lib/usage/validationDayPolicy";
import { gateManualGapfillAdmin } from "@/app/api/admin/tools/manual-gapfill/_helpers";

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

export async function GET(request: NextRequest) {
  const denied = gateManualGapfillAdmin(request);
  if (denied) return denied;

  const surfaceParam = request.nextUrl.searchParams.get("surface");
  const surface = surfaceParam === "user_site" ? "user_site" : "admin_lab";
  return NextResponse.json(getValidationDayPolicySnapshot({ surface }));
}

export async function POST(request: NextRequest) {
  const denied = gateManualGapfillAdmin(request);
  if (denied) return denied;

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const houseId = String(body.houseId ?? body.sourceHouseId ?? "").trim();
    const userId = String(body.userId ?? "").trim();
    const esiid = typeof body.esiid === "string" ? body.esiid : null;
    const mode = typeof body.mode === "string" ? body.mode : null;
    const validationDayCount =
      body.validationDayCount == null ? null : Math.floor(Number(body.validationDayCount));
    const window = normalizeWindow(body);
    const surface = body.surface === "user_site" ? "user_site" : "admin_lab";

    if (!houseId || !userId) {
      return NextResponse.json({ ok: false, error: "houseId and userId are required." }, { status: 400 });
    }

    const preview = await previewGlobalValidationDaySelection({
      houseId,
      userId,
      esiid,
      sourceHouseId: typeof body.sourceHouseId === "string" ? body.sourceHouseId : houseId,
      window,
      validationDayCount: Number.isFinite(validationDayCount) ? validationDayCount : null,
      mode,
      surface,
    });

    return NextResponse.json(preview);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "validation_day_policy_preview_failed",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
