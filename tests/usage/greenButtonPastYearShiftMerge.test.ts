import { describe, expect, it, vi, beforeEach } from "vitest";

import {
  greenButtonShiftedTargetDateKeys,
  mergeGreenButtonHomeLocalWithYearShifted,
} from "@/lib/usage/greenButtonPastYearShiftMerge";

const fetchGreenButtonIntervalsForCoverageWindow = vi.fn();

vi.mock("@/modules/realUsageAdapter/greenButton", () => ({
  fetchGreenButtonIntervalsForCoverageWindow: (...args: unknown[]) =>
    fetchGreenButtonIntervalsForCoverageWindow(...args),
}));

describe("greenButtonPastYearShiftMerge", () => {
  beforeEach(() => {
    fetchGreenButtonIntervalsForCoverageWindow.mockReset();
  });

  it("identifies shifted target dates when source differs from target", () => {
    expect(
      greenButtonShiftedTargetDateKeys({
        "2026-05-14": "2025-05-14",
        "2026-05-13": "2026-05-13",
      })
    ).toEqual(new Set(["2026-05-14"]));
  });

  it("replaces trailing partial current-year rows with shifted prior-year intervals", () => {
    const merged = mergeGreenButtonHomeLocalWithYearShifted({
      timezone: "America/Chicago",
      sourceDateByTargetDate: { "2026-05-14": "2025-05-14" },
      homeLocalIntervals: [
        {
          timestamp: "2026-05-14T12:00:00.000Z",
          kwh: 9,
          homeDateKey: "2026-05-14",
          homeSlot: 48,
        },
        {
          timestamp: "2026-05-13T12:00:00.000Z",
          kwh: 45,
          homeDateKey: "2026-05-13",
          homeSlot: 48,
        },
      ],
      shiftedHomeIntervals: Array.from({ length: 96 }, (_, slot) => ({
        timestamp: new Date(new Date("2025-05-14T00:00:00.000Z").getTime() + slot * 15 * 60 * 1000).toISOString(),
        kwh: 0.25,
        homeDateKey: "2026-05-14",
        homeSlot: slot,
      })),
    });

    const may14 = merged.filter((row) => row.homeDateKey === "2026-05-14");
    expect(may14).toHaveLength(96);
    expect(may14.every((row) => row.kwh === 0.25)).toBe(true);
    expect(merged.some((row) => row.homeDateKey === "2026-05-13" && row.kwh === 45)).toBe(true);
  });
});
