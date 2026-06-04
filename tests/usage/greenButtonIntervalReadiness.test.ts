import { describe, expect, it, vi, beforeEach } from "vitest";

import {
  GREEN_BUTTON_INTERVAL_INGEST_VERSION,
  isGreenButtonIntervalIngestCurrent,
} from "@/lib/usage/greenButtonIngestContract";

const getLatestUsableRawGreenButtonIdForHouse = vi.fn();
const greenButtonUploadFindFirst = vi.fn();

vi.mock("@/modules/realUsageAdapter/greenButton", () => ({
  getLatestUsableRawGreenButtonIdForHouse: (...args: unknown[]) =>
    getLatestUsableRawGreenButtonIdForHouse(...args),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    greenButtonUpload: {
      findFirst: (...args: unknown[]) => greenButtonUploadFindFirst(...args),
    },
  },
}));

describe("greenButtonIntervalReadiness", () => {
  beforeEach(() => {
    getLatestUsableRawGreenButtonIdForHouse.mockReset();
    greenButtonUploadFindFirst.mockReset();
  });

  it("treats parse summary with current ingest version as ready", () => {
    const msg = JSON.stringify({ intervalIngestVersion: GREEN_BUTTON_INTERVAL_INGEST_VERSION });
    expect(isGreenButtonIntervalIngestCurrent(msg)).toBe(true);
  });

  it("treats legacy uploads without ingest version as stale", () => {
    const msg = JSON.stringify({ normalizedIntervals: 1000, totalKwh: 12 });
    expect(isGreenButtonIntervalIngestCurrent(msg)).toBe(false);
  });

  it("resolveGreenButtonIntervalIngestReadiness fails closed on stale ingest", async () => {
    getLatestUsableRawGreenButtonIdForHouse.mockResolvedValue("raw-1");
    greenButtonUploadFindFirst.mockResolvedValue({
      parseStatus: "complete",
      parseMessage: JSON.stringify({ normalizedIntervals: 500 }),
    });

    const { resolveGreenButtonIntervalIngestReadiness } = await import(
      "@/lib/usage/greenButtonIntervalReadiness"
    );
    const result = await resolveGreenButtonIntervalIngestReadiness("house-1");
    expect(result.ready).toBe(false);
    if (result.ready) return;
    expect(result.reason).toBe("ingest_stale");
  });

  it("resolveGreenButtonIntervalIngestReadiness passes when ingest version matches", async () => {
    getLatestUsableRawGreenButtonIdForHouse.mockResolvedValue("raw-1");
    greenButtonUploadFindFirst.mockResolvedValue({
      parseStatus: "complete",
      parseMessage: JSON.stringify({
        intervalIngestVersion: GREEN_BUTTON_INTERVAL_INGEST_VERSION,
      }),
    });

    const { resolveGreenButtonIntervalIngestReadiness } = await import(
      "@/lib/usage/greenButtonIntervalReadiness"
    );
    const result = await resolveGreenButtonIntervalIngestReadiness("house-1");
    expect(result.ready).toBe(true);
    if (!result.ready) return;
    expect(result.rawId).toBe("raw-1");
  });
});
