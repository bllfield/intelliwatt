/**
 * Single owner for Past / simulated-fill 15-minute load curves on user Usage and One Path read-only views.
 */

import {
  buildGreenButtonLoadCurveInsightsFromSeriesRows,
  isGreenButtonBackedDatasetMeta,
  shouldRebuildGreenButtonFifteenMinuteCurveFromSeries,
} from "@/lib/time/greenButtonPersistedIntervalConvert";
import {
  buildLoadCurveInsightsFromIntervalRows,
  filterIntervalRowsToActualDailyDates,
} from "@/lib/usage/fifteenMinuteLoadCurve";

export type PastSimDisplayFifteenMinuteCurveInput = {
  insightsFifteenMinuteAverages?: Array<{ hhmm?: string; avgKw?: number }> | null;
  intervals15?: Array<{ timestamp?: string; kwh?: number; consumption_kwh?: number }> | null;
  hasSimulatedFill: boolean;
  displayDaily: Array<{ date?: string; source?: string; sourceDetail?: string }>;
  timezone: string;
  coverageStart: string | null;
  coverageEnd: string | null;
  meta?: Record<string, unknown> | null;
};

export type PastSimDisplayFifteenMinuteCurveResult = {
  fifteenMinuteAverages: Array<{ hhmm: string; avgKw: number }>;
  sourceOwner: string;
};

function asDateKey(value: unknown): string | null {
  const text = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function sortFifteenCurve(curve: Array<{ hhmm: string; avgKw: number }>): Array<{ hhmm: string; avgKw: number }> {
  return curve.slice().sort((left, right) => {
    const toMinutes = (hhmm: string) => {
      const [hour, minute] = hhmm.split(":").map(Number);
      return hour * 60 + minute;
    };
    return toMinutes(left.hhmm) - toMinutes(right.hhmm);
  });
}

function hhmmInTimezone(timestamp: string, timezone: string): string | null {
  try {
    const ts = new Date(timestamp);
    if (!Number.isFinite(ts.getTime())) return null;
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      hourCycle: "h23",
    });
    const parts = formatter.formatToParts(ts);
    const hour = parts.find((part) => part.type === "hour")?.value ?? "";
    const minute = parts.find((part) => part.type === "minute")?.value ?? "";
    const hhmm = `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
    return /^\d{2}:\d{2}$/.test(hhmm) ? hhmm : null;
  } catch {
    return null;
  }
}

function deriveFifteenMinuteAveragesFromIntervals(
  rows: Array<{ timestamp?: unknown; kwh?: unknown; consumption_kwh?: unknown }>,
  options?: { start?: string | null; end?: string | null; timezone?: string }
): Array<{ hhmm: string; avgKw: number }> {
  const timezone = options?.timezone?.trim() ? options.timezone.trim() : "America/Chicago";
  const buckets = new Map<string, { sumKw: number; count: number }>();
  for (const row of rows) {
    const timestamp = String(row?.timestamp ?? "");
    if (!timestamp) continue;
    const dateKey = asDateKey(timestamp);
    if (!dateKey) continue;
    if (options?.start && dateKey < options.start) continue;
    if (options?.end && dateKey > options.end) continue;
    const hhmm = hhmmInTimezone(timestamp, timezone);
    if (!hhmm) continue;
    const kwh = Number(row?.kwh ?? row?.consumption_kwh ?? 0) || 0;
    const current = buckets.get(hhmm) ?? { sumKw: 0, count: 0 };
    current.sumKw += kwh * 4;
    current.count += 1;
    buckets.set(hhmm, current);
  }
  return Array.from(buckets.entries())
    .map(([hhmm, bucket]) => ({
      hhmm,
      avgKw: bucket.count > 0 ? Number((bucket.sumKw / bucket.count).toFixed(2)) : 0,
    }))
    .sort((left, right) => (left.hhmm < right.hhmm ? -1 : left.hhmm > right.hhmm ? 1 : 0));
}

function buildActualDayLoadCurve(input: PastSimDisplayFifteenMinuteCurveInput): Array<{ hhmm: string; avgKw: number }> {
  const intervals15 = Array.isArray(input.intervals15) ? input.intervals15 : [];
  if (!intervals15.length) return [];

  if (isGreenButtonBackedDatasetMeta(input.meta)) {
    return buildGreenButtonLoadCurveInsightsFromSeriesRows(intervals15, {
      homeTimezone: input.timezone,
      meta: input.meta,
      displayDaily: input.displayDaily,
      filterToActualDailyDates: true,
    }).fifteenMinuteAverages;
  }

  return buildLoadCurveInsightsFromIntervalRows(
    filterIntervalRowsToActualDailyDates(intervals15, input.displayDaily, input.timezone),
    input.timezone
  ).fifteenMinuteAverages;
}

const GREEN_BUTTON_CURVE_OWNER =
  "greenButtonPersistedIntervalConvert.buildGreenButtonLoadCurveInsightsFromSeriesRows";

const GREEN_BUTTON_INSIGHTS_OWNER =
  "resolvePastSimDisplayFifteenMinuteCurve(...).insights.fifteenMinuteAverages (shared GB/SQL or reconcile)";

/** Detect cached insight curves that no longer match a fresh series rebuild (e.g. partial admin cache). */
function greenButtonInsightsStaleVsSeries(
  insights: Array<{ hhmm: string; avgKw: number }>,
  series: Array<{ hhmm: string; avgKw: number }>
): boolean {
  if (insights.length === 0 || series.length === 0) return false;
  const seriesByHhmm = new Map(series.map((row) => [row.hhmm, row.avgKw]));
  for (const row of insights) {
    const rebuilt = seriesByHhmm.get(row.hhmm);
    if (rebuilt == null) continue;
    const diff = row.avgKw - rebuilt;
    // Cached insights inflated vs a fresh series rebuild (admin partial cache), not series overshoot.
    if (diff > 5 && row.avgKw > rebuilt) return true;
    if (rebuilt > 0 && row.avgKw > rebuilt * 3) return true;
  }
  return false;
}

function buildGreenButtonSeriesFifteenCurve(
  input: PastSimDisplayFifteenMinuteCurveInput,
  intervals15: Array<{ timestamp?: string; kwh?: number; consumption_kwh?: number }>
): Array<{ hhmm: string; avgKw: number }> {
  if (!intervals15.length) return [];
  return sortFifteenCurve(
    buildGreenButtonLoadCurveInsightsFromSeriesRows(intervals15, {
      homeTimezone: String(input.timezone ?? "").trim() || "America/Chicago",
      meta: input.meta,
      displayDaily: input.displayDaily,
      filterToActualDailyDates: input.hasSimulatedFill,
    }).fifteenMinuteAverages
  );
}

export function resolvePastSimDisplayFifteenMinuteCurve(
  input: PastSimDisplayFifteenMinuteCurveInput
): PastSimDisplayFifteenMinuteCurveResult {
  const timezone = String(input.timezone ?? "").trim() || "America/Chicago";
  const intervals15 = Array.isArray(input.intervals15) ? input.intervals15 : [];
  const greenButtonBacked = isGreenButtonBackedDatasetMeta(input.meta);

  const insightFifteenCurve = sortFifteenCurve(
    (input.insightsFifteenMinuteAverages ?? [])
      .map((row) => ({
        hhmm: String(row?.hhmm ?? ""),
        avgKw: Number(row?.avgKw ?? 0) || 0,
      }))
      .filter((row) => /^\d{2}:\d{2}$/.test(row.hhmm))
  );

  if (greenButtonBacked && intervals15.length > 0) {
    const greenButtonSeriesCurve = buildGreenButtonSeriesFifteenCurve(input, intervals15);

    if (insightFifteenCurve.length === 0 && greenButtonSeriesCurve.length > 0) {
      return {
        fifteenMinuteAverages: greenButtonSeriesCurve,
        sourceOwner: GREEN_BUTTON_CURVE_OWNER,
      };
    }

    if (insightFifteenCurve.length > 0) {
      if (
        input.hasSimulatedFill &&
        !greenButtonInsightsStaleVsSeries(insightFifteenCurve, greenButtonSeriesCurve)
      ) {
        return {
          fifteenMinuteAverages: insightFifteenCurve,
          sourceOwner: GREEN_BUTTON_INSIGHTS_OWNER,
        };
      }
      if (greenButtonSeriesCurve.length > 0) {
        return {
          fifteenMinuteAverages: greenButtonSeriesCurve,
          sourceOwner: GREEN_BUTTON_CURVE_OWNER,
        };
      }
      return {
        fifteenMinuteAverages: insightFifteenCurve,
        sourceOwner: GREEN_BUTTON_INSIGHTS_OWNER,
      };
    }
  }

  if (
    greenButtonBacked &&
    shouldRebuildGreenButtonFifteenMinuteCurveFromSeries({
      meta: input.meta,
      intervals15Count: intervals15.length,
      hasSimulatedFill: input.hasSimulatedFill,
    })
  ) {
    const greenButtonCurve = buildGreenButtonSeriesFifteenCurve(input, intervals15);
    if (greenButtonCurve.length > 0) {
      return {
        fifteenMinuteAverages: greenButtonCurve,
        sourceOwner: GREEN_BUTTON_CURVE_OWNER,
      };
    }
  }

  const actualDayLoadCurve =
    input.hasSimulatedFill && intervals15.length > 0 && !greenButtonBacked
      ? sortFifteenCurve(buildActualDayLoadCurve(input))
      : [];

  const rebuiltFifteenCurve =
    insightFifteenCurve.length > 0 || actualDayLoadCurve.length > 0
      ? []
      : sortFifteenCurve(
          deriveFifteenMinuteAveragesFromIntervals(intervals15, {
            start: input.coverageStart,
            end: input.coverageEnd,
            timezone,
          })
        );

  if (actualDayLoadCurve.length > 0) {
    return {
      fifteenMinuteAverages: actualDayLoadCurve,
      sourceOwner: "resolvePastSimDisplayFifteenMinuteCurve(...).actualDayIntervals15",
    };
  }
  if (insightFifteenCurve.length > 0) {
    return {
      fifteenMinuteAverages: insightFifteenCurve,
      sourceOwner: greenButtonBacked
        ? "resolvePastSimDisplayFifteenMinuteCurve(...).insights.fifteenMinuteAverages (SQL/DB)"
        : "resolvePastSimDisplayFifteenMinuteCurve(...).insights.fifteenMinuteAverages",
    };
  }
  return {
    fifteenMinuteAverages: rebuiltFifteenCurve,
    sourceOwner: rebuiltFifteenCurve.length
      ? "resolvePastSimDisplayFifteenMinuteCurve(...).intervals15Fallback"
      : "resolvePastSimDisplayFifteenMinuteCurve(...).empty",
  };
}
