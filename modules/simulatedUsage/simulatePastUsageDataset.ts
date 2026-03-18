/**
 * Shared Past simulation entrypoint.
 * Single internal entrypoint for user-facing Past (cold build + recalc) and GapFill Lab production path.
 * Owns: canonical window, weather loading with provenance, reference-day derivation, curve and dataset build.
 */

import { prisma } from "@/lib/db";
import { getActualIntervalsForRange } from "@/lib/usage/actualDatasetForHouse";
import { travelRangesToExcludeDateKeys } from "@/modules/usageSimulator/build";
import { boundDateKeysToCoverageWindow } from "@/modules/usageSimulator/metadataWindow";
import {
  buildCurveFromPatchedIntervals,
  buildSimulatedUsageDatasetFromCurve,
  type SimulatorBuildInputsV1,
} from "@/modules/usageSimulator/dataset";
import { dateKeyFromTimestamp, enumerateDayStartsMsForWindow, getDayGridTimestamps } from "@/modules/usageSimulator/pastStitchedCurve";
import { buildPastSimulatedBaselineV1 } from "@/modules/simulatedUsage/engine";
import { getHouseWeatherDays } from "@/modules/weather/repo";
import { ensureHouseWeatherBackfill } from "@/modules/weather/backfill";
import { ensureHouseWeatherStubbed } from "@/modules/weather/stubs";
import { WEATHER_STUB_SOURCE } from "@/modules/weather/types";
import { SOURCE_OF_DAY_SIMULATION_CORE } from "@/modules/simulatedUsage/pastDaySimulator";
import { getHomeProfileSimulatedByUserHouse } from "@/modules/homeProfile/repo";
import { getApplianceProfileSimulatedByUserHouse } from "@/modules/applianceProfile/repo";
import { normalizeStoredApplianceProfile } from "@/modules/applianceProfile/validation";
import { buildMonthKeyedDailyAverages, deriveUsageShapeProfile } from "@/modules/usageShapeProfile/derive";
import { computeUsageShapeProfileSimIdentityHash, getLatestUsageShapeProfile } from "@/modules/usageShapeProfile/repo";
import { PAST_ENGINE_VERSION } from "@/modules/usageSimulator/pastCache";
import type { SimulatedCurve } from "@/modules/simulatedUsage/types";
import type { SimulatedDayResult } from "@/modules/simulatedUsage/pastDaySimulatorTypes";

export type BuildPathKind = "cold_build" | "recalc" | "lab_validation";

export type WeatherFallbackReason =
  | "missing_lat_lng"
  | "api_failure_or_no_data"
  | "partial_coverage"
  | "unknown"
  | null;

export type WeatherProvenance = {
  weatherKindUsed: string | undefined;
  /** When provenance is missing (e.g. cache restore from older cache), use "unknown" so UI never implies actual weather. */
  weatherSourceSummary: "stub_only" | "actual_only" | "mixed_actual_and_stub" | "none" | "unknown";
  weatherFallbackReason: WeatherFallbackReason;
  weatherProviderName: string;
  weatherCoverageStart: string | null;
  weatherCoverageEnd: string | null;
  weatherStubRowCount: number;
  weatherActualRowCount: number;
};

function dateKeysFromCanonicalDayStarts(canonicalDayStartsMs: number[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const dayStartMs of canonicalDayStartsMs ?? []) {
    if (!Number.isFinite(dayStartMs)) continue;
    const gridTs = getDayGridTimestamps(dayStartMs);
    if (!gridTs.length) continue;
    const dateKey = dateKeyFromTimestamp(gridTs[0]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || seen.has(dateKey)) continue;
    seen.add(dateKey);
    out.push(dateKey);
  }
  return out;
}

/**
 * Single shared weather loader for Past window.
 * Produces actualWxByDateKey, normalWxByDateKey, and truthful provenance.
 */
export async function loadWeatherForPastWindow(args: {
  houseId: string;
  startDate: string;
  endDate: string;
  canonicalDateKeys: string[];
}): Promise<{
  actualWxByDateKey: Awaited<ReturnType<typeof getHouseWeatherDays>>;
  normalWxByDateKey: Awaited<ReturnType<typeof getHouseWeatherDays>>;
  provenance: WeatherProvenance;
}> {
  const { houseId, startDate, endDate, canonicalDateKeys } = args;
  const house = await (prisma as any).houseAddress
    .findUnique({ where: { id: houseId }, select: { lat: true, lng: true } })
    .catch(() => null);
  const lat = house?.lat != null && Number.isFinite(house.lat) ? house.lat : null;
  const lon = house?.lng != null && Number.isFinite(house.lng) ? house.lng : null;

  if (lat != null && lon != null) {
    const backfillResult = await ensureHouseWeatherBackfill({ houseId, startDate, endDate });
    const [actualWxByDateKey, normalWxByDateKey] = await Promise.all([
      getHouseWeatherDays({ houseId, dateKeys: canonicalDateKeys, kind: "ACTUAL_LAST_YEAR" }),
      getHouseWeatherDays({ houseId, dateKeys: canonicalDateKeys, kind: "NORMAL_AVG" }),
    ]);
    const missingWxKeys = canonicalDateKeys.filter((dk) => !actualWxByDateKey.has(dk));
    if (missingWxKeys.length > 0) {
      await ensureHouseWeatherStubbed({ houseId, dateKeys: missingWxKeys });
      const [actualWx2, normalWx2] = await Promise.all([
        getHouseWeatherDays({ houseId, dateKeys: canonicalDateKeys, kind: "ACTUAL_LAST_YEAR" }),
        getHouseWeatherDays({ houseId, dateKeys: canonicalDateKeys, kind: "NORMAL_AVG" }),
      ]);
      const wxEntries = Array.from(actualWx2.entries());
      const dateKeysSorted = wxEntries.map(([dk]) => dk).sort();
      let weatherStubRowCount = 0;
      const sourcesSeen = new Set<string>();
      for (const [, w] of wxEntries) {
        const src = String(w?.source ?? "").trim();
        if (src) sourcesSeen.add(src);
        if (src === WEATHER_STUB_SOURCE) weatherStubRowCount += 1;
      }
      const weatherRowsCount = wxEntries.length;
      const weatherActualRowCount = weatherRowsCount - weatherStubRowCount;
      const weatherKindUsed =
        sourcesSeen.size === 1 ? Array.from(sourcesSeen)[0]! : sourcesSeen.size > 1 ? "MIXED" : undefined;
      let weatherSourceSummary: WeatherProvenance["weatherSourceSummary"] = "none";
      if (weatherRowsCount > 0) {
        if (weatherStubRowCount === weatherRowsCount) weatherSourceSummary = "stub_only";
        else if (weatherActualRowCount === weatherRowsCount) weatherSourceSummary = "actual_only";
        else weatherSourceSummary = "mixed_actual_and_stub";
      }
      const weatherFallbackReason: WeatherFallbackReason =
        backfillResult.skippedLatLng === true
          ? "missing_lat_lng"
          : backfillResult.fetched === 0 && (backfillResult.stubbed ?? 0) > 0
            ? "api_failure_or_no_data"
            : (backfillResult.stubbed ?? 0) > 0
              ? "partial_coverage"
              : null;
      return {
        actualWxByDateKey: actualWx2,
        normalWxByDateKey: normalWx2,
        provenance: {
          weatherKindUsed,
          weatherSourceSummary,
          weatherFallbackReason,
          weatherProviderName: weatherActualRowCount > 0 ? "OPEN_METEO" : "STUB",
          weatherCoverageStart: dateKeysSorted[0] ?? null,
          weatherCoverageEnd: dateKeysSorted[dateKeysSorted.length - 1] ?? null,
          weatherStubRowCount,
          weatherActualRowCount,
        },
      };
    }
    const wxEntries = Array.from(actualWxByDateKey.entries());
    const dateKeysSorted = wxEntries.map(([dk]) => dk).sort();
    let weatherStubRowCount = 0;
    const sourcesSeen = new Set<string>();
    for (const [, w] of wxEntries) {
      const src = String(w?.source ?? "").trim();
      if (src) sourcesSeen.add(src);
      if (src === WEATHER_STUB_SOURCE) weatherStubRowCount += 1;
    }
    const weatherRowsCount = wxEntries.length;
    const weatherActualRowCount = weatherRowsCount - weatherStubRowCount;
    const weatherKindUsed =
      sourcesSeen.size === 1 ? Array.from(sourcesSeen)[0]! : sourcesSeen.size > 1 ? "MIXED" : undefined;
    let weatherSourceSummary: WeatherProvenance["weatherSourceSummary"] = "none";
    if (weatherRowsCount > 0) {
      if (weatherStubRowCount === weatherRowsCount) weatherSourceSummary = "stub_only";
      else if (weatherActualRowCount === weatherRowsCount) weatherSourceSummary = "actual_only";
      else weatherSourceSummary = "mixed_actual_and_stub";
    }
    const weatherFallbackReason: WeatherFallbackReason =
      (backfillResult.stubbed ?? 0) > 0 ? "partial_coverage" : null;
    return {
      actualWxByDateKey,
      normalWxByDateKey,
      provenance: {
        weatherKindUsed,
        weatherSourceSummary,
        weatherFallbackReason,
        weatherProviderName: weatherActualRowCount > 0 ? "OPEN_METEO" : "STUB",
        weatherCoverageStart: dateKeysSorted[0] ?? null,
        weatherCoverageEnd: dateKeysSorted[dateKeysSorted.length - 1] ?? null,
        weatherStubRowCount,
        weatherActualRowCount,
      },
    };
  }

  await ensureHouseWeatherStubbed({ houseId, dateKeys: canonicalDateKeys });
  const [actualWxByDateKey, normalWxByDateKey] = await Promise.all([
    getHouseWeatherDays({ houseId, dateKeys: canonicalDateKeys, kind: "ACTUAL_LAST_YEAR" }),
    getHouseWeatherDays({ houseId, dateKeys: canonicalDateKeys, kind: "NORMAL_AVG" }),
  ]);
  const wxEntries = Array.from(actualWxByDateKey.entries());
  const dateKeysSorted = wxEntries.map(([dk]) => dk).sort();
  const weatherStubRowCount = wxEntries.length;
  return {
    actualWxByDateKey,
    normalWxByDateKey,
    provenance: {
      weatherKindUsed: WEATHER_STUB_SOURCE,
      weatherSourceSummary: "stub_only",
      weatherFallbackReason: "missing_lat_lng",
      weatherProviderName: "STUB",
      weatherCoverageStart: dateKeysSorted[0] ?? null,
      weatherCoverageEnd: dateKeysSorted[dateKeysSorted.length - 1] ?? null,
      weatherStubRowCount,
      weatherActualRowCount: 0,
    },
  };
}

export type SimulatePastUsageDatasetArgs = {
  houseId: string;
  userId: string;
  esiid: string | null;
  startDate: string;
  endDate: string;
  timezone: string | undefined;
  travelRanges: Array<{ startDate: string; endDate: string }>;
  buildInputs: SimulatorBuildInputsV1;
  buildPathKind: BuildPathKind;
  /** Explicit caller intent; defaults to true to preserve existing behavior. */
  includeSimulatedDayResults?: boolean;
  /** When provided, skip fetching actual intervals (caller already has them). */
  actualIntervals?: Array<{ timestamp: string; kwh: number }>;
};

export type SimulatePastUsageDatasetResult = {
  dataset: ReturnType<typeof buildSimulatedUsageDatasetFromCurve>;
  meta: Record<string, unknown>;
  pastDayCounts: { totalDays?: number; excludedDays?: number; leadingMissingDays?: number; simulatedDays?: number };
  shapeMonthsPresent: string[];
  /** For callers that attach dailyWeather or need weather for overlay. */
  actualWxByDateKey?: Awaited<ReturnType<typeof getHouseWeatherDays>>;
  /** For recalc path to set pastPatchedCurve and monthlyTotalsKwhByMonth. */
  stitchedCurve?: SimulatedCurve;
  /** Supplemental metadata for simulated dates only. */
  simulatedDayResults?: SimulatedDayResult[];
};

export type SimulatePastSelectedDaysArgs = Omit<SimulatePastUsageDatasetArgs, "includeSimulatedDayResults"> & {
  selectedDateKeysLocal: Set<string>;
};

export type SimulatePastSelectedDaysResult = {
  simulatedIntervals: Array<{ timestamp: string; kwh: number }>;
  simulatedDayResults: SimulatedDayResult[];
  pastDayCounts: { totalDays?: number; excludedDays?: number; leadingMissingDays?: number; simulatedDays?: number };
  weatherSourceSummary: WeatherProvenance["weatherSourceSummary"];
  weatherKindUsed: string | undefined;
};

export type UsageShapeProfileIdentity = {
  usageShapeProfileId: string | null;
  usageShapeProfileVersion: string | null;
  usageShapeProfileDerivedAt: string | null;
  usageShapeProfileSimHash: string | null;
};

/**
 * Shared identity/version snapshot used in Past cache-key construction.
 * Keeps cache invalidation aligned with the profile row that drives day-total selection.
 */
export async function getUsageShapeProfileIdentityForPast(houseId: string): Promise<UsageShapeProfileIdentity> {
  const row = await getLatestUsageShapeProfile(houseId).catch(() => null);
  return {
    usageShapeProfileId: row?.id ? String(row.id) : null,
    usageShapeProfileVersion: row?.version != null ? String(row.version) : null,
    usageShapeProfileDerivedAt: row?.derivedAt != null ? String(row.derivedAt) : null,
    usageShapeProfileSimHash: computeUsageShapeProfileSimIdentityHash(
      row
        ? {
            baseloadKwhPer15m: row.baseloadKwhPer15m,
            baseloadKwhPerDay: row.baseloadKwhPerDay,
            shapeAll96: row.shapeAll96 as any,
            shapeWeekday96: row.shapeWeekday96 as any,
            shapeWeekend96: row.shapeWeekend96 as any,
            shapeByMonth96: row.shapeByMonth96 as any,
            avgKwhPerDayWeekdayByMonth: row.avgKwhPerDayWeekdayByMonth as any,
            avgKwhPerDayWeekendByMonth: row.avgKwhPerDayWeekendByMonth as any,
            peakHourByMonth: row.peakHourByMonth as any,
            p95KwByMonth: row.p95KwByMonth as any,
            timeOfDayShares: row.timeOfDayShares as any,
            configHash: String(row.configHash ?? ""),
          }
        : null
    ),
  };
}

function parseMonthKeysFromShapeByMonth(shapeByMonth: unknown): string[] {
  return Object.keys((shapeByMonth as Record<string, unknown>) ?? {})
    .filter((k) => /^\d{4}-\d{2}$/.test(k))
    .sort();
}

export function buildUsageShapeProfileSnapFromMonthContract(args: {
  monthKeys: string[];
  weekdayVals: unknown;
  weekendVals: unknown;
  weekdayByMonthKeyVals?: unknown;
  weekendByMonthKeyVals?: unknown;
}): { weekdayAvgByMonthKey: Record<string, number>; weekendAvgByMonthKey: Record<string, number> } | null {
  const explicitWeekday = (args.weekdayByMonthKeyVals ?? {}) as Record<string, unknown>;
  const explicitWeekend = (args.weekendByMonthKeyVals ?? {}) as Record<string, unknown>;
  const weekdayAvgByMonthKey: Record<string, number> = {};
  const weekendAvgByMonthKey: Record<string, number> = {};

  for (const ym of args.monthKeys ?? []) {
    const fromWd = explicitWeekday?.[ym];
    const fromWe = explicitWeekend?.[ym];
    if (fromWd != null && Number.isFinite(Number(fromWd)) && Number(fromWd) > 0) weekdayAvgByMonthKey[ym] = Number(fromWd);
    if (fromWe != null && Number.isFinite(Number(fromWe)) && Number(fromWe) > 0) weekendAvgByMonthKey[ym] = Number(fromWe);
  }
  if (Object.keys(weekdayAvgByMonthKey).length > 0 || Object.keys(weekendAvgByMonthKey).length > 0) {
    return { weekdayAvgByMonthKey, weekendAvgByMonthKey };
  }

  const wd = Array.isArray(args.weekdayVals) ? (args.weekdayVals as number[]) : [];
  const we = Array.isArray(args.weekendVals) ? (args.weekendVals as number[]) : [];
  const keyed = buildMonthKeyedDailyAverages({
    monthKeys: args.monthKeys,
    weekdayByCalendarMonth: wd,
    weekendByCalendarMonth: we,
  });
  if (Object.keys(keyed.weekdayByMonthKey).length > 0 || Object.keys(keyed.weekendByMonthKey).length > 0) {
    return {
      weekdayAvgByMonthKey: keyed.weekdayByMonthKey,
      weekendAvgByMonthKey: keyed.weekendByMonthKey,
    };
  }
  return null;
}

/**
 * Single shared Past simulation entrypoint.
 * Used by getPastSimulatedDatasetForHouse (cold build), recalcSimulatorBuild (recalc), and GapFill Lab production path.
 */
export async function simulatePastUsageDataset(
  args: SimulatePastUsageDatasetArgs
): Promise<SimulatePastUsageDatasetResult | { dataset: null; error: string }> {
  const {
    houseId,
    userId,
    esiid,
    startDate,
    endDate,
    timezone,
    travelRanges,
    buildInputs,
    buildPathKind,
    includeSimulatedDayResults = true,
    actualIntervals: preloadedIntervals,
  } = args;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return { dataset: null, error: "Invalid startDate or endDate (expect YYYY-MM-DD)." };
  }

  try {
    const actualIntervals =
      preloadedIntervals ??
      (await getActualIntervalsForRange({ houseId, esiid, startDate, endDate })).map((p) => ({
        timestamp: p.timestamp,
        kwh: p.kwh,
      }));

    const canonicalDayStartsMs = enumerateDayStartsMsForWindow(startDate, endDate);
    const canonicalDateKeys = dateKeysFromCanonicalDayStarts(canonicalDayStartsMs);
    // Keep exclusion metadata and downstream simulated-day labeling aligned to the
    // active usage coverage window only (older travel ranges naturally fall off).
    const excludedDateKeys = boundDateKeysToCoverageWindow(
      travelRangesToExcludeDateKeys(travelRanges),
      { startDate, endDate }
    );
    const excludedDateKeysFingerprint = Array.from(excludedDateKeys).sort().join(",");

    const { actualWxByDateKey, normalWxByDateKey, provenance } = await loadWeatherForPastWindow({
      houseId,
      startDate,
      endDate,
      canonicalDateKeys,
    });
    if (provenance.weatherSourceSummary !== "actual_only") {
      return {
        dataset: null,
        error: `actual_weather_required:${provenance.weatherSourceSummary}`,
      };
    }

    const [homeRecForPast, applianceRecForPast, shapeProfileRow] = await Promise.all([
      getHomeProfileSimulatedByUserHouse({ userId, houseId }),
      getApplianceProfileSimulatedByUserHouse({ userId, houseId }),
      getLatestUsageShapeProfile(houseId).catch(() => null),
    ]);
    const homeProfileForPast = homeRecForPast ? { ...homeRecForPast } : (buildInputs as any)?.snapshots?.homeProfile ?? null;
    const applianceProfileForPast =
      normalizeStoredApplianceProfile((applianceRecForPast?.appliancesJson as any) ?? null)?.fuelConfiguration
        ? normalizeStoredApplianceProfile((applianceRecForPast?.appliancesJson as any) ?? null)
        : normalizeStoredApplianceProfile((buildInputs as any)?.snapshots?.applianceProfile ?? null);

    const canonicalMonths = ((buildInputs as any).canonicalMonths ?? []) as string[];
    let usageShapeProfileSnap: { weekdayAvgByMonthKey: Record<string, number>; weekendAvgByMonthKey: Record<string, number> } | null = null;
    let inlineDerivedShapeProfile:
      | ReturnType<typeof deriveUsageShapeProfile>
      | null = null;
    let reasonNotUsed: string | null = null;
    if (!shapeProfileRow) {
      reasonNotUsed = "profile_not_found";
    } else if (!timezone) {
      reasonNotUsed = "missing_timezone";
    } else if (!shapeProfileRow.shapeByMonth96) {
      reasonNotUsed = "no_shapeByMonth96";
    } else if (shapeProfileRow.avgKwhPerDayWeekdayByMonth == null || shapeProfileRow.avgKwhPerDayWeekendByMonth == null) {
      reasonNotUsed = "missing_arrays";
    }
    if (timezone && shapeProfileRow?.shapeByMonth96 && shapeProfileRow?.avgKwhPerDayWeekdayByMonth != null && shapeProfileRow?.avgKwhPerDayWeekendByMonth != null) {
      const profileMonthKeys = parseMonthKeysFromShapeByMonth(shapeProfileRow.shapeByMonth96);
      const snap = buildUsageShapeProfileSnapFromMonthContract({
        monthKeys: profileMonthKeys,
        weekdayVals: shapeProfileRow.avgKwhPerDayWeekdayByMonth,
        weekendVals: shapeProfileRow.avgKwhPerDayWeekendByMonth,
      });
      if (snap) {
        usageShapeProfileSnap = snap;
        reasonNotUsed = null;
      } else {
        reasonNotUsed = reasonNotUsed ?? "no_positive_values";
      }
    }
    if (!usageShapeProfileSnap && timezone && actualIntervals.length > 0) {
      try {
        inlineDerivedShapeProfile = deriveUsageShapeProfile(
          actualIntervals.map((r) => ({
            tsUtc: String(r.timestamp ?? ""),
            kwh: Number(r.kwh) || 0,
          })),
          timezone,
          `${startDate}T00:00:00.000Z`,
          `${endDate}T23:59:59.999Z`
        );
        const inlineMonthKeys = parseMonthKeysFromShapeByMonth(inlineDerivedShapeProfile.shapeByMonth96);
        const inlineSnap = buildUsageShapeProfileSnapFromMonthContract({
          monthKeys: inlineMonthKeys,
          weekdayVals: inlineDerivedShapeProfile.avgKwhPerDayWeekdayByMonth,
          weekendVals: inlineDerivedShapeProfile.avgKwhPerDayWeekendByMonth,
          weekdayByMonthKeyVals: inlineDerivedShapeProfile.avgKwhPerDayWeekdayByMonthKey,
          weekendByMonthKeyVals: inlineDerivedShapeProfile.avgKwhPerDayWeekendByMonthKey,
        });
        if (inlineSnap) {
          usageShapeProfileSnap = inlineSnap;
          reasonNotUsed = null;
        } else {
          reasonNotUsed = reasonNotUsed ?? "inline_profile_no_positive_values";
        }
      } catch {
        reasonNotUsed = reasonNotUsed ?? "inline_profile_derive_failed";
      }
    }
    if (!usageShapeProfileSnap) {
      return {
        dataset: null,
        error: `usage_shape_profile_required:${reasonNotUsed ?? "missing"}`,
      };
    }
    const usageShapeProfileDiag = {
      found: !!shapeProfileRow || !!inlineDerivedShapeProfile,
      id: shapeProfileRow?.id ?? null,
      version: shapeProfileRow?.version ?? (inlineDerivedShapeProfile ? "inline_derived_v1" : null),
      derivedAt: shapeProfileRow?.derivedAt != null ? String(shapeProfileRow.derivedAt) : null,
      windowStartUtc:
        shapeProfileRow?.windowStartUtc != null
          ? String(shapeProfileRow.windowStartUtc)
          : (inlineDerivedShapeProfile?.windowStartUtc ?? null),
      windowEndUtc:
        shapeProfileRow?.windowEndUtc != null
          ? String(shapeProfileRow.windowEndUtc)
          : (inlineDerivedShapeProfile?.windowEndUtc ?? null),
      profileMonthKeys: shapeProfileRow?.shapeByMonth96
        ? Object.keys((shapeProfileRow.shapeByMonth96 as Record<string, unknown>) ?? {}).filter((k) => /^\d{4}-\d{2}$/.test(k)).sort()
        : Object.keys(inlineDerivedShapeProfile?.shapeByMonth96 ?? {}).filter((k) => /^\d{4}-\d{2}$/.test(k)).sort(),
      weekdayAvgLen:
        shapeProfileRow?.avgKwhPerDayWeekdayByMonth != null
          ? (Array.isArray(shapeProfileRow.avgKwhPerDayWeekdayByMonth) ? shapeProfileRow.avgKwhPerDayWeekdayByMonth.length : null)
          : Array.isArray(inlineDerivedShapeProfile?.avgKwhPerDayWeekdayByMonth)
            ? inlineDerivedShapeProfile!.avgKwhPerDayWeekdayByMonth.length
            : null,
      weekendAvgLen:
        shapeProfileRow?.avgKwhPerDayWeekendByMonth != null
          ? (Array.isArray(shapeProfileRow.avgKwhPerDayWeekendByMonth) ? shapeProfileRow.avgKwhPerDayWeekendByMonth.length : null)
          : Array.isArray(inlineDerivedShapeProfile?.avgKwhPerDayWeekendByMonth)
            ? inlineDerivedShapeProfile!.avgKwhPerDayWeekendByMonth.length
            : null,
      canonicalMonths,
      canonicalMonthsLen: canonicalMonths.length,
      inlineDerivedFromActual: !!inlineDerivedShapeProfile,
      reasonNotUsed,
    };

    // In serverless paths, retaining full per-day simulated diagnostics can trigger
    // memory pressure for large windows. Only collect when explicitly requested.
    const collectSimulatedDayResultsForDiagnostics = includeSimulatedDayResults;
    const pastDayCounts: { totalDays?: number; excludedDays?: number; leadingMissingDays?: number; simulatedDays?: number } = {};
    const { intervals: patchedIntervals, dayResults } = buildPastSimulatedBaselineV1({
      actualIntervals,
      canonicalDayStartsMs,
      excludedDateKeys,
      dateKeyFromTimestamp,
      getDayGridTimestamps,
      homeProfile: homeProfileForPast,
      applianceProfile: applianceProfileForPast,
      usageShapeProfile: usageShapeProfileSnap ?? undefined,
      timezoneForProfile: timezone ?? undefined,
      actualWxByDateKey,
      _normalWxByDateKey: normalWxByDateKey,
      collectSimulatedDayResults: collectSimulatedDayResultsForDiagnostics,
      debug: { out: pastDayCounts as any },
    });

    const referenceDaysCount =
      typeof pastDayCounts.totalDays === "number" && typeof pastDayCounts.simulatedDays === "number"
        ? pastDayCounts.totalDays - pastDayCounts.simulatedDays
        : undefined;
    const shapeMonthsPresent = canonicalMonths;

    const stitchedCurve = buildCurveFromPatchedIntervals({
      startDate,
      endDate,
      intervals: patchedIntervals,
    });

    const dataset = buildSimulatedUsageDatasetFromCurve(
      stitchedCurve,
      {
        baseKind: buildInputs.baseKind,
        mode: buildInputs.mode,
        canonicalEndMonth: buildInputs.canonicalEndMonth,
        notes: buildInputs.notes ?? [],
        filledMonths: buildInputs.filledMonths ?? [],
      },
      {
        timezone: timezone ?? undefined,
        useUtcMonth: true,
        simulatedDayResults: collectSimulatedDayResultsForDiagnostics ? dayResults : undefined,
      }
    );

    if (dataset && typeof dataset.meta === "object") {
      const simulatedDayDiagnosticsSample = dayResults.slice(0, 40).map((r) => ({
        localDate: String(r.localDate ?? "").slice(0, 10),
        targetDayKwhBeforeWeather: Number(r.targetDayKwhBeforeWeather ?? r.rawDayKwh ?? 0) || 0,
        weatherAdjustedDayKwh: Number(r.weatherAdjustedDayKwh ?? 0) || 0,
        dayTypeUsed: (r.dayTypeUsed as "weekday" | "weekend" | undefined) ?? null,
        shapeVariantUsed: r.shapeVariantUsed ?? null,
        finalDayKwh: Number(r.finalDayKwh ?? 0) || 0,
        intervalSumKwh: Number(r.intervalSumKwh ?? 0) || 0,
        fallbackLevel: r.fallbackLevel ?? null,
      }));
      const weatherUsed =
        provenance.weatherSourceSummary === "actual_only" ||
        provenance.weatherSourceSummary === "mixed_actual_and_stub" ||
        provenance.weatherSourceSummary === "stub_only";
      dataset.meta = {
        ...dataset.meta,
        buildPathKind,
        sourceOfDaySimulationCore: SOURCE_OF_DAY_SIMULATION_CORE,
        derivationVersion: PAST_ENGINE_VERSION,
        simVersion: PAST_ENGINE_VERSION,
        weekdayWeekendSplitUsed: !!usageShapeProfileSnap,
        dayTotalSource: usageShapeProfileSnap ? "usageShapeProfile_avgKwhPerDayByMonth" : "fallback_month_avg",
        dayTotalShapingPath: "shared_daytype_neighbor_weather_shaping",
        curveShapingVersion: "shared_curve_v2",
        usageShapeProfileDiag,
        dailyRowCount: Array.isArray(dataset.daily) ? dataset.daily.length : 0,
        intervalCount: Array.isArray(dataset?.series?.intervals15) ? dataset.series.intervals15.length : 0,
        coverageStart: dataset?.summary?.start ?? startDate,
        coverageEnd: dataset?.summary?.end ?? endDate,
        actualDayCount:
          typeof pastDayCounts.totalDays === "number" && typeof pastDayCounts.simulatedDays === "number"
            ? pastDayCounts.totalDays - pastDayCounts.simulatedDays
            : undefined,
        simulatedDayCount: pastDayCounts.simulatedDays,
        stitchedDayCount: pastDayCounts.excludedDays != null ? pastDayCounts.excludedDays : undefined,
        actualIntervalsCount: actualIntervals.length,
        referenceDaysCount,
        shapeMonthsPresent,
        excludedDateKeysCount: excludedDateKeys.size,
        excludedDateKeysFingerprint,
        leadingMissingDaysCount: pastDayCounts.leadingMissingDays ?? undefined,
        weatherKindUsed: provenance.weatherKindUsed,
        weatherSourceSummary: provenance.weatherSourceSummary,
        weatherFallbackReason: provenance.weatherFallbackReason,
        weatherProviderName: provenance.weatherProviderName,
        weatherCoverageStart: provenance.weatherCoverageStart,
        weatherCoverageEnd: provenance.weatherCoverageEnd,
        weatherStubRowCount: provenance.weatherStubRowCount,
        weatherActualRowCount: provenance.weatherActualRowCount,
        weatherUsed,
        weatherNote: weatherUsed
          ? `Weather integrated in shared past path (${provenance.weatherSourceSummary}).`
          : "Weather unavailable for shared past path.",
        simulatedDayDiagnosticsSample,
      };
    }

    return {
      dataset,
      meta: (dataset?.meta as Record<string, unknown>) ?? {},
      pastDayCounts,
      shapeMonthsPresent,
      actualWxByDateKey: actualWxByDateKey,
      stitchedCurve,
      simulatedDayResults: includeSimulatedDayResults ? dayResults : undefined,
    };
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    console.warn("[simulatePastUsageDataset] failed", { houseId, err: e });
    return { dataset: null, error: err.message };
  }
}

/**
 * Shared selected-day fresh execution path.
 * Uses the exact same shared weather/profile/context preparation as full-window past simulation,
 * but emits simulated outputs only for the selected local days.
 */
export async function simulatePastSelectedDaysShared(
  args: SimulatePastSelectedDaysArgs
): Promise<SimulatePastSelectedDaysResult | { simulatedIntervals: null; error: string }> {
  const {
    houseId,
    userId,
    esiid,
    startDate,
    endDate,
    timezone,
    travelRanges,
    buildInputs,
    actualIntervals: preloadedIntervals,
    selectedDateKeysLocal,
  } = args;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return { simulatedIntervals: null, error: "Invalid startDate or endDate (expect YYYY-MM-DD)." };
  }
  const selectedValid = new Set<string>(
    Array.from(selectedDateKeysLocal ?? [])
      .map((dk) => String(dk ?? "").slice(0, 10))
      .filter((dk) => /^\d{4}-\d{2}-\d{2}$/.test(dk))
  );
  if (selectedValid.size === 0) {
    return {
      simulatedIntervals: [],
      simulatedDayResults: [],
      pastDayCounts: {},
      weatherSourceSummary: "none",
      weatherKindUsed: undefined,
    };
  }
  try {
    const actualIntervals =
      preloadedIntervals ??
      (await getActualIntervalsForRange({ houseId, esiid, startDate, endDate })).map((p) => ({
        timestamp: p.timestamp,
        kwh: p.kwh,
      }));
    const canonicalDayStartsMs = enumerateDayStartsMsForWindow(startDate, endDate);
    const canonicalDateKeys = dateKeysFromCanonicalDayStarts(canonicalDayStartsMs);
    const excludedDateKeys = boundDateKeysToCoverageWindow(
      travelRangesToExcludeDateKeys(travelRanges),
      { startDate, endDate }
    );
    const { actualWxByDateKey, normalWxByDateKey, provenance } = await loadWeatherForPastWindow({
      houseId,
      startDate,
      endDate,
      canonicalDateKeys,
    });
    if (provenance.weatherSourceSummary !== "actual_only") {
      return {
        simulatedIntervals: null,
        error: `actual_weather_required:${provenance.weatherSourceSummary}`,
      };
    }
    const [homeRecForPast, applianceRecForPast, shapeProfileRow] = await Promise.all([
      getHomeProfileSimulatedByUserHouse({ userId, houseId }),
      getApplianceProfileSimulatedByUserHouse({ userId, houseId }),
      getLatestUsageShapeProfile(houseId).catch(() => null),
    ]);
    const homeProfileForPast = homeRecForPast ? { ...homeRecForPast } : (buildInputs as any)?.snapshots?.homeProfile ?? null;
    const applianceProfileForPast =
      normalizeStoredApplianceProfile((applianceRecForPast?.appliancesJson as any) ?? null)?.fuelConfiguration
        ? normalizeStoredApplianceProfile((applianceRecForPast?.appliancesJson as any) ?? null)
        : normalizeStoredApplianceProfile((buildInputs as any)?.snapshots?.applianceProfile ?? null);
    const canonicalMonths = ((buildInputs as any).canonicalMonths ?? []) as string[];
    let usageShapeProfileSnap: { weekdayAvgByMonthKey: Record<string, number>; weekendAvgByMonthKey: Record<string, number> } | null = null;
    let inlineDerivedShapeProfile:
      | ReturnType<typeof deriveUsageShapeProfile>
      | null = null;
    let reasonNotUsed: string | null = null;
    if (!shapeProfileRow) {
      reasonNotUsed = "profile_not_found";
    } else if (!timezone) {
      reasonNotUsed = "missing_timezone";
    } else if (!shapeProfileRow.shapeByMonth96) {
      reasonNotUsed = "no_shapeByMonth96";
    } else if (shapeProfileRow.avgKwhPerDayWeekdayByMonth == null || shapeProfileRow.avgKwhPerDayWeekendByMonth == null) {
      reasonNotUsed = "missing_arrays";
    }
    if (timezone && shapeProfileRow?.shapeByMonth96 && shapeProfileRow?.avgKwhPerDayWeekdayByMonth != null && shapeProfileRow?.avgKwhPerDayWeekendByMonth != null) {
      const profileMonthKeys = parseMonthKeysFromShapeByMonth(shapeProfileRow.shapeByMonth96);
      const snap = buildUsageShapeProfileSnapFromMonthContract({
        monthKeys: profileMonthKeys,
        weekdayVals: shapeProfileRow.avgKwhPerDayWeekdayByMonth,
        weekendVals: shapeProfileRow.avgKwhPerDayWeekendByMonth,
      });
      if (snap) {
        usageShapeProfileSnap = snap;
        reasonNotUsed = null;
      } else {
        reasonNotUsed = reasonNotUsed ?? "no_positive_values";
      }
    }
    if (!usageShapeProfileSnap && timezone && actualIntervals.length > 0) {
      try {
        inlineDerivedShapeProfile = deriveUsageShapeProfile(
          actualIntervals.map((r) => ({
            tsUtc: String(r.timestamp ?? ""),
            kwh: Number(r.kwh) || 0,
          })),
          timezone,
          `${startDate}T00:00:00.000Z`,
          `${endDate}T23:59:59.999Z`
        );
        const inlineMonthKeys = parseMonthKeysFromShapeByMonth(inlineDerivedShapeProfile.shapeByMonth96);
        const inlineSnap = buildUsageShapeProfileSnapFromMonthContract({
          monthKeys: inlineMonthKeys,
          weekdayVals: inlineDerivedShapeProfile.avgKwhPerDayWeekdayByMonth,
          weekendVals: inlineDerivedShapeProfile.avgKwhPerDayWeekendByMonth,
          weekdayByMonthKeyVals: inlineDerivedShapeProfile.avgKwhPerDayWeekdayByMonthKey,
          weekendByMonthKeyVals: inlineDerivedShapeProfile.avgKwhPerDayWeekendByMonthKey,
        });
        if (inlineSnap) {
          usageShapeProfileSnap = inlineSnap;
          reasonNotUsed = null;
        } else {
          reasonNotUsed = reasonNotUsed ?? "inline_profile_no_positive_values";
        }
      } catch {
        reasonNotUsed = reasonNotUsed ?? "inline_profile_derive_failed";
      }
    }
    if (!usageShapeProfileSnap) {
      return {
        simulatedIntervals: null,
        error: `usage_shape_profile_required:${reasonNotUsed ?? "missing"}`,
      };
    }
    const pastDayCounts: { totalDays?: number; excludedDays?: number; leadingMissingDays?: number; simulatedDays?: number } = {};
    const { intervals: simulatedIntervalsRaw, dayResults } = buildPastSimulatedBaselineV1({
      actualIntervals,
      canonicalDayStartsMs,
      excludedDateKeys,
      dateKeyFromTimestamp,
      getDayGridTimestamps,
      homeProfile: homeProfileForPast,
      applianceProfile: applianceProfileForPast,
      usageShapeProfile: usageShapeProfileSnap ?? undefined,
      timezoneForProfile: timezone ?? undefined,
      actualWxByDateKey,
      _normalWxByDateKey: normalWxByDateKey,
      collectSimulatedDayResults: true,
      forceSimulateDateKeys: selectedValid,
      emitAllIntervals: false,
      debug: { out: pastDayCounts as any },
    });
    const selectedResults = dayResults.filter((r) => selectedValid.has(String(r.localDate ?? "").slice(0, 10)));
    const selectedIntervals = simulatedIntervalsRaw.filter((row) =>
      selectedValid.has(dateKeyFromTimestamp(String(row.timestamp ?? "")))
    );
    return {
      simulatedIntervals: selectedIntervals,
      simulatedDayResults: selectedResults,
      pastDayCounts,
      weatherSourceSummary: provenance.weatherSourceSummary,
      weatherKindUsed: provenance.weatherKindUsed,
    };
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    console.warn("[simulatePastSelectedDaysShared] failed", { houseId, err: e });
    return { simulatedIntervals: null, error: err.message };
  }
}