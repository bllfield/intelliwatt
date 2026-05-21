import { Prisma } from "@prisma/client";

import { expectedIntervalsForDateISO } from "@/lib/analysis/dst";
import { getChicagoDateKeyForTimestamp } from "@/lib/usage/greenButtonCoverage";
import {
  createHomeIntervalCalendar,
  localSlotIndex,
  type HomeIntervalCalendar,
} from "@/lib/time/homeIntervalCalendar";

const GREEN_BUTTON_HOME_TIMEZONE = "America/Chicago";

/** Distinct 15-min slot index from local midnight (DST-safe; matches homeIntervalCalendar). */
export const GREEN_BUTTON_CHICAGO_LOCAL_SLOT_SQL = Prisma.sql`
  FLOOR(
    EXTRACT(
      EPOCH FROM (
        ("timestamp" AT TIME ZONE 'America/Chicago')
        - date_trunc('day', "timestamp" AT TIME ZONE 'America/Chicago')
      )
    ) / 900
  )::int
`;

export function greenButtonHomeCalendar(): HomeIntervalCalendar {
  return createHomeIntervalCalendar(GREEN_BUTTON_HOME_TIMEZONE);
}

export function distinctLocalSlotIndex(timestamp: Date | string, home?: HomeIntervalCalendar): number {
  const calendar = home ?? greenButtonHomeCalendar();
  const iso = timestamp instanceof Date ? timestamp.toISOString() : String(timestamp);
  return localSlotIndex(iso, calendar);
}

export function countDistinctLocalSlotsByDateKey<T extends { timestamp: Date }>(
  intervals: ReadonlyArray<T>,
  home?: HomeIntervalCalendar,
): Map<string, number> {
  const calendar = home ?? greenButtonHomeCalendar();
  const slotsByDate = new Map<string, Set<number>>();
  for (const interval of intervals) {
    const dateKey = getChicagoDateKeyForTimestamp(interval.timestamp);
    if (!dateKey) continue;
    if (!slotsByDate.has(dateKey)) slotsByDate.set(dateKey, new Set());
    slotsByDate.get(dateKey)!.add(distinctLocalSlotIndex(interval.timestamp, calendar));
  }
  const counts = new Map<string, number>();
  slotsByDate.forEach((slots, dateKey) => counts.set(dateKey, slots.size));
  return counts;
}

/** GB anchor/trim: allow one missing 15-min slot vs full wall day (vendor gaps); floor 90. */
export function greenButtonAnchorDayCompleteThreshold(dateKey: string): number {
  const expected = expectedIntervalsForDateISO(dateKey);
  return Math.max(90, expected - 1);
}

export function isGreenButtonLocalDayComplete(dateKey: string, distinctSlotCount: number): boolean {
  return distinctSlotCount >= greenButtonAnchorDayCompleteThreshold(dateKey);
}

export function resolveLatestCompleteGreenButtonDateKeyFromSlotCounts(
  countsByDateKey: Map<string, number>,
): string | null {
  const sortedDateKeys = Array.from(countsByDateKey.keys()).sort();
  if (sortedDateKeys.length === 0) return null;
  for (let i = sortedDateKeys.length - 1; i >= 0; i -= 1) {
    const dateKey = sortedDateKeys[i]!;
    if (isGreenButtonLocalDayComplete(dateKey, countsByDateKey.get(dateKey) ?? 0)) {
      return dateKey;
    }
  }
  return sortedDateKeys[sortedDateKeys.length - 1] ?? null;
}
