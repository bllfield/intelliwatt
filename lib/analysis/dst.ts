import { DateTime } from "luxon";

/**
 * Returns expected number of 15-minute intervals for a calendar day
 * in America/Chicago. Handles DST transitions (92, 96, 100 slots).
 */
export function expectedIntervalsForDateISO(isoDate: string): number {
  const zone = "America/Chicago";
  const start = DateTime.fromISO(isoDate, { zone }).startOf("day");
  if (!start.isValid) {
    return 96;
  }
  const end = start.plus({ days: 1 });
  const diffMinutes = end.diff(start, "minutes").minutes;
  return Math.round(diffMinutes / 15);
}
