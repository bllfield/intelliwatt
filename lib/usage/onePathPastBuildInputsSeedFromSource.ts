import "server-only";

import { prisma } from "@/lib/db";
import { getApplianceProfileSimulatedByUserHouse } from "@/modules/applianceProfile/repo";
import { getHomeProfileSimulatedByUserHouse } from "@/modules/homeProfile/repo";
import { normalizeStoredApplianceProfile } from "@/modules/applianceProfile/validation";
import { hasActualIntervals, resolveActualUsageSourceAnchor } from "@/modules/realUsageAdapter/actual";
import {
  buildSimulatorInputs,
  type BaseKind,
  type BuildMode,
} from "@/modules/onePathSim/usageSimulator/build";
import { monthsEndingAt } from "@/modules/onePathSim/manualAnchor";
import { canonicalWindow12Months } from "@/modules/onePathSim/usageSimulator/canonicalWindow";
import { computeBuildInputsHash } from "@/modules/onePathSim/usageSimulator/hash";
import { computeRequirements, type SimulatorMode } from "@/modules/onePathSim/usageSimulator/requirements";
import { INTRADAY_TEMPLATE_VERSION } from "@/modules/onePathSim/simulatedUsage/intradayTemplates";
import { SMT_SHAPE_DERIVATION_VERSION } from "@/modules/realUsageAdapter/smt";
import { computeMonthlyOverlay } from "@/modules/usageScenario/overlay";
import { normalizeMonthlyTotals, WEATHER_NORMALIZER_VERSION, type WeatherPreference } from "@/modules/weatherNormalization/normalizer";
import { resolveCanonicalUsage365CoverageWindow } from "@/lib/usage/canonicalMetadataWindow";
import {
  normalizePastSimTravelRanges,
  resolvePastSimTravelRangesForRecalc,
  type PastSimTravelRange,
} from "@/lib/usage/pastSimTravelRanges";
import {
  isolateBuildInputsForUserSite,
  resolveOnePathPastPreferredActualSource,
  resolveUserSiteActualSourceForHouse,
} from "@/lib/usage/userSiteSimulationIsolation";
import {
  stableParityBuildInputsSnapshot,
  type OnePathUserSiteParityLock,
} from "@/lib/usage/onePathPastUserSiteParityLock";
import type { OnePathPastParitySyncResult } from "@/lib/usage/onePathPastUserSiteParityTypes";

const WORKSPACE_PAST_SCENARIO_NAME = "Past (Corrected)";

async function findPastScenarioId(args: { userId: string; houseId: string }): Promise<string | null> {
  const row = await (prisma as any).usageSimulatorScenario
    .findFirst({
      where: {
        userId: args.userId,
        houseId: args.houseId,
        name: WORKSPACE_PAST_SCENARIO_NAME,
        archivedAt: null,
      },
      select: { id: true },
      orderBy: { updatedAt: "desc" },
    })
    .catch(() => null);
  return row?.id ? String(row.id) : null;
}
import { getHouseAddressForUserHouse, upsertSimulatorBuild } from "@/modules/onePathSim/usageSimulator/repo";

function baseKindFromMode(mode: SimulatorMode): BaseKind {
  if (mode === "MANUAL_TOTALS") return "MANUAL";
  if (mode === "NEW_BUILD_ESTIMATE") return "ESTIMATED";
  return "SMT_ACTUAL_BASELINE";
}

function applyMonthlyOverlay(args: { base: number; mult?: unknown; add?: unknown }): number {
  const mult = typeof args.mult === "number" && Number.isFinite(args.mult) ? args.mult : 1;
  const add = typeof args.add === "number" && Number.isFinite(args.add) ? args.add : 0;
  return Math.max(0, args.base * mult + add);
}

function travelRangesFromScenarioEvents(
  events: ReadonlyArray<{ kind?: unknown; payloadJson?: unknown }>,
): PastSimTravelRange[] {
  return normalizePastSimTravelRanges(
    (events ?? [])
      .filter((event) => String(event?.kind ?? "") === "TRAVEL_RANGE")
      .map((event) => {
        const payload =
          event?.payloadJson && typeof event.payloadJson === "object" && !Array.isArray(event.payloadJson)
            ? (event.payloadJson as Record<string, unknown>)
            : {};
        return { startDate: payload.startDate, endDate: payload.endDate };
      }),
  );
}

function buildScenarioEventsHashRows(
  events: Array<{ id: string; effectiveMonth: string; kind: string; payloadJson: unknown }>,
) {
  return events.map((event) => ({
    id: String(event.id),
    effectiveMonth: String(event.effectiveMonth),
    kind: String(event.kind),
    payloadJson: event.payloadJson,
  }));
}

function scenarioTravelFromEvents(
  events: ReadonlyArray<{ kind?: unknown; payloadJson?: unknown }>,
): PastSimTravelRange[] {
  return travelRangesFromScenarioEvents(events);
}

async function upsertSeededPastBuildOnTestHome(args: {
  ownerUserId: string;
  testHomeHouseId: string;
  testScenarioId: string;
  mode: SimulatorMode;
  baseKind: BaseKind;
  canonicalEndMonth: string;
  canonicalMonths: string[];
  buildInputs: Record<string, unknown>;
  buildInputsHash: string;
  parity: OnePathUserSiteParityLock;
}): Promise<void> {
  const testHouse = await getHouseAddressForUserHouse({
    userId: args.ownerUserId,
    houseId: args.testHomeHouseId,
  });
  const preferredActualSource = await resolveUserSiteActualSourceForHouse({
    userId: args.ownerUserId,
    houseId: args.testHomeHouseId,
    esiid: testHouse?.esiid ?? null,
  });
  const mirrored = isolateBuildInputsForUserSite({
    buildInputs: JSON.parse(JSON.stringify(args.buildInputs)) as Record<string, unknown>,
    requestHouseId: args.testHomeHouseId,
    actualSource: preferredActualSource,
  }).buildInputs;
  mirrored.onePathUserSiteParity = args.parity;
  const versions = {
    estimatorVersion: "v1",
    reshapeCoeffVersion: "v1",
    intradayTemplateVersion: INTRADAY_TEMPLATE_VERSION,
    smtShapeDerivationVersion: SMT_SHAPE_DERIVATION_VERSION,
    weatherNormalizerVersion: WEATHER_NORMALIZER_VERSION,
  };
  await upsertSimulatorBuild({
    userId: args.ownerUserId,
    houseId: args.testHomeHouseId,
    scenarioKey: args.testScenarioId,
    mode: args.mode,
    baseKind: args.baseKind,
    canonicalEndMonth: args.canonicalEndMonth,
    canonicalMonths: args.canonicalMonths,
    buildInputs: mirrored,
    buildInputsHash: args.buildInputsHash,
    versions,
  });
}

/**
 * Build Past simulator inputs from the linked source house DB (profiles, scenario events, travel)
 * and persist them on the One Path test home only. No user-portal recalc required.
 */
export async function seedOnePathPastBuildInputsFromSourceDb(args: {
  ownerUserId: string;
  sourceUserId: string;
  sourceHouseId: string;
  testHomeHouseId: string;
  preferredActualSource?: "SMT" | "GREEN_BUTTON" | null;
  callerLabel?: string | null;
  weatherPreference?: WeatherPreference;
  now?: Date;
}): Promise<OnePathPastParitySyncResult> {
  const sourceScenarioId = await findPastScenarioId({
    userId: args.sourceUserId,
    houseId: args.sourceHouseId,
  });
  const testScenarioId = await findPastScenarioId({
    userId: args.ownerUserId,
    houseId: args.testHomeHouseId,
  });
  if (!sourceScenarioId) {
    return {
      ok: false,
      code: "SOURCE_PAST_SCENARIO_MISSING",
      message: "Source house has no Past (Corrected) scenario.",
    };
  }
  if (!testScenarioId) {
    return {
      ok: false,
      code: "TEST_PAST_SCENARIO_MISSING",
      message: "One Path test home has no Past (Corrected) scenario after link.",
    };
  }

  const sourceHouse = await getHouseAddressForUserHouse({
    userId: args.sourceUserId,
    houseId: args.sourceHouseId,
  });
  if (!sourceHouse) {
    return { ok: false, code: "SOURCE_HOUSE_NOT_FOUND", message: "Source house not found." };
  }

  const esiid = sourceHouse.esiid ?? null;
  const simMode: SimulatorMode = "SMT_BASELINE";
  const preferredActualSource =
    resolveOnePathPastPreferredActualSource({
      callerLabel: args.callerLabel,
      preferredActualSource: args.preferredActualSource,
      isCrossHouseAdminLab: args.sourceHouseId !== args.testHomeHouseId,
      mode: simMode,
      hasEsiid: Boolean(esiid),
    }) ??
    (await resolveUserSiteActualSourceForHouse({
      userId: args.sourceUserId,
      houseId: args.sourceHouseId,
      esiid,
    }));

  const [manualRec, homeRec, applianceRec, scenarioEvents] = await Promise.all([
    (prisma as any).manualUsageInput
      .findUnique({
        where: { userId_houseId: { userId: args.sourceUserId, houseId: args.sourceHouseId } },
        select: { payload: true },
      })
      .catch(() => null),
    getHomeProfileSimulatedByUserHouse({ userId: args.sourceUserId, houseId: args.sourceHouseId }),
    getApplianceProfileSimulatedByUserHouse({ userId: args.sourceUserId, houseId: args.sourceHouseId }),
    (prisma as any).usageSimulatorScenarioEvent
      .findMany({
        where: { scenarioId: sourceScenarioId },
        select: { id: true, effectiveMonth: true, kind: true, payloadJson: true },
        orderBy: [{ effectiveMonth: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      })
      .catch(() => []),
  ]);

  const manualUsagePayload = (manualRec?.payload as unknown) ?? null;
  const applianceProfile = normalizeStoredApplianceProfile((applianceRec?.appliancesJson as unknown) ?? null);
  const homeProfile = homeRec ? { ...homeRec } : null;

  const actualSourceAnchor = await resolveActualUsageSourceAnchor({
    houseId: args.sourceHouseId,
    esiid,
    timezone: "America/Chicago",
    preferredSource: preferredActualSource,
  });

  const canonical =
    preferredActualSource === "GREEN_BUTTON" &&
    typeof actualSourceAnchor.anchorEndDate === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(actualSourceAnchor.anchorEndDate)
      ? {
          endMonth: actualSourceAnchor.anchorEndDate.slice(0, 7),
          months: monthsEndingAt(actualSourceAnchor.anchorEndDate.slice(0, 7), 12),
        }
      : canonicalWindow12Months(args.now ?? new Date());

  const actualOk = await hasActualIntervals({
    houseId: args.sourceHouseId,
    esiid,
    canonicalMonths: canonical.months,
    preferredSource: preferredActualSource,
  });

  const req = computeRequirements(
    {
      manualUsagePayload: manualUsagePayload as any,
      homeProfile: homeProfile as any,
      applianceProfile: applianceProfile as any,
      hasActualIntervals: actualOk,
    },
    simMode,
  );
  if (!req.canRecalc) {
    return {
      ok: false,
      code: "SOURCE_REQUIREMENTS_UNMET",
      message: `Source house is not ready for Past build seeding: ${req.missingItems.join("; ")}`,
    };
  }
  if (!homeProfile) {
    return { ok: false, code: "SOURCE_HOME_PROFILE_MISSING", message: "Source house has no home profile." };
  }
  if (!applianceProfile?.fuelConfiguration) {
    return {
      ok: false,
      code: "SOURCE_APPLIANCE_PROFILE_MISSING",
      message: "Source house has no appliance profile.",
    };
  }

  const scenarioTravelRanges = scenarioTravelFromEvents(scenarioEvents);
  const travelRanges = await resolvePastSimTravelRangesForRecalc({
    prisma: prisma as any,
    userId: args.ownerUserId,
    houseId: args.testHomeHouseId,
    actualContextHouseId: args.sourceHouseId,
    pastScenarioName: WORKSPACE_PAST_SCENARIO_NAME,
    scenarioTravelRanges,
  });

  const built = await buildSimulatorInputs({
    mode: simMode as BuildMode,
    manualUsagePayload: manualUsagePayload as any,
    homeProfile: homeProfile as any,
    applianceProfile: applianceProfile as any,
    esiidForSmt: esiid,
    houseIdForActual: args.sourceHouseId,
    baselineHomeProfile: homeProfile as any,
    baselineApplianceProfile: applianceProfile as any,
    canonicalMonths: canonical.months,
    preferredActualSource,
    travelRanges,
    now: args.now,
  });

  const overlay = computeMonthlyOverlay({
    canonicalMonths: built.canonicalMonths,
    events: scenarioEvents as any,
  });

  let monthlyTotalsKwhByMonth: Record<string, number> = {};
  for (let i = 0; i < built.canonicalMonths.length; i += 1) {
    const ym = built.canonicalMonths[i];
    const base = Number(built.monthlyTotalsKwhByMonth?.[ym] ?? 0) || 0;
    monthlyTotalsKwhByMonth[ym] = applyMonthlyOverlay({
      base,
      mult: overlay.monthlyMultipliersByMonth?.[ym],
      add: overlay.monthlyAddersKwhByMonth?.[ym],
    });
  }

  const weatherPreference: WeatherPreference = args.weatherPreference ?? "NONE";
  const weatherNorm = normalizeMonthlyTotals({
    canonicalMonths: built.canonicalMonths,
    monthlyTotalsKwhByMonth,
    preference: weatherPreference,
  });
  monthlyTotalsKwhByMonth = weatherNorm.monthlyTotalsKwhByMonth;

  const coverageWindow = resolveCanonicalUsage365CoverageWindow();
  const versions = {
    estimatorVersion: "v1",
    reshapeCoeffVersion: "v1",
    intradayTemplateVersion: INTRADAY_TEMPLATE_VERSION,
    smtShapeDerivationVersion: SMT_SHAPE_DERIVATION_VERSION,
    weatherNormalizerVersion: WEATHER_NORMALIZER_VERSION,
  };

  let buildInputs: Record<string, unknown> = {
    version: 1,
    mode: simMode,
    baseKind: baseKindFromMode(simMode),
    canonicalEndMonth: canonical.endMonth,
    canonicalMonths: built.canonicalMonths,
    canonicalPeriods: [
      {
        id: "canonical_usage_365_coverage",
        startDate: coverageWindow.startDate,
        endDate: coverageWindow.endDate,
      },
    ],
    weatherPreference,
    monthlyTotalsKwhByMonth,
    intradayShape96: built.intradayShape96,
    weekdayWeekendShape96: built.weekdayWeekendShape96,
    travelRanges,
    actualContextHouseId: args.sourceHouseId,
    validationOnlyDateKeysLocal: [],
    notes: [
      ...(built.notes ?? []),
      ...weatherNorm.notes,
      "One Path: Past build inputs seeded from source house DB (no user-portal recalc required).",
    ],
    filledMonths: built.filledMonths ?? [],
    sharedProducerPathUsed: false,
    snapshots: {
      manualUsagePayload,
      homeProfile,
      applianceProfile,
      baselineHomeProfile: homeProfile,
      baselineApplianceProfile: applianceProfile,
      actualSource: preferredActualSource ?? built.source?.actualSource ?? actualSourceAnchor.source,
      actualMonthlyAnchorsByMonth: built.source?.actualMonthlyAnchorsByMonth,
      actualIntradayShape96: built.source?.actualIntradayShape96,
      actualSourceAnchorEndDate: actualSourceAnchor.anchorEndDate ?? undefined,
      smtAnchorEndDate: actualSourceAnchor.smtAnchorEndDate ?? undefined,
      greenButtonAnchorEndDate: actualSourceAnchor.greenButtonAnchorEndDate ?? undefined,
    },
    scenarioKey: sourceScenarioId,
    scenarioId: sourceScenarioId,
    versions,
  };

  const sourceIsolated = isolateBuildInputsForUserSite({
    buildInputs,
    requestHouseId: args.sourceHouseId,
    actualSource: preferredActualSource,
  }).buildInputs;

  const { resolvePastArtifactIdentity } = await import("@/lib/usage/pastArtifactIdentity");
  const identity = await resolvePastArtifactIdentity({
    userId: args.sourceUserId,
    requestHouseId: args.sourceHouseId,
    requestHouseEsiid: esiid,
    buildInputs: sourceIsolated,
  });
  if (!identity) {
    return {
      ok: false,
      code: "PARITY_IDENTITY_FAILED",
      message: "Could not resolve Past artifact identity from source house DB state.",
    };
  }

  const snapshotHash = stableParityBuildInputsSnapshot(sourceIsolated);
  const parity: OnePathUserSiteParityLock = {
    sourceUserId: args.sourceUserId,
    sourceHouseId: args.sourceHouseId,
    sourceScenarioId,
    testScenarioId,
    parityInputHash: identity.inputHash,
    parityBuildInputsSnapshotHash: snapshotHash,
    syncedAt: new Date().toISOString(),
  };

  const buildInputsHash = computeBuildInputsHash({
    canonicalMonths: buildInputs.canonicalMonths,
    mode: buildInputs.mode,
    baseKind: buildInputs.baseKind,
    scenarioKey: sourceScenarioId,
    baseScenarioKey: overlay ? sourceScenarioId : null,
    scenarioEvents: buildScenarioEventsHashRows(scenarioEvents),
    weatherPreference,
    versions,
  });

  await upsertSeededPastBuildOnTestHome({
    ownerUserId: args.ownerUserId,
    testHomeHouseId: args.testHomeHouseId,
    testScenarioId,
    mode: simMode,
    baseKind: baseKindFromMode(simMode),
    canonicalEndMonth: canonical.endMonth,
    canonicalMonths: built.canonicalMonths,
    buildInputs,
    buildInputsHash,
    parity,
  });

  return {
    ok: true,
    parity,
    copiedFromSourceCache: false,
    sourceInputHash: identity.inputHash,
    syncKind: "seed",
  };
}
