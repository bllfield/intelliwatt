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
});
