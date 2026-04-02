import { NextRequest, NextResponse } from "next/server";
import { lookupAdminHousesByEmail } from "@/lib/admin/adminHouseLookup";
import { prisma } from "@/lib/db";
import { getActualUsageDatasetForHouse } from "@/lib/usage/actualDatasetForHouse";
import { getHomeProfileSimulatedByUserHouse } from "@/modules/homeProfile/repo";
import { getApplianceProfileSimulatedByUserHouse } from "@/modules/applianceProfile/repo";
import { billingPeriodsEndingAt } from "@/modules/manualUsage/billingPeriods";
import { buildManualMonthlyReconciliation } from "@/modules/manualUsage/reconciliation";
import { getManualUsageInputForUserHouse, saveManualUsageInputForUserHouse } from "@/modules/manualUsage/store";
import type {
  AnnualManualUsagePayload,
  ManualUsagePayload,
  MonthlyManualUsagePayload,
  TravelRange,
} from "@/modules/simulatedUsage/types";
import { buildValidationCompareProjectionSidecar } from "@/modules/usageSimulator/compareProjection";
import {
  MANUAL_MONTHLY_LAB_TEST_HOME_LABEL,
  ensureGlobalManualMonthlyLabTestHomeHouse,
  replaceGlobalManualMonthlyLabTestHomeFromSource,
} from "@/modules/usageSimulator/labTestHome";
import { dispatchPastSimRecalc } from "@/modules/usageSimulator/pastSimRecalcDispatch";
import { resolveUserValidationPolicy } from "@/modules/usageSimulator/pastSimPolicy";
import { resolveUserWeatherLogicSetting } from "@/modules/usageSimulator/pastSimWeatherPolicy";
import { buildSharedPastSimDiagnostics } from "@/modules/usageSimulator/sharedDiagnostics";
import { getSimulatedUsageForHouseScenario, getUserDefaultValidationSelectionMode } from "@/modules/usageSimulator/service";
import type { WeatherPreference } from "@/modules/weatherNormalization/normalizer";
import { gateManualMonthlyLabAdmin, resolveManualMonthlyLabOwnerUserId } from "./_helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const WORKSPACE_PAST_NAME = "Past (Corrected)";

function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

function normalizeTravelRanges(payload: ManualUsagePayload | null): TravelRange[] {
  if (!payload || !Array.isArray(payload.travelRanges)) return [];
  return payload.travelRanges
    .map((range) => ({
      startDate: String(range?.startDate ?? "").slice(0, 10),
      endDate: String(range?.endDate ?? "").slice(0, 10),
    }))
    .filter((range) => isIsoDate(range.startDate) && isIsoDate(range.endDate));
}

function resolveAnchorDate(args: {
  requestedAnchorDate?: unknown;
  sourcePayload: ManualUsagePayload | null;
  actualDataset: any | null;
}): string | null {
  const requested = String(args.requestedAnchorDate ?? "").trim().slice(0, 10);
  if (isIsoDate(requested)) return requested;
  const payloadAnchor = String((args.sourcePayload as any)?.anchorEndDate ?? "").trim().slice(0, 10);
  if (isIsoDate(payloadAnchor)) return payloadAnchor;
  const latest = String(args.actualDataset?.summary?.latest ?? "").trim().slice(0, 10);
  if (isIsoDate(latest)) return latest;
  const dailyRows = Array.isArray(args.actualDataset?.daily) ? args.actualDataset.daily : [];
  const lastDailyDate = String(dailyRows[dailyRows.length - 1]?.date ?? "").trim().slice(0, 10);
  if (isIsoDate(lastDailyDate)) return lastDailyDate;
  return null;
}

function sumDailyRowsByRange(dailyRows: Array<{ date: string; kwh: number }>, startDate: string, endDate: string): number {
  let total = 0;
  for (const row of dailyRows) {
    const date = String(row?.date ?? "").slice(0, 10);
    const kwh = Number(row?.kwh ?? NaN);
    if (!isIsoDate(date) || !Number.isFinite(kwh)) continue;
    if (date < startDate || date > endDate) continue;
    total += kwh;
  }
  return round2(total);
}

function deriveMonthlySeedFromActual(args: {
  anchorEndDate: string | null;
  actualDataset: any | null;
  travelRanges: TravelRange[];
}): MonthlyManualUsagePayload | null {
  if (!isIsoDate(args.anchorEndDate)) return null;
  const dailyRows = Array.isArray(args.actualDataset?.daily) ? args.actualDataset.daily : [];
  if (!dailyRows.length) return null;
  const monthlyKwh = billingPeriodsEndingAt(args.anchorEndDate, 12).map((period) => ({
    month: period.id,
    kwh: sumDailyRowsByRange(dailyRows, period.startDate, period.endDate),
  }));
  return {
    mode: "MONTHLY",
    anchorEndDate: args.anchorEndDate,
    monthlyKwh,
    travelRanges: args.travelRanges,
  };
}

function deriveAnnualSeed(args: {
  anchorEndDate: string | null;
  actualDataset: any | null;
  sourcePayload: ManualUsagePayload | null;
  travelRanges: TravelRange[];
}): AnnualManualUsagePayload | null {
  if (args.sourcePayload?.mode === "ANNUAL" && isIsoDate(args.sourcePayload.anchorEndDate)) {
    return {
      mode: "ANNUAL",
      anchorEndDate: args.sourcePayload.anchorEndDate,
      annualKwh:
        typeof args.sourcePayload.annualKwh === "number" && Number.isFinite(args.sourcePayload.annualKwh)
          ? args.sourcePayload.annualKwh
          : "",
      travelRanges: normalizeTravelRanges(args.sourcePayload),
    };
  }
  if (!isIsoDate(args.anchorEndDate)) return null;
  const dailyRows = Array.isArray(args.actualDataset?.daily) ? args.actualDataset.daily : [];
  if (dailyRows.length > 0) {
    const annualKwh = round2(
      dailyRows.reduce((sum, row) => sum + (Number.isFinite(Number(row?.kwh)) ? Number(row.kwh) : 0), 0)
    );
    return {
      mode: "ANNUAL",
      anchorEndDate: args.anchorEndDate,
      annualKwh,
      travelRanges: args.travelRanges,
    };
  }
  if (args.sourcePayload?.mode === "MONTHLY") {
    const annualKwh = round2(
      (args.sourcePayload.monthlyKwh ?? []).reduce((sum, row) => sum + (typeof row.kwh === "number" ? row.kwh : 0), 0)
    );
    return {
      mode: "ANNUAL",
      anchorEndDate: isIsoDate(args.sourcePayload.anchorEndDate) ? args.sourcePayload.anchorEndDate : args.anchorEndDate,
      annualKwh,
      travelRanges: normalizeTravelRanges(args.sourcePayload),
    };
  }
  return null;
}

async function buildSourceUsageHouse(sourceHouse: {
  id: string;
  label?: string | null;
  addressLine1?: string | null;
  addressCity?: string | null;
  addressState?: string | null;
  esiid?: string | null;
}) {
  const actualResult = await getActualUsageDatasetForHouse(sourceHouse.id, sourceHouse.esiid ?? null).catch(() => null);
  return {
    houseId: sourceHouse.id,
    label: sourceHouse.label ?? sourceHouse.addressLine1 ?? "Home",
    address: {
      line1: sourceHouse.addressLine1 ?? "",
      city: sourceHouse.addressCity ?? null,
      state: sourceHouse.addressState ?? null,
    },
    esiid: sourceHouse.esiid ?? null,
    dataset: actualResult?.dataset ?? null,
    alternatives: { smt: null, greenButton: null },
    datasetError:
      actualResult?.dataset == null
        ? {
            code: "ACTUAL_DATA_UNAVAILABLE",
            explanation:
              "We could not load interval usage for this source home right now. This can happen when SMT/Green Button data is still syncing or temporarily unavailable.",
          }
        : null,
  };
}

async function buildLabPrefill(args: {
  sourceUserId: string;
  sourceHouse: {
    id: string;
    esiid?: string | null;
    label?: string | null;
    addressLine1?: string | null;
    addressCity?: string | null;
    addressState?: string | null;
  };
  requestedAnchorDate?: unknown;
}) {
  const sourcePayloadRecord = await getManualUsageInputForUserHouse({
    userId: args.sourceUserId,
    houseId: args.sourceHouse.id,
  });
  const sourceUsageHouse = await buildSourceUsageHouse(args.sourceHouse);
  const sourcePayload = sourcePayloadRecord.payload;
  const travelRanges = normalizeTravelRanges(sourcePayload);
  const anchorEndDate = resolveAnchorDate({
    requestedAnchorDate: args.requestedAnchorDate,
    sourcePayload,
    actualDataset: sourceUsageHouse.dataset,
  });
  const monthlySeed =
    sourcePayload?.mode === "MONTHLY"
      ? {
          mode: "MONTHLY" as const,
          anchorEndDate: sourcePayload.anchorEndDate,
          monthlyKwh: sourcePayload.monthlyKwh,
          travelRanges: normalizeTravelRanges(sourcePayload),
        }
      : deriveMonthlySeedFromActual({
          anchorEndDate,
          actualDataset: sourceUsageHouse.dataset,
          travelRanges,
        });
  const annualSeed = deriveAnnualSeed({
    anchorEndDate,
    actualDataset: sourceUsageHouse.dataset,
    sourcePayload,
    travelRanges,
  });
  const payloadToPersist = sourcePayload ?? monthlySeed ?? annualSeed ?? null;
  return {
    payloadToPersist,
    updatedAt: sourcePayloadRecord.updatedAt,
    sourcePayload,
    sourceUsageHouse,
    seed: {
      anchorEndDate,
      sourceMode: sourcePayload?.mode ?? (monthlySeed ? "ACTUAL_INTERVALS_MONTHLY_PREFILL" : annualSeed ? "ACTUAL_INTERVALS_ANNUAL_PREFILL" : null),
      monthly: monthlySeed,
      annual: annualSeed,
    },
  };
}

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

async function ensurePastScenarioId(args: { userId: string; houseId: string }): Promise<string> {
  const row = await (prisma as any).usageSimulatorScenario.findFirst({
    where: { userId: args.userId, houseId: args.houseId, name: WORKSPACE_PAST_NAME, archivedAt: null },
    select: { id: true },
  });
  if (row?.id) return String(row.id);
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
  const gate = gateManualMonthlyLabAdmin(req);
  if (gate) return gate;

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "").trim();
    const ownerUserId = await resolveManualMonthlyLabOwnerUserId(req);
    if (!ownerUserId) {
      return NextResponse.json({ ok: false, error: "lab_owner_not_found" }, { status: 400 });
    }
    const resolved = await resolveUserAndHouse(body?.email, body?.houseId);
    if (!resolved.ok) {
      const status =
        resolved.error === "email_required" ? 400 : resolved.error === "user_not_found" || resolved.error === "house_not_found" ? 404 : 400;
      return NextResponse.json({ ok: false, error: resolved.error }, { status });
    }

    const labHome = await ensureGlobalManualMonthlyLabTestHomeHouse(ownerUserId);
    const labScenarioId = await ensurePastScenarioId({ userId: ownerUserId, houseId: labHome.id });
    const [sourceHomeProfile, sourceApplianceProfile] = await Promise.all([
      getHomeProfileSimulatedByUserHouse({ userId: resolved.userId, houseId: resolved.selectedHouse.id }).catch(() => null),
      getApplianceProfileSimulatedByUserHouse({ userId: resolved.userId, houseId: resolved.selectedHouse.id }).catch(() => null),
    ]);

    if (action === "lookup") {
      const sourcePayload = await getManualUsageInputForUserHouse({ userId: resolved.userId, houseId: resolved.selectedHouse.id });
      const sourceUsageHouse = await buildSourceUsageHouse(resolved.selectedHouse);
      const currentResult = labScenarioId
        ? await buildReadResult({
            userId: ownerUserId,
            houseId: labHome.id,
            scenarioId: labScenarioId,
            readMode: "artifact_only",
          })
        : null;
      return NextResponse.json({
        ok: true,
        action,
        email: resolved.email,
        userId: ownerUserId,
        sourceUserId: resolved.userId,
        houses: resolved.houses,
        selectedSourceHouse: resolved.selectedHouse,
        selectedHouse: resolved.selectedHouse,
        labHome: {
          id: labHome.id,
          label: MANUAL_MONTHLY_LAB_TEST_HOME_LABEL,
        },
        scenarioId: labScenarioId,
        payload: sourcePayload.payload,
        updatedAt: sourcePayload.updatedAt,
        sourceUsageHouse,
        sourceHomeProfile,
        sourceApplianceProfile,
        currentResult,
      });
    }

    if (action === "load") {
      const replaced = await replaceGlobalManualMonthlyLabTestHomeFromSource({
        ownerUserId,
        sourceUserId: resolved.userId,
        sourceHouseId: resolved.selectedHouse.id,
      });
      if (!replaced.ok) {
        return NextResponse.json({ ok: false, error: replaced.error, message: replaced.message }, { status: 500 });
      }
      const labSeed = await buildLabPrefill({
        sourceUserId: resolved.userId,
        sourceHouse: resolved.selectedHouse,
        requestedAnchorDate: body?.anchorEndDate,
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
      const [labHomeProfile, labApplianceProfile] = await Promise.all([
        getHomeProfileSimulatedByUserHouse({ userId: ownerUserId, houseId: labHome.id }).catch(() => null),
        getApplianceProfileSimulatedByUserHouse({ userId: ownerUserId, houseId: labHome.id }).catch(() => null),
      ]);
      const readResult = await buildReadResult({
        userId: ownerUserId,
        houseId: labHome.id,
        scenarioId: labScenarioId,
        readMode: "artifact_only",
      });
      return NextResponse.json({
        ok: true,
        action,
        email: resolved.email,
        userId: ownerUserId,
        sourceUserId: resolved.userId,
        selectedSourceHouse: resolved.selectedHouse,
        selectedHouse: resolved.selectedHouse,
        labHome: {
          id: labHome.id,
          label: MANUAL_MONTHLY_LAB_TEST_HOME_LABEL,
        },
        scenarioId: labScenarioId,
        payload: payload.payload,
        updatedAt: payload.updatedAt,
        seed: labSeed.seed,
        sourcePayload: labSeed.sourcePayload,
        sourceUsageHouse: labSeed.sourceUsageHouse,
        sourceHomeProfile,
        sourceApplianceProfile,
        labHomeProfile,
        labApplianceProfile,
        readResult,
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
        email: resolved.email,
        userId: ownerUserId,
        sourceUserId: resolved.userId,
        selectedSourceHouse: resolved.selectedHouse,
        selectedHouse: resolved.selectedHouse,
        labHome: {
          id: labHome.id,
          label: MANUAL_MONTHLY_LAB_TEST_HOME_LABEL,
        },
        scenarioId: labScenarioId,
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
        esiid: labHome.esiid ?? null,
        mode: "MANUAL_TOTALS",
        scenarioId: labScenarioId,
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
      const jobId = dispatched.executionMode === "droplet_async" ? dispatched.jobId : null;
      const result = dispatched.executionMode === "inline" ? dispatched.result : null;
      return NextResponse.json({
        ok: true,
        action,
        email: resolved.email,
        userId: ownerUserId,
        sourceUserId: resolved.userId,
        selectedSourceHouse: resolved.selectedHouse,
        selectedHouse: resolved.selectedHouse,
        labHome: {
          id: labHome.id,
          label: MANUAL_MONTHLY_LAB_TEST_HOME_LABEL,
        },
        scenarioId: labScenarioId,
        executionMode: dispatched.executionMode,
        correlationId: dispatched.correlationId,
        jobId,
        result,
      });
    }

    if (action === "read_result") {
      const readResult = await buildReadResult({
        userId: ownerUserId,
        houseId: labHome.id,
        scenarioId: labScenarioId,
        readMode: "allow_rebuild",
      });
      const sourceUsageHouse = await buildSourceUsageHouse(resolved.selectedHouse);
      if (readResult.ok) {
        return NextResponse.json({
          ok: true,
          action,
          email: resolved.email,
          userId: ownerUserId,
          sourceUserId: resolved.userId,
          selectedSourceHouse: resolved.selectedHouse,
          selectedHouse: resolved.selectedHouse,
          labHome: {
            id: labHome.id,
            label: MANUAL_MONTHLY_LAB_TEST_HOME_LABEL,
          },
          scenarioId: labScenarioId,
          sourceUsageHouse,
          readResult,
        });
      }
      return NextResponse.json({
        action,
        email: resolved.email,
        userId: ownerUserId,
        sourceUserId: resolved.userId,
        selectedSourceHouse: resolved.selectedHouse,
        selectedHouse: resolved.selectedHouse,
        labHome: {
          id: labHome.id,
          label: MANUAL_MONTHLY_LAB_TEST_HOME_LABEL,
        },
        scenarioId: labScenarioId,
        sourceUsageHouse,
        ...readResult,
      });
    }

    return NextResponse.json({ ok: false, error: "action_invalid" }, { status: 400 });
  } catch (error) {
    console.error("[admin/tools/manual-monthly] failed", error);
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
  }
}