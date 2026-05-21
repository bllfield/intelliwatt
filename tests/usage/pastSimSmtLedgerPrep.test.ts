import { describe, expect, it } from "vitest";
import { filterLedgerIncompleteMeterDateKeysToSlotIncomplete } from "@/lib/usage/smtWindowStatus";

describe("pastSimSmtLedgerPrep slot filter (via smtWindowStatus)", () => {
  it("drops ledger incomplete-meter keys when day is slot-complete (DST fall-back)", () => {
    const dateKey = "2025-11-02";
    const filtered = filterLedgerIncompleteMeterDateKeysToSlotIncomplete({
      incompleteMeterDateKeys: [dateKey],
      byDate: {
        [dateKey]: {
          dateKey,
          isComplete: true,
          presentSlots: 96,
          requiredSlots: 96,
        },
      },
    });
    expect(filtered).toEqual([]);
  });
});
