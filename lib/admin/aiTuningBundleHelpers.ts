type TravelRangeLike = { startDate?: unknown; endDate?: unknown };

function asDateKey(value: unknown): string | null {
  const text = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function normalizeTravelRangesForExport(
  ranges: ReadonlyArray<TravelRangeLike> | null | undefined
): Array<{ startDate: string; endDate: string }> {
  const out: Array<{ startDate: string; endDate: string }> = [];
  const seen = new Set<string>();
  for (const range of ranges ?? []) {
    const startDate = asDateKey(range?.startDate);
    const endDate = asDateKey(range?.endDate);
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

function classifyTravelRangeForExportWindow(
  range: { startDate: string; endDate: string },
  window: { startDate: string; endDate: string } | null | undefined
) {
  const windowStart = asDateKey(window?.startDate);
  const windowEnd = asDateKey(window?.endDate);
  const startDate = asDateKey(range.startDate) ?? range.startDate;
  const endDate = asDateKey(range.endDate) ?? range.endDate;

  if (!windowStart || !windowEnd || windowStart > windowEnd) {
    return {
      storedRange: range,
      archivedHistorical: false,
      activeForCurrentWindow: true,
      futureOutsideCurrentWindow: false,
      beforeWindowHistorical: false,
      filteredOutOfCurrentWindow: false,
      clippedOperationalOverlap: range,
    };
  }

  const archivedHistorical = endDate < windowStart;
  const futureOutsideCurrentWindow = startDate > windowEnd;
  const activeForCurrentWindow = endDate >= windowStart && startDate <= windowEnd;

  return {
    storedRange: range,
    archivedHistorical,
    activeForCurrentWindow,
    futureOutsideCurrentWindow,
    beforeWindowHistorical: archivedHistorical,
    filteredOutOfCurrentWindow: !activeForCurrentWindow,
    clippedOperationalOverlap: activeForCurrentWindow
      ? {
          startDate: startDate < windowStart ? windowStart : startDate,
          endDate: endDate > windowEnd ? windowEnd : endDate,
        }
      : null,
  };
}

function summarizeTravelRangesForExportWindow(
  ranges: ReadonlyArray<TravelRangeLike> | null | undefined,
  window: { startDate: string; endDate: string } | null | undefined
) {
  const normalized = normalizeTravelRangesForExport(ranges);
  const classifications = normalized.map((range) => classifyTravelRangeForExportWindow(range, window));
  const clippedOperationalRanges = classifications
    .map((row) => row.clippedOperationalOverlap)
    .filter((range): range is { startDate: string; endDate: string } => range != null);
  return {
    storedCount: normalized.length,
    archivedHistoricalCount: classifications.filter((row) => row.archivedHistorical).length,
    activeCurrentWindowCount: classifications.filter((row) => row.activeForCurrentWindow).length,
    futureOutsideCurrentWindowCount: classifications.filter((row) => row.futureOutsideCurrentWindow).length,
    filteredOutOfCurrentWindowCount: classifications.filter((row) => row.filteredOutOfCurrentWindow).length,
    clippedOperationalRanges,
    classifications,
  };
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function pickKeys(source: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  return out;
}

export function extractValidationDayKeysFromPolicySnapshot(policy: unknown): string[] {
  const record = asRecord(policy);
  const keys = asArray(record.selectedDateKeys).map((value) => String(value).slice(0, 10));
  return [...new Set(keys.filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)))].sort();
}

export function extractValidationDayKeysFromCompareProjection(compareProjection: unknown): string[] {
  const rows = asArray(asRecord(compareProjection).rows);
  const keys = rows
    .map((row) => asRecord(row))
    .filter((row) => row.validationDay === true || row.isValidationDay === true)
    .map((row) => String(row.localDate ?? row.date ?? "").slice(0, 10))
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date));
  return [...new Set(keys)].sort();
}

export function sumKwhFromDailyRows(rows: unknown): number | null {
  const daily = asArray(rows);
  if (!daily.length) return null;
  let total = 0;
  let count = 0;
  for (const row of daily) {
    const kwh = asNumber(asRecord(row).kwh ?? asRecord(row).actualKwh);
    if (kwh == null) continue;
    total += kwh;
    count += 1;
  }
  return count > 0 ? Math.round(total * 100) / 100 : null;
}

function dateKeyFromIntervalTimestamp(timestamp: unknown): string | null {
  const text = String(timestamp ?? "");
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] ?? null;
}

export function extractValidationDayIntervalSeries(args: {
  actualDataset?: unknown;
  simulatedDataset?: unknown;
  validationDayKeys: string[];
}): {
  validationDayKeys: string[];
  sourceActualByDate: Record<string, Array<{ timestamp: string; kwh: number }>>;
  labSimulatedByDate: Record<string, Array<{ timestamp: string; kwh: number }>>;
  slotCountsByDate: Record<string, { actual: number; simulated: number }>;
} {
  const keySet = new Set(args.validationDayKeys.map((date) => date.slice(0, 10)));
  const sourceActualByDate: Record<string, Array<{ timestamp: string; kwh: number }>> = {};
  const labSimulatedByDate: Record<string, Array<{ timestamp: string; kwh: number }>> = {};
  const slotCountsByDate: Record<string, { actual: number; simulated: number }> = {};

  const ingest = (
    dataset: unknown,
    target: Record<string, Array<{ timestamp: string; kwh: number }>>
  ) => {
    const intervals = asArray(asRecord(asRecord(dataset).series).intervals15);
    for (const row of intervals) {
      const record = asRecord(row);
      const date = dateKeyFromIntervalTimestamp(record.timestamp);
      if (!date || !keySet.has(date)) continue;
      const kwh = asNumber(record.kwh ?? record.consumptionKwh) ?? 0;
      const timestamp = String(record.timestamp ?? "");
      if (!timestamp) continue;
      if (!target[date]) target[date] = [];
      target[date].push({ timestamp, kwh });
    }
    for (const date of Object.keys(target)) {
      target[date]!.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    }
  };

  ingest(args.actualDataset, sourceActualByDate);
  ingest(args.simulatedDataset, labSimulatedByDate);

  for (const date of args.validationDayKeys) {
    slotCountsByDate[date] = {
      actual: sourceActualByDate[date]?.length ?? 0,
      simulated: labSimulatedByDate[date]?.length ?? 0,
    };
  }

  return {
    validationDayKeys: args.validationDayKeys,
    sourceActualByDate,
    labSimulatedByDate,
    slotCountsByDate,
  };
}

export function buildTravelRangeExportClassification(args: {
  storedTravelRanges: unknown;
  coverageWindow: { startDate: string; endDate: string } | null;
}): Record<string, unknown> {
  const summary = summarizeTravelRangesForExportWindow(args.storedTravelRanges, args.coverageWindow);
  return {
    storedTravelRanges: asArray(args.storedTravelRanges),
    coverageWindow: args.coverageWindow,
    activeCurrentWindowTravelRanges: summary.clippedOperationalRanges,
    archivedHistoricalTravelRanges: summary.classifications
      .filter((row) => row.archivedHistorical)
      .map((row) => row.storedRange),
    futureOutsideWindowTravelRanges: summary.classifications
      .filter((row) => row.futureOutsideCurrentWindow)
      .map((row) => row.storedRange),
    effectiveTravelRangesForRecalc: summary.clippedOperationalRanges,
    counts: {
      storedCount: summary.storedCount,
      activeCurrentWindowCount: summary.activeCurrentWindowCount,
      archivedHistoricalCount: summary.archivedHistoricalCount,
      futureOutsideCurrentWindowCount: summary.futureOutsideCurrentWindowCount,
    },
    classifications: summary.classifications,
    travelActualMarkedNonRepresentative: true,
    manualSimExpectedToEstimateNormalCounterfactualUsage: true,
    travelShouldReduceManualSim: false,
  };
}

export type ExportDeploymentMetadata = {
  gitCommitSha: string | null;
  gitCommitRef: string | null;
  deployedAt: string | null;
  workingTreeDirty: boolean | null;
  metadataSource: "vercel_env" | "local_git" | "unknown";
};
