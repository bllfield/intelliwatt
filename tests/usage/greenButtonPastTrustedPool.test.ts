import { describe, expect, it } from "vitest";
import { convertGreenButtonPersistedRowsToHome } from "@/lib/time/greenButtonPersistedIntervalConvert";
import { homeProjectedIntervalFromRecord } from "@/lib/time/actualIntervalCalendar";
import {
  resolveGreenButtonPastSimTrustedHomeDateKeys,
  resolveGreenButtonTrustedHomeDateKeysFromDecodedIntervals,
} from "@/lib/usage/greenButtonPastTrustedPool";
import { resolveGreenButtonPastValidationCandidateDateKeys } from "@/lib/usage/greenButtonPastValidationCandidates";

describe("greenButtonPastTrustedPool", () => {
  it("maps UTC trusted keys to home-local keys for Past Sim", () => {
    const utcGridIntervals = Array.from({ length: 96 }, (_, slot) => ({
      timestamp: new Date(new Date("2026-05-14T00:00:00.000Z").getTime() + slot * 15 * 60 * 1000),
      consumptionKwh: 0.25,
    }));
    const projected = convertGreenButtonPersistedRowsToHome(utcGridIntervals).intervals.map(
      homeProjectedIntervalFromRecord
    );
    const trustedHome = resolveGreenButtonPastSimTrustedHomeDateKeys({
      trustedUtcDateKeys: ["2026-05-14"],
      intervals: projected,
      timezone: "America/Chicago",
    });
    expect(trustedHome.size).toBeGreaterThan(0);
    for (const homeKey of trustedHome) {
      expect(projected.some((row) => row.homeDateKey === homeKey)).toBe(true);
    }
  });

  it("builds a validation candidate pool larger than Chicago 96/96 on raw UTC timestamps", () => {
    const utcGridIntervals = Array.from({ length: 96 * 3 }, (_, index) => {
      const dayOffset = Math.floor(index / 96);
      const slot = index % 96;
      const day = String(14 + dayOffset).padStart(2, "0");
      return {
        timestamp: new Date(`2026-05-${day}T${String(Math.floor((slot * 15) / 60)).padStart(2, "0")}:${String((slot * 15) % 60).padStart(2, "0")}:00.000Z`),
        consumptionKwh: 0.25,
      };
    });
    const candidates = resolveGreenButtonPastValidationCandidateDateKeys({
      trustedUtcDateKeys: ["2026-05-14", "2026-05-15", "2026-05-16"],
      intervals: utcGridIntervals.map((row) => ({
        timestamp: row.timestamp.toISOString(),
        kwh: row.consumptionKwh,
      })),
      timezone: "America/Chicago",
      windowStart: "2026-05-14",
      windowEnd: "2026-05-16",
    });
    expect(candidates.length).toBeGreaterThanOrEqual(3);
  });

  it("resolves trusted home keys from decoded intervals without adapter fetch metadata", () => {
    const utcGridIntervals = Array.from({ length: 96 }, (_, slot) => ({
      timestamp: new Date(new Date("2026-05-14T00:00:00.000Z").getTime() + slot * 15 * 60 * 1000).toISOString(),
      kwh: 0.25,
    }));
    const trustedHome = resolveGreenButtonTrustedHomeDateKeysFromDecodedIntervals({
      decodedIntervals: utcGridIntervals,
      trustedUtcDateKeys: ["2026-05-14"],
      timezone: "America/Chicago",
    });
    expect(trustedHome.size).toBeGreaterThan(0);
  });
});
