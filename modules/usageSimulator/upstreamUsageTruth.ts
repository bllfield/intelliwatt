import { resolveIntervalsLayer } from "@/lib/usage/resolveIntervalsLayer";
import {
  resolveActualContextHouseForSimulation,
  resolveSimulationHouseForUser,
} from "@/lib/usage/resolveActualContextHouseForSimulation";
import { ensureSmtCoverageForHouse } from "@/lib/usage/ensureSmtCoverage";
import { IntervalSeriesKind } from "@/modules/usageSimulator/kinds";
import { resolveReportedCoverageWindow } from "@/modules/usageSimulator/metadataWindow";

// This module is the live shared upstream-usage owner for existing shared simulation surfaces.
// The isolated lockbox owner is implemented separately under modules/onePathSim/upstreamUsageTruth.ts.

export type UpstreamUsageTruthOwner = {
  label: string;
  owner: string;
  whyItMatters: string;
};

export type UpstreamUsageTruthSection = {
  title: string;
  summary: string;
  currentRun: Record<string, unknown>;
  sharedOwners: UpstreamUsageTruthOwner[];
};

export type UpstreamUsageTruthSeedResult = {
  ok: boolean;
  homeId?: string;
  message?: string;
} | null;

export type UpstreamUsageTruthSource =
  | "persisted_usage_output"
  | "seeded_via_existing_usage_orchestration"
  | "missing_usage_truth";

export type UpstreamUsageTruthResult = {
  selectedHouse: { id: string; esiid: string | null };
  actualContextHouse: { id: string; esiid: string | null };
  dataset: any | null;
  alternatives: { smt: any; greenButton: any };
  usageTruthSource: UpstreamUsageTruthSource;
  seedResult: UpstreamUsageTruthSeedResult;
  summary: UpstreamUsageTruthSection;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((entry) => String(entry ?? "")).filter(Boolean) : [];
}

function summarizeUsageTruthStatus(args: {
  dataset: any | null;
  usageTruthSource: UpstreamUsageTruthSource;
  seedResult: UpstreamUsageTruthSeedResult;
}) {
  const seedingAttempted = args.seedResult != null;
  const downstreamSimulationAllowed = Boolean(args.dataset);
  const refreshSucceeded = args.seedResult?.ok === true;
  const usageTruthStatus =
    args.dataset && args.usageTruthSource === "persisted_usage_output"
      ? "existing_persisted_truth"
      : args.dataset && seedingAttempted
        ? "seeded_via_existing_refresh"
        : seedingAttempted
          ? "missing_after_seed_attempt"
          : "unavailable";
  const seedingResult = seedingAttempted ? (refreshSucceeded && args.dataset ? "success" : "failure") : "not_needed";
  return {
    usageTruthStatus,
    downstreamSimulationAllowed,
    seedingAttempted,
    seedingResult,
    lookedForExistingUsageTruth: true,
    existingUsageTruthFound: args.usageTruthSource === "persisted_usage_output",
    refreshRequested: seedingAttempted,
    refreshCompleted: refreshSucceeded,
    refreshFailureReason: args.seedResult && !refreshSucceeded ? args.seedResult.message ?? null : null,
  } as const;
}

export function buildUpstreamUsageTruthSummary(args: {
  selectedHouseId: string;
  actualContextHouseId: string;
  dataset: any | null;
  usageTruthSource: UpstreamUsageTruthSource;
  seedResult: UpstreamUsageTruthSeedResult;
}): UpstreamUsageTruthSection {
  const datasetRecord = asRecord(args.dataset);
  const datasetSummary = asRecord(datasetRecord.summary);
  const datasetMeta = asRecord(datasetRecord.meta);
  const status = summarizeUsageTruthStatus(args);
  const usageReportedWindow = args.dataset
    ? resolveReportedCoverageWindow({
        dataset: args.dataset,
        fallbackStartDate: String(datasetSummary.start ?? ""),
        fallbackEndDate: String(datasetSummary.end ?? ""),
      })
    : { startDate: null, endDate: null };

  return {
    title: "Upstream Usage Truth",
    summary:
      "This panel describes the live shared upstream-usage owner: usage stays upstream, simulation stays downstream, and the shared path reads persisted usage truth first before optionally requesting the existing live usage refresh path.",
    currentRun: {
      statusSummary: {
        usageTruthStatus: status.usageTruthStatus,
        downstreamSimulationAllowed: status.downstreamSimulationAllowed,
        seedingAttempted: status.seedingAttempted,
        seedingResult: status.seedingResult,
      },
      sourceIdentity: {
        selectedHouseId: args.selectedHouseId,
        actualContextHouseId: args.actualContextHouseId,
        usageTruthHouseId: args.actualContextHouseId,
        sourceType:
          status.usageTruthStatus === "existing_persisted_truth"
            ? "existing_persisted_usage_truth"
            : status.usageTruthStatus === "seeded_via_existing_refresh"
              ? "persisted_usage_truth_after_refresh"
              : "usage_truth_unavailable",
        sourceOwner: "shared usage layer / resolveIntervalsLayer ACTUAL_USAGE_INTERVALS",
        usageArtifactId: datasetMeta.artifactId ?? null,
        usageDatasetId: datasetMeta.datasetId ?? null,
        usageIntervalFingerprint:
          datasetMeta.intervalUsageFingerprintIdentity ?? datasetMeta.intervalDataFingerprint ?? null,
        usageSourceMetadata: {
          actualSource: datasetMeta.actualSource ?? datasetSummary.source ?? null,
          weatherDatasetIdentity: datasetMeta.weatherDatasetIdentity ?? null,
          usageShapeProfileIdentity: datasetMeta.usageShapeProfileIdentity ?? null,
        },
      },
      coverageAndWindow: {
        usageCoverageWindowStart:
          datasetMeta.coverageStart ?? datasetMeta.coverageWindowStart ?? datasetSummary.start ?? null,
        usageCoverageWindowEnd:
          datasetMeta.coverageEnd ?? datasetMeta.coverageWindowEnd ?? datasetSummary.end ?? null,
        usageCanonicalMonths: asStringArray(datasetMeta.canonicalMonths),
        usageDatasetSummaryStart: datasetSummary.start ?? null,
        usageDatasetSummaryEnd: datasetSummary.end ?? null,
        usageReportedWindowStart: usageReportedWindow.startDate ?? null,
        usageReportedWindowEnd: usageReportedWindow.endDate ?? null,
      },
      orchestrationTrace: {
        lookedForExistingUsageTruth: status.lookedForExistingUsageTruth,
        existingUsageTruthFound: status.existingUsageTruthFound,
        refreshRequested: status.refreshRequested,
        refreshOwner: "lib/usage/ensureSmtCoverage.ts -> ensureSmtCoverageForHouse",
        refreshCompleted: status.refreshCompleted,
        refreshFailureReason: status.refreshFailureReason,
      },
    },
    sharedOwners: [
      {
        label: "Upstream truth resolver",
        owner: "modules/usageSimulator/upstreamUsageTruth.ts",
        whyItMatters: "Defines the live shared owner that reads persisted usage truth first and optionally seeds it through the existing shared refresh path.",
      },
      {
        label: "Shared usage layer",
        owner: "lib/usage/resolveIntervalsLayer.ts :: ACTUAL_USAGE_INTERVALS",
        whyItMatters: "Keeps usage truth ownership on the same shared actual-usage layer used by the existing usage page.",
      },
      {
        label: "Shared refresh owner",
        owner: "lib/usage/userUsageRefresh.ts",
        whyItMatters: "When usage truth is missing, seeding requests the existing shared usage refresh/orchestration path instead of inventing a new raw-usage path.",
      },
      {
        label: "Existing usage route owner",
        owner: "app/api/user/usage/refresh/route.ts",
        whyItMatters: "The user-facing usage refresh route remains the existing orchestration entrypoint for the live shared owner.",
      },
    ],
  };
}

async function readPersistedUsageTruth(args: {
  userId: string;
  houseId: string;
  esiid: string | null;
}) {
  return (
    (await resolveIntervalsLayer({
      userId: args.userId,
      houseId: args.houseId,
      layerKind: IntervalSeriesKind.ACTUAL_USAGE_INTERVALS,
      scenarioId: null,
      esiid: args.esiid,
      lightweightActualUsage: true,
    }).catch(() => null)) ?? { dataset: null, alternatives: { smt: null, greenButton: null } }
  );
}

export async function resolveUpstreamUsageTruthForSimulation(args: {
  userId: string;
  houseId: string;
  actualContextHouseId?: string | null;
  smtSourceEsiid?: string | null;
  seedIfMissing: boolean;
  runId?: string | null;
}): Promise<UpstreamUsageTruthResult> {
  const selectedHouse = await resolveSimulationHouseForUser({
    userId: args.userId,
    houseId: args.houseId,
  });
  const actualContextResolved = await resolveActualContextHouseForSimulation({
    userId: args.userId,
    selectedHouseId: selectedHouse.id,
    actualContextHouseId: String(args.actualContextHouseId ?? args.houseId),
  });
  const actualContextHouse = actualContextResolved.house;
  const actualContextOwnerUserId = actualContextResolved.ownerUserId;
  const effectiveSmtEsiid =
    actualContextHouse.esiid ??
    (typeof args.smtSourceEsiid === "string" && args.smtSourceEsiid.trim() ? args.smtSourceEsiid.trim() : null);
  const selectedHouseWithEffectiveEsiid = {
    ...selectedHouse,
    esiid: selectedHouse.esiid ?? effectiveSmtEsiid,
  };
  const actualContextHouseWithEffectiveEsiid = {
    ...actualContextHouse,
    esiid: effectiveSmtEsiid,
  };

  let resolved = await readPersistedUsageTruth({
    userId: actualContextOwnerUserId,
    houseId: actualContextHouse.id,
    esiid: actualContextHouseWithEffectiveEsiid.esiid,
  });
  if (resolved?.dataset) {
    return {
      selectedHouse: selectedHouseWithEffectiveEsiid,
      actualContextHouse: actualContextHouseWithEffectiveEsiid,
      dataset: resolved.dataset,
      alternatives: resolved.alternatives ?? { smt: null, greenButton: null },
      usageTruthSource: "persisted_usage_output",
      seedResult: null,
      summary: buildUpstreamUsageTruthSummary({
        selectedHouseId: selectedHouse.id,
        actualContextHouseId: actualContextHouse.id,
        dataset: resolved.dataset,
        usageTruthSource: "persisted_usage_output",
        seedResult: null,
      }),
    };
  }

  if (!args.seedIfMissing) {
    return {
      selectedHouse: selectedHouseWithEffectiveEsiid,
      actualContextHouse: actualContextHouseWithEffectiveEsiid,
      dataset: null,
      alternatives: resolved?.alternatives ?? { smt: null, greenButton: null },
      usageTruthSource: "missing_usage_truth",
      seedResult: null,
      summary: buildUpstreamUsageTruthSummary({
        selectedHouseId: selectedHouse.id,
        actualContextHouseId: actualContextHouse.id,
        dataset: null,
        usageTruthSource: "missing_usage_truth",
        seedResult: null,
      }),
    };
  }

  const runSessionKey = `sim:${String(args.runId ?? actualContextHouse.id).trim()}`;
  const ensure = await ensureSmtCoverageForHouse({
    userId: actualContextOwnerUserId,
    houseId: actualContextHouse.id,
    profile: "sim_run",
    sessionKey: runSessionKey,
  });

  const seedResult: UpstreamUsageTruthSeedResult =
    ensure.refreshResult?.ok !== false
      ? {
          ok: true,
          homeId: actualContextHouse.id,
          message: "existing usage orchestration requested",
        }
      : {
          ok: false,
          homeId: actualContextHouse.id,
          message:
            (ensure.refreshResult && "message" in ensure.refreshResult
              ? ensure.refreshResult.message
              : null) ??
            (ensure.refreshResult && "error" in ensure.refreshResult
              ? String(ensure.refreshResult.error)
              : "usage_ensure_failed"),
        };

  resolved = await readPersistedUsageTruth({
    userId: actualContextOwnerUserId,
    houseId: actualContextHouse.id,
    esiid: actualContextHouseWithEffectiveEsiid.esiid,
  });

  return {
    selectedHouse: selectedHouseWithEffectiveEsiid,
    actualContextHouse: actualContextHouseWithEffectiveEsiid,
    dataset: resolved?.dataset ?? null,
    alternatives: resolved?.alternatives ?? { smt: null, greenButton: null },
    usageTruthSource: resolved?.dataset ? "seeded_via_existing_usage_orchestration" : "missing_usage_truth",
    seedResult,
    summary: buildUpstreamUsageTruthSummary({
      selectedHouseId: selectedHouse.id,
      actualContextHouseId: actualContextHouse.id,
      dataset: resolved?.dataset ?? null,
      usageTruthSource: resolved?.dataset ? "seeded_via_existing_usage_orchestration" : "missing_usage_truth",
      seedResult,
    }),
  };
}
