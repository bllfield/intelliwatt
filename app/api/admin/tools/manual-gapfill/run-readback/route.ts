import { NextRequest, NextResponse } from "next/server";
import { buildManualGapfillRunReadbackResult } from "@/modules/manualUsage/manualGapfillRunReadback";
import type { ManualGapfillSeedMode } from "@/modules/manualUsage/manualGapfillSeed";
import type { WeatherPreference } from "@/modules/weatherNormalization/normalizer";
import { getMemoryRssMb, logSimPipelineEvent } from "@/modules/usageSimulator/simObservability";
import { gateManualGapfillAdmin } from "../_helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const MODES: ManualGapfillSeedMode[] = ["MONTHLY_FROM_SOURCE_INTERVALS", "ANNUAL_FROM_SOURCE_INTERVALS"];
const WEATHER: WeatherPreference[] = ["LAST_YEAR_WEATHER", "LONG_TERM_AVERAGE"];

function normalizeWeatherPreference(value: unknown): WeatherPreference | undefined {
  if (typeof value !== "string") return undefined;
  if (value === "LONG_TERM_NORMAL") return "LONG_TERM_AVERAGE";
  return WEATHER.includes(value as WeatherPreference) ? (value as WeatherPreference) : undefined;
}

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
    const weatherPreference = normalizeWeatherPreference(body.weatherPreference);
    const validationDayCount =
      typeof body.validationDayCount === "number" && Number.isFinite(body.validationDayCount)
        ? body.validationDayCount
        : undefined;
    const validationSelectionMode =
      typeof body.validationSelectionMode === "string" ? body.validationSelectionMode : undefined;
    const expectedSeedHash = typeof body.expectedSeedHash === "string" ? body.expectedSeedHash : null;
    const expectedSourceFingerprint =
      typeof body.expectedSourceFingerprint === "string" ? body.expectedSourceFingerprint : null;
    const expectedValidationDayPolicyHash =
      typeof body.expectedValidationDayPolicyHash === "string"
        ? body.expectedValidationDayPolicyHash
        : null;
    const persistRequested = body.persistRequested !== false;
    const includeDiagnostics = body.includeDiagnostics === true;

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

    const result = await buildManualGapfillRunReadbackResult({
      userId,
      sourceHouseId,
      labHouseId,
      mode,
      esiid,
      scenarioId,
      weatherPreference,
      validationDayCount,
      validationSelectionMode,
      expectedSeedHash,
      expectedSourceFingerprint,
      expectedValidationDayPolicyHash,
      persistRequested,
      includeDiagnostics,
    });

    const payload = { ok: result.ok, result };
    let responseApproxSizeKb: number | null = null;
    try {
      responseApproxSizeKb = Math.round(Buffer.byteLength(JSON.stringify(payload), "utf8") / 1024);
    } catch {
      responseApproxSizeKb = null;
    }

    logSimPipelineEvent("manual_gapfill_run_readback_response_ready", {
      houseId: labHouseId,
      sourceHouseId,
      ok: result.ok,
      status: result.status,
      responseApproxSizeKb,
      memoryRssMb: getMemoryRssMb(),
      source: "manual-gapfill/run-readback/route",
    });

    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "manual_gapfill_run_readback_failed",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
