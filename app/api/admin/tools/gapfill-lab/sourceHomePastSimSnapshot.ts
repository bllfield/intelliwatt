import { prisma } from "@/lib/db";
import { getActualUsageDatasetForHouse } from "@/lib/usage/actualDatasetForHouse";
import { buildValidationCompareProjectionSidecar } from "@/modules/usageSimulator/compareProjection";
import { loadDisplayProfilesForHouse } from "@/modules/usageSimulator/profileDisplay";
import {
  getSharedPastCoverageWindowForHouse,
  getSimulatedUsageForHouseScenario,
  getUserDefaultValidationSelectionMode,
} from "@/modules/usageSimulator/service";
import { resolveUserValidationPolicy } from "@/modules/usageSimulator/pastSimPolicy";
import { buildSharedPastSimDiagnostics } from "@/modules/usageSimulator/sharedDiagnostics";
import { boundDateKeysToCoverageWindow } from "@/modules/usageSimulator/metadataWindow";
import { travelRangesToExcludeDateKeys } from "@/modules/usageSimulator/build";
import { ensureUsageShapeProfileForUserHouse } from "@/modules/usageShapeProfile/autoBuild";
import { resolveSharedWeatherSensitivityEnvelope } from "@/modules/weatherSensitivity/shared";

type SourceHouseRef = {
  id: string;
  esiid?: string | null;
};

function withCanonicalExcludedOwnership(args: {
  dataset: any;
  boundedExcludedDateKeysCount: number;
  boundedExcludedDateKeysFingerprint: string;
}) {
  if (!args.dataset || typeof args.dataset !== "object") return null;
  const baseMeta =
    args.dataset.meta && typeof args.dataset.meta === "object"
      ? (args.dataset.meta as Record<string, unknown>)
      : {};
  return {
    ...args.dataset,
    meta: {
      ...baseMeta,
      excludedDateKeysCount: args.boundedExcludedDateKeysCount,
      excludedDateKeysFingerprint: args.boundedExcludedDateKeysFingerprint,
    },
  };
}

function attachWeatherSensitivityMeta(args: {
  dataset: any;
  score: any;
  derivedInput: any;
}) {
  if (!args.dataset || typeof args.dataset !== "object") return args.dataset;
  const baseMeta =
    args.dataset.meta && typeof args.dataset.meta === "object"
      ? (args.dataset.meta as Record<string, unknown>)
      : {};
  return {
    ...args.dataset,
    meta: {
      ...baseMeta,
      weatherSensitivityScore: args.score ?? (baseMeta.weatherSensitivityScore ?? null),
      weatherEfficiencyDerivedInput: args.derivedInput ?? (baseMeta.weatherEfficiencyDerivedInput ?? null),
    },
  };
}

async function readUserPastBaseline(args: {
  userId: string;
  houseId: string;
  scenarioId: string;
  correlationId: string;
}) {
  let out = await getSimulatedUsageForHouseScenario({
    userId: args.userId,
    houseId: args.houseId,
    scenarioId: args.scenarioId,
    correlationId: args.correlationId,
    readMode: "allow_rebuild",
    projectionMode: "baseline",
    readContext: {
      artifactReadMode: "allow_rebuild",
      projectionMode: "baseline",
      compareSidecarRequest: true,
    },
  });
  const message = String((out as any)?.message ?? "");
  const shouldAutoBuildProfile =
    !out.ok &&
    out.code === "INTERNAL_ERROR" &&
    /usage_shape_profile_required|usage-shape profile|fallback_month_avg/i.test(message);
  if (shouldAutoBuildProfile) {
    const rebuilt = await ensureUsageShapeProfileForUserHouse({
      userId: args.userId,
      houseId: args.houseId,
      timezone: "America/Chicago",
    });
    if (rebuilt.ok) {
      out = await getSimulatedUsageForHouseScenario({
        userId: args.userId,
        houseId: args.houseId,
        scenarioId: args.scenarioId,
        correlationId: args.correlationId,
        readMode: "allow_rebuild",
        projectionMode: "baseline",
        readContext: {
          artifactReadMode: "allow_rebuild",
          projectionMode: "baseline",
          compareSidecarRequest: true,
        },
      });
    }
  }
  return out;
}

export async function buildSourceHomePastSimSnapshot(args: {
  userId: string;
  sourceHouse: SourceHouseRef;
  correlationId: string;
  includeDiagnostics: boolean;
  getTravelRangesFromDb: (
    userId: string,
    houseId: string
  ) => Promise<Array<{ startDate: string; endDate: string }>>;
}) {
  const pastScenario = await (prisma as any).usageSimulatorScenario
    .findFirst({
      where: {
        userId: args.userId,
        houseId: args.sourceHouse.id,
        name: "Past (Corrected)",
        archivedAt: null,
      },
      select: { id: true },
    })
    .catch(() => null);

  if (!pastScenario?.id) {
    return {
      ok: false as const,
      error: "no_past_scenario",
      message: "No Past (Corrected) scenario found for source house.",
    };
  }

  const [
    canonicalWindow,
    sourceTravelRangesFromDb,
    sourceBuildRow,
    sourceProfiles,
    defaultValidationSelectionMode,
    sourceActualUsageResult,
  ] =
    await Promise.all([
      getSharedPastCoverageWindowForHouse({
        userId: args.userId,
        houseId: args.sourceHouse.id,
      }),
      args.getTravelRangesFromDb(args.userId, args.sourceHouse.id),
      (prisma as any).usageSimulatorBuild
        .findUnique({
          where: {
            userId_houseId_scenarioKey: {
              userId: args.userId,
              houseId: args.sourceHouse.id,
              scenarioKey: String(pastScenario.id),
            },
          },
          select: { buildInputs: true, buildInputsHash: true, lastBuiltAt: true, mode: true, baseKind: true },
        })
        .catch(() => null),
      loadDisplayProfilesForHouse({
        userId: args.userId,
        houseId: args.sourceHouse.id,
      }).catch(() => ({ homeProfile: null, applianceProfile: null })),
      getUserDefaultValidationSelectionMode(),
      getActualUsageDatasetForHouse(args.sourceHouse.id, args.sourceHouse.esiid ? String(args.sourceHouse.esiid) : null, {
        skipFullYearIntervalFetch: true,
      }).catch(() => ({ dataset: null })),
    ]);

  const userValidationPolicy = resolveUserValidationPolicy({
    defaultSelectionMode: defaultValidationSelectionMode,
    validationDayCount: 21,
  });

  const baselineRead = await readUserPastBaseline({
    userId: args.userId,
    houseId: args.sourceHouse.id,
    scenarioId: String(pastScenario.id),
    correlationId: args.correlationId,
  });

  const boundedExcludedDateKeysSorted = Array.from(
    boundDateKeysToCoverageWindow(
      new Set<string>(travelRangesToExcludeDateKeys(sourceTravelRangesFromDb)),
      canonicalWindow
    )
  ).sort();
  const boundedExcludedDateKeysCount = boundedExcludedDateKeysSorted.length;
  const boundedExcludedDateKeysFingerprint = boundedExcludedDateKeysSorted.join(",");

  const baselineDataset = baselineRead.ok
    ? withCanonicalExcludedOwnership({
        dataset: (baselineRead as any).dataset,
        boundedExcludedDateKeysCount,
        boundedExcludedDateKeysFingerprint,
      })
    : null;
  const sourceWeatherSensitivity = await resolveSharedWeatherSensitivityEnvelope({
    actualDataset: sourceActualUsageResult?.dataset ?? null,
    homeProfile: sourceProfiles.homeProfile,
    applianceProfile: sourceProfiles.applianceProfile,
    weatherHouseId: args.sourceHouse.id,
  }).catch(() => ({ score: null, derivedInput: null }));
  const baselineDatasetWithWeather = baselineDataset
    ? attachWeatherSensitivityMeta({
        dataset: baselineDataset,
        score: sourceWeatherSensitivity.score,
        derivedInput: sourceWeatherSensitivity.derivedInput,
      })
    : null;
  const baselineCompareProjection = baselineRead.ok
    ? buildValidationCompareProjectionSidecar(baselineDatasetWithWeather)
    : null;

  const sourceBuildInputs = ((sourceBuildRow as any)?.buildInputs as Record<string, unknown> | null | undefined) ?? null;

  let sourceEngineContext: Record<string, unknown> | null = null;
  if (args.includeDiagnostics && sourceBuildInputs) {
    const { runSimulatorDiagnostic } = await import("@/lib/admin/simulatorDiagnostic");
    const diagnostic = await runSimulatorDiagnostic({
      userId: args.userId,
      houseId: args.sourceHouse.id,
      esiid: args.sourceHouse.esiid ? String(args.sourceHouse.esiid) : null,
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
        dataset: baselineDatasetWithWeather,
        scenarioId: String(pastScenario.id),
        correlationId: args.correlationId,
        compareProjection: baselineCompareProjection,
        readMode: "allow_rebuild",
        projectionMode: "baseline",
        simulatorDiagnostic: sourceEngineContext,
      })
    : null;

  return {
    ok: true as const,
    sourceHouseId: args.sourceHouse.id,
    scenarioId: String(pastScenario.id),
    validationPolicyOwner: userValidationPolicy.owner,
    pastSimSnapshot: {
      sourceHouseId: args.sourceHouse.id,
      scenarioId: String(pastScenario.id),
      weatherLogicMode:
        (actualSharedDiagnostics?.identityContext?.weatherLogicMode as string | null | undefined) ?? null,
      weatherLogicOwner: "userWeatherLogicSetting",
      recalc: {
        executionMode: "not_run",
        correlationId: args.correlationId,
      },
      canonicalWindow,
      travelRangesFromDb: sourceTravelRangesFromDb,
      reads: {
        baselineProjection: baselineRead.ok
          ? {
              ok: true,
              dataset: baselineDatasetWithWeather,
              compareProjection: baselineCompareProjection,
            }
          : { ok: false, code: baselineRead.code, message: baselineRead.message },
      },
      validationPolicyOwner: userValidationPolicy.owner,
      validationPolicyMode: userValidationPolicy.selectionMode,
      build: {
        mode: (sourceBuildRow as any)?.mode ?? null,
        baseKind: (sourceBuildRow as any)?.baseKind ?? null,
        buildInputsHash: (sourceBuildRow as any)?.buildInputsHash ?? null,
        lastBuiltAt:
          (sourceBuildRow as any)?.lastBuiltAt instanceof Date
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
    },
  };
}
