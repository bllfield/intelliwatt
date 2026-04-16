import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getActualIntervalsForRange } from "@/lib/usage/actualDatasetForHouse";
import {
  buildValidationCompareProjectionSidecar,
  compareWeatherFromDailyWeather,
} from "@/modules/onePathSim/usageSimulator/compareProjection";
import { buildSharedPastSimDiagnostics } from "@/modules/onePathSim/usageSimulator/sharedDiagnostics";
import {
  getSimulatedUsageForHouseScenario,
} from "@/modules/onePathSim/usageSimulator/service";
import {
  createGapfillCompareRunStart,
  finalizeGapfillCompareRunSnapshot,
  markGapfillCompareRunFailed,
  markGapfillCompareRunRunning,
} from "@/modules/onePathSim/usageSimulator/compareRunSnapshot";
import { SOURCE_OF_DAY_SIMULATION_CORE } from "@/modules/onePathSim/simulatedUsage/pastDaySimulator";
import { attachFailureContract } from "@/lib/api/usageSimulationApiContract";
import {
  shiftIsoDateUtc,
  markCompareCoreStep,
  finalizeCompareCoreTiming,
  buildSelectedDaysCoreResponseModelAssumptions,
  startCompareCoreTiming,
  round2,
} from "@/app/api/admin/tools/gapfill-lab/gapfillLabRouteHelpers";
import {
  canonicalIntervalKey,
  computeGapFillMetrics,
  dateKeyInTimezone,
  getLocalDayOfWeekFromDateKey,
} from "@/lib/admin/gapfillLab";

export type GapfillComparePipelineState = {
  compareRequestTruthForLifecycle: Record<string, unknown> | null;
  artifactRequestTruthForLifecycle: Record<string, unknown> | null;
  compareCoreTimingForLifecycle: ReturnType<typeof startCompareCoreTiming> | null;
};

export type GapfillCompareRunOut = {
  compareRunId: string | null;
  compareRunStatus: "started" | "running" | "succeeded" | "failed" | "queued" | null;
  compareRunSnapshotReady: boolean;
  compareRunTerminalState: boolean;
};

export type GapfillCompareCorePipelineArgs = {
  abortSignal?: AbortSignal;
  resumeExistingCompareRunId?: string | null;
  state: GapfillComparePipelineState;
  out: GapfillCompareRunOut;
  user: { id: string; email: string };
  house: Record<string, unknown> & {
    id: string;
    addressLine1?: string | null;
    addressCity?: string | null;
    addressState?: string | null;
    esiid?: string | null;
  };
  houses: Array<Record<string, unknown>>;
  esiid: string | null;
  timezone: string;
  canonicalWindow: { startDate: string; endDate: string };
  canonicalMonths: string[];
  canonicalWindowHelper: string;
  homeProfile: unknown;
  applianceProfile: unknown;
  testDateKeysLocal: Set<string>;
  candidateIntervalsForTesting: Array<{ timestamp: string; kwh: number }> | null;
  testRanges: Array<{ startDate: string; endDate: string }>;
  testRangesUsed: Array<{ startDate: string; endDate: string }>;
  testSelectionMode: "manual_ranges" | "random_days";
  testDaysRequested: number | null;
  testDaysSelected: number;
  seedUsed: string | null;
  testMode: string;
  candidateDaysAfterModeFilterCount: number | null;
  candidateWindowStart: string | null;
  candidateWindowEnd: string | null;
  excludedFromTest_travelCount: number;
  travelRangesFromDb: Array<{ startDate: string; endDate: string }>;
  travelDateKeysLocal: Set<string>;
  guardrailExcludedDateKeysLocal: Set<string>;
  overlapLocal: Set<string>;
  compareCoreTiming: ReturnType<typeof startCompareCoreTiming>;
  includeDiagnostics: boolean;
  includeUserPipelineParity: boolean;
  includeFullReportText: boolean;
  rebuildArtifact: boolean;
  requestedArtifactInputHash: string | null;
  requestedArtifactScenarioId: string | null;
  requireExactArtifactMatch: boolean;
  artifactIdentitySource: string | null;
  heavyOnlyCompactResponse: boolean;
  requestedCompareRunId: string | null;
  minDayCoveragePct: number;
  usage365?: unknown;
};

function normalizeArtifactIdentitySource(
  value: string | null | undefined
): "same_run_artifact_ensure" | "manual_request" | null {
  return value === "same_run_artifact_ensure" || value === "manual_request"
    ? value
    : null;
}

export async function runGapfillCompareCorePipeline(
  args: GapfillCompareCorePipelineArgs
): Promise<NextResponse> {
  const {
    resumeExistingCompareRunId,
    state,
    out,
    user,
    house,
    houses,
    esiid,
    timezone,
    testDateKeysLocal,
    candidateIntervalsForTesting,
    testRangesUsed,
    testSelectionMode,
    testDaysRequested,
    testDaysSelected,
    seedUsed,
    testMode,
    candidateDaysAfterModeFilterCount,
    candidateWindowStart,
    candidateWindowEnd,
    travelRangesFromDb,
    compareCoreTiming,
    requestedArtifactInputHash,
    requireExactArtifactMatch,
    artifactIdentitySource,
    requestedCompareRunId,
    minDayCoveragePct,
    usage365 = null,
  } = args;

  state.compareCoreTimingForLifecycle = compareCoreTiming;

  if (resumeExistingCompareRunId) {
    out.compareRunId = resumeExistingCompareRunId;
    out.compareRunStatus = "running";
    const markedRunning = await markGapfillCompareRunRunning({
      compareRunId: resumeExistingCompareRunId,
      phase: "compare_core_artifact_read_started",
      statusMeta: {
        route: "admin_gapfill_lab",
        compareRunId: resumeExistingCompareRunId,
        dropletResume: true,
        canonicalReadFamily: "getSimulatedUsageForHouseScenario->/api/user/usage/simulated/house",
        compareFreshMode: "artifact_only",
      },
    });
    if (!markedRunning) {
      out.compareRunStatus = "failed";
      const markedFailed = await markGapfillCompareRunFailed({
        compareRunId: resumeExistingCompareRunId,
        phase: "compare_worker_mark_running_failed",
        failureCode: "COMPARE_RUN_STATE_UPDATE_FAILED",
        failureMessage:
          "Could not persist running status for this compare run (usage DB unavailable or row update failed).",
        statusMeta: {
          route: "admin_gapfill_lab",
          dropletResume: true,
        },
      });
      return NextResponse.json(
        {
          ok: false,
          error: "compare_run_state_update_failed",
          message: markedFailed
            ? "Compare run could not be marked running on the usage database."
            : "Compare run could not be marked running, and failure details could not be saved to the usage database. The row may still show as queued.",
          failurePersisted: markedFailed,
          compareRunId: resumeExistingCompareRunId,
          compareCoreTiming: finalizeCompareCoreTiming(compareCoreTiming),
        },
        { status: 503 }
      );
    }
  }

  const pastScenario = await (prisma as any).usageSimulatorScenario
    .findFirst({
      where: {
      userId: user.id,
      houseId: house.id,
        name: "Past (Corrected)",
        archivedAt: null,
      },
      select: { id: true },
    })
    .catch(() => null);
  if (!pastScenario?.id) {
    return NextResponse.json(
      attachFailureContract({
        ok: false,
        error: "no_past_scenario",
        message: "No Past (Corrected) scenario found for this house.",
      }),
      { status: 400 }
    );
  }

  const normalizedArtifactIdentitySource = normalizeArtifactIdentitySource(artifactIdentitySource);
  if (!resumeExistingCompareRunId) {
  const compareRunStart = await createGapfillCompareRunStart({
    userId: user.id,
    houseId: house.id,
      compareFreshMode: "artifact_only",
    requestedInputHash: requestedArtifactInputHash,
      artifactScenarioId: String(pastScenario.id),
    requireExactArtifactMatch,
      artifactIdentitySource: normalizedArtifactIdentitySource,
      initialStatus: "started",
      initialPhase: "compare_core_artifact_read_started",
    statusMeta: {
      route: "admin_gapfill_lab",
        phase: "compare_core_artifact_read_started",
        canonicalReadFamily: "getSimulatedUsageForHouseScenario->/api/user/usage/simulated/house",
      requestedCompareRunId,
        compareFreshMode: "artifact_only",
    },
  });
  if (!compareRunStart.ok) {
    return NextResponse.json(
        attachFailureContract({
        ok: false,
          error: String(compareRunStart.error ?? "compare_run_queue_persist_failed"),
          message: compareRunStart.message,
          reasonCode: "COMPARE_RUN_QUEUE_PERSIST_FAILED",
        }),
      { status: 500 }
    );
  }
  out.compareRunId = compareRunStart.compareRunId;
    out.compareRunStatus = "running";
    out.compareRunSnapshotReady = false;
  }

  const compareRequestTruth = {
      route: "admin_gapfill_lab",
    compareExecutionMode: "canonical_artifact_only",
    canonicalReadLayer: "getSimulatedUsageForHouseScenario",
    canonicalReadRoute: "/api/user/usage/simulated/house",
    validationDaysTruthSource: "canonical_saved_artifact_family",
  };
  state.compareRequestTruthForLifecycle = compareRequestTruth;
  state.artifactRequestTruthForLifecycle = {
    requestedInputHash: requestedArtifactInputHash,
    scenarioId: String(pastScenario.id),
    sourceFamily: "usageSimulatorBuild + shared past cache",
  };
  markCompareCoreStep(compareCoreTiming, "build_shared_compare");
  const exactArtifactInputHash =
    typeof requestedArtifactInputHash === "string" && requestedArtifactInputHash.trim()
      ? requestedArtifactInputHash.trim()
      : undefined;
  const requireExactCanonicalArtifact = requireExactArtifactMatch || Boolean(exactArtifactInputHash);
  state.artifactRequestTruthForLifecycle = {
    ...state.artifactRequestTruthForLifecycle,
    canonicalArtifactInputHash: exactArtifactInputHash ?? null,
    requireExactCanonicalArtifact,
  };

  const readCommon = {
    userId: user.id,
    houseId: house.id,
    scenarioId: String(pastScenario.id),
    readMode: "artifact_only" as const,
    exactArtifactInputHash,
    requireExactArtifactMatch: requireExactCanonicalArtifact,
    correlationId: out.compareRunId ?? requestedCompareRunId ?? undefined,
  };

  const canonicalRead = await getSimulatedUsageForHouseScenario({
    ...readCommon,
    projectionMode: "raw",
    readContext: {
      artifactReadMode: "artifact_only",
      projectionMode: "raw",
      compareSidecarRequest: true,
    },
  });
  if (!canonicalRead.ok) {
    await markGapfillCompareRunFailed({
      compareRunId: out.compareRunId!,
      phase: "compare_core_canonical_read_failed",
      failureCode: String(canonicalRead.code ?? "compare_core_canonical_read_failed"),
      failureMessage: String(canonicalRead.message ?? "Canonical read failed."),
      statusMeta: { route: "admin_gapfill_lab" },
    });
    out.compareRunStatus = "failed";
    out.compareRunTerminalState = true;
    return NextResponse.json(
      attachFailureContract({
        ok: false,
        error: "compare_core_canonical_read_failed",
        message: String(canonicalRead.message ?? "Canonical read failed."),
      compareRunId: out.compareRunId,
        compareRunStatus: "failed",
      }),
      { status: 500 }
    );
  }

  const baselineRead = await getSimulatedUsageForHouseScenario({
    ...readCommon,
    projectionMode: "baseline",
    readContext: {
      artifactReadMode: "artifact_only",
      projectionMode: "baseline",
      compareSidecarRequest: true,
      },
    });
  const canonicalDataset = canonicalRead.dataset as any;
  const baselineReadUsedCanonicalRawFallback = !baselineRead.ok;
  const baselineDataset = baselineRead.ok ? (baselineRead.dataset as any) : canonicalDataset;

  const requestedUserParity =
    args.includeDiagnostics && args.includeUserPipelineParity;
  const userPipelineReadResolved = requestedUserParity
    ? await getSimulatedUsageForHouseScenario({
        ...readCommon,
        readContext: {
          artifactReadMode: "artifact_only",
          projectionMode: "baseline",
          compareSidecarRequest: true,
        },
      })
    : null;
  const userPipelineDataset = userPipelineReadResolved?.ok ? (userPipelineReadResolved.dataset as any) : null;

  const dailyParityMismatchSample: Array<{
    localDate: string;
    gapfillBaselineKwh: number;
    userPipelineKwh: number;
    absKwhDiff: number;
  }> = [];
  let dailyParityDateKeys: string[] = [];
  let dailyParityMismatchCount = 0;
  let dailyParityMaxAbsKwhDiff = 0;
  let dailyParityTotalAbsKwhDiff = 0;
  if (requestedUserParity) {
    const gapfillBaselineDaily = new Map<string, number>();
    for (const row of Array.isArray(baselineDataset?.daily) ? baselineDataset.daily : []) {
      const dk = String(row?.date ?? "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dk)) continue;
      gapfillBaselineDaily.set(dk, round2(Number(row?.kwh) || 0));
    }
    const userPipelineDaily = new Map<string, number>();
    for (const row of Array.isArray(userPipelineDataset?.daily) ? userPipelineDataset.daily : []) {
      const dk = String(row?.date ?? "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dk)) continue;
      userPipelineDaily.set(dk, round2(Number(row?.kwh) || 0));
    }
    dailyParityDateKeys = Array.from(
      new Set<string>([...Array.from(gapfillBaselineDaily.keys()), ...Array.from(userPipelineDaily.keys())])
    ).sort();
    for (const dk of dailyParityDateKeys) {
      const gapfillKwh = round2(gapfillBaselineDaily.get(dk) ?? 0);
      const userKwh = round2(userPipelineDaily.get(dk) ?? 0);
      const absDiff = round2(Math.abs(gapfillKwh - userKwh));
      dailyParityMaxAbsKwhDiff = Math.max(dailyParityMaxAbsKwhDiff, absDiff);
      dailyParityTotalAbsKwhDiff = round2(dailyParityTotalAbsKwhDiff + absDiff);
      if (absDiff > 0) {
        dailyParityMismatchCount += 1;
        if (dailyParityMismatchSample.length < 25) {
          dailyParityMismatchSample.push({
            localDate: dk,
            gapfillBaselineKwh: gapfillKwh,
            userPipelineKwh: userKwh,
            absKwhDiff: absDiff,
          });
        }
      }
    }
  }
  const userPipelineParitySource = !requestedUserParity
    ? "not_requested"
    : baselineReadUsedCanonicalRawFallback
      ? "getSimulatedUsageForHouseScenario(raw_projection_fallback_from_failed_baseline_read)+getSimulatedUsageForHouseScenario(default_projection)+buildValidationCompareProjectionSidecar"
      : "getSimulatedUsageForHouseScenario(baseline_projection)+getSimulatedUsageForHouseScenario(default_projection)+buildValidationCompareProjectionSidecar";
  const userPipelineParity = {
    status: !requestedUserParity
      ? "not_requested"
      : userPipelineReadResolved?.ok
        ? baselineReadUsedCanonicalRawFallback
          ? "available_with_baseline_fallback_raw_projection"
          : "available"
        : "read_failed",
    source: userPipelineParitySource,
    baselineProjectionRequested: "baseline",
    baselineProjectionUsed: baselineReadUsedCanonicalRawFallback ? "raw_fallback" : "baseline",
    baselineReadOk: baselineRead.ok,
    baselineReadError: baselineRead.ok
      ? null
      : String(baselineRead.message ?? "baseline_projection_read_failed"),
    userPipelineProjectionUsed: "default",
    includeUserPipelineParity: requestedUserParity,
    comparedDateCount: requestedUserParity ? dailyParityDateKeys.length : null,
    mismatchDateCount: requestedUserParity ? dailyParityMismatchCount : null,
    maxAbsKwhDiff: requestedUserParity ? round2(dailyParityMaxAbsKwhDiff) : null,
    totalAbsKwhDiff: requestedUserParity ? round2(dailyParityTotalAbsKwhDiff) : null,
    mismatchSample: requestedUserParity ? dailyParityMismatchSample : null,
    userPipelineReadError: !requestedUserParity
      ? null
      : userPipelineReadResolved?.ok
        ? null
        : String(userPipelineReadResolved?.message ?? "user_pipeline_read_failed"),
  };
  const userPipelineCompareProjection = userPipelineReadResolved?.ok
    ? buildValidationCompareProjectionSidecar(userPipelineDataset)
          : null;

  const selectedDateKeysSorted = Array.from(testDateKeysLocal).sort();
  const testDateKeySet = new Set<string>(selectedDateKeysSorted);
  const actualIntervalsForSelected = (
    candidateIntervalsForTesting != null && candidateIntervalsForTesting.length > 0
      ? candidateIntervalsForTesting
      : await getActualIntervalsForRange({
          houseId: house.id,
          esiid,
          startDate: shiftIsoDateUtc(selectedDateKeysSorted[0] ?? "", -1),
          endDate: shiftIsoDateUtc(
            selectedDateKeysSorted[selectedDateKeysSorted.length - 1] ?? "",
            1
          ),
        })
  ).filter((row) =>
    testDateKeySet.has(dateKeyInTimezone(String(row?.timestamp ?? ""), timezone))
  );
  markCompareCoreStep(compareCoreTiming, "load_actual_usage");

  const simulatedIntervalsForSelected = Array.isArray(canonicalDataset?.series?.intervals15)
    ? (canonicalDataset.series.intervals15 as Array<{ timestamp: string; kwh: number }>).filter((row) =>
        testDateKeySet.has(dateKeyInTimezone(String(row?.timestamp ?? ""), timezone))
      )
    : [];
  const simulatedByTs = new Map<string, number>();
  for (const row of simulatedIntervalsForSelected) {
    simulatedByTs.set(canonicalIntervalKey(String(row?.timestamp ?? "")), Number(row?.kwh) || 0);
  }

  const actualDailyByDate = new Map<string, number>();
  for (const row of actualIntervalsForSelected) {
    const dk = dateKeyInTimezone(String(row?.timestamp ?? ""), timezone);
    if (!testDateKeySet.has(dk)) continue;
    actualDailyByDate.set(dk, round2((actualDailyByDate.get(dk) ?? 0) + (Number(row?.kwh) || 0)));
  }

  const simDailyFromMeta = (() => {
    const src =
      (canonicalDataset?.meta?.canonicalArtifactSimulatedDayTotalsByDate as
        | Record<string, number>
        | undefined) ??
      (canonicalDataset?.canonicalArtifactSimulatedDayTotalsByDate as
        | Record<string, number>
        | undefined) ??
      {};
    const outMap = new Map<string, number>();
    for (const [dk, kwh] of Object.entries(src)) {
      const key = String(dk).slice(0, 10);
      if (!testDateKeySet.has(key)) continue;
      outMap.set(key, round2(Number(kwh) || 0));
    }
    return outMap;
  })();
  if (simDailyFromMeta.size === 0 && Array.isArray(canonicalDataset?.daily)) {
    for (const row of canonicalDataset.daily as Array<{ date?: string; kwh?: number }>) {
      const dk = String(row?.date ?? "").slice(0, 10);
      if (!testDateKeySet.has(dk)) continue;
      simDailyFromMeta.set(dk, round2(Number(row?.kwh) || 0));
    }
  }

  const metrics = computeGapFillMetrics({
    actual: actualIntervalsForSelected,
    simulated: simulatedIntervalsForSelected,
    simulatedByTs,
            timezone,
  });
  const scoredDayTruthRows = selectedDateKeysSorted.map((dk) => {
    const actualDayKwh = round2(actualDailyByDate.get(dk) ?? 0);
    const freshCompareSimDayKwh = round2(simDailyFromMeta.get(dk) ?? 0);
    const dow = getLocalDayOfWeekFromDateKey(dk, timezone);
    const weather = compareWeatherFromDailyWeather(
      (canonicalDataset as any)?.dailyWeather,
      dk
    );
    return {
      localDate: dk,
      actualDayKwh,
      freshCompareSimDayKwh,
      displayedPastStyleSimDayKwh: freshCompareSimDayKwh,
      actualVsFreshErrorKwh: round2(actualDayKwh - freshCompareSimDayKwh),
      displayVsFreshParityMatch: true,
      parityAvailability: "available",
      parityReasonCode: "display_matches_canonical_artifact",
      dayType: dow === 0 || dow === 6 ? "weekend" : "weekday",
      weatherBasis: weather.weatherMissing ? null : "daily_weather",
      weatherSourceUsed: weather.source ?? null,
      weatherFallbackReason: weather.weatherMissing ? "weather_missing_for_selected_date" : null,
      avgTempF: weather.tAvgF,
      minTempF: weather.tMinF,
      maxTempF: weather.tMaxF,
      hdd65: weather.hdd65,
      cdd65: weather.cdd65,
      fallbackLevel: null,
      selectedDayTotalSource: "canonical_artifact_simulated_day_total",
      selectedShapeVariant: null,
      selectedReferenceMatchTier: null,
      selectedMatchSampleCount: null,
      reasonCode: "canonical_artifact_simulated_day_total",
    };
  });
  markCompareCoreStep(compareCoreTiming, "build_metrics");

  const metricsSummary = {
      mae: metrics.mae,
      rmse: metrics.rmse,
      mape: metrics.mape,
      wape: metrics.wape,
      maxAbs: metrics.maxAbs,
      totalActualKwhMasked: metrics.totalActualKwhMasked,
      totalSimKwhMasked: metrics.totalSimKwhMasked,
      deltaKwhMasked: metrics.deltaKwhMasked,
    mapeFiltered: metrics.mapeFiltered,
    mapeFilteredCount: metrics.mapeFilteredCount,
  };
  const compareTruth = {
    compareSharedCalcPath:
      "getSimulatedUsageForHouseScenario(/api/user/usage/simulated/house artifact_only)->persisted_artifact_compare_read",
    sourceOfDaySimulationCore: SOURCE_OF_DAY_SIMULATION_CORE,
    validationDaysTruthSource: "canonical_saved_artifact_family",
    userPipelineParitySource,
  };
  const snapshotPayload: Record<string, unknown> = {
    selectedScoredDateKeys: selectedDateKeysSorted,
    scoredDayTruthRowsCompact: scoredDayTruthRows,
    scoredDayWeatherRows: [],
    scoredDayWeatherTruth: {
      availability: "not_requested",
      reasonCode: "SCORED_DAY_WEATHER_NOT_REQUESTED",
      explanation: "Canonical GapFill compare reads persisted artifact truth only.",
      source: "canonical_saved_artifact_family",
      scoredDateCount: selectedDateKeysSorted.length,
      weatherRowCount: 0,
      missingDateCount: selectedDateKeysSorted.length,
      missingDateSample: selectedDateKeysSorted.slice(0, 10),
    },
    travelVacantParityRows: [],
    travelVacantParityTruth: {
      availability: "not_requested",
      reasonCode: "TRAVEL_VACANT_PARITY_NOT_REQUESTED",
      explanation: "GapFill canonical compare no longer owns fresh pre-DB parity execution.",
      source: "canonical_saved_artifact_family",
      comparisonBasis: "persisted_artifact_truth_only",
      requestedDateCount: 0,
      validatedDateCount: 0,
      mismatchCount: 0,
      missingArtifactReferenceCount: 0,
      missingFreshCompareCount: 0,
      requestedDateSample: [],
      exactProofRequired: false,
      exactProofSatisfied: true,
    },
    metricsSummary,
    counts: {
      scoredRowCount: scoredDayTruthRows.length,
      selectedDateKeyCount: selectedDateKeysSorted.length,
      parityRowCount: 0,
    },
    compareTruth,
    userPipelineParity,
    userPipelineCompareProjection,
    compareCoreTiming: finalizeCompareCoreTiming(compareCoreTiming),
    identityTruth: {
      scenarioId: String(pastScenario.id),
      canonicalReadSource: "getSimulatedUsageForHouseScenario",
      canonicalReadRoute: "/api/user/usage/simulated/house",
      artifactInputHashUsed: exactArtifactInputHash ?? null,
    },
    modelAssumptions: {
      selectedDaysRequestedCount: selectedDateKeysSorted.length,
      validationOnlyDateKeysLocal: selectedDateKeysSorted,
      canonicalReadFamily: "getSimulatedUsageForHouseScenario->/api/user/usage/simulated/house",
      projectionMode: "baseline_vs_accuracy",
      compareFreshModeUsed: "artifact_only",
      compareExecutionMode: "canonical_artifact_only",
    },
    sharedDiagnostics: buildSharedPastSimDiagnostics({
      callerType: "gapfill_test",
      dataset: canonicalDataset,
      scenarioId: String(pastScenario.id),
      usageInputMode: String((canonicalDataset as any)?.meta?.lockboxInput?.mode ?? "ACTUAL_INTERVAL_BASELINE"),
      weatherLogicMode: String((canonicalDataset as any)?.meta?.weatherLogicMode ?? ""),
      compareProjection: userPipelineCompareProjection ?? undefined,
      readMode: "artifact_only",
      projectionMode: "baseline",
      artifactInputHash: exactArtifactInputHash ?? null,
      artifactPersistenceOutcome: "persisted_artifact_compare_read",
    }),
  };

  const finalized = await finalizeGapfillCompareRunSnapshot({
    compareRunId: out.compareRunId!,
    phase: "compare_core_complete",
    snapshot: snapshotPayload,
      statusMeta: {
        route: "admin_gapfill_lab",
      projectionMode: "baseline_vs_accuracy",
      canonicalTruthSource: "/api/user/usage/simulated/house",
      compareFreshMode: "artifact_only",
      },
    });
  if (!finalized) {
      await markGapfillCompareRunFailed({
      compareRunId: out.compareRunId!,
      phase: "compare_core_snapshot_persist_failed",
      failureCode: "compare_core_snapshot_persist_failed",
      failureMessage: "Could not persist compare snapshot payload.",
      statusMeta: { route: "admin_gapfill_lab" },
      });
      out.compareRunStatus = "failed";
      out.compareRunTerminalState = true;
      return NextResponse.json(
      attachFailureContract({
          ok: false,
        error: "compare_core_snapshot_persist_failed",
        message: "Could not persist compare snapshot payload.",
          compareRunId: out.compareRunId,
        compareRunStatus: "failed",
      }),
        { status: 500 }
      );
    }

    out.compareRunStatus = "succeeded";
    out.compareRunSnapshotReady = true;
    out.compareRunTerminalState = true;
  state.compareCoreTimingForLifecycle = compareCoreTiming;
  state.compareRequestTruthForLifecycle = compareRequestTruth;
  state.artifactRequestTruthForLifecycle = {
    requestedInputHash: requestedArtifactInputHash,
    scenarioId: String(pastScenario.id),
    sourceFamily: "usageSimulatorBuild + shared past cache",
    canonicalArtifactInputHash: exactArtifactInputHash ?? null,
  };

  return NextResponse.json({
    ok: true,
    email: user.email,
    userId: user.id,
    house: {
      id: house.id,
      label:
        [house.addressLine1, house.addressCity, house.addressState].filter(Boolean).join(", ") ||
        house.id,
    },
    houses: houses.map((h: any) => ({
      id: h.id,
      label: [h.addressLine1, h.addressCity, h.addressState].filter(Boolean).join(", ") || h.id,
    })),
    timezone,
    compareExecutionMode: "inline_canonical",
    compareRunId: out.compareRunId,
    compareRunStatus: "succeeded",
    compareRunSnapshotReady: true,
    modelAssumptions: buildSelectedDaysCoreResponseModelAssumptions(
      (snapshotPayload.modelAssumptions as Record<string, unknown>) ?? null
    ),
    testIntervalsCount: actualIntervalsForSelected.length,
    metrics: metricsSummary,
    primaryPercentMetric: metricsSummary.wape,
    byMonth: metrics.byMonth,
    byHour: metrics.byHour,
    byDayType: metrics.byDayType,
    worstDays: metrics.worstDays,
    diagnostics: metrics.diagnostics,
    pasteSummary: metrics.pasteSummary,
    travelRangesFromDb,
    testSelectionMode,
    testDaysRequested,
    testDaysSelected,
    seedUsed,
    testRangesUsed,
    testMode,
    candidateDaysAfterModeFilterCount,
    minDayCoveragePct,
    candidateWindowStartUtc: candidateWindowStart,
    candidateWindowEndUtc: candidateWindowEnd,
    usage365,
    scoredDayTruthRows,
    scoredDayWeatherRows: [],
    scoredDayWeatherTruth: (snapshotPayload.scoredDayWeatherTruth as Record<string, unknown>) ?? null,
    parity: {
      travelVacantParityRows: [],
      travelVacantParityTruth: snapshotPayload.travelVacantParityTruth,
      userPipelineParity,
      compareTruth,
      identityTruth: snapshotPayload.identityTruth,
      compareCoreTiming: snapshotPayload.compareCoreTiming,
      counts: snapshotPayload.counts,
      missAttributionSummary: null,
    },
    compareTruth,
    compareSharedCalcPath: compareTruth.compareSharedCalcPath,
    baselineDatasetProjection: baselineDataset,
    message: "Gap-Fill compare executed via persisted-artifact reads only.",
    noRecompute: true,
  });
}
