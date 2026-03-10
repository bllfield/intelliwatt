/**
 * Admin diagnostic for production simulator/weather pipeline.
 * Runs cold build, stub audit, production path, optional recalc+parity; returns structured payload.
 */

import { enumerateDayStartsMsForWindow, dateKeyFromTimestamp, getDayGridTimestamps } from "@/modules/usageSimulator/pastStitchedCurve";
import { getPastSimulatedDatasetForHouse, getSimulatedUsageForHouseScenario, recalcSimulatorBuild } from "@/modules/usageSimulator/service";
import { getHouseWeatherDays } from "@/modules/weather/repo";
import { WEATHER_STUB_SOURCE } from "@/modules/weather/types";

const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;
const BOUNDARY_STUB_SAMPLE = 5;

function getWindowFromBuildInputs(buildInputs: any): { startDate: string; endDate: string } | null {
  const periods = Array.isArray(buildInputs?.canonicalPeriods) ? buildInputs.canonicalPeriods : [];
  const first = periods.length > 0 ? String(periods[0]?.startDate ?? "").slice(0, 10) : "";
  const last = periods.length > 0 ? String(periods[periods.length - 1]?.endDate ?? "").slice(0, 10) : "";
  if (YYYY_MM_DD.test(first) && YYYY_MM_DD.test(last)) return { startDate: first, endDate: last };

  const months = Array.isArray(buildInputs?.canonicalMonths) ? buildInputs.canonicalMonths : [];
  const firstMonth = String(months[0] ?? "");
  const lastMonth = String(months[months.length - 1] ?? "");
  if (!/^\d{4}-\d{2}$/.test(firstMonth) || !/^\d{4}-\d{2}$/.test(lastMonth)) return null;
  const [y, m] = lastMonth.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { startDate: `${firstMonth}-01`, endDate: `${lastMonth}-${String(lastDay).padStart(2, "0")}` };
}

function canonicalDateKeysFromWindow(startDate: string, endDate: string): string[] {
  const dayStarts = enumerateDayStartsMsForWindow(startDate, endDate);
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const ms of dayStarts) {
    const grid = getDayGridTimestamps(ms);
    if (grid.length === 0) continue;
    const dk = dateKeyFromTimestamp(grid[0]!);
    if (!YYYY_MM_DD.test(dk) || seen.has(dk)) continue;
    seen.add(dk);
    keys.push(dk);
  }
  return keys;
}

function extractMeta(dataset: any): Record<string, unknown> {
  const meta = dataset?.meta;
  if (!meta || typeof meta !== "object") return {};
  return {
    buildPathKind: meta.buildPathKind,
    sourceOfDaySimulationCore: meta.sourceOfDaySimulationCore,
    simVersion: meta.simVersion,
    derivationVersion: meta.derivationVersion,
    intervalCount: meta.intervalCount,
    dailyRowCount: meta.dailyRowCount,
    actualIntervalsCount: meta.actualIntervalsCount,
    referenceDaysCount: meta.referenceDaysCount,
    shapeMonthsPresent: meta.shapeMonthsPresent,
    excludedDateKeysCount: meta.excludedDateKeysCount,
    leadingMissingDaysCount: meta.leadingMissingDaysCount,
    weatherKindUsed: meta.weatherKindUsed,
    weatherSourceSummary: meta.weatherSourceSummary,
    weatherFallbackReason: meta.weatherFallbackReason,
    weatherProviderName: meta.weatherProviderName,
    weatherCoverageStart: meta.weatherCoverageStart,
    weatherCoverageEnd: meta.weatherCoverageEnd,
    weatherActualRowCount: meta.weatherActualRowCount,
    weatherStubRowCount: meta.weatherStubRowCount,
  };
}

function extractSummary(dataset: any): { totalKwh?: number; intervalsCount?: number } {
  const s = dataset?.summary;
  if (!s || typeof s !== "object") return {};
  return {
    totalKwh: typeof s.totalKwh === "number" ? s.totalKwh : undefined,
    intervalsCount: typeof s.intervalsCount === "number" ? s.intervalsCount : undefined,
  };
}

export type RunSimulatorDiagnosticArgs = {
  userId: string;
  houseId: string;
  esiid: string | null;
  buildInputs: any;
  scenarioId: string | null;
  scenarioKey: string;
  buildInputsHash: string | null;
  startDateOverride?: string;
  endDateOverride?: string;
  includeParity?: boolean;
  /** When provided, used instead of buildInputs.travelRanges for cold build (e.g. admin override from UI). */
  travelRangesOverride?: Array<{ startDate: string; endDate: string }>;
};

export type SimulatorDiagnosticResult = {
  ok: true;
  context: {
    houseId: string;
    scenarioId: string | null;
    scenarioKey: string;
    buildInputsHash: string | null;
    coverageStart: string;
    coverageEnd: string;
    userId: string;
    travelRangesUsed: Array<{ startDate: string; endDate: string }>;
  };
  pastPath: Record<string, unknown>;
  weatherProvenance: Record<string, unknown>;
  stubAudit: {
    totalActualRows: number;
    totalStubRows: number;
    stubDateKeys: string[];
    boundaryStubDateKeys: string[];
  };
  parity?: {
    coldVsProduction: { totalKwhMatch: boolean; intervalCountMatch: boolean; weatherSummaryMatch: boolean; weatherFallbackMatch: boolean; cold: any; production: any };
    coldVsRecalc: { totalKwhMatch: boolean; intervalCountMatch: boolean; weatherSummaryMatch: boolean; weatherFallbackMatch: boolean; cold: any; recalc: any };
  };
  gapfillLabNote: {
    enginePath: string;
    label: string;
    sameEngineAsPastProduction: false;
    note: string;
  };
};

export type SimulatorDiagnosticError = {
  ok: false;
  error: string;
};

export async function runSimulatorDiagnostic(
  args: RunSimulatorDiagnosticArgs
): Promise<SimulatorDiagnosticResult | SimulatorDiagnosticError> {
  const { userId, houseId, esiid, buildInputs, scenarioId, scenarioKey, buildInputsHash, includeParity } = args;

  const windowFromBuild = getWindowFromBuildInputs(buildInputs);
  const startDate = args.startDateOverride && YYYY_MM_DD.test(args.startDateOverride)
    ? args.startDateOverride
    : windowFromBuild?.startDate;
  const endDate = args.endDateOverride && YYYY_MM_DD.test(args.endDateOverride)
    ? args.endDateOverride
    : windowFromBuild?.endDate;

  if (!startDate || !endDate || endDate < startDate) {
    return { ok: false, error: "Could not resolve canonical window (missing or invalid buildInputs.canonicalMonths or override)." };
  }

  const travelRangesFromBuild = (Array.isArray((buildInputs as any)?.travelRanges) ? (buildInputs as any).travelRanges : []) as Array<{ startDate: string; endDate: string }>;
  // When parity is requested, cold must use the same inputs as production/recalc (stored build). Otherwise cold would use UI override and diverge.
  const travelRanges =
    includeParity
      ? travelRangesFromBuild
      : Array.isArray(args.travelRangesOverride) && args.travelRangesOverride.length > 0
        ? args.travelRangesOverride.filter((r) => YYYY_MM_DD.test(String(r?.startDate ?? "")) && YYYY_MM_DD.test(String(r?.endDate ?? "")))
        : travelRangesFromBuild;
  const timezone = (buildInputs as any)?.timezone ?? "America/Chicago";

  const canonicalDateKeys = canonicalDateKeysFromWindow(startDate, endDate);

  let coldMeta: Record<string, unknown> = {};
  let coldSummary: { totalKwh?: number; intervalsCount?: number } = {};
  const coldResult = await getPastSimulatedDatasetForHouse({
    userId,
    houseId,
    esiid,
    travelRanges,
    buildInputs,
    startDate,
    endDate,
    timezone,
    buildPathKind: "cold_build",
  });
  if (coldResult.dataset) {
    coldMeta = extractMeta(coldResult.dataset);
    coldSummary = extractSummary(coldResult.dataset);
  }

  const stubAudit = await runStubAudit(houseId, canonicalDateKeys);

  const productionResult = await getSimulatedUsageForHouseScenario({ userId, houseId, scenarioId });
  const productionMeta = productionResult.ok && productionResult.dataset ? extractMeta(productionResult.dataset) : {};
  const productionSummary = productionResult.ok && productionResult.dataset ? extractSummary(productionResult.dataset) : {};

  let parity: SimulatorDiagnosticResult["parity"] | undefined;
  if (includeParity) {
    const mode = (buildInputs as any)?.mode ?? "SMT_BASELINE";
    const recalcResult = await recalcSimulatorBuild({
      userId,
      houseId,
      esiid,
      mode: mode as "SMT_BASELINE" | "NEW_BUILD_ESTIMATE" | "MANUAL_TOTALS",
      scenarioId,
      persistPastSimBaseline: false,
    });
    let recalcMeta: Record<string, unknown> = {};
    let recalcSummary: { totalKwh?: number; intervalsCount?: number } = {};
    if (recalcResult.ok) {
      const afterRecalc = await getSimulatedUsageForHouseScenario({ userId, houseId, scenarioId });
      if (afterRecalc.ok && afterRecalc.dataset) {
        recalcMeta = extractMeta(afterRecalc.dataset);
        recalcSummary = extractSummary(afterRecalc.dataset);
      }
    }
    const coldVsProd = compareParity(coldSummary, coldMeta, productionSummary, productionMeta);
    const coldVsRec = compareParity(coldSummary, coldMeta, recalcSummary, recalcMeta);
    const coldSide = buildParitySide({
      summary: coldSummary,
      meta: coldMeta,
      scenarioId,
      scenarioKey,
      buildInputsHash,
      travelRangesUsed: travelRanges,
      coverageStart: startDate,
      coverageEnd: endDate,
      label: "cold",
    });
    const productionSide = buildParitySide({
      summary: productionSummary,
      meta: productionMeta,
      scenarioId,
      scenarioKey,
      buildInputsHash,
      travelRangesUsed: travelRanges,
      coverageStart: String(productionMeta.coverageStart ?? startDate),
      coverageEnd: String(productionMeta.coverageEnd ?? endDate),
      label: "production",
    });
    const recalcSide = buildParitySide({
      summary: recalcSummary,
      meta: recalcMeta,
      scenarioId,
      scenarioKey,
      buildInputsHash,
      travelRangesUsed: travelRanges,
      coverageStart: String(recalcMeta.coverageStart ?? startDate),
      coverageEnd: String(recalcMeta.coverageEnd ?? endDate),
      label: "recalc",
    });
    parity = {
      coldVsProduction: {
        totalKwhMatch: coldVsProd.totalKwhMatch,
        intervalCountMatch: coldVsProd.intervalCountMatch,
        weatherSummaryMatch: coldVsProd.weatherSummaryMatch,
        weatherFallbackMatch: coldVsProd.weatherFallbackMatch,
        cold: coldSide,
        production: productionSide,
      },
      coldVsRecalc: {
        totalKwhMatch: coldVsRec.totalKwhMatch,
        intervalCountMatch: coldVsRec.intervalCountMatch,
        weatherSummaryMatch: coldVsRec.weatherSummaryMatch,
        weatherFallbackMatch: coldVsRec.weatherFallbackMatch,
        cold: coldSide,
        recalc: recalcSide,
      },
    };
  }

  return {
    ok: true,
    context: {
      houseId,
      scenarioId,
      scenarioKey,
      buildInputsHash,
      coverageStart: startDate,
      coverageEnd: endDate,
      userId,
      travelRangesUsed: travelRanges,
      ...(includeParity && Array.isArray(args.travelRangesOverride) && args.travelRangesOverride.length > 0
        ? { parityNote: "Include parity was true; cold used stored build travelRanges (not UI override) so cold/production/recalc are comparable." }
        : {}),
    },
    pastPath: coldMeta,
    weatherProvenance: {
      weatherKindUsed: coldMeta.weatherKindUsed,
      weatherSourceSummary: coldMeta.weatherSourceSummary,
      weatherFallbackReason: coldMeta.weatherFallbackReason,
      weatherProviderName: coldMeta.weatherProviderName,
      weatherCoverageStart: coldMeta.weatherCoverageStart,
      weatherCoverageEnd: coldMeta.weatherCoverageEnd,
      weatherActualRowCount: coldMeta.weatherActualRowCount,
      weatherStubRowCount: coldMeta.weatherStubRowCount,
    },
    stubAudit,
    parity,
    gapfillLabNote: {
      enginePath: "gapfill_test_days_profile",
      label: "GapFill Lab validation (test-days profile)",
      sameEngineAsPastProduction: false,
      note: "GapFill Lab validation is a separate path from Past production. Past uses shared_past_day_simulator; Lab uses getActualIntervalsForRange(test window) -> simulateIntervalsForTestDaysFromUsageShapeProfile -> computeGapFillMetrics.",
    },
  };
}

async function runStubAudit(houseId: string, canonicalDateKeys: string[]): Promise<SimulatorDiagnosticResult["stubAudit"]> {
  if (canonicalDateKeys.length === 0) {
    return { totalActualRows: 0, totalStubRows: 0, stubDateKeys: [], boundaryStubDateKeys: [] };
  }
  const wx = await getHouseWeatherDays({
    houseId,
    dateKeys: canonicalDateKeys,
    kind: "ACTUAL_LAST_YEAR",
  });
  const stubDateKeys: string[] = [];
  let actualCount = 0;
  for (const [dk, row] of Array.from(wx.entries())) {
    if (String(row?.source ?? "").trim() === WEATHER_STUB_SOURCE) {
      stubDateKeys.push(dk);
    } else {
      actualCount++;
    }
  }
  const sortedStub = [...stubDateKeys].sort();
  const boundaryStubDateKeys = [
    ...sortedStub.slice(0, BOUNDARY_STUB_SAMPLE),
    ...(sortedStub.length > BOUNDARY_STUB_SAMPLE ? sortedStub.slice(-BOUNDARY_STUB_SAMPLE) : []),
  ];
  return {
    totalActualRows: actualCount,
    totalStubRows: stubDateKeys.length,
    stubDateKeys: sortedStub,
    boundaryStubDateKeys,
  };
}

function buildParitySide(args: {
  summary: { totalKwh?: number; intervalsCount?: number };
  meta: Record<string, unknown>;
  scenarioId: string | null;
  scenarioKey: string;
  buildInputsHash: string | null;
  travelRangesUsed: Array<{ startDate: string; endDate: string }>;
  coverageStart: string;
  coverageEnd: string;
  label: "cold" | "production" | "recalc";
}): Record<string, unknown> {
  const { summary, meta, scenarioId, scenarioKey, buildInputsHash, travelRangesUsed, coverageStart, coverageEnd, label } = args;
  const buildPathKind = meta.buildPathKind ?? (label === "cold" ? "cold_build" : label === "recalc" ? "recalc" : "production");
  const source =
    label === "cold"
      ? "cold_build"
      : String(meta.buildPathKind ?? "") === "cache_restore"
        ? "cache_restore"
        : label === "recalc"
          ? "recalc_then_getSimulatedUsage"
          : "getSimulatedUsageForHouseScenario";
  return {
    scenarioId,
    scenarioKey,
    buildInputsHash,
    travelRangesUsed,
    coverageStart,
    coverageEnd,
    buildPathKind,
    totalKwh: summary.totalKwh,
    intervalsCount: summary.intervalsCount,
    weatherSourceSummary: meta.weatherSourceSummary,
    weatherFallbackReason: meta.weatherFallbackReason,
    lastBuiltAt: meta.lastBuiltAt ?? undefined,
    source,
  };
}

function compareParity(
  aSummary: { totalKwh?: number; intervalsCount?: number },
  aMeta: Record<string, unknown>,
  bSummary: { totalKwh?: number; intervalsCount?: number },
  bMeta: Record<string, unknown>
): {
  totalKwhMatch: boolean;
  intervalCountMatch: boolean;
  weatherSummaryMatch: boolean;
  weatherFallbackMatch: boolean;
  cold: any;
  production: any;
} {
  const totalKwhA = aSummary.totalKwh;
  const totalKwhB = bSummary.totalKwh;
  const totalKwhMatch =
    typeof totalKwhA === "number" && typeof totalKwhB === "number"
      ? Math.abs(totalKwhA - totalKwhB) < 1e-6
      : totalKwhA === totalKwhB;

  const intervalCountA = aSummary.intervalsCount;
  const intervalCountB = bSummary.intervalsCount;
  const intervalCountMatch = intervalCountA === intervalCountB;

  const weatherSummaryMatch = String(aMeta.weatherSourceSummary ?? "") === String(bMeta.weatherSourceSummary ?? "");
  const weatherFallbackMatch = String(aMeta.weatherFallbackReason ?? "") === String(bMeta.weatherFallbackReason ?? "");

  return {
    totalKwhMatch,
    intervalCountMatch,
    weatherSummaryMatch,
    weatherFallbackMatch,
    cold: { totalKwh: totalKwhA, intervalsCount: intervalCountA, weatherSourceSummary: aMeta.weatherSourceSummary, weatherFallbackReason: aMeta.weatherFallbackReason },
    production: { totalKwh: totalKwhB, intervalsCount: intervalCountB, weatherSourceSummary: bMeta.weatherSourceSummary, weatherFallbackReason: bMeta.weatherFallbackReason },
  };
}
