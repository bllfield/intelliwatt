import { beforeEach, describe, expect, it, vi } from "vitest";
import { IntervalSeriesKind } from "@/modules/usageSimulator/kinds";

const getActualUsageDatasetForHouse = vi.fn();
const getIntervalSeries15m = vi.fn();

vi.mock("@/lib/usage/actualDatasetForHouse", () => ({
  getActualUsageDatasetForHouse: (...args: any[]) => getActualUsageDatasetForHouse(...args),
}));

vi.mock("@/lib/usage/intervalSeriesRepo", () => ({
  getIntervalSeries15m: (...args: any[]) => getIntervalSeries15m(...args),
}));

import { resolveIntervalsLayer } from "@/lib/usage/resolveIntervalsLayer";

describe("resolveIntervalsLayer persisted past artifact", () => {
  beforeEach(() => {
    getActualUsageDatasetForHouse.mockReset();
    getIntervalSeries15m.mockReset();
  });

  it("returns persisted PAST_SIM_BASELINE dataset without recompute", async () => {
    getIntervalSeries15m.mockResolvedValue({
      header: {
        id: "s1",
        userId: "u1",
        houseId: "h1",
        kind: IntervalSeriesKind.PAST_SIM_BASELINE,
        scenarioId: "sc1",
        anchorStartUtc: new Date("2025-01-01T00:00:00.000Z"),
        anchorEndUtc: new Date("2025-01-01T00:15:00.000Z"),
        derivationVersion: "v1",
        buildInputsHash: "hash",
        updatedAt: new Date("2025-01-02T00:00:00.000Z"),
      },
      points: [
        { tsUtc: new Date("2025-01-01T00:00:00.000Z"), kwh: "0.25" },
        { tsUtc: new Date("2025-01-01T00:15:00.000Z"), kwh: "0.50" },
      ],
    });

    const out = await resolveIntervalsLayer({
      userId: "u1",
      houseId: "h1",
      layerKind: IntervalSeriesKind.PAST_SIM_BASELINE,
      scenarioId: "sc1",
      esiid: "1044",
    });

    expect(getIntervalSeries15m).toHaveBeenCalledTimes(1);
    expect(getActualUsageDatasetForHouse).not.toHaveBeenCalled();
    expect(out?.dataset?.summary?.source).toBe("SIMULATED");
    expect(out?.dataset?.series?.intervals15?.length).toBe(2);
    expect(out?.dataset?.insights?.artifactReadMode).toBe("persisted_only");
  });

  it("returns artifact-only null dataset when persisted series is missing", async () => {
    getIntervalSeries15m.mockResolvedValue(null);

    const out = await resolveIntervalsLayer({
      userId: "u1",
      houseId: "h1",
      layerKind: IntervalSeriesKind.PAST_SIM_BASELINE,
      scenarioId: "sc1",
      esiid: "1044",
    });

    expect(out?.dataset).toBeNull();
    expect(getActualUsageDatasetForHouse).not.toHaveBeenCalled();
  });
});

