import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { prisma } from "@/lib/db";
import { normalizeEmailSafe } from "@/lib/utils/email";
import { attachFailureContract } from "@/lib/api/usageSimulationApiContract";
import { buildValidationCompareProjectionSidecar } from "@/modules/usageSimulator/compareProjection";
import { loadDisplayProfilesForHouse } from "@/modules/usageSimulator/profileDisplay";
import {
  getSharedPastCoverageWindowForHouse,
  getSimulatedUsageForHouseScenario,
  getUserDefaultValidationSelectionMode,
} from "@/modules/usageSimulator/service";
import { dispatchPastSimRecalc } from "@/modules/usageSimulator/pastSimRecalcDispatch";
import { getPastSimRecalcJobForUser } from "@/modules/usageSimulator/simDropletJob";
import {
  createSimCorrelationId,
  logSimPipelineEvent,
} from "@/modules/usageSimulator/simObservability";
import { resolveGapfillWeatherLogicSetting } from "@/modules/usageSimulator/pastSimWeatherPolicy";
import { resolveUserValidationPolicy } from "@/modules/usageSimulator/pastSimPolicy";
import { buildSharedPastSimDiagnostics } from "@/modules/usageSimulator/sharedDiagnostics";
import { boundDateKeysToCoverageWindow } from "@/modules/usageSimulator/metadataWindow";
import { travelRangesToExcludeDateKeys } from "@/modules/usageSimulator/build";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const ROUTE_CANONICAL_RECALC_TIMEOUT_MS = 240_000;
const SOURCE_HOME_PAST_SIM_POLL_MS = 2000;
const ADMIN_EMAILS = ["brian@intelliwatt.com", "brian@intellipath-solutions.com"];

function hasAdminSessionCookie(request: NextRequest): boolean {
  const raw = request.cookies.get("intelliwatt_admin")?.value ?? "";
  const email = normalizeEmailSafe(raw);
  if (!email) return false;
  return ADMIN_EMAILS.includes(email);
}

function gateGapfillLabAdmin(req: NextRequest): NextResponse | null {
  if (!hasAdminSessionCookie(req)) {
    const gate = requireAdmin(req);
    if (!gate.ok) {
      const raw = gate.body as { error?: string };
      const errMsg = typeof raw?.error === "string" ? raw.error : "Admin gate denied";
      const errKey =
        errMsg === "Unauthorized"
          ? "admin_unauthorized"
          : errMsg === "ADMIN_TOKEN not configured"
            ? "admin_token_not_configured"
            : "admin_gate_denied";
      return NextResponse.json(
        attachFailureContract({
          ok: false,
          error: errKey,
          message: errMsg,
        }),
        { status: gate.status }
      );
    }
  }
  return null;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, code: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          const error = new Error(code) as Error & { code?: string };
          error.code = code;
          reject(error);
        }, ms);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function waitForSourceHomePastSimJob(args: { userId: string; jobId: string }) {
  while (true) {
    const job = await getPastSimRecalcJobForUser({
      jobId: args.jobId,
      userId: args.userId,
    });
    if (!job.ok) {
      return { ok: false as const, error: "job_not_found", message: "No Past Sim recalc job found for this source house." };
    }
    if (job.status === "succeeded") {
      return { ok: true as const };
    }
    if (job.status === "failed") {
      return {
        ok: false as const,
        error: "recalc_failed",
        message: String(job.failureMessage ?? "Source-home Past Sim recalc failed."),
      };
    }
    await new Promise((resolve) => setTimeout(resolve, SOURCE_HOME_PAST_SIM_POLL_MS));
  }
}

async function getTravelRangesFromDb(
  userId: string,
  houseId: string
): Promise<Array<{ startDate: string; endDate: string }>> {
  const scenarios = await (prisma as any).usageSimulatorScenario.findMany({
    where: { userId, houseId, archivedAt: null },
    select: { id: true },
  }).catch(() => []);
  if (!scenarios?.length) return [];
  const scenarioIds = scenarios.map((s: { id: string }) => s.id);
  const events = await (prisma as any).usageSimulatorScenarioEvent.findMany({
    where: { scenarioId: { in: scenarioIds }, kind: "TRAVEL_RANGE" },
    select: { payloadJson: true },
  }).catch(() => []);
  const seen = new Set<string>();
  const out: Array<{ startDate: string; endDate: string }> = [];
  for (const e of events ?? []) {
    const p = (e as any)?.payloadJson ?? {};
    const startDate = typeof p?.startDate === "string" ? String(p.startDate).slice(0, 10) : "";
    const endDate = typeof p?.endDate === "string" ? String(p.endDate).slice(0, 10) : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) continue;
    const key = `${startDate}\t${endDate}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ startDate, endDate });
  }
  out.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate));
  return out;
}

export async function POST(request: NextRequest) {
  const gate = gateGapfillLabAdmin(request);
  if (gate) return gate;

  const body = await request.json().catch(() => ({}));
  const email = normalizeEmailSafe(body?.email);
  const sourceHouseId = typeof body?.sourceHouseId === "string" ? body.sourceHouseId.trim() : "";
  const timezone = typeof body?.timezone === "string" ? body.timezone.trim() : "America/Chicago";
  const weatherKind = typeof body?.weatherKind === "string" ? body.weatherKind.trim() : "LAST_YEAR_ACTUAL_WEATHER";
  const gapfillWeatherLogic = resolveGapfillWeatherLogicSetting(weatherKind);

  if (!email) {
    return NextResponse.json(
      attachFailureContract({
        ok: false,
        error: "email_required",
        message: "email is required.",
      }),
      { status: 400 }
    );
  }
  if (!sourceHouseId) {
    return NextResponse.json(
      attachFailureContract({
        ok: false,
        error: "source_house_not_found",
        message: "Selected source house was not found for this user.",
      }),
      { status: 404 }
    );
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true },
  });
  if (!user?.id) {
    return NextResponse.json(
      attachFailureContract({
        ok: false,
        error: "user_not_found",
        message: "User not found for email.",
      }),
      { status: 404 }
    );
  }

  const selectedSourceHouse = await (prisma as any).houseAddress.findFirst({
    where: { id: sourceHouseId, userId: user.id, archivedAt: null },
    select: { id: true, userId: true, esiid: true },
  });
  if (!selectedSourceHouse?.id) {
    return NextResponse.json(
      attachFailureContract({
        ok: false,
        error: "source_house_not_found",
        message: "Selected source house was not found for this user.",
      }),
      { status: 404 }
    );
  }

  const sourcePastCorrelationId = createSimCorrelationId();
  logSimPipelineEvent("admin_lab_run_source_home_past_sim_snapshot_started", {
    correlationId: sourcePastCorrelationId,
    source: "gapfill_lab",
    action: "run_source_home_past_sim_snapshot",
    userId: user.id,
    sourceHouseId: selectedSourceHouse.id,
    timezone,
    weatherKind,
  });

  const pastScenario = await (prisma as any).usageSimulatorScenario
    .findFirst({
      where: {
        userId: user.id,
        houseId: selectedSourceHouse.id,
        name: "Past (Corrected)",
        archivedAt: null,
      },
      select: { id: true },
    })
    .catch(() => null);
  if (!pastScenario?.id) {
    logSimPipelineEvent("admin_lab_run_source_home_past_sim_snapshot_failed", {
      correlationId: sourcePastCorrelationId,
      source: "gapfill_lab",
      action: "run_source_home_past_sim_snapshot",
      userId: user.id,
      sourceHouseId: selectedSourceHouse.id,
      phase: "past_scenario_missing",
      error: "no_past_scenario",
    });
    return NextResponse.json(
      attachFailureContract({
        ok: false,
        error: "no_past_scenario",
        message: "No Past (Corrected) scenario found for source house.",
      }),
      { status: 400 }
    );
  }

  let canonicalWindow: Awaited<ReturnType<typeof getSharedPastCoverageWindowForHouse>>;
  let userValidationPolicy: ReturnType<typeof resolveUserValidationPolicy>;
  let sourcePastRecalc: Awaited<ReturnType<typeof dispatchPastSimRecalc>>;
  try {
    canonicalWindow = await getSharedPastCoverageWindowForHouse({
      userId: user.id,
      houseId: selectedSourceHouse.id,
    });
    userValidationPolicy = resolveUserValidationPolicy({
      defaultSelectionMode: await getUserDefaultValidationSelectionMode(),
      validationDayCount: 21,
    });
    sourcePastRecalc = await withTimeout(
      dispatchPastSimRecalc({
        userId: user.id,
        houseId: selectedSourceHouse.id,
        esiid: selectedSourceHouse.esiid ? String(selectedSourceHouse.esiid) : null,
        mode: "SMT_BASELINE",
        scenarioId: String(pastScenario.id),
        weatherPreference: gapfillWeatherLogic.weatherPreference,
        persistPastSimBaseline: true,
        validationDaySelectionMode: userValidationPolicy.selectionMode,
        validationDayCount: userValidationPolicy.validationDayCount,
        correlationId: sourcePastCorrelationId,
        runContext: {
          callerLabel: "user_recalc",
          buildPathKind: "recalc",
          persistRequested: true,
        },
      }),
      ROUTE_CANONICAL_RECALC_TIMEOUT_MS,
      "source_home_past_sim_recalc_timeout"
    );
  } catch (sourcePastError: unknown) {
    const timedOut =
      sourcePastError instanceof Error &&
      ((sourcePastError as any).code === "source_home_past_sim_recalc_timeout" ||
        /source_home_past_sim_recalc_timeout/i.test(String(sourcePastError.message ?? "")));
    logSimPipelineEvent("admin_lab_run_source_home_past_sim_snapshot_failed", {
      correlationId: sourcePastCorrelationId,
      source: "gapfill_lab",
      action: "run_source_home_past_sim_snapshot",
      userId: user.id,
      sourceHouseId: selectedSourceHouse.id,
      phase: timedOut ? "recalc_dispatch_timeout" : "pre_dispatch_failed",
      error: timedOut
        ? "source_home_past_sim_recalc_timeout"
        : String(sourcePastError instanceof Error ? sourcePastError.message : sourcePastError),
    });
    return NextResponse.json(
      attachFailureContract({
        ok: false,
        error: timedOut ? "source_home_past_sim_recalc_timeout" : "source_home_past_sim_snapshot_failed",
        message: timedOut
          ? "Source-home Past Sim recalc exceeded route timeout."
          : sourcePastError instanceof Error
            ? sourcePastError.message
            : "Source-home Past Sim dispatch failed.",
        correlationId: sourcePastCorrelationId,
      }),
      { status: timedOut ? 504 : 500 }
    );
  }

  if (sourcePastRecalc.executionMode === "inline") {
    if (!sourcePastRecalc.result.ok) {
      logSimPipelineEvent("admin_lab_run_source_home_past_sim_snapshot_failed", {
        correlationId: sourcePastCorrelationId,
        source: "gapfill_lab",
        action: "run_source_home_past_sim_snapshot",
        userId: user.id,
        sourceHouseId: selectedSourceHouse.id,
        phase: "recalc_inline_failed",
        error: String(sourcePastRecalc.result.error ?? "source_home_past_sim_recalc_failed"),
      });
      return NextResponse.json(
        attachFailureContract({
          ok: false,
          error: String(sourcePastRecalc.result.error ?? "source_home_past_sim_recalc_failed"),
          message: "Source-home Past Sim recalc failed.",
          correlationId: sourcePastRecalc.correlationId,
        }),
        { status: sourcePastRecalc.result.error === "recalc_timeout" ? 504 : 500 }
      );
    }
  } else {
    const waited = await withTimeout(
      waitForSourceHomePastSimJob({
        userId: user.id,
        jobId: sourcePastRecalc.jobId,
      }),
      ROUTE_CANONICAL_RECALC_TIMEOUT_MS,
      "source_home_past_sim_recalc_timeout"
    );
    if (!waited.ok) {
      logSimPipelineEvent("admin_lab_run_source_home_past_sim_snapshot_failed", {
        correlationId: sourcePastCorrelationId,
        source: "gapfill_lab",
        action: "run_source_home_past_sim_snapshot",
        userId: user.id,
        sourceHouseId: selectedSourceHouse.id,
        phase: "recalc_droplet_failed",
        error: String(waited.error ?? "source_home_past_sim_recalc_failed"),
        message: waited.message,
      });
      return NextResponse.json(
        attachFailureContract({
          ok: false,
          error: String(waited.error ?? "source_home_past_sim_recalc_failed"),
          message: waited.message,
          correlationId: sourcePastRecalc.correlationId,
        }),
        { status: waited.error === "job_not_found" ? 404 : 500 }
      );
    }
  }

  const sourcePastExactArtifactInputHash =
    sourcePastRecalc.executionMode === "inline" &&
    sourcePastRecalc.result.ok &&
    typeof sourcePastRecalc.result.canonicalArtifactInputHash === "string" &&
    sourcePastRecalc.result.canonicalArtifactInputHash.trim()
      ? sourcePastRecalc.result.canonicalArtifactInputHash.trim()
      : null;

  const sourceTravelRangesFromDb = await getTravelRangesFromDb(user.id, selectedSourceHouse.id);
  const boundedExcludedDateKeysSorted = Array.from(
    boundDateKeysToCoverageWindow(
      new Set<string>(travelRangesToExcludeDateKeys(sourceTravelRangesFromDb)),
      canonicalWindow
    )
  ).sort();
  const boundedExcludedDateKeysCount = boundedExcludedDateKeysSorted.length;
  const boundedExcludedDateKeysFingerprint = boundedExcludedDateKeysSorted.join(",");

  const defaultRead = await getSimulatedUsageForHouseScenario({
    userId: user.id,
    houseId: selectedSourceHouse.id,
    scenarioId: String(pastScenario.id),
    readMode: sourcePastExactArtifactInputHash ? "artifact_only" : "allow_rebuild",
    exactArtifactInputHash: sourcePastExactArtifactInputHash ?? undefined,
    requireExactArtifactMatch: Boolean(sourcePastExactArtifactInputHash),
    correlationId: sourcePastCorrelationId,
    readContext: {
      artifactReadMode: sourcePastExactArtifactInputHash ? "artifact_only" : "allow_rebuild",
      projectionMode: "baseline",
      compareSidecarRequest: true,
    },
  });

  const sourceExactArtifactInputHash =
    sourcePastExactArtifactInputHash ??
    (typeof (defaultRead as any)?.dataset?.meta?.artifactInputHashUsed === "string" &&
    String((defaultRead as any).dataset.meta.artifactInputHashUsed).trim()
      ? String((defaultRead as any).dataset.meta.artifactInputHashUsed).trim()
      : typeof (defaultRead as any)?.dataset?.meta?.artifactInputHash === "string" &&
          String((defaultRead as any).dataset.meta.artifactInputHash).trim()
        ? String((defaultRead as any).dataset.meta.artifactInputHash).trim()
        : typeof (defaultRead as any)?.dataset?.meta?.requestedInputHash === "string" &&
            String((defaultRead as any).dataset.meta.requestedInputHash).trim()
          ? String((defaultRead as any).dataset.meta.requestedInputHash).trim()
          : null);

  const [baselineRead, rawRead, sourceBuildRow, sourceProfiles] = await Promise.all([
    sourceExactArtifactInputHash
      ? getSimulatedUsageForHouseScenario({
          userId: user.id,
          houseId: selectedSourceHouse.id,
          scenarioId: String(pastScenario.id),
          readMode: "artifact_only",
          exactArtifactInputHash: sourceExactArtifactInputHash,
          requireExactArtifactMatch: true,
          projectionMode: "baseline",
          correlationId: sourcePastCorrelationId,
          readContext: {
            artifactReadMode: "artifact_only",
            projectionMode: "baseline",
            compareSidecarRequest: true,
          },
        })
      : Promise.resolve(defaultRead),
    sourceExactArtifactInputHash
      ? getSimulatedUsageForHouseScenario({
          userId: user.id,
          houseId: selectedSourceHouse.id,
          scenarioId: String(pastScenario.id),
          readMode: "artifact_only",
          exactArtifactInputHash: sourceExactArtifactInputHash,
          requireExactArtifactMatch: true,
          projectionMode: "raw",
          correlationId: sourcePastCorrelationId,
          readContext: {
            artifactReadMode: "artifact_only",
            projectionMode: "raw",
            compareSidecarRequest: true,
          },
        })
      : getSimulatedUsageForHouseScenario({
          userId: user.id,
          houseId: selectedSourceHouse.id,
          scenarioId: String(pastScenario.id),
          readMode: "allow_rebuild",
          projectionMode: "raw",
          correlationId: sourcePastCorrelationId,
          readContext: {
            artifactReadMode: "allow_rebuild",
            projectionMode: "raw",
            compareSidecarRequest: true,
          },
        }),
    (prisma as any).usageSimulatorBuild.findUnique({
      where: {
        userId_houseId_scenarioKey: {
          userId: user.id,
          houseId: selectedSourceHouse.id,
          scenarioKey: String(pastScenario.id),
        },
      },
      select: { buildInputs: true, buildInputsHash: true, lastBuiltAt: true, mode: true, baseKind: true },
    }).catch(() => null),
    loadDisplayProfilesForHouse({
      userId: user.id,
      houseId: selectedSourceHouse.id,
    }).catch(() => ({ homeProfile: null, applianceProfile: null })),
  ]);

  const withCanonicalExcludedOwnership = (dataset: any, compact: boolean) => {
    if (!dataset || typeof dataset !== "object") return null;
    const baseMeta =
      dataset.meta && typeof dataset.meta === "object"
        ? (dataset.meta as Record<string, unknown>)
        : {};
    const normalizedMeta: Record<string, unknown> = {
      ...baseMeta,
      excludedDateKeysCount: boundedExcludedDateKeysCount,
      excludedDateKeysFingerprint: boundedExcludedDateKeysFingerprint,
    };
    if (compact) {
      return {
        summary: dataset.summary ?? null,
        daily: Array.isArray(dataset.daily) ? dataset.daily : [],
        monthly: Array.isArray(dataset.monthly) ? dataset.monthly : [],
        meta: {
          canonicalArtifactSimulatedDayTotalsByDate:
            normalizedMeta.canonicalArtifactSimulatedDayTotalsByDate ??
            (dataset as any).canonicalArtifactSimulatedDayTotalsByDate ??
            null,
          validationOnlyDateKeysLocal:
            normalizedMeta.validationOnlyDateKeysLocal ?? null,
          excludedDateKeysCount: boundedExcludedDateKeysCount,
          excludedDateKeysFingerprint: boundedExcludedDateKeysFingerprint,
        },
      };
    }
    return {
      ...dataset,
      meta: normalizedMeta,
    };
  };

  const baselineDataset = baselineRead.ok
    ? withCanonicalExcludedOwnership((baselineRead as any).dataset, false)
    : null;
  const baselineCompareProjection = baselineRead.ok
    ? buildValidationCompareProjectionSidecar(baselineDataset)
    : null;
  const sourceBuildInputs = ((sourceBuildRow as any)?.buildInputs as Record<string, unknown> | null | undefined) ?? null;

  let sourceEngineContext: Record<string, unknown> | null = null;
  if (sourceBuildInputs) {
    const { runSimulatorDiagnostic } = await import("@/lib/admin/simulatorDiagnostic");
    const diagnostic = await runSimulatorDiagnostic({
      userId: user.id,
      houseId: selectedSourceHouse.id,
      esiid: selectedSourceHouse.esiid ? String(selectedSourceHouse.esiid) : null,
      buildInputs: sourceBuildInputs,
      scenarioId: String(pastScenario.id),
      scenarioKey: String(pastScenario.id),
      buildInputsHash: (sourceBuildRow as any)?.buildInputsHash ?? null,
    });
    sourceEngineContext = diagnostic.ok
      ? {
          identity: {
            windowStartUtc: diagnostic.identity.windowStartUtc,
            windowEndUtc: diagnostic.identity.windowEndUtc,
            timezone: diagnostic.identity.timezone,
            inputHash: diagnostic.identity.inputHash,
            engineVersion: diagnostic.identity.engineVersion,
            intervalDataFingerprint: diagnostic.identity.intervalDataFingerprint,
            weatherIdentity: diagnostic.identity.weatherIdentity,
            usageShapeProfileIdentity: diagnostic.identity.usageShapeProfileIdentity,
            buildInputsHash: diagnostic.identity.buildInputsHash,
          },
          weather: {
            weatherProvenance: diagnostic.weatherProvenance,
            stubAudit: diagnostic.stubAudit,
          },
          pastPatchPayload: {
            ...diagnostic.pastPath,
            dayLevelParity: diagnostic.dayLevelParity ?? null,
            integrity: diagnostic.integrity ?? null,
          },
          rawActualIntervalsMeta: diagnostic.rawActualIntervalsMeta,
          rawActualIntervals: diagnostic.rawActualIntervals,
          stitchedPastIntervalsMeta: diagnostic.stitchedPastIntervalsMeta,
          stitchedPastIntervals: diagnostic.stitchedPastIntervals,
          firstActualOnlyDayComparison: diagnostic.firstActualOnlyDayComparison,
        }
      : {
          diagnosticError: diagnostic.error,
        };
  }

  const actualSharedDiagnostics = baselineDataset
    ? buildSharedPastSimDiagnostics({
        callerType: "gapfill_actual",
        dataset: baselineDataset,
        scenarioId: String(pastScenario.id),
        correlationId: sourcePastCorrelationId,
        validationPolicyOwner: userValidationPolicy.owner,
        weatherLogicMode: gapfillWeatherLogic.weatherLogicMode,
        compareProjection: baselineCompareProjection,
        readMode: "artifact_only",
        projectionMode: "baseline",
        artifactInputHash:
          (baselineDataset as any)?.meta?.artifactInputHashUsed ??
          (baselineDataset as any)?.meta?.artifactInputHash ??
          null,
        artifactEngineVersion: (baselineDataset as any)?.meta?.simVersion ?? null,
        artifactPersistenceOutcome: "persisted_artifact_read",
        simulatorDiagnostic: sourceEngineContext,
      })
    : null;

  const payload = {
    sourceHouseId: selectedSourceHouse.id,
    scenarioId: String(pastScenario.id),
    weatherLogicMode: gapfillWeatherLogic.weatherLogicMode,
    weatherLogicOwner: gapfillWeatherLogic.owner,
    recalc: {
      executionMode: sourcePastRecalc.executionMode,
      correlationId: sourcePastRecalc.correlationId,
      ...(sourcePastRecalc.executionMode === "droplet_async"
        ? { jobId: sourcePastRecalc.jobId }
        : {}),
    },
    canonicalWindow,
    travelRangesFromDb: sourceTravelRangesFromDb,
    reads: {
      defaultProjection: defaultRead.ok
        ? { ok: true, dataset: withCanonicalExcludedOwnership((defaultRead as any).dataset, true) }
        : { ok: false, code: defaultRead.code, message: defaultRead.message },
      baselineProjection: baselineRead.ok
        ? {
            ok: true,
            dataset: baselineDataset,
            compareProjection: baselineCompareProjection,
          }
        : { ok: false, code: baselineRead.code, message: baselineRead.message },
      rawProjection: rawRead.ok
        ? { ok: true, dataset: withCanonicalExcludedOwnership((rawRead as any).dataset, true) }
        : { ok: false, code: rawRead.code, message: rawRead.message },
    },
    validationPolicyOwner: userValidationPolicy.owner,
    validationPolicyMode: userValidationPolicy.selectionMode,
    build: {
      mode: (sourceBuildRow as any)?.mode ?? null,
      baseKind: (sourceBuildRow as any)?.baseKind ?? null,
      buildInputsHash: (sourceBuildRow as any)?.buildInputsHash ?? null,
      lastBuiltAt: (sourceBuildRow as any)?.lastBuiltAt instanceof Date
        ? (sourceBuildRow as any).lastBuiltAt.toISOString()
        : (sourceBuildRow as any)?.lastBuiltAt ?? null,
      selected: sourceBuildInputs
        ? {
            mode: sourceBuildInputs.mode ?? null,
            baseKind: sourceBuildInputs.baseKind ?? null,
            weatherPreference: sourceBuildInputs.weatherPreference ?? null,
            canonicalEndMonth: sourceBuildInputs.canonicalEndMonth ?? null,
            canonicalMonthsCount: Array.isArray(sourceBuildInputs.canonicalMonths)
              ? sourceBuildInputs.canonicalMonths.length
              : 0,
            travelRanges: sourceBuildInputs.travelRanges ?? [],
            notes: sourceBuildInputs.notes ?? [],
            filledMonths: sourceBuildInputs.filledMonths ?? [],
            pastSimulatedMonths: sourceBuildInputs.pastSimulatedMonths ?? [],
            snapshots: {
              actualSource: (sourceBuildInputs as any)?.snapshots?.actualSource ?? null,
              scenario: (sourceBuildInputs as any)?.snapshots?.scenario ?? null,
              hasHomeProfile: Boolean((sourceBuildInputs as any)?.snapshots?.homeProfile),
              hasApplianceProfile: Boolean((sourceBuildInputs as any)?.snapshots?.applianceProfile),
            },
          }
        : null,
      raw: sourceBuildInputs,
    },
    profiles: {
      homeProfileLive: (sourceProfiles as any)?.homeProfile ?? null,
      applianceProfileLive: (sourceProfiles as any)?.applianceProfile ?? null,
      homeProfileBuildSnapshot: (sourceBuildInputs as any)?.snapshots?.homeProfile ?? null,
      applianceProfileBuildSnapshot: (sourceBuildInputs as any)?.snapshots?.applianceProfile ?? null,
    },
    engineContext: sourceEngineContext,
    sharedDiagnostics: actualSharedDiagnostics,
  };

  logSimPipelineEvent("admin_lab_run_source_home_past_sim_snapshot_completed", {
    correlationId: sourcePastCorrelationId,
    source: "gapfill_lab",
    action: "run_source_home_past_sim_snapshot",
    userId: user.id,
    sourceHouseId: selectedSourceHouse.id,
    scenarioId: String(pastScenario.id),
    readExecutionMode: sourcePastRecalc.executionMode,
    defaultReadOk: defaultRead.ok,
    baselineReadOk: baselineRead.ok,
    rawReadOk: rawRead.ok,
    buildInputsHash: (sourceBuildRow as any)?.buildInputsHash ?? null,
  });

  return NextResponse.json({
    ok: true,
    action: "run_source_home_past_sim_snapshot",
    sourceHouseId: selectedSourceHouse.id,
    scenarioId: String(pastScenario.id),
    correlationId: sourcePastCorrelationId,
    validationPolicyOwner: userValidationPolicy.owner,
    pastSimSnapshot: payload,
  });
}
