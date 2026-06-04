import { describe, expect, it } from "vitest";

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
      parseMessage: currentIngestParseMessage,
      dateRangeStart: new Date("2025-01-01T00:00:00.000Z"),
      dateRangeEnd: new Date("2026-01-01T00:00:00.000Z"),
      intervalMinutes: 15,
      fileName: "usage.xml",
      fileSizeBytes: 1000,
      persistedIntervalCount: 35040,
    });
    expect(status.label).toBe("ACTIVE");
    expect(status.message).toBe(GREEN_BUTTON_UPLOAD_COMPLETE_MESSAGE);
    expect(status.tone).toBe("success");
    expect(status.expiresAt?.getFullYear()).toBe(2027);
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
