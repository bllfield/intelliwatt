import { getActualIntervalsForRangeWithSource } from "@/lib/usage/actualDatasetForHouse";
import {
  materializeGreenButtonPastProducerIntervals,
  resolveGreenButtonPastSimTrustedHomeDateKeysForProducer,
} from "@/lib/usage/greenButtonPastTrustedPool";
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
 * window (same path as Usage dashboard / getActualIntervalsForRange). Do not use
 * fetchGreenButtonIntervalsForCoverageWindow utcDayGrid here; that rebases into a sparse
 * UTC tail and breaks trusted-day parity with Usage.
 */
export async function loadGreenButtonPastProducerIntervals(args: {
  houseId: string;
  esiid: string | null;
  coverageStartDate: string;
  coverageEndDate: string;
  timezone: string;
}): Promise<GreenButtonPastProducerLoadResult> {
  const timezone = String(args.timezone ?? "America/Chicago").trim() || "America/Chicago";
  const { intervals } = await getActualIntervalsForRangeWithSource({
    houseId: args.houseId,
    esiid: args.esiid,
    startDate: args.coverageStartDate,
    endDate: args.coverageEndDate,
    preferredSource: "GREEN_BUTTON",
    homeTimezone: timezone,
  });

  const sourceIntervals: GreenButtonPastProducerIntervalRow[] = intervals.map((row) => ({
    timestamp: String(row.timestamp ?? ""),
    kwh: Number(row.kwh) || 0,
    homeDateKey: String(row.homeDateKey ?? "").slice(0, 10) || undefined,
    homeSlot: typeof row.homeSlot === "number" && Number.isFinite(row.homeSlot) ? Math.trunc(row.homeSlot) : undefined,
  }));

  const homeCalendar = createHomeIntervalCalendar(timezone);
  const engineSourceIntervals =
    sourceIntervals.length > 0 &&
    sourceIntervals.some((row) => /^\d{4}-\d{2}-\d{2}$/.test(String(row.homeDateKey ?? "").slice(0, 10)))
      ? sourceIntervals.map((row) => ({
          timestamp: row.timestamp,
          kwh: row.kwh,
          homeDateKey: String(row.homeDateKey ?? "").slice(0, 10),
          homeSlot:
            typeof row.homeSlot === "number" && Number.isFinite(row.homeSlot)
              ? row.homeSlot
              : localSlotIndex(row.timestamp, homeCalendar),
        }))
      : materializeGreenButtonPastProducerIntervals({ sourceIntervals, timezone });

  const trustedHomeDateKeys =
    engineSourceIntervals.length > 0
      ? resolveGreenButtonPastSimTrustedHomeDateKeysForProducer({
          trustedUtcDateKeys: [],
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
  const sourceCoverageStart = trustedSorted[0] ?? null;
  const sourceCoverageEnd = trustedSorted[trustedSorted.length - 1] ?? null;

  return {
    sourceIntervals,
    engineSourceIntervals,
    trustedHomeDateKeys,
    trustedUtcDateKeys: [],
    displayWindowNote: null,
    shiftedIntervalCount: 0,
    shiftedDateCount: 0,
    sourceCoverageStart,
    sourceCoverageEnd,
    sourceDateByTargetDate: {},
  };
}
