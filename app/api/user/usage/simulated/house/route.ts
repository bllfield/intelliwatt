import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/utils/email";
import { buildUserUsageHouseContract } from "@/lib/usage/userUsageHouseContract";
import { readOnePathSimulatedUsageScenario } from "@/modules/onePathSim/serviceBridge";
import { resolveOnePathUpstreamUsageTruthForSimulation } from "@/modules/onePathSim/runtime";
import { resolveIntervalsLayer } from "@/lib/usage/resolveIntervalsLayer";
import { IntervalSeriesKind } from "@/modules/usageSimulator/kinds";
import { ensureUsageShapeProfileForUserHouse } from "@/modules/usageShapeProfile/autoBuild";
import { createSimCorrelationId } from "@/modules/onePathSim/usageSimulator/simObservability";
import {
  applyPastSimDisplayTruthToDataset,
  resolveStaleIncompleteMeterSlotCompleteDateKeys,
} from "@/lib/usage/pastSimStaleIncompleteMeter";
import { sageActualDailyKwhByDate } from "@/lib/usage/sageActualDailyTruth";
import { attachFailureContract, correlationHeaders } from "@/lib/api/usageSimulationApiContract";
import { buildManualUsageReadDecorations } from "@/modules/manualUsage/pastSimReadResult";
import { getHomeProfileSimulatedByUserHouse } from "@/modules/homeProfile/repo";
import { getApplianceProfileSimulatedByUserHouse } from "@/modules/applianceProfile/repo";
import { normalizeStoredApplianceProfile } from "@/modules/applianceProfile/validation";
import { getManualUsageInputForUserHouse } from "@/modules/manualUsage/store";
import {
  buildWeatherEfficiencyDerivedInput,
  resolveSharedWeatherSensitivityEnvelope,
} from "@/modules/weatherSensitivity/shared";
import { prepareUserSiteGreenButtonDisplayUsage } from "@/lib/usage/greenButtonChartInsights";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300; // Past scenario may hit cache; cold path uses canonical builder (can be slow)

async function requireUser() {
  const cookieStore = cookies();
  const rawEmail = cookieStore.get("intelliwatt_user")?.value;
  if (!rawEmail) {
    return {
      ok: false as const,
      status: 401,
      body: attachFailureContract({ ok: false, error: "not_authenticated", message: "Not authenticated" }),
    };
  }
  const userEmail = normalizeEmail(rawEmail);
  const user = await prisma.user.findUnique({ where: { email: userEmail }, select: { id: true } });
  if (!user) {
    return {
      ok: false as const,
      status: 404,
      body: attachFailureContract({ ok: false, error: "user_not_found", message: "User not found" }),
    };
  }
  return { ok: true as const, user };
}

export async function GET(request: NextRequest) {
  const correlationId = createSimCorrelationId();
  try {
    const u = await requireUser();
    if (!u.ok) return NextResponse.json(u.body, { status: u.status });

    const { searchParams } = new URL(request.url);
    const houseId = String(searchParams.get("houseId") ?? "").trim();
    const scenarioIdRaw = searchParams.get("scenarioId");
    const scenarioIdTrimmed = scenarioIdRaw == null ? null : String(scenarioIdRaw).trim();
    // Treat "baseline" (client string) same as null so both dashboard and simulation page use same actual data.
    const scenarioId = scenarioIdTrimmed === "baseline" ? null : scenarioIdTrimmed;

    if (!houseId) {
      return NextResponse.json(
        attachFailureContract({ ok: false, error: "houseId_required", message: "houseId is required." }),
        { status: 400, headers: correlationHeaders(correlationId) }
      );
    }

    // Baseline alias path: scenarioId omitted/null/"baseline" resolves to ACTUAL_USAGE_INTERVALS.
    if (!scenarioId) {
      const house = await prisma.houseAddress.findFirst({
        where: { id: houseId, userId: u.user.id, archivedAt: null },
        select: {
          id: true,
          label: true,
          addressLine1: true,
          addressCity: true,
          addressState: true,
          esiid: true,
        },
      });
      if (!house) {
        return NextResponse.json(
          {
            ...attachFailureContract({
              ok: false,
              error: "house_not_found",
              message: "House not found for user",
            }),
            code: "HOUSE_NOT_FOUND",
          },
          { status: 403, headers: correlationHeaders(correlationId) }
        );
      }
      const resolved = await resolveIntervalsLayer({
        userId: u.user.id,
        houseId: house.id,
        // Keep baseline "Usage" path on the exact same shared actual-usage layer as /api/user/usage.
        layerKind: IntervalSeriesKind.ACTUAL_USAGE_INTERVALS,
        scenarioId: null,
        esiid: house.esiid ?? null,
        userUsageDashboardLoad: true,
      });
      const usageForContract = await prepareUserSiteGreenButtonDisplayUsage(
        resolved ?? { dataset: null, alternatives: { smt: null, greenButton: null } },
        {
          userId: u.user.id,
          houseId: house.id,
          actualContextHouseId: house.id,
        }
      );
      const contract = await buildUserUsageHouseContract({
        userId: u.user.id,
        house,
        resolvedUsage: usageForContract,
        weatherHouseId: house.id,
      });
      const baselineHeaders = new Headers({ "Cache-Control": "private, max-age=30" });
      baselineHeaders.set("X-Correlation-Id", correlationId);
      return NextResponse.json(
        {
          ok: true,
          houseId: house.id,
          scenarioKey: "BASELINE",
          scenarioId: null,
          dataset: contract.dataset,
          correlationId,
          weatherSensitivityScore: contract.weatherSensitivityScore,
          weatherEfficiencyDerivedInput: contract.weatherEfficiencyDerivedInput,
        },
        { headers: baselineHeaders }
      );
    }

    const scenarioRow = await prisma.usageSimulatorScenario.findFirst({
      where: { id: scenarioId, userId: u.user.id, houseId, archivedAt: null },
      select: { name: true },
    });
    const readModeParam = String(searchParams.get("readMode") ?? "").trim();
    const readMode =
      readModeParam === "allow_rebuild"
        ? "allow_rebuild"
        : readModeParam === "artifact_only"
          ? "artifact_only"
          : scenarioRow?.name === "Future (What-if)"
            ? "allow_rebuild"
            : "artifact_only";

    const readPastScenario = (mode: "artifact_only" | "allow_rebuild") =>
      readOnePathSimulatedUsageScenario({
        userId: u.user.id,
        houseId,
        scenarioId,
        correlationId,
        readMode: mode,
        projectionMode: "baseline",
        readContext: {
          artifactReadMode: mode,
          projectionMode: "baseline",
          compareSidecarRequest: true,
        },
      });

    let readModeUsed: "artifact_only" | "allow_rebuild" = readMode;
    let out = await readPastScenario(readMode);
    // Usage/baseline show live SMT; Past still needs a persisted sim artifact. Prefer artifact read, but
    // self-heal when cache is missing (e.g. engine v11 bump) instead of failing the tab.
    if (!out.ok && out.code === "ARTIFACT_MISSING" && readMode === "artifact_only") {
      readModeUsed = "allow_rebuild";
      out = await readPastScenario("allow_rebuild");
    }
    const message = String((out as any)?.message ?? "");
    const shouldAutoBuildProfile =
      !out.ok &&
      out.code === "INTERNAL_ERROR" &&
      /usage_shape_profile_required|usage-shape profile|fallback_month_avg/i.test(message);
    if (shouldAutoBuildProfile) {
      const rebuilt = await ensureUsageShapeProfileForUserHouse({
        userId: u.user.id,
        houseId,
        timezone: "America/Chicago",
      });
      if (rebuilt.ok) {
        out = await readPastScenario(readModeUsed);
      }
    }
    // Past/Future: never cache so each open uses latest state (e.g. Future always sees latest Past).
    const cacheControl = scenarioId ? "private, no-store" : "private, max-age=30";
    if (out.ok) {
      const datasetAny = (out as any)?.dataset ?? {};
      const {
        compareProjection,
        manualReadModel,
        manualMonthlyReconciliation,
        sharedDiagnostics,
      } = await buildManualUsageReadDecorations({
        userId: u.user.id,
        houseId,
        scenarioId,
        dataset: datasetAny,
        callerType: "user_past",
        correlationId,
        readMode: readModeUsed,
      });
      const okHeaders = new Headers({ "Cache-Control": cacheControl });
      okHeaders.set("X-Correlation-Id", correlationId);
      const house = await prisma.houseAddress.findFirst({
        where: { id: houseId, userId: u.user.id, archivedAt: null },
        select: { id: true, esiid: true },
      });
      const [homeProfile, applianceProfileRec, manualUsageRec, sageTruth, smtSlotCompleteDateKeys] = await Promise.all([
        getHomeProfileSimulatedByUserHouse({ userId: u.user.id, houseId }),
        getApplianceProfileSimulatedByUserHouse({ userId: u.user.id, houseId }),
        getManualUsageInputForUserHouse({ userId: u.user.id, houseId }).catch(() => ({ payload: null })),
        resolveOnePathUpstreamUsageTruthForSimulation({
          userId: u.user.id,
          houseId,
          actualContextHouseId: houseId,
          smtSourceEsiid: house?.esiid ?? null,
          seedIfMissing: false,
          preferredActualSource: null,
        }).catch(() => null),
        resolveStaleIncompleteMeterSlotCompleteDateKeys({
          esiid: house?.esiid ?? null,
          meta: datasetAny?.meta,
        }),
      ]);
      applyPastSimDisplayTruthToDataset(datasetAny, {
        sageByDate: sageActualDailyKwhByDate(sageTruth?.dataset),
        smtSlotCompleteDateKeys,
      });
      const applianceProfile = normalizeStoredApplianceProfile((applianceProfileRec?.appliancesJson as any) ?? null);
      const persistedScore = (datasetAny?.meta as any)?.weatherSensitivityScore ?? null;
      const persistedDerivedInput = (datasetAny?.meta as any)?.weatherEfficiencyDerivedInput ?? null;
      const weatherSensitivity =
        persistedScore != null
          ? {
              score: persistedScore,
              derivedInput: persistedDerivedInput ?? buildWeatherEfficiencyDerivedInput(persistedScore),
            }
          : await (async () => {
              const actualDatasetForSharedScore =
                house?.id != null
                  ? (
                      await resolveIntervalsLayer({
                        userId: u.user.id,
                        houseId: house.id,
                        layerKind: IntervalSeriesKind.ACTUAL_USAGE_INTERVALS,
                        scenarioId: null,
                        esiid: house.esiid ?? null,
                      }).catch(() => null)
                    )?.dataset ?? null
                  : null;
              return resolveSharedWeatherSensitivityEnvelope({
                actualDataset: actualDatasetForSharedScore,
                manualUsagePayload: manualUsageRec?.payload ?? null,
                homeProfile,
                applianceProfile,
                weatherHouseId: houseId,
              }).catch(() => ({ score: null, derivedInput: null }));
            })();
      const successBody = {
        ...out,
        compareProjection,
        manualReadModel,
        manualMonthlyReconciliation,
        sharedDiagnostics,
        weatherSensitivityScore: weatherSensitivity.score,
        weatherEfficiencyDerivedInput: weatherSensitivity.derivedInput,
        correlationId,
        simulationProducer: "one_path",
        readModeUsed,
        artifactRebuildFallback: readMode === "artifact_only" && readModeUsed === "allow_rebuild",
      };
      return NextResponse.json(successBody, { headers: okHeaders });
    }

    const failureBody = {
      ...out,
      correlationId,
      failureCode: out.code,
      failureMessage: out.message,
    };
    if (out.code === "NO_BUILD") return NextResponse.json(failureBody, { status: 404, headers: correlationHeaders(correlationId) });
    if (out.code === "HOUSE_NOT_FOUND") return NextResponse.json(failureBody, { status: 403, headers: correlationHeaders(correlationId) });
    if (out.code === "SCENARIO_NOT_FOUND") return NextResponse.json(failureBody, { status: 404, headers: correlationHeaders(correlationId) });
    if (out.code === "ARTIFACT_MISSING") return NextResponse.json(failureBody, { status: 404, headers: correlationHeaders(correlationId) });
    if (out.code === "COMPARE_TRUTH_INCOMPLETE")
      return NextResponse.json(failureBody, { status: 409, headers: correlationHeaders(correlationId) });
    return NextResponse.json(failureBody, { status: 500, headers: correlationHeaders(correlationId) });
  } catch (e) {
    console.error("[user/usage/simulated/house] failed", e);
    return NextResponse.json(
      {
        ...attachFailureContract({
          ok: false,
          error: "internal_error",
          message: "Internal error",
        }),
        code: "INTERNAL_ERROR",
      },
      { status: 500, headers: correlationHeaders(correlationId) }
    );
  }
}
