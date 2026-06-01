/**
 * Green Button Past Sim year-shift merge: home-local in-window actuals from Usage parity path,
 * plus prior-year intervals shifted into the canonical coverage window (adapter-owned).
 */

import { convertGreenButtonPersistedRowsToHome } from "@/lib/time/greenButtonPersistedIntervalConvert";
import { createHomeIntervalCalendar, localSlotIndex } from "@/lib/time/homeIntervalCalendar";
import type { ActualIntervalPoint } from "@/lib/usage/actualDatasetForHouse";
import { fetchGreenButtonIntervalsForCoverageWindow } from "@/modules/realUsageAdapter/greenButton";

export type GreenButtonPastEngineInterval = {
  timestamp: string;
  kwh: number;
  homeDateKey: string;
  homeSlot: number;
};

export type GreenButtonPastYearShiftPayload = {
  engineSourceIntervals: GreenButtonPastEngineInterval[];
  sourceDateByTargetDate: Record<string, string>;
  displayWindowNote: string | null;
  shiftedIntervalCount: number;
  shiftedDateCount: number;
  sourceCoverageStart: string | null;
  sourceCoverageEnd: string | null;
  trustedUtcDateKeys: string[];
};

function asDateKey(value: unknown): string | null {
  const text = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

/** Target dates whose intervals were rebased from a different source calendar day. */
export function greenButtonShiftedTargetDateKeys(
  sourceDateByTargetDate: Record<string, string>
): Set<string> {
  const out = new Set<string>();
  for (const [target, source] of Object.entries(sourceDateByTargetDate)) {
    const targetKey = asDateKey(target);
    const sourceKey = asDateKey(source);
    if (targetKey && sourceKey && targetKey !== sourceKey) out.add(targetKey);
  }
  return out;
}

export function toGreenButtonPastEngineIntervals(
  intervals: ReadonlyArray<{
    timestamp: string;
    kwh?: number;
    homeDateKey?: string;
    homeSlot?: number;
  }>,
  timezone: string
): GreenButtonPastEngineInterval[] {
  const home = createHomeIntervalCalendar(timezone);
  return intervals
    .map((row) => {
      const timestamp = String(row.timestamp ?? "");
      const homeDateKey = String(row.homeDateKey ?? "").slice(0, 10);
      if (!timestamp || !/^\d{4}-\d{2}-\d{2}$/.test(homeDateKey)) return null;
      return {
        timestamp,
        kwh: Number(row.kwh) || 0,
        homeDateKey,
        homeSlot:
          typeof row.homeSlot === "number" && Number.isFinite(row.homeSlot)
            ? Math.trunc(row.homeSlot)
            : localSlotIndex(timestamp, home),
      };
    })
    .filter((row): row is GreenButtonPastEngineInterval => row != null);
}

/**
 * Merge Usage-parity home-local intervals with adapter year-shifted donor days.
 * Shifted target days replace any partial/trailing current-year rows for the same home date.
 */
export function mergeGreenButtonHomeLocalWithYearShifted(args: {
  homeLocalIntervals: ReadonlyArray<ActualIntervalPoint>;
  shiftedHomeIntervals: ReadonlyArray<GreenButtonPastEngineInterval>;
  sourceDateByTargetDate: Record<string, string>;
  timezone: string;
}): GreenButtonPastEngineInterval[] {
  const shiftedTargets = greenButtonShiftedTargetDateKeys(args.sourceDateByTargetDate);
  const byTs = new Map<string, GreenButtonPastEngineInterval>();

  for (const row of args.homeLocalIntervals) {
    const homeDateKey = String(row.homeDateKey ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(homeDateKey) || shiftedTargets.has(homeDateKey)) continue;
    const timestamp = String(row.timestamp ?? "");
    if (!timestamp) continue;
    byTs.set(timestamp, {
      timestamp,
      kwh: Number(row.kwh) || 0,
      homeDateKey,
      homeSlot:
        typeof row.homeSlot === "number" && Number.isFinite(row.homeSlot)
          ? Math.trunc(row.homeSlot)
          : localSlotIndex(timestamp, createHomeIntervalCalendar(args.timezone)),
    });
  }

  for (const row of args.shiftedHomeIntervals) {
    if (!shiftedTargets.has(row.homeDateKey)) continue;
    byTs.set(row.timestamp, row);
  }

  return Array.from(byTs.values()).sort((left, right) =>
    left.timestamp < right.timestamp ? -1 : left.timestamp > right.timestamp ? 1 : 0
  );
}

export async function loadGreenButtonPastYearShiftedPayload(args: {
  houseId: string;
  coverageStartDate: string;
  coverageEndDate: string;
  excludeDateKeys?: string[];
  travelRanges?: Array<{ startDate: string; endDate: string }>;
  timezone: string;
}): Promise<GreenButtonPastYearShiftPayload> {
  const timezone = String(args.timezone ?? "America/Chicago").trim() || "America/Chicago";
  const shifted = await fetchGreenButtonIntervalsForCoverageWindow({
    houseId: args.houseId,
    coverageStartDate: args.coverageStartDate,
    coverageEndDate: args.coverageEndDate,
    excludeDateKeys: args.excludeDateKeys,
    travelRanges: args.travelRanges,
    timestampMode: "raw",
  });
  const converted = convertGreenButtonPersistedRowsToHome(
    shifted.intervals.map((row) => ({
      timestamp: new Date(row.timestamp),
      consumptionKwh: Number(row.kwh) || 0,
    })),
    timezone,
  );
  const engineSourceIntervals = toGreenButtonPastEngineIntervals(
    converted.intervals.map((row) => ({
      timestamp: row.tsUtc,
      kwh: row.kwh,
      homeDateKey: row.homeDateKey,
      homeSlot: row.homeSlot,
    })),
    timezone,
  );
  return {
    engineSourceIntervals,
    sourceDateByTargetDate: shifted.sourceDateByTargetDate ?? {},
    displayWindowNote: shifted.displayWindowNote,
    shiftedIntervalCount: shifted.shiftedIntervalCount,
    shiftedDateCount: shifted.shiftedDateCount,
    sourceCoverageStart: shifted.sourceCoverageStart,
    sourceCoverageEnd: shifted.sourceCoverageEnd,
    trustedUtcDateKeys: shifted.trustedActualDateKeys ?? [],
  };
}
