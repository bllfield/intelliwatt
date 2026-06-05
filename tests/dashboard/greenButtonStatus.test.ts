import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { deriveGreenButtonStatus } from "@/app/dashboard/api/statusHelpers";
import { GREEN_BUTTON_INTERVAL_INGEST_VERSION } from "@/lib/usage/greenButtonIngestContract";
import {
  GREEN_BUTTON_UPLOAD_COMPLETE_MESSAGE,
  GREEN_BUTTON_UPLOAD_PROCESSING_MESSAGE,
} from "@/lib/usage/greenButtonUserMessages";

const currentIngestParseMessage = JSON.stringify({
  intervalIngestVersion: GREEN_BUTTON_INTERVAL_INGEST_VERSION,
});

describe("deriveGreenButtonStatus", () => {
  const createdAt = new Date("2026-01-15T12:00:00.000Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-10T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows processing while parseStatus is processing", () => {
    const status = deriveGreenButtonStatus({
      id: "gb-1",
      createdAt,
      updatedAt: createdAt,
      parseStatus: "processing",
      parseMessage: null,
      dateRangeStart: null,
      dateRangeEnd: null,
      intervalMinutes: null,
      fileName: "usage.xml",
      fileSizeBytes: 1000,
    });
    expect(status.label).toBe("Processing");
    expect(status.message).toBe(GREEN_BUTTON_UPLOAD_PROCESSING_MESSAGE);
    expect(status.tone).toBe("warning");
  });

  it("shows ACTIVE with completion message when upload is ready", () => {
    const status = deriveGreenButtonStatus({
      id: "gb-1",
      createdAt,
      updatedAt: new Date("2026-01-15T12:05:00.000Z"),
      parseStatus: "complete",
      parseMessage: JSON.stringify({
        intervalIngestVersion: GREEN_BUTTON_INTERVAL_INGEST_VERSION,
        dataAvailableEndDateKey: "2026-02-15",
      }),
      dateRangeStart: new Date("2025-02-07T06:00:00.000Z"),
      dateRangeEnd: new Date("2026-02-07T05:59:59.999Z"),
      intervalMinutes: 15,
      fileName: "usage.xml",
      fileSizeBytes: 1000,
      persistedIntervalCount: 35040,
      meterDataEnd: new Date("2026-02-15T12:00:00.000Z"),
    });
    expect(status.label).toBe("ACTIVE");
    expect(status.message).toBe(GREEN_BUTTON_UPLOAD_COMPLETE_MESSAGE);
    expect(status.tone).toBe("success");
    expect(status.expiresAt?.toLocaleDateString("en-US")).toBe("2/15/2027");
  });

  it("shows meter data span when file readings start after the display window", () => {
    const status = deriveGreenButtonStatus({
      id: "gb-1",
      createdAt,
      updatedAt: new Date("2026-01-15T12:05:00.000Z"),
      parseStatus: "complete",
      parseMessage: JSON.stringify({
        intervalIngestVersion: GREEN_BUTTON_INTERVAL_INGEST_VERSION,
        displayWindowStartDateKey: "2025-02-07",
        displayWindowEndDateKey: "2026-02-06",
        dataAvailableStartDateKey: "2025-04-28",
        dataAvailableEndDateKey: "2026-02-15",
      }),
      dateRangeStart: new Date("2025-02-07T06:00:00.000Z"),
      dateRangeEnd: new Date("2026-02-07T05:59:59.999Z"),
      intervalMinutes: 15,
      fileName: "usage.xml",
      fileSizeBytes: 1000,
      persistedIntervalCount: 35040,
      meterDataEnd: new Date("2026-02-15T12:00:00.000Z"),
    });
    expect(status.detail).toContain("Meter data:");
    expect(status.detail).toContain("4/28/2025");
    expect(status.detail).toContain("2/15/2026");
    expect(status.expiresAt?.toLocaleDateString("en-US")).toBe("2/15/2027");
  });

  it("shows processing when old intervals exist during re-upload", () => {
    const status = deriveGreenButtonStatus({
      id: "gb-1",
      createdAt,
      updatedAt: new Date("2026-01-15T12:05:00.000Z"),
      parseStatus: "processing",
      parseMessage: null,
      dateRangeStart: new Date("2025-01-01T00:00:00.000Z"),
      dateRangeEnd: new Date("2026-01-01T00:00:00.000Z"),
      intervalMinutes: null,
      fileName: "usage.xml",
      fileSizeBytes: 1000,
      persistedIntervalCount: 35040,
    });
    expect(status.label).toBe("Processing");
    expect(status.message).toBe(GREEN_BUTTON_UPLOAD_PROCESSING_MESSAGE);
  });

  it("keeps processing when metadata is complete but intervals are not persisted yet", () => {
    const status = deriveGreenButtonStatus({
      id: "gb-1",
      createdAt,
      updatedAt: new Date("2026-01-15T12:05:00.000Z"),
      parseStatus: "complete",
      parseMessage: null,
      dateRangeStart: new Date("2025-01-01T00:00:00.000Z"),
      dateRangeEnd: new Date("2026-01-01T00:00:00.000Z"),
      intervalMinutes: 15,
      fileName: "usage.xml",
      fileSizeBytes: 1000,
      persistedIntervalCount: 0,
    });
    expect(status.label).toBe("Processing");
    expect(status.message).toBe(GREEN_BUTTON_UPLOAD_PROCESSING_MESSAGE);
    expect(status.tone).toBe("warning");
  });
});
