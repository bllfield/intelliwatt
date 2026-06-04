import { describe, expect, it } from "vitest";

import { GREEN_BUTTON_INTERVAL_INGEST_VERSION } from "@/lib/usage/greenButtonIngestContract";
import {
  isGreenButtonUsageIngestionProcessing,
  isGreenButtonUsageIngestionReady,
} from "@/lib/usage/greenButtonUploadStatus";

const currentIngestParseMessage = JSON.stringify({
  intervalIngestVersion: GREEN_BUTTON_INTERVAL_INGEST_VERSION,
});

const baseUpload = {
  parseStatus: "complete",
  parseMessage: currentIngestParseMessage,
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
          parseMessage: null,
          dateRangeStart: null,
          dateRangeEnd: null,
        },
        0
      )
    ).toBe(true);
  });

  it("does not treat re-upload as ready while old intervals still exist", () => {
    const reupload = {
      ...baseUpload,
      parseStatus: "processing",
      parseMessage: null,
      dateRangeStart: new Date("2025-01-01T00:00:00.000Z"),
      dateRangeEnd: new Date("2026-01-01T00:00:00.000Z"),
    };
    expect(isGreenButtonUsageIngestionReady(reupload, 35040)).toBe(false);
    expect(isGreenButtonUsageIngestionProcessing(reupload, 35040)).toBe(true);
  });

  it("keeps stale complete uploads in processing until ingest version matches", () => {
    const stale = {
      ...baseUpload,
      parseMessage: JSON.stringify({ intervalIngestVersion: 1 }),
    };
    expect(isGreenButtonUsageIngestionReady(stale, 120)).toBe(false);
    expect(isGreenButtonUsageIngestionProcessing(stale, 120)).toBe(true);
  });
});
