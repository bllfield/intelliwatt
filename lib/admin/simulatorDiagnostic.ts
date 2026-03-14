/**
 * Admin diagnostic for production simulator/weather pipeline.
 * Runs cold build, stub audit, production path, optional recalc+parity; returns structured payload.
 */

import { createHash } from "crypto";
import { enumerateDayStartsMsForWindow, dateKeyFromTimestamp, getDayGridTimestamps } from "@/modules/usageSimulator/pastStitchedCurve";
import { getPastSimulatedDatasetForHouse, getSimulatedUsageForHouseScenario, recalcSimulatorBuild } from "@/modules/usageSimulator/service";
import { getActualIntervalsForRangeWithSource, getIntervalDataFingerprint } from "@/lib/usage/actualDatasetForHouse";
import { travelRangesToExcludeDateKeys } from "@/modules/usageSimulator/build";
import { resolveWindowFromBuildInputsForPastIdentity } from "@/modules/usageSimulator/windowIdentity";
import { computePastInputHash, PAST_ENGINE_VERSION } from "@/modules/usageSimulator/pastCache";
import { computePastWeatherIdentity } from "@/modules/weather/identity";
import { getUsageShapeProfileIdentityForPast } from "@/modules/simulatedUsage/simulatePastUsageDataset";
import { getHouseWeatherDays } from "@/modules/weather/repo";
import { WEATHER_STUB_SOURCE } from "@/modules/weather/types";

const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;
const BOUNDARY_STUB_SAMPLE = 5;
const DIAGNOSTIC_INTERVAL_LIMIT = 96;
const CACHE_CODEC_DRIFT_TOLERANCE_KWH = 0.05;

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

function recomputedTotalFromIntervals(intervals15: Array<{ timestamp?: string; kwh?: number }>): number | undefined {
  if (!Array.isArray(intervals15)) return undefined;
  const sum = intervals15.reduce((s, p) => s + (Number(p?.kwh) ?? 0), 0);
  return Number.isFinite(sum) ? Math.round(sum * 100) / 100 : undefined;
}

/** Parity diagnostics derived from a dataset (interval digest, recomputed total, source artifact). */
function computeParityDiagnostics(dataset: any): {
  intervalDigest?: string;
  recomputedTotalFromIntervals?: number;
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
  return {
    intervalDigest: intervalDigest(intervals15),
    recomputedTotalFromIntervals: recomputedTotalFromIntervals(intervals15),
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
    cacheCodecDriftLikely: boolean | null;
    cacheIntegrityPass: boolean | null;
    cacheIntegrityReason:
      | "not_cache_restore"
      | "digest_match"
      | "digest_unavailable_totals_match"
      | "digest_mismatch_codec_drift_likely"
      | "digest_mismatch";
    coldTotalKwh?: number;
    cacheTotalKwh?: number;
    recalcTotalKwh?: number;
    coldRecomputedFromIntervals?: number;
    cacheRecomputedFromIntervals?: number;
    recalcRecomputedFromIntervals?: number;
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
        const afterRecalc = await getSimulatedUsageForHouseScenario({ userId, houseId, scenarioId });
        if (afterRecalc.ok && afterRecalc.dataset) {
          recalcMeta = extractMeta(afterRecalc.dataset);
          recalcSummary = extractSummary(afterRecalc.dataset);
          recalcParityDiag = computeParityDiagnostics(afterRecalc.dataset);
          recalcDatasetForDayParity = afterRecalc.dataset;
          (afterRecalc as { dataset?: unknown }).dataset = undefined;
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
        parityDiagnostics: coldParityDiag,
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
        parityDiagnostics: productionParityDiag,
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
    isCacheRestore && typeof coldSummary.totalKwh === "number" && typeof productionSummary.totalKwh === "number"
      ? Math.round(Math.abs(coldSummary.totalKwh - productionSummary.totalKwh) * 100) / 100
      : null;
  const cacheCodecDriftLikely: boolean | null =
    isCacheRestore
      ? cacheDigestMatch === false &&
        coldParityOk &&
        productionParityOk &&
        typeof cacheTotalDeltaKwh === "number" &&
        cacheTotalDeltaKwh <= CACHE_CODEC_DRIFT_TOLERANCE_KWH
      : null;
  const cacheIntegrityPass: boolean | null =
    !isCacheRestore
      ? null
      : cacheDigestMatch === true
        ? true
        : cacheDigestMatch == null && coldVsCacheMatch === true
          ? true
          : cacheCodecDriftLikely === true;
  const cacheIntegrityReason: NonNullable<SimulatorDiagnosticResult["integrity"]>["cacheIntegrityReason"] =
    !isCacheRestore
      ? "not_cache_restore"
      : cacheDigestMatch === true
        ? "digest_match"
        : cacheDigestMatch == null && coldVsCacheMatch === true
          ? "digest_unavailable_totals_match"
          : cacheCodecDriftLikely === true
            ? "digest_mismatch_codec_drift_likely"
            : "digest_mismatch";

  const integrity: SimulatorDiagnosticResult["integrity"] = {
    intervalCountMatch,
    parityMatch,
    coldVsCacheMatch,
    cacheDigestMatch,
    cacheTotalDeltaKwh,
    cacheCodecDriftLikely,
    cacheIntegrityPass,
    cacheIntegrityReason,
    coldTotalKwh: coldSummary.totalKwh,
    cacheTotalKwh: productionResult.ok ? productionSummary.totalKwh : undefined,
    recalcTotalKwh: undefined,
    coldRecomputedFromIntervals: coldParityDiag?.recomputedTotalFromIntervals,
    cacheRecomputedFromIntervals: productionParityDiag?.recomputedTotalFromIntervals,
    recalcRecomputedFromIntervals: undefined,
  };
  if (parity?.coldVsRecalc?.recalc) {
    const recalcSide = parity.coldVsRecalc.recalc as { totalKwh?: number; recomputedTotalFromIntervals?: number };
    integrity.recalcTotalKwh = recalcSide.totalKwh;
    integrity.recalcRecomputedFromIntervals = recalcSide.recomputedTotalFromIntervals;
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
      enginePath: "gapfill_test_days_profile",
      label: "GapFill Lab validation (test-days profile)",
      sameEngineAsPastProduction: true,
      daySimulationCore: "shared_past_day_simulator",
      note: "GapFill Lab compare/read now uses artifact-only reads from the saved gapfill_lab Past artifact via getSimulatedUsageForHouseScenario(readMode=artifact_only), then computes metrics via computeGapFillMetrics. Rebuilds remain explicit actions.",
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