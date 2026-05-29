import { describe, expect, it } from "vitest";
import { convertGreenButtonPersistedRowsToHome } from "@/lib/time/greenButtonPersistedIntervalConvert";
import { homeProjectedIntervalFromRecord } from "@/lib/time/actualIntervalCalendar";
import { mapGreenButtonUtcTrustedDateKeysToHome } from "@/lib/time/greenButtonUtcTrustedDateKeys";

describe("mapGreenButtonUtcTrustedDateKeysToHome", () => {
  it("maps UTC-grid trusted keys to home-local date keys used by the Past engine", () => {
    const utcGridIntervals = Array.from({ length: 96 }, (_, slot) => ({
      timestamp: new Date(new Date("2026-05-14T00:00:00.000Z").getTime() + slot * 15 * 60 * 1000),
      consumptionKwh: 0.25,
    }));
    const projected = convertGreenButtonPersistedRowsToHome(utcGridIntervals).intervals.map(
      homeProjectedIntervalFromRecord
    );
    expect(projected.length).toBe(96);

    const homeTrusted = mapGreenButtonUtcTrustedDateKeysToHome(["2026-05-14"], projected);
    expect(homeTrusted.size).toBeGreaterThan(0);
    for (const homeKey of homeTrusted) {
      expect(projected.some((row) => row.homeDateKey === homeKey)).toBe(true);
    }
    expect(projected.some((row) => homeTrusted.has(row.homeDateKey))).toBe(true);
  });
});
