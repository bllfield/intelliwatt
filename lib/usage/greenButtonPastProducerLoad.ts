import { getActualIntervalsForRangeWithSource } from "@/lib/usage/actualDatasetForHouse";
import {
  loadGreenButtonPastYearShiftedPayload,
  mergeGreenButtonHomeLocalWithYearShifted,
} from "@/lib/usage/greenButtonPastYearShiftMerge";
import { resolveGreenButtonPastSimTrustedHomeDateKeysForProducer } from "@/lib/usage/greenButtonPastTrustedPool";
import { createHomeIntervalCalendar, localSlotIndex } from "@/lib/time/homeIntervalCalendar";

export type GreenButtonPastProducerIntervalRow = {
  timestamp: string;
  kwh: number;
  homeDateKey?: string;
  homeSlot?: number;
};

export type GreenButtonPastProducerLoadResult = {
  sourceIntervals: GreenButtonPastProducerIntervalRow[];
  engineSourceIntervals: Array<{ timestamp: string; kwh: number; homeDateKey: string; homeSlot: number }>;
  trustedHomeDateKeys: Set<string>;
  /** Legacy adapter UTC trusted keys; home-local completeness is authoritative for Past Sim. */
  trustedUtcDateKeys: string[];
  displayWindowNote: string | null;
  shiftedIntervalCount: number;
  shiftedDateCount: number;
  sourceCoverageStart: string | null;
  sourceCoverageEnd: string | null;
  sourceDateByTargetDate: Record<string, string>;
};

/**
 * Green Button Past producer interval load — home-local persisted rows for the coverage
 * window (same path as Usage dashboard / getActualIntervalsForRange), merged with
 * prior-year intervals shifted forward for trailing missing days (shared adapter rules).
 */
export async function loadGreenButtonPastProducerIntervals(args: {
  houseId: string;
  esiid: string | null;
  coverageStartDate: string;
  coverageEndDate: string;
  timezone: string;
  excludeDateKeys?: string[];
  travelRanges?: Array<{ startDate: string; endDate: string }>;
}): Promise<GreenButtonPastProducerLoadResult> {
  const timezone = String(args.timezone ?? "America/Chicago").trim() || "America/Chicago";
  const [{ intervals: homeLocalIntervals }, yearShift] = await Promise.all([
    getActualIntervalsForRangeWithSource({
      houseId: args.houseId,
      esiid: args.esiid,
      startDate: args.coverageStartDate,
      endDate: args.coverageEndDate,
      preferredSource: "GREEN_BUTTON",
      homeTimezone: timezone,
    }),
    loadGreenButtonPastYearShiftedPayload({
      houseId: args.houseId,
      coverageStartDate: args.coverageStartDate,
      coverageEndDate: args.coverageEndDate,
      timezone,
      excludeDateKeys: args.excludeDateKeys,
      travelRanges: args.travelRanges,
    }),
  ]);

  const engineSourceIntervals = mergeGreenButtonHomeLocalWithYearShifted({
    homeLocalIntervals,
    shiftedHomeIntervals: yearShift.engineSourceIntervals,
    sourceDateByTargetDate: yearShift.sourceDateByTargetDate,
    timezone,
  });

  const sourceIntervals: GreenButtonPastProducerIntervalRow[] = engineSourceIntervals.map((row) => ({
    timestamp: row.timestamp,
    kwh: row.kwh,
    homeDateKey: row.homeDateKey,
    homeSlot: row.homeSlot,
  }));

  const homeCalendar = createHomeIntervalCalendar(timezone);
  const trustedHomeDateKeys =
    engineSourceIntervals.length > 0
      ? resolveGreenButtonPastSimTrustedHomeDateKeysForProducer({
          trustedUtcDateKeys: yearShift.trustedUtcDateKeys,
          sourceIntervals: engineSourceIntervals,
          timezone,
          dateKeyFromTimestamp: (ts) => {
            const match = engineSourceIntervals.find((row) => row.timestamp === ts);
            const homeKey = String(match?.homeDateKey ?? "").slice(0, 10);
            return /^\d{4}-\d{2}-\d{2}$/.test(homeKey) ? homeKey : "";
          },
          homeCalendar,
          localSlotIndex,
        })
      : new Set<string>();

  const trustedSorted = Array.from(trustedHomeDateKeys).sort((left, right) => left.localeCompare(right));
  const sourceCoverageStart = yearShift.sourceCoverageStart ?? trustedSorted[0] ?? null;
  const sourceCoverageEnd = yearShift.sourceCoverageEnd ?? trustedSorted[trustedSorted.length - 1] ?? null;

  return {
    sourceIntervals,
    engineSourceIntervals,
    trustedHomeDateKeys,
    trustedUtcDateKeys: yearShift.trustedUtcDateKeys,
    displayWindowNote: yearShift.displayWindowNote,
    shiftedIntervalCount: yearShift.shiftedIntervalCount,
    shiftedDateCount: yearShift.shiftedDateCount,
    sourceCoverageStart,
    sourceCoverageEnd,
    sourceDateByTargetDate: yearShift.sourceDateByTargetDate,
  };
}
