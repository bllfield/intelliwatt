import { describe, expect, it } from "vitest";
import {
  isGreenButtonPrimaryDataset,
  isResolvedDatasetTailDisplayReady,
  reconcileUsageIngestionWithDataset,
  smtTailRefreshNeeded,
} from "@/lib/usage/smtTailCoverage";

describe("smt tail coverage helpers", () => {
  it("detects green button primary datasets", () => {
    expect(
      isGreenButtonPrimaryDataset({
        summary: { source: "GREEN_BUTTON" },
        meta: {},
      })
    ).toBe(true);
    expect(
      isGreenButtonPrimaryDataset({
        summary: { source: "SMT" },
        meta: { actualSource: "GREEN_BUTTON" },
      })
    ).toBe(true);
    expect(
      isGreenButtonPrimaryDataset({
        summary: { source: "SMT" },
        meta: { actualSource: "SMT" },
      })
    ).toBe(false);
  });

  it("treats resolved usage datasets with latest coverage through target end as display-ready", () => {
    expect(
      isResolvedDatasetTailDisplayReady(
        {
          summary: { latest: "2026-05-17T23:45:00.000Z", end: "2026-05-17" },
        },
        "2026-05-17"
      )
    ).toBe(true);
    expect(
      reconcileUsageIngestionWithDataset({
        ingestion: {
          tailReady: false,
          targetEndDate: "2026-05-17",
          tailRefreshAttempted: true,
          tailRefreshReason: "refresh_requested",
          tailTimedOut: true,
          incompleteTailDateKeys: ["2026-05-17"],
          coverageEndDate: "2026-05-16",
        },
        dataset: {
          summary: { latest: "2026-05-17T23:45:00.000Z", end: "2026-05-17" },
          insights: {
            stitchedMonth: {
              mode: "PRIOR_YEAR_TAIL",
              yearMonth: "2026-05",
              haveDaysThrough: 16,
              missingDaysFrom: 17,
            },
          },
        },
        targetEndDate: "2026-05-17",
      })
    ).toMatchObject({
      tailReady: true,
      incompleteTailDateKeys: [],
    });
  });

  it("requires refresh when canonical tail day is incomplete", () => {
    expect(
      smtTailRefreshNeeded({
        coverageEndDate: "2026-05-16",
        targetEndDate: "2026-05-17",
        incompleteTailDateKeys: [],
      })
    ).toBe(true);
    expect(
      smtTailRefreshNeeded({
        coverageEndDate: "2026-05-17",
        targetEndDate: "2026-05-17",
        incompleteTailDateKeys: ["2026-05-17"],
      })
    ).toBe(true);
    expect(
      smtTailRefreshNeeded({
        coverageEndDate: "2026-05-17",
        targetEndDate: "2026-05-17",
        incompleteTailDateKeys: [],
      })
    ).toBe(false);
  });
});
