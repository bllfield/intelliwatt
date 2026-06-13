import { NextRequest, NextResponse } from "next/server";
import { compareManualGapfillSourceActualToLabSim } from "@/modules/manualUsage/manualGapfillCompare";
import type { ManualGapfillSeedMode } from "@/modules/manualUsage/manualGapfillSeed";
import { getMemoryRssMb, logSimPipelineEvent } from "@/modules/usageSimulator/simObservability";
import { gateManualGapfillAdmin } from "../_helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const MODES: ManualGapfillSeedMode[] = ["MONTHLY_FROM_SOURCE_INTERVALS", "ANNUAL_FROM_SOURCE_INTERVALS"];
const COMPARE_STAGE_TIMEOUT_MS = 90_000;

class ManualGapfillCompareTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`manual_gapfill_compare_timed_out_after_${timeoutMs}ms`);
    this.name = "ManualGapfillCompareTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

async function withManualGapfillCompareTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new ManualGapfillCompareTimeoutError(timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function POST(request: NextRequest) {
  const denied = gateManualGapfillAdmin(request);
  if (denied) return denied;

  const routeStartedAt = Date.now();

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

    logSimPipelineEvent("manual_gapfill_compare_route_start", {
      houseId: labHouseId,
      sourceHouseId,
      mode,
      includeDailyRows,
      includeDiagnostics,
      timeoutMs: COMPARE_STAGE_TIMEOUT_MS,
      memoryRssMb: getMemoryRssMb(),
      source: "manual-gapfill/compare/route",
    });

    const result = await withManualGapfillCompareTimeout(
      compareManualGapfillSourceActualToLabSim({
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
      }),
      COMPARE_STAGE_TIMEOUT_MS
    );

    logSimPipelineEvent("manual_gapfill_compare_route_envelope_ready", {
      houseId: labHouseId,
      sourceHouseId,
      ok: result.ok,
      status: result.status,
      dailyRowCount: Array.isArray(result.compare?.dailyRows) ? result.compare.dailyRows.length : 0,
      diagnosticsV1Built: Boolean(result.diagnosticsV1),
      durationMs: Date.now() - routeStartedAt,
      memoryRssMb: getMemoryRssMb(),
      source: "manual-gapfill/compare/route",
    });

    const payload = { ok: result.ok, result };
    let responseApproxSizeKb: number | null = null;
    try {
      responseApproxSizeKb = Math.round(Buffer.byteLength(JSON.stringify(payload), "utf8") / 1024);
    } catch {
      responseApproxSizeKb = null;
    }

    logSimPipelineEvent("manual_gapfill_compare_response_ready", {
      houseId: labHouseId,
      sourceHouseId,
      ok: result.ok,
      status: result.status,
      responseApproxSizeKb,
      durationMs: Date.now() - routeStartedAt,
      memoryRssMb: getMemoryRssMb(),
      source: "manual-gapfill/compare/route",
    });

    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof ManualGapfillCompareTimeoutError) {
      logSimPipelineEvent("manual_gapfill_compare_route_timeout", {
        timeoutMs: error.timeoutMs,
        durationMs: Date.now() - routeStartedAt,
        memoryRssMb: getMemoryRssMb(),
        source: "manual-gapfill/compare/route",
      });
      return NextResponse.json(
        {
          ok: false,
          error: "manual_gapfill_compare_timeout",
          message: `Compare did not finish within ${Math.round(error.timeoutMs / 1000)}s.`,
        },
        { status: 504 }
      );
    }

    logSimPipelineEvent("manual_gapfill_compare_route_failure", {
      durationMs: Date.now() - routeStartedAt,
      message: error instanceof Error ? error.message : String(error),
      memoryRssMb: getMemoryRssMb(),
      source: "manual-gapfill/compare/route",
    });

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
