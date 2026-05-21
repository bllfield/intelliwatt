import { describe, expect, it } from "vitest";
import { resolveSmtUserProcessingStage } from "@/lib/usage/smtUserProcessingStage";

describe("resolveSmtUserProcessingStage", () => {
  it("marks ~100% coverage with raw backlog as ingest_complete", () => {
    expect(
      resolveSmtUserProcessingStage({
        intervalCount: 37_000,
        rawCount: 3,
        windowReady: false,
        completenessRatio: 0.995,
        coverageDays: 387,
      }),
    ).toBe("ingest_complete");
  });

  it("marks substantial persisted span as ingest_complete at 90%+ window completeness", () => {
    expect(
      resolveSmtUserProcessingStage({
        intervalCount: 40_000,
        rawCount: 2,
        windowReady: false,
        completenessRatio: 0.92,
        coverageDays: 387,
      }),
    ).toBe("ingest_complete");
  });

  it("keeps ingesting when raw files remain and completeness is low", () => {
    expect(
      resolveSmtUserProcessingStage({
        intervalCount: 500,
        rawCount: 2,
        windowReady: false,
        completenessRatio: 0.4,
      }),
    ).toBe("ingesting");
  });

  it("returns ready when window is complete and no raw files", () => {
    expect(
      resolveSmtUserProcessingStage({
        intervalCount: 40_000,
        rawCount: 0,
        windowReady: true,
        completenessRatio: 1,
      }),
    ).toBe("ready");
  });
});
