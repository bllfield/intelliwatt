/**
 * Home-local Past interval grid helpers (replaces UTC slice / UTC-midnight grid).
 */

import {
  buildHomeDayGridContext,
  dateKeyFromIntervalPoint,
  enumerateHomeDayStartsMsForWindow,
  getHomeDayGridTimestamps,
} from "@/lib/time/actualIntervalCalendar";
import { createHomeIntervalCalendar, type HomeIntervalCalendar } from "@/lib/time/homeIntervalCalendar";

export type PastIntervalGrid = {
  home: HomeIntervalCalendar;
  canonicalDayStartsMs: number[];
  dateKeyFromTimestamp: (ts: string) => string;
  getDayGridTimestamps: (dayStartMs: number) => string[];
  enumerateDayStartsMsForWindow: (startDateKey: string, endDateKey: string) => number[];
};

export function createPastIntervalGrid(homeTimezone: string): PastIntervalGrid {
  const home = createHomeIntervalCalendar(homeTimezone);
  return {
    home,
    canonicalDayStartsMs: [],
    dateKeyFromTimestamp: (ts: string) => dateKeyFromIntervalPoint({ timestamp: ts }),
    getDayGridTimestamps: (dayStartMs: number) => {
      const dateKey = dateKeyFromIntervalPoint({ timestamp: new Date(dayStartMs).toISOString() });
      return /^\d{4}-\d{2}-\d{2}$/.test(dateKey) ? getHomeDayGridTimestamps(dateKey, home) : [];
    },
    enumerateDayStartsMsForWindow: (startDateKey: string, endDateKey: string) =>
      enumerateHomeDayStartsMsForWindow(startDateKey, endDateKey, home),
  };
}

export function createPastIntervalGridForWindow(args: {
  homeTimezone: string;
  startDateKey: string;
  endDateKey: string;
}): PastIntervalGrid {
  const home = createHomeIntervalCalendar(args.homeTimezone);
  const ctx = buildHomeDayGridContext({
    startDateKey: args.startDateKey,
    endDateKey: args.endDateKey,
    home,
  });
  return {
    home,
    canonicalDayStartsMs: ctx.canonicalDayStartsMs,
    dateKeyFromTimestamp: ctx.dateKeyFromTimestamp,
    getDayGridTimestamps: ctx.getDayGridTimestamps,
    enumerateDayStartsMsForWindow: (startDateKey: string, endDateKey: string) =>
      enumerateHomeDayStartsMsForWindow(startDateKey, endDateKey, home),
  };
}
