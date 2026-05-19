import { describe, expect, it } from "vitest";

import { redistributeGreenButtonGridZeroSamples } from "@/modules/onePathSim/greenButtonIntervalCorrections";

describe("Green Button interval corrections", () => {
  it("splits a padded zero with the adjacent duplicate dump without changing the daily total", () => {
    const result = redistributeGreenButtonGridZeroSamples([
      { timestamp: "2026-05-12T19:00:00.000Z", kwh: 0.25 },
      { timestamp: "2026-05-12T19:15:00.000Z", kwh: 0 },
      { timestamp: "2026-05-12T19:30:00.000Z", kwh: 1 },
    ]);

    expect(result.redistributedIntervalCount).toBe(1);
    expect(result.intervals).toEqual([
      { timestamp: "2026-05-12T19:00:00.000Z", kwh: 0.25 },
      { timestamp: "2026-05-12T19:15:00.000Z", kwh: 0.5 },
      { timestamp: "2026-05-12T19:30:00.000Z", kwh: 0.5 },
    ]);
    expect(result.intervals.reduce((sum, row) => sum + row.kwh, 0)).toBe(1.25);
  });

  it("uses the larger adjacent donor when both sides of the zero have usage", () => {
    const result = redistributeGreenButtonGridZeroSamples([
      { timestamp: "2026-05-12T19:00:00.000Z", kwh: 0.25 },
      { timestamp: "2026-05-12T19:15:00.000Z", kwh: 0 },
      { timestamp: "2026-05-12T19:30:00.000Z", kwh: 1 },
    ]);

    expect(result.intervals[0]?.kwh).toBe(0.25);
    expect(result.intervals[1]?.kwh).toBe(0.5);
    expect(result.intervals[2]?.kwh).toBe(0.5);
  });

  it("does not redistribute across UTC grid day boundaries", () => {
    const result = redistributeGreenButtonGridZeroSamples([
      { timestamp: "2026-05-12T23:45:00.000Z", kwh: 1 },
      { timestamp: "2026-05-13T00:00:00.000Z", kwh: 0 },
    ]);

    expect(result.redistributedIntervalCount).toBe(0);
    expect(result.intervals).toEqual([
      { timestamp: "2026-05-12T23:45:00.000Z", kwh: 1 },
      { timestamp: "2026-05-13T00:00:00.000Z", kwh: 0 },
    ]);
  });
});
