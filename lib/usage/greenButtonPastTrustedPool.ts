import {
  dateKeyFromIntervalPoint,
  dayMeetsTrustedIntervalThreshold,
  type HomeProjectedIntervalPoint,
} from "@/lib/time/actualIntervalCalendar";
import { createHomeIntervalCalendar } from "@/lib/time/homeIntervalCalendar";
import { mapGreenButtonUtcTrustedDateKeysToHome } from "@/lib/time/greenButtonUtcTrustedDateKeys";

function asDateKey(value: unknown): string | null {
  const text = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

/**
 * Home-local trusted pool for Green Button Past Sim: adapter UTC trusted keys mapped
 * through projected intervals, plus any home day that already meets GB completeness.
 */
export function resolveGreenButtonPastSimTrustedHomeDateKeys(args: {
  trustedUtcDateKeys: readonly string[];
  intervals: ReadonlyArray<Pick<HomeProjectedIntervalPoint, "timestamp" | "homeDateKey" | "homeSlot">>;
  timezone: string;
}): Set<string> {
  const timezone = String(args.timezone ?? "America/Chicago").trim() || "America/Chicago";
  const home = createHomeIntervalCalendar(timezone);
  const trustedHome = mapGreenButtonUtcTrustedDateKeysToHome(args.trustedUtcDateKeys, args.intervals);

  const intervalsByHomeDate = new Map<string, Array<Pick<HomeProjectedIntervalPoint, "timestamp" | "homeDateKey" | "homeSlot">>>();
  for (const row of args.intervals) {
    const dk = asDateKey(dateKeyFromIntervalPoint(row));
    if (!dk) continue;
    const list = intervalsByHomeDate.get(dk) ?? [];
    list.push(row);
    intervalsByHomeDate.set(dk, list);
  }

  for (const [dateKey, dayIntervals] of Array.from(intervalsByHomeDate.entries())) {
    if (
      dayMeetsTrustedIntervalThreshold({
        intervals: dayIntervals,
        dateKey,
        source: "GREEN_BUTTON",
        home,
      })
    ) {
      trustedHome.add(dateKey);
    }
  }

  return trustedHome;
}
