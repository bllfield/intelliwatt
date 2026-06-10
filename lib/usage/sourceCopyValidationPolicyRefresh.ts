import { prisma } from "@/lib/db";
import { travelRangesFromPastBuildInputs } from "@/lib/usage/pastArtifactIdentity";
import { preferredActualSourceFromPastBuildInputs } from "@/lib/usage/pastSimValidationReadBackfill";
import type { CoverageWindow } from "@/lib/usage/canonicalMetadataWindow";
import {
  gateSourceCopyValidationPolicyMatch,
  readSourceValidationPolicyFromBuildInputs,
  resolveGlobalValidationDayKeysForPastSim,
} from "@/lib/usage/validationDayPolicy";
import { dispatchPastSimRecalc } from "@/modules/usageSimulator/pastSimRecalcDispatch";
import type { SimulatorMode } from "@/modules/usageSimulator/requirements";
import type { TravelRange } from "@/modules/simulatedUsage/types";
import type { WeatherPreference } from "@/modules/weatherNormalization/normalizer";

export const SOURCE_COPY_POLICY_REFRESH_CALLER_LABEL = "gapfill_source_copy_policy_refresh";

export type SourceCopyPolicyRefreshDiagnostics = {
  sourcePolicyRefreshAttempted: boolean;
  sourcePolicyRefreshSucceeded: boolean;
  previousSourcePolicyRevision: string | null;
  previousSourcePolicyHash: string | null;
  refreshedSourcePolicyRevision: string | null;
  refreshedSourcePolicyHash: string | null;
  currentPolicyRevision: string;
  currentPolicyHash: string;
};

function weatherPreferenceFromBuildInputs(
  buildInputs: Record<string, unknown> | null | undefined
): WeatherPreference {
  const raw = String(buildInputs?.weatherPreference ?? "NONE");
  if (raw === "LAST_YEAR_WEATHER" || raw === "LONG_TERM_AVERAGE") return raw;
  return "NONE";
}

function simulatorModeFromBuildInputs(
  buildInputs: Record<string, unknown> | null | undefined
): SimulatorMode {
  const mode = String(buildInputs?.mode ?? "");
  if (mode === "MANUAL_TOTALS" || mode === "NEW_BUILD_ESTIMATE" || mode === "SMT_BASELINE") {
    return mode;
  }
  return "SMT_BASELINE";
}

export async function loadSourcePastSimBuildInputs(args: {
  userId: string;
  houseId: string;
}): Promise<{
  scenarioId: string | null;
  buildInputs: Record<string, unknown> | null;
}> {
  const scenario = await (prisma as any).usageSimulatorScenario
    .findFirst({
      where: {
        userId: args.userId,
        houseId: args.houseId,
        name: "Past (Corrected)",
        archivedAt: null,
      },
      select: { id: true },
    })
    .catch(() => null);
  if (!scenario?.id) {
    return { scenarioId: null, buildInputs: null };
  }
  const build = await (prisma as any).usageSimulatorBuild
    .findUnique({
      where: {
        userId_houseId_scenarioKey: {
          userId: args.userId,
          houseId: args.houseId,
          scenarioKey: String(scenario.id),
        },
      },
      select: { buildInputs: true },
    })
    .catch(() => null);
  return {
    scenarioId: String(scenario.id),
    buildInputs: ((build as any)?.buildInputs as Record<string, unknown> | null | undefined) ?? null,
  };
}

export function sourceCopyPolicyNeedsRefresh(args: {
  gateOk: boolean;
  buildInputs: Record<string, unknown> | null | undefined;
}): boolean {
  if (!args.gateOk) return true;
  const source = readSourceValidationPolicyFromBuildInputs(args.buildInputs);
  return source.validationOnlyDateKeysLocal.length === 0;
}

/**
 * GapFill Lab source-copy parity: refresh source Past Sim under active global compare-day policy
 * when stamps/keys are stale or missing, then reload build inputs for key copy.
 */
export async function ensureSourceCopyValidationPolicyFresh(args: {
  sourceUserId: string;
  sourceHouseId: string;
  sourceEsiid: string | null;
  sourceTravelRanges: TravelRange[];
  window: CoverageWindow;
  correlationId?: string | null;
}): Promise<
  | {
      ok: true;
      buildInputs: Record<string, unknown>;
      scenarioId: string;
      refreshDiagnostics: SourceCopyPolicyRefreshDiagnostics | null;
    }
  | { ok: false; status: number; body: Record<string, unknown> }
> {
  const sourceUserId = String(args.sourceUserId ?? "").trim();
  const sourceHouseId = String(args.sourceHouseId ?? "").trim();

  let loaded = await loadSourcePastSimBuildInputs({ userId: sourceUserId, houseId: sourceHouseId });
  if (!loaded.scenarioId) {
    return {
      ok: false,
      status: 409,
      body: {
        ok: false,
        error: "source_validation_policy_refresh_failed",
        message: "Source Past Sim scenario is missing; cannot refresh validation-day policy.",
        sourceHouseId,
        refreshError: "source_past_scenario_missing",
        sourcePolicyRefreshAttempted: true,
        sourcePolicyRefreshSucceeded: false,
      },
    };
  }

  let gate = await gateSourceCopyValidationPolicyMatch({
    sourceHouseId,
    sourceBuildInputs: loaded.buildInputs,
    surface: "user_site",
  });
  const previousSource = readSourceValidationPolicyFromBuildInputs(loaded.buildInputs);

  if (!sourceCopyPolicyNeedsRefresh({ gateOk: gate.ok, buildInputs: loaded.buildInputs })) {
    return {
      ok: true,
      buildInputs: loaded.buildInputs ?? {},
      scenarioId: loaded.scenarioId,
      refreshDiagnostics: null,
    };
  }

  const globalValidation = await resolveGlobalValidationDayKeysForPastSim({
    userId: sourceUserId,
    houseId: sourceHouseId,
    esiid: args.sourceEsiid,
    sourceHouseId,
    surface: "user_site",
    window: args.window,
  });

  const travelRangesForRecalc =
    args.sourceTravelRanges.length > 0
      ? args.sourceTravelRanges
      : travelRangesFromPastBuildInputs(loaded.buildInputs);
  const preferredActualSource = preferredActualSourceFromPastBuildInputs(loaded.buildInputs ?? {});

  let dispatched: Awaited<ReturnType<typeof dispatchPastSimRecalc>>;
  try {
    dispatched = await dispatchPastSimRecalc({
      userId: sourceUserId,
      houseId: sourceHouseId,
      esiid: args.sourceEsiid,
      mode: simulatorModeFromBuildInputs(loaded.buildInputs),
      scenarioId: loaded.scenarioId,
      weatherPreference: weatherPreferenceFromBuildInputs(loaded.buildInputs),
      persistPastSimBaseline: true,
      actualContextHouseId: sourceHouseId,
      validationOnlyDateKeysLocal: globalValidation.validationOnlyDateKeysLocal,
      preLockboxTravelRanges: travelRangesForRecalc,
      validationDaySelectionMode: globalValidation.selectionMode,
      validationDayCount: globalValidation.validationDayCount,
      correlationId: args.correlationId ?? undefined,
      runContext: {
        callerLabel: SOURCE_COPY_POLICY_REFRESH_CALLER_LABEL,
        buildPathKind: "recalc",
        persistRequested: true,
        ...(preferredActualSource ? { preferredActualSource } : {}),
      },
    });
  } catch (error: unknown) {
    return {
      ok: false,
      status: 409,
      body: {
        ok: false,
        error: "source_validation_policy_refresh_failed",
        message: "Source Past Sim refresh under the active global compare-day policy failed.",
        sourceHouseId,
        currentPolicyRevision: globalValidation.policy.policyRevision,
        currentPolicyHash: globalValidation.policyHash,
        previousSourcePolicyRevision: previousSource.validationDayPolicyRevision,
        previousSourcePolicyHash: previousSource.validationDayPolicyHash,
        refreshError: error instanceof Error ? error.message : String(error),
        sourcePolicyRefreshAttempted: true,
        sourcePolicyRefreshSucceeded: false,
      },
    };
  }

  if (dispatched.executionMode === "droplet_async") {
    return {
      ok: false,
      status: 409,
      body: {
        ok: false,
        error: "source_validation_policy_refreshing",
        message:
          "Source Past Sim refresh started under the active global compare-day policy. Retry when the job completes.",
        sourceHouseId,
        jobId: dispatched.jobId,
        correlationId: dispatched.correlationId,
        currentPolicyRevision: globalValidation.policy.policyRevision,
        currentPolicyHash: globalValidation.policyHash,
        previousSourcePolicyRevision: previousSource.validationDayPolicyRevision,
        previousSourcePolicyHash: previousSource.validationDayPolicyHash,
        sourcePolicyRefreshAttempted: true,
        sourcePolicyRefreshSucceeded: false,
        retryInstruction:
          "Poll Past Sim recalc job status or retry GapFill Lab source-copy after source refresh completes.",
      },
    };
  }

  if (!dispatched.result.ok) {
    return {
      ok: false,
      status: 409,
      body: {
        ok: false,
        error: "source_validation_policy_refresh_failed",
        message: "Source Past Sim refresh under the active global compare-day policy failed.",
        sourceHouseId,
        currentPolicyRevision: globalValidation.policy.policyRevision,
        currentPolicyHash: globalValidation.policyHash,
        previousSourcePolicyRevision: previousSource.validationDayPolicyRevision,
        previousSourcePolicyHash: previousSource.validationDayPolicyHash,
        refreshError: dispatched.result.error ?? "source_past_recalc_failed",
        missingItems: dispatched.result.missingItems ?? null,
        sourcePolicyRefreshAttempted: true,
        sourcePolicyRefreshSucceeded: false,
      },
    };
  }

  loaded = await loadSourcePastSimBuildInputs({ userId: sourceUserId, houseId: sourceHouseId });
  gate = await gateSourceCopyValidationPolicyMatch({
    sourceHouseId,
    sourceBuildInputs: loaded.buildInputs,
    surface: "user_site",
  });
  const refreshedSource = readSourceValidationPolicyFromBuildInputs(loaded.buildInputs);

  if (!gate.ok) {
    return {
      ok: false,
      status: 409,
      body: {
        ok: false,
        error: "source_validation_policy_refresh_failed",
        message: "Source Past Sim refresh completed but validation-day policy stamps still do not match.",
        sourceHouseId,
        currentPolicyRevision: globalValidation.policy.policyRevision,
        currentPolicyHash: globalValidation.policyHash,
        previousSourcePolicyRevision: previousSource.validationDayPolicyRevision,
        previousSourcePolicyHash: previousSource.validationDayPolicyHash,
        refreshedSourcePolicyRevision: refreshedSource.validationDayPolicyRevision,
        refreshedSourcePolicyHash: refreshedSource.validationDayPolicyHash,
        refreshError: "source_policy_stamps_still_stale_after_refresh",
        sourcePolicyRefreshAttempted: true,
        sourcePolicyRefreshSucceeded: false,
      },
    };
  }

  if (refreshedSource.validationOnlyDateKeysLocal.length === 0) {
    return {
      ok: false,
      status: 409,
      body: {
        ok: false,
        error: "source_validation_policy_refresh_missing_keys",
        message:
          "Source Past Sim refresh completed under the active global compare-day policy but validation keys are still missing.",
        sourceHouseId,
        currentPolicyRevision: gate.activePolicy.policyRevision,
        currentPolicyHash: gate.policyHash,
        previousSourcePolicyRevision: previousSource.validationDayPolicyRevision,
        previousSourcePolicyHash: previousSource.validationDayPolicyHash,
        refreshedSourcePolicyRevision: refreshedSource.validationDayPolicyRevision,
        refreshedSourcePolicyHash: refreshedSource.validationDayPolicyHash,
        sourcePolicyRefreshAttempted: true,
        sourcePolicyRefreshSucceeded: false,
      },
    };
  }

  return {
    ok: true,
    buildInputs: loaded.buildInputs ?? {},
    scenarioId: loaded.scenarioId!,
    refreshDiagnostics: {
      sourcePolicyRefreshAttempted: true,
      sourcePolicyRefreshSucceeded: true,
      previousSourcePolicyRevision: previousSource.validationDayPolicyRevision,
      previousSourcePolicyHash: previousSource.validationDayPolicyHash,
      refreshedSourcePolicyRevision: refreshedSource.validationDayPolicyRevision,
      refreshedSourcePolicyHash: refreshedSource.validationDayPolicyHash,
      currentPolicyRevision: gate.activePolicy.policyRevision,
      currentPolicyHash: gate.policyHash,
    },
  };
}
