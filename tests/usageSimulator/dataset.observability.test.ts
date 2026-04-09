import { describe, expect, it, vi } from "vitest";
import type { SimulatedCurve } from "@/modules/simulatedUsage/types";

vi.mock("server-only", () => ({}));

const { logPipeline } = vi.hoisted(() => ({
  logPipeline: vi.fn(),
}));

vi.mock("@/modules/usageSimulator/simObservability", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/modules/usageSimulator/simObservability")>();
  return {
    ...mod,
    logSimPipelineEvent: logPipeline,
  };
});

import { buildSimulatedUsageDatasetFromCurve } from "@/modules/usageSimulator/dataset";

function makeUtcDayIntervals(dayIso: string, kwhPerInterval: number) {
  const out: Array<{ timestamp: string; consumption_kwh: number; interval_minutes: 15 }> = [];
  const start = new Date(`${dayIso}T00:00:00.000Z`);
  for (let i = 0; i < 96; i += 1) {
    out.push({
      timestamp: new Date(start.getTime() + i * 15 * 60 * 1000).toISOString(),
      consumption_kwh: kwhPerInterval,
      interval_minutes: 15,
    });
  }
  return out;
}

describe("dataset observability", () => {
  it("keeps interval projection logs compact", () => {
    logPipeline.mockClear();
    const curve: SimulatedCurve = {
      start: "2026-01-01",
      end: "2026-01-02",
      intervals: [...makeUtcDayIntervals("2026-01-01", 0.25), ...makeUtcDayIntervals("2026-01-02", 0.5)],
      monthlyTotals: [],
      annualTotalKwh: 72,
      meta: { excludedDays: 0, renormalized: false },
    };

    buildSimulatedUsageDatasetFromCurve(
      curve,
      {
        baseKind: "SMT_ACTUAL_BASELINE",
        mode: "MANUAL_TOTALS",
        canonicalEndMonth: "2026-01",
      },
      { correlationId: "cid-dataset-observability" }
    );

    const intervalProjectionLog = logPipeline.mock.calls.find(
      ([eventName]) => eventName === "stitch_dataset_interval_projection_success"
    )?.[1] as Record<string, unknown> | undefined;

    expect(intervalProjectionLog).toBeTruthy();
    expect(intervalProjectionLog).not.toHaveProperty("seriesIntervals15");
    expect(intervalProjectionLog).not.toHaveProperty("dailyMap");
    expect(intervalProjectionLog).toMatchObject({
      intervalCount: 192,
      seriesIntervals15Count: 192,
      dailyMapCount: 2,
      dailyKeyCount: 2,
      firstIntervalTimestamp: "2026-01-01T00:00:00.000Z",
      lastIntervalTimestamp: "2026-01-02T23:45:00.000Z",
    });
  });
});
