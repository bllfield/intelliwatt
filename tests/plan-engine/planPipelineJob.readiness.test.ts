import { describe, expect, it } from "vitest";

import { summarizePlanPipelineEstimateReadiness } from "@/lib/plan-engine/planPipelineJob";

describe("summarizePlanPipelineEstimateReadiness", () => {
  it("is incomplete until every mapped rate plan reaches a terminal estimate state", () => {
    const readiness = summarizePlanPipelineEstimateReadiness(
      {
        v: 1,
        homeId: "home_1",
        runId: "run_1",
        status: "DONE",
        reason: "plans_fallback",
        calcVersion: "v1",
        startedAt: new Date(0).toISOString(),
        finishedAt: new Date(1).toISOString(),
        counts: {
          ratePlanIdsCount: 3,
          ratePlansLoaded: 3,
          estimatesComputed: 1,
          estimatesAlreadyCached: 1,
        },
      },
      "v1",
    );

    expect(readiness.complete).toBe(false);
    expect(readiness.reason).toBe("PIPELINE_INCOMPLETE");
  });

  it("counts non-computable and missing-bucket plans as terminal", () => {
    const readiness = summarizePlanPipelineEstimateReadiness(
      {
        v: 1,
        homeId: "home_1",
        runId: "run_2",
        status: "DONE",
        reason: "plans_fallback",
        calcVersion: "v1",
        startedAt: new Date(0).toISOString(),
        finishedAt: new Date(1).toISOString(),
        counts: {
          ratePlanIdsCount: 4,
          ratePlansLoaded: 4,
          estimatesComputed: 1,
          estimatesAlreadyCached: 1,
          ratePlansDerivedNotComputable: 1,
          ratePlansMissingRequiredKeys: 1,
        },
      },
      "v1",
    );

    expect(readiness.complete).toBe(true);
    expect(readiness.reason).toBe("PIPELINE_COMPLETE");
  });

  it("requires the current estimate version", () => {
    const readiness = summarizePlanPipelineEstimateReadiness(
      {
        v: 1,
        homeId: "home_1",
        runId: "run_3",
        status: "DONE",
        reason: "plans_fallback",
        calcVersion: "old",
        startedAt: new Date(0).toISOString(),
        finishedAt: new Date(1).toISOString(),
        counts: {
          ratePlanIdsCount: 1,
          ratePlansLoaded: 1,
          estimatesComputed: 1,
        },
      },
      "new",
    );

    expect(readiness.complete).toBe(false);
    expect(readiness.reason).toBe("PIPELINE_VERSION_STALE");
  });
});
