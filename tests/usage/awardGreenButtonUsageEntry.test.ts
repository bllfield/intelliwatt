import { describe, expect, it } from "vitest";

import {
  resolveGreenButtonConnectionExpiresAt,
  resolveGreenButtonConnectionExpiresAtForUpload,
} from "@/lib/usage/awardGreenButtonUsageEntry";
import { GREEN_BUTTON_INTERVAL_INGEST_VERSION } from "@/lib/usage/greenButtonIngestContract";

describe("Green Button expiration", () => {
  it("expires one calendar year after the newest meter date in the file, not at upload time", () => {
    const uploadCreatedAt = new Date("2026-05-20T18:00:00.000Z");
    const expiresAt = resolveGreenButtonConnectionExpiresAtForUpload({
      createdAt: uploadCreatedAt,
      parseMessage: JSON.stringify({
        intervalIngestVersion: GREEN_BUTTON_INTERVAL_INGEST_VERSION,
        dataAvailableEndDateKey: "2026-02-15",
      }),
    });

    expect(expiresAt.toLocaleDateString("en-US")).toBe("2/15/2027");
    expect(expiresAt.getTime()).toBeGreaterThan(uploadCreatedAt.getTime());
  });

  it("uses coverageEnd when parse summary has no dataAvailableEndDateKey", () => {
    const coverageEnd = new Date("2026-02-15T12:00:00.000Z");
    const expiresAt = resolveGreenButtonConnectionExpiresAtForUpload({
      createdAt: new Date("2026-06-01T00:00:00.000Z"),
      parseMessage: null,
      coverageEnd,
    });
    expect(expiresAt.toLocaleDateString("en-US")).toBe("2/15/2027");
  });

  it("anchors on Chicago end-of-day then adds one year", () => {
    const anchor = new Date("2026-02-15T06:30:00.000Z");
    const expiresAt = resolveGreenButtonConnectionExpiresAt(anchor);
    expect(expiresAt.toLocaleDateString("en-US")).toBe("2/15/2027");
    expect(expiresAt.getTime()).toBeGreaterThan(anchor.getTime());
  });
});
