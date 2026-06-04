import {
  createHomeIntervalCalendar,
  enumerateExpectedLocalSlotsForDate,
  localDateKey,
  localSlotIndex,
  type HomeIntervalCalendar,
} from "@/lib/time/homeIntervalCalendar";
import {
  homeLocalSlotBoundsUtc,
  homeLocalSlotStartMsFromInstant,
} from "@/lib/usage/greenButtonHomeLocalBuckets";

/** Treat at-or-below this as a missing quarter-hour (vendor padding / gap), not real zero usage. */
export const GREEN_BUTTON_SLOT_REPAIR_EPS_KWH = 0.01;

export type GreenButtonBucketCell = {
  kwh: number;
  /** How many raw readings were summed into this home-local bucket (duplicate XML starts, etc.). */
  collisionCount: number;
};

function round4(value: number): number {
  return Math.round((Number(value) || 0) * 10000) / 10000;
}

function isMissingOrZero(kwh: number | undefined): boolean {
  return kwh == null || !Number.isFinite(kwh) || kwh < GREEN_BUTTON_SLOT_REPAIR_EPS_KWH;
}

function slotStartMs(dateKey: string, slot: number, home: HomeIntervalCalendar): number {
  return homeLocalSlotBoundsUtc(dateKey, slot, home).startUtc.getTime();
}

function getSlotKwh(slots: Map<number, number>, slot: number): number | null {
  if (!slots.has(slot)) return null;
  const kwh = slots.get(slot)!;
  return isMissingOrZero(kwh) ? null : kwh;
}

function setSlotKwh(slots: Map<number, number>, slot: number, kwh: number): void {
  slots.set(slot, round4(Math.max(0, kwh)));
}

/**
 * Repair one home-local calendar day:
 * - Overfilled slot with missing/zero next and usage after the gap → split by 2.
 * - Missing/zero between two filled neighbors → split combined energy across three slots (/3).
 * - Remaining zero with one filled neighbor → split donor by 2.
 */
export function repairGreenButtonDaySlots(
  slots: Map<number, number>,
  collisionBySlot: Map<number, number> | null,
  dateKey: string,
  home: HomeIntervalCalendar
): number {
  const expectedSlots = enumerateExpectedLocalSlotsForDate(dateKey, home);
  if (expectedSlots.length === 0) return 0;

  let repairs = 0;
  const maxSlot = expectedSlots[expectedSlots.length - 1]!;

  // Pass 1: duplicate/overfilled bucket beside a gap (e.g. SMT GB 19:00+19:00 → skip 19:15).
  for (const slot of expectedSlots) {
    if (slot >= maxSlot) continue;
    const current = getSlotKwh(slots, slot);
    if (current == null) continue;
    if (!isMissingOrZero(slots.get(slot + 1)) && slots.has(slot + 1)) continue;

    const afterGap = getSlotKwh(slots, slot + 2);
    if (afterGap == null) continue;

    const collisions = collisionBySlot?.get(slot) ?? 1;
    // Only split when duplicate readings were summed into this bucket (SMT GB XML pattern).
    if (collisions < 2) continue;

    const half = current / 2;
    setSlotKwh(slots, slot, half);
    setSlotKwh(slots, slot + 1, half);
    repairs += 1;
  }

  // Pass 2: explicit zero padding (row present) with exactly one filled neighbor — split donor by 2.
  for (const slot of expectedSlots) {
    if (!slots.has(slot)) continue;
    const current = slots.get(slot)!;
    if (!isMissingOrZero(current)) continue;

    const before = getSlotKwh(slots, slot - 1);
    const after = getSlotKwh(slots, slot + 1);
    const hasBefore = before != null;
    const hasAfter = after != null;
    if (hasBefore === hasAfter) continue;

    const donorSlot = hasBefore ? slot - 1 : slot + 1;
    const donorKwh = hasBefore ? before! : after!;
    const half = donorKwh / 2;
    setSlotKwh(slots, donorSlot, half);
    setSlotKwh(slots, slot, half);
    repairs += 1;
  }

  // Pass 3: missing bucket or zero between two filled neighbors — redistribute (/3).
  for (const slot of expectedSlots) {
    if (slot <= expectedSlots[0]! || slot >= maxSlot) continue;
    const current = slots.has(slot) ? slots.get(slot)! : null;
    if (!isMissingOrZero(current ?? undefined)) continue;

    const before = getSlotKwh(slots, slot - 1);
    const after = getSlotKwh(slots, slot + 1);
    if (before == null || after == null) continue;

    const third = (before + after) / 3;
    setSlotKwh(slots, slot - 1, third);
    setSlotKwh(slots, slot, third);
    setSlotKwh(slots, slot + 1, third);
    repairs += 1;
  }

  return repairs;
}

/**
 * Apply slot repair across all home-local days represented in normalized buckets.
 */
export function repairGreenButtonHomeLocalBuckets(
  buckets: Map<number, GreenButtonBucketCell>,
  home: HomeIntervalCalendar
): number {
  const byDay = new Map<string, Map<number, number>>();
  const collisionByDay = new Map<string, Map<number, number>>();

  for (const [ms, cell] of Array.from(buckets.entries())) {
    const iso = new Date(ms).toISOString();
    const dateKey = localDateKey(iso, home);
    const slot = localSlotIndex(iso, home);
    if (!byDay.has(dateKey)) {
      byDay.set(dateKey, new Map());
      collisionByDay.set(dateKey, new Map());
    }
    byDay.get(dateKey)!.set(slot, cell.kwh);
    collisionByDay.get(dateKey)!.set(slot, cell.collisionCount);
  }

  let totalRepairs = 0;
  for (const [dateKey, daySlots] of Array.from(byDay.entries())) {
    totalRepairs += repairGreenButtonDaySlots(
      daySlots,
      collisionByDay.get(dateKey) ?? null,
      dateKey,
      home
    );
  }

  buckets.clear();
  for (const [dateKey, daySlots] of Array.from(byDay.entries())) {
    for (const [slot, kwh] of Array.from(daySlots.entries())) {
      buckets.set(slotStartMs(dateKey, slot, home), {
        kwh,
        collisionCount: collisionByDay.get(dateKey)?.get(slot) ?? 1,
      });
    }
  }

  return totalRepairs;
}

/**
 * Re-apply ingest slot repair to already-persisted rows.
 *
 * **Ingest-only in production:** use `runGreenButtonUsagePipeline` before writing
 * `GreenButtonInterval`. Downstream reads must use `loadPersistedGreenButtonIntervals`
 * without calling this. Reserved for tests and `rehydrateGreenButtonIntervalsFromRawForHouse`.
 */
export function repairGreenButtonIntervalSeries(
  rows: Array<{ timestamp: Date | string; kwh?: number; consumptionKwh?: number }>,
  homeTimezone = "America/Chicago"
): {
  intervals: Array<{ timestamp: Date; consumptionKwh: number }>;
  repairCount: number;
} {
  const home = createHomeIntervalCalendar(homeTimezone);
  const buckets = new Map<number, GreenButtonBucketCell>();

  for (const row of rows) {
    const ts =
      row.timestamp instanceof Date ? row.timestamp : new Date(String(row.timestamp ?? ""));
    if (!Number.isFinite(ts.getTime())) continue;
    const kwh = Number(row.consumptionKwh ?? row.kwh ?? 0) || 0;
    if (kwh < 0) continue;
    const ms = homeLocalSlotStartMsFromInstant(ts, home);
    const existing = buckets.get(ms);
    if (existing) {
      existing.kwh += kwh;
      existing.collisionCount += 1;
    } else {
      buckets.set(ms, { kwh, collisionCount: 1 });
    }
  }

  const repairCount = repairGreenButtonHomeLocalBuckets(buckets, home);
  const intervals = Array.from(buckets.entries())
    .map(([ms, cell]) => ({
      timestamp: new Date(ms),
      consumptionKwh: round4(cell.kwh),
    }))
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  return { intervals, repairCount };
}
