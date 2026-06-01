import { describe, expect, it } from "vitest";

import {
  isGreenButtonUsageIngestionProcessing,
  isGreenButtonUsageIngestionReady,
} from "@/lib/usage/greenButtonUploadStatus";

const baseUpload = {
  parseStatus: "complete",
  parseMessage: null,
  dateRangeStart: new Date("2025-01-01T00:00:00.000Z"),
  dateRangeEnd: new Date("2026-01-01T00:00:00.000Z"),
  createdAt: new Date("2026-01-15T12:00:00.000Z"),
  updatedAt: new Date("2026-01-15T12:05:00.000Z"),
};

describe("green button usage ingestion status", () => {
  it("is not ready until persisted intervals exist", () => {
    expect(isGreenButtonUsageIngestionReady(baseUpload, 0)).toBe(false);
    expect(isGreenButtonUsageIngestionProcessing(baseUpload, 0)).toBe(true);
    expect(isGreenButtonUsageIngestionReady(baseUpload, 120)).toBe(true);
    expect(isGreenButtonUsageIngestionProcessing(baseUpload, 120)).toBe(false);
  });

  it("treats parse processing as in-flight before intervals land", () => {
    expect(
      isGreenButtonUsageIngestionProcessing(
        {
          ...baseUpload,
          parseStatus: "processing",
          dateRangeStart: null,
          dateRangeEnd: null,
        },
        0
      )
    ).toBe(true);
  });
});
