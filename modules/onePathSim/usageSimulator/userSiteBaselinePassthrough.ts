import { monthsEndingAt } from "@/modules/onePathSim/manualAnchor";
import { canonicalWindow12Months } from "@/modules/onePathSim/usageSimulator/canonicalWindow";
import { getApplianceProfileSimulatedByUserHouse } from "@/modules/applianceProfile/repo";
import { getHomeProfileSimulatedByUserHouse } from "@/modules/homeProfile/repo";
import { hasActualIntervals, resolveActualUsageSourceAnchor } from "@/modules/realUsageAdapter/actual";
import { getActualUsageDatasetForHouse } from "@/lib/usage/actualDatasetForHouse";
import { prisma } from "@/lib/db";
import { buildSimulatorInputs, type BaseKind } from "@/modules/onePathSim/usageSimulator/build";
import { computeBuildInputsHash } from "@/modules/onePathSim/usageSimulator/hash";
import { computeRequirements, type SimulatorMode } from "@/modules/onePathSim/usageSimulator/requirements";
import { upsertSimulatorBuild } from "@/modules/onePathSim/usageSimulator/repo";
import {
  isolateBuildInputsForUserSite,
  resolveUserSiteActualSourceForHouse,
} from "@/lib/usage/userSiteSimulationIsolation";
import { INTRADAY_TEMPLATE_VERSION } from "@/modules/onePathSim/simulatedUsage/intradayTemplates";
import { SMT_SHAPE_DERIVATION_VERSION } from "@/modules/realUsageAdapter/smt";
import { normalizeStoredApplianceProfile } from "@/modules/applianceProfile/validation";
import { normalizeMonthlyTotals, WEATHER_NORMALIZER_VERSION, type WeatherPreference } from "@/modules/weatherNormalization/normalizer";
import { logSimPipelineEvent } from "@/modules/onePathSim/usageSimulator/simObservability";

type UserSiteBaselinePassthroughOk = {
  ok: true;
  houseId: string;
  buildInputsHash: string;
  dataset: unknown;
  effectiveSimulatorMode?: SimulatorMode;
};

type UserSiteBaselinePassthroughErr = {
  ok: false;
  error: string;
  missingItems?: string[];
};

function canonicalMonthsForUserSiteBaseline(args: {
  mode: SimulatorMode;
  manualUsagePayload: unknown | null;
  intervalAnchorEndDate?: string | null;
  intervalActualSource?: "SMT" | "GREEN_BUTTON" | null;
  now?: Date;
}) {
  const now = args.now ?? new Date();

  if (args.mode === "MANUAL_TOTALS" && args.manualUsagePayload) {
    const p = args.manualUsagePayload as {
      mode?: string;
      anchorEndDate?: string;
      anchorEndMonth?: string;
      endDate?: string;
    };
    if (p?.mode === "MONTHLY") {
      const anchorEndDateKey =
        typeof p.anchorEndDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.anchorEndDate) ? String(p.anchorEndDate) : null;
      const legacyEndMonth =
        typeof p.anchorEndMonth === "string" && /^\d{4}-\d{2}$/.test(p.anchorEndMonth) ? String(p.anchorEndMonth) : null;
      const endMonth = anchorEndDateKey ? anchorEndDateKey.slice(0, 7) : legacyEndMonth;
      if (endMonth) {
        const { monthsEndingAt } = require("@/modules/onePathSim/manualAnchor") as typeof import("@/modules/onePathSim/manualAnchor");
        return { endMonth, months: monthsEndingAt(endMonth, 12) };
      }
    }
    if (p?.mode === "ANNUAL") {
      const endKey =
        typeof p.anchorEndDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.anchorEndDate)
          ? String(p.anchorEndDate)
          : typeof p.endDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.endDate)
            ? String(p.endDate)
            : null;
      if (endKey) {
        const endMonth = endKey.slice(0, 7);
        return { endMonth, months: monthsEndingAt(endMonth, 12) };
      }
    }
  }

  if (
    args.mode === "SMT_BASELINE" &&
    args.intervalActualSource === "GREEN_BUTTON" &&
    typeof args.intervalAnchorEndDate === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(args.intervalAnchorEndDate)
  ) {
    const endMonth = args.intervalAnchorEndDate.slice(0, 7);
    return { endMonth, months: monthsEndingAt(endMonth, 12) };
  }

  return canonicalWindow12Months(now);
}

function baseKindFromMode(mode: SimulatorMode): BaseKind {
  if (mode === "MANUAL_TOTALS") return "MANUAL";
  if (mode === "NEW_BUILD_ESTIMATE") return "ESTIMATED";
  return "SMT_ACTUAL_BASELINE";
}

/**
 * User-site baseline recalc: persist a build marker and return upstream actual usage.
 * Does not run Past Sim or synthetic interval packaging (admin-only full recalc path).
 */
export async function recalcUserSiteBaselinePassthrough(args: {
  userId: string;
  houseId: string;
  esiid: string | null;
  mode: SimulatorMode;
  weatherPreference?: WeatherPreference;
  correlationId?: string;
  now?: Date;
}): Promise<UserSiteBaselinePassthroughOk | UserSiteBaselinePassthroughErr> {
  const { userId, houseId, esiid, mode } = args;
  const actualContextHouseId = houseId;

  const manualRec: { payload?: unknown } | null = await (prisma as any).manualUsageInput
    .findUnique({ where: { userId_houseId: { userId, houseId } }, select: { payload: true } })
    .catch(() => null);
  const homeRec = await getHomeProfileSimulatedByUserHouse({ userId, houseId });
  const applianceRec = await getApplianceProfileSimulatedByUserHouse({ userId, houseId });
  const manualUsagePayload = (manualRec?.payload as unknown) ?? null;
  const applianceProfile = normalizeStoredApplianceProfile((applianceRec?.appliancesJson as unknown) ?? null);
  const homeProfile = homeRec ? { ...homeRec } : null;

  const preferredActualSource = await resolveUserSiteActualSourceForHouse({ userId, houseId, esiid });
  const actualSourceAnchor = await resolveActualUsageSourceAnchor({
    houseId: actualContextHouseId,
    esiid,
    timezone: "America/Chicago",
    preferredSource: preferredActualSource,
  });
  const canonical = canonicalMonthsForUserSiteBaseline({
    mode,
    manualUsagePayload,
    intervalAnchorEndDate: actualSourceAnchor.anchorEndDate,
    intervalActualSource: actualSourceAnchor.source,
    now: args.now,
  });

  const actualOk =
    mode === "SMT_BASELINE"
      ? await hasActualIntervals({
          houseId: actualContextHouseId,
          esiid,
          canonicalMonths: canonical.months,
          preferredSource: preferredActualSource,
        })
      : false;

  const req = computeRequirements(
    {
      manualUsagePayload: manualUsagePayload as any,
      homeProfile: homeProfile as any,
      applianceProfile: applianceProfile as any,
      hasActualIntervals: actualOk,
    },
    mode,
  );
  if (!req.canRecalc) {
    return { ok: false, error: "requirements_unmet", missingItems: req.missingItems };
  }
  if (!homeProfile) return { ok: false, error: "homeProfile_required" };
  if (!applianceProfile?.fuelConfiguration) return { ok: false, error: "applianceProfile_required" };

  logSimPipelineEvent("user_site_baseline_passthrough_start", {
    correlationId: args.correlationId,
    userId,
    houseId,
    mode,
    preferredActualSource,
    source: "recalcUserSiteBaselinePassthrough",
  });

  const built = await buildSimulatorInputs({
    mode,
    manualUsagePayload: manualUsagePayload as any,
    homeProfile: homeProfile as any,
    applianceProfile: applianceProfile as any,
    houseIdForActual: actualContextHouseId,
    esiidForSmt: esiid,
    preferredActualSource,
    baselineHomeProfile: homeProfile as any,
    baselineApplianceProfile: applianceProfile as any,
    travelRanges: [],
  });

  const weatherPreference: WeatherPreference = args.weatherPreference ?? "LAST_YEAR_WEATHER";
  const weatherNorm = normalizeMonthlyTotals({
    canonicalMonths: built.canonicalMonths,
    monthlyTotalsKwhByMonth: built.monthlyTotalsKwhByMonth,
    preference: weatherPreference,
  });

  const versions = {
    estimatorVersion: "v1",
    reshapeCoeffVersion: "v1",
    intradayTemplateVersion: INTRADAY_TEMPLATE_VERSION,
    smtShapeDerivationVersion: SMT_SHAPE_DERIVATION_VERSION,
    weatherNormalizerVersion: WEATHER_NORMALIZER_VERSION,
  };

  let buildInputs: Record<string, unknown> = {
    version: 1,
    mode,
    baseKind: baseKindFromMode(mode),
    canonicalEndMonth: canonical.endMonth,
    canonicalMonths: built.canonicalMonths,
    weatherPreference,
    monthlyTotalsKwhByMonth: weatherNorm.monthlyTotalsKwhByMonth,
    intradayShape96: built.intradayShape96,
    weekdayWeekendShape96: built.weekdayWeekendShape96,
    travelRanges: [],
    actualContextHouseId,
    validationOnlyDateKeysLocal: [],
    notes: [...built.notes, ...weatherNorm.notes, "User-site baseline passthrough (upstream actual usage)."],
    filledMonths: built.filledMonths,
    sharedProducerPathUsed: false,
    baselinePassthrough: true,
    snapshots: {
      manualUsagePayload,
      homeProfile,
      applianceProfile,
      baselineHomeProfile: homeProfile,
      baselineApplianceProfile: applianceProfile,
      actualSource: built.source?.actualSource ?? actualSourceAnchor.source ?? preferredActualSource,
      actualSourceAnchorEndDate: actualSourceAnchor.anchorEndDate ?? undefined,
      smtAnchorEndDate: actualSourceAnchor.smtAnchorEndDate ?? undefined,
      greenButtonAnchorEndDate: actualSourceAnchor.greenButtonAnchorEndDate ?? undefined,
      actualMonthlyAnchorsByMonth: built.source?.actualMonthlyAnchorsByMonth,
      actualIntradayShape96: built.source?.actualIntradayShape96,
    },
    scenarioKey: "BASELINE",
    scenarioId: null,
    versions,
  };

  const isolated = isolateBuildInputsForUserSite({
    buildInputs,
    requestHouseId: houseId,
    actualSource: preferredActualSource,
  });
  buildInputs = isolated.buildInputs;

  const buildInputsHash = computeBuildInputsHash({
    canonicalMonths: buildInputs.canonicalMonths,
    mode: buildInputs.mode,
    baseKind: buildInputs.baseKind,
    scenarioKey: "BASELINE",
    baseScenarioKey: null,
    scenarioEvents: [],
    weatherPreference,
    versions,
  });

  await upsertSimulatorBuild({
    userId,
    houseId,
    scenarioKey: "BASELINE",
    mode,
    baseKind: baseKindFromMode(mode),
    canonicalEndMonth: canonical.endMonth,
    canonicalMonths: built.canonicalMonths,
    buildInputs,
    buildInputsHash,
    versions,
  });

  const actualLayer = await getActualUsageDatasetForHouse(actualContextHouseId, esiid, {
    skipFullYearIntervalFetch: true,
    preferredSource: preferredActualSource,
    userUsageDashboardLoad: true,
    skipLightweightInsightRecompute: false,
  });

  logSimPipelineEvent("user_site_baseline_passthrough_success", {
    correlationId: args.correlationId,
    userId,
    houseId,
    mode,
    buildInputsHash,
    source: "recalcUserSiteBaselinePassthrough",
  });

  return {
    ok: true,
    houseId,
    buildInputsHash,
    dataset: actualLayer?.dataset ?? null,
    effectiveSimulatorMode: mode,
  };
}
