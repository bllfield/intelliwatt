import { NextRequest, NextResponse } from "next/server";
import { getHomeProfileSimulatedByUserHouse } from "@/modules/homeProfile/repo";
import {
  adaptIntervalRawInput,
  adaptManualAnnualRawInput,
  adaptManualMonthlyRawInput,
  adaptNewBuildRawInput,
  buildSharedSimulationReadModel,
  runSharedSimulation,
  SharedSimulationRunError,
  UpstreamUsageTruthMissingError,
  type CanonicalSimulationInputType,
} from "@/modules/onePathSim/onePathSim";
import { getApplianceProfileSimulatedByUserHouse } from "@/modules/applianceProfile/repo";
import { normalizeStoredApplianceProfile } from "@/modules/applianceProfile/validation";
import { gateOnePathSimAdmin, resolveOnePathSimUserSelection } from "./_helpers";
import {
  getOnePathManualUsageInput,
  getOnePathSimulationVariablePolicy,
  getOnePathTravelRangesFromDb,
  resolveOnePathUpstreamUsageTruthForSimulation,
  resolveOnePathWeatherSensitivityEnvelope,
  saveOnePathManualUsageInput,
  type SimulationVariableInputType,
  type SimulationVariablePolicy,
} from "@/modules/onePathSim/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isUpstreamUsageTruthMissingFailure(
  error: unknown
): error is {
  code: "usage_truth_missing";
  usageTruthSource: unknown;
  seedResult: unknown;
  upstreamUsageTruth: unknown;
  message: string;
} {
  if (error instanceof UpstreamUsageTruthMissingError) return true;
  if (!error || typeof error !== "object") return false;
  return (error as { code?: unknown }).code === "usage_truth_missing";
}

function isSharedSimulationRunFailure(
  error: unknown
): error is {
  code: string;
  missingItems?: string[];
  message?: string;
} {
  if (error instanceof SharedSimulationRunError) return true;
  if (error instanceof Error && error.message === "requirements_unmet") return true;
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  const message = (error as { message?: unknown }).message;
  return typeof code === "string" || message === "requirements_unmet";
}

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
    const manual = await getOnePathManualUsageInput({
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
    const saved = await saveOnePathManualUsageInput({
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
    const sharedSimulationVariablePolicy = await getOnePathSimulationVariablePolicy();
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
    resolveOnePathUpstreamUsageTruthForSimulation({
      userId: resolved.userId,
      houseId: resolved.selectedHouse.id,
      actualContextHouseId: previewActualContextHouse.id,
      seedIfMissing: false,
    }).catch(() => null),
    getOnePathManualUsageInput({ userId: resolved.userId, houseId: resolved.selectedHouse.id }).catch(() => ({
      payload: null,
      updatedAt: null,
    })),
    getHomeProfileSimulatedByUserHouse({ userId: resolved.userId, houseId: resolved.selectedHouse.id }).catch(() => null),
    getApplianceProfileSimulatedByUserHouse({ userId: resolved.userId, houseId: resolved.selectedHouse.id }).catch(() => null),
    getOnePathTravelRangesFromDb(resolved.userId, resolved.selectedHouse.id).catch(() => []),
  ]);
  const applianceProfile = normalizeStoredApplianceProfile((applianceProfileRecord as any)?.appliancesJson ?? null);
  const weatherEnvelope = await resolveOnePathWeatherSensitivityEnvelope({
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
    if ((mode === "MANUAL_MONTHLY" || mode === "MANUAL_ANNUAL") && !manualUsage.payload) {
      return NextResponse.json(
        {
          ok: false,
          error: "requirements_unmet",
          missingItems: ["Save manual usage totals (monthly or annual)."],
          message: "requirements_unmet: Save manual usage totals (monthly or annual).",
        },
        { status: 409 }
      );
    }
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
      if (isUpstreamUsageTruthMissingFailure(error)) {
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
      if (isSharedSimulationRunFailure(error)) {
        const code =
          typeof (error as { code?: unknown }).code === "string"
            ? String((error as { code?: unknown }).code)
            : "requirements_unmet";
        const missingItems = Array.isArray((error as { missingItems?: unknown }).missingItems)
          ? ((error as { missingItems?: unknown }).missingItems as unknown[]).map((item) => String(item))
          : [];
        const message =
          missingItems.length > 0
            ? `${code}: ${missingItems.join("; ")}`
            : error instanceof Error && error.message
              ? error.message
              : code;
        return NextResponse.json(
          {
            ok: false,
            error: code,
            missingItems,
            message,
          },
          { status: 409 }
        );
      }
      throw error;
    }
  }

  return NextResponse.json({ ok: false, error: "unsupported_action" }, { status: 400 });
}
