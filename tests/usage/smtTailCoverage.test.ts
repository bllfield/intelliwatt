import { describe, expect, it } from "vitest";
import {
  isGreenButtonPrimaryDataset,
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
