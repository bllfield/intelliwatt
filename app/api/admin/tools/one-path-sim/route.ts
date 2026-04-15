import { NextRequest, NextResponse } from "next/server";
import { getHomeProfileSimulatedByUserHouse } from "@/modules/homeProfile/repo";
import { getManualUsageInputForUserHouse, saveManualUsageInputForUserHouse } from "@/modules/manualUsage/store";
import {
  adaptIntervalRawInput,
  adaptManualAnnualRawInput,
  adaptManualMonthlyRawInput,
  adaptNewBuildRawInput,
  buildSharedSimulationReadModel,
  runSharedSimulation,
  UpstreamUsageTruthMissingError,
  type CanonicalSimulationInputType,
} from "@/modules/usageSimulator/onePathSim";
import { resolveSharedWeatherSensitivityEnvelope } from "@/modules/weatherSensitivity/shared";
import { getApplianceProfileSimulatedByUserHouse } from "@/modules/applianceProfile/repo";
import { normalizeStoredApplianceProfile } from "@/modules/applianceProfile/validation";
import { gateOnePathSimAdmin, resolveOnePathSimUserSelection } from "./_helpers";
import { getTravelRangesFromDb } from "@/app/api/admin/tools/gapfill-lab/gapfillLabRouteHelpers";
import {
  getSimulationVariablePolicy,
  type SimulationVariableInputType,
  type SimulationVariablePolicy,
} from "@/modules/usageSimulator/simulationVariablePolicy";
import { resolveUpstreamUsageTruthForSimulation } from "@/modules/usageSimulator/upstreamUsageTruth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeMode(value: unknown): CanonicalSimulationInputType {
  switch (String(value ?? "").trim().toUpperCase()) {
    case "INTERVAL":
      return "INTERVAL";
    case "MANUAL_ANNUAL":
      return "MANUAL_ANNUAL";
    case "NEW_BUILD":
      return "NEW_BUILD";
    default:
      return "MANUAL_MONTHLY";
  }
}

export async function POST(request: NextRequest) {
  const denied = gateOnePathSimAdmin(request);
  if (denied) return denied;

  const body = await request.json().catch(() => ({}));
  const action = String(body?.action ?? "").trim().toLowerCase();
  const resolved = await resolveOnePathSimUserSelection({
    email: typeof body?.email === "string" ? body.email : null,
    houseId: typeof body?.houseId === "string" ? body.houseId : null,
  });
  if (!resolved.ok) {
    const status = resolved.error === "email_required" ? 400 : 404;
    return NextResponse.json({ ok: false, error: resolved.error }, { status });
  }

  if (action === "load_manual") {
    const manual = await getManualUsageInputForUserHouse({
      userId: resolved.userId,
      houseId: resolved.selectedHouse.id,
    }).catch(() => ({ payload: null, updatedAt: null }));
    return NextResponse.json({
      ok: true,
      houseId: resolved.selectedHouse.id,
      payload: manual.payload ?? null,
      updatedAt: manual.updatedAt ?? null,
    });
  }

  if (action === "save_manual") {
    const saved = await saveManualUsageInputForUserHouse({
      userId: resolved.userId,
      houseId: resolved.selectedHouse.id,
      payload: body?.payload,
    });
    if (!saved.ok) return NextResponse.json(saved, { status: 400 });
    return NextResponse.json({
      ok: true,
      houseId: resolved.selectedHouse.id,
      payload: saved.payload,
      updatedAt: saved.updatedAt,
    });
  }

  const previewMode = normalizeMode(body?.mode);
  const previewActualContextHouse =
    resolved.houses.find(
      (house) =>
        house.id ===
        (typeof body?.actualContextHouseId === "string" && body.actualContextHouseId.trim()
          ? body.actualContextHouseId.trim()
          : resolved.selectedHouse.id)
    ) ?? resolved.selectedHouse;
  let previewSimulationVariablePolicy: SimulationVariablePolicy | null = null;
  try {
    const sharedSimulationVariablePolicy = await getSimulationVariablePolicy();
    previewSimulationVariablePolicy =
      (
        sharedSimulationVariablePolicy.effectiveByMode as Partial<
          Record<SimulationVariableInputType, SimulationVariablePolicy>
        >
      )[previewMode as SimulationVariableInputType] ?? null;
  } catch {
    previewSimulationVariablePolicy = null;
  }

  const [usageTruth, manualUsage, homeProfile, applianceProfileRecord, travelRangesFromDb] = await Promise.all([
    resolveUpstreamUsageTruthForSimulation({
      userId: resolved.userId,
      houseId: resolved.selectedHouse.id,
      actualContextHouseId: previewActualContextHouse.id,
      seedIfMissing: false,
    }).catch(() => null),
    getManualUsageInputForUserHouse({ userId: resolved.userId, houseId: resolved.selectedHouse.id }).catch(() => ({
      payload: null,
      updatedAt: null,
    })),
    getHomeProfileSimulatedByUserHouse({ userId: resolved.userId, houseId: resolved.selectedHouse.id }).catch(() => null),
    getApplianceProfileSimulatedByUserHouse({ userId: resolved.userId, houseId: resolved.selectedHouse.id }).catch(() => null),
    getTravelRangesFromDb(resolved.userId, resolved.selectedHouse.id).catch(() => []),
  ]);
  const applianceProfile = normalizeStoredApplianceProfile((applianceProfileRecord as any)?.appliancesJson ?? null);
  const weatherEnvelope = await resolveSharedWeatherSensitivityEnvelope({
    actualDataset: usageTruth?.dataset ?? null,
    manualUsagePayload: manualUsage.payload ?? null,
    homeProfile,
    applianceProfile,
    weatherHouseId: previewActualContextHouse.id,
    simulationVariablePolicy: previewSimulationVariablePolicy,
  }).catch(() => ({ score: null, derivedInput: null }));

  if (action === "lookup" || !action) {
    return NextResponse.json({
      ok: true,
      email: resolved.email,
      userId: resolved.userId,
      houses: resolved.houses,
      selectedHouse: resolved.selectedHouse,
      scenarios: resolved.scenarios,
      sourceContext: {
        actualDatasetSummary: usageTruth?.dataset?.summary ?? null,
        actualDatasetMeta: (usageTruth?.dataset as any)?.meta ?? null,
        usageTruthSource: usageTruth?.usageTruthSource ?? "missing_usage_truth",
        usageTruthSeedResult: usageTruth?.seedResult ?? null,
        upstreamUsageTruth: usageTruth?.summary ?? null,
        manualUsagePayload: manualUsage.payload ?? null,
        manualUsageUpdatedAt: manualUsage.updatedAt ?? null,
        travelRangesFromDb,
        homeProfile: homeProfile ?? null,
        applianceProfile: applianceProfile ?? null,
        weatherScore: weatherEnvelope.score ?? null,
        weatherDerivedInput: weatherEnvelope.derivedInput ?? null,
      },
    });
  }

  if (action === "run") {
    const mode = normalizeMode(body?.mode);
    const rawInputBase = {
      userId: resolved.userId,
      houseId: resolved.selectedHouse.id,
      actualContextHouseId:
        typeof body?.actualContextHouseId === "string" && body.actualContextHouseId.trim()
          ? body.actualContextHouseId.trim()
          : resolved.selectedHouse.id,
      scenarioId: typeof body?.scenarioId === "string" && body.scenarioId.trim() ? body.scenarioId.trim() : null,
      weatherPreference:
        body?.weatherPreference === "NONE" || body?.weatherPreference === "LONG_TERM_AVERAGE"
          ? body.weatherPreference
          : "LAST_YEAR_WEATHER",
      validationSelectionMode:
        typeof body?.validationSelectionMode === "string" && body.validationSelectionMode.trim()
          ? body.validationSelectionMode.trim()
          : null,
      validationDayCount:
        typeof body?.validationDayCount === "number" && Number.isFinite(body.validationDayCount)
          ? body.validationDayCount
          : null,
      validationOnlyDateKeysLocal: Array.isArray(body?.validationOnlyDateKeysLocal)
        ? body.validationOnlyDateKeysLocal.map((value: unknown) => String(value ?? "").slice(0, 10))
        : [],
      travelRanges: Array.isArray(body?.travelRanges) ? body.travelRanges : [],
      persistRequested: body?.persistRequested !== false,
    } as const;
    try {
      const engineInput =
        mode === "INTERVAL"
          ? await adaptIntervalRawInput(rawInputBase)
          : mode === "MANUAL_ANNUAL"
            ? await adaptManualAnnualRawInput({
                ...rawInputBase,
                manualUsagePayload: manualUsage.payload ?? null,
              })
            : mode === "NEW_BUILD"
              ? await adaptNewBuildRawInput(rawInputBase)
              : await adaptManualMonthlyRawInput({
                  ...rawInputBase,
                  manualUsagePayload: manualUsage.payload ?? null,
                });
      const artifact = await runSharedSimulation(engineInput);
      const readModel = buildSharedSimulationReadModel(artifact);
      return NextResponse.json({
        ok: true,
        engineInput,
        artifact,
        readModel,
      });
    } catch (error) {
      if (error instanceof UpstreamUsageTruthMissingError) {
        return NextResponse.json(
          {
            ok: false,
            error: error.code,
            usageTruthSource: error.usageTruthSource,
            seedResult: error.seedResult,
            upstreamUsageTruth: error.upstreamUsageTruth,
            message: error.message,
          },
          { status: 409 }
        );
      }
      throw error;
    }
  }

  return NextResponse.json({ ok: false, error: "unsupported_action" }, { status: 400 });
}
