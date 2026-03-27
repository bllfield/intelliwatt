/**
 * Shared Past simulation entrypoint.
 * Single internal entrypoint for user-facing Past (cold build + recalc) and GapFill Lab production path.
 * Owns: canonical window, weather loading with provenance, reference-day derivation, curve and dataset build.
 */

import { prisma } from "@/lib/db";
import { dateKeyInTimezone } from "@/lib/admin/gapfillLab";
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
import { buildMonthKeyedDailyAverages } from "@/modules/usageShapeProfile/derive";
import { computeUsageShapeProfileSimIdentityHash, getLatestUsageShapeProfile } from "@/modules/usageShapeProfile/repo";
import { ensureUsageShapeProfileForUserHouse } from "@/modules/usageShapeProfile/autoBuild";
import { PAST_ENGINE_VERSION } from "@/modules/usageSimulator/pastCache";
import { resolveCanonicalUsage365CoverageWindow } from "@/modules/usageSimulator/metadataWindow";
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

function simulatedDayResultIntersectsLocalDateKeys(
  result: SimulatedDayResult,
  dateKeysLocal: Set<string>,
  timezone: string
): boolean {
  if (dateKeysLocal.size === 0) return false;
  const intervals = Array.isArray(result?.intervals) ? result.intervals : [];
  return intervals.some((interval) => dateKeysLocal.has(dateKeyInTimezone(String(interval?.timestamp ?? ""), timezone)));
}

function round2CanonicalSimDayTotal(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Sum simulator-owned interval kWh for one local calendar day (timezone-local date key). */
function sumSimulatedResultIntervalsForLocalDate(
  intervals: Array<{ timestamp?: string; kwh?: unknown }> | undefined,
  localDateKey: string,
  timezone: string
): number | null {
  if (!Array.isArray(intervals) || intervals.length === 0) return null;
  let sum = 0;
  let any = false;
  for (const iv of intervals) {
    if (dateKeyInTimezone(String(iv?.timestamp ?? ""), timezone) !== localDateKey) continue;
    sum += Number(iv?.kwh) || 0;
    any = true;
  }
  return any ? round2CanonicalSimDayTotal(sum) : null;
}

/**
 * `dataset.meta.canonicalArtifactSimulatedDayTotalsByDate` keys daily rows by the same date keys as
 * `simulatedDayResult.localDate` (UTC grid anchors). Selected GapFill scored dates use local calendar
 * keys; interval energy can fall on a different local day than `localDate`, so meta can omit a
 * selected local date even when simulator-owned intervals exist. Fill only those gaps from the
 * owning SimulatedDayResult (same authority as meta), never from unrelated passthrough.
 */
/** @internal Exported for unit tests — selected-days canonical backfill from simulator-owned results. */
export function fillMissingCanonicalSelectedDayTotalsFromSimulatedResults(args: {
  selectedValid: Set<string>;
  canonicalFromMeta: Record<string, number>;
  simulatedDayResults: SimulatedDayResult[] | undefined;
  timezone: string;
}): Record<string, number> {
  const out: Record<string, number> = { ...args.canonicalFromMeta };
  for (const dk of Array.from(args.selectedValid)) {
    const raw = out[dk];
    if (raw !== undefined && Number.isFinite(Number(raw))) continue;
    const ownerResult = (args.simulatedDayResults ?? []).find((r) =>
      simulatedDayResultIntersectsLocalDateKeys(r, new Set([dk]), args.timezone)
    );
    if (!ownerResult) continue;
    const fromIntervals = sumSimulatedResultIntervalsForLocalDate(ownerResult.intervals, dk, args.timezone);
    if (fromIntervals != null) {
      out[dk] = fromIntervals;
      continue;
    }
    const ld = String(ownerResult.localDate ?? "").slice(0, 10);
    if (ld === dk) {
      const kwh = Number(ownerResult.finalDayKwh ?? ownerResult.intervalSumKwh ?? ownerResult.displayDayKwh);
      if (Number.isFinite(kwh)) out[dk] = round2CanonicalSimDayTotal(kwh);
    }
  }
  return out;
}

/**
 * Interval timestamps → local date keys are authoritative for membership.
 * A single simulated day may span two local calendar days (e.g. 15‑minute grid around local midnight);
 * interval-derived keys may then be a set of size 2. That is valid as long as `localDate` is one of
 * those keys. Violation: `localDate` is missing from interval-derived keys, invalid, or intervals
 * produce no valid keys.
 */
export type SimulatedDayLocalDateIntervalViolation = {
  localDate: string;
  intervalDerivedDateKeys: string[];
};

export function collectSimulatedDayLocalDateIntervalConflicts(
  results: SimulatedDayResult[] | undefined,
  timezone: string
): SimulatedDayLocalDateIntervalViolation[] {
  const out: SimulatedDayLocalDateIntervalViolation[] = [];
  const tz = String(timezone ?? "").trim();
  if (!tz) return out;
  for (const r of results ?? []) {
    const ivs = Array.isArray(r?.intervals) ? r.intervals : [];
    if (ivs.length === 0) continue;
    const keys = new Set<string>();
    for (const iv of ivs) {
      const dk = dateKeyInTimezone(String(iv?.timestamp ?? ""), tz);
      if (/^\d{4}-\d{2}-\d{2}$/.test(dk)) keys.add(dk);
    }
    const ld = String(r?.localDate ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ld)) {
      out.push({ localDate: ld || "(invalid)", intervalDerivedDateKeys: Array.from(keys).sort() });
      continue;
    }
    if (keys.size === 0) {
      out.push({ localDate: ld, intervalDerivedDateKeys: [] });
      continue;
    }
    if (!keys.has(ld)) {
      out.push({ localDate: ld, intervalDerivedDateKeys: Array.from(keys).sort() });
    }
  }
  return out;
}

function summarizePastWindowWeatherProvenance(args: {
  actualWxByDateKey: Awaited<ReturnType<typeof getHouseWeatherDays>>;
  weatherFallbackReason: WeatherFallbackReason;
}): WeatherProvenance {
  const wxEntries = Array.from(args.actualWxByDateKey.entries());
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
  return {
    weatherKindUsed,
    weatherSourceSummary,
    weatherFallbackReason: args.weatherFallbackReason,
    weatherProviderName: weatherActualRowCount > 0 ? "OPEN_METEO" : "STUB",
    weatherCoverageStart: dateKeysSorted[0] ?? null,
    weatherCoverageEnd: dateKeysSorted[dateKeysSorted.length - 1] ?? null,
    weatherStubRowCount,
    weatherActualRowCount,
  };
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
  const [actualWxByDateKey, normalWxByDateKey] = await Promise.all([
    getHouseWeatherDays({ houseId, dateKeys: canonicalDateKeys, kind: "ACTUAL_LAST_YEAR" }),
    getHouseWeatherDays({ houseId, dateKeys: canonicalDateKeys, kind: "NORMAL_AVG" }),
  ]);
  const missingOrStubWxKeys = canonicalDateKeys.filter((dk) => {
    const row = actualWxByDateKey.get(dk);
    if (!row) return true;
    return String(row?.source ?? "").trim() === WEATHER_STUB_SOURCE;
  });
  if (missingOrStubWxKeys.length === 0) {
    return {
      actualWxByDateKey,
      normalWxByDateKey,
      provenance: summarizePastWindowWeatherProvenance({
        actualWxByDateKey,
        weatherFallbackReason: null,
      }),
    };
  }

  const house = await (prisma as any).houseAddress
    .findUnique({ where: { id: houseId }, select: { lat: true, lng: true } })
    .catch(() => null);
  const lat = house?.lat != null && Number.isFinite(house.lat) ? house.lat : null;
  const lon = house?.lng != null && Number.isFinite(house.lng) ? house.lng : null;

  if (lat != null && lon != null) {
    const backfillResult = await ensureHouseWeatherBackfill({ houseId, startDate, endDate });
    const missingWxKeys = canonicalDateKeys.filter((dk) => !actualWxByDateKey.has(dk));
    if (missingWxKeys.length > 0) {
      await ensureHouseWeatherStubbed({ houseId, dateKeys: missingWxKeys });
    }
    const [actualWx2, normalWx2] = await Promise.all([
      getHouseWeatherDays({ houseId, dateKeys: canonicalDateKeys, kind: "ACTUAL_LAST_YEAR" }),
      getHouseWeatherDays({ houseId, dateKeys: canonicalDateKeys, kind: "NORMAL_AVG" }),
    ]);
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
      provenance: summarizePastWindowWeatherProvenance({
        actualWxByDateKey: actualWx2,
        weatherFallbackReason,
      }),
    };
  }

  await ensureHouseWeatherStubbed({ houseId, dateKeys: canonicalDateKeys });
  const [actualWx3, normalWx3] = await Promise.all([
    getHouseWeatherDays({ houseId, dateKeys: canonicalDateKeys, kind: "ACTUAL_LAST_YEAR" }),
    getHouseWeatherDays({ houseId, dateKeys: canonicalDateKeys, kind: "NORMAL_AVG" }),
  ]);
  return {
    actualWxByDateKey: actualWx3,
    normalWxByDateKey: normalWx3,
    provenance: summarizePastWindowWeatherProvenance({
      actualWxByDateKey: actualWx3,
      weatherFallbackReason: "missing_lat_lng",
    }),
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
  /** Optional local dates that should be simulated by the shared path before downstream slicing. */
  forceSimulateDateKeysLocal?: Set<string>;
  /**
   * Gap-Fill scored test days: local dates whose **stitched compare output** must be modeled (not meter passthrough)
   * while **actual** intervals for those days remain in the reference-day pool. UTC mapping matches `forceSimulateDateKeysLocal`.
   * Must not overlap `forceSimulateDateKeysLocal` (forced days are excluded from the reference pool).
   */
  forceModeledOutputKeepReferencePoolDateKeysLocal?: Set<string>;
  /** When false, omit passthrough actual intervals for non-simulated days. */
  emitAllIntervals?: boolean;
  /** Optional local dates whose simulated-day payloads should be retained for downstream consumers. */
  retainSimulatedDayResultDateKeysLocal?: Set<string>;
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
  canonicalSimulatedDayTotalsByDate?: Record<string, number>;
  pastDayCounts: { totalDays?: number; excludedDays?: number; leadingMissingDays?: number; simulatedDays?: number };
  actualWxByDateKey?: Awaited<ReturnType<typeof getHouseWeatherDays>>;
  weatherSourceSummary: WeatherProvenance["weatherSourceSummary"];
  weatherKindUsed: string | undefined;
  usageShapeProfileDiag?: SharedSimUsageShapeProfileDiag;
  profileAutoBuilt?: boolean;
  gapfillForceModeledKeepRefLocalDateKeys?: string[];
  gapfillForceModeledKeepRefUtcKeyCount?: number;
};

/** Hard failure from simulatePastSelectedDaysShared (no silent recovery). */
export type SimulatePastSelectedDaysSharedFailure = {
  simulatedIntervals: null;
  error: string;
  invariantViolations?: SimulatedDayLocalDateIntervalViolation[];
};

export type SimulatePastFullWindowSharedResult = {
  simulatedIntervals: Array<{ timestamp: string; kwh: number }>;
  simulatedDayResults?: SimulatedDayResult[];
  canonicalSimulatedDayTotalsByDate?: Record<string, number>;
  pastDayCounts: { totalDays?: number; excludedDays?: number; leadingMissingDays?: number; simulatedDays?: number };
  actualWxByDateKey: Awaited<ReturnType<typeof getHouseWeatherDays>>;
  weatherSourceSummary: WeatherProvenance["weatherSourceSummary"];
  weatherKindUsed: string | undefined;
  weatherProviderName: string | null;
  weatherFallbackReason: string | null;
  usageShapeProfileDiag?: SharedSimUsageShapeProfileDiag;
  profileAutoBuilt?: boolean;
  /** Echoed from shared dataset meta when Gap-Fill keep-ref modeled scoring was requested. */
  gapfillForceModeledKeepRefLocalDateKeys?: string[];
  gapfillForceModeledKeepRefUtcKeyCount?: number;
};

/** Hard failure from simulatePastFullWindowShared (no silent recovery). */
export type SimulatePastFullWindowSharedFailure = {
  simulatedIntervals: null;
  error: string;
  invariantViolations?: SimulatedDayLocalDateIntervalViolation[];
};

export type UsageShapeProfileIdentity = {
  usageShapeProfileId: string | null;
  usageShapeProfileVersion: string | null;
  usageShapeProfileDerivedAt: string | null;
  usageShapeProfileSimHash: string | null;
};

type UsageShapeProfileSnapForSimulation = {
  weekdayAvgByMonthKey: Record<string, number>;
  weekendAvgByMonthKey: Record<string, number>;
};

export type SharedSimUsageShapeProfileDiag = {
  found: boolean;
  id: string | null;
  version: string | null;
  derivedAt: string | null;
  windowStartUtc: string | null;
  windowEndUtc: string | null;
  profileMonthKeys: string[];
  weekdayAvgLen: number | null;
  weekendAvgLen: number | null;
  canonicalMonths: string[];
  canonicalMonthsLen: number;
  inlineDerivedFromActual: boolean;
  reasonNotUsed: string | null;
  ensuredInFlow: boolean;
  ensureAttempted: boolean;
  ensuredReason: string | null;
  ensureFailedReason: string | null;
  ensuredProfileId: string | null;
  canonicalCoverageStartDate: string;
  canonicalCoverageEndDate: string;
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

function usageShapeProfileWindowDateKey(value: unknown): string | null {
  const s = String(value ?? "").trim();
  if (!s) return null;
  const dateKey = s.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(dateKey) ? dateKey : null;
}

function usageShapeProfileContractFailure(args: {
  row: any;
  timezone: string | null;
  canonicalCoverage: { startDate: string; endDate: string };
}): string | null {
  const { row, timezone, canonicalCoverage } = args;
  if (!row) return "profile_not_found";
  if (!timezone) return "missing_timezone";
  const version = String(row?.version ?? "").trim();
  if (version && version !== "v1") return "version_mismatch";
  if (!row?.shapeByMonth96) return "no_shapeByMonth96";
  if (row?.avgKwhPerDayWeekdayByMonth == null || row?.avgKwhPerDayWeekendByMonth == null) return "missing_arrays";
  const windowStartDate = usageShapeProfileWindowDateKey(row?.windowStartUtc);
  const windowEndDate = usageShapeProfileWindowDateKey(row?.windowEndUtc);
  if (windowStartDate !== canonicalCoverage.startDate || windowEndDate !== canonicalCoverage.endDate) {
    return "coverage_window_mismatch";
  }
  const profileMonthKeys = parseMonthKeysFromShapeByMonth(row.shapeByMonth96);
  const snap = buildUsageShapeProfileSnapFromMonthContract({
    monthKeys: profileMonthKeys,
    weekdayVals: row.avgKwhPerDayWeekdayByMonth,
    weekendVals: row.avgKwhPerDayWeekendByMonth,
  });
  if (!snap) return "no_positive_values";
  return null;
}

function usageShapeProfileSnapFromRow(row: any): UsageShapeProfileSnapForSimulation | null {
  if (!row?.shapeByMonth96) return null;
  const profileMonthKeys = parseMonthKeysFromShapeByMonth(row.shapeByMonth96);
  return buildUsageShapeProfileSnapFromMonthContract({
    monthKeys: profileMonthKeys,
    weekdayVals: row.avgKwhPerDayWeekdayByMonth,
    weekendVals: row.avgKwhPerDayWeekendByMonth,
  });
}

export async function ensureUsageShapeProfileForSharedSimulation(args: {
  userId: string;
  houseId: string;
  timezone: string | undefined;
  canonicalMonths?: string[] | null;
}): Promise<{
  usageShapeProfileSnap: UsageShapeProfileSnapForSimulation | null;
  usageShapeProfileDiag: SharedSimUsageShapeProfileDiag;
  profileAutoBuilt: boolean;
  error: string | null;
}> {
  const canonicalCoverage = resolveCanonicalUsage365CoverageWindow();
  const timezoneResolved = String(args.timezone ?? "").trim() || null;
  let shapeProfileRow = await getLatestUsageShapeProfile(args.houseId).catch(() => null);
  let usageShapeProfileSnap = usageShapeProfileSnapFromRow(shapeProfileRow);
  let contractFailure = usageShapeProfileContractFailure({
    row: shapeProfileRow,
    timezone: timezoneResolved,
    canonicalCoverage,
  });
  let profileAutoBuilt = false;
  let ensureAttempted = false;
  let ensuredReason: string | null = null;
  let ensureFailedReason: string | null = null;
  let ensuredProfileId: string | null = null;

  if (contractFailure && timezoneResolved) {
    ensureAttempted = true;
    ensuredReason = contractFailure;
    const ensured = await ensureUsageShapeProfileForUserHouse({
      userId: args.userId,
      houseId: args.houseId,
      timezone: timezoneResolved,
    });
    if (ensured.ok) {
      profileAutoBuilt = true;
      ensuredProfileId = String(ensured.profileId ?? "");
      shapeProfileRow = await getLatestUsageShapeProfile(args.houseId).catch(() => null);
      usageShapeProfileSnap = usageShapeProfileSnapFromRow(shapeProfileRow);
      contractFailure = usageShapeProfileContractFailure({
        row: shapeProfileRow,
        timezone: timezoneResolved,
        canonicalCoverage,
      });
      if (contractFailure) ensureFailedReason = contractFailure;
    } else {
      ensureFailedReason = ensured.reason;
      usageShapeProfileSnap = null;
    }
  }

  const reasonNotUsed = usageShapeProfileSnap ? null : ensureFailedReason ?? contractFailure ?? "missing";
  return {
    usageShapeProfileSnap,
    usageShapeProfileDiag: {
      found: !!shapeProfileRow,
      id: shapeProfileRow?.id != null ? String(shapeProfileRow.id) : null,
      version: shapeProfileRow?.version != null ? String(shapeProfileRow.version) : null,
      derivedAt: shapeProfileRow?.derivedAt != null ? String(shapeProfileRow.derivedAt) : null,
      windowStartUtc: shapeProfileRow?.windowStartUtc != null ? String(shapeProfileRow.windowStartUtc) : null,
      windowEndUtc: shapeProfileRow?.windowEndUtc != null ? String(shapeProfileRow.windowEndUtc) : null,
      profileMonthKeys: shapeProfileRow?.shapeByMonth96
        ? Object.keys((shapeProfileRow.shapeByMonth96 as Record<string, unknown>) ?? {})
            .filter((k) => /^\d{4}-\d{2}$/.test(k))
            .sort()
        : [],
      weekdayAvgLen: Array.isArray(shapeProfileRow?.avgKwhPerDayWeekdayByMonth)
        ? shapeProfileRow.avgKwhPerDayWeekdayByMonth.length
        : null,
      weekendAvgLen: Array.isArray(shapeProfileRow?.avgKwhPerDayWeekendByMonth)
        ? shapeProfileRow.avgKwhPerDayWeekendByMonth.length
        : null,
      canonicalMonths: Array.isArray(args.canonicalMonths) ? args.canonicalMonths.map((m) => String(m)) : [],
      canonicalMonthsLen: Array.isArray(args.canonicalMonths) ? args.canonicalMonths.length : 0,
      inlineDerivedFromActual: false,
      reasonNotUsed,
      ensuredInFlow: profileAutoBuilt,
      ensureAttempted,
      ensuredReason: profileAutoBuilt ? ensuredReason : null,
      ensureFailedReason,
      ensuredProfileId,
      canonicalCoverageStartDate: canonicalCoverage.startDate,
      canonicalCoverageEndDate: canonicalCoverage.endDate,
    },
    profileAutoBuilt,
    error: reasonNotUsed ? `usage_shape_profile_required:${reasonNotUsed}` : null,
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
    forceSimulateDateKeysLocal,
    forceModeledOutputKeepReferencePoolDateKeysLocal,
    emitAllIntervals = true,
    retainSimulatedDayResultDateKeysLocal,
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
    const forcedSimulateDateKeysLocal = new Set<string>(
      Array.from(forceSimulateDateKeysLocal ?? [])
        .map((dk) => String(dk ?? "").slice(0, 10))
        .filter((dk) => /^\d{4}-\d{2}-\d{2}$/.test(dk))
    );
    const retainedSimulatedDayResultDateKeysLocal = new Set<string>(
      Array.from(retainSimulatedDayResultDateKeysLocal ?? [])
        .map((dk) => String(dk ?? "").slice(0, 10))
        .filter((dk) => /^\d{4}-\d{2}-\d{2}$/.test(dk))
    );
    const forceModeledOutputKeepReferencePoolDateKeysLocalSet = new Set<string>(
      Array.from(forceModeledOutputKeepReferencePoolDateKeysLocal ?? [])
        .map((dk) => String(dk ?? "").slice(0, 10))
        .filter((dk) => /^\d{4}-\d{2}-\d{2}$/.test(dk))
    );
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

    const [homeRecForPast, applianceRecForPast] = await Promise.all([
      getHomeProfileSimulatedByUserHouse({ userId, houseId }),
      getApplianceProfileSimulatedByUserHouse({ userId, houseId }),
    ]);
    const homeProfileForPast = homeRecForPast ? { ...homeRecForPast } : (buildInputs as any)?.snapshots?.homeProfile ?? null;
    const applianceProfileForPast =
      normalizeStoredApplianceProfile((applianceRecForPast?.appliancesJson as any) ?? null)?.fuelConfiguration
        ? normalizeStoredApplianceProfile((applianceRecForPast?.appliancesJson as any) ?? null)
        : normalizeStoredApplianceProfile((buildInputs as any)?.snapshots?.applianceProfile ?? null);

    const canonicalMonths = ((buildInputs as any).canonicalMonths ?? []) as string[];
    const ensuredUsageShape = await ensureUsageShapeProfileForSharedSimulation({
      userId,
      houseId,
      timezone,
      canonicalMonths,
    });
    const usageShapeProfileSnap = ensuredUsageShape.usageShapeProfileSnap;
    if (!usageShapeProfileSnap) {
      return {
        dataset: null,
        error: ensuredUsageShape.error ?? "usage_shape_profile_required:missing",
      };
    }
    const usageShapeProfileDiag = ensuredUsageShape.usageShapeProfileDiag;
    const timezoneResolved = String(timezone ?? "").trim();
    const forcedUtcDateKeys = new Set<string>();
    const retainedResultUtcDateKeys = new Set<string>();
    const keepRefUtcDateKeys = new Set<string>();
    const needsUtcKeyWalk =
      Boolean(timezoneResolved) &&
      (forcedSimulateDateKeysLocal.size > 0 ||
        retainedSimulatedDayResultDateKeysLocal.size > 0 ||
        forceModeledOutputKeepReferencePoolDateKeysLocalSet.size > 0);
    if (needsUtcKeyWalk && timezoneResolved) {
      for (const dayStartMs of canonicalDayStartsMs) {
        const gridTs = getDayGridTimestamps(dayStartMs);
        if (!gridTs.length) continue;
        const utcDateKey = dateKeyFromTimestamp(gridTs[0]);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(utcDateKey)) continue;
        const intersectsForcedLocalDay = gridTs.some((ts) =>
          forcedSimulateDateKeysLocal.has(dateKeyInTimezone(ts, timezoneResolved))
        );
        if (intersectsForcedLocalDay) forcedUtcDateKeys.add(utcDateKey);
        const intersectsRetainedLocalDay = gridTs.some((ts) =>
          retainedSimulatedDayResultDateKeysLocal.has(dateKeyInTimezone(ts, timezoneResolved))
        );
        if (intersectsRetainedLocalDay) retainedResultUtcDateKeys.add(utcDateKey);
        const intersectsKeepRefLocalDay = gridTs.some((ts) =>
          forceModeledOutputKeepReferencePoolDateKeysLocalSet.has(dateKeyInTimezone(ts, timezoneResolved))
        );
        if (intersectsKeepRefLocalDay) keepRefUtcDateKeys.add(utcDateKey);
      }
    } else if (
      !timezoneResolved &&
      (forcedSimulateDateKeysLocal.size > 0 ||
        retainedSimulatedDayResultDateKeysLocal.size > 0 ||
        forceModeledOutputKeepReferencePoolDateKeysLocalSet.size > 0)
    ) {
      // No IANA timezone: local date keys are treated as canonical UTC calendar keys (same as retained fallback).
      for (const utcDateKey of canonicalDateKeys) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(utcDateKey)) continue;
        if (forcedSimulateDateKeysLocal.has(utcDateKey)) forcedUtcDateKeys.add(utcDateKey);
        if (retainedSimulatedDayResultDateKeysLocal.has(utcDateKey)) retainedResultUtcDateKeys.add(utcDateKey);
        if (forceModeledOutputKeepReferencePoolDateKeysLocalSet.has(utcDateKey)) keepRefUtcDateKeys.add(utcDateKey);
      }
    }
    for (const utcKey of Array.from(keepRefUtcDateKeys)) {
      if (forcedUtcDateKeys.has(utcKey)) keepRefUtcDateKeys.delete(utcKey);
    }

    // In serverless paths, retaining full per-day simulated diagnostics can trigger
    // memory pressure for large windows. Only collect when explicitly requested.
    const collectSimulatedDayResultsForDiagnostics = includeSimulatedDayResults;
    const collectSimulatedDayResultsDateKeys =
      retainedResultUtcDateKeys.size > 0 ? retainedResultUtcDateKeys : undefined;
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
      collectSimulatedDayResultsDateKeys,
      forceSimulateDateKeys: forcedUtcDateKeys.size > 0 ? forcedUtcDateKeys : undefined,
      forceModeledOutputKeepReferencePoolDateKeys:
        keepRefUtcDateKeys.size > 0 ? keepRefUtcDateKeys : undefined,
      emitAllIntervals,
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
        simulatedDayResults: dayResults,
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
        ...(dataset.meta as Record<string, unknown>),
        buildPathKind,
        sourceOfDaySimulationCore: SOURCE_OF_DAY_SIMULATION_CORE,
        derivationVersion: PAST_ENGINE_VERSION,
        simVersion: PAST_ENGINE_VERSION,
        weekdayWeekendSplitUsed: !!usageShapeProfileSnap,
        dayTotalSource: usageShapeProfileSnap ? "usageShapeProfile_avgKwhPerDayByMonth" : "fallback_month_avg",
        dayTotalShapingPath: "shared_daytype_neighbor_weather_shaping",
        curveShapingVersion: "shared_curve_v2",
        usageShapeProfileDiag,
        profileAutoBuilt: ensuredUsageShape.profileAutoBuilt,
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
        gapfillForceModeledKeepRefLocalDateKeys:
          forceModeledOutputKeepReferencePoolDateKeysLocalSet.size > 0
            ? Array.from(forceModeledOutputKeepReferencePoolDateKeysLocalSet).sort()
            : undefined,
        gapfillForceModeledKeepRefUtcKeyCount: keepRefUtcDateKeys.size,
      } as unknown as typeof dataset.meta;
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

export async function simulatePastFullWindowShared(
  args: SimulatePastUsageDatasetArgs
): Promise<SimulatePastFullWindowSharedResult | SimulatePastFullWindowSharedFailure> {
  const {
    startDate,
    endDate,
    includeSimulatedDayResults = false,
  } = args;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return { simulatedIntervals: null, error: "Invalid startDate or endDate (expect YYYY-MM-DD)." };
  }
  try {
    const sharedResult = await simulatePastUsageDataset({
      ...args,
      includeSimulatedDayResults,
    });
    if (sharedResult.dataset === null) {
      return {
        simulatedIntervals: null,
        error: sharedResult.error ?? "simulatePastUsageDataset failed",
      };
    }
    const timezoneResolved = String(args.timezone ?? "").trim();
    if (
      includeSimulatedDayResults &&
      Array.isArray(sharedResult.simulatedDayResults) &&
      sharedResult.simulatedDayResults.length > 0 &&
      timezoneResolved
    ) {
      const localDateIntervalConflicts = collectSimulatedDayLocalDateIntervalConflicts(
        sharedResult.simulatedDayResults,
        timezoneResolved
      );
      if (localDateIntervalConflicts.length > 0) {
        return {
          simulatedIntervals: null,
          error: "simulated_day_local_date_interval_invariant_violation",
          invariantViolations: localDateIntervalConflicts,
        };
      }
    }
    const simulatedIntervals = Array.isArray((sharedResult.dataset as any)?.series?.intervals15)
      ? (((sharedResult.dataset as any).series.intervals15 as Array<{ timestamp?: string; kwh?: number }>).map((row) => ({
          timestamp: String(row?.timestamp ?? ""),
          kwh: Number(row?.kwh) || 0,
        })))
      : [];
    const metaAny = (sharedResult.meta ?? {}) as Record<string, unknown>;
    return {
      simulatedIntervals,
      simulatedDayResults: sharedResult.simulatedDayResults,
      canonicalSimulatedDayTotalsByDate:
        ((sharedResult.dataset as any)?.meta?.canonicalArtifactSimulatedDayTotalsByDate as
          | Record<string, number>
          | undefined) ??
        ((sharedResult.dataset as any)?.canonicalArtifactSimulatedDayTotalsByDate as
          | Record<string, number>
          | undefined),
      pastDayCounts: sharedResult.pastDayCounts,
      actualWxByDateKey: sharedResult.actualWxByDateKey ?? new Map(),
      weatherSourceSummary: String((sharedResult.meta as any)?.weatherSourceSummary ?? "unknown") as WeatherProvenance["weatherSourceSummary"],
      weatherKindUsed: (sharedResult.meta as any)?.weatherKindUsed as string | undefined,
      weatherProviderName: String((sharedResult.meta as any)?.weatherProviderName ?? "") || null,
      weatherFallbackReason: String((sharedResult.meta as any)?.weatherFallbackReason ?? "") || null,
      usageShapeProfileDiag: (sharedResult.meta as any)?.usageShapeProfileDiag as SharedSimUsageShapeProfileDiag | undefined,
      profileAutoBuilt: (sharedResult.meta as any)?.profileAutoBuilt === true,
      gapfillForceModeledKeepRefLocalDateKeys: Array.isArray(metaAny.gapfillForceModeledKeepRefLocalDateKeys)
        ? (metaAny.gapfillForceModeledKeepRefLocalDateKeys as string[])
        : undefined,
      gapfillForceModeledKeepRefUtcKeyCount:
        typeof metaAny.gapfillForceModeledKeepRefUtcKeyCount === "number"
          ? (metaAny.gapfillForceModeledKeepRefUtcKeyCount as number)
          : undefined,
    };
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    console.warn("[simulatePastFullWindowShared] failed", { houseId: args.houseId, err: e });
    return { simulatedIntervals: null, error: err.message };
  }
}

/**
 * Shared selected-day fresh execution path.
 * Uses the exact same shared full-output wrapper as full-window past simulation,
 * then slices selected local days from the canonical shared output.
 */
export async function simulatePastSelectedDaysShared(
  args: SimulatePastSelectedDaysArgs
): Promise<SimulatePastSelectedDaysResult | SimulatePastSelectedDaysSharedFailure> {
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
    retainSimulatedDayResultDateKeysLocal,
    buildPathKind,
    forceModeledOutputKeepReferencePoolDateKeysLocal,
  } = args;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return { simulatedIntervals: null, error: "Invalid startDate or endDate (expect YYYY-MM-DD)." };
  }
  const selectedValid = new Set<string>(
    Array.from(selectedDateKeysLocal ?? [])
      .map((dk) => String(dk ?? "").slice(0, 10))
      .filter((dk) => /^\d{4}-\d{2}-\d{2}$/.test(dk))
  );
  const retainedValid = new Set<string>(
    Array.from(retainSimulatedDayResultDateKeysLocal ?? [])
      .map((dk) => String(dk ?? "").slice(0, 10))
      .filter((dk) => /^\d{4}-\d{2}-\d{2}$/.test(dk))
  );
  if (selectedValid.size === 0) {
    return {
      simulatedIntervals: [],
      simulatedDayResults: [],
      canonicalSimulatedDayTotalsByDate: {},
      pastDayCounts: {},
      weatherSourceSummary: "none",
      weatherKindUsed: undefined,
    };
  }
  const timezoneResolved = String(timezone ?? "").trim();
  if (!timezoneResolved) {
    return { simulatedIntervals: null, error: "missing_timezone" };
  }
  try {
    const sharedResult = await simulatePastFullWindowShared({
      userId,
      houseId,
      esiid,
      startDate,
      endDate,
      timezone: timezoneResolved,
      travelRanges,
      buildInputs,
      buildPathKind,
      actualIntervals: preloadedIntervals,
      includeSimulatedDayResults: true,
      forceModeledOutputKeepReferencePoolDateKeysLocal,
    });
    if (sharedResult.simulatedIntervals === null) {
      return {
        simulatedIntervals: null,
        error: sharedResult.error ?? "simulatePastFullWindowShared failed",
        ...("invariantViolations" in sharedResult &&
        Array.isArray((sharedResult as SimulatePastFullWindowSharedFailure).invariantViolations)
          ? {
              invariantViolations: (sharedResult as SimulatePastFullWindowSharedFailure).invariantViolations,
            }
          : {}),
      };
    }
    const selectedIntervals = sharedResult.simulatedIntervals.filter((row) =>
      selectedValid.has(dateKeyInTimezone(String(row.timestamp ?? ""), timezoneResolved))
    );
    const selectedResults = (sharedResult.simulatedDayResults ?? []).filter((r) =>
      simulatedDayResultIntersectsLocalDateKeys(r, selectedValid, timezoneResolved)
    );
    const canonicalFromMetaFiltered = Object.fromEntries(
      Object.entries(sharedResult.canonicalSimulatedDayTotalsByDate ?? {}).filter(([dk]) =>
        selectedValid.has(String(dk).slice(0, 10))
      )
    );
    const canonicalSimulatedDayTotalsByDate = fillMissingCanonicalSelectedDayTotalsFromSimulatedResults({
      selectedValid,
      canonicalFromMeta: canonicalFromMetaFiltered,
      simulatedDayResults: sharedResult.simulatedDayResults,
      timezone: timezoneResolved,
    });
    const retainedSelectedResults =
      retainedValid.size > 0
        ? selectedResults.filter((r) => simulatedDayResultIntersectsLocalDateKeys(r, retainedValid, timezoneResolved))
        : selectedResults;
    return {
      simulatedIntervals: selectedIntervals,
      simulatedDayResults: retainedSelectedResults,
      canonicalSimulatedDayTotalsByDate,
      pastDayCounts: sharedResult.pastDayCounts,
      actualWxByDateKey: sharedResult.actualWxByDateKey,
      weatherSourceSummary: sharedResult.weatherSourceSummary,
      weatherKindUsed: sharedResult.weatherKindUsed,
      usageShapeProfileDiag: sharedResult.usageShapeProfileDiag,
      profileAutoBuilt: sharedResult.profileAutoBuilt,
      gapfillForceModeledKeepRefLocalDateKeys: sharedResult.gapfillForceModeledKeepRefLocalDateKeys,
      gapfillForceModeledKeepRefUtcKeyCount: sharedResult.gapfillForceModeledKeepRefUtcKeyCount,
    };
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    console.warn("[simulatePastSelectedDaysShared] failed", { houseId, err: e });
    return { simulatedIntervals: null, error: err.message };
  }
}