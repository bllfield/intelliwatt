import { describe, expect, it } from "vitest";
import { SMT_DAY_LEDGER_STATUS } from "@/lib/usage/smtDayCoverageLedger";
import { chicagoSlot96FromTs } from "@/lib/time/chicago";
import { missingChicagoSlotsFromFilledSlots } from "@/lib/usage/smtWindowStatus";
import {
  filterDateKeysNearTargetEnd,
  filterDateKeysWithinCanonicalWindow,
  filterDateKeysWithinPersistedSpan,
  isSmtHealScopeReady,
  resolveSmtHealBackfillDateKeys,
  isGreenButtonPrimaryDataset,
  isResolvedDatasetTailDisplayReady,
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
          summary: { latest: "2026-05-17T23:45:00.000Z", end: "2026-05-19" },
        },
        "2026-05-17"
      )
    ).toBe(true);
    expect(
      isResolvedDatasetTailDisplayReady(
        {
          summary: { end: "2026-05-19" },
        },
        "2026-05-19"
      )
    ).toBe(false);
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

  it("limits near-end backfill clip to lookback days (legacy tail helper)", () => {
    expect(
      filterDateKeysNearTargetEnd(
        ["2025-07-09", "2026-03-25", "2026-05-16", "2026-05-17"],
        "2026-05-17",
        3
      )
    ).toEqual(["2026-05-16", "2026-05-17"]);
  });

  it("clips heal targets to persisted first/last SMT day", () => {
    expect(
      filterDateKeysWithinPersistedSpan(
        ["2025-01-01", "2026-03-25", "2026-05-16"],
        { startDate: "2026-03-01", endDate: "2026-05-17" }
      )
    ).toEqual(["2026-03-25", "2026-05-16"]);
  });

  it("treats heal scope not ready when persisted span has not reached canonical end", () => {
    expect(
      isSmtHealScopeReady(
        {
          window: { startDate: "2025-05-20", endDate: "2026-05-19" },
          dateKeys: [],
          byDate: {},
          completeDateKeys: ["2026-05-18"],
          incompleteDateKeys: [],
          pendingDateKeys: [],
          incompleteMeterDateKeys: [],
          canonicalEndDayComplete: false,
          ready: true,
        },
        { startDate: "2025-05-20", endDate: "2026-05-18" }
      )
    ).toBe(false);
  });

  it("treats heal scope ready when only pre-span canonical days are incomplete", () => {
    const healKeys = resolveSmtHealBackfillDateKeys({
      dayStatus: {
        window: { startDate: "2025-05-19", endDate: "2026-05-17" },
        dateKeys: [],
        byDate: {},
        completeDateKeys: ["2026-05-17"],
        incompleteDateKeys: ["2025-07-09", "2026-05-17"],
        pendingDateKeys: [],
        incompleteMeterDateKeys: [],
        canonicalEndDayComplete: true,
        ready: false,
      },
      persistedSpan: { startDate: "2026-03-01", endDate: "2026-05-17" },
    });
    expect(healKeys).toEqual(["2026-05-17"]);
    expect(
      isSmtHealScopeReady(
        {
          window: { startDate: "2025-05-19", endDate: "2026-05-17" },
          dateKeys: [],
          byDate: {},
          completeDateKeys: ["2026-05-17"],
          incompleteDateKeys: ["2025-07-09"],
          pendingDateKeys: [],
          incompleteMeterDateKeys: [],
          canonicalEndDayComplete: true,
          ready: false,
        },
        { startDate: "2026-03-01", endDate: "2026-05-17" }
      )
    ).toBe(true);
  });

  it("keeps all incomplete heal days inside the canonical window", () => {
    expect(
      filterDateKeysWithinCanonicalWindow(
        ["2025-07-09", "2026-03-25", "2026-05-16", "2026-05-17"],
        { startDate: "2026-01-01", endDate: "2026-05-17" }
      )
    ).toEqual(["2026-03-25", "2026-05-16", "2026-05-17"]);
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
