import { DateTime } from "luxon";

import {
  enumerateExpectedLocalSlotsForDate,
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

const expectedSlotsByDayCache = new Map<string, number[]>();

function cacheKey(home: HomeIntervalCalendar, dateKey: string): string {
  return `${home.timezone}\t${dateKey}`;
}

function expectedSlotsForDate(dateKey: string, home: HomeIntervalCalendar): number[] {
  const key = cacheKey(home, dateKey);
  let slots = expectedSlotsByDayCache.get(key);
  if (!slots) {
    slots = enumerateExpectedLocalSlotsForDate(dateKey, home);
    expectedSlotsByDayCache.set(key, slots);
  }
  return slots;
}

/** Clear DST slot cache between ingest jobs (optional; bounded to ~365 keys per job). */
export function clearGreenButtonHomeLocalSlotCache(): void {
  expectedSlotsByDayCache.clear();
}

function nextHomeLocalSlot(
  dateKey: string,
  slot: number,
  home: HomeIntervalCalendar
): { dateKey: string; slot: number } | null {
  const expected = expectedSlotsForDate(dateKey, home);
  const idx = expected.indexOf(slot);
  if (idx >= 0 && idx < expected.length - 1) {
    return { dateKey, slot: expected[idx + 1]! };
  }
  const nextDay = DateTime.fromISO(dateKey, { zone: home.timezone }).plus({ days: 1 }).toFormat("yyyy-MM-dd");
  const nextExpected = expectedSlotsForDate(nextDay, home);
  if (nextExpected.length === 0) return null;
  return { dateKey: nextDay, slot: nextExpected[0]! };
}

function addKwhFragmentToBucket(
  buckets: Map<number, GreenButtonBucketCell>,
  slotStartMs: number,
  kwhFragment: number
): void {
  const existing = buckets.get(slotStartMs);
  if (existing) {
    existing.kwh += kwhFragment;
    existing.collisionCount += 1;
  } else {
    buckets.set(slotStartMs, { kwh: kwhFragment, collisionCount: 1 });
  }
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

  const home = args.home;
  const startMs = args.intervalStartUtc.getTime();
  const endMs = startMs + durationMs;
  const startIso = args.intervalStartUtc.toISOString();
  let dateKey = localDateKey(startIso, home);
  let slot = localSlotIndex(startIso, home);

  let guard = 0;
  const maxSlotSteps = 200;

  while (guard++ < maxSlotSteps) {
    const { startUtc, endUtcExclusive } = homeLocalSlotBoundsUtc(dateKey, slot, home);
    const slotStartMs = startUtc.getTime();
    const slotEndMs = endUtcExclusive.getTime();

    if (slotStartMs >= endMs) break;

    const overlapMs = Math.min(endMs, slotEndMs) - Math.max(startMs, slotStartMs);
    if (overlapMs > 0) {
      const kwhFragment = totalKwh * (overlapMs / durationMs);
      addKwhFragmentToBucket(args.buckets, slotStartMs, kwhFragment);
    }

    if (slotEndMs >= endMs) break;

    const next = nextHomeLocalSlot(dateKey, slot, home);
    if (!next) break;
    dateKey = next.dateKey;
    slot = next.slot;
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
