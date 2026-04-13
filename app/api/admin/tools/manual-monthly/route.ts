import { NextRequest, NextResponse } from "next/server";
import { lookupAdminHousesByEmail } from "@/lib/admin/adminHouseLookup";
import { prisma } from "@/lib/db";
import { getActualUsageDatasetForHouse } from "@/lib/usage/actualDatasetForHouse";
import { gateManualMonthlyLabAdmin, resolveManualMonthlyLabOwnerUserId } from "./_helpers";
import { getApplianceProfileSimulatedByUserHouse } from "@/modules/applianceProfile/repo";
import { getHomeProfileSimulatedByUserHouse } from "@/modules/homeProfile/repo";
import {
  resolveSharedManualStageOneContract,
} from "@/modules/manualUsage/prefill";
import { normalizeTravelRanges as normalizeManualTravelRanges } from "@/modules/manualUsage/statementRanges";
import { getManualUsageInputForUserHouse, saveManualUsageInputForUserHouse } from "@/modules/manualUsage/store";
import { buildManualUsagePastSimReadResult } from "@/modules/manualUsage/pastSimReadResult";
import type { ManualUsagePayload, TravelRange } from "@/modules/simulatedUsage/types";
import {
  ensureGlobalManualMonthlyLabTestHomeHouse,
  replaceGlobalManualMonthlyLabTestHomeFromSource,
} from "@/modules/usageSimulator/labTestHome";
import { getTravelRangesFromDb } from "@/app/api/admin/tools/gapfill-lab/gapfillLabRouteHelpers";
import { dispatchPastSimRecalc } from "@/modules/usageSimulator/pastSimRecalcDispatch";
import { resolveUserValidationPolicy } from "@/modules/usageSimulator/pastSimPolicy";
import { resolveUserWeatherLogicSetting } from "@/modules/usageSimulator/pastSimWeatherPolicy";
import { classifySimulationFailure } from "@/modules/usageSimulator/simulationDataAlerts";
import {
  getUserDefaultValidationSelectionMode,
} from "@/modules/usageSimulator/service";
import { getMemoryRssMb, logSimPipelineEvent } from "@/modules/usageSimulator/simObservability";
import type { WeatherPreference } from "@/modules/weatherNormalization/normalizer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const WORKSPACE_PAST_NAME = "Past (Corrected)";

async function resolveSourceUserAndHouse(emailRaw: string, preferredHouseId?: string | null) {
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

async function resolvePreferredPastScenarioId(args: {
  userId: string;
  houseId: string;
  preferredScenarioId?: string | null;
}): Promise<string | null> {
  const preferred = String(args.preferredScenarioId ?? "").trim();
  if (!preferred) return null;
  const row = await (prisma as any).usageSimulatorScenario.findFirst({
    where: {
      id: preferred,
      userId: args.userId,
      houseId: args.houseId,
      name: WORKSPACE_PAST_NAME,
      archivedAt: null,
    },
    select: { id: true },
  });
  return row?.id ?? null;
}

async function ensurePastScenarioId(args: { userId: string; houseId: string }): Promise<string> {
  const existing = await findPastScenarioId(args);
  if (existing) return existing;
  const created = await (prisma as any).usageSimulatorScenario.create({
    data: {
      userId: args.userId,
      houseId: args.houseId,
      name: WORKSPACE_PAST_NAME,
    },
    select: { id: true },
  });
  return String(created.id);
}

async function buildReadResult(args: {
  userId: string;
  houseId: string;
  scenarioId: string | null;
  readMode: "artifact_only" | "allow_rebuild";
  correlationId?: string | null;
  exactArtifactInputHash?: string | null;
  requireExactArtifactMatch?: boolean;
  actualDataset?: any;
}) {
  return buildManualUsagePastSimReadResult({
    userId: args.userId,
    houseId: args.houseId,
    scenarioId: args.scenarioId,
    readMode: args.readMode,
    correlationId: args.correlationId ?? null,
    exactArtifactInputHash: args.exactArtifactInputHash ?? null,
    requireExactArtifactMatch: args.requireExactArtifactMatch === true,
    callerType: "user_past",
    actualDataset: args.actualDataset,
  });
}

function statusForReadResultFailure(result: {
  error?: string | null;
  failureCode?: string | null;
}): number {
  const code = String(result.failureCode ?? result.error ?? "").trim();
  switch (code) {
    case "past_scenario_missing":
    case "NO_BUILD":
    case "SCENARIO_NOT_FOUND":
    case "ARTIFACT_MISSING":
      return 404;
    case "HOUSE_NOT_FOUND":
      return 403;
    case "COMPARE_TRUTH_INCOMPLETE":
      return 409;
    default:
      return 500;
  }
}

function buildAdminManualRecalcFailure(args: {
  error?: string | null;
  missingItems?: string[] | null;
  fallbackMessage: string;
}) {
  const detail = Array.isArray(args.missingItems) && args.missingItems.length > 0
    ? args.missingItems.join("; ")
    : args.fallbackMessage;
  const classification = classifySimulationFailure({
    code: args.error,
    error: args.error,
    message: detail,
  });
  const normalizedDetail = detail.toLowerCase();
  const reasonCode =
    normalizedDetail.includes("p2024") ||
    normalizedDetail.includes("connection pool") ||
    normalizedDetail.includes("timed out fetching a new connection") ||
    normalizedDetail.includes("connection limit: 1")
      ? "PRISMA_POOL_EXHAUSTION"
      : classification.reasonCode;
  return {
    status: String(args.error ?? "").trim() === "recalc_timeout" ? 504 : 500,
    body: {
      ok: false,
      error: args.error ?? "recalc_failed",
      message: classification.userFacingExplanation,
      detail,
      failureCode: reasonCode,
      failureMessage: detail,
      reasonCode,
    },
  };
}

function normalizeTravelRanges(payload: ManualUsagePayload | null): TravelRange[] {
  return normalizeManualTravelRanges(Array.isArray(payload?.travelRanges) ? payload!.travelRanges : []);
}

async function buildSourceUsageHouse(selectedSourceHouse: {
  id: string;
  label: string;
  esiid?: string | null;
  addressLine1?: string | null;
  addressCity?: string | null;
  addressState?: string | null;
}) {
  const actual = await getActualUsageDatasetForHouse(selectedSourceHouse.id, selectedSourceHouse.esiid ?? null, {
    skipFullYearIntervalFetch: true,
  }).catch(() => ({ dataset: null, alternatives: { smt: null, greenButton: null } }));
  if (!actual?.dataset) return null;
  return {
    houseId: selectedSourceHouse.id,
    label: selectedSourceHouse.label,
    address: {
      line1: selectedSourceHouse.addressLine1 ?? null,
      city: selectedSourceHouse.addressCity ?? null,
      state: selectedSourceHouse.addressState ?? null,
    },
    esiid: selectedSourceHouse.esiid ?? null,
    dataset: actual.dataset,
    alternatives: actual.alternatives ?? { smt: null, greenButton: null },
  };
}

function stripIntervalHeavyDatasetFields(dataset: any) {
  if (!dataset || typeof dataset !== "object") return dataset;
  const series = dataset.series && typeof dataset.series === "object" ? dataset.series : null;
  const insights = dataset.insights && typeof dataset.insights === "object" ? dataset.insights : null;
  return {
    ...dataset,
    series: series
      ? {
          ...series,
          intervals15: Array.isArray((series as any).intervals15) ? [] : (series as any).intervals15,
        }
      : dataset.series,
    insights: insights
      ? {
          ...insights,
          fifteenMinuteAverages: Array.isArray((insights as any).fifteenMinuteAverages) ? [] : (insights as any).fifteenMinuteAverages,
          timeOfDayBuckets: Array.isArray((insights as any).timeOfDayBuckets) ? [] : (insights as any).timeOfDayBuckets,
        }
      : dataset.insights,
    intervals15m: Array.isArray(dataset.intervals15m) ? [] : dataset.intervals15m,
  };
}

function summarizeDailyWeatherMap(dailyWeather: any) {
  if (!dailyWeather || typeof dailyWeather !== "object" || Array.isArray(dailyWeather)) return dailyWeather;
  const dateKeys = Object.keys(dailyWeather)
    .filter((key) => /^\d{4}-\d{2}-\d{2}$/.test(key))
    .sort();
  return {
    redacted: true,
    count: dateKeys.length,
    startDate: dateKeys[0] ?? null,
    endDate: dateKeys[dateKeys.length - 1] ?? null,
  };
}

function buildMonthlyOnlySourceDataset(dataset: any) {
  if (!dataset || typeof dataset !== "object") return dataset;
  const series = dataset.series && typeof dataset.series === "object" ? dataset.series : null;
  const insights = dataset.insights && typeof dataset.insights === "object" ? dataset.insights : null;
  return {
    ...dataset,
    series: series
      ? {
          monthly: Array.isArray((series as any).monthly) ? (series as any).monthly : [],
          annual: Array.isArray((series as any).annual) ? (series as any).annual : [],
          intervals15: [],
          hourly: [],
          daily: [],
        }
      : dataset.series,
    insights: insights
      ? {
          ...insights,
          fifteenMinuteAverages: Array.isArray((insights as any).fifteenMinuteAverages) ? [] : (insights as any).fifteenMinuteAverages,
          timeOfDayBuckets: Array.isArray((insights as any).timeOfDayBuckets) ? [] : (insights as any).timeOfDayBuckets,
        }
      : dataset.insights,
    daily: Array.isArray(dataset.daily) ? [] : dataset.daily,
    intervals15m: Array.isArray(dataset.intervals15m) ? [] : dataset.intervals15m,
    dailyWeather: summarizeDailyWeatherMap(dataset.dailyWeather),
  };
}

function buildSourceUsageHouseResponse(sourceUsageHouse: Awaited<ReturnType<typeof buildSourceUsageHouse>>) {
  if (!sourceUsageHouse) return null;
  return {
    ...sourceUsageHouse,
    dataset: buildMonthlyOnlySourceDataset(sourceUsageHouse.dataset),
  };
}

function summarizeReadResultForLabResponse(readResult: Awaited<ReturnType<typeof buildReadResult>>) {
  if (!readResult || readResult.ok !== true) return readResult;
  return {
    ...readResult,
    dataset: stripIntervalHeavyDatasetFields(readResult.dataset),
  };
}

async function buildLabPrefill(args: {
  sourcePayload: ManualUsagePayload | null;
  sourceUsageHouse: Awaited<ReturnType<typeof buildSourceUsageHouse>>;
  canonicalTravelRanges?: TravelRange[];
}) {
  const effectiveTravelRanges =
    Array.isArray(args.canonicalTravelRanges) && args.canonicalTravelRanges.length > 0
      ? normalizeManualTravelRanges(args.canonicalTravelRanges)
      : normalizeTravelRanges(args.sourcePayload);
  const sourcePayloadWithCanonicalTravelRanges =
    args.sourcePayload && effectiveTravelRanges.length > 0
      ? ({
          ...args.sourcePayload,
          travelRanges: effectiveTravelRanges,
        } as ManualUsagePayload)
      : args.sourcePayload;
  const resolved = resolveSharedManualStageOneContract({
    mode: "MONTHLY",
    sourcePayload: sourcePayloadWithCanonicalTravelRanges,
    actualEndDate: String(args.sourceUsageHouse?.dataset?.summary?.end ?? "").slice(0, 10) || null,
    travelRanges: effectiveTravelRanges,
    dailyRows: args.sourceUsageHouse?.dataset?.daily ?? [],
  });
  if (!resolved.seedSet.anchorEndDate || !resolved.payload) {
    return {
      payloadToPersist: null,
      seed: {
        sourceMode: resolved.seedSet.sourceMode,
        monthly: resolved.seedSet.usableSourceMonthlyPayload ?? resolved.seedSet.monthlySeed,
        annual: resolved.seedSet.usableSourceAnnualPayload ?? resolved.seedSet.annualSeed,
      },
    };
  }
  return {
    payloadToPersist:
      resolved.mode === "MONTHLY" && resolved.payload.mode === "MONTHLY"
        ? {
            ...resolved.payload,
            dateSourceMode: resolved.payload.dateSourceMode ?? (resolved.payloadSource === "source_payload" ? "CUSTOMER_DATES" : undefined),
          }
        : resolved.payload,
    seed: {
      sourceMode: resolved.seedSet.sourceMode,
      monthly: resolved.seedSet.usableSourceMonthlyPayload ?? resolved.seedSet.monthlySeed,
      annual: resolved.seedSet.usableSourceAnnualPayload ?? resolved.seedSet.annualSeed,
    },
  };
}

export async function POST(req: NextRequest) {
  const denied = gateManualMonthlyLabAdmin(req);
  if (denied) return denied;

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "").trim();
    const sourceResolved = await resolveSourceUserAndHouse(body?.email, body?.houseId);
    if (!sourceResolved.ok) {
      const status =
        sourceResolved.error === "email_required"
          ? 400
          : sourceResolved.error === "user_not_found" || sourceResolved.error === "house_not_found"
            ? 404
            : 400;
      return NextResponse.json({ ok: false, error: sourceResolved.error }, { status });
    }

    const ownerUserId = await resolveManualMonthlyLabOwnerUserId(req);
    if (!ownerUserId) {
      return NextResponse.json({ ok: false, error: "lab_owner_not_found" }, { status: 400 });
    }

    const labHome = await ensureGlobalManualMonthlyLabTestHomeHouse(ownerUserId);
    const preferredScenarioId = await resolvePreferredPastScenarioId({
      userId: ownerUserId,
      houseId: labHome.id,
      preferredScenarioId: body?.scenarioId,
    });
    const scenarioId = preferredScenarioId ?? (await ensurePastScenarioId({ userId: ownerUserId, houseId: labHome.id }));

    if (action === "lookup") {
      return NextResponse.json({
        ok: true,
        action,
        email: sourceResolved.email,
        userId: ownerUserId,
        sourceUserId: sourceResolved.userId,
        houses: sourceResolved.houses,
        selectedHouse: sourceResolved.selectedHouse,
        selectedSourceHouse: sourceResolved.selectedHouse,
        labHome,
        scenarioId,
      });
    }

    const [sourcePayloadRecord, sourceHomeProfile, sourceApplianceProfile, sourceUsageHouse] = await Promise.all([
      getManualUsageInputForUserHouse({ userId: sourceResolved.userId, houseId: sourceResolved.selectedHouse.id }),
      getHomeProfileSimulatedByUserHouse({ userId: sourceResolved.userId, houseId: sourceResolved.selectedHouse.id }),
      getApplianceProfileSimulatedByUserHouse({ userId: sourceResolved.userId, houseId: sourceResolved.selectedHouse.id }),
      buildSourceUsageHouse(sourceResolved.selectedHouse),
    ]);
    const sourceUsageHouseResponse = buildSourceUsageHouseResponse(sourceUsageHouse);

    if (action === "load") {
      const sourceTravelRangesFromDb = await getTravelRangesFromDb(sourceResolved.userId, sourceResolved.selectedHouse.id);
      const replaced = await replaceGlobalManualMonthlyLabTestHomeFromSource({
        ownerUserId,
        sourceUserId: sourceResolved.userId,
        sourceHouseId: sourceResolved.selectedHouse.id,
      });
      if (!replaced.ok) {
        return NextResponse.json(
          {
            ok: false,
            action,
            error: replaced.error ?? "replace_manual_monthly_lab_test_home_failed",
            message: replaced.message ?? "Failed to replace the isolated lab home from the selected source house.",
          },
          { status: 400 }
        );
      }

      const labSeed = await buildLabPrefill({
        sourcePayload: sourcePayloadRecord.payload,
        sourceUsageHouse,
        canonicalTravelRanges: sourceTravelRangesFromDb,
      });

      let payload = await getManualUsageInputForUserHouse({ userId: ownerUserId, houseId: labHome.id });
      if (labSeed.payloadToPersist) {
        const saved = await saveManualUsageInputForUserHouse({
          userId: ownerUserId,
          houseId: labHome.id,
          payload: labSeed.payloadToPersist,
        });
        if (!saved.ok) {
          return NextResponse.json(
            {
              ok: false,
              action,
              error: saved.error,
              message: "Failed to persist the derived prefill payload for the isolated lab home.",
            },
            { status: 400 }
          );
        }
        payload = { payload: saved.payload, updatedAt: saved.updatedAt };
      }

      const [labHomeProfile, labApplianceProfile, readResult] = await Promise.all([
        getHomeProfileSimulatedByUserHouse({ userId: ownerUserId, houseId: labHome.id }),
        getApplianceProfileSimulatedByUserHouse({ userId: ownerUserId, houseId: labHome.id }),
        buildReadResult({
          userId: ownerUserId,
          houseId: labHome.id,
          scenarioId,
          readMode: "artifact_only",
          actualDataset: sourceUsageHouse?.dataset ?? null,
        }),
      ]);

      return NextResponse.json({
        ok: true,
        action,
        email: sourceResolved.email,
        userId: ownerUserId,
        sourceUserId: sourceResolved.userId,
        selectedHouse: sourceResolved.selectedHouse,
        selectedSourceHouse: sourceResolved.selectedHouse,
        labHome,
        scenarioId,
        payload: payload.payload,
        updatedAt: payload.updatedAt,
        sourcePayload: sourcePayloadRecord.payload,
        sourceUpdatedAt: sourcePayloadRecord.updatedAt,
        sourceUsageHouse: sourceUsageHouseResponse,
        sourceHomeProfile,
        sourceApplianceProfile,
        labHomeProfile,
        labApplianceProfile,
        seed: labSeed.seed,
        readResult: summarizeReadResultForLabResponse(readResult),
      });
    }

    if (action === "save") {
      const payload = body?.payload as ManualUsagePayload | null;
      if (!payload) return NextResponse.json({ ok: false, error: "payload_required" }, { status: 400 });
      const saved = await saveManualUsageInputForUserHouse({
        userId: ownerUserId,
        houseId: labHome.id,
        payload,
      });
      if (!saved.ok) return NextResponse.json(saved, { status: 400 });
      return NextResponse.json({
        ok: true,
        action,
        email: sourceResolved.email,
        userId: ownerUserId,
        sourceUserId: sourceResolved.userId,
        selectedHouse: sourceResolved.selectedHouse,
        selectedSourceHouse: sourceResolved.selectedHouse,
        labHome,
        scenarioId,
        updatedAt: saved.updatedAt,
        payload: saved.payload,
      });
    }

    if (action === "recalc") {
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
      let dispatched: Awaited<ReturnType<typeof dispatchPastSimRecalc>>;
      try {
        dispatched = await dispatchPastSimRecalc({
          userId: ownerUserId,
          houseId: labHome.id,
          esiid: null,
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
      } catch (error: unknown) {
        const failure = buildAdminManualRecalcFailure({
          error: error instanceof Error ? error.name : "recalc_exception",
          missingItems: [error instanceof Error ? error.message : String(error)],
          fallbackMessage: "Manual recalc failed before the shared producer returned a persisted artifact.",
        });
        return NextResponse.json(
          {
            ...failure.body,
            action,
            email: sourceResolved.email,
            userId: ownerUserId,
            sourceUserId: sourceResolved.userId,
            selectedHouse: sourceResolved.selectedHouse,
            selectedSourceHouse: sourceResolved.selectedHouse,
            labHome,
            scenarioId,
          },
          { status: failure.status }
        );
      }
      if (dispatched.executionMode === "inline" && !dispatched.result.ok) {
        const failure = buildAdminManualRecalcFailure({
          error: dispatched.result.error,
          missingItems: dispatched.result.missingItems ?? null,
          fallbackMessage: String(dispatched.result.error ?? "Manual recalc failed."),
        });
        return NextResponse.json(
          {
            action,
            email: sourceResolved.email,
            userId: ownerUserId,
            sourceUserId: sourceResolved.userId,
            selectedHouse: sourceResolved.selectedHouse,
            selectedSourceHouse: sourceResolved.selectedHouse,
            labHome,
            scenarioId,
            executionMode: "inline",
            correlationId: dispatched.correlationId,
            result: dispatched.result,
            ...failure.body,
          },
          { status: failure.status }
        );
      }
      if (dispatched.executionMode === "inline") {
        const inlineResult = dispatched.result;
        const canonicalArtifactInputHash =
          inlineResult.ok &&
          typeof inlineResult.canonicalArtifactInputHash === "string" &&
          inlineResult.canonicalArtifactInputHash.trim()
            ? inlineResult.canonicalArtifactInputHash.trim()
            : null;
        logSimPipelineEvent("admin_manual_monthly_recalc_response_ready", {
          correlationId: dispatched.correlationId,
          houseId: labHome.id,
          sourceHouseId: sourceResolved.selectedHouse.id,
          scenarioId,
          executionMode: "inline",
          readbackPending: true,
          artifactInputHash: canonicalArtifactInputHash,
          memoryRssMb: getMemoryRssMb(),
          source: "admin_manual_monthly_route",
        });
        const response = NextResponse.json({
          ok: true,
          action,
          email: sourceResolved.email,
          userId: ownerUserId,
          sourceUserId: sourceResolved.userId,
          selectedHouse: sourceResolved.selectedHouse,
          selectedSourceHouse: sourceResolved.selectedHouse,
          labHome,
          scenarioId,
          executionMode: "inline",
          correlationId: dispatched.correlationId,
          readbackPending: true,
          canonicalArtifactInputHash,
          jobId: null,
          result: inlineResult,
          readResult: null,
        });
        logSimPipelineEvent("admin_manual_monthly_recalc_response_sent", {
          correlationId: dispatched.correlationId,
          houseId: labHome.id,
          sourceHouseId: sourceResolved.selectedHouse.id,
          scenarioId,
          executionMode: "inline",
          readbackPending: true,
          artifactInputHash: canonicalArtifactInputHash,
          httpStatus: response.status,
          memoryRssMb: getMemoryRssMb(),
          source: "admin_manual_monthly_route",
        });
        return response;
      }
      logSimPipelineEvent("admin_manual_monthly_recalc_response_ready", {
        correlationId: dispatched.correlationId,
        houseId: labHome.id,
        sourceHouseId: sourceResolved.selectedHouse.id,
        scenarioId,
        executionMode: "droplet_async",
        readbackPending: true,
        jobId: dispatched.jobId,
        memoryRssMb: getMemoryRssMb(),
        source: "admin_manual_monthly_route",
      });
      const response = NextResponse.json({
        ok: true,
        action,
        email: sourceResolved.email,
        userId: ownerUserId,
        sourceUserId: sourceResolved.userId,
        selectedHouse: sourceResolved.selectedHouse,
        selectedSourceHouse: sourceResolved.selectedHouse,
        labHome,
        scenarioId,
        executionMode: "droplet_async",
        correlationId: dispatched.correlationId,
        jobId: dispatched.jobId,
        result: null,
      });
      logSimPipelineEvent("admin_manual_monthly_recalc_response_sent", {
        correlationId: dispatched.correlationId,
        houseId: labHome.id,
        sourceHouseId: sourceResolved.selectedHouse.id,
        scenarioId,
        executionMode: "droplet_async",
        readbackPending: true,
        jobId: dispatched.jobId,
        httpStatus: response.status,
        memoryRssMb: getMemoryRssMb(),
        source: "admin_manual_monthly_route",
      });
      return response;
    }

    if (action === "read_result") {
      const exactArtifactInputHash =
        typeof body?.exactArtifactInputHash === "string" && body.exactArtifactInputHash.trim()
          ? body.exactArtifactInputHash.trim()
          : null;
      const correlationId =
        typeof body?.correlationId === "string" && body.correlationId.trim() ? body.correlationId.trim() : null;
      logSimPipelineEvent("admin_manual_monthly_read_result_start", {
        correlationId,
        houseId: labHome.id,
        sourceHouseId: sourceResolved.selectedHouse.id,
        scenarioId,
        artifactInputHash: exactArtifactInputHash,
        requireExactArtifactMatch: exactArtifactInputHash != null,
        memoryRssMb: getMemoryRssMb(),
        source: "admin_manual_monthly_route",
      });
      const actualUsageResult = await getActualUsageDatasetForHouse(
        sourceResolved.selectedHouse.id,
        sourceResolved.selectedHouse.esiid ?? null,
        { skipFullYearIntervalFetch: true }
      ).catch(() => ({ dataset: null }));
      const readResult = await buildReadResult({
        userId: ownerUserId,
        houseId: labHome.id,
        scenarioId,
        readMode: "artifact_only",
        correlationId,
        exactArtifactInputHash,
        requireExactArtifactMatch: exactArtifactInputHash != null,
        actualDataset: actualUsageResult?.dataset ?? null,
      });
      if (readResult.ok) {
        logSimPipelineEvent("admin_manual_monthly_read_result_success", {
          correlationId,
          houseId: labHome.id,
          sourceHouseId: sourceResolved.selectedHouse.id,
          scenarioId,
          artifactInputHash: exactArtifactInputHash,
          dayCount: Array.isArray((readResult.dataset as any)?.daily) ? (readResult.dataset as any).daily.length : 0,
          compareRowCount: Array.isArray((readResult.compareProjection as any)?.rows)
            ? (readResult.compareProjection as any).rows.length
            : 0,
          memoryRssMb: getMemoryRssMb(),
          source: "admin_manual_monthly_route",
        });
        const response = NextResponse.json({
          ok: true,
          action,
          email: sourceResolved.email,
          userId: ownerUserId,
          sourceUserId: sourceResolved.userId,
          selectedHouse: sourceResolved.selectedHouse,
          selectedSourceHouse: sourceResolved.selectedHouse,
          labHome,
          scenarioId,
          readResult,
        });
        logSimPipelineEvent("admin_manual_monthly_read_result_response_sent", {
          correlationId,
          houseId: labHome.id,
          sourceHouseId: sourceResolved.selectedHouse.id,
          scenarioId,
          artifactInputHash: exactArtifactInputHash,
          httpStatus: response.status,
          memoryRssMb: getMemoryRssMb(),
          source: "admin_manual_monthly_route",
        });
        return response;
      }
      logSimPipelineEvent("admin_manual_monthly_read_result_failure", {
        correlationId,
        houseId: labHome.id,
        sourceHouseId: sourceResolved.selectedHouse.id,
        scenarioId,
        artifactInputHash: exactArtifactInputHash,
        failureCode: readResult.failureCode ?? readResult.error ?? null,
        failureMessage: readResult.failureMessage ?? readResult.message ?? null,
        memoryRssMb: getMemoryRssMb(),
        source: "admin_manual_monthly_route",
      });
      const response = NextResponse.json(
        {
          action,
          email: sourceResolved.email,
          userId: ownerUserId,
          sourceUserId: sourceResolved.userId,
          selectedHouse: sourceResolved.selectedHouse,
          selectedSourceHouse: sourceResolved.selectedHouse,
          labHome,
          scenarioId,
          ...readResult,
        },
        { status: statusForReadResultFailure(readResult) }
      );
      logSimPipelineEvent("admin_manual_monthly_read_result_response_sent", {
        correlationId,
        houseId: labHome.id,
        sourceHouseId: sourceResolved.selectedHouse.id,
        scenarioId,
        artifactInputHash: exactArtifactInputHash,
        failureCode: readResult.failureCode ?? readResult.error ?? null,
        httpStatus: response.status,
        memoryRssMb: getMemoryRssMb(),
        source: "admin_manual_monthly_route",
      });
      return response;
    }

    return NextResponse.json({ ok: false, error: "action_invalid" }, { status: 400 });
  } catch (error) {
    console.error("[admin/tools/manual-monthly] failed", error);
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}