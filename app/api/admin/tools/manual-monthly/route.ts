import { NextRequest, NextResponse } from "next/server";
import { lookupAdminHousesByEmail } from "@/lib/admin/adminHouseLookup";
import { prisma } from "@/lib/db";
import { getActualUsageDatasetForHouse } from "@/lib/usage/actualDatasetForHouse";
import { gateManualMonthlyLabAdmin, resolveManualMonthlyLabOwnerUserId } from "./_helpers";
import { getApplianceProfileSimulatedByUserHouse } from "@/modules/applianceProfile/repo";
import { getHomeProfileSimulatedByUserHouse } from "@/modules/homeProfile/repo";
import {
  buildManualUsageStageOneResolvedSeeds,
} from "@/modules/manualUsage/prefill";
import { getManualUsageInputForUserHouse, saveManualUsageInputForUserHouse } from "@/modules/manualUsage/store";
import { buildManualUsagePastSimReadResult } from "@/modules/manualUsage/pastSimReadResult";
import type { ManualUsagePayload, TravelRange } from "@/modules/simulatedUsage/types";
import {
  ensureGlobalManualMonthlyLabTestHomeHouse,
  replaceGlobalManualMonthlyLabTestHomeFromSource,
} from "@/modules/usageSimulator/labTestHome";
import { dispatchPastSimRecalc } from "@/modules/usageSimulator/pastSimRecalcDispatch";
import { resolveUserValidationPolicy } from "@/modules/usageSimulator/pastSimPolicy";
import { resolveUserWeatherLogicSetting } from "@/modules/usageSimulator/pastSimWeatherPolicy";
import {
  getUserDefaultValidationSelectionMode,
} from "@/modules/usageSimulator/service";
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
}) {
  return buildManualUsagePastSimReadResult({
    userId: args.userId,
    houseId: args.houseId,
    scenarioId: args.scenarioId,
    readMode: args.readMode,
    callerType: "user_past",
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

function normalizeTravelRanges(payload: ManualUsagePayload | null): TravelRange[] {
  return Array.isArray(payload?.travelRanges) ? payload!.travelRanges : [];
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
}) {
  const travelRanges = normalizeTravelRanges(args.sourcePayload);
  const actualEndDate =
    String(
      args.sourceUsageHouse?.dataset?.summary?.end ??
        ""
    ).slice(0, 10) || null;
  const seedSet = buildManualUsageStageOneResolvedSeeds({
    sourcePayload: args.sourcePayload,
    actualEndDate,
    travelRanges,
    dailyRows: args.sourceUsageHouse?.dataset?.daily ?? [],
  });
  const anchorEndDate = seedSet.anchorEndDate;
  if (!anchorEndDate) {
    return {
      payloadToPersist: null,
      seed: {
        sourceMode: seedSet.sourceMode,
        monthly: seedSet.usableSourceMonthlyPayload ?? seedSet.monthlySeed,
        annual: seedSet.usableSourceAnnualPayload ?? seedSet.annualSeed,
      },
    };
  }
  return {
    payloadToPersist: seedSet.usableSourceMonthlyPayload ? null : seedSet.monthlySeed,
    seed: {
      sourceMode: seedSet.sourceMode,
      monthly: seedSet.usableSourceMonthlyPayload ?? seedSet.monthlySeed,
      annual: seedSet.usableSourceAnnualPayload ?? seedSet.annualSeed,
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
    const [sourcePayloadRecord, sourceHomeProfile, sourceApplianceProfile, sourceUsageHouse] = await Promise.all([
      getManualUsageInputForUserHouse({ userId: sourceResolved.userId, houseId: sourceResolved.selectedHouse.id }),
      getHomeProfileSimulatedByUserHouse({ userId: sourceResolved.userId, houseId: sourceResolved.selectedHouse.id }),
      getApplianceProfileSimulatedByUserHouse({ userId: sourceResolved.userId, houseId: sourceResolved.selectedHouse.id }),
      buildSourceUsageHouse(sourceResolved.selectedHouse),
    ]);
    const sourceUsageHouseResponse = buildSourceUsageHouseResponse(sourceUsageHouse);

    if (action === "lookup") {
      const sourceSeed = await buildLabPrefill({
        sourcePayload: sourcePayloadRecord.payload,
        sourceUsageHouse,
      });
      const [payload, labHomeProfile, labApplianceProfile, currentResult] = await Promise.all([
        getManualUsageInputForUserHouse({ userId: ownerUserId, houseId: labHome.id }),
        getHomeProfileSimulatedByUserHouse({ userId: ownerUserId, houseId: labHome.id }),
        getApplianceProfileSimulatedByUserHouse({ userId: ownerUserId, houseId: labHome.id }),
        buildReadResult({
          userId: ownerUserId,
          houseId: labHome.id,
          scenarioId,
          readMode: "artifact_only",
        }),
      ]);
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
        payload: payload.payload,
        updatedAt: payload.updatedAt,
        sourcePayload: sourcePayloadRecord.payload,
        sourceUpdatedAt: sourcePayloadRecord.updatedAt,
        sourceSeed: sourceSeed.seed,
        sourceUsageHouse: sourceUsageHouseResponse,
        sourceHomeProfile,
        sourceApplianceProfile,
        labHomeProfile,
        labApplianceProfile,
        currentResult: summarizeReadResultForLabResponse(currentResult),
      });
    }

    if (action === "load") {
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
      const dispatched = await dispatchPastSimRecalc({
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
      if (dispatched.executionMode === "inline" && !dispatched.result.ok) {
        return NextResponse.json(
          {
            ok: false,
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
            error: dispatched.result.error,
          },
          { status: dispatched.result.error === "recalc_timeout" ? 504 : 400 }
        );
      }
      if (dispatched.executionMode === "inline") {
        const readResult = await buildReadResult({
          userId: ownerUserId,
          houseId: labHome.id,
          scenarioId,
          readMode: "artifact_only",
        });
        if (!readResult.ok) {
          return NextResponse.json(
            {
              ...readResult,
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
            },
            { status: statusForReadResultFailure(readResult) }
          );
        }
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
          executionMode: "inline",
          correlationId: dispatched.correlationId,
          jobId: null,
          result: dispatched.result,
          readResult,
        });
      }
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
        executionMode: "droplet_async",
        correlationId: dispatched.correlationId,
        jobId: dispatched.jobId,
        result: null,
      });
    }

    if (action === "read_result") {
      const readResult = await buildReadResult({
        userId: ownerUserId,
        houseId: labHome.id,
        scenarioId,
        readMode: "artifact_only",
      });
      if (readResult.ok) {
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
          readResult,
        });
      }
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
          ...readResult,
        },
        { status: statusForReadResultFailure(readResult) }
      );
    }

    return NextResponse.json({ ok: false, error: "action_invalid" }, { status: 400 });
  } catch (error) {
    console.error("[admin/tools/manual-monthly] failed", error);
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}