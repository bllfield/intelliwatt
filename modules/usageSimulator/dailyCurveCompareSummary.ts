import {
  buildDailyCurveCompareBySlot,
  dateKeyInTimezone,
  localSlot96InTimezone,
} from "@/lib/admin/gapfillLab";

type IntervalPoint = { timestamp: string; kwh: number };

type CompareWeather = {
  hdd65?: number | null;
  cdd65?: number | null;
  weatherMissing?: boolean | null;
};

type CompareRow = {
  localDate: string;
  dayType: "weekday" | "weekend";
  actualDayKwh: number;
  simulatedDayKwh: number;
  errorKwh: number;
  percentError: number | null;
  weather: CompareWeather | undefined;
};

type DailyDecisionTrace = {
  localDate: string;
  modeledReasonCode: string | null;
  fallbackLevel: string | null;
  shapeVariantUsed: string | null;
  weatherClassification: string | null;
  weatherModeUsed: string | null;
  donorSelectionModeUsed: string | null;
  donorCandidatePoolSize: number | null;
  selectedDonorLocalDates: string[];
  selectedDonorWeights: Array<{ localDate: string; weight: number; distance: number; dayKwh: number }>;
  donorWeatherRegimeUsed: string | null;
  donorMonthKeyUsed: string | null;
  thermalDistanceScore: number | null;
  broadFallbackUsed: boolean;
  sameRegimeDonorPoolAvailable: boolean;
  donorPoolBlendStrategy: string | null;
  donorPoolKwhSpread: number | null;
  donorPoolKwhVariance: number | null;
  donorPoolMedianKwh: number | null;
  donorVarianceGuardrailTriggered: boolean;
  weatherAdjustmentModeUsed: string | null;
  postDonorAdjustmentCoefficient: number | null;
};

type DailyRowSummary = {
  date: string;
  kwh: number;
  source: string | null;
  sourceDetail: string | null;
};

export type DailyCurveCompareSlot = {
  slot: number;
  hhmm: string;
  actualKwh: number;
  simulatedKwh: number;
  deltaKwh: number;
};

export type DailyCurveCompareDay = {
  localDate: string;
  month: string;
  season: "winter" | "summer" | "shoulder";
  dayType: "weekday" | "weekend";
  weatherRegime: "heating" | "cooling" | "neutral" | "weather_missing";
  actualDayKwh: number;
  simulatedDayKwh: number;
  deltaDayKwh: number;
  compareActualDayKwh: number;
  compareSimulatedDayKwh: number;
  actualCompareParityDeltaKwh: number;
  simulatedCompareParityDeltaKwh: number;
  peakActualSlot: number;
  peakSimulatedSlot: number;
  peakTimingErrorSlots: number;
  peakMagnitudeErrorKwh: number;
  curveCorrelation: number | null;
  passthroughStatus: "modeled" | "passthrough_actual" | "unknown";
  sourceDetail: string | null;
  modeledReasonCode: string | null;
  fallbackLevel: string | null;
  shapeVariantUsed: string | null;
  weatherClassification: string | null;
  weatherModeUsed: string | null;
  donorSelectionModeUsed: string | null;
  donorCandidatePoolSize: number | null;
  selectedDonorLocalDates: string[];
  selectedDonorWeights: Array<{ localDate: string; weight: number; distance: number; dayKwh: number }>;
  donorWeatherRegimeUsed: string | null;
  donorMonthKeyUsed: string | null;
  thermalDistanceScore: number | null;
  broadFallbackUsed: boolean;
  sameRegimeDonorPoolAvailable: boolean;
  donorPoolBlendStrategy: string | null;
  donorPoolKwhSpread: number | null;
  donorPoolKwhVariance: number | null;
  donorPoolMedianKwh: number | null;
  donorVarianceGuardrailTriggered: boolean;
  weatherAdjustmentModeUsed: string | null;
  postDonorAdjustmentCoefficient: number | null;
  slots: DailyCurveCompareSlot[];
};

export type DailyCurveCompareAggregate = {
  key: string;
  label: string;
  grouping: "day_type" | "month" | "season" | "weather_regime";
  dateKeys: string[];
  dayCount: number;
  slotSummary: Array<{
    slot: number;
    hhmm: string;
    actualMeanKwh: number;
    simulatedMeanKwh: number;
    deltaMeanKwh: number;
    actualCount: number;
    simCount: number;
  }>;
  meanPeakTimingErrorSlots: number | null;
  meanPeakMagnitudeErrorKwh: number | null;
  meanCurveCorrelation: number | null;
};

export type DailyCurveCompareSlotMetric = {
  slot: number;
  hhmm: string;
  maeKwh: number;
  rmseKwh: number;
  biasKwh: number;
  sampleCount: number;
};

export type DailyCurveCompareHourBlockBias = {
  label: "Overnight" | "Morning" | "Afternoon" | "Evening";
  startSlot: number;
  endSlot: number;
  meanBiasKwh: number;
  maeKwh: number;
  sampleCount: number;
};

export type DailyCurveCompareMetrics = {
  selectedDayCount: number;
  slotCount: number;
  meanPeakTimingErrorSlots: number | null;
  meanPeakMagnitudeErrorKwh: number | null;
  meanCurveCorrelation: number | null;
};

export type DailyCurveCompareSummary = {
  selectedDateKeys: string[];
  days: DailyCurveCompareDay[];
  aggregates: DailyCurveCompareAggregate[];
  slotMetrics: DailyCurveCompareSlotMetric[];
  hourBlockBiases: DailyCurveCompareHourBlockBias[];
  metrics: DailyCurveCompareMetrics;
  rawContext: Record<string, unknown>;
};

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function toHhmm(slot: number): string {
  const hour = Math.floor(slot / 4);
  const minute = (slot % 4) * 15;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function seasonForMonth(monthKey: string): "winter" | "summer" | "shoulder" {
  const month = Number(monthKey.slice(5, 7));
  if ([12, 1, 2].includes(month)) return "winter";
  if ([6, 7, 8].includes(month)) return "summer";
  return "shoulder";
}

function classifyWeatherRegime(
  weather: CompareWeather | undefined
): "heating" | "cooling" | "neutral" | "weather_missing" {
  if (!weather || weather.weatherMissing) return "weather_missing";
  const hdd = Number(weather.hdd65 ?? 0) || 0;
  const cdd = Number(weather.cdd65 ?? 0) || 0;
  if (hdd > cdd && hdd > 0.5) return "heating";
  if (cdd > hdd && cdd > 0.5) return "cooling";
  return "neutral";
}

function normalizeCompareRows(compareRows: unknown): CompareRow[] {
  const rows = asArray<Record<string, unknown>>(compareRows)
    .map((row) => {
      const localDate = String(row.localDate ?? "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) return null;
      const weather = asRecord(row.weather);
      return {
        localDate,
        dayType: row.dayType === "weekend" ? "weekend" : "weekday",
        actualDayKwh: Number(row.actualDayKwh ?? 0) || 0,
        simulatedDayKwh: Number(row.simulatedDayKwh ?? 0) || 0,
        errorKwh: Number(row.errorKwh ?? 0) || 0,
        percentError: row.percentError == null ? null : Number(row.percentError) || 0,
        weather: Object.keys(weather).length > 0 ? (weather as CompareWeather) : undefined,
      };
    })
    .filter((row): row is CompareRow => row != null);
  return rows;
}

function normalizeDecisionTraceRows(traceRows: unknown): Map<string, DailyDecisionTrace> {
  const byDate = new Map<string, DailyDecisionTrace>();
  for (const row of asArray<Record<string, unknown>>(traceRows)) {
    const localDate = String(row.localDate ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) continue;
    byDate.set(localDate, {
      localDate,
      modeledReasonCode: String(row.simulatedReasonCode ?? "").trim() || null,
      fallbackLevel: String(row.fallbackLevel ?? "").trim() || null,
      shapeVariantUsed: String(row.shapeVariantUsed ?? "").trim() || null,
      weatherClassification: String(row.dayClassification ?? "").trim() || null,
      weatherModeUsed: String(row.weatherModeUsed ?? "").trim() || null,
      donorSelectionModeUsed: String((row as any).donorSelectionModeUsed ?? "").trim() || null,
      donorCandidatePoolSize:
        typeof (row as any).donorCandidatePoolSize === "number" ? Number((row as any).donorCandidatePoolSize) : null,
      selectedDonorLocalDates: Array.isArray((row as any).selectedDonorLocalDates)
        ? (row as any).selectedDonorLocalDates
            .map((value: unknown) => String(value ?? "").slice(0, 10))
            .filter((value: string) => value.length > 0)
        : [],
      selectedDonorWeights: Array.isArray((row as any).selectedDonorWeights)
        ? (row as any).selectedDonorWeights
            .map((entry: any) => ({
              localDate: String(entry?.localDate ?? "").slice(0, 10),
              weight: typeof entry?.weight === "number" ? Number(entry.weight) : 0,
              distance: typeof entry?.distance === "number" ? Number(entry.distance) : 0,
              dayKwh: typeof entry?.dayKwh === "number" ? Number(entry.dayKwh) : 0,
            }))
            .filter((entry: { localDate: string }) => entry.localDate.length > 0)
        : [],
      donorWeatherRegimeUsed: String((row as any).donorWeatherRegimeUsed ?? "").trim() || null,
      donorMonthKeyUsed: String((row as any).donorMonthKeyUsed ?? "").trim() || null,
      thermalDistanceScore:
        typeof (row as any).thermalDistanceScore === "number" ? Number((row as any).thermalDistanceScore) : null,
      broadFallbackUsed: (row as any).broadFallbackUsed === true,
      sameRegimeDonorPoolAvailable: (row as any).sameRegimeDonorPoolAvailable === true,
      donorPoolBlendStrategy: String((row as any).donorPoolBlendStrategy ?? "").trim() || null,
      donorPoolKwhSpread:
        typeof (row as any).donorPoolKwhSpread === "number" ? Number((row as any).donorPoolKwhSpread) : null,
      donorPoolKwhVariance:
        typeof (row as any).donorPoolKwhVariance === "number" ? Number((row as any).donorPoolKwhVariance) : null,
      donorPoolMedianKwh:
        typeof (row as any).donorPoolMedianKwh === "number" ? Number((row as any).donorPoolMedianKwh) : null,
      donorVarianceGuardrailTriggered: (row as any).donorVarianceGuardrailTriggered === true,
      weatherAdjustmentModeUsed: String((row as any).weatherAdjustmentModeUsed ?? "").trim() || null,
      postDonorAdjustmentCoefficient:
        typeof (row as any).postDonorAdjustmentCoefficient === "number"
          ? Number((row as any).postDonorAdjustmentCoefficient)
          : null,
    });
  }
  return byDate;
}

function normalizeDailyRows(rows: unknown): Map<string, DailyRowSummary> {
  const byDate = new Map<string, DailyRowSummary>();
  for (const row of asArray<Record<string, unknown>>(rows)) {
    const date = String(row.date ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    byDate.set(date, {
      date,
      kwh: Number(row.kwh ?? 0) || 0,
      source: String(row.source ?? "").trim() || null,
      sourceDetail: String(row.sourceDetail ?? "").trim() || null,
    });
  }
  return byDate;
}

function intervalsByDateAndSlot(
  rows: unknown,
  timezone: string,
  selectedDateKeys: Set<string>
): Map<string, number[]> {
  const byDate = new Map<string, number[]>();
  for (const row of asArray<IntervalPoint>(rows)) {
    const ts = String(row?.timestamp ?? "").trim();
    const kwh = Number(row?.kwh ?? Number.NaN);
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

function meanFinite(values: Array<number | null | undefined>): number | null {
  const finite = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (finite.length === 0) return null;
  return round4(finite.reduce((sum, value) => sum + value, 0) / finite.length);
}

function buildAggregate(
  key: string,
  label: string,
  grouping: DailyCurveCompareAggregate["grouping"],
  dateKeys: string[],
  actualIntervals: IntervalPoint[],
  simulatedIntervals: IntervalPoint[],
  timezone: string,
  daysByDate: Map<string, DailyCurveCompareDay>
): DailyCurveCompareAggregate {
  const slotSummary = buildDailyCurveCompareBySlot({
    actual: actualIntervals,
    simulated: simulatedIntervals,
    timezone,
    selectedDateKeys: dateKeys,
  }).map((row) => ({
    slot: row.slot,
    hhmm: toHhmm(row.slot),
    actualMeanKwh: row.actualMeanKwh,
    simulatedMeanKwh: row.simMeanKwh,
    deltaMeanKwh: row.deltaMeanKwh,
    actualCount: row.actualCount,
    simCount: row.simCount,
  }));
  const days = dateKeys.map((dateKey) => daysByDate.get(dateKey)).filter(Boolean) as DailyCurveCompareDay[];
  return {
    key,
    label,
    grouping,
    dateKeys,
    dayCount: days.length,
    slotSummary,
    meanPeakTimingErrorSlots: meanFinite(days.map((day) => day.peakTimingErrorSlots)),
    meanPeakMagnitudeErrorKwh: meanFinite(days.map((day) => day.peakMagnitudeErrorKwh)),
    meanCurveCorrelation: meanFinite(days.map((day) => day.curveCorrelation)),
  };
}

export function buildDailyCurveCompareSummary(args: {
  actualDataset?: { series?: { intervals15?: unknown } | null } | null | undefined;
  simulatedDataset?: { series?: { intervals15?: unknown } | null } | null | undefined;
  actualIntervals?: unknown;
  simulatedIntervals?: unknown;
  compareRows: unknown;
  timezone: string | null | undefined;
  perDayTrace?: unknown;
  rawDailyRows?: unknown;
}): DailyCurveCompareSummary | null {
  const timezone = String(args.timezone ?? "").trim();
  if (!timezone) return null;
  const compareRows = normalizeCompareRows(args.compareRows);
  if (compareRows.length === 0) return null;
  const actualIntervals = asArray<IntervalPoint>(args.actualIntervals ?? args.actualDataset?.series?.intervals15);
  const simulatedIntervals = asArray<IntervalPoint>(args.simulatedIntervals ?? args.simulatedDataset?.series?.intervals15);
  if (actualIntervals.length === 0 || simulatedIntervals.length === 0) return null;
  const decisionTraceByDate = normalizeDecisionTraceRows(args.perDayTrace);
  const rawDailyRowsByDate = normalizeDailyRows(args.rawDailyRows);

  const selectedDateKeys = Array.from(new Set(compareRows.map((row) => row.localDate))).sort();
  const selectedDateKeySet = new Set(selectedDateKeys);
  const actualByDate = intervalsByDateAndSlot(actualIntervals, timezone, selectedDateKeySet);
  const simulatedByDate = intervalsByDateAndSlot(simulatedIntervals, timezone, selectedDateKeySet);

  const days: DailyCurveCompareDay[] = compareRows
    .map((row) => {
      const actualSlots = actualByDate.get(row.localDate);
      const simulatedSlots = simulatedByDate.get(row.localDate);
      if (!actualSlots || !simulatedSlots) return null;
      const slots = Array.from({ length: 96 }, (_, slot) => ({
        slot,
        hhmm: toHhmm(slot),
        actualKwh: round4(actualSlots[slot] ?? 0),
        simulatedKwh: round4(simulatedSlots[slot] ?? 0),
        deltaKwh: round4((simulatedSlots[slot] ?? 0) - (actualSlots[slot] ?? 0)),
      }));
      const actualDayKwh = round4(actualSlots.reduce((sum, value) => sum + value, 0));
      const simulatedDayKwh = round4(simulatedSlots.reduce((sum, value) => sum + value, 0));
      const peakActualSlot = peakSlot(actualSlots);
      const peakSimulatedSlot = peakSlot(simulatedSlots);
      const rawDailyRow = rawDailyRowsByDate.get(row.localDate);
      const decisionTrace = decisionTraceByDate.get(row.localDate);
      const sourceDetail = rawDailyRow?.sourceDetail ?? null;
      const passthroughStatus =
        sourceDetail == null
          ? "unknown"
          : /^SIMULATED/.test(sourceDetail)
            ? "modeled"
            : sourceDetail === "ACTUAL" || sourceDetail === "ACTUAL_VALIDATION_TEST_DAY"
              ? "passthrough_actual"
              : "unknown";
      return {
        localDate: row.localDate,
        month: row.localDate.slice(0, 7),
        season: seasonForMonth(row.localDate.slice(0, 7)),
        dayType: row.dayType,
        weatherRegime: classifyWeatherRegime(row.weather),
        actualDayKwh,
        simulatedDayKwh,
        deltaDayKwh: round4(simulatedDayKwh - actualDayKwh),
        compareActualDayKwh: round4(row.actualDayKwh),
        compareSimulatedDayKwh: round4(row.simulatedDayKwh),
        actualCompareParityDeltaKwh: round4(actualDayKwh - row.actualDayKwh),
        simulatedCompareParityDeltaKwh: round4(simulatedDayKwh - row.simulatedDayKwh),
        peakActualSlot,
        peakSimulatedSlot,
        peakTimingErrorSlots: Math.abs(peakSimulatedSlot - peakActualSlot),
        peakMagnitudeErrorKwh: round4((simulatedSlots[peakSimulatedSlot] ?? 0) - (actualSlots[peakActualSlot] ?? 0)),
        curveCorrelation: correlation(actualSlots, simulatedSlots),
        passthroughStatus,
        sourceDetail,
        modeledReasonCode: decisionTrace?.modeledReasonCode ?? null,
        fallbackLevel: decisionTrace?.fallbackLevel ?? null,
        shapeVariantUsed: decisionTrace?.shapeVariantUsed ?? null,
        weatherClassification: decisionTrace?.weatherClassification ?? null,
        weatherModeUsed: decisionTrace?.weatherModeUsed ?? null,
        donorSelectionModeUsed: decisionTrace?.donorSelectionModeUsed ?? null,
        donorCandidatePoolSize: decisionTrace?.donorCandidatePoolSize ?? null,
        selectedDonorLocalDates: decisionTrace?.selectedDonorLocalDates ?? [],
        selectedDonorWeights: decisionTrace?.selectedDonorWeights ?? [],
        donorWeatherRegimeUsed: decisionTrace?.donorWeatherRegimeUsed ?? null,
        donorMonthKeyUsed: decisionTrace?.donorMonthKeyUsed ?? null,
        thermalDistanceScore: decisionTrace?.thermalDistanceScore ?? null,
        broadFallbackUsed: decisionTrace?.broadFallbackUsed ?? false,
        sameRegimeDonorPoolAvailable: decisionTrace?.sameRegimeDonorPoolAvailable ?? false,
        donorPoolBlendStrategy: decisionTrace?.donorPoolBlendStrategy ?? null,
        donorPoolKwhSpread: decisionTrace?.donorPoolKwhSpread ?? null,
        donorPoolKwhVariance: decisionTrace?.donorPoolKwhVariance ?? null,
        donorPoolMedianKwh: decisionTrace?.donorPoolMedianKwh ?? null,
        donorVarianceGuardrailTriggered: decisionTrace?.donorVarianceGuardrailTriggered ?? false,
        weatherAdjustmentModeUsed: decisionTrace?.weatherAdjustmentModeUsed ?? null,
        postDonorAdjustmentCoefficient: decisionTrace?.postDonorAdjustmentCoefficient ?? null,
        slots,
      };
    })
    .filter((row): row is DailyCurveCompareDay => Boolean(row))
    .sort((a, b) => a.localDate.localeCompare(b.localDate));

  if (days.length === 0) return null;

  const daysByDate = new Map(days.map((day) => [day.localDate, day]));
  const aggregateInputs = new Map<string, { label: string; grouping: DailyCurveCompareAggregate["grouping"]; dates: string[] }>();
  for (const day of days) {
    const candidates: Array<[string, string, DailyCurveCompareAggregate["grouping"]]> = [
      [`day_type:${day.dayType}`, day.dayType === "weekend" ? "Weekend" : "Weekday", "day_type"],
      [`month:${day.month}`, day.month, "month"],
      [`season:${day.season}`, day.season[0]!.toUpperCase() + day.season.slice(1), "season"],
    ];
    if (day.weatherRegime !== "weather_missing") {
      const weatherLabel =
        day.weatherRegime === "heating"
          ? "Heating"
          : day.weatherRegime === "cooling"
            ? "Cooling"
            : "Neutral";
      candidates.push([`weather:${day.weatherRegime}`, weatherLabel, "weather_regime"]);
    }
    candidates.forEach(([key, label, grouping]) => {
      const bucket = aggregateInputs.get(key) ?? { label, grouping, dates: [] };
      bucket.dates.push(day.localDate);
      aggregateInputs.set(key, bucket);
    });
  }

  const aggregates = Array.from(aggregateInputs.entries())
    .map(([key, value]) =>
      buildAggregate(
        key,
        value.label,
        value.grouping,
        Array.from(new Set(value.dates)).sort(),
        actualIntervals,
        simulatedIntervals,
        timezone,
        daysByDate
      )
    )
    .sort((a, b) => a.grouping.localeCompare(b.grouping) || a.label.localeCompare(b.label));

  const slotErrors = Array.from({ length: 96 }, () => [] as number[]);
  days.forEach((day) => {
    day.slots.forEach((slot) => {
      slotErrors[slot.slot]!.push(slot.deltaKwh);
    });
  });
  const slotMetrics = slotErrors.map((errors, slot) => {
    const maeKwh = errors.length
      ? errors.reduce((sum, value) => sum + Math.abs(value), 0) / errors.length
      : 0;
    const rmseKwh = errors.length
      ? Math.sqrt(errors.reduce((sum, value) => sum + value * value, 0) / errors.length)
      : 0;
    const biasKwh = errors.length
      ? errors.reduce((sum, value) => sum + value, 0) / errors.length
      : 0;
    return {
      slot,
      hhmm: toHhmm(slot),
      maeKwh: round4(maeKwh),
      rmseKwh: round4(rmseKwh),
      biasKwh: round4(biasKwh),
      sampleCount: errors.length,
    };
  });

  const blocks: Array<{ label: DailyCurveCompareHourBlockBias["label"]; startSlot: number; endSlot: number }> = [
    { label: "Overnight", startSlot: 0, endSlot: 23 },
    { label: "Morning", startSlot: 24, endSlot: 47 },
    { label: "Afternoon", startSlot: 48, endSlot: 71 },
    { label: "Evening", startSlot: 72, endSlot: 95 },
  ];
  const hourBlockBiases = blocks.map((block) => {
    const relevant = slotMetrics.filter((slot) => slot.slot >= block.startSlot && slot.slot <= block.endSlot);
    return {
      ...block,
      meanBiasKwh: meanFinite(relevant.map((slot) => slot.biasKwh)) ?? 0,
      maeKwh: meanFinite(relevant.map((slot) => slot.maeKwh)) ?? 0,
      sampleCount: relevant.reduce((sum, slot) => sum + slot.sampleCount, 0),
    };
  });

  return {
    selectedDateKeys,
    days,
    aggregates,
    slotMetrics,
    hourBlockBiases,
    metrics: {
      selectedDayCount: days.length,
      slotCount: slotMetrics.filter((slot) => slot.sampleCount > 0).length,
      meanPeakTimingErrorSlots: meanFinite(days.map((day) => day.peakTimingErrorSlots)),
      meanPeakMagnitudeErrorKwh: meanFinite(days.map((day) => day.peakMagnitudeErrorKwh)),
      meanCurveCorrelation: meanFinite(days.map((day) => day.curveCorrelation)),
    },
    rawContext: {
      timezone,
      compareRowCount: compareRows.length,
      selectedDateKeys,
      aggregateKeys: aggregates.map((aggregate) => aggregate.key),
      selectedValidationRows: compareRows,
      actualIntervalCount: actualIntervals.length,
      simulatedIntervalCount: simulatedIntervals.length,
      decisionTraceCount: decisionTraceByDate.size,
      rawDailyRowCount: rawDailyRowsByDate.size,
      intervalSources: {
        actual: "actual_house_persisted_intervals15",
        simulated: "test_house_raw_artifact_intervals15",
      },
    },
  };
}
