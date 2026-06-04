import { DateTime } from "luxon";

import {
  enumerateExpectedLocalSlotsForDate,
  enumerateLocalDateKeys,
  localDateKey,
  localSlotIndex,
  type HomeIntervalCalendar,
} from "@/lib/time/homeIntervalCalendar";
import type { GreenButtonBucketCell } from "@/lib/usage/greenButtonSlotRepair";

/** Canonical home-local slot bounds (DST-safe via home timezone, not fixed UTC +15m steps). */
export function homeLocalSlotBoundsUtc(
  dateKey: string,
  slot: number,
  home: HomeIntervalCalendar
): { startUtc: Date; endUtcExclusive: Date } {
  const start = DateTime.fromISO(dateKey, { zone: home.timezone })
    .startOf("day")
    .plus({ minutes: slot * 15 });
  const end = start.plus({ minutes: 15 });
  return {
    startUtc: start.toUTC().toJSDate(),
    endUtcExclusive: end.toUTC().toJSDate(),
  };
}

/** Bucket key for the home-local slot that contains this instant. */
export function homeLocalSlotStartMsFromInstant(
  instant: Date,
  home: HomeIntervalCalendar
): number {
  const iso = instant.toISOString();
  const dateKey = localDateKey(iso, home);
  const slot = localSlotIndex(iso, home);
  return homeLocalSlotBoundsUtc(dateKey, slot, home).startUtc.getTime();
}

/**
 * Place interval energy into canonical 15-minute home-local buckets by wall-clock overlap.
 * Avoids assigning full kWh to a single slot when the vendor interval straddles boundaries.
 */
export function addGreenButtonReadingToHomeLocalBuckets(args: {
  intervalStartUtc: Date;
  durationSeconds: number;
  totalKwh: number;
  home: HomeIntervalCalendar;
  buckets: Map<number, GreenButtonBucketCell>;
}): void {
  const durationSeconds = args.durationSeconds > 0 ? args.durationSeconds : 900;
  const durationMs = durationSeconds * 1000;
  const totalKwh = args.totalKwh;
  if (!Number.isFinite(totalKwh) || totalKwh < 0 || durationMs <= 0) return;

  const startMs = args.intervalStartUtc.getTime();
  const endMs = startMs + durationMs;

  const startDateKey = localDateKey(args.intervalStartUtc, args.home);
  const endDateKey = localDateKey(new Date(endMs - 1), args.home);
  const dateKeys = enumerateLocalDateKeys(startDateKey, endDateKey, args.home);

  for (const dateKey of dateKeys) {
    for (const slot of enumerateExpectedLocalSlotsForDate(dateKey, args.home)) {
      const { startUtc, endUtcExclusive } = homeLocalSlotBoundsUtc(dateKey, slot, args.home);
      const slotStartMs = startUtc.getTime();
      const slotEndMs = endUtcExclusive.getTime();
      const overlapMs = Math.min(endMs, slotEndMs) - Math.max(startMs, slotStartMs);
      if (overlapMs <= 0) continue;

      const kwhFragment = totalKwh * (overlapMs / durationMs);
      const existing = args.buckets.get(slotStartMs);
      if (existing) {
        existing.kwh += kwhFragment;
        existing.collisionCount += 1;
      } else {
        args.buckets.set(slotStartMs, { kwh: kwhFragment, collisionCount: 1 });
      }
    }
  }
}

/** Snap a persisted or off-grid timestamp to its canonical home-local bucket start. */
export function canonicalizeGreenButtonBucketStartMs(
  timestamp: Date,
  home: HomeIntervalCalendar
): number | null {
  if (!Number.isFinite(timestamp.getTime())) return null;
  return homeLocalSlotStartMsFromInstant(timestamp, home);
}
