import { describe, expect, it } from "vitest";

import {
  resolveGreenButtonConnectionExpiresAt,
  resolveGreenButtonConnectionExpiresAtForUpload,
} from "@/lib/usage/awardGreenButtonUsageEntry";
import { GREEN_BUTTON_INTERVAL_INGEST_VERSION } from "@/lib/usage/greenButtonIngestContract";

describe("Green Button expiration", () => {
  it("expires at the end of the Chicago-local day of the last meter reading, not upload + 1 year", () => {
    const uploadCreatedAt = new Date("2026-05-20T18:00:00.000Z");
    const expiresAt = resolveGreenButtonConnectionExpiresAtForUpload({
      createdAt: uploadCreatedAt,
      parseMessage: JSON.stringify({
        intervalIngestVersion: GREEN_BUTTON_INTERVAL_INGEST_VERSION,
        dataAvailableEndDateKey: "2026-02-15",
      }),
    });

    expect(expiresAt.toLocaleDateString("en-US")).toBe("2/15/2026");
    expect(expiresAt.getTime()).toBeLessThan(uploadCreatedAt.getTime() + 365 * 24 * 60 * 60 * 1000);
  });

  it("uses coverageEnd when parse summary has no dataAvailableEndDateKey", () => {
    const coverageEnd = new Date("2026-02-15T12:00:00.000Z");
    const expiresAt = resolveGreenButtonConnectionExpiresAtForUpload({
      createdAt: new Date("2026-06-01T00:00:00.000Z"),
      parseMessage: null,
      coverageEnd,
    });
    expect(expiresAt.toLocaleDateString("en-US")).toBe("2/15/2026");
  });

  it("snaps anchor to Chicago end-of-day", () => {
    const anchor = new Date("2026-02-15T06:30:00.000Z");
    const expiresAt = resolveGreenButtonConnectionExpiresAt(anchor);
    expect(expiresAt.toLocaleDateString("en-US")).toBe("2/15/2026");
    expect(expiresAt.getTime()).toBeGreaterThan(anchor.getTime());
  });
});
