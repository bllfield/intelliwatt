import { describe, expect, it } from "vitest";
import { resolveManualReadbackPollPlan } from "@/modules/manualUsage/readbackPolling";

describe("resolveManualReadbackPollPlan", () => {
  it("polls for inline manual recalc when readback is deferred and uses the exact artifact hash", () => {
    expect(
      resolveManualReadbackPollPlan({
        ok: true,
        executionMode: "inline",
        readbackPending: true,
        correlationId: "cid-inline",
        result: { canonicalArtifactInputHash: "hash-inline" },
      })
    ).toEqual({
      shouldPoll: true,
      exactArtifactInputHash: "hash-inline",
      requireExactArtifactMatch: true,
      correlationId: "cid-inline",
    });
  });

  it("polls for droplet manual recalc and keeps correlation identity even before artifact hash is known", () => {
    expect(
      resolveManualReadbackPollPlan({
        ok: true,
        executionMode: "droplet_async",
        readbackPending: true,
        correlationId: "cid-async",
        jobId: "job-1",
      } as any)
    ).toEqual({
      shouldPoll: true,
      exactArtifactInputHash: null,
      requireExactArtifactMatch: false,
      correlationId: "cid-async",
    });
  });

  it("does not poll once a readback payload is already attached", () => {
    expect(
      resolveManualReadbackPollPlan({
        ok: true,
        executionMode: "inline",
        readbackPending: false,
        correlationId: "cid-ready",
      })
    ).toEqual({
      shouldPoll: false,
      exactArtifactInputHash: null,
      requireExactArtifactMatch: false,
      correlationId: "cid-ready",
    });
  });
});
