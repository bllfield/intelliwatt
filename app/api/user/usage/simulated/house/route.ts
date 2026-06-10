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
import { finalizePastDatasetDisplayReadModel } from "@/lib/usage/finalizePastDatasetDisplayReadModel";
import { resolveStaleIncompleteMeterSlotCompleteDateKeys } from "@/lib/usage/pastSimStaleIncompleteMeter";
import { isPersistedAdminLabTestHomeLabel } from "@/lib/usage/userSiteSimulationIsolation";
import { resolveHouseCommittedUsageSource } from "@/lib/usage/houseCommittedUsageSource";
import type { ActualUsageSource } from "@/modules/realUsageAdapter/actual";
import { attachFailureContract, correlationHeaders } from "@/lib/api/usageSimulationApiContract";
import { buildManualUsageReadDecorations } from "@/modules/manualUsage/pastSimReadResult";
import { getHomeProfileSimulatedByUserHouse } from "@/modules/homeProfile/repo";
import { getApplianceProfileSimulatedByUserHouse } from "@/modules/applianceProfile/repo";
import { normalizeStoredApplianceProfile } from "@/modules/applianceProfile/validation";
import { getManualUsageInputForUserHouse } from "@/modules/manualUsage/store";
import type { WeatherSensitivityEnvelope } from "@/modules/weatherSensitivity/shared";
import {
  buildWeatherScoringAudit,
  resolveActualUsageWeatherScore,
} from "@/lib/usage/weatherScoringOwnership";
import { readGreenButtonTrustedHomeDateKeysFromPastMeta } from "@/lib/usage/greenButtonPastTrustedPool";
import {
  resolvePastWeatherHouseIdFromDataset,
  type PastDisplayWeatherReadPath,
} from "@/lib/usage/pastVisibleWeatherReadDiagnostics";
import { shouldUsePastDisplayWeatherCards } from "@/lib/usage/userPastVisibleWeather";
import { resolveUserPastApiWeatherResponse } from "@/lib/usage/userPastApiWeatherResponse";
import {
  pastSimUserReadInflightKey,
  runPastSimUserReadInflight,
} from "@/lib/usage/pastSimUserReadInflight";

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
      const contract = await buildUserUsageHouseContract({
        userId: u.user.id,
        house,
        resolvedUsage: resolved ?? { dataset: null, alternatives: { smt: null, greenButton: null } },
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

    return runPastSimUserReadInflight(
      pastSimUserReadInflightKey({ userId: u.user.id, houseId, scenarioId }),
      async () => {
    const scenarioRow = await prisma.usageSimulatorScenario.findFirst({
      where: { id: scenarioId, userId: u.user.id, houseId, archivedAt: null },
      select: { name: true },
    });
    const houseRow = await prisma.houseAddress.findFirst({
      where: { id: houseId, userId: u.user.id, archivedAt: null },
      select: { id: true, esiid: true },
    });
    const committedSource = houseRow
      ? await resolveHouseCommittedUsageSource({
          houseId: houseRow.id,
          userId: u.user.id,
          esiid: houseRow.esiid ?? null,
        })
      : null;
    const preferredActualSource: ActualUsageSource | undefined =
      committedSource === "SMT" || committedSource === "GREEN_BUTTON" ? committedSource : undefined;
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
          userSiteIsolation: true,
        },
      });

    let readModeUsed: "artifact_only" | "allow_rebuild" = readMode;
    let out = await readPastScenario(readMode);
    // Past needs a persisted sim artifact; compare truth follows committed usage source. Prefer artifact read, but
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
        esiid: houseRow?.esiid ?? null,
        preferredActualSource: preferredActualSource ?? null,
      });
      if (rebuilt.ok) {
        out = await readPastScenario(readModeUsed);
      }
    }
    // Past/Future: never cache so each open uses latest state (e.g. Future always sees latest Past).
    const cacheControl = scenarioId ? "private, no-store" : "private, max-age=30";
    if (out.ok) {
      const datasetAny = (out as any)?.dataset ?? {};
      const okHeaders = new Headers({ "Cache-Control": cacheControl });
      okHeaders.set("X-Correlation-Id", correlationId);
      const house = houseRow;
      const actualDatasetForCompare =
        house?.id != null
          ? (
              await resolveIntervalsLayer({
                userId: u.user.id,
                houseId: house.id,
                layerKind: IntervalSeriesKind.ACTUAL_USAGE_INTERVALS,
                scenarioId: null,
                esiid: house.esiid ?? null,
                preferredActualSource: preferredActualSource ?? null,
              }).catch(() => null)
            )?.dataset ?? null
          : null;
      const {
        compareProjection,
        manualReadModel,
        manualMonthlyReconciliation,
        manualValidationSummary,
        sharedDiagnostics,
      } = await buildManualUsageReadDecorations({
        userId: u.user.id,
        houseId,
        scenarioId,
        dataset: datasetAny,
        callerType: "user_past",
        correlationId,
        readMode: readModeUsed,
        actualDataset: actualDatasetForCompare,
        displayDataset: datasetAny,
      });
      const usePastDisplayWeather = shouldUsePastDisplayWeatherCards({
        scenarioName: scenarioRow?.name ?? null,
        meta: datasetAny?.meta,
      });
      const pastWeatherHouseId = resolvePastWeatherHouseIdFromDataset({
        dataset: datasetAny,
        fallbackHouseId: houseId,
      });
      const profileHouseId = pastWeatherHouseId;
      const [homeProfile, applianceProfileRec, manualUsageRec, sageTruth, smtSlotCompleteDateKeys] =
        await Promise.all([
          getHomeProfileSimulatedByUserHouse({ userId: u.user.id, houseId: profileHouseId }),
          getApplianceProfileSimulatedByUserHouse({ userId: u.user.id, houseId: profileHouseId }),
          getManualUsageInputForUserHouse({ userId: u.user.id, houseId }).catch(() => ({ payload: null })),
          resolveOnePathUpstreamUsageTruthForSimulation({
            userId: u.user.id,
            houseId,
            actualContextHouseId: pastWeatherHouseId,
            smtSourceEsiid: house?.esiid ?? null,
            seedIfMissing: false,
            preferredActualSource: preferredActualSource ?? null,
            greenButtonFullYearIntervalsForDisplay: preferredActualSource === "GREEN_BUTTON",
          }).catch(() => null),
          resolveStaleIncompleteMeterSlotCompleteDateKeys({
            esiid: house?.esiid ?? null,
            meta: datasetAny?.meta,
          }),
        ]);
      const applianceProfile = normalizeStoredApplianceProfile((applianceProfileRec?.appliancesJson as any) ?? null);
      const greenButtonTrustedHomeDateKeys = readGreenButtonTrustedHomeDateKeysFromPastMeta(datasetAny?.meta);
      const finalizeOutcome = await finalizePastDatasetDisplayReadModel({
        dataset: datasetAny,
        sageActualDataset: sageTruth?.dataset ?? null,
        smtSlotCompleteDateKeys,
        greenButtonTrustedHomeDateKeys:
          greenButtonTrustedHomeDateKeys.size > 0 ? greenButtonTrustedHomeDateKeys : undefined,
        homeProfile,
        applianceProfile,
        weatherHouseId: pastWeatherHouseId,
        fallbackHouseId: houseId,
        scenarioId,
        persistDisplayWeatherToCache: true,
      });
      let weatherSensitivity: WeatherSensitivityEnvelope;
      let weatherScoringAudit: Awaited<ReturnType<typeof resolveUserPastApiWeatherResponse>>["weatherScoringAudit"];
      let weatherCardsSourceOwner = "actual_usage_weather_score";
      let weatherReadPath: PastDisplayWeatherReadPath =
        finalizeOutcome?.weatherReadPath ?? "past_display_finalize_recompute";
      let pastWeatherDiagnostics: Awaited<
        ReturnType<typeof resolveUserPastApiWeatherResponse>
      >["diagnostics"] | null = null;
      if (usePastDisplayWeather) {
        const pastWeather = await resolveUserPastApiWeatherResponse({
          dataset: datasetAny,
          scenarioName: scenarioRow?.name ?? null,
          scenarioId,
          requestedHouseId: houseId,
          preferredActualSource: preferredActualSource ?? null,
          homeProfile,
          applianceProfile,
          weatherHouseId: pastWeatherHouseId,
          compareProjection: compareProjection ?? null,
          finalizeOutcome,
        });
        weatherSensitivity = pastWeather.weatherSensitivity;
        weatherScoringAudit = pastWeather.weatherScoringAudit;
        weatherCardsSourceOwner = pastWeather.weatherCardsSourceOwner;
        weatherReadPath = pastWeather.weatherReadPath;
        pastWeatherDiagnostics = pastWeather.diagnostics;
      } else {
        const actualDatasetForSharedScore =
          actualDatasetForCompare ??
          (house?.id != null
            ? (
                await resolveIntervalsLayer({
                  userId: u.user.id,
                  houseId: house.id,
                  layerKind: IntervalSeriesKind.ACTUAL_USAGE_INTERVALS,
                  scenarioId: null,
                  esiid: house.esiid ?? null,
                  preferredActualSource: preferredActualSource ?? null,
                }).catch(() => null)
              )?.dataset ?? null
            : null);
        const actualWeather = await resolveActualUsageWeatherScore({
          scoringDataset: actualDatasetForSharedScore,
          manualUsagePayload: manualUsageRec?.payload ?? null,
          homeProfile,
          applianceProfile,
          weatherHouseId: houseId,
          preferredActualSource: preferredActualSource ?? null,
        }).catch(() => ({ score: null, derivedInput: null, audit: null as never }));
        weatherSensitivity = {
          score: actualWeather.score,
          derivedInput: actualWeather.derivedInput,
        };
        weatherScoringAudit =
          actualWeather.audit ??
          buildWeatherScoringAudit({
            scoringContext: "ACTUAL_USAGE",
            scoringDataset: actualDatasetForCompare,
            datasetKind: "ACTUAL",
            preferredActualSource: preferredActualSource ?? null,
            envelope: weatherSensitivity,
          });
      }
      const successBody = {
        ...out,
        compareProjection,
        manualReadModel,
        manualMonthlyReconciliation,
        manualValidationSummary,
        sharedDiagnostics,
        weatherSensitivityScore: weatherSensitivity.score,
        weatherEfficiencyDerivedInput: weatherSensitivity.derivedInput,
        weatherCardsSourceOwner,
        weatherScoringAudit,
        weatherReadPath,
        pastWeatherDiagnostics,
        scenarioName: scenarioRow?.name ?? null,
        routeOwner: "app/api/user/usage/simulated/house/route.ts",
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
      },
    );
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
