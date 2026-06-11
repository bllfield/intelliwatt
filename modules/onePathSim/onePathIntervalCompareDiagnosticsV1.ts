import type { TravelRange } from "@/modules/simulatedUsage/types";
import { resolveReportedCoverageWindow } from "@/lib/usage/canonicalMetadataWindow";

function asTravelDateKey(value: unknown): string | null {
  const text = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function normalizeTravelRangesForDiagnostics(
  ranges: ReadonlyArray<{ startDate?: unknown; endDate?: unknown }> | null | undefined
): TravelRange[] {
  const out: TravelRange[] = [];
  const seen = new Set<string>();
  for (const range of ranges ?? []) {
    const startDate = asTravelDateKey(range?.startDate);
    const endDate = asTravelDateKey(range?.endDate);
    if (!startDate || !endDate) continue;
    const key = `${startDate}|${endDate}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ startDate, endDate });
  }
  return out.sort((left, right) =>
    left.startDate === right.startDate ? left.endDate.localeCompare(right.endDate) : left.startDate.localeCompare(right.startDate)
  );
}

function filterTravelRangesToCoverageWindow(
  ranges: ReadonlyArray<{ startDate?: unknown; endDate?: unknown }> | null | undefined,
  window: { startDate?: unknown; endDate?: unknown } | null | undefined
): TravelRange[] {
  const normalized = normalizeTravelRangesForDiagnostics(ranges);
  const windowStart = asTravelDateKey(window?.startDate);
  const windowEnd = asTravelDateKey(window?.endDate);
  if (!windowStart || !windowEnd || windowStart > windowEnd) {
    return normalized;
  }
  const clipped: TravelRange[] = [];
  for (const range of normalized) {
    if (range.endDate < windowStart || range.startDate > windowEnd) continue;
    clipped.push({
      startDate: range.startDate < windowStart ? windowStart : range.startDate,
      endDate: range.endDate > windowEnd ? windowEnd : range.endDate,
    });
  }
  return normalizeTravelRangesForDiagnostics(clipped);
}

export type OnePathIntervalSourceType = "SMT" | "GREEN_BUTTON";

export type OnePathDiagnosticConfidence =
  | "clean_holdout"
  | "compare_only_not_holdout"
  | "posthoc_diagnostic"
  | "unknown";

export type OnePathWeatherBucket =
  | "extreme_cold"
  | "cold"
  | "mild"
  | "warm"
  | "hot"
  | "extreme_hot"
  | "unknown";

export type OnePathIntervalDiagnosticsGuardrails = {
  diagnosticOnly: true;
  simulationMutated: false;
  validationPolicyMutated: false;
  userFacingResultMutated: false;
  planRankingMutated: false;
};

export type OnePathIntervalCompareBucketSummary = {
  dayCount: number;
  actualTotalKwh: number;
  simulatedTotalKwh: number;
  deltaKwh: number;
  percentBias: number | null;
  wape: number | null;
  meanAbsoluteDailyDeltaKwh: number | null;
  medianAbsoluteDailyDeltaKwh: number | null;
  maxAbsoluteDailyDeltaKwh: number | null;
};

export type OnePathIntervalDailyCompareDay = {
  date: string;
  actualKwh: number | null;
  simulatedKwh: number | null;
  deltaKwh: number | null;
  absDeltaKwh: number | null;
  percentDelta: number | null;
  validationDay: boolean;
  cleanHoldoutDay: boolean;
  diagnosticConfidence: OnePathDiagnosticConfidence;
  weekdayWeekend: "weekday" | "weekend" | null;
  month: string | null;
  season: "winter" | "summer" | "shoulder" | null;
  billPeriodId: string | null;
  travelVacantFlag: boolean;
  excludedFromScoring: boolean;
  minTemp: number | null;
  maxTemp: number | null;
  avgTemp: number | null;
  heatingDegreeDays: number | null;
  coolingDegreeDays: number | null;
  weatherBucket: OnePathWeatherBucket;
  weatherSource: string | null;
  weatherIdentity: string | null;
};

export type OnePathWeatherMissDiagnostics = {
  weatherDiagnosticsAvailable: boolean;
  missingWeatherFields: string[];
  hotDayBias: number | null;
  extremeHotDayBias: number | null;
  coldDayBias: number | null;
  extremeColdDayBias: number | null;
  mildDayBias: number | null;
  actualKwhPerCoolingDegreeDay: number | null;
  simulatedKwhPerCoolingDegreeDay: number | null;
  coolingSensitivityDelta: number | null;
  actualKwhPerHeatingDegreeDay: number | null;
  simulatedKwhPerHeatingDegreeDay: number | null;
  heatingSensitivityDelta: number | null;
};

export type OnePathValidationIntervalCurveDay = {
  date: string;
  dayType: "weekday" | "weekend";
  validationDay: boolean;
  posthocTopMissDay: boolean;
  diagnosticConfidence: OnePathDiagnosticConfidence;
  slotCountActual: number;
  slotCountSimulated: number;
  actualDailyTotalKwh: number | null;
  simulatedDailyTotalKwh: number | null;
  dailyTotalDeltaKwh: number | null;
  rawIntervalWape: number | null;
  intervalMae: number | null;
  normalizedShapeError: number | null;
  shapeCorrelation: number | null;
  peakActualKwh: number | null;
  peakSimulatedKwh: number | null;
  peakActualLocalTime: string | null;
  peakSimulatedLocalTime: string | null;
  peakTimingErrorMinutes: number | null;
  overnight: { actual: number; simulated: number; delta: number };
  morning: { actual: number; simulated: number; delta: number };
  afternoon: { actual: number; simulated: number; delta: number };
  evening: { actual: number; simulated: number; delta: number };
  todBuckets: {
    overnight: { actualKwh: number; simulatedKwh: number; deltaKwh: number; shareActual: number | null; shareSimulated: number | null };
    morning: { actualKwh: number; simulatedKwh: number; deltaKwh: number; shareActual: number | null; shareSimulated: number | null };
    afternoon: { actualKwh: number; simulatedKwh: number; deltaKwh: number; shareActual: number | null; shareSimulated: number | null };
    evening: { actualKwh: number; simulatedKwh: number; deltaKwh: number; shareActual: number | null; shareSimulated: number | null };
  };
  actual96SlotShape: number[];
  simulated96SlotShape: number[];
  actualIntervals: Array<{ timestamp: string; kwh: number }>;
  simulatedIntervals: Array<{ timestamp: string; kwh: number }>;
  actualIntervalsLoadedForCompareOnly: true;
  actualIntervalsPassedToSimulator: false;
  actualIntervalsUsedAsDonorForThisDay: boolean | "unknown";
  cleanHoldoutDay: boolean;
  exactCurveMatchFlag: boolean;
  nearExactCurveMatchScore: number | null;
};

export type OnePathTodBucketDiagnostic = {
  bucket: "overnight" | "morning" | "afternoon" | "evening";
  bucketActualKwh: number;
  bucketSimulatedKwh: number;
  bucketDeltaKwh: number;
  bucketPercentDelta: number | null;
  bucketShareActual: number | null;
  bucketShareSimulated: number | null;
};

export type OnePathExactMatchDiagnostics = {
  evaluatedDayCount: number;
  exactCurveMatchDayCount: number;
  nearExactCurveMatchDayCount: number;
  cleanHoldoutExactMatchCount: number;
  nonHoldoutExactMatchCount: number;
  skippedReason: string | null;
  actualIntervalsAvailableForCompare: boolean;
  simulatedIntervalsAvailableForCompare: boolean;
  days: Array<{
    date: string;
    diagnosticConfidence: OnePathDiagnosticConfidence;
    exactCurveMatchFlag: boolean;
    nearExactCurveMatchScore: number | null;
    cleanHoldoutDay: boolean;
  }>;
};

export type OnePathIntervalTruthInterpretation = {
  intervalTruthPassthrough: boolean;
  simulatedDailyRowsAreActualBacked: boolean;
  modelAccuracyTest: boolean;
  usefulFor: string;
  notUsefulFor: string;
};

export type OnePathWorstDayDiagnosticEntry = {
  date: string;
  actualKwh: number | null;
  simulatedKwh: number | null;
  deltaKwh: number | null;
  absDeltaKwh: number | null;
  percentDelta: number | null;
  weatherBucket: OnePathWeatherBucket;
  maxTemp: number | null;
  minTemp: number | null;
  avgTemp: number | null;
  heatingDegreeDays: number | null;
  coolingDegreeDays: number | null;
  weekdayWeekend: "weekday" | "weekend" | null;
  travelVacantFlag: boolean;
  validationDay: boolean;
  diagnosticConfidence: OnePathDiagnosticConfidence;
  likelyCauseTags: string[];
};

export type OnePathIntervalDiagnosticsV1 = {
  version: "v1";
  available: boolean;
  unavailableReason: string | null;
  sourceType: OnePathIntervalSourceType | null;
  guardrails: OnePathIntervalDiagnosticsGuardrails;
  dailyCompare: {
    days: OnePathIntervalDailyCompareDay[];
    summaryBuckets: Record<string, OnePathIntervalCompareBucketSummary>;
  };
  weatherMissDiagnostics: OnePathWeatherMissDiagnostics;
  validationIntervalCurveDiagnostics: {
    available: boolean;
    unavailableReason: string | null;
    selectedValidationDayCount: number;
    includedPosthocDayCount: number;
    includePosthocTopMissIntervalCurves: boolean;
    selectedValidationDayKeysUsed: string[];
    posthocTopMissDayKeysUsed: string[];
    actualIntervalRowsFound: number;
    simulatedIntervalRowsFound: number;
    days: OnePathValidationIntervalCurveDay[];
  };
  todBucketDiagnostics: {
    available: boolean;
    unavailableReason: string | null;
    validationDaysOnly: true;
    buckets: OnePathTodBucketDiagnostic[];
  };
  exactMatchDiagnostics: OnePathExactMatchDiagnostics;
  intervalTruthInterpretation: OnePathIntervalTruthInterpretation;
  worstDayDiagnostics: {
    topOverSimDays: OnePathWorstDayDiagnosticEntry[];
    topUnderSimDays: OnePathWorstDayDiagnosticEntry[];
    topAbsoluteDailyMisses: OnePathWorstDayDiagnosticEntry[];
    topIntervalShapeMisses: OnePathWorstDayDiagnosticEntry[];
    topPeakTimingMisses: OnePathWorstDayDiagnosticEntry[];
  };
};

export type BuildOnePathIntervalCompareDiagnosticsV1Args = {
  sourceType: OnePathIntervalSourceType;
  actualDataset?: unknown;
  simulatedDataset?: unknown;
  validationDayKeys?: string[];
  validationHoldoutProofOk?: boolean;
  travelRanges?: TravelRange[];
  weatherIdentity?: string | null;
  timezone?: string | null;
  includePosthocTopMissIntervalCurves?: boolean;
  posthocTopMissDayCount?: number;
};

const GUARDRAILS: OnePathIntervalDiagnosticsGuardrails = {
  diagnosticOnly: true,
  simulationMutated: false,
  validationPolicyMutated: false,
  userFacingResultMutated: false,
  planRankingMutated: false,
};

function round2(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function seasonForMonth(monthKey: string): "winter" | "summer" | "shoulder" {
  const month = Number(monthKey.slice(5, 7));
  if ([12, 1, 2].includes(month)) return "winter";
  if ([6, 7, 8].includes(month)) return "summer";
  return "shoulder";
}

function weekdayWeekend(date: string): "weekday" | "weekend" {
  const day = new Date(`${date}T12:00:00.000Z`).getUTCDay();
  return day === 0 || day === 6 ? "weekend" : "weekday";
}

function dateKeyInTimezone(tsIso: string, tz: string): string {
  try {
    const d = new Date(tsIso);
    if (!Number.isFinite(d.getTime())) return tsIso.slice(0, 10);
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = fmt.formatToParts(d);
    const y = parts.find((part) => part.type === "year")?.value ?? "";
    const m = parts.find((part) => part.type === "month")?.value ?? "";
    const day = parts.find((part) => part.type === "day")?.value ?? "";
    return `${y}-${m}-${day}`;
  } catch {
    return tsIso.slice(0, 10);
  }
}

function localSlot96InTimezone(tsIso: string, tz: string): number {
  try {
    const d = new Date(tsIso);
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    }).formatToParts(d);
    const hour = parseInt(parts.find((part) => part.type === "hour")?.value ?? "0", 10);
    const minute = parseInt(parts.find((part) => part.type === "minute")?.value ?? "0", 10);
    return Math.min(95, Math.max(0, hour * 4 + Math.floor(minute / 15)));
  } catch {
    const d = new Date(tsIso);
    return Math.min(95, Math.max(0, d.getUTCHours() * 4 + Math.floor(d.getUTCMinutes() / 15)));
  }
}

function hhmmFromSlot(slot: number): string {
  const hour = Math.floor(slot / 4);
  const minute = (slot % 4) * 15;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function readDailyRows(dataset: unknown): Map<string, number> {
  const out = new Map<string, number>();
  const daily = Array.isArray((dataset as any)?.daily) ? (dataset as any).daily : [];
  for (const row of daily) {
    const date = String(row?.date ?? "").slice(0, 10);
    const kwh = Number(row?.kwh ?? Number.NaN);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(kwh)) continue;
    out.set(date, (out.get(date) ?? 0) + kwh);
  }
  return out;
}

type WeatherRecord = {
  meanTemp: number | null;
  maxTemp: number | null;
  minTemp: number | null;
  hdd: number | null;
  cdd: number | null;
  source: string | null;
};

function readWeatherRecord(raw: unknown): WeatherRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  return {
    meanTemp:
      typeof rec.meanTempF === "number"
        ? rec.meanTempF
        : typeof rec.tAvgF === "number"
          ? rec.tAvgF
          : null,
    maxTemp: typeof rec.tMaxF === "number" ? rec.tMaxF : null,
    minTemp: typeof rec.tMinF === "number" ? rec.tMinF : null,
    hdd: typeof rec.hdd === "number" ? rec.hdd : typeof rec.hdd65 === "number" ? rec.hdd65 : null,
    cdd: typeof rec.cdd === "number" ? rec.cdd : typeof rec.cdd65 === "number" ? rec.cdd65 : null,
    source: typeof rec.source === "string" ? rec.source : null,
  };
}

function buildWeatherMap(dataset: unknown): Map<string, WeatherRecord> {
  const out = new Map<string, WeatherRecord>();
  const dailyWeather = (dataset as any)?.dailyWeather;
  if (!dailyWeather || typeof dailyWeather !== "object" || Array.isArray(dailyWeather)) return out;
  for (const [dateKey, raw] of Object.entries(dailyWeather as Record<string, unknown>)) {
    const date = String(dateKey).slice(0, 10);
    const parsed = readWeatherRecord(raw);
    if (parsed && /^\d{4}-\d{2}-\d{2}$/.test(date)) out.set(date, parsed);
  }
  return out;
}

function classifyWeatherBucket(weather: WeatherRecord | null | undefined): OnePathWeatherBucket {
  if (!weather || weather.meanTemp == null) return "unknown";
  const mean = weather.meanTemp;
  if (mean <= 25) return "extreme_cold";
  if (mean <= 45) return "cold";
  if (mean <= 65) return "mild";
  if (mean <= 78) return "warm";
  if (mean <= 90) return "hot";
  return "extreme_hot";
}

function buildTravelDaySet(
  ranges: TravelRange[] | undefined,
  coverageWindow?: { startDate: string; endDate: string } | null
): Set<string> {
  const activeRanges = filterTravelRangesToCoverageWindow(ranges, coverageWindow);
  const out = new Set<string>();
  for (const range of activeRanges) {
    const start = new Date(`${range.startDate}T00:00:00.000Z`);
    const end = new Date(`${range.endDate}T00:00:00.000Z`);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) continue;
    for (let ts = start.getTime(); ts <= end.getTime(); ts += 86400000) {
      out.add(new Date(ts).toISOString().slice(0, 10));
    }
  }
  return out;
}

function resolveDiagnosticsCoverageWindow(args: {
  actualDataset?: unknown;
  simulatedDataset?: unknown;
}): { startDate: string; endDate: string } | null {
  const actualSummary = (args.actualDataset as any)?.summary;
  const simulatedSummary = (args.simulatedDataset as any)?.summary;
  const actualMeta = (args.actualDataset as any)?.meta;
  const simulatedMeta = (args.simulatedDataset as any)?.meta;
  const fallbackStart =
    String(actualSummary?.start ?? simulatedSummary?.start ?? actualMeta?.coverageStart ?? simulatedMeta?.coverageStart ?? "").slice(0, 10);
  const fallbackEnd =
    String(actualSummary?.end ?? simulatedSummary?.end ?? actualMeta?.coverageEnd ?? simulatedMeta?.coverageEnd ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fallbackStart) || !/^\d{4}-\d{2}-\d{2}$/.test(fallbackEnd)) {
    return null;
  }
  return resolveReportedCoverageWindow({
    dataset: args.simulatedDataset ?? args.actualDataset,
    fallbackStartDate: fallbackStart,
    fallbackEndDate: fallbackEnd,
  });
}

function computeBucketSummary(days: OnePathIntervalDailyCompareDay[]): OnePathIntervalCompareBucketSummary {
  const comparable = days.filter((day) => day.actualKwh != null && day.simulatedKwh != null);
  const actualTotalKwh = round2(comparable.reduce((sum, day) => sum + (day.actualKwh ?? 0), 0)) ?? 0;
  const simulatedTotalKwh = round2(comparable.reduce((sum, day) => sum + (day.simulatedKwh ?? 0), 0)) ?? 0;
  const deltaKwh = round2(simulatedTotalKwh - actualTotalKwh) ?? 0;
  const absDeltas = comparable
    .map((day) => day.absDeltaKwh)
    .filter((value): value is number => value != null);
  const sortedAbs = [...absDeltas].sort((a, b) => a - b);
  const dayCount = comparable.length;
  const wape = actualTotalKwh > 1e-6 ? round2(absDeltas.reduce((sum, value) => sum + value, 0) / actualTotalKwh) : null;
  const percentBias =
    actualTotalKwh > 1e-6 ? round2(((simulatedTotalKwh - actualTotalKwh) / actualTotalKwh) * 100) : null;
  return {
    dayCount,
    actualTotalKwh,
    simulatedTotalKwh,
    deltaKwh,
    percentBias,
    wape,
    meanAbsoluteDailyDeltaKwh:
      absDeltas.length > 0 ? round2(absDeltas.reduce((sum, value) => sum + value, 0) / absDeltas.length) : null,
    medianAbsoluteDailyDeltaKwh:
      sortedAbs.length === 0
        ? null
        : round2(
            sortedAbs.length % 2 === 1
              ? sortedAbs[(sortedAbs.length - 1) / 2]!
              : (sortedAbs[sortedAbs.length / 2 - 1]! + sortedAbs[sortedAbs.length / 2]!) / 2
          ),
    maxAbsoluteDailyDeltaKwh: sortedAbs.length > 0 ? round2(sortedAbs[sortedAbs.length - 1]!) : null,
  };
}

function resolveDiagnosticConfidence(args: {
  date: string;
  validationDaySet: Set<string>;
  validationHoldoutProofOk: boolean;
  posthocDateSet: Set<string>;
}): { validationDay: boolean; cleanHoldoutDay: boolean; diagnosticConfidence: OnePathDiagnosticConfidence } {
  const validationDay = args.validationDaySet.has(args.date);
  const cleanHoldoutDay = validationDay && args.validationHoldoutProofOk;
  if (args.posthocDateSet.has(args.date)) {
    return { validationDay, cleanHoldoutDay, diagnosticConfidence: "posthoc_diagnostic" };
  }
  if (cleanHoldoutDay) {
    return { validationDay, cleanHoldoutDay, diagnosticConfidence: "clean_holdout" };
  }
  if (validationDay) {
    return { validationDay, cleanHoldoutDay, diagnosticConfidence: "compare_only_not_holdout" };
  }
  return { validationDay, cleanHoldoutDay, diagnosticConfidence: "compare_only_not_holdout" };
}

type IntervalPoint = { timestamp: string; kwh: number };

function readIntervalPoints(dataset: unknown): IntervalPoint[] {
  const rows = Array.isArray((dataset as any)?.series?.intervals15) ? (dataset as any).series.intervals15 : [];
  return rows
    .map((row: any) => ({
      timestamp: String(row?.timestamp ?? "").trim(),
      kwh: Number(row?.kwh ?? Number.NaN),
    }))
    .filter((row: IntervalPoint) => row.timestamp && Number.isFinite(row.kwh));
}

function intervalsByDateAndSlot(
  rows: IntervalPoint[],
  timezone: string,
  selectedDateKeys: Set<string>
): Map<string, number[]> {
  const byDate = new Map<string, number[]>();
  for (const row of rows) {
    const localDate = dateKeyInTimezone(row.timestamp, timezone);
    if (!selectedDateKeys.has(localDate)) continue;
    const slot = localSlot96InTimezone(row.timestamp, timezone);
    const bucket = byDate.get(localDate) ?? Array.from({ length: 96 }, () => 0);
    bucket[slot] += row.kwh;
    byDate.set(localDate, bucket);
  }
  return byDate;
}

function correlation(actual: number[], simulated: number[]): number | null {
  if (actual.length !== simulated.length || actual.length === 0) return null;
  const n = actual.length;
  const meanActual = actual.reduce((sum, value) => sum + value, 0) / n;
  const meanSim = simulated.reduce((sum, value) => sum + value, 0) / n;
  let numerator = 0;
  let actualVariance = 0;
  let simVariance = 0;
  for (let i = 0; i < n; i += 1) {
    const a = actual[i]! - meanActual;
    const s = simulated[i]! - meanSim;
    numerator += a * s;
    actualVariance += a * a;
    simVariance += s * s;
  }
  if (actualVariance <= 1e-12 || simVariance <= 1e-12) return null;
  return round4(numerator / Math.sqrt(actualVariance * simVariance));
}

function normalizedShapeError(actualSlots: number[], simulatedSlots: number[]): number | null {
  const actualTotal = actualSlots.reduce((sum, value) => sum + value, 0);
  const simTotal = simulatedSlots.reduce((sum, value) => sum + value, 0);
  if (actualTotal <= 1e-12 || simTotal <= 1e-12) return null;
  const actualNorm = actualSlots.map((value) => value / actualTotal);
  const simNorm = simulatedSlots.map((value) => value / simTotal);
  const mae =
    actualNorm.reduce((sum, value, index) => sum + Math.abs(value - (simNorm[index] ?? 0)), 0) / actualNorm.length;
  return round4(mae);
}

function nearExactCurveMatchScore(actualSlots: number[], simulatedSlots: number[]): number | null {
  const actualTotal = actualSlots.reduce((sum, value) => sum + value, 0);
  if (actualTotal <= 1e-12) return null;
  const absErrors = actualSlots.map((value, index) => Math.abs(value - (simulatedSlots[index] ?? 0)));
  return round4(absErrors.reduce((sum, value) => sum + value, 0) / actualTotal);
}

function peakSlot(values: number[]): number {
  let bestIndex = 0;
  let bestValue = Number.NEGATIVE_INFINITY;
  values.forEach((value, index) => {
    if (value > bestValue) {
      bestValue = value;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function sumBlock(values: number[], startSlot: number, endSlot: number): number {
  let sum = 0;
  for (let slot = startSlot; slot <= endSlot; slot += 1) sum += values[slot] ?? 0;
  return round4(sum);
}

function buildLikelyCauseTags(args: {
  day: OnePathIntervalDailyCompareDay;
  normalizedShapeError?: number | null;
  peakTimingErrorMinutes?: number | null;
  exactCurveMatchFlag?: boolean;
}): string[] {
  const tags: string[] = [];
  if (args.day.weatherBucket === "unknown") tags.push("weather_data_missing");
  if (args.exactCurveMatchFlag) tags.push("exact_match_suspected");
  if (args.day.weatherBucket === "hot" || args.day.weatherBucket === "extreme_hot") {
    if ((args.day.deltaKwh ?? 0) < -2) tags.push("cooling_sensitivity_low");
    if ((args.day.deltaKwh ?? 0) > 2) tags.push("cooling_sensitivity_high");
  }
  if (args.day.weatherBucket === "cold" || args.day.weatherBucket === "extreme_cold") {
    if ((args.day.deltaKwh ?? 0) < -2) tags.push("heating_sensitivity_low");
    if ((args.day.deltaKwh ?? 0) > 2) tags.push("heating_sensitivity_high");
  }
  if (args.day.weatherBucket === "mild") {
    if ((args.day.deltaKwh ?? 0) > 1.5) tags.push("baseload_high");
    if ((args.day.deltaKwh ?? 0) < -1.5) tags.push("baseload_low");
  }
  if ((args.normalizedShapeError ?? 0) > 0.08) tags.push("intraday_shape_wrong");
  if ((args.peakTimingErrorMinutes ?? 0) >= 60) tags.push("peak_timing_wrong");
  if (args.day.travelVacantFlag && Math.abs(args.day.deltaKwh ?? 0) > 3) tags.push("travel_vacant_behavior_miss");
  if (args.day.weekdayWeekend === "weekend" && Math.abs(args.day.deltaKwh ?? 0) > 3) tags.push("weekend_behavior_miss");
  return tags;
}

export function isOnePathIntervalDiagnosticsSourceType(
  value: string | null | undefined
): value is OnePathIntervalSourceType {
  return value === "SMT" || value === "GREEN_BUTTON";
}

export function extractTravelRangesFromPastVariables(
  pastVariables: Array<{ kind?: string; payloadJson?: Record<string, unknown> }> | undefined
): TravelRange[] {
  const out: TravelRange[] = [];
  for (const variable of pastVariables ?? []) {
    if (String(variable?.kind ?? "").toUpperCase() !== "TRAVEL_RANGE") continue;
    const start = String(variable.payloadJson?.startDate ?? "").slice(0, 10);
    const end = String(variable.payloadJson?.endDate ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) continue;
    out.push({ startDate: start, endDate: end });
  }
  return out;
}

export function resolveOnePathIntervalDiagnosticsInputType(args: {
  mode?: string | null;
  preferredActualSource?: string | null;
}): string {
  const mode = String(args.mode ?? "").trim().toUpperCase();
  if (mode === "GREEN_BUTTON" || mode === "INTERVAL" || mode === "MANUAL_MONTHLY" || mode === "MANUAL_ANNUAL") {
    return mode;
  }
  if (args.preferredActualSource === "GREEN_BUTTON") return "GREEN_BUTTON";
  if (args.preferredActualSource === "SMT") return "INTERVAL";
  return mode || "UNKNOWN";
}

export function buildOnePathIntervalDiagnosticsForPastResponse(args: {
  mode?: string | null;
  preferredActualSource?: "SMT" | "GREEN_BUTTON" | null;
  actualDataset?: unknown;
  simulatedDataset?: unknown;
  compareProjection?: unknown;
  pastVariables?: unknown[];
  travelRanges?: TravelRange[];
  includePosthocTopMissIntervalCurves?: boolean;
  posthocTopMissDayCount?: number;
}): OnePathIntervalDiagnosticsV1 {
  const travelRanges = filterTravelRangesToCoverageWindow(
    args.travelRanges ??
      extractTravelRangesFromPastVariables(
        args.pastVariables as Array<{ kind?: string; payloadJson?: Record<string, unknown> }> | undefined
      ),
    resolveDiagnosticsCoverageWindow({
      actualDataset: args.actualDataset,
      simulatedDataset: args.simulatedDataset,
    })
  );
  return buildOnePathIntervalDiagnosticsEnvelope({
    inputType: resolveOnePathIntervalDiagnosticsInputType(args),
    preferredActualSource: args.preferredActualSource ?? null,
    actualDataset: args.actualDataset,
    simulatedDataset: args.simulatedDataset,
    compareProjection: args.compareProjection,
    travelRanges,
    includePosthocTopMissIntervalCurves: args.includePosthocTopMissIntervalCurves === true,
    posthocTopMissDayCount: args.posthocTopMissDayCount,
  });
}

export function isOnePathIntervalDiagnosticsInputType(inputType: string | null | undefined): boolean {
  const normalized = String(inputType ?? "").trim().toUpperCase();
  return normalized === "INTERVAL" || normalized === "GREEN_BUTTON" || normalized === "SMT";
}

export function extractValidationDayKeysFromCompareProjection(compareProjection: unknown): string[] {
  const rows = Array.isArray((compareProjection as any)?.rows) ? (compareProjection as any).rows : [];
  const validationOnly = rows
    .filter((row: any) => row?.validationDay === true || row?.isValidationDay === true)
    .map((row: any) => String(row?.localDate ?? row?.date ?? "").slice(0, 10))
    .filter((date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date));
  if (validationOnly.length > 0) {
    return Array.from(new Set<string>(validationOnly)).sort();
  }
  return Array.from(
    new Set<string>(
      rows
        .map((row: any) => String(row?.localDate ?? row?.date ?? "").slice(0, 10))
        .filter((date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date))
    )
  ).sort();
}

function slotsHaveSignal(slots: number[] | undefined): boolean {
  return Boolean(slots && slots.some((value) => value > 0));
}

function buildSlotIntervalSeries(date: string, slots: number[], timezone: string): Array<{ timestamp: string; kwh: number }> {
  const out: Array<{ timestamp: string; kwh: number }> = [];
  for (let slot = 0; slot < slots.length; slot += 1) {
    const kwh = slots[slot] ?? 0;
    if (kwh <= 0) continue;
    out.push({ timestamp: slotTimestampFromLocalSlot(date, slot, timezone), kwh: round4(kwh) });
  }
  return out;
}

function slotTimestampFromLocalSlot(date: string, slot: number, timezone: string): string {
  const hour = Math.floor(slot / 4);
  const minute = (slot % 4) * 15;
  const local = `${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
  try {
    const dt = new Date(`${local}:00`);
    if (Number.isFinite(dt.getTime())) return dt.toISOString();
  } catch {
    // fall through
  }
  return `${local}:00.000Z`;
}

function detectSimulatedDailyRowsAreActualBacked(simulatedDataset: unknown): boolean {
  const daily = Array.isArray((simulatedDataset as any)?.daily) ? (simulatedDataset as any).daily : [];
  return daily.some((row: any) => {
    const detail = String(row?.sourceDetail ?? row?.source ?? "").toUpperCase();
    return detail === "ACTUAL" || detail === "ACTUAL_VALIDATION_TEST_DAY";
  });
}

function detectIntervalTruthPassthrough(args: {
  sourceType: OnePathIntervalSourceType;
  actualDataset?: unknown;
  simulatedDataset?: unknown;
  validationDayKeys: string[];
}): boolean {
  if (args.sourceType !== "SMT") return false;
  const actualByDate = readDailyRows(args.actualDataset);
  const simulatedByDate = readDailyRows(args.simulatedDataset);
  const keys = args.validationDayKeys.length > 0 ? args.validationDayKeys : Array.from(actualByDate.keys());
  if (keys.length === 0) return false;
  let comparable = 0;
  let matched = 0;
  for (const date of keys) {
    const actual = actualByDate.get(date);
    const simulated = simulatedByDate.get(date);
    if (actual == null || simulated == null) continue;
    comparable += 1;
    if (Math.abs(actual - simulated) <= 0.01) matched += 1;
  }
  const actualIntervals = readIntervalPoints(args.actualDataset);
  const simulatedIntervals = readIntervalPoints(args.simulatedDataset);
  const dailyBacked = detectSimulatedDailyRowsAreActualBacked(args.simulatedDataset);
  return (
    comparable > 0 &&
    matched / comparable >= 0.95 &&
    actualIntervals.length > 0 &&
    (simulatedIntervals.length === 0 || matched === comparable) &&
    dailyBacked
  );
}

function buildIntervalTruthInterpretation(args: {
  sourceType: OnePathIntervalSourceType;
  intervalTruthPassthrough: boolean;
  simulatedDailyRowsAreActualBacked: boolean;
}): OnePathIntervalTruthInterpretation {
  const passthrough = args.intervalTruthPassthrough;
  return {
    intervalTruthPassthrough: passthrough,
    simulatedDailyRowsAreActualBacked: args.simulatedDailyRowsAreActualBacked,
    modelAccuracyTest: !passthrough,
    usefulFor: passthrough
      ? "export plumbing, source truth, plan calculations, interval diagnostics"
      : "masked model accuracy review, weather-shape tuning, interval curve diagnostics",
    notUsefulFor: passthrough
      ? "masked low-data model accuracy"
      : "pure interval-truth passthrough accuracy scoring",
  };
}

function buildTodBucketBlock(
  actual: number,
  simulated: number,
  totalActual: number,
  totalSimulated: number
): OnePathValidationIntervalCurveDay["todBuckets"]["overnight"] {
  return {
    actualKwh: actual,
    simulatedKwh: simulated,
    deltaKwh: round4(simulated - actual),
    shareActual: totalActual > 1e-6 ? round4(actual / totalActual) : null,
    shareSimulated: totalSimulated > 1e-6 ? round4(simulated / totalSimulated) : null,
  };
}

export function buildUnavailableOnePathIntervalDiagnosticsV1(args: {
  unavailableReason: string;
  sourceType?: OnePathIntervalSourceType | null;
}): OnePathIntervalDiagnosticsV1 {
  return {
    version: "v1",
    available: false,
    unavailableReason: args.unavailableReason,
    sourceType: args.sourceType ?? null,
    guardrails: GUARDRAILS,
    dailyCompare: { days: [], summaryBuckets: {} },
    weatherMissDiagnostics: {
      weatherDiagnosticsAvailable: false,
      missingWeatherFields: ["dailyWeather"],
      hotDayBias: null,
      extremeHotDayBias: null,
      coldDayBias: null,
      extremeColdDayBias: null,
      mildDayBias: null,
      actualKwhPerCoolingDegreeDay: null,
      simulatedKwhPerCoolingDegreeDay: null,
      coolingSensitivityDelta: null,
      actualKwhPerHeatingDegreeDay: null,
      simulatedKwhPerHeatingDegreeDay: null,
      heatingSensitivityDelta: null,
    },
    validationIntervalCurveDiagnostics: {
      available: false,
      unavailableReason: args.unavailableReason,
      selectedValidationDayCount: 0,
      includedPosthocDayCount: 0,
      includePosthocTopMissIntervalCurves: false,
      selectedValidationDayKeysUsed: [],
      posthocTopMissDayKeysUsed: [],
      actualIntervalRowsFound: 0,
      simulatedIntervalRowsFound: 0,
      days: [],
    },
    todBucketDiagnostics: {
      available: false,
      unavailableReason: args.unavailableReason,
      validationDaysOnly: true,
      buckets: [],
    },
    exactMatchDiagnostics: {
      evaluatedDayCount: 0,
      exactCurveMatchDayCount: 0,
      nearExactCurveMatchDayCount: 0,
      cleanHoldoutExactMatchCount: 0,
      nonHoldoutExactMatchCount: 0,
      skippedReason: args.unavailableReason,
      actualIntervalsAvailableForCompare: false,
      simulatedIntervalsAvailableForCompare: false,
      days: [],
    },
    intervalTruthInterpretation: buildIntervalTruthInterpretation({
      sourceType: args.sourceType ?? "SMT",
      intervalTruthPassthrough: false,
      simulatedDailyRowsAreActualBacked: false,
    }),
    worstDayDiagnostics: {
      topOverSimDays: [],
      topUnderSimDays: [],
      topAbsoluteDailyMisses: [],
      topIntervalShapeMisses: [],
      topPeakTimingMisses: [],
    },
  };
}

export function buildOnePathIntervalCompareDiagnosticsV1(
  args: BuildOnePathIntervalCompareDiagnosticsV1Args
): OnePathIntervalDiagnosticsV1 {
  const validationDaySet = new Set((args.validationDayKeys ?? []).map((date) => date.slice(0, 10)));
  const validationHoldoutProofOk = args.validationHoldoutProofOk === true;
  const includePosthoc = args.includePosthocTopMissIntervalCurves === true;
  const posthocCount = args.posthocTopMissDayCount ?? 5;
  const coverageWindow = resolveDiagnosticsCoverageWindow({
    actualDataset: args.actualDataset,
    simulatedDataset: args.simulatedDataset,
  });
  const activeTravelRanges = filterTravelRangesToCoverageWindow(args.travelRanges, coverageWindow);
  const travelDaySet = buildTravelDaySet(activeTravelRanges, coverageWindow);
  const actualByDate = readDailyRows(args.actualDataset);
  const simulatedByDate = readDailyRows(args.simulatedDataset);
  const dates = Array.from(
    new Set([...Array.from(actualByDate.keys()), ...Array.from(simulatedByDate.keys())])
  ).sort();
  const weatherByDate = buildWeatherMap(args.actualDataset);
  if (weatherByDate.size === 0) {
    const simWeather = buildWeatherMap(args.simulatedDataset);
    simWeather.forEach((weather, date) => {
      if (!weatherByDate.has(date)) weatherByDate.set(date, weather);
    });
  }
  const missingWeatherFields = weatherByDate.size === 0 ? ["dailyWeather"] : [];
  const timezone =
    String((args.simulatedDataset as any)?.meta?.timezone ?? (args.actualDataset as any)?.meta?.timezone ?? "").trim() ||
    "America/Chicago";

  const dailyDays: OnePathIntervalDailyCompareDay[] = dates.map((date) => {
    const actualKwh = actualByDate.has(date) ? round2(actualByDate.get(date)!) : null;
    const simulatedKwh = simulatedByDate.has(date) ? round2(simulatedByDate.get(date)!) : null;
    const deltaKwh = actualKwh != null && simulatedKwh != null ? round2(simulatedKwh - actualKwh) : null;
    const weather = weatherByDate.get(date) ?? null;
    const status = resolveDiagnosticConfidence({
      date,
      validationDaySet,
      validationHoldoutProofOk,
      posthocDateSet: new Set(),
    });
    return {
      date,
      actualKwh,
      simulatedKwh,
      deltaKwh,
      absDeltaKwh: deltaKwh == null ? null : round2(Math.abs(deltaKwh)),
      percentDelta:
        actualKwh != null && simulatedKwh != null && actualKwh !== 0
          ? round2(((simulatedKwh - actualKwh) / actualKwh) * 100)
          : null,
      validationDay: status.validationDay,
      cleanHoldoutDay: status.cleanHoldoutDay,
      diagnosticConfidence: status.diagnosticConfidence,
      weekdayWeekend: weekdayWeekend(date),
      month: date.slice(0, 7),
      season: seasonForMonth(date.slice(0, 7)),
      billPeriodId: null,
      travelVacantFlag: travelDaySet.has(date),
      excludedFromScoring: false,
      minTemp: weather?.minTemp ?? null,
      maxTemp: weather?.maxTemp ?? null,
      avgTemp: weather?.meanTemp ?? null,
      heatingDegreeDays: weather?.hdd ?? null,
      coolingDegreeDays: weather?.cdd ?? null,
      weatherBucket: classifyWeatherBucket(weather),
      weatherSource: weather?.source ?? null,
      weatherIdentity: args.weatherIdentity ?? null,
    };
  });

  const posthocDates = includePosthoc
    ? dailyDays
        .filter((day) => day.absDeltaKwh != null)
        .sort((a, b) => (b.absDeltaKwh ?? 0) - (a.absDeltaKwh ?? 0))
        .slice(0, posthocCount)
        .map((day) => day.date)
    : [];
  const posthocDateSet = new Set(posthocDates);
  for (const day of dailyDays) {
    if (posthocDateSet.has(day.date)) {
      day.diagnosticConfidence = resolveDiagnosticConfidence({
        date: day.date,
        validationDaySet,
        validationHoldoutProofOk,
        posthocDateSet,
      }).diagnosticConfidence;
    }
  }

  const byMonth = new Map<string, OnePathIntervalDailyCompareDay[]>();
  const bySeason = new Map<string, OnePathIntervalDailyCompareDay[]>();
  for (const day of dailyDays) {
    if (day.month) {
      const bucket = byMonth.get(day.month) ?? [];
      bucket.push(day);
      byMonth.set(day.month, bucket);
    }
    if (day.season) {
      const bucket = bySeason.get(day.season) ?? [];
      bucket.push(day);
      bySeason.set(day.season, bucket);
    }
  }

  const summaryBuckets: Record<string, OnePathIntervalCompareBucketSummary> = {
    all_days: computeBucketSummary(dailyDays),
    validation_days: computeBucketSummary(dailyDays.filter((day) => day.validationDay)),
    non_validation_days: computeBucketSummary(dailyDays.filter((day) => !day.validationDay)),
    hot_days: computeBucketSummary(dailyDays.filter((day) => day.weatherBucket === "hot")),
    extreme_hot_days: computeBucketSummary(dailyDays.filter((day) => day.weatherBucket === "extreme_hot")),
    cold_days: computeBucketSummary(dailyDays.filter((day) => day.weatherBucket === "cold")),
    extreme_cold_days: computeBucketSummary(dailyDays.filter((day) => day.weatherBucket === "extreme_cold")),
    mild_days: computeBucketSummary(dailyDays.filter((day) => day.weatherBucket === "mild")),
    weekdays: computeBucketSummary(dailyDays.filter((day) => day.weekdayWeekend === "weekday")),
    weekends: computeBucketSummary(dailyDays.filter((day) => day.weekdayWeekend === "weekend")),
    travel_vacant_days: computeBucketSummary(dailyDays.filter((day) => day.travelVacantFlag)),
    non_travel_days: computeBucketSummary(dailyDays.filter((day) => !day.travelVacantFlag)),
  };
  Array.from(byMonth.entries()).forEach(([month, days]) => {
    summaryBuckets[`month:${month}`] = computeBucketSummary(days);
  });
  Array.from(bySeason.entries()).forEach(([season, days]) => {
    summaryBuckets[`season:${season}`] = computeBucketSummary(days);
  });

  const biasForBucket = (bucket: OnePathWeatherBucket) => {
    const days = dailyDays.filter((day) => day.weatherBucket === bucket && day.deltaKwh != null);
    return days.length > 0 ? round2(days.reduce((sum, day) => sum + (day.deltaKwh ?? 0), 0) / days.length) : null;
  };
  const coolingDays = dailyDays.filter((day) => (day.coolingDegreeDays ?? 0) > 0.5 && day.actualKwh != null);
  const heatingDays = dailyDays.filter((day) => (day.heatingDegreeDays ?? 0) > 0.5 && day.actualKwh != null);
  const totalCdd = coolingDays.reduce((sum, day) => sum + (day.coolingDegreeDays ?? 0), 0);
  const totalHdd = heatingDays.reduce((sum, day) => sum + (day.heatingDegreeDays ?? 0), 0);
  const actualCoolingKwh = coolingDays.reduce((sum, day) => sum + (day.actualKwh ?? 0), 0);
  const simCoolingKwh = coolingDays.reduce((sum, day) => sum + (day.simulatedKwh ?? 0), 0);
  const actualHeatingKwh = heatingDays.reduce((sum, day) => sum + (day.actualKwh ?? 0), 0);
  const simHeatingKwh = heatingDays.reduce((sum, day) => sum + (day.simulatedKwh ?? 0), 0);
  const actualKwhPerCoolingDegreeDay = totalCdd > 0 ? round2(actualCoolingKwh / totalCdd) : null;
  const simulatedKwhPerCoolingDegreeDay = totalCdd > 0 ? round2(simCoolingKwh / totalCdd) : null;
  const actualKwhPerHeatingDegreeDay = totalHdd > 0 ? round2(actualHeatingKwh / totalHdd) : null;
  const simulatedKwhPerHeatingDegreeDay = totalHdd > 0 ? round2(simHeatingKwh / totalHdd) : null;

  const selectedValidationDayKeysUsed = Array.from(validationDaySet).sort();
  const posthocTopMissDayKeysUsed = [...posthocDates].sort();
  const curveDates = Array.from(new Set([...selectedValidationDayKeysUsed, ...posthocTopMissDayKeysUsed])).sort();
  const curveDateSet = new Set(curveDates);
  const actualIntervals = readIntervalPoints(args.actualDataset);
  const simulatedIntervalsRaw = readIntervalPoints(args.simulatedDataset);
  const intervalTruthPassthrough = detectIntervalTruthPassthrough({
    sourceType: args.sourceType,
    actualDataset: args.actualDataset,
    simulatedDataset: args.simulatedDataset,
    validationDayKeys: selectedValidationDayKeysUsed,
  });
  const simulatedDailyRowsAreActualBacked = detectSimulatedDailyRowsAreActualBacked(args.simulatedDataset);
  const simulatedIntervals =
    simulatedIntervalsRaw.length > 0
      ? simulatedIntervalsRaw
      : intervalTruthPassthrough
        ? actualIntervals
        : [];
  const actualBySlot = intervalsByDateAndSlot(actualIntervals, timezone, curveDateSet);
  const simulatedBySlot = intervalsByDateAndSlot(simulatedIntervals, timezone, curveDateSet);

  const curveDays: OnePathValidationIntervalCurveDay[] = [];
  for (const date of curveDates) {
    let actualSlots = actualBySlot.get(date);
    let simulatedSlots = simulatedBySlot.get(date);
    if (!slotsHaveSignal(actualSlots) && intervalTruthPassthrough && slotsHaveSignal(simulatedSlots)) {
      actualSlots = simulatedSlots;
    }
    if (!slotsHaveSignal(simulatedSlots) && intervalTruthPassthrough && slotsHaveSignal(actualSlots)) {
      simulatedSlots = actualSlots;
    }
    if (!slotsHaveSignal(actualSlots) || !slotsHaveSignal(simulatedSlots)) continue;

    const absErrors = actualSlots!.map((value, index) => Math.abs(value - (simulatedSlots![index] ?? 0)));
    const actualTotal = actualSlots!.reduce((sum, value) => sum + value, 0);
    const simulatedTotal = simulatedSlots!.reduce((sum, value) => sum + value, 0);
    const rawIntervalWape = actualTotal > 1e-6 ? round4(absErrors.reduce((sum, value) => sum + value, 0) / actualTotal) : null;
    const nearExactScore = nearExactCurveMatchScore(actualSlots!, simulatedSlots!);
    const exactCurveMatchFlag = nearExactScore != null && nearExactScore <= 0.001;
    const peakActualSlot = peakSlot(actualSlots!);
    const peakSimulatedSlot = peakSlot(simulatedSlots!);
    const dayMeta = dailyDays.find((day) => day.date === date);
    const validationDay = validationDaySet.has(date);
    const posthocTopMissDay = posthocDateSet.has(date) && !validationDay;
    const diagnosticConfidence =
      posthocTopMissDay
        ? "posthoc_diagnostic"
        : dayMeta?.diagnosticConfidence ?? "unknown";
    const dayTotalActual = dayMeta?.actualKwh ?? round2(actualTotal);
    const dayTotalSimulated = dayMeta?.simulatedKwh ?? round2(simulatedTotal);
    const overnightActual = sumBlock(actualSlots!, 0, 23);
    const overnightSim = sumBlock(simulatedSlots!, 0, 23);
    const morningActual = sumBlock(actualSlots!, 24, 47);
    const morningSim = sumBlock(simulatedSlots!, 24, 47);
    const afternoonActual = sumBlock(actualSlots!, 48, 71);
    const afternoonSim = sumBlock(simulatedSlots!, 48, 71);
    const eveningActual = sumBlock(actualSlots!, 72, 95);
    const eveningSim = sumBlock(simulatedSlots!, 72, 95);
    curveDays.push({
      date,
      dayType: weekdayWeekend(date),
      validationDay,
      posthocTopMissDay,
      diagnosticConfidence,
      slotCountActual: actualSlots!.filter((value) => value > 0).length,
      slotCountSimulated: simulatedSlots!.filter((value) => value > 0).length,
      actualDailyTotalKwh: dayTotalActual,
      simulatedDailyTotalKwh: dayTotalSimulated,
      dailyTotalDeltaKwh:
        dayMeta?.deltaKwh ?? round2((dayTotalSimulated ?? simulatedTotal) - (dayTotalActual ?? actualTotal)),
      rawIntervalWape,
      intervalMae: absErrors.length > 0 ? round4(absErrors.reduce((sum, value) => sum + value, 0) / absErrors.length) : null,
      normalizedShapeError: normalizedShapeError(actualSlots!, simulatedSlots!),
      shapeCorrelation: correlation(actualSlots!, simulatedSlots!),
      peakActualKwh: round4(actualSlots![peakActualSlot] ?? 0),
      peakSimulatedKwh: round4(simulatedSlots![peakSimulatedSlot] ?? 0),
      peakActualLocalTime: hhmmFromSlot(peakActualSlot),
      peakSimulatedLocalTime: hhmmFromSlot(peakSimulatedSlot),
      peakTimingErrorMinutes: Math.abs(peakSimulatedSlot - peakActualSlot) * 15,
      overnight: {
        actual: overnightActual,
        simulated: overnightSim,
        delta: round4(overnightSim - overnightActual),
      },
      morning: {
        actual: morningActual,
        simulated: morningSim,
        delta: round4(morningSim - morningActual),
      },
      afternoon: {
        actual: afternoonActual,
        simulated: afternoonSim,
        delta: round4(afternoonSim - afternoonActual),
      },
      evening: {
        actual: eveningActual,
        simulated: eveningSim,
        delta: round4(eveningSim - eveningActual),
      },
      todBuckets: {
        overnight: buildTodBucketBlock(overnightActual, overnightSim, dayTotalActual ?? actualTotal, dayTotalSimulated ?? simulatedTotal),
        morning: buildTodBucketBlock(morningActual, morningSim, dayTotalActual ?? actualTotal, dayTotalSimulated ?? simulatedTotal),
        afternoon: buildTodBucketBlock(afternoonActual, afternoonSim, dayTotalActual ?? actualTotal, dayTotalSimulated ?? simulatedTotal),
        evening: buildTodBucketBlock(eveningActual, eveningSim, dayTotalActual ?? actualTotal, dayTotalSimulated ?? simulatedTotal),
      },
      actual96SlotShape: [...actualSlots!],
      simulated96SlotShape: [...simulatedSlots!],
      actualIntervals: buildSlotIntervalSeries(date, actualSlots!, timezone),
      simulatedIntervals: buildSlotIntervalSeries(date, simulatedSlots!, timezone),
      actualIntervalsLoadedForCompareOnly: true,
      actualIntervalsPassedToSimulator: false,
      actualIntervalsUsedAsDonorForThisDay:
        intervalTruthPassthrough && simulatedIntervalsRaw.length === 0 ? true : "unknown",
      cleanHoldoutDay: Boolean(dayMeta?.cleanHoldoutDay),
      exactCurveMatchFlag,
      nearExactCurveMatchScore: nearExactScore,
    });
  }

  const validationCurveDays = curveDays.filter((day) => day.validationDay);
  const curveDiagnosticsAvailable = curveDays.length > 0;
  const curveUnavailableReason =
    curveDiagnosticsAvailable
      ? null
      : actualIntervals.length === 0
        ? "no_actual_interval_rows_for_selected_validation_days"
        : simulatedIntervalsRaw.length === 0 && !intervalTruthPassthrough
          ? "no_simulated_interval_rows_for_selected_validation_days"
          : "validation_interval_curve_days_unavailable_for_selected_dates";
  const todTotals = validationCurveDays.reduce(
    (acc, day) => ({
      overnight: {
        actual: round4(acc.overnight.actual + day.overnight.actual),
        simulated: round4(acc.overnight.simulated + day.overnight.simulated),
      },
      morning: {
        actual: round4(acc.morning.actual + day.morning.actual),
        simulated: round4(acc.morning.simulated + day.morning.simulated),
      },
      afternoon: {
        actual: round4(acc.afternoon.actual + day.afternoon.actual),
        simulated: round4(acc.afternoon.simulated + day.afternoon.simulated),
      },
      evening: {
        actual: round4(acc.evening.actual + day.evening.actual),
        simulated: round4(acc.evening.simulated + day.evening.simulated),
      },
    }),
    {
      overnight: { actual: 0, simulated: 0 },
      morning: { actual: 0, simulated: 0 },
      afternoon: { actual: 0, simulated: 0 },
      evening: { actual: 0, simulated: 0 },
    }
  );
  const totalActualTod =
    todTotals.overnight.actual + todTotals.morning.actual + todTotals.afternoon.actual + todTotals.evening.actual;
  const totalSimTod =
    todTotals.overnight.simulated +
    todTotals.morning.simulated +
    todTotals.afternoon.simulated +
    todTotals.evening.simulated;
  const buildTodBucket = (
    bucket: OnePathTodBucketDiagnostic["bucket"],
    actual: number,
    simulated: number
  ): OnePathTodBucketDiagnostic => ({
    bucket,
    bucketActualKwh: actual,
    bucketSimulatedKwh: simulated,
    bucketDeltaKwh: round4(simulated - actual),
    bucketPercentDelta: actual > 1e-6 ? round2(((simulated - actual) / actual) * 100) : null,
    bucketShareActual: totalActualTod > 1e-6 ? round4(actual / totalActualTod) : null,
    bucketShareSimulated: totalSimTod > 1e-6 ? round4(simulated / totalSimTod) : null,
  });

  const exactMatchDiagnostics: OnePathExactMatchDiagnostics = {
    evaluatedDayCount: curveDays.length,
    exactCurveMatchDayCount: curveDays.filter((day) => day.exactCurveMatchFlag).length,
    nearExactCurveMatchDayCount: curveDays.filter((day) => (day.nearExactCurveMatchScore ?? 1) <= 0.05).length,
    cleanHoldoutExactMatchCount: curveDays.filter((day) => day.cleanHoldoutDay && day.exactCurveMatchFlag).length,
    nonHoldoutExactMatchCount: curveDays.filter((day) => !day.cleanHoldoutDay && day.exactCurveMatchFlag).length,
    skippedReason: curveDays.length > 0 ? null : curveUnavailableReason,
    actualIntervalsAvailableForCompare: actualIntervals.length > 0,
    simulatedIntervalsAvailableForCompare: simulatedIntervals.length > 0,
    days: curveDays.map((day) => ({
      date: day.date,
      diagnosticConfidence: day.diagnosticConfidence,
      exactCurveMatchFlag: day.exactCurveMatchFlag,
      nearExactCurveMatchScore: day.nearExactCurveMatchScore,
      cleanHoldoutDay: day.cleanHoldoutDay,
    })),
  };

  const dayByDate = new Map(dailyDays.map((day) => [day.date, day]));
  const buildWorstEntry = (date: string): OnePathWorstDayDiagnosticEntry => {
    const day = dayByDate.get(date)!;
    const curve = curveDays.find((entry) => entry.date === date);
    return {
      date,
      actualKwh: day.actualKwh,
      simulatedKwh: day.simulatedKwh,
      deltaKwh: day.deltaKwh,
      absDeltaKwh: day.absDeltaKwh,
      percentDelta: day.percentDelta,
      weatherBucket: day.weatherBucket,
      maxTemp: day.maxTemp,
      minTemp: day.minTemp,
      avgTemp: day.avgTemp,
      heatingDegreeDays: day.heatingDegreeDays,
      coolingDegreeDays: day.coolingDegreeDays,
      weekdayWeekend: day.weekdayWeekend,
      travelVacantFlag: day.travelVacantFlag,
      validationDay: day.validationDay,
      diagnosticConfidence: day.diagnosticConfidence,
      likelyCauseTags: buildLikelyCauseTags({
        day,
        normalizedShapeError: curve?.normalizedShapeError,
        peakTimingErrorMinutes: curve?.peakTimingErrorMinutes,
        exactCurveMatchFlag: curve?.exactCurveMatchFlag,
      }),
    };
  };

  const comparable = dailyDays.filter((day) => day.deltaKwh != null);
  const topN = 10;

  return {
    version: "v1",
    available: true,
    unavailableReason: null,
    sourceType: args.sourceType,
    guardrails: GUARDRAILS,
    dailyCompare: { days: dailyDays, summaryBuckets },
    weatherMissDiagnostics: {
      weatherDiagnosticsAvailable: weatherByDate.size > 0,
      missingWeatherFields,
      hotDayBias: biasForBucket("hot"),
      extremeHotDayBias: biasForBucket("extreme_hot"),
      coldDayBias: biasForBucket("cold"),
      extremeColdDayBias: biasForBucket("extreme_cold"),
      mildDayBias: biasForBucket("mild"),
      actualKwhPerCoolingDegreeDay,
      simulatedKwhPerCoolingDegreeDay,
      coolingSensitivityDelta:
        actualKwhPerCoolingDegreeDay != null && simulatedKwhPerCoolingDegreeDay != null
          ? round2(simulatedKwhPerCoolingDegreeDay - actualKwhPerCoolingDegreeDay)
          : null,
      actualKwhPerHeatingDegreeDay,
      simulatedKwhPerHeatingDegreeDay,
      heatingSensitivityDelta:
        actualKwhPerHeatingDegreeDay != null && simulatedKwhPerHeatingDegreeDay != null
          ? round2(simulatedKwhPerHeatingDegreeDay - actualKwhPerHeatingDegreeDay)
          : null,
    },
    validationIntervalCurveDiagnostics: {
      available: curveDiagnosticsAvailable,
      unavailableReason: curveUnavailableReason,
      selectedValidationDayCount: validationDaySet.size,
      includedPosthocDayCount: posthocTopMissDayKeysUsed.length,
      includePosthocTopMissIntervalCurves: includePosthoc,
      selectedValidationDayKeysUsed,
      posthocTopMissDayKeysUsed,
      actualIntervalRowsFound: actualIntervals.length,
      simulatedIntervalRowsFound: simulatedIntervals.length,
      days: curveDays,
    },
    todBucketDiagnostics: {
      available: validationCurveDays.length > 0,
      unavailableReason:
        validationCurveDays.length > 0 ? null : curveUnavailableReason ?? "validation_interval_curve_days_unavailable",
      validationDaysOnly: true,
      buckets:
        validationCurveDays.length > 0
          ? [
              buildTodBucket("overnight", todTotals.overnight.actual, todTotals.overnight.simulated),
              buildTodBucket("morning", todTotals.morning.actual, todTotals.morning.simulated),
              buildTodBucket("afternoon", todTotals.afternoon.actual, todTotals.afternoon.simulated),
              buildTodBucket("evening", todTotals.evening.actual, todTotals.evening.simulated),
            ]
          : [],
    },
    exactMatchDiagnostics,
    intervalTruthInterpretation: buildIntervalTruthInterpretation({
      sourceType: args.sourceType,
      intervalTruthPassthrough,
      simulatedDailyRowsAreActualBacked,
    }),
    worstDayDiagnostics: {
      topOverSimDays: [...comparable].sort((a, b) => (b.deltaKwh ?? 0) - (a.deltaKwh ?? 0)).slice(0, topN).map((day) => buildWorstEntry(day.date)),
      topUnderSimDays: [...comparable].sort((a, b) => (a.deltaKwh ?? 0) - (b.deltaKwh ?? 0)).slice(0, topN).map((day) => buildWorstEntry(day.date)),
      topAbsoluteDailyMisses: [...comparable]
        .sort((a, b) => (b.absDeltaKwh ?? 0) - (a.absDeltaKwh ?? 0))
        .slice(0, topN)
        .map((day) => buildWorstEntry(day.date)),
      topIntervalShapeMisses: [...validationCurveDays]
        .filter((day) => day.normalizedShapeError != null)
        .sort((a, b) => (b.normalizedShapeError ?? 0) - (a.normalizedShapeError ?? 0))
        .slice(0, topN)
        .map((day) => buildWorstEntry(day.date)),
      topPeakTimingMisses: [...validationCurveDays]
        .filter((day) => day.peakTimingErrorMinutes != null)
        .sort((a, b) => (b.peakTimingErrorMinutes ?? 0) - (a.peakTimingErrorMinutes ?? 0))
        .slice(0, topN)
        .map((day) => buildWorstEntry(day.date)),
    },
  };
}

export function buildOnePathIntervalDiagnosticsEnvelope(args: {
  inputType?: string | null;
  preferredActualSource?: string | null;
  actualDataset?: unknown;
  simulatedDataset?: unknown;
  compareProjection?: unknown;
  travelRanges?: TravelRange[];
  weatherIdentity?: string | null;
  includePosthocTopMissIntervalCurves?: boolean;
  posthocTopMissDayCount?: number;
}): OnePathIntervalDiagnosticsV1 {
  const inputType = String(args.inputType ?? "").trim().toUpperCase();
  if (inputType === "MANUAL_MONTHLY" || inputType === "MANUAL_ANNUAL") {
    return buildUnavailableOnePathIntervalDiagnosticsV1({ unavailableReason: "manual_input_type" });
  }
  if (!isOnePathIntervalDiagnosticsInputType(inputType) && !isOnePathIntervalDiagnosticsSourceType(args.preferredActualSource)) {
    return buildUnavailableOnePathIntervalDiagnosticsV1({ unavailableReason: "non_interval_source" });
  }
  const sourceType: OnePathIntervalSourceType | null =
    args.preferredActualSource === "GREEN_BUTTON"
      ? "GREEN_BUTTON"
      : args.preferredActualSource === "SMT" || inputType === "INTERVAL"
        ? "SMT"
        : inputType === "GREEN_BUTTON"
          ? "GREEN_BUTTON"
          : null;
  if (!sourceType) {
    return buildUnavailableOnePathIntervalDiagnosticsV1({ unavailableReason: "non_interval_source" });
  }
  if (!args.actualDataset || !args.simulatedDataset) {
    return buildUnavailableOnePathIntervalDiagnosticsV1({
      unavailableReason: "missing_compare_datasets",
      sourceType,
    });
  }
  const meta = (args.simulatedDataset as any)?.meta;
  const validationHoldoutProofOk = Boolean(meta?.validationHoldoutProof?.ok === true);
  return buildOnePathIntervalCompareDiagnosticsV1({
    sourceType,
    actualDataset: args.actualDataset,
    simulatedDataset: args.simulatedDataset,
    validationDayKeys: extractValidationDayKeysFromCompareProjection(args.compareProjection),
    validationHoldoutProofOk,
    travelRanges: args.travelRanges,
    weatherIdentity: args.weatherIdentity ?? null,
    includePosthocTopMissIntervalCurves: args.includePosthocTopMissIntervalCurves === true,
    posthocTopMissDayCount: args.posthocTopMissDayCount ?? 5,
  });
}
