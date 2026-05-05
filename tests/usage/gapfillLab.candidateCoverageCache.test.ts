import { describe, expect, it, vi } from "vitest";
import { getCandidateDateCoverageForSelection } from "@/lib/admin/gapfillLab";

describe("getCandidateDateCoverageForSelection", () => {
  it("reuses cached candidate day coverage for identical full-window selection inputs", async () => {
    const loadIntervalsForWindow = vi.fn(async () => [
      { timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.25 },
      { timestamp: "2026-01-01T00:15:00.000Z", kwh: 0.25 },
      { timestamp: "2026-01-02T00:00:00.000Z", kwh: 0.25 },
      { timestamp: "2026-01-02T00:15:00.000Z", kwh: 0.25 },
    ]);

    const baseArgs = {
      houseId: "h1",
      scenarioIdentity: "gapfill_lab:2025-03..2026-02",
      windowStart: "2025-03-12",
      windowEnd: "2026-03-12",
      timezone: "America/Chicago",
      minDayCoveragePct: 0.01,
      stratifyByMonth: true,
      stratifyByWeekend: true,
      loadIntervalsForWindow,
    };

    const first = await getCandidateDateCoverageForSelection(baseArgs);
    const second = await getCandidateDateCoverageForSelection(baseArgs);

    expect(first.cacheHit).toBe(false);
    expect(second.cacheHit).toBe(true);
    expect(loadIntervalsForWindow).toHaveBeenCalledTimes(1);
    expect(second.candidateDateKeys).toEqual(first.candidateDateKeys);
    expect(second.intervalsForWindow).toEqual(first.intervalsForWindow);
  });

  it("uses a different cache key when stratification inputs differ", async () => {
    const loadIntervalsForWindow = vi.fn(async () => [
      { timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.25 },
      { timestamp: "2026-01-01T00:15:00.000Z", kwh: 0.25 },
    ]);

    await getCandidateDateCoverageForSelection({
      houseId: "h2",
      scenarioIdentity: "gapfill_lab:2025-03..2026-02",
      windowStart: "2025-03-12",
      windowEnd: "2026-03-12",
      timezone: "America/Chicago",
      minDayCoveragePct: 0.01,
      stratifyByMonth: true,
      stratifyByWeekend: true,
      loadIntervalsForWindow,
    });
    await getCandidateDateCoverageForSelection({
      houseId: "h2",
      scenarioIdentity: "gapfill_lab:2025-03..2026-02",
      windowStart: "2025-03-12",
      windowEnd: "2026-03-12",
      timezone: "America/Chicago",
      minDayCoveragePct: 0.01,
      stratifyByMonth: false,
      stratifyByWeekend: true,
      loadIntervalsForWindow,
    });

    expect(loadIntervalsForWindow).toHaveBeenCalledTimes(2);
  });

  it("filters out partially covered days when full actual-day truth is required", async () => {
    const loadIntervalsForWindow = vi.fn(async () => [
      ...Array.from({ length: 96 }, (_, idx) => ({
        timestamp: new Date(Date.UTC(2026, 0, 1, 0, idx * 15)).toISOString(),
        kwh: 0.25,
      })),
      ...Array.from({ length: 95 }, (_, idx) => ({
        timestamp: new Date(Date.UTC(2026, 0, 2, 0, idx * 15)).toISOString(),
        kwh: 0.25,
      })),
    ]);

    const result = await getCandidateDateCoverageForSelection({
      houseId: "h3",
      scenarioIdentity: "past_shared:scenario-1",
      windowStart: "2026-01-01",
      windowEnd: "2026-01-02",
      timezone: "UTC",
      minDayCoveragePct: 1,
      stratifyByMonth: true,
      stratifyByWeekend: true,
      loadIntervalsForWindow,
    });

    expect(result.candidateDateKeys).toEqual(["2026-01-01"]);
    expect(result.coverageByDay["2026-01-01"]).toMatchObject({ count: 96, expected: 96, pct: 1 });
    expect(result.coverageByDay["2026-01-02"]).toMatchObject({ count: 95, expected: 96, pct: 95 / 96 });
  });
});
