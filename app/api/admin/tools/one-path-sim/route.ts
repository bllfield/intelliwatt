import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { buildUserUsageHouseContract } from "@/lib/usage/userUsageHouseContract";
import { usagePrisma } from "@/lib/db/usageClient";
import { getHomeProfileReadOnlyByUserHouse } from "@/modules/homeProfile/repo";
import {
  adaptGreenButtonRawInput,
  adaptIntervalRawInput,
  adaptManualAnnualRawInput,
  adaptManualMonthlyRawInput,
  adaptNewBuildRawInput,
  buildSharedSimulationReadModel,
  runSharedSimulation,
  SharedSimulationRunError,
  UpstreamUsageTruthMissingError,
  type CanonicalSimulationEngineInput,
  type CanonicalSimulationInputType,
} from "@/modules/onePathSim/onePathSim";
import { listOnePathScenarioEvents, readOnePathSimulatedUsageScenario } from "@/modules/onePathSim/serviceBridge";
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
import { buildOnePathBaselineParityAudit } from "@/modules/onePathSim/baselineParityAudit";
import { buildBaselineParityReport } from "@/modules/onePathSim/baselineParityReport";
import { buildOnePathBaselineReadOnlyView } from "@/modules/onePathSim/baselineReadOnlyView";
import { buildKnownHouseScenarioPrereqStatus } from "@/modules/onePathSim/knownHouseScenarioPrereqs";
import {
  hasUsableAnnualPayload,
  hasUsableMonthlyPayload,
  reanchorGapfillManualStageOnePayload,
  resolveGapfillSyntheticAnchorEndDate,
  resolveSharedManualStageOneContract,
} from "@/modules/onePathSim/manualPrefill";
import { buildOnePathManualUsagePastSimReadResult } from "@/modules/onePathSim/manualPastSimReadResult";
import { buildOnePathManualStageOnePreview, buildOnePathManualStageOneView } from "@/modules/onePathSim/manualStageView";
import { buildOnePathRunReadOnlyView } from "@/modules/onePathSim/runReadOnlyView";
import type { ManualUsagePayload } from "@/modules/onePathSim/simulatedUsage/types";
import { buildValidationCompareProjectionSidecar } from "@/modules/onePathSim/usageSimulator/compareProjection";
import { buildRuntimeEnvParityTrace } from "@/modules/onePathSim/runtimeEnvParityTrace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

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
    case "GREEN_BUTTON":
      return "GREEN_BUTTON";
    case "MANUAL_ANNUAL":
      return "MANUAL_ANNUAL";
    case "NEW_BUILD":
      return "NEW_BUILD";
    default:
      return "MANUAL_MONTHLY";
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function buildSlimAdminEngineInput(engineInput: CanonicalSimulationEngineInput | null | undefined) {
  if (!engineInput) return null;
  const weatherDaysReference = asRecord(engineInput.weatherDaysReference);
  const prefetchedUsageTruth = asRecord(engineInput.prefetchedBaselineUpstreamUsageTruth);
  return {
    ...engineInput,
    actualIntervalsReference: {
      omittedForAdminResponse: true,
      rowsCount: Array.isArray(engineInput.actualIntervalsReference) ? engineInput.actualIntervalsReference.length : 0,
    },
    actualDailyReference: {
      omittedForAdminResponse: true,
      rowsCount: Array.isArray(engineInput.actualDailyReference) ? engineInput.actualDailyReference.length : 0,
    },
    weatherDaysReference:
      weatherDaysReference != null
        ? {
            omittedForAdminResponse: true,
            rowsCount: Object.keys(weatherDaysReference).length,
          }
        : null,
    prefetchedBaselineUpstreamUsageTruth:
      prefetchedUsageTruth != null
        ? {
            usageTruthSource: prefetchedUsageTruth.usageTruthSource ?? null,
            seedResult: prefetchedUsageTruth.seedResult ?? null,
            summary: prefetchedUsageTruth.summary ?? null,
          }
        : null,
  };
}

function buildCompactRunReadModelDataset(args: {
  artifactDataset: Record<string, unknown> | null;
  artifactDatasetMeta: Record<string, unknown> | null;
  runDisplayView: Record<string, unknown> | null;
}) {
  const summary = asRecord(args.artifactDataset?.summary);
  const viewSummary = asRecord(args.runDisplayView?.summary);
  return {
    summary: {
      ...(summary ?? {}),
      source: viewSummary?.source ?? summary?.source ?? null,
      totalKwh: asRecord(viewSummary?.totals)?.netKwh ?? summary?.totalKwh ?? null,
      start: viewSummary?.coverageStart ?? summary?.start ?? null,
      end: viewSummary?.coverageEnd ?? summary?.end ?? null,
      latest: summary?.latest ?? viewSummary?.coverageEnd ?? null,
    },
    daily: Array.isArray(args.runDisplayView?.dailyRows)
      ? args.runDisplayView?.dailyRows
      : Array.isArray(args.artifactDataset?.daily)
        ? args.artifactDataset.daily
        : [],
    monthly: Array.isArray(args.runDisplayView?.monthlyRows)
      ? args.runDisplayView?.monthlyRows
      : Array.isArray(args.artifactDataset?.monthly)
        ? args.artifactDataset.monthly
        : [],
    dailyWeather: args.runDisplayView?.dailyWeather ?? null,
    totals: asRecord(viewSummary?.totals) ?? null,
    insights: {
      fifteenMinuteAverages: Array.isArray(args.runDisplayView?.fifteenMinuteAverages)
        ? args.runDisplayView?.fifteenMinuteAverages
        : [],
      stitchedMonth: args.runDisplayView?.stitchedMonth ?? null,
      weekdayVsWeekend:
        typeof viewSummary?.weekdayKwh === "number" || typeof viewSummary?.weekendKwh === "number"
          ? {
              weekday: Number(viewSummary?.weekdayKwh ?? 0),
              weekend: Number(viewSummary?.weekendKwh ?? 0),
            }
          : null,
      timeOfDayBuckets: Array.isArray(viewSummary?.timeOfDayBuckets) ? viewSummary.timeOfDayBuckets : [],
      peakDay: viewSummary?.peakDay ?? null,
      peakHour: viewSummary?.peakHour ?? null,
      baseload: typeof viewSummary?.baseload === "number" ? viewSummary.baseload : null,
      baseloadDaily: typeof viewSummary?.baseloadDaily === "number" ? viewSummary.baseloadDaily : null,
      baseloadMonthly: typeof viewSummary?.baseloadMonthly === "number" ? viewSummary.baseloadMonthly : null,
    },
    series: {
      intervals15: [],
    },
    meta: {
      ...(args.artifactDatasetMeta ?? {}),
      baselinePassthrough: true,
    },
  };
}

function includeDebugDiagnosticsByDefault(value: unknown): boolean {
  return value === true;
}

function needsManualSeedForMode(
  mode: CanonicalSimulationInputType,
  payload: ManualUsagePayload | null | undefined
): boolean {
  if (mode === "MANUAL_MONTHLY") return !hasUsableMonthlyPayload(payload);
  if (mode === "MANUAL_ANNUAL") return !hasUsableAnnualPayload(payload);
  return false;
}

function normalizeActiveTravelRanges(args: {
  overrideTravelRanges?: unknown;
  payload?: ManualUsagePayload | null;
  dbTravelRanges?: unknown;
}): Array<{ startDate: string; endDate: string }> {
  if (Array.isArray(args.overrideTravelRanges)) {
    return args.overrideTravelRanges as Array<{ startDate: string; endDate: string }>;
  }
  if (Array.isArray(args.payload?.travelRanges) && args.payload.travelRanges.length > 0) {
    return args.payload.travelRanges;
  }
  if (Array.isArray(args.dbTravelRanges) && args.dbTravelRanges.length > 0) {
    return args.dbTravelRanges as Array<{ startDate: string; endDate: string }>;
  }
  return [];
}

function applyExplicitTravelRangesToManualPayload(
  payload: ManualUsagePayload | null,
  overrideTravelRanges?: unknown
): ManualUsagePayload | null {
  if (!payload || !Array.isArray(overrideTravelRanges)) return payload;
  return {
    ...payload,
    travelRanges: overrideTravelRanges as Array<{ startDate: string; endDate: string }>,
  };
}

function buildMonthlyKwhByMonth(
  payload: ManualUsagePayload | null | undefined
): Map<string, number | null> {
  if (payload?.mode !== "MONTHLY" || !Array.isArray(payload.monthlyKwh)) return new Map();
  return new Map(
    payload.monthlyKwh
      .map((row) => {
        const month = String(row?.month ?? "").slice(0, 7);
        const kwh = typeof row?.kwh === "number" && Number.isFinite(row.kwh) ? row.kwh : null;
        return /^\d{4}-\d{2}$/.test(month) ? ([month, kwh] as const) : null;
      })
      .filter((entry): entry is readonly [string, number | null] => entry != null)
  );
}

function shouldPreferActualDerivedAdminMonthlyPayload(args: {
  savedPayload: ManualUsagePayload | null | undefined;
  actualDerivedPayload: ManualUsagePayload | null | undefined;
}): boolean {
  if (args.savedPayload?.mode !== "MONTHLY" || args.actualDerivedPayload?.mode !== "MONTHLY") return false;
  if (args.savedPayload.dateSourceMode !== "AUTO_DATES") return false;
  const savedByMonth = buildMonthlyKwhByMonth(args.savedPayload);
  for (const row of args.actualDerivedPayload.monthlyKwh) {
    const month = String(row?.month ?? "").slice(0, 7);
    const actualKwh = typeof row?.kwh === "number" && Number.isFinite(row.kwh) ? row.kwh : null;
    if (!/^\d{4}-\d{2}$/.test(month) || actualKwh == null || actualKwh <= 0) continue;
    const savedKwh = savedByMonth.get(month);
    if (savedKwh == null || savedKwh === 0) return true;
  }
  return false;
}

async function buildOnePathAdminManualSeeds(args: {
  userId: string;
  houseId: string;
  actualContextHouseId: string;
  payload: ManualUsagePayload | null;
  overrideTravelRanges?: unknown;
  dbTravelRanges?: unknown;
}) {
  const usageTruth = await resolveOnePathUpstreamUsageTruthForSimulation({
    userId: args.userId,
    houseId: args.houseId,
    actualContextHouseId: args.actualContextHouseId,
    seedIfMissing: false,
  }).catch(() => null);
  const actualEndDate = String(usageTruth?.dataset?.summary?.end ?? "").slice(0, 10) || null;
  const syntheticAnchorEndDate = resolveGapfillSyntheticAnchorEndDate(actualEndDate);
  const activeTravelRanges = normalizeActiveTravelRanges({
    overrideTravelRanges: args.overrideTravelRanges,
    payload: args.payload,
    dbTravelRanges: args.dbTravelRanges,
  });
  const actualDerivedMonthlyResolved = resolveSharedManualStageOneContract({
    mode: "MONTHLY",
    sourcePayload: null,
    actualEndDate: syntheticAnchorEndDate,
    travelRanges: activeTravelRanges,
    dailyRows: usageTruth?.dataset?.daily ?? [],
  });
  const actualDerivedMonthlyPayload =
    actualDerivedMonthlyResolved.payload?.mode === "MONTHLY" ? actualDerivedMonthlyResolved.payload : null;
  const refreshedAutoDateMonthlyPayload =
    actualDerivedMonthlyPayload != null
      ? {
          ...actualDerivedMonthlyPayload,
          dateSourceMode: "AUTO_DATES" as const,
          travelRanges: activeTravelRanges.length > 0 ? activeTravelRanges : actualDerivedMonthlyPayload.travelRanges,
        }
      : null;
  const preferredSourcePayload = shouldPreferActualDerivedAdminMonthlyPayload({
    savedPayload: args.payload,
    actualDerivedPayload: actualDerivedMonthlyPayload,
  })
    ? refreshedAutoDateMonthlyPayload
    : args.payload;
  const monthlyResolved = resolveSharedManualStageOneContract({
    mode: "MONTHLY",
    sourcePayload: preferredSourcePayload,
    actualEndDate: syntheticAnchorEndDate,
    travelRanges: activeTravelRanges,
    dailyRows: usageTruth?.dataset?.daily ?? [],
  });
  const annualResolved = resolveSharedManualStageOneContract({
    mode: "ANNUAL",
    sourcePayload: preferredSourcePayload,
    actualEndDate: syntheticAnchorEndDate,
    travelRanges: activeTravelRanges,
    dailyRows: usageTruth?.dataset?.daily ?? [],
  });
  const monthlySeed =
    monthlyResolved.payload?.mode === "MONTHLY"
      ? monthlyResolved.payloadSource === "actual_derived_seed"
        ? reanchorGapfillManualStageOnePayload({
            payload: {
              ...monthlyResolved.payload,
              dateSourceMode: "AUTO_DATES",
              travelRanges: activeTravelRanges.length > 0 ? activeTravelRanges : monthlyResolved.payload.travelRanges,
            },
            anchorEndDate: syntheticAnchorEndDate,
          })
        : monthlyResolved.payload
      : null;
  const annualSeed =
    annualResolved.payload?.mode === "ANNUAL"
      ? annualResolved.payloadSource === "actual_derived_seed"
        ? reanchorGapfillManualStageOnePayload({
            payload: {
              ...annualResolved.payload,
              travelRanges: activeTravelRanges.length > 0 ? activeTravelRanges : annualResolved.payload.travelRanges,
            },
            anchorEndDate: syntheticAnchorEndDate,
          })
        : annualResolved.payload
      : null;
  return {
    usageTruth,
    activeTravelRanges,
    seed: {
      sourceMode: monthlyResolved.seedSet.sourceMode ?? annualResolved.seedSet.sourceMode ?? null,
      monthly: monthlySeed,
      annual: annualSeed,
    },
    payloadForMode: {
      MANUAL_MONTHLY: monthlySeed,
      MANUAL_ANNUAL: annualSeed,
    } as const,
  };
}

function asScenarioVariable(value: unknown): {
  kind: string;
  effectiveMonth?: string;
  payloadJson?: Record<string, unknown>;
} | null {
  const item = asRecord(value);
  if (!item) return null;
  const kind = String(item.kind ?? "").trim();
  if (!kind) return null;
  const effectiveMonth = String(item.effectiveMonth ?? "").slice(0, 7);
  return {
    kind,
    effectiveMonth: /^\d{4}-\d{2}$/.test(effectiveMonth) ? effectiveMonth : undefined,
    payloadJson: asRecord(item.payloadJson) ?? undefined,
  };
}

function buildEnvironmentVisibility() {
  return {
    homeDetails: {
      envVarName: "HOME_DETAILS_DATABASE_URL",
      envVarPresent: Boolean(process.env.HOME_DETAILS_DATABASE_URL),
      owner: "lib/db/homeDetailsClient.ts -> @prisma/home-details-client",
    },
    appliances: {
      envVarName: "APPLIANCES_DATABASE_URL",
      envVarPresent: Boolean(process.env.APPLIANCES_DATABASE_URL),
      owner: "lib/db/appliancesClient.ts -> @prisma/appliances-client",
    },
    usage: {
      envVarName: "USAGE_DATABASE_URL",
      envVarPresent: Boolean(process.env.USAGE_DATABASE_URL),
      owner: "lib/db/usageClient.ts -> .prisma/usage-client",
    },
  };
}

function usageDbUnavailableResponse(args: {
  usageTruthSource: unknown;
  seedResult: unknown;
  upstreamUsageTruth: unknown;
  message?: string;
}) {
  const environmentVisibility = buildEnvironmentVisibility();
  const runtimeEnvParityTrace = buildRuntimeEnvParityTrace({
    environmentVisibility,
  });
  return NextResponse.json(
    {
      ok: false,
      error: "usage_db_unavailable",
      usageTruthSource: args.usageTruthSource,
      seedResult: args.seedResult,
      upstreamUsageTruth: args.upstreamUsageTruth,
      environmentVisibility,
      runtimeEnvParityTrace,
      message:
        args.message ??
        "The shared usage database is unavailable in this runtime, so persisted usage truth cannot be read.",
    },
    { status: 503 }
  );
}

async function loadGreenButtonUploadSummary(houseId: string | null | undefined) {
  if (!houseId) return null;
  const prismaAny = prisma as any;
  const latestUpload = await prismaAny.greenButtonUpload
    .findFirst({
      where: { houseId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        createdAt: true,
        updatedAt: true,
        parseStatus: true,
        parseMessage: true,
        dateRangeStart: true,
        dateRangeEnd: true,
        intervalMinutes: true,
        fileName: true,
        fileSizeBytes: true,
      },
    })
    .catch(() => null);

  const coverage = await (usagePrisma as any)?.greenButtonInterval
    ?.aggregate({
      where: { homeId: houseId },
      _count: { _all: true },
      _min: { timestamp: true },
      _max: { timestamp: true },
    })
    .catch(() => null);

  const derivedCoverage =
    coverage && (coverage._count?._all ?? 0) > 0
      ? {
          start: coverage._min?.timestamp ?? null,
          end: coverage._max?.timestamp ?? null,
          count: coverage._count?._all ?? 0,
        }
      : null;

  if (latestUpload) {
    return {
      ...latestUpload,
      dateRangeStart: derivedCoverage?.start ?? latestUpload.dateRangeStart ?? null,
      dateRangeEnd: derivedCoverage?.end ?? latestUpload.dateRangeEnd ?? null,
      intervalCount: derivedCoverage?.count ?? 0,
      hasPersistedUsageIntervals: Boolean(derivedCoverage),
    };
  }

  if (!derivedCoverage) return null;
  return {
    id: "derived-coverage",
    createdAt: derivedCoverage.start ?? null,
    updatedAt: derivedCoverage.end ?? null,
    parseStatus: "complete",
    parseMessage: null,
    dateRangeStart: derivedCoverage.start,
    dateRangeEnd: derivedCoverage.end,
    intervalMinutes: 15,
    fileName: "derived",
    fileSizeBytes: null,
    intervalCount: derivedCoverage.count,
    hasPersistedUsageIntervals: true,
  };
}

export async function POST(request: NextRequest) {
  const denied = gateOnePathSimAdmin(request);
  if (denied) return denied;

  const body = await request.json().catch(() => ({}));
  const action = String(body?.action ?? "").trim().toLowerCase();
  const includeDebugDiagnostics = includeDebugDiagnosticsByDefault(body?.includeDebugDiagnostics);
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
    const actualContextHouseId =
      typeof body?.actualContextHouseId === "string" && body.actualContextHouseId.trim()
        ? body.actualContextHouseId.trim()
        : resolved.selectedHouse.id;
    const travelRangesFromDb = await getOnePathTravelRangesFromDb(resolved.userId, resolved.selectedHouse.id).catch(() => []);
    const seeds = await buildOnePathAdminManualSeeds({
      userId: resolved.userId,
      houseId: resolved.selectedHouse.id,
      actualContextHouseId,
      payload: manual.payload ?? null,
      dbTravelRanges: travelRangesFromDb,
    });
    return NextResponse.json({
      ok: true,
      houseId: resolved.selectedHouse.id,
      payload: manual.payload ?? null,
      updatedAt: manual.updatedAt ?? null,
      sourcePayload: manual.payload ?? null,
      sourceUpdatedAt: manual.updatedAt ?? null,
      seed: seeds.seed,
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

  if (action === "run") {
    const mode = normalizeMode(body?.mode);
    const isManualMode = mode === "MANUAL_MONTHLY" || mode === "MANUAL_ANNUAL";
    const manualUsage =
      isManualMode
        ? await getOnePathManualUsageInput({ userId: resolved.userId, houseId: resolved.selectedHouse.id }).catch(() => ({
            payload: null,
            updatedAt: null,
          }))
        : { payload: null, updatedAt: null };
    const rawInputBase = {
      userId: resolved.userId,
      houseId: resolved.selectedHouse.id,
      actualContextHouseId:
        typeof body?.actualContextHouseId === "string" && body.actualContextHouseId.trim()
          ? body.actualContextHouseId.trim()
          : resolved.selectedHouse.id,
      preferredActualSource:
        body?.preferredActualSource === "SMT" || body?.preferredActualSource === "GREEN_BUTTON"
          ? body.preferredActualSource
          : null,
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
      travelRanges: Array.isArray(body?.travelRanges) ? body.travelRanges : undefined,
      persistRequested: body?.persistRequested !== false,
    } as const;
    const effectiveRawInputBase = {
      ...rawInputBase,
      preferredActualSource: mode === "GREEN_BUTTON" ? "GREEN_BUTTON" : rawInputBase.preferredActualSource,
    } as const;
    const adminManualSeeds =
      isManualMode
        ? await buildOnePathAdminManualSeeds({
            userId: resolved.userId,
            houseId: resolved.selectedHouse.id,
            actualContextHouseId: effectiveRawInputBase.actualContextHouseId,
            payload: manualUsage.payload ?? null,
            overrideTravelRanges: effectiveRawInputBase.travelRanges,
            dbTravelRanges: await getOnePathTravelRangesFromDb(resolved.userId, resolved.selectedHouse.id).catch(() => []),
          })
        : null;
    const effectiveManualUsagePayload =
      isManualMode
        ? applyExplicitTravelRangesToManualPayload(
            adminManualSeeds?.payloadForMode[mode] ?? null,
            effectiveRawInputBase.travelRanges
          )
        : null;
    if (isManualMode && !effectiveManualUsagePayload) {
      const missingItems =
        mode === "MANUAL_ANNUAL"
          ? ["Save filled manual annual usage totals before running MANUAL_ANNUAL."]
          : ["Save filled manual monthly usage totals before running MANUAL_MONTHLY."];
      return NextResponse.json(
        {
          ok: false,
          error: "requirements_unmet",
          missingItems,
          message: `requirements_unmet: ${missingItems.join("; ")}`,
        },
        { status: 409 }
      );
    }
    try {
      if (!includeDebugDiagnostics && effectiveRawInputBase.scenarioId && !isManualMode) {
        const readback = await readOnePathSimulatedUsageScenario({
          userId: resolved.userId,
          houseId: resolved.selectedHouse.id,
          scenarioId: effectiveRawInputBase.scenarioId,
          readMode: "allow_rebuild",
          projectionMode: "baseline",
          readContext: {
            artifactReadMode: "allow_rebuild",
            projectionMode: "baseline",
            compareSidecarRequest: true,
          },
        });
        if (!readback.ok) {
          const status =
            readback.code === "NO_BUILD" || readback.code === "ARTIFACT_MISSING" || readback.code === "SCENARIO_NOT_FOUND"
              ? 404
              : readback.code === "COMPARE_TRUTH_INCOMPLETE"
                ? 409
                : 500;
          return NextResponse.json(
            {
              ok: false,
              error: readback.code,
              message: readback.message,
            },
            { status }
          );
        }
        const compareProjection = buildValidationCompareProjectionSidecar(readback.dataset);
        const scenarioEvents = await listOnePathScenarioEvents({
          userId: resolved.userId,
          houseId: resolved.selectedHouse.id,
          scenarioId: effectiveRawInputBase.scenarioId,
        }).catch(() => ({ ok: false as const, events: [] as unknown[] }));
        const manualStageOneView = null;
        const runDisplayViewBase =
          buildOnePathRunReadOnlyView({
            dataset: asRecord(readback.dataset),
            readModel: { compareProjection },
          }) ?? null;
        const pastVariables =
          scenarioEvents.ok && Array.isArray(scenarioEvents.events)
            ? scenarioEvents.events
                .map((event) => asScenarioVariable(event))
                .filter((event): event is NonNullable<ReturnType<typeof asScenarioVariable>> => event != null)
            : [];
        return NextResponse.json({
          ok: true,
          debugDiagnosticsIncluded: false,
          runType: "PAST_SIM",
          manualStageOneView,
          runDisplayView:
            runDisplayViewBase != null
              ? {
                  ...runDisplayViewBase,
                  pastVariables,
                }
              : null,
          artifact: null,
          readModel: null,
        });
      }
      const engineInput =
        mode === "INTERVAL"
          ? await adaptIntervalRawInput(effectiveRawInputBase)
          : mode === "GREEN_BUTTON"
            ? await adaptGreenButtonRawInput(effectiveRawInputBase)
          : mode === "MANUAL_ANNUAL"
            ? await adaptManualAnnualRawInput({
                ...effectiveRawInputBase,
                manualUsagePayload: effectiveManualUsagePayload,
              })
            : mode === "NEW_BUILD"
              ? await adaptNewBuildRawInput(effectiveRawInputBase)
              : await adaptManualMonthlyRawInput({
                  ...effectiveRawInputBase,
                  manualUsagePayload: effectiveManualUsagePayload,
                });
      const artifact = await runSharedSimulation(engineInput);
      const artifactDataset = asRecord(artifact.dataset);
      const artifactDatasetMeta = asRecord(artifactDataset?.meta);
      const slimEngineInput = buildSlimAdminEngineInput(engineInput);
      const isGreenButtonBaselinePassthroughRun =
        mode === "GREEN_BUTTON" &&
        !effectiveRawInputBase.scenarioId &&
        Boolean(artifactDatasetMeta?.baselinePassthrough);
      if (isGreenButtonBaselinePassthroughRun) {
        const compactRunDisplayView =
          buildOnePathRunReadOnlyView({
            dataset: artifactDataset,
            engineInput: asRecord(engineInput),
            readModel:
              artifact.compareProjection || artifact.manualStageOneView
                ? {
                    compareProjection: artifact.compareProjection,
                    manualStageOneView: artifact.manualStageOneView,
                  }
                : null,
          }) ?? null;
        const compactReadModel =
          compactRunDisplayView || artifactDataset
            ? {
                dataset: buildCompactRunReadModelDataset({
                  artifactDataset,
                  artifactDatasetMeta,
                  runDisplayView: compactRunDisplayView,
                }),
              }
            : null;
        return NextResponse.json({
          ok: true,
          debugDiagnosticsIncluded: false,
          runType: "BASELINE_PASSTHROUGH",
          engineInput: slimEngineInput,
          manualStageOneView: artifact.manualStageOneView ?? null,
          runDisplayView: compactRunDisplayView,
          artifact: null,
          readModel: compactReadModel,
        });
      }
      const readModel = buildSharedSimulationReadModel(artifact);
      const actualDatasetForManualRun =
        isManualMode
          ? (
              await resolveOnePathUpstreamUsageTruthForSimulation({
                userId: resolved.userId,
                houseId: resolved.selectedHouse.id,
                actualContextHouseId: effectiveRawInputBase.actualContextHouseId,
                seedIfMissing: false,
                preferredActualSource: effectiveRawInputBase.preferredActualSource,
              }).catch(() => null)
            )?.dataset ?? null
          : null;
      const manualPastReadResult =
        isManualMode && effectiveRawInputBase.scenarioId
          ? await buildOnePathManualUsagePastSimReadResult({
              userId: resolved.userId,
              houseId: resolved.selectedHouse.id,
              scenarioId: effectiveRawInputBase.scenarioId,
              readMode: "artifact_only",
              callerType: "user_past",
              exactArtifactInputHash: artifact.artifactInputHash ?? null,
              requireExactArtifactMatch: Boolean(artifact.artifactInputHash),
              usageInputMode: mode,
              weatherLogicMode: artifact.engineInput?.weatherLogicMode ?? null,
              artifactId: artifact.artifactId ?? null,
              artifactInputHash: artifact.artifactInputHash ?? null,
              artifactEngineVersion: artifact.engineVersion ?? null,
              manualUsagePayload: effectiveManualUsagePayload,
              actualDataset: actualDatasetForManualRun,
            })
          : null;
      const manualRunDisplayView =
        manualPastReadResult && manualPastReadResult.ok
          ? buildOnePathRunReadOnlyView({
              dataset: asRecord(manualPastReadResult.displayDataset),
              engineInput: asRecord(engineInput),
              readModel: { compareProjection: manualPastReadResult.compareProjection },
            })
          : null;
      const runDisplayView =
        manualRunDisplayView ??
        buildOnePathRunReadOnlyView({
          dataset: asRecord(readModel.dataset),
          engineInput: asRecord(engineInput),
          readModel: asRecord(readModel),
        }) ??
        null;
      if (!includeDebugDiagnostics) {
        return NextResponse.json({
          ok: true,
          debugDiagnosticsIncluded: false,
          runType:
            effectiveRawInputBase.scenarioId
              ? "PAST_SIM"
              : Boolean(artifactDatasetMeta?.baselinePassthrough)
                ? "BASELINE_PASSTHROUGH"
                : "BASELINE_OR_UNSET",
          engineInput: slimEngineInput,
          manualStageOneView: readModel.manualStageOneView ?? null,
          runDisplayView,
          artifact: null,
          readModel: null,
        });
      }
      return NextResponse.json({
        ok: true,
        debugDiagnosticsIncluded: true,
        runType:
          effectiveRawInputBase.scenarioId
            ? "PAST_SIM"
            : Boolean(artifactDatasetMeta?.baselinePassthrough)
              ? "BASELINE_PASSTHROUGH"
              : "BASELINE_OR_UNSET",
        engineInput: slimEngineInput,
        artifact,
        readModel,
        manualStageOneView: readModel.manualStageOneView ?? null,
        runDisplayView,
      });
    } catch (error) {
      if (isUpstreamUsageTruthMissingFailure(error)) {
        const environmentVisibility = buildEnvironmentVisibility();
        if (!environmentVisibility.usage.envVarPresent) {
          return usageDbUnavailableResponse({
            usageTruthSource: error.usageTruthSource,
            seedResult: error.seedResult,
            upstreamUsageTruth: error.upstreamUsageTruth,
          });
        }
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

  const previewMode =
    typeof body?.mode === "string" && body.mode.trim()
      ? normalizeMode(body.mode)
      : "INTERVAL";

  if ((action === "lookup" || !action) && !includeDebugDiagnostics) {
    const travelRangesFromDb = await getOnePathTravelRangesFromDb(resolved.userId, resolved.selectedHouse.id).catch(() => []);
    const previewActualContextHouseId =
      typeof body?.actualContextHouseId === "string" && body.actualContextHouseId.trim()
        ? body.actualContextHouseId.trim()
        : resolved.selectedHouse.id;
    const greenButtonUpload = await loadGreenButtonUploadSummary(previewActualContextHouseId);
    const manualUsage =
      previewMode === "MANUAL_MONTHLY" || previewMode === "MANUAL_ANNUAL"
        ? await getOnePathManualUsageInput({ userId: resolved.userId, houseId: resolved.selectedHouse.id }).catch(() => ({
            payload: null,
            updatedAt: null,
          }))
        : { payload: null, updatedAt: null };
    const adminManualSeeds =
      (previewMode === "MANUAL_MONTHLY" || previewMode === "MANUAL_ANNUAL") &&
      needsManualSeedForMode(previewMode, manualUsage.payload ?? null)
        ? await buildOnePathAdminManualSeeds({
            userId: resolved.userId,
            houseId: resolved.selectedHouse.id,
            actualContextHouseId: previewActualContextHouseId,
            payload: manualUsage.payload ?? null,
            dbTravelRanges: travelRangesFromDb,
          })
        : null;
    const effectiveManualUsagePayload =
      previewMode === "MANUAL_MONTHLY" || previewMode === "MANUAL_ANNUAL"
        ? adminManualSeeds?.payloadForMode[previewMode] ?? manualUsage.payload ?? null
        : null;
    return NextResponse.json({
      ok: true,
      email: resolved.email,
      userId: resolved.userId,
      houses: resolved.houses,
      selectedHouse: resolved.selectedHouse,
      scenarios: resolved.scenarios,
      sourceContext: {
        debugDiagnosticsIncluded: false,
        travelRangesFromDb,
        greenButtonUpload,
        ...(effectiveManualUsagePayload
          ? {
              manualStageOneView: buildOnePathManualStageOnePreview(effectiveManualUsagePayload),
              effectiveManualUsagePayload,
              manualSeed: adminManualSeeds?.seed ?? null,
              manualUsageUpdatedAt: manualUsage.updatedAt ?? null,
            }
          : {}),
      },
    });
  }

  const previewActualContextHouse =
    resolved.houses.find(
      (house) =>
        house.id ===
        (typeof body?.actualContextHouseId === "string" && body.actualContextHouseId.trim()
          ? body.actualContextHouseId.trim()
          : resolved.selectedHouse.id)
    ) ?? resolved.selectedHouse;
  const actualContextGreenButtonUpload = await loadGreenButtonUploadSummary(previewActualContextHouse.id);
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
      preferredActualSource: previewMode === "GREEN_BUTTON" ? "GREEN_BUTTON" : null,
    }).catch(() => null),
    getOnePathManualUsageInput({ userId: resolved.userId, houseId: resolved.selectedHouse.id }).catch(() => ({
      payload: null,
      updatedAt: null,
    })),
    getHomeProfileReadOnlyByUserHouse({ userId: resolved.userId, houseId: resolved.selectedHouse.id }).catch(() => null),
    getApplianceProfileSimulatedByUserHouse({ userId: resolved.userId, houseId: resolved.selectedHouse.id }).catch(() => null),
    getOnePathTravelRangesFromDb(resolved.userId, resolved.selectedHouse.id).catch(() => []),
  ]);
  const applianceProfile = normalizeStoredApplianceProfile((applianceProfileRecord as any)?.appliancesJson ?? null);
  const adminManualSeeds =
    (previewMode === "MANUAL_MONTHLY" || previewMode === "MANUAL_ANNUAL") &&
    needsManualSeedForMode(previewMode, manualUsage.payload ?? null)
      ? await buildOnePathAdminManualSeeds({
          userId: resolved.userId,
          houseId: resolved.selectedHouse.id,
          actualContextHouseId: previewActualContextHouse.id,
          payload: manualUsage.payload ?? null,
          dbTravelRanges: travelRangesFromDb,
        })
      : null;
  const effectiveManualUsagePayload =
    previewMode === "MANUAL_MONTHLY" || previewMode === "MANUAL_ANNUAL"
      ? applyExplicitTravelRangesToManualPayload(
          adminManualSeeds?.payloadForMode[previewMode] ?? manualUsage.payload ?? null,
          body?.travelRanges
        )
      : null;
  const weatherEnvelope = await resolveOnePathWeatherSensitivityEnvelope({
    actualDataset:
      previewMode === "MANUAL_MONTHLY" || previewMode === "MANUAL_ANNUAL" ? null : usageTruth?.dataset ?? null,
    manualUsagePayload: effectiveManualUsagePayload,
    homeProfile,
    applianceProfile,
    weatherHouseId: previewActualContextHouse.id,
    simulationVariablePolicy: previewSimulationVariablePolicy,
  }).catch(() => ({ score: null, derivedInput: null }));
  const previewLookupSourceContext = {
    actualDatasetSummary: usageTruth?.dataset?.summary ?? null,
    actualDatasetMeta: (usageTruth?.dataset as any)?.meta ?? null,
    usageTruthSource: usageTruth?.usageTruthSource ?? "missing_usage_truth",
    usageTruthSeedResult: usageTruth?.seedResult ?? null,
    upstreamUsageTruth: usageTruth?.summary ?? null,
    greenButtonUpload: actualContextGreenButtonUpload,
    manualUsagePayload: manualUsage.payload ?? null,
    effectiveManualUsagePayload,
    manualUsageUpdatedAt: manualUsage.updatedAt ?? null,
    manualStageOneView: buildOnePathManualStageOnePreview(effectiveManualUsagePayload),
    manualSeed: adminManualSeeds?.seed ?? null,
    travelRangesFromDb,
    homeProfile: homeProfile ?? null,
    applianceProfile: applianceProfile ?? null,
    weatherScore: weatherEnvelope.score ?? null,
    weatherDerivedInput: weatherEnvelope.derivedInput ?? null,
  } as const;
  const compactLookupBaselineResponse = previewMode === "GREEN_BUTTON";
  const userUsagePageBaselineContract = compactLookupBaselineResponse
    ? null
    : await buildUserUsageHouseContract({
        userId: resolved.userId,
        house: {
          id: resolved.selectedHouse.id,
          label: resolved.selectedHouse.label ?? null,
          esiid: resolved.selectedHouse.esiid ?? null,
        },
      }).catch(() => null);
  const userUsageBaselineContract = await buildUserUsageHouseContract({
    userId: resolved.userId,
    house: {
      id: resolved.selectedHouse.id,
      label: resolved.selectedHouse.label ?? null,
      esiid: resolved.selectedHouse.esiid ?? null,
    },
    resolvedUsage: usageTruth
      ? {
          dataset: usageTruth.dataset ?? null,
          alternatives: usageTruth.alternatives ?? { smt: null, greenButton: null },
        }
      : { dataset: null, alternatives: { smt: null, greenButton: null } },
    homeProfile: homeProfile ?? null,
    applianceProfileRecord: applianceProfileRecord ?? null,
    manualUsageRecord: manualUsage ?? null,
    weatherSensitivity: weatherEnvelope,
  }).catch(() => null);
  const baselineParityAudit = buildOnePathBaselineParityAudit({
    houseContract: userUsageBaselineContract,
  });
  const baselineParityReport = compactLookupBaselineResponse
    ? null
    : buildBaselineParityReport({
        userUsagePageContract: userUsagePageBaselineContract,
        onePathBaselineContract: userUsageBaselineContract,
      });
  const userUsageBaselineView = buildOnePathBaselineReadOnlyView({
    houseContract: userUsageBaselineContract,
    parityAudit: baselineParityAudit,
  });
  const readOnlyAudit = buildKnownHouseScenarioPrereqStatus({
    scenario: {
      mode: previewMode,
      scenarioSelectionStrategy:
        typeof body?.scenarioId === "string" && body.scenarioId.trim() ? "scenario_id" : "baseline",
    },
    lookupSourceContext: previewLookupSourceContext,
  });
  const environmentVisibility = buildEnvironmentVisibility();
  const runtimeEnvParityTrace = buildRuntimeEnvParityTrace({
    environmentVisibility,
  });

  if (action === "lookup" || !action) {
    return NextResponse.json({
      ok: true,
      debugDiagnosticsIncluded: true,
      email: resolved.email,
      userId: resolved.userId,
      houses: resolved.houses,
      selectedHouse: resolved.selectedHouse,
      scenarios: resolved.scenarios,
      sourceContext: {
        ...previewLookupSourceContext,
        userUsagePageBaselineContract: compactLookupBaselineResponse ? null : userUsagePageBaselineContract,
        userUsageBaselineContract: compactLookupBaselineResponse ? null : userUsageBaselineContract,
        userUsageBaselineView: compactLookupBaselineResponse ? userUsageBaselineView : null,
        baselineParityAudit,
        baselineParityReport,
        environmentVisibility,
        runtimeEnvParityTrace,
        readOnlyAudit,
      },
    });
  }

  return NextResponse.json({ ok: false, error: "unsupported_action" }, { status: 400 });
}
