import { describe, expect, it } from "vitest";
import {
  canonicalCoverageWindowUtcBounds,
  filterIntervalsToCanonicalCoverageWindow,
  isSmtIntervalInCanonicalCoverageWindow,
} from "@/lib/usage/canonicalMetadataWindow";

describe("canonicalCoverageWindowBounds", () => {
  const window = { startDate: "2026-05-17", endDate: "2026-05-18" };

  it("includes late-evening Chicago slots on the canonical end day (CDT)", () => {
    // 23:30 America/Chicago on 2026-05-18 is 2026-05-19T04:30:00.000Z — excluded by naive UTC end-of-day filter.
    const ts = new Date("2026-05-19T04:30:00.000Z");
    expect(isSmtIntervalInCanonicalCoverageWindow(ts, window)).toBe(true);
  });

  it("excludes intervals on the Chicago day after the canonical end", () => {
    const ts = new Date("2026-05-19T05:00:00.000Z");
    expect(isSmtIntervalInCanonicalCoverageWindow(ts, window)).toBe(false);
  });

  it("UTC bounds span full Chicago calendar days for range scans", () => {
    const bounds = canonicalCoverageWindowUtcBounds(window);
    expect(bounds.rangeStart.toISOString()).toBe("2026-05-17T05:00:00.000Z");
    expect(bounds.rangeEndInclusive.toISOString()).toBe("2026-05-19T04:59:59.999Z");
  });

  it("filterIntervalsToCanonicalCoverageWindow keeps all 96 slots for a typical SMT day file", () => {
    const startMs = new Date("2026-05-18T04:45:00.000Z").getTime();
    const intervals = Array.from({ length: 96 }, (_, i) => ({
      ts: new Date(startMs + i * 15 * 60 * 1000),
    }));
    const bounded = filterIntervalsToCanonicalCoverageWindow(intervals, window);
    expect(bounded).toHaveLength(96);
  });
});
