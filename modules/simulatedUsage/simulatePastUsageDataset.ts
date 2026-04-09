/**
 * Shared Past simulation entrypoint.
 * Single internal entrypoint for user-facing Past and GapFill Lab production path.
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
import {
  ensureHouseWeatherBackfill,
  ensureHouseWeatherNormalAvgBackfill,
} from "@/modules/weather/backfill";
import { WEATHER_STUB_SOURCE } from "@/modules/weather/types";
import { SOURCE_OF_DAY_SIMULATION_CORE } from "@/modules/simulatedUsage/pastDaySimulator";
import { getHomeProfileSimulatedByUserHouse } from "@/modules/homeProfile/repo";
import { getApplianceProfileSimulatedByUserHouse } from "@/modules/applianceProfile/repo";
import { normalizeStoredApplianceProfile } from "@/modules/applianceProfile/validation";
import { buildMonthKeyedDailyAverages } from "@/modules/usageShapeProfile/derive";
import { computeUsageShapeProfileSimIdentityHash, getLatestUsageShapeProfile } from "@/modules/usageShapeProfile/repo";
import { ensureUsageShapeProfileForUserHouse } from "@/modules/usageShapeProfile/autoBuild";
import { PAST_ENGINE_VERSION } from "@/modules/usageSimulator/pastCache";
import {
  resolveWeatherKindForLogicMode,
  resolveWeatherLogicModeFromBuildInputs,
  type WeatherLogicMode,
} from "@/modules/usageSimulator/pastSimWeatherPolicy";
import {
  createSimCorrelationId,
  getMemoryRssMb,
  logSimPipelineEvent,
} from "@/modules/usageSimulator/simObservability";
import { resolveCanonicalUsage365CoverageWindow } from "@/modules/usageSimulator/metadataWindow";
import {
  buildUsageShapeSnapFromMonthlyTotalsForLowData,
} from "@/modules/usageSimulator/lowDataPastSimAdapter";
import type { SimulatedCurve } from "@/modules/simulatedUsage/types";
import type {
  PastLowDataWeatherEvidenceSummary,
  SimulatedDayResult,
} from "@/modules/simulatedUsage/pastDaySimulatorTypes";
import {
  normalizePastProducerBuildPathKind,
  type PastProducerBuildPathKind,
} from "@/modules/simulatedUsage/pastProducerBuildPath";

export type BuildPathKind = PastProducerBuildPathKind;
export { normalizePastProducerBuildPathKind } from "@/modules/simulatedUsage/pastProducerBuildPath";

export type WeatherFallbackReason =
  | "missing_lat_lng"
  | "api_failure_or_no_data"
  | "partial_coverage"
  | "unknown"
  | null;

export type WeatherProvenance = {
  weatherLogicMode?: WeatherLogicMode;
  weatherKindUsed: string | undefined;
  /** When provenance is missing (e.g. cache restore from older cache), use "unknown" so UI never implies actual weather. */
  weatherSourceSummary: "stub_only" | "actual_only" | "mixed_actual_and_stub" | "none" | "unknown";
  weatherFallbackReason: WeatherFallbackReason;
  weatherProviderName: string;
  weatherFallbackUsed?: boolean;
  weatherProviderCoverage?: Array<{
    provider: string;
    source: string;
    count: number;
    coverageStart: string | null;
    coverageEnd: string | null;
  }>;
  weatherNormalsBaselineStart?: string | null;
  weatherNormalsBaselineEnd?: string | null;
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

function daysInMonthFromYearMonth(monthKey: string): number {
  const match = /^(\d{4})-(\d{2})$/.exec(String(monthKey ?? "").trim());
  if (!match) return 30;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return 30;
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function invert3x3(matrix: number[][]): number[][] | null {
  const [[a, b, c], [d, e, f], [g, h, i]] = matrix;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const D = -(b * i - c * h);
  const E = a * i - c * g;
  const F = -(a * h - b * g);
  const G = b * f - c * e;
  const H = -(a * f - c * d);
  const I = a * e - b * d;
  const det = a * A + b * B + c * C;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-9) return null;
  return [
    [A / det, D / det, G / det],
    [B / det, E / det, H / det],
    [C / det, F / det, I / det],
  ];
}

function multiplyMatrixVector(matrix: number[][], vector: number[]): number[] {
  return matrix.map((row) => row.reduce((sum, value, index) => sum + value * (vector[index] ?? 0), 0));
}

function clampNumberForEvidence(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeTravelRangeSummary(ranges: unknown): Array<{ startDate: string; endDate: string }> {
  return Array.isArray(ranges)
    ? ranges
        .map((range) => ({
          startDate: String((range as any)?.startDate ?? "").slice(0, 10),
          endDate: String((range as any)?.endDate ?? "").slice(0, 10),
        }))
        .filter((range) => /^\d{4}-\d{2}-\d{2}$/.test(range.startDate) && /^\d{4}-\d{2}-\d{2}$/.test(range.endDate))
    : [];
}

function buildManualMonthlyWeatherEvidenceSummary(args: {
  buildInputs: SimulatorBuildInputsV1;
  manualUsagePayload: unknown;
  weatherByDateKey: Awaited<ReturnType<typeof getHouseWeatherDays>>;
  homeProfile: Record<string, unknown> | null;
  applianceProfile: Record<string, unknown> | null;
}): PastLowDataWeatherEvidenceSummary | null {
  type BillPeriodWeatherEvidenceRow = {
    id: string;
    monthKey: string;
    startDate: string;
    endDate: string;
    targetKwh: number;
    avgDailyTarget: number;
    eligibleNonTravelDayCount: number;
    avgHdd: number;
    avgCdd: number;
    avgTempC: number | null;
  };
  if (args.buildInputs.mode !== "MANUAL_TOTALS") return null;
  if (String((args.manualUsagePayload as any)?.mode ?? "").trim() !== "MONTHLY") return null;
  const inputState = ((args.buildInputs as any)?.manualMonthlyInputState ?? null) as
    | { enteredMonthKeys?: string[]; missingMonthKeys?: string[] }
    | null;

  const manualBillPeriods = Array.isArray((args.buildInputs as any)?.manualBillPeriods)
    ? ((args.buildInputs as any).manualBillPeriods as Array<{
        id?: unknown;
        month?: unknown;
        startDate?: unknown;
        endDate?: unknown;
        enteredKwh?: unknown;
        eligibleForConstraint?: unknown;
        exclusionReason?: unknown;
      }>)
    : [];
  const manualBillPeriodTotalsKwhById =
    (((args.buildInputs as any)?.manualBillPeriodTotalsKwhById ?? null) as Record<string, number> | null) ?? {};
  const canonicalMonths = Array.isArray((args.buildInputs as any)?.canonicalMonths)
    ? ((args.buildInputs as any).canonicalMonths as unknown[]).map((value) => String(value))
    : [];
  const listUtcDateKeysInclusive = (startDate: string, endDate: string): string[] => {
    const out: string[] = [];
    const start = new Date(`${startDate}T00:00:00.000Z`);
    const end = new Date(`${endDate}T00:00:00.000Z`);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start > end) return out;
    for (let cursor = start.getTime(); cursor <= end.getTime(); cursor += 24 * 60 * 60 * 1000) {
      out.push(new Date(cursor).toISOString().slice(0, 10));
    }
    return out;
  };
  const travelDateKeys = new Set<string>();
  for (const range of normalizeTravelRangeSummary((args.manualUsagePayload as any)?.travelRanges)) {
    for (const dateKey of listUtcDateKeysInclusive(range.startDate, range.endDate)) {
      travelDateKeys.add(dateKey);
    }
  }
  const aggregateWeatherForDateKeys = (dateKeys: string[]) => {
    let count = 0;
    let hddSum = 0;
    let cddSum = 0;
    let tempCSum = 0;
    for (const dateKey of dateKeys) {
      const row = args.weatherByDateKey.get(dateKey);
      if (!row) continue;
      count += 1;
      hddSum += Number(row?.hdd65) || 0;
      cddSum += Number(row?.cdd65) || 0;
      tempCSum += ((Number(row?.tAvgF) || 0) - 32) * (5 / 9);
    }
    if (count <= 0) return null;
    return {
      avgHdd: hddSum / count,
      avgCdd: cddSum / count,
      avgTempC: tempCSum / count,
      dayCount: count,
    };
  };
  const monthWeatherAggregateByMonth = new Map<
    string,
    { avgHdd: number; avgCdd: number; avgTempC: number | null; dayCount: number }
  >();
  for (const month of canonicalMonths) {
    if (!/^\d{4}-\d{2}$/.test(month)) continue;
    const monthDateKeys = Array.from(args.weatherByDateKey.keys()).filter((dateKey) => dateKey.startsWith(`${month}-`));
    const aggregate = aggregateWeatherForDateKeys(monthDateKeys);
    if (aggregate) monthWeatherAggregateByMonth.set(month, aggregate);
  }

  const rows = manualBillPeriods
    .map((period) => {
      const id = String(period?.id ?? "").trim();
      const startDate = String(period?.startDate ?? "").slice(0, 10);
      const endDate = String(period?.endDate ?? "").slice(0, 10);
      const monthKey = String(period?.month ?? "").trim() || endDate.slice(0, 7);
      if (!id || !/^\d{4}-\d{2}$/.test(monthKey) || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
        return null;
      }
      if (period?.eligibleForConstraint === false) return null;
      const targetKwhRaw = Number(manualBillPeriodTotalsKwhById[id] ?? period?.enteredKwh);
      if (!Number.isFinite(targetKwhRaw)) return null;
      const aggregate = aggregateWeatherForDateKeys(listUtcDateKeysInclusive(startDate, endDate));
      if (!aggregate) return null;
      return {
        id,
        monthKey,
        startDate,
        endDate,
        targetKwh: Math.max(0, targetKwhRaw),
        avgDailyTarget: Math.max(0, targetKwhRaw) / Math.max(1, aggregate.dayCount),
        eligibleNonTravelDayCount: aggregate.dayCount,
        avgHdd: aggregate.avgHdd,
        avgCdd: aggregate.avgCdd,
        avgTempC: aggregate.avgTempC,
      };
    })
    .filter((row: BillPeriodWeatherEvidenceRow | null): row is BillPeriodWeatherEvidenceRow => Boolean(row)) as BillPeriodWeatherEvidenceRow[];
  if (rows.length === 0) return null;

  const xtx = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const xty = [0, 0, 0];
  for (const row of rows) {
    const vector = [1, row.avgHdd, row.avgCdd];
    for (let i = 0; i < 3; i += 1) {
      xty[i] += vector[i] * row.avgDailyTarget;
      for (let j = 0; j < 3; j += 1) xtx[i][j] += vector[i] * vector[j];
    }
  }
  const inverse = invert3x3(xtx);
  const solved = inverse ? multiplyMatrixVector(inverse, xty) : [0, 0, 0];
  const meanTarget = rows.reduce((sum: number, row) => sum + row.avgDailyTarget, 0) / Math.max(1, rows.length);
  const meanHdd = rows.reduce((sum: number, row) => sum + row.avgHdd, 0) / Math.max(1, rows.length);
  const meanCdd = rows.reduce((sum: number, row) => sum + row.avgCdd, 0) / Math.max(1, rows.length);
  const fuelConfiguration = String((args.homeProfile as any)?.fuelConfiguration ?? "").trim();
  const heatingType = String((args.homeProfile as any)?.heatingType ?? "").trim();
  const hasCoolingPriors =
    String((args.homeProfile as any)?.hvacType ?? "").trim().length > 0 ||
    Array.isArray((args.applianceProfile as any)?.appliances);
  const heatingPriorSensitivity =
    fuelConfiguration === "all_electric" || heatingType === "electric" ? 0.95 : 0.45;
  const coolingPriorSensitivity = hasCoolingPriors ? 0.75 : 0.45;
  const evidenceWeight = rows.length >= 5 ? 0.9 : rows.length >= 3 ? 0.7 : 0.45;
  const wholeHomePriorFallbackWeight = 1 - evidenceWeight;

  const baseloadDaily = clampNumberForEvidence(Number(solved[0]) || meanTarget * 0.55, meanTarget * 0.18, meanTarget * 0.92);
  const hvacDaily = Math.max(0, meanTarget - baseloadDaily);
  const rawHeatingSensitivity = meanHdd > 1e-6 && hvacDaily > 1e-6 ? ((Number(solved[1]) || 0) * meanHdd) / hvacDaily : 0;
  const rawCoolingSensitivity = meanCdd > 1e-6 && hvacDaily > 1e-6 ? ((Number(solved[2]) || 0) * meanCdd) / hvacDaily : 0;
  const heatingSensitivity = clampNumberForEvidence(
    rawHeatingSensitivity * evidenceWeight + heatingPriorSensitivity * (1 - evidenceWeight),
    0.12,
    1.8
  );
  const coolingSensitivity = clampNumberForEvidence(
    rawCoolingSensitivity * evidenceWeight + coolingPriorSensitivity * (1 - evidenceWeight),
    0.12,
    1.8
  );
  const baseloadShare = clampNumberForEvidence(baseloadDaily / Math.max(meanTarget, 1e-6), 0.18, 0.9);
  const hvacShare = clampNumberForEvidence(1 - baseloadShare, 0.1, 0.82);
  const eligibleBillPeriodsUsed = rows.map((row) => ({
    id: row.id,
    monthKey: row.monthKey,
    startDate: row.startDate,
    endDate: row.endDate,
    targetKwh: row.targetKwh,
    eligibleNonTravelDayCount: row.eligibleNonTravelDayCount,
  }));
  const excludedTravelTouchedBillPeriods = manualBillPeriods
    .filter((period) => String(period?.exclusionReason ?? "").trim() === "travel_overlap")
    .map((period) => ({
      id: String(period?.id ?? "").trim(),
      monthKey: String(period?.month ?? "").trim() || String(period?.endDate ?? "").slice(0, 7),
      startDate: String(period?.startDate ?? "").slice(0, 10),
      endDate: String(period?.endDate ?? "").slice(0, 10),
      targetKwh: Number.isFinite(Number(manualBillPeriodTotalsKwhById[String(period?.id ?? "").trim()] ?? period?.enteredKwh))
        ? Math.max(0, Number(manualBillPeriodTotalsKwhById[String(period?.id ?? "").trim()] ?? period?.enteredKwh))
        : null,
      travelVacantDayCount: listUtcDateKeysInclusive(
        String(period?.startDate ?? "").slice(0, 10),
        String(period?.endDate ?? "").slice(0, 10)
      ).filter((dateKey) => travelDateKeys.has(dateKey)).length,
    }))
    .filter((period) => period.id && /^\d{4}-\d{2}$/.test(period.monthKey));
  const inputMonthKeys =
    Array.isArray(inputState?.enteredMonthKeys) && inputState!.enteredMonthKeys.length > 0
      ? inputState!.enteredMonthKeys.map((value) => String(value))
      : Array.from(new Set([...rows.map((row) => row.monthKey), ...canonicalMonths])).sort();
  const targetMonthKeys = Array.from(new Set([...inputMonthKeys, ...canonicalMonths, ...rows.map((row) => row.monthKey)])).filter(
    (value) => /^\d{4}-\d{2}$/.test(value)
  );
  const byMonth = Object.fromEntries(
    targetMonthKeys
      .map((monthKey) => {
        const drivingRows = rows.filter((row) => row.monthKey === monthKey);
        const aggregate = monthWeatherAggregateByMonth.get(monthKey);
        if (!aggregate && drivingRows.length === 0) return null;
        const reference = drivingRows[0] ?? null;
        const predictedDailyTargetRaw =
          aggregate != null ? (Number(solved[0]) || 0) + (Number(solved[1]) || 0) * aggregate.avgHdd + (Number(solved[2]) || 0) * aggregate.avgCdd : meanTarget;
        const inferredDailyTarget = clampNumberForEvidence(
          predictedDailyTargetRaw * evidenceWeight + meanTarget * wholeHomePriorFallbackWeight,
          meanTarget * 0.35,
          meanTarget * 1.85
        );
        const targetAvgDailyKwh = reference ? reference.avgDailyTarget : inferredDailyTarget;
        const referenceDailyHdd = reference?.avgHdd ?? aggregate?.avgHdd ?? meanHdd;
        const referenceDailyCdd = reference?.avgCdd ?? aggregate?.avgCdd ?? meanCdd;
        const referenceAvgTempC = reference?.avgTempC ?? aggregate?.avgTempC ?? null;
        const excludedTravelTouchedForMonth = excludedTravelTouchedBillPeriods.filter((period) => period.monthKey === monthKey);
        return [
          monthKey,
          {
            monthKey,
            targetAvgDailyKwh,
            evidenceSource: reference ? ("eligible_bill_period" as const) : ("inferred_from_eligible_periods" as const),
            drivingBillPeriodIds: drivingRows.map((row) => row.id),
            eligibleNonTravelDayCount: drivingRows.reduce((sum, row) => sum + row.eligibleNonTravelDayCount, 0),
            excludedTravelDayCount: excludedTravelTouchedForMonth.reduce((sum, period) => sum + period.travelVacantDayCount, 0),
            eligibleBillPeriodCount: drivingRows.length,
            excludedTravelTouchedBillPeriodCount: excludedTravelTouchedForMonth.length,
            baseloadShare,
            hvacShare,
            heatingSensitivity,
            coolingSensitivity,
            referenceDailyHdd,
            referenceDailyCdd,
            referenceAvgTempC,
          },
        ] as const;
      })
      .filter(
        (
          entry
        ): entry is readonly [
          string,
          PastLowDataWeatherEvidenceSummary["byMonth"][string]
        ] => Boolean(entry)
      )
  );

  return {
    inputMonthKeys,
    missingMonthKeys: Array.isArray(inputState?.missingMonthKeys) ? inputState!.missingMonthKeys.map((value) => String(value)) : [],
    explicitTravelRangesUsed: normalizeTravelRangeSummary((args.manualUsagePayload as any)?.travelRanges),
    eligibleBillPeriodsUsed,
    excludedTravelTouchedBillPeriods,
    monthlyWeatherPressureInputsUsed: rows.map((row) => ({
      billPeriodId: row.id,
      monthKey: row.monthKey,
      avgDailyTargetKwh: row.avgDailyTarget,
      avgHdd: row.avgHdd,
      avgCdd: row.avgCdd,
      avgTempC: row.avgTempC,
    })),
    evidenceWeight,
    wholeHomePriorFallbackWeight,
    baseloadShare,
    hvacShare,
    heatingSensitivity,
    coolingSensitivity,
    dailyWeatherResponsiveness:
      hvacShare >= 0.48 || Math.max(heatingSensitivity, coolingSensitivity) >= 0.9
        ? "weather_driven"
        : hvacShare <= 0.24
          ? "mostly_baseload_driven"
          : "mixed",
    byMonth,
  };
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

export function renormalizeManualBillPeriodIntervals(args: {
  patchedIntervals: Array<{ timestamp: string; kwh: number }>;
  dayResults: SimulatedDayResult[];
  manualBillPeriods: Array<{ id: string; startDate: string; endDate: string; eligibleForConstraint?: boolean }>;
  manualBillPeriodTotalsKwhById?: Record<string, number> | null;
  timezone: string;
  correlationId?: string;
}) {
  const emitStep = (
    step: string,
    phase: "start" | "success" | "failure",
    startedAt: number,
    extra: Record<string, unknown> = {}
  ) => {
    if (!args.correlationId) return;
    logSimPipelineEvent(`day_simulation_manual_bill_period_renormalization_${step}_${phase}`, {
      correlationId: args.correlationId,
      durationMs: Date.now() - startedAt,
      memoryRssMb: getMemoryRssMb(),
      intervalCount: args.patchedIntervals.length,
      dayResultCount: args.dayResults.length,
      source: "renormalizeManualBillPeriodIntervals",
      ...extra,
    });
  };
  const listUtcDateKeysInclusive = (startDate: string, endDate: string): string[] => {
    const out: string[] = [];
    const start = new Date(`${startDate}T00:00:00.000Z`);
    const end = new Date(`${endDate}T00:00:00.000Z`);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start > end) return out;
    for (let cursor = start.getTime(); cursor <= end.getTime(); cursor += 24 * 60 * 60 * 1000) {
      out.push(new Date(cursor).toISOString().slice(0, 10));
    }
    return out;
  };
  const timezoneLabel = String(args.timezone ?? "").trim() || "UTC";
  const useUtcFastPath = timezoneLabel.toUpperCase() === "UTC" || timezoneLabel === "Etc/UTC";
  const dateKeyFormatter = useUtcFastPath
    ? null
    : new Intl.DateTimeFormat("en-CA", {
        timeZone: timezoneLabel,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
  const resolveDateKey = (timestamp: string): string => {
    const ts = String(timestamp ?? "").trim();
    if (useUtcFastPath) return ts.slice(0, 10);
    try {
      const d = new Date(ts);
      if (!Number.isFinite(d.getTime()) || !dateKeyFormatter) return ts.slice(0, 10);
      const parts = dateKeyFormatter.formatToParts(d);
      const year = parts.find((part) => part.type === "year")?.value ?? "";
      const month = parts.find((part) => part.type === "month")?.value ?? "";
      const day = parts.find((part) => part.type === "day")?.value ?? "";
      return `${year}-${month}-${day}`;
    } catch {
      return ts.slice(0, 10);
    }
  };
  const eligiblePeriods = args.manualBillPeriods.filter((period) => period.eligibleForConstraint !== false);
  if (eligiblePeriods.length === 0 || !args.patchedIntervals.length) return;

  const indexStartedAt = Date.now();
  emitStep("index", "start", indexStartedAt, {
    eligibleBillPeriodCount: eligiblePeriods.length,
  });
  const summedDayTotalsByDate = new Map<string, number>();
  for (const interval of args.patchedIntervals) {
    const dateKey = resolveDateKey(String(interval.timestamp ?? ""));
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
      summedDayTotalsByDate.set(dateKey, (summedDayTotalsByDate.get(dateKey) ?? 0) + (Number(interval.kwh) || 0));
    }
  }
  emitStep("index", "success", indexStartedAt, {
    indexedDateKeyCount: summedDayTotalsByDate.size,
  });

  const factorPlanStartedAt = Date.now();
  emitStep("factor_plan", "start", factorPlanStartedAt, {
    eligibleBillPeriodCount: eligiblePeriods.length,
  });
  const scaleMultiplierByDateKey = new Map<string, number>();
  let scaledDateMembershipCount = 0;
  for (const period of eligiblePeriods) {
    const targetTotal = Number(args.manualBillPeriodTotalsKwhById?.[period.id] ?? NaN);
    if (!Number.isFinite(targetTotal) || targetTotal < 0) continue;

    let actualTotal = 0;
    const affectedDateKeys: string[] = [];
    for (const dateKey of listUtcDateKeysInclusive(period.startDate, period.endDate)) {
      const dayTotal = summedDayTotalsByDate.get(dateKey);
      if (dayTotal == null) continue;
      actualTotal += dayTotal;
      affectedDateKeys.push(dateKey);
    }
    if (!Number.isFinite(actualTotal) || actualTotal <= 0) continue;

    const factor = targetTotal / actualTotal;
    if (!Number.isFinite(factor) || Math.abs(factor - 1) <= 1e-9) continue;

    for (const dateKey of affectedDateKeys) {
      const dayTotal = summedDayTotalsByDate.get(dateKey);
      if (dayTotal == null) continue;
      summedDayTotalsByDate.set(dateKey, dayTotal * factor);
      scaleMultiplierByDateKey.set(dateKey, (scaleMultiplierByDateKey.get(dateKey) ?? 1) * factor);
      scaledDateMembershipCount += 1;
    }
  }
  emitStep("factor_plan", "success", factorPlanStartedAt, {
    scaledDateMembershipCount,
    uniqueScaledDateKeyCount: scaleMultiplierByDateKey.size,
  });

  const intervalApplyStartedAt = Date.now();
  emitStep("interval_apply", "start", intervalApplyStartedAt, {
    scaledDateKeyCount: scaleMultiplierByDateKey.size,
  });
  let scaledIntervalCount = 0;
  for (const interval of args.patchedIntervals) {
    const factorValue = scaleMultiplierByDateKey.get(resolveDateKey(String(interval.timestamp ?? ""))) ?? 1;
    if (!Number.isFinite(factorValue) || Math.abs(factorValue - 1) <= 1e-9) continue;
    interval.kwh = (Number(interval.kwh) || 0) * factorValue;
    scaledIntervalCount += 1;
  }
  emitStep("interval_apply", "success", intervalApplyStartedAt, {
    scaledIntervalCount,
  });

  const dayResultApplyStartedAt = Date.now();
  emitStep("day_result_apply", "start", dayResultApplyStartedAt, {
    scaledDateKeyCount: scaleMultiplierByDateKey.size,
  });
  let scaledDayResultCount = 0;
  const patchedIntervalRefSet = new Set<object>(args.patchedIntervals as object[]);
  for (const result of args.dayResults) {
    const dateKey = String(result.localDate ?? "").slice(0, 10);
    const intervalList = Array.isArray(result.intervals) ? result.intervals : [];
    let scaledSum = 0;
    let resultTouched = false;
    if (intervalList.length > 0) {
      if (!Array.isArray(result.intervals15) || result.intervals15.length !== intervalList.length) {
        result.intervals15 = new Array(intervalList.length);
      }
      for (let index = 0; index < intervalList.length; index += 1) {
        const interval = intervalList[index]!;
        const intervalDateKey = resolveDateKey(String(interval.timestamp ?? ""));
        const factorValue = scaleMultiplierByDateKey.get(intervalDateKey) ?? 1;
        const sharesPatchedRef = typeof interval === "object" && interval != null && patchedIntervalRefSet.has(interval as object);
        if (!sharesPatchedRef && Number.isFinite(factorValue) && Math.abs(factorValue - 1) > 1e-9) {
          interval.kwh = (Number(interval.kwh) || 0) * factorValue;
          resultTouched = true;
        }
        const scaledKwh = Number(interval.kwh) || 0;
        result.intervals15[index] = scaledKwh;
        scaledSum += scaledKwh;
      }
    } else {
      scaledSum = summedDayTotalsByDate.has(dateKey) ? (summedDayTotalsByDate.get(dateKey) ?? 0) : (Number(result.intervalSumKwh) || 0);
    }
    if (resultTouched || scaleMultiplierByDateKey.has(dateKey)) scaledDayResultCount += 1;
    result.intervalSumKwh = scaledSum;
    result.displayDayKwh = round2CanonicalSimDayTotal(scaledSum);
    result.finalDayKwh = scaledSum;
    result.weatherAdjustedDayKwh = scaledSum;
    result.dayTotalAfterWeatherScale = scaledSum;
  }
  emitStep("day_result_apply", "success", dayResultApplyStartedAt, {
    scaledDayResultCount,
  });
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

type HouseWeatherDayMap = Awaited<ReturnType<typeof getHouseWeatherDays>>;

function mergeActualWxWithNormalForLowDataModes(args: {
  actualWxByDateKey: HouseWeatherDayMap;
  normalWxByDateKey: HouseWeatherDayMap;
  canonicalDateKeys: string[];
}): { mergedActualWxByDateKey: HouseWeatherDayMap; normalFilledDateKeyCount: number } {
  const merged = new Map(args.actualWxByDateKey);
  let normalFilledDateKeyCount = 0;
  for (const dk of args.canonicalDateKeys) {
    const row = merged.get(dk);
    const isStub = !row || String(row?.source ?? "").trim() === WEATHER_STUB_SOURCE;
    if (!isStub) continue;
    const n = args.normalWxByDateKey.get(dk);
    if (n && String(n?.source ?? "").trim() !== WEATHER_STUB_SOURCE) {
      merged.set(dk, n);
      normalFilledDateKeyCount += 1;
    }
  }
  return { mergedActualWxByDateKey: merged, normalFilledDateKeyCount };
}

function collectMissingOrStubWeatherDateKeys(args: {
  weatherByDateKey: HouseWeatherDayMap;
  canonicalDateKeys: string[];
}): string[] {
  return args.canonicalDateKeys.filter((dk) => {
    const row = args.weatherByDateKey.get(dk);
    if (!row) return true;
    return String(row?.source ?? "").trim() === WEATHER_STUB_SOURCE;
  });
}

function resolveUtcDateKeySelectionsFromLocalDateSets(args: {
  canonicalDayStartsMs: number[];
  canonicalDateKeys: string[];
  timezoneResolved: string;
  forcedSimulateDateKeysLocal: Set<string>;
  retainedSimulatedDayResultDateKeysLocal: Set<string>;
  mergedKeepRefLocalDateKeys: Set<string>;
}): {
  forcedUtcDateKeys: Set<string>;
  retainedResultUtcDateKeys: Set<string>;
  keepRefUtcDateKeys: Set<string>;
} {
  const forcedUtcDateKeys = new Set<string>();
  const retainedResultUtcDateKeys = new Set<string>();
  const keepRefUtcDateKeys = new Set<string>();

  if (
    args.forcedSimulateDateKeysLocal.size === 0 &&
    args.retainedSimulatedDayResultDateKeysLocal.size === 0 &&
    args.mergedKeepRefLocalDateKeys.size === 0
  ) {
    return { forcedUtcDateKeys, retainedResultUtcDateKeys, keepRefUtcDateKeys };
  }

  if (args.timezoneResolved) {
    for (const dayStartMs of args.canonicalDayStartsMs) {
      const gridTs = getDayGridTimestamps(dayStartMs);
      if (!gridTs.length) continue;
      const utcDateKey = dateKeyFromTimestamp(gridTs[0]);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(utcDateKey)) continue;
      // Map each UTC day to one dominant local day key (majority of 15-min slots) so
      // local-day selections do not spill into adjacent UTC days.
      const localDateKeyCounts = new Map<string, number>();
      for (const ts of gridTs) {
        const localDateKey = dateKeyInTimezone(ts, args.timezoneResolved);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(localDateKey)) continue;
        localDateKeyCounts.set(localDateKey, (localDateKeyCounts.get(localDateKey) ?? 0) + 1);
      }
      if (localDateKeyCounts.size === 0) continue;
      let dominantLocalDateKey: string | null = null;
      let dominantLocalDateCount = -1;
      for (const [localDateKey, count] of Array.from(localDateKeyCounts.entries())) {
        if (
          count > dominantLocalDateCount ||
          (count === dominantLocalDateCount && (dominantLocalDateKey == null || localDateKey > dominantLocalDateKey))
        ) {
          dominantLocalDateKey = localDateKey;
          dominantLocalDateCount = count;
        }
      }
      if (!dominantLocalDateKey) continue;
      if (args.forcedSimulateDateKeysLocal.has(dominantLocalDateKey)) forcedUtcDateKeys.add(utcDateKey);
      if (args.retainedSimulatedDayResultDateKeysLocal.has(dominantLocalDateKey)) retainedResultUtcDateKeys.add(utcDateKey);
      if (args.mergedKeepRefLocalDateKeys.has(dominantLocalDateKey)) keepRefUtcDateKeys.add(utcDateKey);
    }
  } else {
    // No IANA timezone: local date keys are treated as canonical UTC calendar keys.
    for (const utcDateKey of args.canonicalDateKeys) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(utcDateKey)) continue;
      if (args.forcedSimulateDateKeysLocal.has(utcDateKey)) forcedUtcDateKeys.add(utcDateKey);
      if (args.retainedSimulatedDayResultDateKeysLocal.has(utcDateKey)) retainedResultUtcDateKeys.add(utcDateKey);
      if (args.mergedKeepRefLocalDateKeys.has(utcDateKey)) keepRefUtcDateKeys.add(utcDateKey);
    }
  }

  for (const utcKey of Array.from(keepRefUtcDateKeys)) {
    if (forcedUtcDateKeys.has(utcKey)) keepRefUtcDateKeys.delete(utcKey);
  }

  return { forcedUtcDateKeys, retainedResultUtcDateKeys, keepRefUtcDateKeys };
}

function summarizePastWindowWeatherProvenance(args: {
  selectedWxByDateKey: Awaited<ReturnType<typeof getHouseWeatherDays>>;
  weatherLogicMode: WeatherLogicMode;
  weatherFallbackReason: WeatherFallbackReason;
}): WeatherProvenance {
  const wxEntries = Array.from(args.selectedWxByDateKey.entries());
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
  const providerCoverage = Array.from(args.selectedWxByDateKey.entries()).reduce<
    Array<{
      provider: string;
      source: string;
      count: number;
      coverageStart: string | null;
      coverageEnd: string | null;
    }>
  >((acc, [dateKey, row]) => {
    const source = String(row?.source ?? "").trim() || "unknown";
    const provider =
      source.includes("VISUAL_CROSSING")
        ? "VISUAL_CROSSING"
        : source.includes("OPEN_METEO")
          ? "OPEN_METEO"
          : source.includes("CACHE")
            ? "CACHE"
            : source.includes("STUB")
              ? "STUB"
              : "UNKNOWN";
    const existing = acc.find((entry) => entry.source === source);
    if (existing) {
      existing.count += 1;
      existing.coverageStart =
        existing.coverageStart == null || dateKey < existing.coverageStart ? dateKey : existing.coverageStart;
      existing.coverageEnd =
        existing.coverageEnd == null || dateKey > existing.coverageEnd ? dateKey : existing.coverageEnd;
    } else {
      acc.push({
        provider,
        source,
        count: 1,
        coverageStart: dateKey,
        coverageEnd: dateKey,
      });
    }
    return acc;
  }, []);
  const providerNames = Array.from(new Set(providerCoverage.map((entry) => entry.provider))).filter(
    (value) => value !== "UNKNOWN"
  );
  let weatherSourceSummary: WeatherProvenance["weatherSourceSummary"] = "none";
  if (weatherRowsCount > 0) {
    if (weatherStubRowCount === weatherRowsCount) weatherSourceSummary = "stub_only";
    else if (weatherActualRowCount === weatherRowsCount) weatherSourceSummary = "actual_only";
    else weatherSourceSummary = "mixed_actual_and_stub";
  }
  return {
    weatherLogicMode: args.weatherLogicMode,
    weatherKindUsed,
    weatherSourceSummary,
    weatherFallbackReason: args.weatherFallbackReason,
    weatherProviderName:
      providerNames.length > 0 ? providerNames.join("+") : weatherActualRowCount > 0 ? "OPEN_METEO" : "unknown",
    weatherFallbackUsed: providerCoverage.some((entry) => entry.provider === "VISUAL_CROSSING"),
    weatherProviderCoverage: providerCoverage,
    weatherNormalsBaselineStart:
      args.weatherLogicMode === "LONG_TERM_AVERAGE_WEATHER" ? "1991-01-01" : null,
    weatherNormalsBaselineEnd:
      args.weatherLogicMode === "LONG_TERM_AVERAGE_WEATHER" ? "2020-12-31" : null,
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
  weatherLogicMode: WeatherLogicMode;
}): Promise<{
  actualWxByDateKey: Awaited<ReturnType<typeof getHouseWeatherDays>>;
  normalWxByDateKey: Awaited<ReturnType<typeof getHouseWeatherDays>>;
  selectedWeatherByDateKey: Awaited<ReturnType<typeof getHouseWeatherDays>>;
  provenance: WeatherProvenance;
}> {
  const { houseId, startDate, endDate, canonicalDateKeys, weatherLogicMode } = args;
  const [actualWxByDateKey, normalWxByDateKey] = await Promise.all([
    getHouseWeatherDays({ houseId, dateKeys: canonicalDateKeys, kind: "ACTUAL_LAST_YEAR" }),
    getHouseWeatherDays({ houseId, dateKeys: canonicalDateKeys, kind: "NORMAL_AVG" }),
  ]);
  const missingOrStubActualWxKeys = collectMissingOrStubWeatherDateKeys({
    weatherByDateKey: actualWxByDateKey,
    canonicalDateKeys,
  });
  const missingOrStubNormalWxKeys = collectMissingOrStubWeatherDateKeys({
    weatherByDateKey: normalWxByDateKey,
    canonicalDateKeys,
  });
  const selectedWeatherBeforeBackfill =
    weatherLogicMode === "LONG_TERM_AVERAGE_WEATHER" ? normalWxByDateKey : actualWxByDateKey;
  const missingSelectedWxKeys =
    weatherLogicMode === "LONG_TERM_AVERAGE_WEATHER" ? missingOrStubNormalWxKeys : missingOrStubActualWxKeys;
  if (missingSelectedWxKeys.length === 0) {
    return {
      actualWxByDateKey,
      normalWxByDateKey,
      selectedWeatherByDateKey:
        weatherLogicMode === "LONG_TERM_AVERAGE_WEATHER"
          ? normalWxByDateKey
          : actualWxByDateKey,
      provenance: summarizePastWindowWeatherProvenance({
        selectedWxByDateKey:
          weatherLogicMode === "LONG_TERM_AVERAGE_WEATHER"
            ? normalWxByDateKey
            : actualWxByDateKey,
        weatherLogicMode,
        weatherFallbackReason: null,
      }),
    };
  }

  const house = await (prisma as any).houseAddress
    .findUnique({ where: { id: houseId }, select: { lat: true, lng: true } })
    .catch(() => null);
  const lat = house?.lat != null && Number.isFinite(house.lat) ? house.lat : null;
  const lon = house?.lng != null && Number.isFinite(house.lng) ? house.lng : null;

  if (lat == null || lon == null) {
    throw new Error(
      "Shared weather load failed: house lat/lng is missing, so real weather backfill cannot run."
    );
  }
  if (weatherLogicMode === "LONG_TERM_AVERAGE_WEATHER") {
    await ensureHouseWeatherNormalAvgBackfill({ houseId, dateKeys: canonicalDateKeys });
  } else {
    await ensureHouseWeatherBackfill({ houseId, startDate, endDate });
  }
  const [actualWx2, normalWx2] = await Promise.all([
    getHouseWeatherDays({ houseId, dateKeys: canonicalDateKeys, kind: "ACTUAL_LAST_YEAR" }),
    getHouseWeatherDays({ houseId, dateKeys: canonicalDateKeys, kind: "NORMAL_AVG" }),
  ]);
  const selectedWeatherAfterBackfill =
    weatherLogicMode === "LONG_TERM_AVERAGE_WEATHER" ? normalWx2 : actualWx2;
  const missingSelectedAfterBackfill = collectMissingOrStubWeatherDateKeys({
    weatherByDateKey: selectedWeatherAfterBackfill,
    canonicalDateKeys,
  });
  if (missingSelectedAfterBackfill.length > 0) {
    throw new Error(
      weatherLogicMode === "LONG_TERM_AVERAGE_WEATHER"
        ? "Shared weather load failed: NORMAL_AVG rows are unavailable after real historical backfill."
        : "Shared weather load failed: ACTUAL_LAST_YEAR coverage is still missing after real API backfill."
    );
  }
  return {
    actualWxByDateKey: actualWx2,
    normalWxByDateKey: normalWx2,
    selectedWeatherByDateKey: selectedWeatherAfterBackfill,
    provenance: summarizePastWindowWeatherProvenance({
      selectedWxByDateKey: selectedWeatherAfterBackfill,
      weatherLogicMode,
      weatherFallbackReason: null,
    }),
  };
}

export type SimulatePastUsageDatasetArgs = {
  houseId: string;
  /** Optional shared actual-context house; defaults to houseId. */
  actualContextHouseId?: string;
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
  /** Observability: plan §6 (Slice 2); threaded from recalc. */
  correlationId?: string;
};

export type SimulatePastUsageDatasetResult = {
  dataset: ReturnType<typeof buildSimulatedUsageDatasetFromCurve>;
  meta: Record<string, unknown>;
  pastDayCounts: { totalDays?: number; excludedDays?: number; leadingMissingDays?: number; simulatedDays?: number };
  shapeMonthsPresent: string[];
  /** For callers that attach dailyWeather or need weather for overlay. */
  actualWxByDateKey?: Awaited<ReturnType<typeof getHouseWeatherDays>>;
  selectedWeatherByDateKey?: Awaited<ReturnType<typeof getHouseWeatherDays>>;
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
  selectedWeatherByDateKey?: Awaited<ReturnType<typeof getHouseWeatherDays>>;
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
  selectedWeatherByDateKey: Awaited<ReturnType<typeof getHouseWeatherDays>>;
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
 * Used by getPastSimulatedDatasetForHouse, recalcSimulatorBuild, and GapFill Lab production path.
 */
export async function simulatePastUsageDataset(
  args: SimulatePastUsageDatasetArgs
): Promise<SimulatePastUsageDatasetResult | { dataset: null; error: string }> {
  const {
    houseId,
    actualContextHouseId,
    userId,
    esiid,
    startDate,
    endDate,
    timezone,
    travelRanges,
    buildInputs,
    buildPathKind: buildPathKindRaw,
    includeSimulatedDayResults = true,
    actualIntervals: preloadedIntervals,
    forceSimulateDateKeysLocal,
    forceModeledOutputKeepReferencePoolDateKeysLocal,
    emitAllIntervals = true,
    retainSimulatedDayResultDateKeysLocal,
  } = args;
  const buildPathKind = normalizePastProducerBuildPathKind(buildPathKindRaw);
  const actualHouseId = String(actualContextHouseId ?? houseId);
  const correlationId = args.correlationId ?? createSimCorrelationId();
  const daySimStartedAt = Date.now();
  logSimPipelineEvent("day_simulation_start", {
    correlationId,
    houseId,
    userId,
    buildPathKind,
    memoryRssMb: getMemoryRssMb(),
    source: "simulatePastUsageDataset",
  });

  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    logSimPipelineEvent("day_simulation_failure", {
      correlationId,
      houseId,
      userId,
      failureMessage: "Invalid startDate or endDate (expect YYYY-MM-DD).",
      durationMs: Date.now() - daySimStartedAt,
      memoryRssMb: getMemoryRssMb(),
      source: "simulatePastUsageDataset",
    });
    return { dataset: null, error: "Invalid startDate or endDate (expect YYYY-MM-DD)." };
  }

  try {
    const inputPrepStartedAt = Date.now();
    logSimPipelineEvent("day_simulation_input_prep_start", {
      correlationId,
      houseId,
      userId,
      buildPathKind,
      source: "simulatePastUsageDataset",
      memoryRssMb: getMemoryRssMb(),
    });
    const isLowDataSharedPastMode =
      buildInputs.mode === "MANUAL_TOTALS" || buildInputs.mode === "NEW_BUILD_ESTIMATE";
    const resolvedSimFingerprint =
      (buildInputs.resolvedSimFingerprint as
        | { blendMode?: string | null; underlyingSourceMix?: string | null; manualTotalsConstraint?: string | null }
        | undefined) ?? null;
    const manualBillPeriodsRaw = (buildInputs as SimulatorBuildInputsV1).manualBillPeriods;
    const manualBillPeriods: NonNullable<SimulatorBuildInputsV1["manualBillPeriods"]> = Array.isArray(manualBillPeriodsRaw)
      ? (manualBillPeriodsRaw as NonNullable<SimulatorBuildInputsV1["manualBillPeriods"]>)
      : [];
    const usesWholeHomeOnlyPrior =
      resolvedSimFingerprint?.blendMode === "whole_home_only" ||
      resolvedSimFingerprint?.underlyingSourceMix === "whole_home_only";
    const useWholeHomeOnlyLowDataFastPath = isLowDataSharedPastMode && usesWholeHomeOnlyPrior;
    const eligibleManualBillPeriods = manualBillPeriods.filter((period) => period.eligibleForConstraint);
    const canonicalMonths = ((buildInputs as any).canonicalMonths ?? []) as string[];
    const lowDataSyntheticContextBase: {
      mode: "MANUAL_TOTALS" | "NEW_BUILD_ESTIMATE";
      canonicalMonthKeys: string[];
      intradayShape96: number[] | null;
      weekdayWeekendShape96: { weekday: number[]; weekend: number[] } | null;
    } | null =
      isLowDataSharedPastMode
        ? {
            mode: buildInputs.mode as "MANUAL_TOTALS" | "NEW_BUILD_ESTIMATE",
            canonicalMonthKeys: canonicalMonths,
            intradayShape96: (buildInputs as SimulatorBuildInputsV1).intradayShape96 ?? null,
            weekdayWeekendShape96: (buildInputs as SimulatorBuildInputsV1).weekdayWeekendShape96 ?? null,
          }
        : null;
    const fetchedActualIntervals = preloadedIntervals
      ? null
      : isLowDataSharedPastMode
        ? null
        : (await getActualIntervalsForRange({ houseId: actualHouseId, esiid, startDate, endDate })).map((p) => ({
          timestamp: p.timestamp,
          kwh: p.kwh,
        }));
    const sourceActualIntervals = preloadedIntervals != null ? preloadedIntervals : fetchedActualIntervals ?? [];
    const actualIntervals =
      useWholeHomeOnlyLowDataFastPath || lowDataSyntheticContextBase ? [] : sourceActualIntervals;
    const sourceActualIntervalsCount = sourceActualIntervals.length;
    const actualIntervalPayloadSuppressedCount = Math.max(0, sourceActualIntervalsCount - actualIntervals.length);
    const actualIntervalPayloadSuppressed = actualIntervalPayloadSuppressedCount > 0;

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

    const mergedKeepRefLocalDateKeys = new Set<string>(forceModeledOutputKeepReferencePoolDateKeysLocalSet);
    logSimPipelineEvent("day_simulation_input_prep_success", {
      correlationId,
      houseId,
      userId,
      buildPathKind,
      actualIntervalsCount: actualIntervals.length,
      sourceActualIntervalsCount,
      actualIntervalPayloadSuppressed,
      actualIntervalPayloadSuppressedCount,
      actualIntervalPayloadAttached: actualIntervals.length > 0,
      canonicalDateKeyCount: canonicalDateKeys.length,
      excludedDateKeyCount: excludedDateKeys.size,
      explicitKeepRefLocalDateKeyCount: forceModeledOutputKeepReferencePoolDateKeysLocalSet.size,
      effectiveKeepRefLocalDateKeyCount: mergedKeepRefLocalDateKeys.size,
      lowDataSyntheticContextUsed: Boolean(lowDataSyntheticContextBase),
      lowDataSyntheticMode: lowDataSyntheticContextBase?.mode,
      actualBackedReferencePoolExpected: !lowDataSyntheticContextBase,
      lowDataUsesSummarizedSourceTruth: Boolean(lowDataSyntheticContextBase),
      durationMs: Date.now() - inputPrepStartedAt,
      source: "simulatePastUsageDataset",
      memoryRssMb: getMemoryRssMb(),
    });

    const weatherLoadStartedAt = Date.now();
    logSimPipelineEvent("day_simulation_weather_load_start", {
      correlationId,
      houseId,
      userId,
      buildPathKind,
      source: "simulatePastUsageDataset",
      memoryRssMb: getMemoryRssMb(),
    });
    let weatherLoaded: Awaited<ReturnType<typeof loadWeatherForPastWindow>> | null = null;
    try {
      const weatherLogicMode = resolveWeatherLogicModeFromBuildInputs(
        (args.buildInputs ?? {}) as Record<string, unknown>
      );
      weatherLoaded = await loadWeatherForPastWindow({
        houseId: actualHouseId,
        startDate,
        endDate,
        canonicalDateKeys,
        weatherLogicMode,
      });
      const { provenance } = weatherLoaded;
      logSimPipelineEvent("day_simulation_weather_load_success", {
        correlationId,
        houseId,
        userId,
        buildPathKind,
        weatherSourceSummary: provenance.weatherSourceSummary,
        weatherActualRowCount: provenance.weatherActualRowCount,
        weatherStubRowCount: provenance.weatherStubRowCount,
        durationMs: Date.now() - weatherLoadStartedAt,
        source: "simulatePastUsageDataset",
        memoryRssMb: getMemoryRssMb(),
      });
    } catch (weatherError) {
      const weatherErr = weatherError instanceof Error ? weatherError : new Error(String(weatherError));
      logSimPipelineEvent("day_simulation_weather_load_failure", {
        correlationId,
        houseId,
        userId,
        buildPathKind,
        failureMessage: weatherErr.message,
        durationMs: Date.now() - weatherLoadStartedAt,
        source: "simulatePastUsageDataset",
        memoryRssMb: getMemoryRssMb(),
      });
      throw weatherErr;
    }
    if (!weatherLoaded) {
      throw new Error("weather_load_unavailable");
    }
    const { actualWxByDateKey, normalWxByDateKey, selectedWeatherByDateKey, provenance } = weatherLoaded;
    const postWeatherPrepStartedAt = Date.now();
    logSimPipelineEvent("day_simulation_post_weather_prep_start", {
      correlationId,
      houseId,
      sourceHouseId: actualHouseId !== houseId ? actualHouseId : undefined,
      userId,
      buildPathKind,
      source: "simulatePastUsageDataset",
      memoryRssMb: getMemoryRssMb(),
    });
    const smtBaselineStrictWeather =
      buildInputs.mode === "SMT_BASELINE" &&
      provenance.weatherLogicMode !== "LONG_TERM_AVERAGE_WEATHER";
    if (smtBaselineStrictWeather && provenance.weatherSourceSummary !== "actual_only") {
      logSimPipelineEvent("day_simulation_post_weather_prep_failure", {
        correlationId,
        houseId,
        sourceHouseId: actualHouseId !== houseId ? actualHouseId : undefined,
        userId,
        buildPathKind,
        failureMessage: `actual_weather_required:${provenance.weatherSourceSummary}`,
        durationMs: Date.now() - postWeatherPrepStartedAt,
        source: "simulatePastUsageDataset",
        memoryRssMb: getMemoryRssMb(),
      });
      logSimPipelineEvent("day_simulation_failure", {
        correlationId,
        houseId,
        userId,
        failureMessage: `actual_weather_required:${provenance.weatherSourceSummary}`,
        durationMs: Date.now() - daySimStartedAt,
        memoryRssMb: getMemoryRssMb(),
        source: "simulatePastUsageDataset",
      });
      return {
        dataset: null,
        error: `actual_weather_required:${provenance.weatherSourceSummary}`,
      };
    }
    const { mergedActualWxByDateKey, normalFilledDateKeyCount } = smtBaselineStrictWeather
      ? { mergedActualWxByDateKey: actualWxByDateKey, normalFilledDateKeyCount: 0 }
      : mergeActualWxWithNormalForLowDataModes({
          actualWxByDateKey,
          normalWxByDateKey,
          canonicalDateKeys,
        });
    const weatherByDateKeyForSimulation =
      provenance.weatherLogicMode === "LONG_TERM_AVERAGE_WEATHER"
        ? selectedWeatherByDateKey
        : mergedActualWxByDateKey;
    let homeProfileForPast = (buildInputs as any)?.snapshots?.homeProfile ?? null;
    let applianceProfileForPast = normalizeStoredApplianceProfile((buildInputs as any)?.snapshots?.applianceProfile ?? null);
    const manualUsagePayload = (buildInputs as any)?.snapshots?.manualUsagePayload ?? null;
    const manualLowDataWeatherEvidenceSummary = buildManualMonthlyWeatherEvidenceSummary({
      buildInputs,
      manualUsagePayload,
      weatherByDateKey: weatherByDateKeyForSimulation,
      homeProfile: homeProfileForPast as Record<string, unknown> | null,
      applianceProfile: applianceProfileForPast as Record<string, unknown> | null,
    });
    const lowDataSyntheticContext =
      lowDataSyntheticContextBase == null
        ? null
        : {
            ...lowDataSyntheticContextBase,
            weatherEvidenceSummary: manualLowDataWeatherEvidenceSummary,
          };
    let ensuredUsageShape: Awaited<ReturnType<typeof ensureUsageShapeProfileForSharedSimulation>> = {
      usageShapeProfileSnap: null,
      usageShapeProfileDiag: {
        found: false,
        id: null,
        version: null,
        derivedAt: null,
        windowStartUtc: null,
        windowEndUtc: null,
        profileMonthKeys: [],
        weekdayAvgLen: null,
        weekendAvgLen: null,
        canonicalMonths: canonicalMonths.map((m) => String(m)),
        canonicalMonthsLen: canonicalMonths.length,
        inlineDerivedFromActual: false,
        reasonNotUsed: "manual_totals_low_data_adapter",
        ensuredInFlow: false,
        ensureAttempted: false,
        ensuredReason: null,
        ensureFailedReason: null,
        ensuredProfileId: null,
        canonicalCoverageStartDate: resolveCanonicalUsage365CoverageWindow().startDate,
        canonicalCoverageEndDate: resolveCanonicalUsage365CoverageWindow().endDate,
      },
      profileAutoBuilt: false,
      error: null,
    };
    if (buildInputs.mode !== "MANUAL_TOTALS") {
      const [homeRecForPast, applianceRecForPast, ensuredUsageShapeFromDb] = await Promise.all([
        getHomeProfileSimulatedByUserHouse({ userId, houseId }),
        getApplianceProfileSimulatedByUserHouse({ userId, houseId }),
        ensureUsageShapeProfileForSharedSimulation({
          userId,
          houseId: actualHouseId,
          timezone,
          canonicalMonths,
        }),
      ]);
      homeProfileForPast = homeRecForPast ? { ...homeRecForPast } : homeProfileForPast;
      const applianceProfileFromDb = normalizeStoredApplianceProfile((applianceRecForPast?.appliancesJson as any) ?? null);
      applianceProfileForPast = applianceProfileFromDb?.fuelConfiguration
        ? applianceProfileFromDb
        : applianceProfileForPast;
      ensuredUsageShape = ensuredUsageShapeFromDb;
    }
    let usageShapeProfileSnap = ensuredUsageShape.usageShapeProfileSnap;
    let lowDataShapeAdapterUsed = false;
    if (!usageShapeProfileSnap && isLowDataSharedPastMode) {
      usageShapeProfileSnap = buildUsageShapeSnapFromMonthlyTotalsForLowData({
        canonicalMonths,
        monthlyTotalsKwhByMonth: (buildInputs as SimulatorBuildInputsV1).monthlyTotalsKwhByMonth ?? {},
      });
      lowDataShapeAdapterUsed = true;
    }
    if (!usageShapeProfileSnap) {
      logSimPipelineEvent("day_simulation_post_weather_prep_failure", {
        correlationId,
        houseId,
        sourceHouseId: actualHouseId !== houseId ? actualHouseId : undefined,
        userId,
        buildPathKind,
        failureMessage: ensuredUsageShape.error ?? "usage_shape_profile_required:missing",
        durationMs: Date.now() - postWeatherPrepStartedAt,
        source: "simulatePastUsageDataset",
        memoryRssMb: getMemoryRssMb(),
      });
      logSimPipelineEvent("day_simulation_failure", {
        correlationId,
        houseId,
        userId,
        failureMessage: ensuredUsageShape.error ?? "usage_shape_profile_required:missing",
        durationMs: Date.now() - daySimStartedAt,
        memoryRssMb: getMemoryRssMb(),
        source: "simulatePastUsageDataset",
      });
      return {
        dataset: null,
        error: ensuredUsageShape.error ?? "usage_shape_profile_required:missing",
      };
    }
    const usageShapeProfileDiag = {
      ...ensuredUsageShape.usageShapeProfileDiag,
      ...(lowDataShapeAdapterUsed
        ? {
            reasonNotUsed: "low_data_monthly_shape_adapter",
            inlineDerivedFromActual: false,
          }
        : {}),
    };
    const timezoneResolved = String(timezone ?? "").trim();
    const { forcedUtcDateKeys, retainedResultUtcDateKeys, keepRefUtcDateKeys } =
      resolveUtcDateKeySelectionsFromLocalDateSets({
        canonicalDayStartsMs,
        canonicalDateKeys,
        timezoneResolved,
        forcedSimulateDateKeysLocal,
        retainedSimulatedDayResultDateKeysLocal,
        mergedKeepRefLocalDateKeys,
      });
    logSimPipelineEvent("day_simulation_post_weather_prep_success", {
      correlationId,
      houseId,
      sourceHouseId: actualHouseId !== houseId ? actualHouseId : undefined,
      userId,
      buildPathKind,
      forcedUtcDateKeyCount: forcedUtcDateKeys.size,
      keepRefUtcDateKeyCount: keepRefUtcDateKeys.size,
      retainedResultUtcDateKeyCount: retainedResultUtcDateKeys.size,
      durationMs: Date.now() - postWeatherPrepStartedAt,
      source: "simulatePastUsageDataset",
      memoryRssMb: getMemoryRssMb(),
    });

    // In serverless paths, retaining full per-day simulated diagnostics can trigger
    // memory pressure for large windows. Only collect when explicitly requested.
    const collectSimulatedDayResultsForDiagnostics = includeSimulatedDayResults;
    const compactSimulatedDayResults =
      buildInputs.mode === "MANUAL_TOTALS" && buildPathKind === "recalc" && retainedResultUtcDateKeys.size === 0;
    const collectSimulatedDayResultsDateKeys =
      retainedResultUtcDateKeys.size > 0 ? retainedResultUtcDateKeys : undefined;
    const pastDayCounts: {
      totalDays?: number;
      excludedDays?: number;
      leadingMissingDays?: number;
      simulatedDays?: number;
      referenceDaysUsed?: number;
      lowDataSyntheticContextUsed?: boolean;
      lowDataSyntheticMode?: "MANUAL_TOTALS" | "NEW_BUILD_ESTIMATE" | null;
      actualBackedReferencePoolUsed?: boolean;
      actualIntervalPayloadAttached?: boolean;
      actualIntervalPayloadCount?: number;
      suppressedActualIntervalPayloadCount?: number;
      exactIntervalReferencePreparationSkipped?: boolean;
      lowDataSummarizedSourceTruthUsed?: boolean;
      intervalUsageFingerprintIdentity?: string;
      trustedIntervalFingerprintDayCount?: number;
      excludedTravelVacantFingerprintDayCount?: number;
      excludedIncompleteMeterFingerprintDayCount?: number;
      excludedLeadingMissingFingerprintDayCount?: number;
      excludedOtherUntrustedFingerprintDayCount?: number;
      fingerprintMonthBucketsUsed?: string[];
      fingerprintWeekdayWeekendBucketsUsed?: string[];
      fingerprintWeatherBucketsUsed?: string[];
      fingerprintShapeSummaryByMonthDayType?: Record<string, Record<string, Record<string, number>>>;
    } = {};
    // Single shared day-level model (Section 21 / Phase 1): travel/vacant and Gap-Fill keep-ref modeled days
    // both flow through buildPastSimulatedBaselineV1 → simulatePastDay; stitch/compare remain downstream consumers only.
    const baselinePhaseStartedAt = Date.now();
    logSimPipelineEvent("day_simulation_baseline_build_start", {
      correlationId,
      houseId,
      sourceHouseId: actualHouseId !== houseId ? actualHouseId : undefined,
      userId,
      buildPathKind,
      actualIntervalsCount: actualIntervals.length,
      sourceActualIntervalsCount,
      actualIntervalPayloadSuppressed,
      actualIntervalPayloadSuppressedCount,
      actualIntervalPayloadAttached: actualIntervals.length > 0,
      explicitKeepRefLocalDateKeyCount: forceModeledOutputKeepReferencePoolDateKeysLocalSet.size,
      effectiveKeepRefLocalDateKeyCount: mergedKeepRefLocalDateKeys.size,
      lowDataSyntheticContextUsed: Boolean(lowDataSyntheticContext),
      lowDataSyntheticMode: lowDataSyntheticContext?.mode,
      lowDataUsesSummarizedSourceTruth: Boolean(lowDataSyntheticContext),
      source: "simulatePastUsageDataset",
      memoryRssMb: getMemoryRssMb(),
    });
    logSimPipelineEvent("buildPastSimulatedBaselineV1_start", {
      correlationId,
      houseId,
      sourceHouseId: actualHouseId !== houseId ? actualHouseId : undefined,
      userId,
      buildPathKind,
      actualIntervalsCount: actualIntervals.length,
      sourceActualIntervalsCount,
      actualIntervalPayloadSuppressed,
      actualIntervalPayloadSuppressedCount,
      actualIntervalPayloadAttached: actualIntervals.length > 0,
      explicitKeepRefLocalDateKeyCount: forceModeledOutputKeepReferencePoolDateKeysLocalSet.size,
      effectiveKeepRefLocalDateKeyCount: mergedKeepRefLocalDateKeys.size,
      lowDataSyntheticContextUsed: Boolean(lowDataSyntheticContext),
      lowDataSyntheticMode: lowDataSyntheticContext?.mode,
      lowDataUsesSummarizedSourceTruth: Boolean(lowDataSyntheticContext),
      source: "simulatePastUsageDataset",
      memoryRssMb: getMemoryRssMb(),
    });
    let patchedIntervals: Array<{ timestamp: string; kwh: number }>;
    let dayResults: SimulatedDayResult[];
    try {
      const baselineBuild = buildPastSimulatedBaselineV1({
        actualIntervals,
        canonicalDayStartsMs,
        excludedDateKeys,
        dateKeyFromTimestamp,
        getDayGridTimestamps,
        homeProfile: homeProfileForPast,
        applianceProfile: applianceProfileForPast,
        usageShapeProfile: usageShapeProfileSnap ?? undefined,
        timezoneForProfile: timezone ?? undefined,
        actualWxByDateKey: weatherByDateKeyForSimulation,
        _normalWxByDateKey: normalWxByDateKey,
        collectSimulatedDayResults: collectSimulatedDayResultsForDiagnostics,
        compactSimulatedDayResults,
        collectSimulatedDayResultsDateKeys,
        forceSimulateDateKeys: forcedUtcDateKeys.size > 0 ? forcedUtcDateKeys : undefined,
        forceModeledOutputKeepReferencePoolDateKeys:
          keepRefUtcDateKeys.size > 0 ? keepRefUtcDateKeys : undefined,
        emitAllIntervals,
        modeledKeepRefReasonCode: buildInputs.mode === "MANUAL_TOTALS" ? "MANUAL_CONSTRAINED_DAY" : "TEST_MODELED_KEEP_REF",
        defaultModeledReasonCode: buildInputs.mode === "MANUAL_TOTALS" ? "MANUAL_CONSTRAINED_DAY" : "INCOMPLETE_METER_DAY",
        modeledDaySelectionStrategy: buildInputs.mode === "SMT_BASELINE" ? "weather_donor_first" : "calendar_first",
        debug: { out: pastDayCounts as any },
        resolvedSimFingerprint: (buildInputs as SimulatorBuildInputsV1).resolvedSimFingerprint ?? undefined,
        lowDataSyntheticContext,
        observability: {
          correlationId,
          houseId,
          sourceHouseId: actualHouseId !== houseId ? actualHouseId : undefined,
          userId,
          buildPathKind,
          source: "simulatePastUsageDataset",
        },
      });
      patchedIntervals = baselineBuild.intervals;
      dayResults = baselineBuild.dayResults;
      const manualUsageInputMode =
        buildInputs.mode === "MANUAL_TOTALS"
          ? typeof (buildInputs as any)?.snapshots?.manualUsagePayload?.mode === "string" &&
            String((buildInputs as any).snapshots.manualUsagePayload.mode).trim()
            ? String((buildInputs as any).snapshots.manualUsagePayload.mode).trim()
            : Array.isArray((buildInputs as any)?.manualBillPeriods) && (buildInputs as any).manualBillPeriods.length > 0
              ? "MONTHLY"
              : "ANNUAL"
          : null;
      logSimPipelineEvent("day_simulation_post_baseline_return_received", {
        correlationId,
        houseId,
        sourceHouseId: actualHouseId !== houseId ? actualHouseId : undefined,
        userId,
        buildPathKind,
        mode: buildInputs.mode,
        manualUsageInputMode,
        lowDataSyntheticContextUsed: Boolean(lowDataSyntheticContext),
        intervalCount: patchedIntervals.length,
        simulatedDayResultsCount: dayResults.length,
        durationMs: Date.now() - baselinePhaseStartedAt,
        source: "simulatePastUsageDataset",
        memoryRssMb: getMemoryRssMb(),
      });
      if (buildInputs.mode === "MANUAL_TOTALS") {
        const renormalizeStartedAt = Date.now();
        logSimPipelineEvent("day_simulation_manual_bill_period_renormalization_start", {
          correlationId,
          houseId,
          sourceHouseId: actualHouseId !== houseId ? actualHouseId : undefined,
          userId,
          buildPathKind,
          mode: buildInputs.mode,
          manualUsageInputMode,
          lowDataSyntheticContextUsed: Boolean(lowDataSyntheticContext),
          intervalCount: patchedIntervals.length,
          simulatedDayResultsCount: dayResults.length,
          manualBillPeriodCount: eligibleManualBillPeriods.length,
          source: "simulatePastUsageDataset",
          memoryRssMb: getMemoryRssMb(),
        });
        try {
          renormalizeManualBillPeriodIntervals({
            patchedIntervals,
            dayResults,
            manualBillPeriods: eligibleManualBillPeriods,
            manualBillPeriodTotalsKwhById: buildInputs.manualBillPeriodTotalsKwhById ?? null,
            timezone: timezoneResolved || "UTC",
            correlationId,
          });
          logSimPipelineEvent("day_simulation_manual_bill_period_renormalization_success", {
            correlationId,
            houseId,
            sourceHouseId: actualHouseId !== houseId ? actualHouseId : undefined,
            userId,
            buildPathKind,
            mode: buildInputs.mode,
            manualUsageInputMode,
            lowDataSyntheticContextUsed: Boolean(lowDataSyntheticContext),
            intervalCount: patchedIntervals.length,
            simulatedDayResultsCount: dayResults.length,
            manualBillPeriodCount: eligibleManualBillPeriods.length,
            durationMs: Date.now() - renormalizeStartedAt,
            source: "simulatePastUsageDataset",
            memoryRssMb: getMemoryRssMb(),
          });
        } catch (renormalizeError) {
          const renormalizeErr =
            renormalizeError instanceof Error ? renormalizeError : new Error(String(renormalizeError));
          logSimPipelineEvent("day_simulation_manual_bill_period_renormalization_failure", {
            correlationId,
            houseId,
            sourceHouseId: actualHouseId !== houseId ? actualHouseId : undefined,
            userId,
            buildPathKind,
            mode: buildInputs.mode,
            manualUsageInputMode,
            lowDataSyntheticContextUsed: Boolean(lowDataSyntheticContext),
            intervalCount: patchedIntervals.length,
            simulatedDayResultsCount: dayResults.length,
            manualBillPeriodCount: eligibleManualBillPeriods.length,
            durationMs: Date.now() - renormalizeStartedAt,
            failureMessage: renormalizeErr.message,
            source: "simulatePastUsageDataset",
            memoryRssMb: getMemoryRssMb(),
          });
          throw renormalizeErr;
        }
      }
      logSimPipelineEvent("day_simulation_baseline_build_success", {
        correlationId,
        houseId,
        sourceHouseId: actualHouseId !== houseId ? actualHouseId : undefined,
        userId,
        buildPathKind,
        intervalCount: patchedIntervals.length,
        simulatedDayResultsCount: dayResults.length,
        referenceDaysUsed: pastDayCounts.referenceDaysUsed,
        lowDataSyntheticContextUsed:
          pastDayCounts.lowDataSyntheticContextUsed ?? Boolean(lowDataSyntheticContext) ?? undefined,
        lowDataSyntheticMode: pastDayCounts.lowDataSyntheticMode ?? lowDataSyntheticContext?.mode ?? undefined,
        actualBackedReferencePoolUsed:
          pastDayCounts.actualBackedReferencePoolUsed ?? (lowDataSyntheticContext ? false : undefined),
        actualIntervalsCount: actualIntervals.length,
        sourceActualIntervalsCount,
        actualIntervalPayloadSuppressed,
        actualIntervalPayloadSuppressedCount,
        exactIntervalReferencePreparationSkipped: pastDayCounts.exactIntervalReferencePreparationSkipped,
        lowDataUsesSummarizedSourceTruth:
          pastDayCounts.lowDataSummarizedSourceTruthUsed ?? Boolean(lowDataSyntheticContext) ?? undefined,
        durationMs: Date.now() - baselinePhaseStartedAt,
        source: "simulatePastUsageDataset",
        memoryRssMb: getMemoryRssMb(),
      });
      logSimPipelineEvent("buildPastSimulatedBaselineV1_success", {
        correlationId,
        houseId,
        sourceHouseId: actualHouseId !== houseId ? actualHouseId : undefined,
        userId,
        buildPathKind,
        intervalCount: patchedIntervals.length,
        simulatedDayResultsCount: dayResults.length,
        referenceDaysUsed: pastDayCounts.referenceDaysUsed,
        lowDataSyntheticContextUsed: pastDayCounts.lowDataSyntheticContextUsed,
        lowDataSyntheticMode: pastDayCounts.lowDataSyntheticMode,
        actualBackedReferencePoolUsed: pastDayCounts.actualBackedReferencePoolUsed,
        actualIntervalsCount: actualIntervals.length,
        sourceActualIntervalsCount,
        actualIntervalPayloadSuppressed,
        actualIntervalPayloadSuppressedCount,
        exactIntervalReferencePreparationSkipped: pastDayCounts.exactIntervalReferencePreparationSkipped,
        lowDataUsesSummarizedSourceTruth: pastDayCounts.lowDataSummarizedSourceTruthUsed,
        durationMs: Date.now() - baselinePhaseStartedAt,
        source: "simulatePastUsageDataset",
        memoryRssMb: getMemoryRssMb(),
      });
    } catch (baselineBuildError) {
      const baselineErr = baselineBuildError instanceof Error ? baselineBuildError : new Error(String(baselineBuildError));
      logSimPipelineEvent("day_simulation_baseline_build_failure", {
        correlationId,
        houseId,
        sourceHouseId: actualHouseId !== houseId ? actualHouseId : undefined,
        userId,
        buildPathKind,
        failureMessage: baselineErr.message,
        actualIntervalsCount: actualIntervals.length,
        sourceActualIntervalsCount,
        actualIntervalPayloadSuppressed,
        actualIntervalPayloadSuppressedCount,
        actualIntervalPayloadAttached: actualIntervals.length > 0,
        explicitKeepRefLocalDateKeyCount: forceModeledOutputKeepReferencePoolDateKeysLocalSet.size,
        effectiveKeepRefLocalDateKeyCount: mergedKeepRefLocalDateKeys.size,
        lowDataSyntheticContextUsed: Boolean(lowDataSyntheticContext),
        lowDataSyntheticMode: lowDataSyntheticContext?.mode,
        lowDataUsesSummarizedSourceTruth: Boolean(lowDataSyntheticContext),
        durationMs: Date.now() - baselinePhaseStartedAt,
        source: "simulatePastUsageDataset",
        memoryRssMb: getMemoryRssMb(),
      });
      logSimPipelineEvent("buildPastSimulatedBaselineV1_failure", {
        correlationId,
        houseId,
        sourceHouseId: actualHouseId !== houseId ? actualHouseId : undefined,
        userId,
        buildPathKind,
        failureMessage: baselineErr.message,
        actualIntervalsCount: actualIntervals.length,
        sourceActualIntervalsCount,
        actualIntervalPayloadSuppressed,
        actualIntervalPayloadSuppressedCount,
        actualIntervalPayloadAttached: actualIntervals.length > 0,
        explicitKeepRefLocalDateKeyCount: forceModeledOutputKeepReferencePoolDateKeysLocalSet.size,
        effectiveKeepRefLocalDateKeyCount: mergedKeepRefLocalDateKeys.size,
        lowDataSyntheticContextUsed: Boolean(lowDataSyntheticContext),
        lowDataSyntheticMode: lowDataSyntheticContext?.mode,
        lowDataUsesSummarizedSourceTruth: Boolean(lowDataSyntheticContext),
        durationMs: Date.now() - baselinePhaseStartedAt,
        source: "simulatePastUsageDataset",
        memoryRssMb: getMemoryRssMb(),
      });
      throw baselineErr;
    }
    logSimPipelineEvent("day_simulation_baseline_phase", {
      correlationId,
      houseId,
      userId,
      buildPathKind,
      durationMs: Date.now() - baselinePhaseStartedAt,
      memoryRssMb: getMemoryRssMb(),
      source: "simulatePastUsageDataset",
    });

    const referenceDaysCount =
      typeof pastDayCounts.totalDays === "number" && typeof pastDayCounts.simulatedDays === "number"
        ? pastDayCounts.totalDays - pastDayCounts.simulatedDays
        : undefined;
    const shapeMonthsPresent = canonicalMonths;

    const stitchCurveStartedAt = Date.now();
    logSimPipelineEvent("day_simulation_stitch_curve_start", {
      correlationId,
      houseId,
      userId,
      buildPathKind,
      source: "simulatePastUsageDataset",
      memoryRssMb: getMemoryRssMb(),
    });
    let stitchedCurve: ReturnType<typeof buildCurveFromPatchedIntervals>;
    logSimPipelineEvent("buildCurveFromPatchedIntervals_start", {
      correlationId,
      houseId,
      sourceHouseId: actualHouseId !== houseId ? actualHouseId : undefined,
      userId,
      buildPathKind,
      source: "simulatePastUsageDataset",
      memoryRssMb: getMemoryRssMb(),
    });
    try {
      stitchedCurve = buildCurveFromPatchedIntervals({
        startDate,
        endDate,
        intervals: patchedIntervals,
        correlationId,
      });
      logSimPipelineEvent("day_simulation_stitch_curve_success", {
        correlationId,
        houseId,
        sourceHouseId: actualHouseId !== houseId ? actualHouseId : undefined,
        userId,
        buildPathKind,
        intervalCount: Array.isArray(stitchedCurve.intervals) ? stitchedCurve.intervals.length : 0,
        durationMs: Date.now() - stitchCurveStartedAt,
        source: "simulatePastUsageDataset",
        memoryRssMb: getMemoryRssMb(),
      });
      logSimPipelineEvent("buildCurveFromPatchedIntervals_success", {
        correlationId,
        houseId,
        sourceHouseId: actualHouseId !== houseId ? actualHouseId : undefined,
        userId,
        buildPathKind,
        intervalCount: Array.isArray(stitchedCurve.intervals) ? stitchedCurve.intervals.length : 0,
        durationMs: Date.now() - stitchCurveStartedAt,
        source: "simulatePastUsageDataset",
        memoryRssMb: getMemoryRssMb(),
      });
    } catch (stitchCurveError) {
      const stitchErr = stitchCurveError instanceof Error ? stitchCurveError : new Error(String(stitchCurveError));
      logSimPipelineEvent("day_simulation_stitch_curve_failure", {
        correlationId,
        houseId,
        sourceHouseId: actualHouseId !== houseId ? actualHouseId : undefined,
        userId,
        buildPathKind,
        failureMessage: stitchErr.message,
        durationMs: Date.now() - stitchCurveStartedAt,
        source: "simulatePastUsageDataset",
        memoryRssMb: getMemoryRssMb(),
      });
      logSimPipelineEvent("buildCurveFromPatchedIntervals_failure", {
        correlationId,
        houseId,
        sourceHouseId: actualHouseId !== houseId ? actualHouseId : undefined,
        userId,
        buildPathKind,
        failureMessage: stitchErr.message,
        durationMs: Date.now() - stitchCurveStartedAt,
        source: "simulatePastUsageDataset",
        memoryRssMb: getMemoryRssMb(),
      });
      throw stitchErr;
    }
    // `buildCurveFromPatchedIntervals` copies into `stitchedCurve.intervals`; release the engine
    // output array before dataset construction to lower peak heap on full-window runs.
    patchedIntervals.length = 0;

    const skipHeavyDatasetInsights = emitAllIntervals === false && buildPathKind === "lab_validation";

    const stitchDatasetStartedAt = Date.now();
    logSimPipelineEvent("day_simulation_stitch_dataset_start", {
      correlationId,
      houseId,
      userId,
      buildPathKind,
      source: "simulatePastUsageDataset",
      memoryRssMb: getMemoryRssMb(),
    });
    let dataset: ReturnType<typeof buildSimulatedUsageDatasetFromCurve>;
    logSimPipelineEvent("buildSimulatedUsageDatasetFromCurve_start", {
      correlationId,
      houseId,
      sourceHouseId: actualHouseId !== houseId ? actualHouseId : undefined,
      userId,
      buildPathKind,
      source: "simulatePastUsageDataset",
      memoryRssMb: getMemoryRssMb(),
    });
    try {
      dataset = buildSimulatedUsageDatasetFromCurve(
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
          skipHeavyInsights: skipHeavyDatasetInsights,
          correlationId,
        }
      );
      logSimPipelineEvent("day_simulation_stitch_dataset_success", {
        correlationId,
        houseId,
        sourceHouseId: actualHouseId !== houseId ? actualHouseId : undefined,
        userId,
        buildPathKind,
        dailyRowCount: Array.isArray(dataset.daily) ? dataset.daily.length : 0,
        intervalCount: Array.isArray(dataset?.series?.intervals15) ? dataset.series.intervals15.length : 0,
        durationMs: Date.now() - stitchDatasetStartedAt,
        source: "simulatePastUsageDataset",
        memoryRssMb: getMemoryRssMb(),
      });
      logSimPipelineEvent("buildSimulatedUsageDatasetFromCurve_success", {
        correlationId,
        houseId,
        sourceHouseId: actualHouseId !== houseId ? actualHouseId : undefined,
        userId,
        buildPathKind,
        dailyRowCount: Array.isArray(dataset.daily) ? dataset.daily.length : 0,
        intervalCount: Array.isArray(dataset?.series?.intervals15) ? dataset.series.intervals15.length : 0,
        durationMs: Date.now() - stitchDatasetStartedAt,
        source: "simulatePastUsageDataset",
        memoryRssMb: getMemoryRssMb(),
      });
    } catch (stitchDatasetError) {
      const stitchDatasetErr =
        stitchDatasetError instanceof Error ? stitchDatasetError : new Error(String(stitchDatasetError));
      logSimPipelineEvent("day_simulation_stitch_dataset_failure", {
        correlationId,
        houseId,
        sourceHouseId: actualHouseId !== houseId ? actualHouseId : undefined,
        userId,
        buildPathKind,
        failureMessage: stitchDatasetErr.message,
        durationMs: Date.now() - stitchDatasetStartedAt,
        source: "simulatePastUsageDataset",
        memoryRssMb: getMemoryRssMb(),
      });
      logSimPipelineEvent("buildSimulatedUsageDatasetFromCurve_failure", {
        correlationId,
        houseId,
        sourceHouseId: actualHouseId !== houseId ? actualHouseId : undefined,
        userId,
        buildPathKind,
        failureMessage: stitchDatasetErr.message,
        durationMs: Date.now() - stitchDatasetStartedAt,
        source: "simulatePastUsageDataset",
        memoryRssMb: getMemoryRssMb(),
      });
      throw stitchDatasetErr;
    }

    const projectionShapingStartedAt = Date.now();
    logSimPipelineEvent("day_simulation_projection_shaping_start", {
      correlationId,
      houseId,
      sourceHouseId: actualHouseId !== houseId ? actualHouseId : undefined,
      userId,
      buildPathKind,
      mode: buildInputs.mode,
      lowDataSyntheticContextUsed: Boolean(lowDataSyntheticContext),
      intervalCount: Array.isArray(dataset?.series?.intervals15) ? dataset.series.intervals15.length : 0,
      dayCount: Array.isArray(dataset?.daily) ? dataset.daily.length : 0,
      monthCount: Array.isArray(dataset?.monthly) ? dataset.monthly.length : 0,
      source: "simulatePastUsageDataset",
      memoryRssMb: getMemoryRssMb(),
    });
    try {
      if (dataset && typeof dataset === "object") {
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
          sharedWeatherTimelineContract: smtBaselineStrictWeather
            ? "last365_actual_strict"
            : "last365_actual_with_normal_gapfill",
          weatherNormalGapFillDateKeyCount: smtBaselineStrictWeather ? undefined : normalFilledDateKeyCount,
          lowDataSharedPastAdapter: isLowDataSharedPastMode ? true : undefined,
          lowDataShapeAdapterUsed: lowDataShapeAdapterUsed ? true : undefined,
          /** Low-data modes can still score explicit keep-ref days, but no longer auto-expand the entire window. */
          lowDataKeepRefModeledDays: keepRefUtcDateKeys.size > 0 ? true : undefined,
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
          sourceActualIntervalsCount,
          actualIntervalPayloadSuppressed,
          actualIntervalPayloadSuppressedCount,
          actualIntervalPayloadAttached: actualIntervals.length > 0,
          referenceDaysCount,
          lowDataSyntheticContextUsed: pastDayCounts.lowDataSyntheticContextUsed,
          lowDataSyntheticMode: pastDayCounts.lowDataSyntheticMode,
          actualBackedReferencePoolUsed: pastDayCounts.actualBackedReferencePoolUsed,
          exactIntervalReferencePreparationSkipped: pastDayCounts.exactIntervalReferencePreparationSkipped,
          lowDataSummarizedSourceTruthUsed: pastDayCounts.lowDataSummarizedSourceTruthUsed,
          explicitKeepRefLocalDateKeyCount: forceModeledOutputKeepReferencePoolDateKeysLocalSet.size,
          effectiveKeepRefLocalDateKeyCount: mergedKeepRefLocalDateKeys.size,
          shapeMonthsPresent,
          excludedDateKeysCount: excludedDateKeys.size,
          excludedDateKeysFingerprint,
          leadingMissingDaysCount: pastDayCounts.leadingMissingDays ?? undefined,
          trustedIntervalFingerprintDayCount: pastDayCounts.trustedIntervalFingerprintDayCount,
          intervalUsageFingerprintIdentity: pastDayCounts.intervalUsageFingerprintIdentity,
          excludedTravelVacantFingerprintDayCount: pastDayCounts.excludedTravelVacantFingerprintDayCount,
          excludedIncompleteMeterFingerprintDayCount: pastDayCounts.excludedIncompleteMeterFingerprintDayCount,
          excludedLeadingMissingFingerprintDayCount: pastDayCounts.excludedLeadingMissingFingerprintDayCount,
          excludedOtherUntrustedFingerprintDayCount: pastDayCounts.excludedOtherUntrustedFingerprintDayCount,
          fingerprintMonthBucketsUsed: pastDayCounts.fingerprintMonthBucketsUsed,
          fingerprintWeekdayWeekendBucketsUsed: pastDayCounts.fingerprintWeekdayWeekendBucketsUsed,
          fingerprintWeatherBucketsUsed: pastDayCounts.fingerprintWeatherBucketsUsed,
          fingerprintShapeSummaryByMonthDayType: pastDayCounts.fingerprintShapeSummaryByMonthDayType,
          weatherLogicMode: provenance.weatherLogicMode,
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
            ? smtBaselineStrictWeather
              ? `Weather integrated in shared past path (${provenance.weatherSourceSummary}).`
              : `Weather integrated in shared past path (${provenance.weatherSourceSummary}${
                  normalFilledDateKeyCount > 0
                    ? `; normal-climate gap-fill ${normalFilledDateKeyCount} day(s)`
                    : ""
                }).`
            : "Weather unavailable for shared past path.",
          simulatedDayDiagnosticsSample,
          gapfillForceModeledKeepRefLocalDateKeys:
            forceModeledOutputKeepReferencePoolDateKeysLocalSet.size > 0
              ? Array.from(forceModeledOutputKeepReferencePoolDateKeysLocalSet).sort()
              : undefined,
          gapfillForceModeledKeepRefUtcKeyCount: keepRefUtcDateKeys.size,
          resolvedSimFingerprint: (buildInputs as { resolvedSimFingerprint?: unknown }).resolvedSimFingerprint ?? undefined,
          monthlyTargetConstructionDiagnostics:
            (buildInputs as { monthlyTargetConstructionDiagnostics?: unknown }).monthlyTargetConstructionDiagnostics ?? null,
          manualMonthlyInputState:
            (buildInputs as { manualMonthlyInputState?: unknown }).manualMonthlyInputState ?? null,
          manualMonthlyWeatherEvidenceSummary: manualLowDataWeatherEvidenceSummary ?? null,
          sharedProducerPathUsed:
            (buildInputs as { sharedProducerPathUsed?: unknown }).sharedProducerPathUsed === false ? false : true,
        } as unknown as typeof dataset.meta;
      }
      logSimPipelineEvent("day_simulation_projection_shaping_success", {
        correlationId,
        houseId,
        sourceHouseId: actualHouseId !== houseId ? actualHouseId : undefined,
        userId,
        buildPathKind,
        mode: buildInputs.mode,
        lowDataSyntheticContextUsed: Boolean(lowDataSyntheticContext),
        intervalCount: Array.isArray(dataset?.series?.intervals15) ? dataset.series.intervals15.length : 0,
        dayCount: Array.isArray(dataset?.daily) ? dataset.daily.length : 0,
        monthCount: Array.isArray(dataset?.monthly) ? dataset.monthly.length : 0,
        durationMs: Date.now() - projectionShapingStartedAt,
        source: "simulatePastUsageDataset",
        memoryRssMb: getMemoryRssMb(),
      });
    } catch (projectionShapingError) {
      const projectionErr =
        projectionShapingError instanceof Error ? projectionShapingError : new Error(String(projectionShapingError));
      logSimPipelineEvent("day_simulation_projection_shaping_failure", {
        correlationId,
        houseId,
        sourceHouseId: actualHouseId !== houseId ? actualHouseId : undefined,
        userId,
        buildPathKind,
        mode: buildInputs.mode,
        lowDataSyntheticContextUsed: Boolean(lowDataSyntheticContext),
        intervalCount: Array.isArray(dataset?.series?.intervals15) ? dataset.series.intervals15.length : 0,
        dayCount: Array.isArray(dataset?.daily) ? dataset.daily.length : 0,
        monthCount: Array.isArray(dataset?.monthly) ? dataset.monthly.length : 0,
        durationMs: Date.now() - projectionShapingStartedAt,
        failureMessage: projectionErr.message,
        source: "simulatePastUsageDataset",
        memoryRssMb: getMemoryRssMb(),
      });
      throw projectionErr;
    }

    logSimPipelineEvent("day_simulation_return_ready", {
      correlationId,
      houseId,
      sourceHouseId: actualHouseId !== houseId ? actualHouseId : undefined,
      userId,
      buildPathKind,
      mode: buildInputs.mode,
      lowDataSyntheticContextUsed: Boolean(lowDataSyntheticContext),
      intervalCount: Array.isArray(dataset?.series?.intervals15) ? dataset.series.intervals15.length : 0,
      dayCount: Array.isArray(dataset?.daily) ? dataset.daily.length : 0,
      monthCount: Array.isArray(dataset?.monthly) ? dataset.monthly.length : 0,
      durationMs: Date.now() - daySimStartedAt,
      source: "simulatePastUsageDataset",
      memoryRssMb: getMemoryRssMb(),
    });
    logSimPipelineEvent("day_simulation_success", {
      correlationId,
      houseId,
      userId,
      buildPathKind,
      durationMs: Date.now() - daySimStartedAt,
      memoryRssMb: getMemoryRssMb(),
      source: "simulatePastUsageDataset",
    });
    return {
      dataset,
      meta: (dataset?.meta as Record<string, unknown>) ?? {},
      pastDayCounts,
      shapeMonthsPresent,
      actualWxByDateKey: weatherByDateKeyForSimulation,
      selectedWeatherByDateKey: weatherByDateKeyForSimulation,
      // lab_validation (Gap-Fill / shared compare): dataset already carries `series.intervals15`;
      // omitting duplicate `SimulatedCurve` cuts peak heap. cold_build/recalc still return it.
      stitchedCurve: buildPathKind === "lab_validation" ? undefined : stitchedCurve,
      simulatedDayResults: includeSimulatedDayResults ? dayResults : undefined,
    };
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    logSimPipelineEvent("day_simulation_failure", {
      correlationId,
      houseId,
      userId,
      failureMessage: err.message,
      durationMs: Date.now() - daySimStartedAt,
      memoryRssMb: getMemoryRssMb(),
      source: "simulatePastUsageDataset",
    });
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
      selectedWeatherByDateKey: sharedResult.selectedWeatherByDateKey ?? new Map(),
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
    // Gap-Fill union runs only need stitched intervals for **simulated** days (travel/excluded,
    // incomplete, keep-ref scored days, etc.). Omitting passthrough actual intervals for the rest
    // of the identity window cuts patched interval array size by an order of magnitude and is the
    // main lever against Vercel OOM on compare_core.
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
      emitAllIntervals: false,
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
      selectedWeatherByDateKey: sharedResult.selectedWeatherByDateKey,
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