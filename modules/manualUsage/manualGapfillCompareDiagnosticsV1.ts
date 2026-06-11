import type { ManualGapfillCompareMonthlyRow } from "@/modules/manualUsage/manualGapfillCompare";
import type { ManualUsageReadModel } from "@/modules/manualUsage/readModel";
import type { ManualUsagePayload, TravelRange } from "@/modules/simulatedUsage/types";
import { resolveReportedCoverageWindow } from "@/lib/usage/canonicalMetadataWindow";

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

export type ManualGapfillWeatherBucket =
  | "extreme_cold"
  | "cold"
  | "mild"
  | "warm"
  | "hot"
  | "extreme_hot"
  | "unknown";

export type ManualGapfillTravelSource =
  | "lab_db"
  | "seed_payload"
  | "source_fallback"
  | "unknown";

export type ManualGapfillCompareDiagnosticsBucketSummary = {
  dayCount: number;
  actualTotalKwh: number;
  simulatedTotalKwh: number;
  deltaKwh: number;
  biasKwhPerDay: number | null;
  meanAbsoluteDailyDeltaKwh: number | null;
  medianAbsoluteDailyDeltaKwh: number | null;
  wape: number | null;
  percentBias: number | null;
};

export type ManualGapfillDailyWeatherMissDay = {
  date: string;
  actualKwh: number | null;
  simulatedKwh: number | null;
  deltaKwh: number | null;
  absoluteDeltaKwh: number | null;
  percentDelta: number | null;
  validationDay: boolean;
  billPeriodId: string | null;
  billPeriodStartDate: string | null;
  billPeriodEndDate: string | null;
  billPeriodStatus: ManualGapfillCompareMonthlyRow["status"] | null;
  weekdayWeekend: "weekday" | "weekend" | null;
  season: "winter" | "summer" | "shoulder" | null;
  month: string | null;
  holidayFlag: boolean | null;
  travelVacantFlag: boolean;
  travelRangeId: string | null;
  excludedFromScoring: boolean;
  meanTemp: number | null;
  maxTemp: number | null;
  minTemp: number | null;
  heatingDegreeDays: number | null;
  coolingDegreeDays: number | null;
  weatherBucket: ManualGapfillWeatherBucket;
};

export type ManualGapfillWeatherSensitivitySummary = {
  actualKwhPerCoolingDegreeDay: number | null;
  simulatedKwhPerCoolingDegreeDay: number | null;
  coolingSensitivityDelta: number | null;
  actualKwhPerHeatingDegreeDay: number | null;
  simulatedKwhPerHeatingDegreeDay: number | null;
  heatingSensitivityDelta: number | null;
  actualMildDayBaseloadEstimate: number | null;
  simulatedMildDayBaseloadEstimate: number | null;
  hotDayBias: number | null;
  coldDayBias: number | null;
  mildDayBias: number | null;
};

export type ManualGapfillTravelDayDiagnostic = {
  date: string;
  actualKwh: number | null;
  simulatedKwh: number | null;
  deltaKwh: number | null;
  travelRangeId: string | null;
  travelRangeStart: string | null;
  travelRangeEnd: string | null;
  travelVacantFlag: true;
  excludedFromScoring: boolean;
  simUsedTravelAdjustment: boolean | "unknown";
  occupancyFactorApplied: number | null;
  vacantBaseloadKwhExpected: number | null;
  sourceOfTravel: ManualGapfillTravelSource;
};

export type ManualGapfillTravelDiagnostics = {
  travelRangeCount: number;
  travelDayCount: number;
  travelDaysExcludedFromScoring: number;
  travelDaysAffectingSim: number;
  travelDaysOnlyExcludedNotSimAdjusted: number;
  travelActualTotalKwh: number;
  travelSimulatedTotalKwh: number;
  travelWape: number | null;
  travelBias: number | null;
  days: ManualGapfillTravelDayDiagnostic[];
};

export type ManualGapfillBillPeriodAllocationDiagnostic = {
  periodId: string;
  startDate: string;
  endDate: string;
  dayCount: number;
  actualKwh: number | null;
  simulatedKwh: number | null;
  deltaKwh: number | null;
  status: ManualGapfillCompareMonthlyRow["status"];
  dailyWapeInsidePeriod: number | null;
  meanDailyDelta: number | null;
  medianDailyDelta: number | null;
  maxOverSimDay: { date: string; deltaKwh: number } | null;
  maxUnderSimDay: { date: string; deltaKwh: number } | null;
  flatnessScore: number | null;
  actualDailyStdDev: number | null;
  simulatedDailyStdDev: number | null;
  weatherSensitivityWithinPeriod: number | null;
  travelDayCount: number;
  validationDayCount: number;
  diagnosticFlags: string[];
};

export type ManualGapfillValidationIntervalCurveDay = {
  date: string;
  validationDay: boolean;
  slotCountActual: number;
  slotCountSimulated: number;
  intervalWape: number | null;
  rawIntervalWape: number | null;
  intervalMae: number | null;
  intervalRmse: number | null;
  shapeCorrelation: number | null;
  normalizedShapeError: number | null;
  peakActualKwh: number | null;
  peakSimulatedKwh: number | null;
  peakActualLocalTime: string | null;
  peakSimulatedLocalTime: string | null;
  peakTimingErrorMinutes: number | null;
  actualDailyTotalKwh: number | null;
  simulatedDailyTotalKwh: number | null;
  dailyTotalDeltaKwh: number | null;
  simulatedIntervalsDerivedFromDailyTotal: boolean;
  overnight: { actual: number; simulated: number; delta: number };
  morning: { actual: number; simulated: number; delta: number };
  afternoon: { actual: number; simulated: number; delta: number };
  evening: { actual: number; simulated: number; delta: number };
  todBuckets: {
    overnight: ManualGapfillTodBucketBlock;
    morning: ManualGapfillTodBucketBlock;
    afternoon: ManualGapfillTodBucketBlock;
    evening: ManualGapfillTodBucketBlock;
  };
  actual96SlotShape: number[];
  simulated96SlotShape: number[];
};

export type ManualGapfillTodBucketBlock = {
  actualKwh: number;
  simulatedKwh: number;
  deltaKwh: number;
  shareActual: number | null;
  shareSimulated: number | null;
};

export type ManualGapfillWorstDayEntry = {
  date: string;
  actualKwh: number | null;
  simulatedKwh: number | null;
  deltaKwh: number | null;
  absDeltaKwh: number | null;
  weatherBucket: ManualGapfillWeatherBucket;
  maxTemp: number | null;
  minTemp: number | null;
  avgTemp: number | null;
  heatingDegreeDays: number | null;
  coolingDegreeDays: number | null;
  weekdayWeekend: "weekday" | "weekend" | null;
  travelVacantFlag: boolean;
  billPeriodId: string | null;
  validationDay: boolean;
  priorDayActual: number | null;
  priorDaySimulated: number | null;
  nextDayActual: number | null;
  nextDaySimulated: number | null;
  likelyCauseTags: string[];
};

export type ManualGapfillCompareDiagnosticsDashboardSummary = {
  dailyWape: number | null;
  dailyBiasKwh: number | null;
  validationDayWape: number | null;
  validationDayBiasKwh: number | null;
  hotDayWape: number | null;
  hotDayBiasKwh: number | null;
  coldDayWape: number | null;
  coldDayBiasKwh: number | null;
  mildDayWape: number | null;
  mildDayBiasKwh: number | null;
  travelVacantWape: number | null;
  travelVacantBiasKwh: number | null;
  validationIntervalCurveWape: number | null;
  validationNormalizedShapeError: number | null;
  peakTimingErrorMinutes: number | null;
  todBucketError: number | null;
  dailyAllocationFlatnessScore: number | null;
  weatherSensitivityActualVsSimulated: {
    coolingSensitivityDelta: number | null;
    heatingSensitivityDelta: number | null;
  };
};

export type ManualGapfillCompareDiagnosticsV1 = {
  version: "v1";
  weatherDiagnosticsAvailable: boolean;
  missingWeatherFields: string[];
  dailyWeatherMissDiagnostics: {
    days: ManualGapfillDailyWeatherMissDay[];
    summaryBuckets: Record<string, ManualGapfillCompareDiagnosticsBucketSummary>;
  };
  weatherDiagnostics: ManualGapfillWeatherSensitivitySummary;
  travelDiagnostics: ManualGapfillTravelDiagnostics;
  billPeriodAllocationDiagnostics: ManualGapfillBillPeriodAllocationDiagnostic[];
  validationIntervalCurveDiagnostics: {
    available: boolean;
    unavailableReason: string | null;
    selectedValidationDayCount: number;
    includedWorstDayCount: number;
    defaultScope: "validation_days_plus_top_worst";
    selectedValidationDayKeysUsed: string[];
    actualIntervalRowsFound: number;
    simulatedIntervalRowsFound: number;
    days: ManualGapfillValidationIntervalCurveDay[];
    todBucketSummary: {
      overnight: { actual: number; simulated: number; delta: number };
      morning: { actual: number; simulated: number; delta: number };
      afternoon: { actual: number; simulated: number; delta: number };
      evening: { actual: number; simulated: number; delta: number };
    };
  };
  worstDayDiagnostics: {
    topOverSimDays: ManualGapfillWorstDayEntry[];
    topUnderSimDays: ManualGapfillWorstDayEntry[];
    topAbsoluteDailyMisses: ManualGapfillWorstDayEntry[];
    topIntervalShapeMisses: ManualGapfillWorstDayEntry[];
    topPeakTimingMisses: ManualGapfillWorstDayEntry[];
  };
  dashboardSummary: ManualGapfillCompareDiagnosticsDashboardSummary;
};

export type ManualGapfillCompareDiagnosticsV1Args = {
  dailyRows: Array<{
    date: string;
    actualKwh: number | null;
    simulatedKwh: number | null;
    deltaKwh: number | null;
    percentDelta: number | null;
  }>;
  monthlyRows?: ManualGapfillCompareMonthlyRow[];
  readModel?: ManualUsageReadModel | null;
  validationDayKeys?: string[];
  sourceActualDataset?: any;
  labDataset?: any;
  labManualPayload?: ManualUsagePayload | null;
  travelContext?: {
    effectiveRanges: TravelRange[];
    labDbRanges: TravelRange[];
    sourceFallbackRanges: TravelRange[];
    seedPayloadRanges: TravelRange[];
  };
  timezone?: string | null;
  topWorstDayCount?: number;
};

export type Mg4SourceActualIsolationLabelCleanup = {
  usedSourceActualTruthAsContextOnly: boolean;
  usedSourceActualTruthAsContextOnlyDeprecated: true;
  replacementFields: string[];
  sourceActualUsedForSeedOnly: boolean;
  sourceActualUsedForFingerprintGuardrail: boolean;
  sourceActualLoadedOutsideSimulator: boolean;
  sourceActualPassedIntoManualSimulator: false;
  sourceActualPassedIntoManualReadbackProjection: false;
};

const MG4_REPLACEMENT_FIELDS = [
  "sourceActualUsedForSeedOnly",
  "sourceActualUsedForFingerprintGuardrail",
  "sourceActualLoadedOutsideSimulator",
  "sourceActualPassedIntoManualSimulator",
  "sourceActualPassedIntoManualReadbackProjection",
] as const;

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

function travelRangeId(range: TravelRange): string {
  return `${range.startDate}:${range.endDate}`;
}

function dateInRange(date: string, range: TravelRange): boolean {
  return date >= range.startDate && date <= range.endDate;
}

function normalizeTravelRanges(ranges: TravelRange[] | undefined | null): TravelRange[] {
  return (ranges ?? [])
    .map((range) => ({
      startDate: String(range.startDate ?? "").slice(0, 10),
      endDate: String(range.endDate ?? "").slice(0, 10),
    }))
    .filter((range) => /^\d{4}-\d{2}-\d{2}$/.test(range.startDate) && /^\d{4}-\d{2}-\d{2}$/.test(range.endDate));
}

function filterTravelRangesToCoverageWindow(
  ranges: TravelRange[] | undefined | null,
  window: { startDate: string; endDate: string } | null | undefined
): TravelRange[] {
  const normalized = normalizeTravelRanges(ranges);
  const windowStart = String(window?.startDate ?? "").slice(0, 10);
  const windowEnd = String(window?.endDate ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(windowStart) || !/^\d{4}-\d{2}-\d{2}$/.test(windowEnd) || windowStart > windowEnd) {
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
  return clipped;
}

function rangesEqual(left: TravelRange, right: TravelRange): boolean {
  return left.startDate === right.startDate && left.endDate === right.endDate;
}

function resolveTravelSourceForRange(
  range: TravelRange,
  context: ManualGapfillCompareDiagnosticsV1Args["travelContext"]
): ManualGapfillTravelSource {
  if (!context) return "unknown";
  if (context.labDbRanges.some((entry) => rangesEqual(entry, range))) return "lab_db";
  if (context.seedPayloadRanges.some((entry) => rangesEqual(entry, range))) return "seed_payload";
  if (context.sourceFallbackRanges.some((entry) => rangesEqual(entry, range))) return "source_fallback";
  return "unknown";
}

type DailyWeatherRecord = {
  meanTemp: number | null;
  maxTemp: number | null;
  minTemp: number | null;
  hdd: number | null;
  cdd: number | null;
  holidayFlag: boolean | null;
};

function readDailyWeatherRecord(raw: unknown): DailyWeatherRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const meanTemp =
    typeof rec.meanTempF === "number"
      ? rec.meanTempF
      : typeof rec.tAvgF === "number"
        ? rec.tAvgF
        : typeof rec.avgTemp === "number"
          ? rec.avgTemp
          : null;
  const maxTemp = typeof rec.tMaxF === "number" ? rec.tMaxF : typeof rec.maxTemp === "number" ? rec.maxTemp : null;
  const minTemp = typeof rec.tMinF === "number" ? rec.tMinF : typeof rec.minTemp === "number" ? rec.minTemp : null;
  const hdd =
    typeof rec.hdd === "number"
      ? rec.hdd
      : typeof rec.hdd65 === "number"
        ? rec.hdd65
        : typeof rec.heatingDegreeDays === "number"
          ? rec.heatingDegreeDays
          : null;
  const cdd =
    typeof rec.cdd === "number"
      ? rec.cdd
      : typeof rec.cdd65 === "number"
        ? rec.cdd65
        : typeof rec.coolingDegreeDays === "number"
          ? rec.coolingDegreeDays
          : null;
  const holidayFlag =
    typeof rec.isHoliday === "boolean"
      ? rec.isHoliday
      : typeof rec.holiday === "boolean"
        ? rec.holiday
        : null;
  return { meanTemp, maxTemp, minTemp, hdd, cdd, holidayFlag };
}

function buildDailyWeatherMap(dataset: any): Map<string, DailyWeatherRecord> {
  const out = new Map<string, DailyWeatherRecord>();
  const dailyWeather = dataset?.dailyWeather;
  if (!dailyWeather || typeof dailyWeather !== "object" || Array.isArray(dailyWeather)) return out;
  for (const [dateKey, raw] of Object.entries(dailyWeather as Record<string, unknown>)) {
    const date = String(dateKey).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const parsed = readDailyWeatherRecord(raw);
    if (parsed) out.set(date, parsed);
  }
  return out;
}

function classifyWeatherBucket(weather: DailyWeatherRecord | null | undefined): ManualGapfillWeatherBucket {
  if (!weather) return "unknown";
  const mean = weather.meanTemp;
  if (mean == null || !Number.isFinite(mean)) return "unknown";
  if (mean <= 25) return "extreme_cold";
  if (mean <= 45) return "cold";
  if (mean <= 65) return "mild";
  if (mean <= 78) return "warm";
  if (mean <= 90) return "hot";
  return "extreme_hot";
}

function buildBillPeriodMaps(monthlyRows: ManualGapfillCompareMonthlyRow[] | undefined) {
  const byDate = new Map<
    string,
    {
      periodId: string;
      startDate: string;
      endDate: string;
      status: ManualGapfillCompareMonthlyRow["status"];
    }
  >();
  for (const row of monthlyRows ?? []) {
    const start = row.startDate.slice(0, 10);
    const end = row.endDate.slice(0, 10);
    const cursor = new Date(`${start}T00:00:00.000Z`);
    const endDate = new Date(`${end}T00:00:00.000Z`);
    if (!Number.isFinite(cursor.getTime()) || !Number.isFinite(endDate.getTime())) continue;
    for (let ts = cursor.getTime(); ts <= endDate.getTime(); ts += 86400000) {
      const date = new Date(ts).toISOString().slice(0, 10);
      byDate.set(date, {
        periodId: row.periodId,
        startDate: start,
        endDate: end,
        status: row.status,
      });
    }
  }
  return byDate;
}

function buildTravelDayMaps(ranges: TravelRange[]) {
  const travelByDate = new Map<string, { range: TravelRange; rangeId: string }>();
  for (const range of ranges) {
    const start = new Date(`${range.startDate}T00:00:00.000Z`);
    const end = new Date(`${range.endDate}T00:00:00.000Z`);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) continue;
    for (let ts = start.getTime(); ts <= end.getTime(); ts += 86400000) {
      const date = new Date(ts).toISOString().slice(0, 10);
      travelByDate.set(date, { range, rangeId: travelRangeId(range) });
    }
  }
  return travelByDate;
}

function resolveManualGapfillDiagnosticsCoverageWindow(args: ManualGapfillCompareDiagnosticsV1Args): {
  startDate: string;
  endDate: string;
} | null {
  const sourceSummary = args.sourceActualDataset?.summary;
  const labSummary = args.labDataset?.summary;
  const fallbackStart = String(sourceSummary?.start ?? labSummary?.start ?? "").slice(0, 10);
  const fallbackEnd = String(sourceSummary?.end ?? labSummary?.end ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fallbackStart) || !/^\d{4}-\d{2}-\d{2}$/.test(fallbackEnd)) {
    return null;
  }
  return resolveReportedCoverageWindow({
    dataset: args.sourceActualDataset ?? args.labDataset,
    fallbackStartDate: fallbackStart,
    fallbackEndDate: fallbackEnd,
  });
}

function computeBucketSummary(days: ManualGapfillDailyWeatherMissDay[]): ManualGapfillCompareDiagnosticsBucketSummary {
  const comparable = days.filter((day) => day.actualKwh != null && day.simulatedKwh != null);
  const actualTotalKwh = round2(comparable.reduce((sum, day) => sum + (day.actualKwh ?? 0), 0)) ?? 0;
  const simulatedTotalKwh = round2(comparable.reduce((sum, day) => sum + (day.simulatedKwh ?? 0), 0)) ?? 0;
  const deltaKwh = round2(simulatedTotalKwh - actualTotalKwh) ?? 0;
  const absDeltas = comparable
    .map((day) => day.absoluteDeltaKwh)
    .filter((value): value is number => value != null);
  const sortedAbs = [...absDeltas].sort((a, b) => a - b);
  const dayCount = comparable.length;
  const biasKwhPerDay = dayCount > 0 ? round2(deltaKwh / dayCount) : null;
  const meanAbsoluteDailyDeltaKwh =
    absDeltas.length > 0 ? round2(absDeltas.reduce((sum, value) => sum + value, 0) / absDeltas.length) : null;
  const medianAbsoluteDailyDeltaKwh =
    sortedAbs.length === 0
      ? null
      : round2(
          sortedAbs.length % 2 === 1
            ? sortedAbs[(sortedAbs.length - 1) / 2]!
            : (sortedAbs[sortedAbs.length / 2 - 1]! + sortedAbs[sortedAbs.length / 2]!) / 2
        );
  const wape = actualTotalKwh > 1e-6 ? round2(absDeltas.reduce((sum, value) => sum + value, 0) / actualTotalKwh) : null;
  const percentBias =
    actualTotalKwh > 1e-6 ? round2(((simulatedTotalKwh - actualTotalKwh) / actualTotalKwh) * 100) : null;
  return {
    dayCount,
    actualTotalKwh,
    simulatedTotalKwh,
    deltaKwh,
    biasKwhPerDay,
    meanAbsoluteDailyDeltaKwh,
    medianAbsoluteDailyDeltaKwh,
    wape,
    percentBias,
  };
}

function stdDev(values: number[]): number | null {
  if (values.length === 0) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return round2(Math.sqrt(variance));
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

function hhmmFromSlot(slot: number): string {
  const totalMinutes = slot * 15;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function slotsHaveSignal(slots: number[] | undefined): boolean {
  if (!slots || slots.length === 0) return false;
  return slots.some((value) => Number.isFinite(value) && value > 1e-9);
}

function buildTodBucketBlock(
  actual: number,
  simulated: number,
  totalActual: number,
  totalSimulated: number
): ManualGapfillTodBucketBlock {
  return {
    actualKwh: actual,
    simulatedKwh: simulated,
    deltaKwh: round4(simulated - actual),
    shareActual: totalActual > 1e-6 ? round4(actual / totalActual) : null,
    shareSimulated: totalSimulated > 1e-6 ? round4(simulated / totalSimulated) : null,
  };
}

function deriveSimulatedSlotsFromDailyShape(args: {
  actualSlots: number[];
  targetDailyKwh: number;
}): number[] {
  const actualTotal = args.actualSlots.reduce((sum, value) => sum + value, 0);
  if (actualTotal <= 1e-12) {
    return Array.from({ length: 96 }, () => round4(args.targetDailyKwh / 96));
  }
  const scale = args.targetDailyKwh / actualTotal;
  return args.actualSlots.map((value) => round4(value * scale));
}

function countIntervalRowsForDates(rows: IntervalPoint[], timezone: string, dateKeys: Set<string>): number {
  let count = 0;
  for (const row of rows) {
    const localDate = dateKeyInTimezone(String(row.timestamp ?? ""), timezone);
    if (localDate && dateKeys.has(localDate)) count += 1;
  }
  return count;
}

function sumBlock(values: number[], startSlot: number, endSlot: number): number {
  let sum = 0;
  for (let slot = startSlot; slot <= endSlot; slot += 1) sum += values[slot] ?? 0;
  return round4(sum);
}

type IntervalPoint = { timestamp: string; kwh: number };

function intervalsByDateAndSlot(
  rows: IntervalPoint[],
  timezone: string,
  selectedDateKeys: Set<string>
): Map<string, number[]> {
  const byDate = new Map<string, number[]>();
  for (const row of rows) {
    const ts = String(row.timestamp ?? "").trim();
    const kwh = Number(row.kwh ?? Number.NaN);
    if (!ts || !Number.isFinite(kwh)) continue;
    const localDate = dateKeyInTimezone(ts, timezone);
    if (!selectedDateKeys.has(localDate)) continue;
    const slot = localSlot96InTimezone(ts, timezone);
    const bucket = byDate.get(localDate) ?? Array.from({ length: 96 }, () => 0);
    bucket[slot] += kwh;
    byDate.set(localDate, bucket);
  }
  return byDate;
}

function readIntervalPoints(dataset: any): IntervalPoint[] {
  const rows = Array.isArray(dataset?.series?.intervals15) ? dataset.series.intervals15 : [];
  return rows
    .map((row: any) => ({
      timestamp: String(row?.timestamp ?? "").trim(),
      kwh: Number(row?.kwh ?? Number.NaN),
    }))
    .filter((row: IntervalPoint) => row.timestamp && Number.isFinite(row.kwh));
}

function inferSimUsedTravelAdjustment(args: {
  date: string;
  actualKwh: number | null;
  simulatedKwh: number | null;
  labDailyRow: Record<string, unknown> | null;
  nonTravelMedianSim: number | null;
}): boolean | "unknown" {
  const sourceDetail = String(args.labDailyRow?.sourceDetail ?? "").toUpperCase();
  if (/TRAVEL|VACANT/.test(sourceDetail)) return true;
  if (args.actualKwh == null || args.simulatedKwh == null) return "unknown";
  if (args.nonTravelMedianSim == null || args.nonTravelMedianSim <= 0) return "unknown";
  const actualLow = args.actualKwh < args.nonTravelMedianSim * 0.45;
  const simLow = args.simulatedKwh < args.nonTravelMedianSim * 0.75;
  if (actualLow && !simLow) return false;
  if (actualLow && simLow) return true;
  return "unknown";
}

function buildLikelyCauseTags(args: {
  day: ManualGapfillDailyWeatherMissDay;
  simUsedTravelAdjustment: boolean | "unknown";
  flatnessFlag?: boolean;
  normalizedShapeError?: number | null;
  peakTimingErrorMinutes?: number | null;
}): string[] {
  const tags: string[] = [];
  if (args.day.weatherBucket === "unknown") tags.push("weather_data_missing");
  if (args.day.travelVacantFlag) {
    if (args.simUsedTravelAdjustment === false) tags.push("travel_not_applied");
    if (args.day.excludedFromScoring && args.simUsedTravelAdjustment !== true) tags.push("travel_day_excluded_only");
  }
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
  if (args.flatnessFlag) tags.push("manual_period_flat_allocation");
  if ((args.normalizedShapeError ?? 0) > 0.08) tags.push("intraday_shape_wrong");
  if ((args.peakTimingErrorMinutes ?? 0) >= 60) tags.push("peak_timing_wrong");
  if (args.day.weekdayWeekend === "weekend" && Math.abs(args.day.deltaKwh ?? 0) > 3) tags.push("weekend_behavior_miss");
  if (args.day.holidayFlag && Math.abs(args.day.deltaKwh ?? 0) > 3) tags.push("holiday_behavior_miss");
  return tags;
}

function buildWeatherSensitivity(days: ManualGapfillDailyWeatherMissDay[]): ManualGapfillWeatherSensitivitySummary {
  const coolingDays = days.filter((day) => (day.coolingDegreeDays ?? 0) > 0.5 && day.actualKwh != null && day.simulatedKwh != null);
  const heatingDays = days.filter((day) => (day.heatingDegreeDays ?? 0) > 0.5 && day.actualKwh != null && day.simulatedKwh != null);
  const mildDays = days.filter((day) => day.weatherBucket === "mild" && day.actualKwh != null && day.simulatedKwh != null);
  const hotDays = days.filter(
    (day) => (day.weatherBucket === "hot" || day.weatherBucket === "extreme_hot") && day.actualKwh != null && day.simulatedKwh != null
  );
  const coldDays = days.filter(
    (day) => (day.weatherBucket === "cold" || day.weatherBucket === "extreme_cold") && day.actualKwh != null && day.simulatedKwh != null
  );

  const actualCoolingKwh = coolingDays.reduce((sum, day) => sum + (day.actualKwh ?? 0), 0);
  const simCoolingKwh = coolingDays.reduce((sum, day) => sum + (day.simulatedKwh ?? 0), 0);
  const totalCdd = coolingDays.reduce((sum, day) => sum + (day.coolingDegreeDays ?? 0), 0);
  const actualHeatingKwh = heatingDays.reduce((sum, day) => sum + (day.actualKwh ?? 0), 0);
  const simHeatingKwh = heatingDays.reduce((sum, day) => sum + (day.simulatedKwh ?? 0), 0);
  const totalHdd = heatingDays.reduce((sum, day) => sum + (day.heatingDegreeDays ?? 0), 0);

  const actualKwhPerCoolingDegreeDay = totalCdd > 0 ? round2(actualCoolingKwh / totalCdd) : null;
  const simulatedKwhPerCoolingDegreeDay = totalCdd > 0 ? round2(simCoolingKwh / totalCdd) : null;
  const actualKwhPerHeatingDegreeDay = totalHdd > 0 ? round2(actualHeatingKwh / totalHdd) : null;
  const simulatedKwhPerHeatingDegreeDay = totalHdd > 0 ? round2(simHeatingKwh / totalHdd) : null;

  const actualMildDayBaseloadEstimate =
    mildDays.length > 0 ? round2(mildDays.reduce((sum, day) => sum + (day.actualKwh ?? 0), 0) / mildDays.length) : null;
  const simulatedMildDayBaseloadEstimate =
    mildDays.length > 0 ? round2(mildDays.reduce((sum, day) => sum + (day.simulatedKwh ?? 0), 0) / mildDays.length) : null;

  const hotDayBias =
    hotDays.length > 0
      ? round2(hotDays.reduce((sum, day) => sum + (day.deltaKwh ?? 0), 0) / hotDays.length)
      : null;
  const coldDayBias =
    coldDays.length > 0
      ? round2(coldDays.reduce((sum, day) => sum + (day.deltaKwh ?? 0), 0) / coldDays.length)
      : null;
  const mildDayBias =
    mildDays.length > 0
      ? round2(mildDays.reduce((sum, day) => sum + (day.deltaKwh ?? 0), 0) / mildDays.length)
      : null;

  return {
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
    actualMildDayBaseloadEstimate,
    simulatedMildDayBaseloadEstimate,
    hotDayBias,
    coldDayBias,
    mildDayBias,
  };
}

function buildIntervalCurveDay(args: {
  date: string;
  validationDay: boolean;
  actualSlots: number[];
  simulatedSlots: number[];
  actualDailyTotalKwh: number | null;
  simulatedDailyTotalKwh: number | null;
  simulatedIntervalsDerivedFromDailyTotal: boolean;
}): ManualGapfillValidationIntervalCurveDay {
  const absErrors = args.actualSlots.map((value, index) => Math.abs(value - (args.simulatedSlots[index] ?? 0)));
  const squaredErrors = args.actualSlots.map((value, index) => {
    const delta = value - (args.simulatedSlots[index] ?? 0);
    return delta * delta;
  });
  const actualTotal = args.actualSlots.reduce((sum, value) => sum + value, 0);
  const simulatedTotal = args.simulatedSlots.reduce((sum, value) => sum + value, 0);
  const intervalWape = actualTotal > 1e-6 ? round4(absErrors.reduce((sum, value) => sum + value, 0) / actualTotal) : null;
  const intervalMae = absErrors.length > 0 ? round4(absErrors.reduce((sum, value) => sum + value, 0) / absErrors.length) : null;
  const intervalRmse =
    squaredErrors.length > 0
      ? round4(Math.sqrt(squaredErrors.reduce((sum, value) => sum + value, 0) / squaredErrors.length))
      : null;
  const peakActualSlot = peakSlot(args.actualSlots);
  const peakSimulatedSlot = peakSlot(args.simulatedSlots);
  const dayTotalActual = args.actualDailyTotalKwh ?? round2(actualTotal);
  const dayTotalSimulated = args.simulatedDailyTotalKwh ?? round2(simulatedTotal);
  const overnightActual = sumBlock(args.actualSlots, 0, 23);
  const overnightSim = sumBlock(args.simulatedSlots, 0, 23);
  const morningActual = sumBlock(args.actualSlots, 24, 47);
  const morningSim = sumBlock(args.simulatedSlots, 24, 47);
  const afternoonActual = sumBlock(args.actualSlots, 48, 71);
  const afternoonSim = sumBlock(args.simulatedSlots, 48, 71);
  const eveningActual = sumBlock(args.actualSlots, 72, 95);
  const eveningSim = sumBlock(args.simulatedSlots, 72, 95);
  return {
    date: args.date,
    validationDay: args.validationDay,
    slotCountActual: args.actualSlots.filter((value) => value > 0).length,
    slotCountSimulated: args.simulatedSlots.filter((value) => value > 0).length,
    intervalWape,
    rawIntervalWape: intervalWape,
    intervalMae,
    intervalRmse,
    shapeCorrelation: correlation(args.actualSlots, args.simulatedSlots),
    normalizedShapeError: normalizedShapeError(args.actualSlots, args.simulatedSlots),
    peakActualKwh: round4(args.actualSlots[peakActualSlot] ?? 0),
    peakSimulatedKwh: round4(args.simulatedSlots[peakSimulatedSlot] ?? 0),
    peakActualLocalTime: hhmmFromSlot(peakActualSlot),
    peakSimulatedLocalTime: hhmmFromSlot(peakSimulatedSlot),
    peakTimingErrorMinutes: Math.abs(peakSimulatedSlot - peakActualSlot) * 15,
    actualDailyTotalKwh: dayTotalActual,
    simulatedDailyTotalKwh: dayTotalSimulated,
    dailyTotalDeltaKwh:
      dayTotalActual != null && dayTotalSimulated != null ? round2(dayTotalSimulated - dayTotalActual) : null,
    simulatedIntervalsDerivedFromDailyTotal: args.simulatedIntervalsDerivedFromDailyTotal,
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
    actual96SlotShape: [...args.actualSlots],
    simulated96SlotShape: [...args.simulatedSlots],
  };
}

export function buildMg4SourceActualIsolationLabelCleanup(args: {
  usedSourceActualTruthAsContextOnly: boolean;
  sourceActualUsedForFingerprintGuardrail?: boolean;
}): Mg4SourceActualIsolationLabelCleanup {
  return {
    usedSourceActualTruthAsContextOnly: args.usedSourceActualTruthAsContextOnly,
    usedSourceActualTruthAsContextOnlyDeprecated: true,
    replacementFields: [...MG4_REPLACEMENT_FIELDS],
    sourceActualUsedForSeedOnly: args.usedSourceActualTruthAsContextOnly,
    sourceActualUsedForFingerprintGuardrail: args.sourceActualUsedForFingerprintGuardrail ?? false,
    sourceActualLoadedOutsideSimulator: args.usedSourceActualTruthAsContextOnly,
    sourceActualPassedIntoManualSimulator: false,
    sourceActualPassedIntoManualReadbackProjection: false,
  };
}

export function buildManualGapfillCompareDiagnosticsV1(
  args: ManualGapfillCompareDiagnosticsV1Args
): ManualGapfillCompareDiagnosticsV1 {
  const validationDaySet = new Set((args.validationDayKeys ?? []).map((date) => date.slice(0, 10)));
  const weatherByDate = buildDailyWeatherMap(args.sourceActualDataset);
  if (weatherByDate.size === 0) {
    const labWeather = buildDailyWeatherMap(args.labDataset);
    Array.from(labWeather.entries()).forEach(([date, weather]) => {
      if (!weatherByDate.has(date)) weatherByDate.set(date, weather);
    });
  }

  const missingWeatherFields: string[] = [];
  if (weatherByDate.size === 0) {
    missingWeatherFields.push("dailyWeather");
  }

  const coverageWindow = resolveManualGapfillDiagnosticsCoverageWindow(args);
  const effectiveTravelRanges = filterTravelRangesToCoverageWindow(
    normalizeTravelRanges(args.travelContext?.effectiveRanges ?? args.labManualPayload?.travelRanges ?? []),
    coverageWindow
  );
  const travelByDate = buildTravelDayMaps(effectiveTravelRanges);
  const billPeriodByDate = buildBillPeriodMaps(args.monthlyRows);
  const labDailyByDate = new Map<string, Record<string, unknown>>();
  for (const row of Array.isArray(args.labDataset?.daily) ? args.labDataset.daily : []) {
    const date = String((row as any)?.date ?? "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) labDailyByDate.set(date, row as Record<string, unknown>);
  }

  const nonTravelSimValues = args.dailyRows
    .filter((row) => !travelByDate.has(row.date) && row.simulatedKwh != null)
    .map((row) => row.simulatedKwh as number)
    .sort((a, b) => a - b);
  const nonTravelMedianSim =
    nonTravelSimValues.length === 0
      ? null
      : nonTravelSimValues.length % 2 === 1
        ? nonTravelSimValues[(nonTravelSimValues.length - 1) / 2]!
        : (nonTravelSimValues[nonTravelSimValues.length / 2 - 1]! + nonTravelSimValues[nonTravelSimValues.length / 2]!) /
          2;

  const enrichedDays: ManualGapfillDailyWeatherMissDay[] = args.dailyRows.map((row) => {
    const date = row.date.slice(0, 10);
    const weather = weatherByDate.get(date) ?? null;
    const travel = travelByDate.get(date) ?? null;
    const billPeriod = billPeriodByDate.get(date) ?? null;
    const deltaKwh = row.deltaKwh;
    const absoluteDeltaKwh = deltaKwh == null ? null : round2(Math.abs(deltaKwh));
    const excludedFromScoring = billPeriod?.status === "excluded";
    return {
      date,
      actualKwh: row.actualKwh,
      simulatedKwh: row.simulatedKwh,
      deltaKwh,
      absoluteDeltaKwh,
      percentDelta: row.percentDelta,
      validationDay: validationDaySet.has(date),
      billPeriodId: billPeriod?.periodId ?? null,
      billPeriodStartDate: billPeriod?.startDate ?? null,
      billPeriodEndDate: billPeriod?.endDate ?? null,
      billPeriodStatus: billPeriod?.status ?? null,
      weekdayWeekend: weekdayWeekend(date),
      season: seasonForMonth(date.slice(0, 7)),
      month: date.slice(0, 7),
      holidayFlag: weather?.holidayFlag ?? null,
      travelVacantFlag: travel != null,
      travelRangeId: travel?.rangeId ?? null,
      excludedFromScoring,
      meanTemp: weather?.meanTemp ?? null,
      maxTemp: weather?.maxTemp ?? null,
      minTemp: weather?.minTemp ?? null,
      heatingDegreeDays: weather?.hdd ?? null,
      coolingDegreeDays: weather?.cdd ?? null,
      weatherBucket: classifyWeatherBucket(weather),
    };
  });

  const byMonthBuckets = new Map<string, ManualGapfillDailyWeatherMissDay[]>();
  const bySeasonBuckets = new Map<string, ManualGapfillDailyWeatherMissDay[]>();
  const byBillPeriodBuckets = new Map<string, ManualGapfillDailyWeatherMissDay[]>();
  for (const day of enrichedDays) {
    if (day.month) {
      const bucket = byMonthBuckets.get(day.month) ?? [];
      bucket.push(day);
      byMonthBuckets.set(day.month, bucket);
    }
    if (day.season) {
      const bucket = bySeasonBuckets.get(day.season) ?? [];
      bucket.push(day);
      bySeasonBuckets.set(day.season, bucket);
    }
    if (day.billPeriodId) {
      const bucket = byBillPeriodBuckets.get(day.billPeriodId) ?? [];
      bucket.push(day);
      byBillPeriodBuckets.set(day.billPeriodId, bucket);
    }
  }

  const summaryBuckets: Record<string, ManualGapfillCompareDiagnosticsBucketSummary> = {
    all_days: computeBucketSummary(enrichedDays),
    validation_days_only: computeBucketSummary(enrichedDays.filter((day) => day.validationDay)),
    non_validation_days: computeBucketSummary(enrichedDays.filter((day) => !day.validationDay)),
    hot_days: computeBucketSummary(enrichedDays.filter((day) => day.weatherBucket === "hot")),
    extreme_hot_days: computeBucketSummary(enrichedDays.filter((day) => day.weatherBucket === "extreme_hot")),
    cold_days: computeBucketSummary(enrichedDays.filter((day) => day.weatherBucket === "cold")),
    extreme_cold_days: computeBucketSummary(enrichedDays.filter((day) => day.weatherBucket === "extreme_cold")),
    mild_days: computeBucketSummary(enrichedDays.filter((day) => day.weatherBucket === "mild")),
    weekdays: computeBucketSummary(enrichedDays.filter((day) => day.weekdayWeekend === "weekday")),
    weekends: computeBucketSummary(enrichedDays.filter((day) => day.weekdayWeekend === "weekend")),
    travel_vacant_days: computeBucketSummary(enrichedDays.filter((day) => day.travelVacantFlag)),
    non_travel_days: computeBucketSummary(enrichedDays.filter((day) => !day.travelVacantFlag)),
  };
  Array.from(byMonthBuckets.entries()).forEach(([month, days]) => {
    summaryBuckets[`month:${month}`] = computeBucketSummary(days);
  });
  Array.from(bySeasonBuckets.entries()).forEach(([season, days]) => {
    summaryBuckets[`season:${season}`] = computeBucketSummary(days);
  });
  Array.from(byBillPeriodBuckets.entries()).forEach(([periodId, days]) => {
    summaryBuckets[`bill_period:${periodId}`] = computeBucketSummary(days);
  });

  const weatherDiagnostics = buildWeatherSensitivity(enrichedDays);
  const weatherDiagnosticsAvailable = weatherByDate.size > 0;

  const travelDays: ManualGapfillTravelDayDiagnostic[] = enrichedDays
    .filter((day) => day.travelVacantFlag)
    .map((day) => {
      const travel = travelByDate.get(day.date)!;
      const simUsedTravelAdjustment = inferSimUsedTravelAdjustment({
        date: day.date,
        actualKwh: day.actualKwh,
        simulatedKwh: day.simulatedKwh,
        labDailyRow: labDailyByDate.get(day.date) ?? null,
        nonTravelMedianSim,
      });
      return {
        date: day.date,
        actualKwh: day.actualKwh,
        simulatedKwh: day.simulatedKwh,
        deltaKwh: day.deltaKwh,
        travelRangeId: travel.rangeId,
        travelRangeStart: travel.range.startDate,
        travelRangeEnd: travel.range.endDate,
        travelVacantFlag: true as const,
        excludedFromScoring: day.excludedFromScoring,
        simUsedTravelAdjustment,
        occupancyFactorApplied: null,
        vacantBaseloadKwhExpected: null,
        sourceOfTravel: resolveTravelSourceForRange(travel.range, args.travelContext),
      };
    });

  const travelDiagnostics: ManualGapfillTravelDiagnostics = {
    travelRangeCount: effectiveTravelRanges.length,
    travelDayCount: travelDays.length,
    travelDaysExcludedFromScoring: travelDays.filter((day) => day.excludedFromScoring).length,
    travelDaysAffectingSim: travelDays.filter((day) => day.simUsedTravelAdjustment === true).length,
    travelDaysOnlyExcludedNotSimAdjusted: travelDays.filter(
      (day) => day.excludedFromScoring && day.simUsedTravelAdjustment === false
    ).length,
    travelActualTotalKwh: round2(travelDays.reduce((sum, day) => sum + (day.actualKwh ?? 0), 0)) ?? 0,
    travelSimulatedTotalKwh: round2(travelDays.reduce((sum, day) => sum + (day.simulatedKwh ?? 0), 0)) ?? 0,
    travelWape: computeBucketSummary(
      enrichedDays.filter((day) => day.travelVacantFlag)
    ).wape,
    travelBias: computeBucketSummary(enrichedDays.filter((day) => day.travelVacantFlag)).biasKwhPerDay,
    days: travelDays,
  };

  const billPeriodAllocationDiagnostics: ManualGapfillBillPeriodAllocationDiagnostic[] = (args.monthlyRows ?? []).map(
    (row) => {
      const periodDays = enrichedDays.filter((day) => day.billPeriodId === row.periodId);
      const actualDaily = periodDays.map((day) => day.actualKwh).filter((value): value is number => value != null);
      const simulatedDaily = periodDays.map((day) => day.simulatedKwh).filter((value): value is number => value != null);
      const deltas = periodDays
        .map((day) => day.deltaKwh)
        .filter((value): value is number => value != null)
        .sort((a, b) => a - b);
      const actualDailyStdDev = stdDev(actualDaily);
      const simulatedDailyStdDev = stdDev(simulatedDaily);
      const flatnessScore =
        actualDailyStdDev != null && actualDailyStdDev > 1e-6 && simulatedDailyStdDev != null
          ? round2(simulatedDailyStdDev / actualDailyStdDev)
          : null;
      const diagnosticFlags: string[] = [];
      if (flatnessScore != null && flatnessScore < 0.55) diagnosticFlags.push("manual_period_flat_allocation");
      const maxOver = periodDays.reduce<{ date: string; deltaKwh: number } | null>((best, day) => {
        if (day.deltaKwh == null) return best;
        if (!best || day.deltaKwh > best.deltaKwh) return { date: day.date, deltaKwh: day.deltaKwh };
        return best;
      }, null);
      const maxUnder = periodDays.reduce<{ date: string; deltaKwh: number } | null>((best, day) => {
        if (day.deltaKwh == null) return best;
        if (!best || day.deltaKwh < best.deltaKwh) return { date: day.date, deltaKwh: day.deltaKwh };
        return best;
      }, null);
      const weatherSensitiveDays = periodDays.filter((day) => day.weatherBucket !== "mild" && day.weatherBucket !== "unknown");
      const weatherSensitivityWithinPeriod =
        weatherSensitiveDays.length > 0
          ? round2(
              weatherSensitiveDays.reduce((sum, day) => sum + Math.abs(day.deltaKwh ?? 0), 0) / weatherSensitiveDays.length
            )
          : null;
      return {
        periodId: row.periodId,
        startDate: row.startDate,
        endDate: row.endDate,
        dayCount: periodDays.length,
        actualKwh: row.actualKwh,
        simulatedKwh: row.simulatedKwh,
        deltaKwh: row.deltaKwh,
        status: row.status,
        dailyWapeInsidePeriod: computeBucketSummary(periodDays).wape,
        meanDailyDelta:
          deltas.length > 0 ? round2(deltas.reduce((sum, value) => sum + value, 0) / deltas.length) : null,
        medianDailyDelta:
          deltas.length === 0
            ? null
            : round2(
                deltas.length % 2 === 1
                  ? deltas[(deltas.length - 1) / 2]!
                  : (deltas[deltas.length / 2 - 1]! + deltas[deltas.length / 2]!) / 2
              ),
        maxOverSimDay: maxOver,
        maxUnderSimDay: maxUnder,
        flatnessScore,
        actualDailyStdDev,
        simulatedDailyStdDev,
        weatherSensitivityWithinPeriod,
        travelDayCount: periodDays.filter((day) => day.travelVacantFlag).length,
        validationDayCount: periodDays.filter((day) => day.validationDay).length,
        diagnosticFlags,
      };
    }
  );

  const timezone =
    String(args.timezone ?? args.labDataset?.meta?.timezone ?? args.sourceActualDataset?.meta?.timezone ?? "").trim() ||
    "America/Chicago";
  const selectedValidationDayKeysUsed = Array.from(validationDaySet).sort();
  const topWorstDayCount = args.topWorstDayCount ?? 10;
  const worstAbsoluteDates = [...enrichedDays]
    .filter((day) => day.absoluteDeltaKwh != null)
    .sort((a, b) => (b.absoluteDeltaKwh ?? 0) - (a.absoluteDeltaKwh ?? 0))
    .slice(0, topWorstDayCount)
    .map((day) => day.date);
  const selectedCurveDates = Array.from(new Set([...(args.validationDayKeys ?? []), ...worstAbsoluteDates])).sort();
  const selectedCurveDateSet = new Set(selectedCurveDates);
  const actualIntervals = readIntervalPoints(args.sourceActualDataset);
  const simulatedIntervalsRaw = readIntervalPoints(args.labDataset);
  const actualByDate = intervalsByDateAndSlot(actualIntervals, timezone, selectedCurveDateSet);
  const simulatedByDate = intervalsByDateAndSlot(simulatedIntervalsRaw, timezone, selectedCurveDateSet);
  const validationOnlyDateSet = new Set(selectedValidationDayKeysUsed);
  const actualIntervalRowsFound = countIntervalRowsForDates(actualIntervals, timezone, validationOnlyDateSet);
  const simulatedIntervalRowsFound = countIntervalRowsForDates(simulatedIntervalsRaw, timezone, validationOnlyDateSet);

  const curveDays: ManualGapfillValidationIntervalCurveDay[] = [];
  for (const date of selectedCurveDates) {
    let actualSlots = actualByDate.get(date);
    let simulatedSlots = simulatedByDate.get(date);
    const day = enrichedDays.find((entry) => entry.date === date);
    let simulatedIntervalsDerivedFromDailyTotal = false;

    if (!slotsHaveSignal(simulatedSlots) && slotsHaveSignal(actualSlots) && day?.simulatedKwh != null && day.simulatedKwh > 0) {
      simulatedSlots = deriveSimulatedSlotsFromDailyShape({
        actualSlots: actualSlots!,
        targetDailyKwh: day.simulatedKwh,
      });
      simulatedIntervalsDerivedFromDailyTotal = true;
    }

    if (!slotsHaveSignal(actualSlots) || !slotsHaveSignal(simulatedSlots)) continue;
    curveDays.push(
      buildIntervalCurveDay({
        date,
        validationDay: validationDaySet.has(date),
        actualSlots: actualSlots!,
        simulatedSlots: simulatedSlots!,
        actualDailyTotalKwh: day?.actualKwh ?? round2(actualSlots!.reduce((sum, value) => sum + value, 0)),
        simulatedDailyTotalKwh: day?.simulatedKwh ?? round2(simulatedSlots!.reduce((sum, value) => sum + value, 0)),
        simulatedIntervalsDerivedFromDailyTotal,
      })
    );
  }

  const validationCurveDays = curveDays.filter((day) => day.validationDay);
  const curveDiagnosticsAvailable = validationCurveDays.length > 0;
  const curveUnavailableReason = curveDiagnosticsAvailable
    ? null
    : actualIntervalRowsFound === 0
      ? "no_actual_interval_rows_for_selected_validation_days"
      : simulatedIntervalRowsFound === 0 &&
          !validationOnlyDateSet.size
        ? "no_selected_validation_days"
        : simulatedIntervalRowsFound === 0 &&
            selectedValidationDayKeysUsed.every((date) => {
              const day = enrichedDays.find((entry) => entry.date === date);
              return day?.simulatedKwh == null || day.simulatedKwh <= 0;
            })
          ? "no_simulated_interval_rows_or_daily_totals_for_selected_validation_days"
          : "validation_interval_curve_days_unavailable_for_selected_dates";
  const todBucketSummary = validationCurveDays.reduce(
    (acc, day) => ({
      overnight: {
        actual: round4(acc.overnight.actual + day.overnight.actual),
        simulated: round4(acc.overnight.simulated + day.overnight.simulated),
        delta: round4(acc.overnight.delta + day.overnight.delta),
      },
      morning: {
        actual: round4(acc.morning.actual + day.morning.actual),
        simulated: round4(acc.morning.simulated + day.morning.simulated),
        delta: round4(acc.morning.delta + day.morning.delta),
      },
      afternoon: {
        actual: round4(acc.afternoon.actual + day.afternoon.actual),
        simulated: round4(acc.afternoon.simulated + day.afternoon.simulated),
        delta: round4(acc.afternoon.delta + day.afternoon.delta),
      },
      evening: {
        actual: round4(acc.evening.actual + day.evening.actual),
        simulated: round4(acc.evening.simulated + day.evening.simulated),
        delta: round4(acc.evening.delta + day.evening.delta),
      },
    }),
    {
      overnight: { actual: 0, simulated: 0, delta: 0 },
      morning: { actual: 0, simulated: 0, delta: 0 },
      afternoon: { actual: 0, simulated: 0, delta: 0 },
      evening: { actual: 0, simulated: 0, delta: 0 },
    }
  );

  const dayByDate = new Map(enrichedDays.map((day) => [day.date, day]));
  const buildWorstEntry = (date: string, extra?: Partial<ManualGapfillWorstDayEntry>): ManualGapfillWorstDayEntry => {
    const day = dayByDate.get(date)!;
    const prior = dayByDate.get(
      new Date(Date.parse(`${date}T12:00:00.000Z`) - 86400000).toISOString().slice(0, 10)
    );
    const next = dayByDate.get(
      new Date(Date.parse(`${date}T12:00:00.000Z`) + 86400000).toISOString().slice(0, 10)
    );
    const curve = curveDays.find((entry) => entry.date === date);
    const travelDiag = travelDays.find((entry) => entry.date === date);
    const flatnessFlag = billPeriodAllocationDiagnostics.some(
      (period) => period.periodId === day.billPeriodId && period.diagnosticFlags.includes("manual_period_flat_allocation")
    );
    return {
      date,
      actualKwh: day.actualKwh,
      simulatedKwh: day.simulatedKwh,
      deltaKwh: day.deltaKwh,
      absDeltaKwh: day.absoluteDeltaKwh,
      weatherBucket: day.weatherBucket,
      maxTemp: day.maxTemp,
      minTemp: day.minTemp,
      avgTemp: day.meanTemp,
      heatingDegreeDays: day.heatingDegreeDays,
      coolingDegreeDays: day.coolingDegreeDays,
      weekdayWeekend: day.weekdayWeekend,
      travelVacantFlag: day.travelVacantFlag,
      billPeriodId: day.billPeriodId,
      validationDay: day.validationDay,
      priorDayActual: prior?.actualKwh ?? null,
      priorDaySimulated: prior?.simulatedKwh ?? null,
      nextDayActual: next?.actualKwh ?? null,
      nextDaySimulated: next?.simulatedKwh ?? null,
      likelyCauseTags: buildLikelyCauseTags({
        day,
        simUsedTravelAdjustment: travelDiag?.simUsedTravelAdjustment ?? "unknown",
        flatnessFlag,
        normalizedShapeError: curve?.normalizedShapeError,
        peakTimingErrorMinutes: curve?.peakTimingErrorMinutes,
      }),
      ...extra,
    };
  };

  const comparableDays = enrichedDays.filter((day) => day.deltaKwh != null);
  const topOverSimDays = [...comparableDays]
    .sort((a, b) => (b.deltaKwh ?? 0) - (a.deltaKwh ?? 0))
    .slice(0, topWorstDayCount)
    .map((day) => buildWorstEntry(day.date));
  const topUnderSimDays = [...comparableDays]
    .sort((a, b) => (a.deltaKwh ?? 0) - (b.deltaKwh ?? 0))
    .slice(0, topWorstDayCount)
    .map((day) => buildWorstEntry(day.date));
  const topAbsoluteDailyMisses = [...comparableDays]
    .sort((a, b) => (b.absoluteDeltaKwh ?? 0) - (a.absoluteDeltaKwh ?? 0))
    .slice(0, topWorstDayCount)
    .map((day) => buildWorstEntry(day.date));
  const topIntervalShapeMisses = [...validationCurveDays]
    .filter((day) => day.normalizedShapeError != null)
    .sort((a, b) => (b.normalizedShapeError ?? 0) - (a.normalizedShapeError ?? 0))
    .slice(0, topWorstDayCount)
    .map((day) => buildWorstEntry(day.date));
  const topPeakTimingMisses = [...validationCurveDays]
    .filter((day) => day.peakTimingErrorMinutes != null)
    .sort((a, b) => (b.peakTimingErrorMinutes ?? 0) - (a.peakTimingErrorMinutes ?? 0))
    .slice(0, topWorstDayCount)
    .map((day) => buildWorstEntry(day.date));

  const flatnessScores = billPeriodAllocationDiagnostics
    .map((period) => period.flatnessScore)
    .filter((value): value is number => value != null);
  const dailyAllocationFlatnessScore =
    flatnessScores.length > 0 ? round2(flatnessScores.reduce((sum, value) => sum + value, 0) / flatnessScores.length) : null;

  const dashboardSummary: ManualGapfillCompareDiagnosticsDashboardSummary = {
    dailyWape: summaryBuckets.all_days?.wape ?? null,
    dailyBiasKwh: summaryBuckets.all_days?.biasKwhPerDay ?? null,
    validationDayWape: summaryBuckets.validation_days_only?.wape ?? null,
    validationDayBiasKwh: summaryBuckets.validation_days_only?.biasKwhPerDay ?? null,
    hotDayWape: computeBucketSummary(
      enrichedDays.filter((day) => day.weatherBucket === "hot" || day.weatherBucket === "extreme_hot")
    ).wape,
    hotDayBiasKwh: computeBucketSummary(
      enrichedDays.filter((day) => day.weatherBucket === "hot" || day.weatherBucket === "extreme_hot")
    ).biasKwhPerDay,
    coldDayWape: computeBucketSummary(
      enrichedDays.filter((day) => day.weatherBucket === "cold" || day.weatherBucket === "extreme_cold")
    ).wape,
    coldDayBiasKwh: computeBucketSummary(
      enrichedDays.filter((day) => day.weatherBucket === "cold" || day.weatherBucket === "extreme_cold")
    ).biasKwhPerDay,
    mildDayWape: summaryBuckets.mild_days?.wape ?? null,
    mildDayBiasKwh: summaryBuckets.mild_days?.biasKwhPerDay ?? null,
    travelVacantWape: summaryBuckets.travel_vacant_days?.wape ?? null,
    travelVacantBiasKwh: summaryBuckets.travel_vacant_days?.biasKwhPerDay ?? null,
    validationIntervalCurveWape:
      validationCurveDays.length > 0
        ? round4(
            validationCurveDays.reduce((sum, day) => sum + (day.intervalWape ?? 0), 0) / validationCurveDays.length
          )
        : null,
    validationNormalizedShapeError:
      validationCurveDays.length > 0
        ? round4(
            validationCurveDays.reduce((sum, day) => sum + (day.normalizedShapeError ?? 0), 0) / validationCurveDays.length
          )
        : null,
    peakTimingErrorMinutes:
      validationCurveDays.length > 0
        ? round2(
            validationCurveDays.reduce((sum, day) => sum + (day.peakTimingErrorMinutes ?? 0), 0) /
              validationCurveDays.length
          )
        : null,
    todBucketError:
      validationCurveDays.length > 0
        ? round4(
            (Math.abs(todBucketSummary.overnight.delta) +
              Math.abs(todBucketSummary.morning.delta) +
              Math.abs(todBucketSummary.afternoon.delta) +
              Math.abs(todBucketSummary.evening.delta)) /
              validationCurveDays.length
          )
        : null,
    dailyAllocationFlatnessScore,
    weatherSensitivityActualVsSimulated: {
      coolingSensitivityDelta: weatherDiagnostics.coolingSensitivityDelta,
      heatingSensitivityDelta: weatherDiagnostics.heatingSensitivityDelta,
    },
  };

  return {
    version: "v1",
    weatherDiagnosticsAvailable,
    missingWeatherFields,
    dailyWeatherMissDiagnostics: {
      days: enrichedDays,
      summaryBuckets,
    },
    weatherDiagnostics,
    travelDiagnostics,
    billPeriodAllocationDiagnostics,
    validationIntervalCurveDiagnostics: {
      available: curveDiagnosticsAvailable,
      unavailableReason: curveUnavailableReason,
      selectedValidationDayCount: (args.validationDayKeys ?? []).length,
      includedWorstDayCount: worstAbsoluteDates.length,
      defaultScope: "validation_days_plus_top_worst",
      selectedValidationDayKeysUsed,
      actualIntervalRowsFound,
      simulatedIntervalRowsFound,
      days: curveDays,
      todBucketSummary,
    },
    worstDayDiagnostics: {
      topOverSimDays,
      topUnderSimDays,
      topAbsoluteDailyMisses,
      topIntervalShapeMisses,
      topPeakTimingMisses,
    },
    dashboardSummary,
  };
}
