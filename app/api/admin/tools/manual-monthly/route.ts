import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { lookupAdminHousesByEmail } from "@/lib/admin/adminHouseLookup";
import { prisma } from "@/lib/db";
import { saveManualUsageInputForUserHouse, getManualUsageInputForUserHouse } from "@/modules/manualUsage/store";
import type { ManualUsagePayload } from "@/modules/simulatedUsage/types";
import { dispatchPastSimRecalc } from "@/modules/usageSimulator/pastSimRecalcDispatch";
import { getUserDefaultValidationSelectionMode, getSimulatedUsageForHouseScenario } from "@/modules/usageSimulator/service";
import { resolveUserValidationPolicy } from "@/modules/usageSimulator/pastSimPolicy";
import { resolveUserWeatherLogicSetting } from "@/modules/usageSimulator/pastSimWeatherPolicy";
import { buildValidationCompareProjectionSidecar } from "@/modules/usageSimulator/compareProjection";
import { buildSharedPastSimDiagnostics } from "@/modules/usageSimulator/sharedDiagnostics";
import { buildManualMonthlyReconciliation } from "@/modules/manualUsage/reconciliation";
import type { WeatherPreference } from "@/modules/weatherNormalization/normalizer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const WORKSPACE_PAST_NAME = "Past (Corrected)";

async function resolveUserAndHouse(emailRaw: string, preferredHouseId?: string | null) {
  const lookup = await lookupAdminHousesByEmail(String(emailRaw ?? ""));
  if (!lookup.ok) {
    return { ok: false as const, error: lookup.error };
  }
  const selectedHouse =
    lookup.houses.find((house) => house.id === String(preferredHouseId ?? "").trim()) ??
    lookup.houses[0] ??
    null;
  if (!selectedHouse) return { ok: false as const, error: "house_not_found" };
  return {
    ok: true as const,
    email: lookup.email,
    userId: lookup.userId,
    houses: lookup.houses,
    selectedHouse,
  };
}

async function findPastScenarioId(args: { userId: string; houseId: string }): Promise<string | null> {
  const row = await (prisma as any).usageSimulatorScenario.findFirst({
    where: { userId: args.userId, houseId: args.houseId, name: WORKSPACE_PAST_NAME, archivedAt: null },
    select: { id: true },
  });
  return row?.id ?? null;
}

async function buildReadResult(args: {
  userId: string;
  houseId: string;
  scenarioId: string | null;
  readMode: "artifact_only" | "allow_rebuild";
}) {
  if (!args.scenarioId) {
    return { ok: false as const, error: "past_scenario_missing", message: "Past (Corrected) scenario is missing for this house." };
  }
  const out = await getSimulatedUsageForHouseScenario({
    userId: args.userId,
    houseId: args.houseId,
    scenarioId: args.scenarioId,
    readMode: args.readMode,
    projectionMode: "baseline",
    readContext: {
      artifactReadMode: args.readMode,
      projectionMode: "baseline",
      compareSidecarRequest: true,
    },
  });
  if (!out.ok) {
    return {
      ok: false as const,
      error: out.code,
      message: out.message,
      failureCode: out.code,
      failureMessage: out.message,
    };
  }
  const manualUsage = await getManualUsageInputForUserHouse({ userId: args.userId, houseId: args.houseId });
  const compareProjection = buildValidationCompareProjectionSidecar(out.dataset);
  const manualMonthlyReconciliation = buildManualMonthlyReconciliation({
    payload: manualUsage.payload,
    dataset: out.dataset,
  });
  const sharedDiagnostics = buildSharedPastSimDiagnostics({
    callerType: "user_past",
    dataset: out.dataset,
    scenarioId: args.scenarioId,
    compareProjection,
    manualMonthlyReconciliation,
    readMode: args.readMode,
    projectionMode: "baseline",
  });
  return {
    ok: true as const,
    houseId: args.houseId,
    scenarioId: args.scenarioId,
    dataset: out.dataset,
    compareProjection,
    manualMonthlyReconciliation,
    sharedDiagnostics,
  };
}

export async function POST(req: NextRequest) {
  const gate = requireAdmin(req);
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "").trim();
    const resolved = await resolveUserAndHouse(body?.email, body?.houseId);
    if (!resolved.ok) {
      const status =
        resolved.error === "email_required" ? 400 : resolved.error === "user_not_found" || resolved.error === "house_not_found" ? 404 : 400;
      return NextResponse.json({ ok: false, error: resolved.error }, { status });
    }

    const scenarioId = await findPastScenarioId({ userId: resolved.userId, houseId: resolved.selectedHouse.id });

    if (action === "lookup") {
      const payload = await getManualUsageInputForUserHouse({ userId: resolved.userId, houseId: resolved.selectedHouse.id });
      const currentResult = scenarioId
        ? await buildReadResult({
            userId: resolved.userId,
            houseId: resolved.selectedHouse.id,
            scenarioId,
            readMode: "artifact_only",
          })
        : null;
      return NextResponse.json({
        ok: true,
        action,
        email: resolved.email,
        userId: resolved.userId,
        houses: resolved.houses,
        selectedHouse: resolved.selectedHouse,
        scenarioId,
        payload: payload.payload,
        updatedAt: payload.updatedAt,
        currentResult,
      });
    }

    if (action === "load") {
      const payload = await getManualUsageInputForUserHouse({ userId: resolved.userId, houseId: resolved.selectedHouse.id });
      const readResult = await buildReadResult({
        userId: resolved.userId,
        houseId: resolved.selectedHouse.id,
        scenarioId,
        readMode: "artifact_only",
      });
      return NextResponse.json({
        ok: true,
        action,
        email: resolved.email,
        userId: resolved.userId,
        selectedHouse: resolved.selectedHouse,
        scenarioId,
        payload: payload.payload,
        updatedAt: payload.updatedAt,
        readResult,
      });
    }

    if (action === "save") {
      const payload = body?.payload as ManualUsagePayload | null;
      if (!payload) return NextResponse.json({ ok: false, error: "payload_required" }, { status: 400 });
      const saved = await saveManualUsageInputForUserHouse({
        userId: resolved.userId,
        houseId: resolved.selectedHouse.id,
        payload,
      });
      if (!saved.ok) return NextResponse.json(saved, { status: 400 });
      return NextResponse.json({
        ok: true,
        action,
        email: resolved.email,
        userId: resolved.userId,
        selectedHouse: resolved.selectedHouse,
        scenarioId,
        updatedAt: saved.updatedAt,
        payload: saved.payload,
      });
    }

    if (action === "recalc") {
      if (!scenarioId) {
        return NextResponse.json({ ok: false, error: "past_scenario_missing" }, { status: 404 });
      }
      const weatherPreferenceRaw = typeof body?.weatherPreference === "string" ? body.weatherPreference.trim() : "";
      const weatherPreference: WeatherPreference =
        weatherPreferenceRaw === "NONE" || weatherPreferenceRaw === "LAST_YEAR_WEATHER" || weatherPreferenceRaw === "LONG_TERM_AVERAGE"
          ? (weatherPreferenceRaw as WeatherPreference)
          : "LAST_YEAR_WEATHER";
      const userWeatherLogic = resolveUserWeatherLogicSetting(weatherPreference);
      const userValidationPolicy = resolveUserValidationPolicy({
        defaultSelectionMode: await getUserDefaultValidationSelectionMode(),
        validationDayCount: 21,
      });
      const dispatched = await dispatchPastSimRecalc({
        userId: resolved.userId,
        houseId: resolved.selectedHouse.id,
        esiid: resolved.selectedHouse.esiid ?? null,
        mode: "MANUAL_TOTALS",
        scenarioId,
        weatherPreference: userWeatherLogic.weatherPreference,
        persistPastSimBaseline: true,
        validationDaySelectionMode: userValidationPolicy.selectionMode,
        validationDayCount: userValidationPolicy.validationDayCount,
        runContext: {
          callerLabel: "admin_manual_monthly_lab",
          buildPathKind: "recalc",
          persistRequested: true,
        },
      });
      return NextResponse.json({
        ok: true,
        action,
        email: resolved.email,
        userId: resolved.userId,
        selectedHouse: resolved.selectedHouse,
        scenarioId,
        executionMode: dispatched.executionMode,
        correlationId: dispatched.correlationId,
        jobId: dispatched.executionMode === "droplet_async" ? dispatched.jobId : null,
        result: dispatched.executionMode === "inline" ? dispatched.result : null,
      });
    }

    if (action === "read_result") {
      const readResult = await buildReadResult({
        userId: resolved.userId,
        houseId: resolved.selectedHouse.id,
        scenarioId,
        readMode: "allow_rebuild",
      });
      if (readResult.ok) {
        return NextResponse.json({
          ok: true,
          action,
          email: resolved.email,
          userId: resolved.userId,
          selectedHouse: resolved.selectedHouse,
          scenarioId,
          readResult,
        });
      }
      return NextResponse.json({
        action,
        email: resolved.email,
        userId: resolved.userId,
        selectedHouse: resolved.selectedHouse,
        scenarioId,
        ...readResult,
      });
    }

    return NextResponse.json({ ok: false, error: "action_invalid" }, { status: 400 });
  } catch (error) {
    console.error("[admin/tools/manual-monthly] failed", error);
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}