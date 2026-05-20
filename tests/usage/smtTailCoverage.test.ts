import { describe, expect, it } from "vitest";
import { SMT_DAY_LEDGER_STATUS } from "@/lib/usage/smtDayCoverageLedger";
import {
  chicagoSlot96FromTs,
  filterDateKeysNearTargetEnd,
  isGreenButtonPrimaryDataset,
  isResolvedDatasetTailDisplayReady,
  missingChicagoSlotsFromFilledSlots,
  ONE_PATH_ADMIN_SMT_INCOMPLETE_METER_WAIT_TIMEOUT_MS,
  ONE_PATH_ADMIN_SMT_TAIL_WAIT_TIMEOUT_MS,
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
        tailCountsByDate: { "2026-05-17": 96 },
        targetEndDayLedgerStatus: null,
      })
    ).toBe(true);
    expect(
      smtTailRefreshNeeded({
        coverageEndDate: "2026-05-17",
        targetEndDate: "2026-05-17",
        tailCountsByDate: { "2026-05-17": 40 },
        targetEndDayLedgerStatus: null,
      })
    ).toBe(true);
    expect(
      smtTailRefreshNeeded({
        coverageEndDate: "2026-05-17",
        targetEndDate: "2026-05-17",
        tailCountsByDate: { "2026-05-16": 40, "2026-05-17": 96 },
        targetEndDayLedgerStatus: null,
      })
    ).toBe(false);
  });

  it("does not require refresh when canonical end is pending or settled incomplete in ledger", () => {
    expect(
      smtTailRefreshNeeded({
        coverageEndDate: "2026-05-17",
        targetEndDate: "2026-05-17",
        tailCountsByDate: { "2026-05-17": 40 },
        targetEndDayLedgerStatus: SMT_DAY_LEDGER_STATUS.PENDING_SMT,
      })
    ).toBe(false);
    expect(
      smtTailRefreshNeeded({
        coverageEndDate: "2026-05-17",
        targetEndDate: "2026-05-17",
        tailCountsByDate: { "2026-05-17": 40 },
        targetEndDayLedgerStatus: SMT_DAY_LEDGER_STATUS.INCOMPLETE_METER,
      })
    ).toBe(false);
  });

  it("does not require refresh when only mid-window tail days are partial", () => {
    expect(
      smtTailRefreshNeeded({
        coverageEndDate: "2026-05-17",
        targetEndDate: "2026-05-17",
        tailCountsByDate: { "2026-05-16": 40, "2026-05-17": 96 },
        targetEndDayLedgerStatus: null,
      })
    ).toBe(false);
  });

  it("limits incomplete-meter backfill waits to days near canonical end", () => {
    expect(
      filterDateKeysNearTargetEnd(
        ["2025-07-09", "2026-03-25", "2026-05-16", "2026-05-17"],
        "2026-05-17",
        3
      )
    ).toEqual(["2026-05-16", "2026-05-17"]);
  });

  it("allows a longer admin wait after targeted incomplete-meter backfill", () => {
    expect(ONE_PATH_ADMIN_SMT_INCOMPLETE_METER_WAIT_TIMEOUT_MS).toBeGreaterThan(
      ONE_PATH_ADMIN_SMT_TAIL_WAIT_TIMEOUT_MS
    );
  });

  it("maps Chicago 15-minute slots for completeness checks", () => {
    expect(chicagoSlot96FromTs(new Date("2026-05-17T05:00:00.000Z"))).toBe(0);
    expect(chicagoSlot96FromTs(new Date("2026-05-17T05:14:59.999Z"))).toBe(0);
    expect(missingChicagoSlotsFromFilledSlots(new Set([0, 2]))).toEqual(
      Array.from({ length: 96 }, (_, slot) => slot).filter((slot) => slot !== 0 && slot !== 2)
    );
  });
});
