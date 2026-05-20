import { describe, expect, it } from "vitest";
import {
  ACTUAL_SMT_SOURCE_DETAIL,
  annotateActualDailyWithSmtLedger,
  displayLabelForActualSmtSourceDetail,
  isSmtDayLedgerSettledForTail,
  SMT_DAY_LEDGER_STATUS,
  sourceDetailForSmtLedgerStatus,
} from "@/lib/usage/smtDayCoverageLedger";

describe("smt day coverage ledger helpers", () => {
  it("maps ledger statuses to actual daily source details", () => {
    expect(sourceDetailForSmtLedgerStatus(SMT_DAY_LEDGER_STATUS.PENDING_SMT)).toBe(
      ACTUAL_SMT_SOURCE_DETAIL.INTERVALS_NOT_AVAILABLE_YET
    );
    expect(sourceDetailForSmtLedgerStatus(SMT_DAY_LEDGER_STATUS.INCOMPLETE_METER)).toBe(
      ACTUAL_SMT_SOURCE_DETAIL.INCOMPLETE_METER
    );
    expect(sourceDetailForSmtLedgerStatus(SMT_DAY_LEDGER_STATUS.COMPLETE)).toBeUndefined();
  });

  it("provides user-facing labels for actual SMT source details", () => {
    expect(displayLabelForActualSmtSourceDetail(ACTUAL_SMT_SOURCE_DETAIL.INTERVALS_NOT_AVAILABLE_YET)).toBe(
      "Intervals not available yet"
    );
    expect(displayLabelForActualSmtSourceDetail(ACTUAL_SMT_SOURCE_DETAIL.INCOMPLETE_METER)).toBe(
      "Incomplete meter"
    );
  });

  it("treats pending and incomplete ledger statuses as tail-settled", () => {
    expect(isSmtDayLedgerSettledForTail(SMT_DAY_LEDGER_STATUS.PENDING_SMT)).toBe(true);
    expect(isSmtDayLedgerSettledForTail(SMT_DAY_LEDGER_STATUS.INCOMPLETE_METER)).toBe(true);
    expect(isSmtDayLedgerSettledForTail(SMT_DAY_LEDGER_STATUS.COMPLETE)).toBe(false);
    expect(isSmtDayLedgerSettledForTail(null)).toBe(false);
  });

  it("annotates daily rows from ledger snapshot", () => {
    const annotated = annotateActualDailyWithSmtLedger(
      [
        { date: "2026-05-16", kwh: 12 },
        { date: "2026-05-17", kwh: 8 },
      ],
      {
        canonicalEndDate: "2026-05-17",
        byDate: {
          "2026-05-16": SMT_DAY_LEDGER_STATUS.INCOMPLETE_METER,
          "2026-05-17": SMT_DAY_LEDGER_STATUS.PENDING_SMT,
        },
        pendingDateKeys: ["2026-05-17"],
        incompleteMeterDateKeys: ["2026-05-16"],
      }
    );
    expect(annotated[0]).toMatchObject({
      date: "2026-05-16",
      source: "ACTUAL",
      sourceDetail: ACTUAL_SMT_SOURCE_DETAIL.INCOMPLETE_METER,
    });
    expect(annotated[1]).toMatchObject({
      date: "2026-05-17",
      source: "ACTUAL",
      sourceDetail: ACTUAL_SMT_SOURCE_DETAIL.INTERVALS_NOT_AVAILABLE_YET,
    });
  });
});
