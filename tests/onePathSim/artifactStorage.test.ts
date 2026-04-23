import { describe, expect, it } from "vitest";

import {
  buildPastArtifactDatasetJsonForStorage,
  compactLockboxPerDayTraceForArtifactStorage,
} from "@/modules/onePathSim/usageSimulator/artifactStorage";

describe("one path artifact storage compaction", () => {
  it("drops bulky donor-weight arrays while preserving per-day summary fields", () => {
    const out = compactLockboxPerDayTraceForArtifactStorage([
      {
        localDate: "2025-07-04",
        simulatedReasonCode: "TRAVEL_VACANT",
        dayClassification: "simulated",
        fallbackLevel: "weather_nearest_daytype",
        donorCandidatePoolSize: 42,
        selectedDonorLocalDates: ["2025-06-30", "bad-date"],
        selectedDonorWeights: [
          { localDate: "2025-06-30", weight: 0.5, distance: 1.2, dayKwh: 44 },
          { localDate: "2025-06-29", weight: 0.5, distance: 1.3, dayKwh: 43 },
        ],
        donorVarianceGuardrailTriggered: true,
        finalDayKwh: 39.5,
      },
    ]);

    expect(out).toEqual([
      expect.objectContaining({
        localDate: "2025-07-04",
        simulatedReasonCode: "TRAVEL_VACANT",
        dayClassification: "simulated",
        fallbackLevel: "weather_nearest_daytype",
        donorCandidatePoolSize: 42,
        selectedDonorLocalDates: ["2025-06-30"],
        donorVarianceGuardrailTriggered: true,
        finalDayKwh: 39.5,
      }),
    ]);
    expect(out[0]).not.toHaveProperty("selectedDonorWeights");
  });

  it("strips intervals from persisted dataset json and records compact trace metadata", () => {
    const out = buildPastArtifactDatasetJsonForStorage({
      dataset: {
        summary: { totalKwh: 100 },
        meta: {
          lockboxPerDayTrace: [
            {
              localDate: "2025-07-04",
              simulatedReasonCode: "TRAVEL_VACANT",
              selectedDonorWeights: [{ localDate: "2025-06-30", weight: 1, distance: 0, dayKwh: 10 }],
            },
          ],
        },
        series: {
          intervals15: [{ timestamp: "2025-07-04T00:00:00.000Z", kwh: 1 }],
          daily: [{ timestamp: "2025-07-04T00:00:00.000Z", kwh: 100 }],
        },
      },
      canonicalArtifactSimulatedDayTotalsByDate: { "2025-07-04": 100 },
    });

    expect(out.series).toMatchObject({
      intervals15: [],
      daily: [{ timestamp: "2025-07-04T00:00:00.000Z", kwh: 100 }],
    });
    expect(out.meta).toMatchObject({
      lockboxPerDayTraceCount: 1,
      lockboxPerDayTraceStorageMode: "compact_v1",
      canonicalArtifactSimulatedDayTotalsByDate: { "2025-07-04": 100 },
    });
    expect((out.meta as Record<string, unknown>).lockboxPerDayTrace).toEqual([
      expect.objectContaining({
        localDate: "2025-07-04",
        simulatedReasonCode: "TRAVEL_VACANT",
      }),
    ]);
    expect((out.meta as Record<string, unknown>).lockboxPerDayTrace).not.toEqual([
      expect.objectContaining({ selectedDonorWeights: expect.anything() }),
    ]);
  });
});
