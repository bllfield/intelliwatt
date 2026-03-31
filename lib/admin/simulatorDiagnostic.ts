/**
 * Admin diagnostic for production simulator/weather pipeline.
 * Runs cold build, stub audit, production path, optional recalc+parity; returns structured payload.
 */

import { createHash } from "crypto";
import { enumerateDayStartsMsForWindow, dateKeyFromTimestamp, getDayGridTimestamps } from "@/modules/usageSimulator/pastStitchedCurve";
import { getPastSimulatedDatasetForHouse, getSimulatedUsageForHouseScenario, recalcSimulatorBuild } from "@/modules/usageSimulator/service";
import { getActualIntervalsForRangeWithSource, getIntervalDataFingerprint } from "@/lib/usage/actualDatasetForHouse";
import { travelRangesToExcludeDateKeys } from "@/modules/usageSimulator/build";
import { recomputePastAggregatesFromIntervals } from "@/modules/usageSimulator/dataset";
import { classifyPastCacheIntegrity, type CacheIntegrityReason } from "@/modules/usageSimulator/parityIntegrity";
import { resolveWindowFromBuildInputsForPastIdentity } from "@/modules/usageSimulator/windowIdentity";
import { computePastInputHash, PAST_ENGINE_VERSION } from "@/modules/usageSimulator/pastCache";
import { resolveWeatherLogicModeFromBuildInputs } from "@/modules/usageSimulator/pastSimWeatherPolicy";
import { computePastWeatherIdentity } from "@/modules/weather/identity";
import { getUsageShapeProfileIdentityForPast } from "@/modules/simulatedUsage/simulatePastUsageDataset";
import { getHouseWeatherDays } from "@/modules/weather/repo";
import { WEATHER_STUB_SOURCE } from "@/modules/weather/types";
import { deriveCodecTotalDriftToleranceKwh } from "@/modules/usageSimulator/intervalCodec";
import { resolveReportedCoverageWindow } from "@/modules/usageSimulator/metadataWindow";

const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;
const BOUNDARY_STUB_SAMPLE = 5;
const DIAGNOSTIC_INTERVAL_LIMIT = 96;

/** Normalize weatherFallbackReason so match logic and display agree: null/undefined/empty/whitespace → null. */
function normalizeWeatherFallbackReason(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s === "" ? null : s;
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

function summarizeIntervalsSlice(
  intervals: Array<{ timestamp: string; kwh: number }>,
  limit: number
): {
  rows: Array<{ timestamp: string; kwh: number }>;
  meta: {
    coverageStart: string | null;
    coverageEnd: string | null;
    intervalCount: number;
    truncated: boolean;
    truncationLimit: number;
  };
} {
  const sorted = (intervals ?? [])
    .map((p) => ({
      timestamp: String(p?.timestamp ?? ""),
      kwh: Number(p?.kwh) || 0,
    }))
    .filter((p) => p.timestamp.length > 0)
    .sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));
  const rows = sorted.slice(0, Math.max(0, limit));
  return {
    rows,
    meta: {
      coverageStart: sorted[0]?.timestamp ?? null,
      coverageEnd: sorted[sorted.length - 1]?.timestamp ?? null,
      intervalCount: sorted.length,
      truncated: sorted.length > rows.length,
      truncationLimit: Math.max(0, limit),
    },
  };
}

function dayTotalFromIntervalsUtc(
  intervals: Array<{ timestamp: string; kwh: number }>,
  dateKey: string
): number {
  const sum = (intervals ?? []).reduce((acc, p) => {
    const ts = String(p?.timestamp ?? "");
    if (ts.slice(0, 10) !== dateKey) return acc;
    return acc + (Number(p?.kwh) || 0);
  }, 0);
  return Math.round(sum * 100) / 100;
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

/** Lightweight digest of intervals15 (timestamps + kwh) for parity comparison. */
function intervalDigest(intervals15: Array<{ timestamp?: string; kwh?: number }>): string | undefined {
  if (!Array.isArray(intervals15) || intervals15.length === 0) return undefined;
  const parts = intervals15
    .slice(0, 5000)
    .map((p) => `${String(p?.timestamp ?? "").slice(0, 19)}:${Number(p?.kwh) ?? 0}`)
    .sort();
  return createHash("sha256").update(parts.join("\n"), "utf8").digest("hex").slice(0, 16);
}

/** Parity diagnostics derived from a dataset (digest + shared aggregation recompute). */
function computeParityDiagnostics(dataset: any): {
  intervalDigest?: string;
  recomputedTotalFromIntervals?: number;
  recomputedDailyTotalFromIntervals?: number;
  recomputedMonthlyTotalFromIntervals?: number;
  datasetTotalKwh?: number;
  totalSource: string;
  sourceArtifact: string;
} {
  const buildPathKind = dataset?.meta?.buildPathKind;
  const sourceArtifact =
    buildPathKind === "cold_build"
      ? "fresh_in_memory"
      : buildPathKind === "cache_restore"
        ? "decoded_cached_intervals"
        : "saved_dataset_json";
  const intervals15 = Array.isArray(dataset?.series?.intervals15) ? dataset.series.intervals15 : [];
  const curveEndDate =
    String(dataset?.summary?.end ?? "").slice(0, 10) ||
    (intervals15.length > 0 ? String(intervals15[intervals15.length - 1]?.timestamp ?? "").slice(0, 10) : "");
  const simulatedDateKeys = new Set<string>(
    (Array.isArray(dataset?.daily) ? dataset.daily : [])
      .filter((d: any) => String(d?.source ?? "").toUpperCase() === "SIMULATED")
      .map((d: any) => String(d?.date ?? "").slice(0, 10))
      .filter((dk: string) => YYYY_MM_DD.test(dk))
  );
  const recomputed = recomputePastAggregatesFromIntervals({
    intervals: intervals15,
    curveEndDate,
    simulatedDateKeys,
  });
  return {
    intervalDigest: intervalDigest(intervals15),
    recomputedTotalFromIntervals: recomputed.intervalSumKwh,
    recomputedDailyTotalFromIntervals: recomputed.dailySumKwh,
    recomputedMonthlyTotalFromIntervals: recomputed.monthlySumKwh,
    datasetTotalKwh: typeof dataset?.summary?.totalKwh === "number" ? dataset.summary.totalKwh : undefined,
    totalSource: "dataset_summary",
    sourceArtifact,
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
  identity: {
    windowStartUtc: string;
    windowEndUtc: string;
    timezone: string;
    engineVersion: string;
    buildInputsHash: string | null;
    intervalDataFingerprint: string;
    weatherIdentity: string;
    usageShapeProfileIdentity: {
      usageShapeProfileId: string | null;
      usageShapeProfileVersion: string | null;
      usageShapeProfileDerivedAt: string | null;
      usageShapeProfileSimHash: string | null;
    };
    inputHash: string;
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
  /** Optional simulated-day parity sample for selected date. */
  dayLevelParity?: {
    selectedSimulatedDate: string;
    cold: {
      source: string;
      localDate: string;
      intervalSumKwh?: number;
      displayDayKwh?: number;
      rawDayKwh?: number;
      weatherAdjustedDayKwh?: number;
      finalDayKwh?: number;
      fallbackLevel?: string;
      clampApplied?: boolean;
      intervalDigest?: string;
    };
    production?: {
      source: string;
      localDate: string;
      intervalSumKwh?: number;
      displayDayKwh?: number;
      intervalDigest?: string;
    } | null;
    recalc?: {
      source: string;
      localDate: string;
      intervalSumKwh?: number;
      displayDayKwh?: number;
      intervalDigest?: string;
    } | null;
    note?: string;
  };
  /** Dataset integrity and cache consistency. Present when diagnostic ran. */
  integrity?: {
    intervalCountMatch: boolean;
    parityMatch: boolean;
    coldVsCacheMatch: boolean | null;
    cacheDigestMatch: boolean | null;
    cacheTotalDeltaKwh: number | null;
    cacheCodecDriftToleranceKwh: number;
    cacheCodecDriftLikely: boolean | null;
    cacheIntegrityPass: boolean | null;
    cacheIntegrityReason: CacheIntegrityReason;
    coldTotalKwh?: number;
    cacheTotalKwh?: number;
    recalcTotalKwh?: number;
    coldRecomputedFromIntervals?: number;
    cacheRecomputedFromIntervals?: number;
    recalcRecomputedFromIntervals?: number;
    coldRecomputedDailyFromIntervals?: number;
    cacheRecomputedDailyFromIntervals?: number;
    recalcRecomputedDailyFromIntervals?: number;
    coldRecomputedMonthlyFromIntervals?: number;
    cacheRecomputedMonthlyFromIntervals?: number;
    recalcRecomputedMonthlyFromIntervals?: number;
    firstDivergenceStage?: "none" | "interval_sum" | "daily_sum" | "monthly_sum" | "digest_only";
  };
  gapfillLabNote: {
    enginePath: string;
    label: string;
    sameEngineAsPastProduction: boolean;
    daySimulationCore?: string;
    note: string;
  };
  rawActualIntervalsMeta: {
    label: "Raw actual intervals";
    source: "SMT" | "GREEN_BUTTON" | "none";
    coverageStart: string | null;
    coverageEnd: string | null;
    intervalCount: number;
    truncated: boolean;
    truncationLimit: number;
  };
  rawActualIntervals: Array<{ timestamp: string; kwh: number }>;
  stitchedPastIntervalsMeta: {
    label: "Final stitched Past corrected-baseline intervals";
    source: "production_artifact" | "cold_build";
    coverageStart: string | null;
    coverageEnd: string | null;
    intervalCount: number;
    truncated: boolean;
    truncationLimit: number;
  };
  stitchedPastIntervals: Array<{ timestamp: string; kwh: number }>;
  firstActualOnlyDayComparison: {
    date: string | null;
    rawActualDayTotalKwh: number | null;
    stitchedPastDayTotalKwh: number | null;
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

  const windowFromBuild = resolveWindowFromBuildInputsForPastIdentity(
    (buildInputs ?? {}) as Record<string, unknown>
  );
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
  // When parity is requested, cold must use the same inputs as production/recalc (stored build). Otherwise use UI override if present and valid; if override has only invalid entries, fall back to stored ranges.
  const filteredOverride =
    Array.isArray(args.travelRangesOverride) && args.travelRangesOverride.length > 0
      ? args.travelRangesOverride.filter((r) => YYYY_MM_DD.test(String(r?.startDate ?? "")) && YYYY_MM_DD.test(String(r?.endDate ?? "")))
      : [];
  const travelRanges =
    includeParity
      ? travelRangesFromBuild
      : filteredOverride.length > 0
        ? filteredOverride
        : travelRangesFromBuild;
  const timezone = (buildInputs as any)?.timezone ?? "America/Chicago";
  const intervalDataFingerprint = await getIntervalDataFingerprint({
    houseId,
    esiid,
    startDate,
    endDate,
  });
  const usageShapeProfileIdentity = await getUsageShapeProfileIdentityForPast(houseId);
  const weatherIdentity = await computePastWeatherIdentity({
    houseId,
    startDate,
    endDate,
    weatherLogicMode: resolveWeatherLogicModeFromBuildInputs(
      (buildInputs ?? {}) as Record<string, unknown>
    ),
  });
  const inputHash = computePastInputHash({
    engineVersion: PAST_ENGINE_VERSION,
    windowStartUtc: startDate,
    windowEndUtc: endDate,
    timezone,
    travelRanges,
    buildInputs: (buildInputs ?? {}) as Record<string, unknown>,
    intervalDataFingerprint,
    usageShapeProfileId: usageShapeProfileIdentity.usageShapeProfileId,
    usageShapeProfileVersion: usageShapeProfileIdentity.usageShapeProfileVersion,
    usageShapeProfileDerivedAt: usageShapeProfileIdentity.usageShapeProfileDerivedAt,
    usageShapeProfileSimHash: usageShapeProfileIdentity.usageShapeProfileSimHash,
    weatherIdentity,
  });

  const canonicalDateKeys = canonicalDateKeysFromWindow(startDate, endDate);
  const excludedDateKeys = new Set(
    travelRangesToExcludeDateKeys(Array.isArray(travelRanges) ? travelRanges : [])
  );
  const firstActualOnlyDate = canonicalDateKeys.find((dk) => !excludedDateKeys.has(dk)) ?? null;

  const rawActualFetched = await getActualIntervalsForRangeWithSource({
    houseId,
    esiid,
    startDate,
    endDate,
  });
  const rawActualSource =
    rawActualFetched.source === "SMT" || rawActualFetched.source === "GREEN_BUTTON"
      ? rawActualFetched.source
      : "none";
  const rawActualIntervalsAll = rawActualFetched.intervals ?? [];
  const rawActualSection = summarizeIntervalsSlice(rawActualIntervalsAll, DIAGNOSTIC_INTERVAL_LIMIT);

  let coldMeta: Record<string, unknown> = {};
  let coldSummary: { totalKwh?: number; intervalsCount?: number } = {};
  let coldDatasetForIntervals: any | null = null;
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
    coldDatasetForIntervals = coldResult.dataset;
  }
  const coldSimulatedDayResults = Array.isArray((coldResult as { simulatedDayResults?: unknown }).simulatedDayResults)
    ? ((coldResult as { simulatedDayResults?: Array<Record<string, unknown>> }).simulatedDayResults ?? [])
    : [];

  const coldParityDiag = coldResult.dataset ? computeParityDiagnostics(coldResult.dataset) : undefined;
  // Drop heavy dataset so GC can reclaim before loading production (reduces OOM risk in serverless)
  (coldResult as { dataset?: unknown }).dataset = undefined;

  const stubAudit = await runStubAudit(houseId, canonicalDateKeys);

  const productionResult = await getSimulatedUsageForHouseScenario({ userId, houseId, scenarioId });
  let productionDatasetForDayParity: any | null = null;
  let productionDatasetForIntervals: any | null = null;
  const productionMeta = productionResult.ok && productionResult.dataset ? extractMeta(productionResult.dataset) : {};
  const productionSummary = productionResult.ok && productionResult.dataset ? extractSummary(productionResult.dataset) : {};
  const productionParityDiag = productionResult.ok && productionResult.dataset ? computeParityDiagnostics(productionResult.dataset) : undefined;
  if (productionResult.ok && productionResult.dataset) {
    productionDatasetForDayParity = productionResult.dataset;
    productionDatasetForIntervals = productionResult.dataset;
    (productionResult as { dataset?: unknown }).dataset = undefined;
  }

  let parity: SimulatorDiagnosticResult["parity"] | undefined;
  let dayLevelParity: SimulatorDiagnosticResult["dayLevelParity"] | undefined;
  let recalcDatasetForDayParity: any | null = null;
  if (includeParity) {
    try {
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
      let recalcParityDiag: ReturnType<typeof computeParityDiagnostics> | undefined;
      if (recalcResult.ok) {
        // Use the fresh recalc output directly so cold-vs-recalc parity is not
        // influenced by cache-restore reads from getSimulatedUsageForHouseScenario.
        recalcMeta = extractMeta(recalcResult.dataset);
        recalcSummary = extractSummary(recalcResult.dataset);
        recalcParityDiag = computeParityDiagnostics(recalcResult.dataset);
        recalcDatasetForDayParity = recalcResult.dataset;
      }
      const coldCoverage = resolveReportedCoverageWindow({
        dataset: coldDatasetForIntervals,
        fallbackStartDate: startDate,
        fallbackEndDate: endDate,
      });
      const productionCoverage = resolveReportedCoverageWindow({
        dataset: productionDatasetForIntervals,
        fallbackStartDate: startDate,
        fallbackEndDate: endDate,
      });
      const recalcCoverage = resolveReportedCoverageWindow({
        dataset: recalcDatasetForDayParity,
        fallbackStartDate: startDate,
        fallbackEndDate: endDate,
      });
      const coldVsProd = compareParity(coldSummary, coldMeta, productionSummary, productionMeta);
      const coldVsRec = compareParity(coldSummary, coldMeta, recalcSummary, recalcMeta);
      const coldSide = buildParitySide({
        summary: coldSummary,
        meta: coldMeta,
        scenarioId,
        scenarioKey,
        buildInputsHash,
        travelRangesUsed: travelRanges,
        coverageStart: coldCoverage.startDate,
        coverageEnd: coldCoverage.endDate,
        label: "cold",
        parityDiagnostics: coldParityDiag,
      });
      const productionSide = buildParitySide({
        summary: productionSummary,
        meta: productionMeta,
        scenarioId,
        scenarioKey,
        buildInputsHash,
        travelRangesUsed: travelRanges,
        coverageStart: productionCoverage.startDate,
        coverageEnd: productionCoverage.endDate,
        label: "production",
        parityDiagnostics: productionParityDiag,
      });
      const recalcSide = buildParitySide({
        summary: recalcSummary,
        meta: recalcMeta,
        scenarioId,
        scenarioKey,
        buildInputsHash,
        travelRangesUsed: travelRanges,
        coverageStart: recalcCoverage.startDate,
        coverageEnd: recalcCoverage.endDate,
        label: "recalc",
        parityDiagnostics: recalcParityDiag,
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
    } catch (parityErr) {
      const msg = parityErr instanceof Error ? parityErr.message : String(parityErr);
      return { ok: false, error: `Parity step failed: ${msg}` };
    }
  }

  const selectedColdDay = coldSimulatedDayResults.length > 0 ? (coldSimulatedDayResults[0] as any) : null;
  if (selectedColdDay && typeof selectedColdDay.localDate === "string") {
    const dateKey = String(selectedColdDay.localDate).slice(0, 10);
    const summarizeDayFromDataset = (dataset: any, source: string) => {
      const rows = Array.isArray(dataset?.series?.intervals15) ? dataset.series.intervals15 : [];
      const dayRows = rows.filter((r: any) => String(r?.timestamp ?? "").slice(0, 10) === dateKey);
      if (!dayRows.length) return null;
      const intervalSum = dayRows.reduce((s: number, r: any) => s + (Number(r?.kwh) || 0), 0);
      return {
        source,
        localDate: dateKey,
        intervalSumKwh: Math.round(intervalSum * 100) / 100,
        displayDayKwh: Math.round(intervalSum * 100) / 100,
        intervalDigest: intervalDigest(dayRows),
      };
    };
    dayLevelParity = {
      selectedSimulatedDate: dateKey,
      cold: {
        source: String(selectedColdDay.source ?? "simulated_vacant_day"),
        localDate: dateKey,
        intervalSumKwh:
          typeof selectedColdDay.intervalSumKwh === "number"
            ? selectedColdDay.intervalSumKwh
            : undefined,
        displayDayKwh:
          typeof selectedColdDay.displayDayKwh === "number"
            ? selectedColdDay.displayDayKwh
            : undefined,
        rawDayKwh:
          typeof selectedColdDay.rawDayKwh === "number" ? selectedColdDay.rawDayKwh : undefined,
        weatherAdjustedDayKwh:
          typeof selectedColdDay.weatherAdjustedDayKwh === "number"
            ? selectedColdDay.weatherAdjustedDayKwh
            : undefined,
        finalDayKwh:
          typeof selectedColdDay.finalDayKwh === "number" ? selectedColdDay.finalDayKwh : undefined,
        fallbackLevel:
          typeof selectedColdDay.fallbackLevel === "string"
            ? selectedColdDay.fallbackLevel
            : undefined,
        clampApplied:
          typeof selectedColdDay.clampApplied === "boolean"
            ? selectedColdDay.clampApplied
            : undefined,
        intervalDigest: intervalDigest(Array.isArray(selectedColdDay.intervals) ? selectedColdDay.intervals : []),
      },
      production:
        productionDatasetForDayParity
          ? summarizeDayFromDataset(productionDatasetForDayParity, "production_dataset_intervals")
          : null,
      recalc: recalcDatasetForDayParity
        ? summarizeDayFromDataset(recalcDatasetForDayParity, "recalc_dataset_intervals")
        : null,
      note:
        "Day-level diagnostics for actual dates may continue to come from existing actual-usage inspection paths; this refactor only requires SimulatedDayResult parity for simulated dates.",
    };
  }

  // Integrity and cache consistency (from cold + production; recalc when includeParity).
  const coldIntervalCount = typeof coldMeta.intervalCount === "number" ? coldMeta.intervalCount : Number(coldMeta.intervalCount);
  const coldDailyRowCount = typeof coldMeta.dailyRowCount === "number" ? coldMeta.dailyRowCount : Number(coldMeta.dailyRowCount);
  const intervalCountMatch = Number.isFinite(coldIntervalCount) && Number.isFinite(coldDailyRowCount) && coldIntervalCount === coldDailyRowCount * 96;
  const coldParityOk =
    coldParityDiag != null &&
    typeof coldParityDiag.datasetTotalKwh === "number" &&
    typeof coldParityDiag.recomputedTotalFromIntervals === "number" &&
    Math.abs(coldParityDiag.datasetTotalKwh - coldParityDiag.recomputedTotalFromIntervals) <= 0.01;
  const productionParityOk =
    productionParityDiag != null &&
    typeof productionParityDiag.datasetTotalKwh === "number" &&
    typeof productionParityDiag.recomputedTotalFromIntervals === "number" &&
    Math.abs(productionParityDiag.datasetTotalKwh - productionParityDiag.recomputedTotalFromIntervals) <= 0.01;
  const parityMatch = coldParityOk && (productionResult.ok ? productionParityOk : true);
  const isCacheRestore = String(productionMeta.buildPathKind ?? "") === "cache_restore";
  const coldVsCacheMatch: boolean | null =
    isCacheRestore && typeof coldSummary.totalKwh === "number" && typeof productionSummary.totalKwh === "number"
      ? Math.abs(coldSummary.totalKwh - productionSummary.totalKwh) <= 0.01
      : isCacheRestore
        ? false
        : null;
  const cacheDigestMatch: boolean | null =
    isCacheRestore && coldParityDiag?.intervalDigest != null && productionParityDiag?.intervalDigest != null
      ? coldParityDiag.intervalDigest === productionParityDiag.intervalDigest
      : null;
  const cacheTotalDeltaKwh: number | null =
    isCacheRestore &&
    typeof coldParityDiag?.recomputedTotalFromIntervals === "number" &&
    typeof productionParityDiag?.recomputedTotalFromIntervals === "number"
      ? Math.abs(coldParityDiag.recomputedTotalFromIntervals - productionParityDiag.recomputedTotalFromIntervals)
      : isCacheRestore && typeof coldSummary.totalKwh === "number" && typeof productionSummary.totalKwh === "number"
        ? Math.abs(coldSummary.totalKwh - productionSummary.totalKwh)
        : null;
  const cacheCodecDriftToleranceKwh =
    isCacheRestore && Number.isFinite(coldIntervalCount) && coldIntervalCount > 0
      ? deriveCodecTotalDriftToleranceKwh({ intervalCount: Number(coldIntervalCount), sigmaMultiplier: 4 })
      : 0.01;
  const coldVsRecalcMatch =
    parity?.coldVsRecalc != null
      ? parity.coldVsRecalc.totalKwhMatch && parity.coldVsRecalc.intervalCountMatch
      : null;
  const coldVsProductionIntervalCountMatch = parity?.coldVsProduction?.intervalCountMatch ?? null;
  const integrityClassification = classifyPastCacheIntegrity({
    isCacheRestore,
    cacheDigestMatch,
    cacheTotalDeltaKwh,
    cacheCodecDriftToleranceKwh,
    coldParityOk,
    productionParityOk,
    coldVsRecalcMatch,
    coldVsProductionIntervalCountMatch,
    coldRecomputedFromIntervals: coldParityDiag?.recomputedTotalFromIntervals,
    cacheRecomputedFromIntervals: productionParityDiag?.recomputedTotalFromIntervals,
    coldRecomputedDailyFromIntervals: coldParityDiag?.recomputedDailyTotalFromIntervals,
    cacheRecomputedDailyFromIntervals: productionParityDiag?.recomputedDailyTotalFromIntervals,
    coldRecomputedMonthlyFromIntervals: coldParityDiag?.recomputedMonthlyTotalFromIntervals,
    cacheRecomputedMonthlyFromIntervals: productionParityDiag?.recomputedMonthlyTotalFromIntervals,
  });

  const integrity: SimulatorDiagnosticResult["integrity"] = {
    intervalCountMatch,
    parityMatch,
    coldVsCacheMatch,
    cacheDigestMatch,
    cacheTotalDeltaKwh,
    cacheCodecDriftToleranceKwh,
    cacheCodecDriftLikely: integrityClassification.cacheCodecDriftLikely,
    cacheIntegrityPass: integrityClassification.cacheIntegrityPass,
    cacheIntegrityReason: integrityClassification.cacheIntegrityReason,
    coldTotalKwh: coldSummary.totalKwh,
    cacheTotalKwh: productionResult.ok ? productionSummary.totalKwh : undefined,
    recalcTotalKwh: undefined,
    coldRecomputedFromIntervals: coldParityDiag?.recomputedTotalFromIntervals,
    cacheRecomputedFromIntervals: productionParityDiag?.recomputedTotalFromIntervals,
    recalcRecomputedFromIntervals: undefined,
    coldRecomputedDailyFromIntervals: coldParityDiag?.recomputedDailyTotalFromIntervals,
    cacheRecomputedDailyFromIntervals: productionParityDiag?.recomputedDailyTotalFromIntervals,
    recalcRecomputedDailyFromIntervals: undefined,
    coldRecomputedMonthlyFromIntervals: coldParityDiag?.recomputedMonthlyTotalFromIntervals,
    cacheRecomputedMonthlyFromIntervals: productionParityDiag?.recomputedMonthlyTotalFromIntervals,
    recalcRecomputedMonthlyFromIntervals: undefined,
    firstDivergenceStage: integrityClassification.firstDivergenceStage,
  };
  if (parity?.coldVsRecalc?.recalc) {
    const recalcSide = parity.coldVsRecalc.recalc as {
      totalKwh?: number;
      recomputedTotalFromIntervals?: number;
      recomputedDailyTotalFromIntervals?: number;
      recomputedMonthlyTotalFromIntervals?: number;
    };
    integrity.recalcTotalKwh = recalcSide.totalKwh;
    integrity.recalcRecomputedFromIntervals = recalcSide.recomputedTotalFromIntervals;
    integrity.recalcRecomputedDailyFromIntervals = recalcSide.recomputedDailyTotalFromIntervals;
    integrity.recalcRecomputedMonthlyFromIntervals = recalcSide.recomputedMonthlyTotalFromIntervals;
  }

  const stitchedIntervalsDataset = productionDatasetForIntervals ?? coldDatasetForIntervals;
  const stitchedIntervalsAll = Array.isArray(stitchedIntervalsDataset?.series?.intervals15)
    ? (stitchedIntervalsDataset.series.intervals15 as Array<{ timestamp: string; kwh: number }>)
    : [];
  const stitchedSource: "production_artifact" | "cold_build" = productionDatasetForIntervals ? "production_artifact" : "cold_build";
  const stitchedSection = summarizeIntervalsSlice(stitchedIntervalsAll, DIAGNOSTIC_INTERVAL_LIMIT);
  const firstActualOnlyDayComparison = {
    date: firstActualOnlyDate,
    rawActualDayTotalKwh: firstActualOnlyDate ? dayTotalFromIntervalsUtc(rawActualIntervalsAll, firstActualOnlyDate) : null,
    stitchedPastDayTotalKwh: firstActualOnlyDate ? dayTotalFromIntervalsUtc(stitchedIntervalsAll, firstActualOnlyDate) : null,
    note:
      "Earliest canonical day that is not in travel/vacant exclusions; compare raw actual vs final stitched Past day totals.",
  };

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
    identity: {
      windowStartUtc: startDate,
      windowEndUtc: endDate,
      timezone,
      engineVersion: PAST_ENGINE_VERSION,
      buildInputsHash,
      intervalDataFingerprint,
      weatherIdentity,
      usageShapeProfileIdentity: {
        usageShapeProfileId: usageShapeProfileIdentity.usageShapeProfileId,
        usageShapeProfileVersion: usageShapeProfileIdentity.usageShapeProfileVersion,
        usageShapeProfileDerivedAt: usageShapeProfileIdentity.usageShapeProfileDerivedAt,
        usageShapeProfileSimHash: usageShapeProfileIdentity.usageShapeProfileSimHash,
      },
      inputHash,
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
    dayLevelParity,
    integrity,
    gapfillLabNote: {
      enginePath: "production_past_stitched",
      label: "GapFill Lab scoring (shared Past artifact)",
      sameEngineAsPastProduction: true,
      daySimulationCore: "shared_past_day_simulator",
      note: "GapFill Lab scoring reads the shared Past artifact via shared service paths and computes metrics via computeGapFillMetrics. LEGACY / NON-AUTHORITATIVE labels such as gapfill_test_days_profile are historical naming only and do not indicate a separate artifact or simulator ownership path.",
    },
    rawActualIntervalsMeta: {
      label: "Raw actual intervals",
      source: rawActualSource,
      coverageStart: rawActualSection.meta.coverageStart,
      coverageEnd: rawActualSection.meta.coverageEnd,
      intervalCount: rawActualSection.meta.intervalCount,
      truncated: rawActualSection.meta.truncated,
      truncationLimit: rawActualSection.meta.truncationLimit,
    },
    rawActualIntervals: rawActualSection.rows,
    stitchedPastIntervalsMeta: {
      label: "Final stitched Past corrected-baseline intervals",
      source: stitchedSource,
      coverageStart: stitchedSection.meta.coverageStart,
      coverageEnd: stitchedSection.meta.coverageEnd,
      intervalCount: stitchedSection.meta.intervalCount,
      truncated: stitchedSection.meta.truncated,
      truncationLimit: stitchedSection.meta.truncationLimit,
    },
    stitchedPastIntervals: stitchedSection.rows,
    firstActualOnlyDayComparison,
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
  parityDiagnostics?: {
    intervalDigest?: string;
    recomputedTotalFromIntervals?: number;
    recomputedDailyTotalFromIntervals?: number;
    recomputedMonthlyTotalFromIntervals?: number;
    datasetTotalKwh?: number;
    totalSource: string;
    sourceArtifact: string;
  };
}): Record<string, unknown> {
  const { summary, meta, scenarioId, scenarioKey, buildInputsHash, travelRangesUsed, coverageStart, coverageEnd, label, parityDiagnostics } = args;
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
    weatherSourceSummary: meta.weatherSourceSummary ?? undefined,
    // Normalize so match flag and displayed value agree: null/undefined/"" all become null.
    weatherFallbackReason: normalizeWeatherFallbackReason(meta.weatherFallbackReason),
    lastBuiltAt: meta.lastBuiltAt ?? undefined,
    source,
    ...(parityDiagnostics
      ? {
          intervalDigest: parityDiagnostics.intervalDigest,
          datasetTotalKwh: parityDiagnostics.datasetTotalKwh,
          recomputedTotalFromIntervals: parityDiagnostics.recomputedTotalFromIntervals,
          recomputedDailyTotalFromIntervals: parityDiagnostics.recomputedDailyTotalFromIntervals,
          recomputedMonthlyTotalFromIntervals: parityDiagnostics.recomputedMonthlyTotalFromIntervals,
          totalSource: parityDiagnostics.totalSource,
          sourceArtifact: parityDiagnostics.sourceArtifact,
        }
      : {}),
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
      ? Math.abs(totalKwhA - totalKwhB) <= 0.01
      : totalKwhA === totalKwhB;

  const intervalCountA = aSummary.intervalsCount;
  const intervalCountB = bSummary.intervalsCount;
  const intervalCountMatch = intervalCountA === intervalCountB;

  const weatherSummaryMatch = String(aMeta.weatherSourceSummary ?? "") === String(bMeta.weatherSourceSummary ?? "");
  const aFallback = normalizeWeatherFallbackReason(aMeta.weatherFallbackReason);
  const bFallback = normalizeWeatherFallbackReason(bMeta.weatherFallbackReason);
  const weatherFallbackMatch = aFallback === bFallback;

  return {
    totalKwhMatch,
    intervalCountMatch,
    weatherSummaryMatch,
    weatherFallbackMatch,
    cold: { totalKwh: totalKwhA, intervalsCount: intervalCountA, weatherSourceSummary: aMeta.weatherSourceSummary, weatherFallbackReason: aFallback },
    production: { totalKwh: totalKwhB, intervalsCount: intervalCountB, weatherSourceSummary: bMeta.weatherSourceSummary, weatherFallbackReason: bFallback },
  };
}