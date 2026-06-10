import { NextRequest, NextResponse } from "next/server";
import { compareManualGapfillSourceActualToLabSim } from "@/modules/manualUsage/manualGapfillCompare";
import type { ManualGapfillSeedMode } from "@/modules/manualUsage/manualGapfillSeed";
import { gateManualGapfillAdmin } from "../_helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MODES: ManualGapfillSeedMode[] = ["MONTHLY_FROM_SOURCE_INTERVALS", "ANNUAL_FROM_SOURCE_INTERVALS"];

export async function POST(request: NextRequest) {
  const denied = gateManualGapfillAdmin(request);
  if (denied) return denied;

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const userId = String(body.userId ?? "").trim();
    const sourceHouseId = String(body.sourceHouseId ?? "").trim();
    const labHouseId = String(body.labHouseId ?? "").trim();
    const mode = String(body.mode ?? "").trim() as ManualGapfillSeedMode;
    const esiid = typeof body.esiid === "string" ? body.esiid : null;
    const scenarioId = typeof body.scenarioId === "string" ? body.scenarioId : null;
    const expectedSeedHash = typeof body.expectedSeedHash === "string" ? body.expectedSeedHash : null;
    const expectedSourceFingerprint =
      typeof body.expectedSourceFingerprint === "string" ? body.expectedSourceFingerprint : null;
    const expectedValidationDayPolicyHash =
      typeof body.expectedValidationDayPolicyHash === "string"
        ? body.expectedValidationDayPolicyHash
        : null;
    const expectedArtifactInputHash =
      typeof body.expectedArtifactInputHash === "string" ? body.expectedArtifactInputHash : null;
    const includeDailyRows = body.includeDailyRows === true;
    const includeDiagnostics = body.includeDiagnostics !== false;

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

    const result = await compareManualGapfillSourceActualToLabSim({
      userId,
      sourceHouseId,
      labHouseId,
      mode,
      esiid,
      scenarioId,
      expectedSeedHash,
      expectedSourceFingerprint,
      expectedValidationDayPolicyHash,
      expectedArtifactInputHash,
      includeDailyRows,
      includeDiagnostics,
    });

    return NextResponse.json({ ok: result.ok, result });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "manual_gapfill_compare_failed",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
