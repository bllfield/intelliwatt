function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function summarizeDailyWeatherMap(dailyWeather: unknown) {
  if (!dailyWeather || typeof dailyWeather !== "object" || Array.isArray(dailyWeather)) return dailyWeather;
  const dateKeys = Object.keys(dailyWeather as Record<string, unknown>)
    .filter((key) => /^\d{4}-\d{2}-\d{2}$/.test(key))
    .sort();
  return {
    redacted: true,
    count: dateKeys.length,
    startDate: dateKeys[0] ?? null,
    endDate: dateKeys[dateKeys.length - 1] ?? null,
  };
}

/** Admin JSON responses: keep summary/daily/monthly/meta but drop heavy interval/insight series. */
export function stripIntervalHeavyDatasetFields(dataset: unknown) {
  if (!dataset || typeof dataset !== "object") return dataset;
  const record = dataset as Record<string, unknown>;
  const series = asRecord(record.series);
  const insights = asRecord(record.insights);
  return {
    ...record,
    series: Object.keys(series).length
      ? {
          ...series,
          intervals15: Array.isArray(series.intervals15) ? [] : series.intervals15,
        }
      : record.series,
    insights: Object.keys(insights).length
      ? {
          ...insights,
          fifteenMinuteAverages: Array.isArray(insights.fifteenMinuteAverages) ? [] : insights.fifteenMinuteAverages,
          timeOfDayBuckets: Array.isArray(insights.timeOfDayBuckets) ? [] : insights.timeOfDayBuckets,
        }
      : record.insights,
    intervals15m: Array.isArray(record.intervals15m) ? [] : record.intervals15m,
  };
}

/** Admin JSON responses: keep monthly/annual aggregates only (no daily/interval payload). */
export function buildMonthlyOnlySourceDataset(dataset: unknown) {
  if (!dataset || typeof dataset !== "object") return dataset;
  const record = dataset as Record<string, unknown>;
  const series = asRecord(record.series);
  const insights = asRecord(record.insights);
  return {
    ...record,
    series: Object.keys(series).length
      ? {
          monthly: Array.isArray(series.monthly) ? series.monthly : [],
          annual: Array.isArray(series.annual) ? series.annual : [],
          intervals15: [],
          hourly: [],
          daily: [],
        }
      : record.series,
    insights: Object.keys(insights).length
      ? {
          ...insights,
          fifteenMinuteAverages: Array.isArray(insights.fifteenMinuteAverages) ? [] : insights.fifteenMinuteAverages,
          timeOfDayBuckets: Array.isArray(insights.timeOfDayBuckets) ? [] : insights.timeOfDayBuckets,
        }
      : record.insights,
    daily: Array.isArray(record.daily) ? [] : record.daily,
    intervals15m: Array.isArray(record.intervals15m) ? [] : record.intervals15m,
    dailyWeather: summarizeDailyWeatherMap(record.dailyWeather),
  };
}
