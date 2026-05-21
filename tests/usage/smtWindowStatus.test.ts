import { afterEach, describe, expect, it, vi } from "vitest";

const { SMT_DAY_LEDGER_STATUS, loadSmtDayLedgerSnapshotMock } = vi.hoisted(() => ({
  SMT_DAY_LEDGER_STATUS: {
    COMPLETE: "COMPLETE",
    PENDING_SMT: "PENDING_SMT",
    INCOMPLETE_METER: "INCOMPLETE_METER",
  },
  loadSmtDayLedgerSnapshotMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    smtInterval: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/usage/smtDayCoverageLedger", () => ({
  SMT_DAY_LEDGER_STATUS,
  loadSmtDayLedgerSnapshot: loadSmtDayLedgerSnapshotMock,
}));

import { prisma } from "@/lib/db";
import {
  enumerateExpectedLocalSlotsForDate,
  localDayBoundsUtc,
  localSlotIndex,
  smtHomeIntervalCalendar,
} from "@/lib/time/homeIntervalCalendar";
import {
  filterLedgerIncompleteMeterDateKeysToSlotIncomplete,
  loadSmtWindowDayStatus,
  missingChicagoSlotsFromFilledSlots,
  resolveSmtCanonicalWindow,
  smtRequiredSlotsForDateKey,
  SMT_REQUIRED_SLOTS_PER_DAY,
  smtWindowCompletenessRatio,
} from "@/lib/usage/smtWindowStatus";

const findManyMock = vi.mocked(prisma.smtInterval.findMany);
const SMT_HOME = smtHomeIntervalCalendar();

function rowsForLocalDateSlots(dateKey: string, slotIndices: number[]): Array<{ ts: Date }> {
  const { startUtc, endUtcExclusive } = localDayBoundsUtc(dateKey, SMT_HOME);
  const out: Array<{ ts: Date }> = [];
  for (let ms = startUtc.getTime(); ms < endUtcExclusive.getTime(); ms += 15 * 60 * 1000) {
    const ts = new Date(ms);
    const slot = localSlotIndex(ts, SMT_HOME);
    if (!slotIndices.includes(slot)) continue;
    const tsKey = ts.toISOString();
    if (out.some((row) => row.ts.toISOString() === tsKey)) continue;
    out.push({ ts });
    if (out.length >= slotIndices.length) break;
  }
  return out;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("smtWindowStatus", () => {
  it("exports nominal 96 slots for a standard day", () => {
    expect(SMT_REQUIRED_SLOTS_PER_DAY).toBe(96);
    expect(smtRequiredSlotsForDateKey("2026-05-17")).toBe(96);
  });

  it("expects 92 slots on Chicago spring-forward day and 100 on fall-back", () => {
    expect(smtRequiredSlotsForDateKey("2026-03-08")).toBe(92);
    expect(enumerateExpectedLocalSlotsForDate("2026-03-08", SMT_HOME)).toHaveLength(92);
    expect(smtRequiredSlotsForDateKey("2025-11-02")).toBe(100);
    expect(enumerateExpectedLocalSlotsForDate("2025-11-02", SMT_HOME)).toHaveLength(100);
  });

  it("marks spring-forward day complete with 92 distinct local slots", async () => {
    const dateKey = "2026-03-08";
    const expectedSlots = enumerateExpectedLocalSlotsForDate(dateKey, SMT_HOME);
    findManyMock.mockResolvedValue(rowsForLocalDateSlots(dateKey, expectedSlots) as never);
    loadSmtDayLedgerSnapshotMock.mockResolvedValue({
      canonicalEndDate: dateKey,
      byDate: { [dateKey]: SMT_DAY_LEDGER_STATUS.INCOMPLETE_METER },
      pendingDateKeys: [],
      incompleteMeterDateKeys: [dateKey],
    });

    const status = await loadSmtWindowDayStatus({
      esiid: "10400511114390001",
      dateKeys: [dateKey],
      now: new Date("2026-03-12T12:00:00.000Z"),
    });

    expect(status.byDate[dateKey]?.requiredSlots).toBe(92);
    expect(status.byDate[dateKey]?.intervalCount).toBe(92);
    expect(status.byDate[dateKey]?.isComplete).toBe(true);
    expect(status.incompleteMeterDateKeys).not.toContain(dateKey);
  });

  it("drops slot-complete days from ledger incomplete-meter lists (DST fall-back)", () => {
    const dateKey = "2025-11-02";
    const filtered = filterLedgerIncompleteMeterDateKeysToSlotIncomplete({
      incompleteMeterDateKeys: [dateKey, "2025-11-03"],
      byDate: {
        [dateKey]: {
          dateKey,
          intervalCount: 96,
          distinctSlotCount: 96,
          slotCount: 96,
          requiredSlots: 100,
          missingSlots: [],
          ledgerStatus: SMT_DAY_LEDGER_STATUS.INCOMPLETE_METER,
          isComplete: true,
        },
        "2025-11-03": {
          dateKey: "2025-11-03",
          intervalCount: 80,
          distinctSlotCount: 80,
          slotCount: 80,
          requiredSlots: 96,
          missingSlots: [0],
          ledgerStatus: SMT_DAY_LEDGER_STATUS.INCOMPLETE_METER,
          isComplete: false,
        },
      },
    });
    expect(filtered).toEqual(["2025-11-03"]);
  });

  it("marks fall-back day complete at 96 SMT intervals when Luxon expects 100 periods", async () => {
    const dateKey = "2025-11-02";
    findManyMock.mockResolvedValue(
      rowsForLocalDateSlots(dateKey, Array.from({ length: 96 }, (_, i) => i)) as never,
    );
    loadSmtDayLedgerSnapshotMock.mockResolvedValue({
      canonicalEndDate: dateKey,
      byDate: { [dateKey]: SMT_DAY_LEDGER_STATUS.INCOMPLETE_METER },
      pendingDateKeys: [],
      incompleteMeterDateKeys: [dateKey],
    });

    const status = await loadSmtWindowDayStatus({
      esiid: "10400511114390001",
      dateKeys: [dateKey],
      now: new Date("2025-11-10T12:00:00.000Z"),
    });

    expect(status.byDate[dateKey]?.requiredSlots).toBe(100);
    expect(status.byDate[dateKey]?.intervalCount).toBe(96);
    expect(status.byDate[dateKey]?.isComplete).toBe(true);
    expect(status.incompleteMeterDateKeys).not.toContain(dateKey);
  });

  it("resolves canonical window from lib config + chicago calendar lag", () => {
    const win = resolveSmtCanonicalWindow(new Date("2026-03-12T12:00:00.000Z"));
    expect(win.endDate).toBe("2026-03-10");
    expect(win.startDate).toBe("2025-03-11");
  });

  it("marks isComplete only when slotCount meets DST-aware required slots", async () => {
    const window = resolveSmtCanonicalWindow(new Date("2026-05-20T12:00:00.000Z"));
    const dateKeys = [window.endDate];
    findManyMock.mockResolvedValue(
      rowsForLocalDateSlots(window.endDate, Array.from({ length: 95 }, (_, i) => i)) as never
    );
    loadSmtDayLedgerSnapshotMock.mockResolvedValue({
      canonicalEndDate: window.endDate,
      byDate: { [window.endDate]: SMT_DAY_LEDGER_STATUS.INCOMPLETE_METER },
      pendingDateKeys: [],
      incompleteMeterDateKeys: [window.endDate],
    });

    const status = await loadSmtWindowDayStatus({
      esiid: "10400511114390001",
      dateKeys,
      now: new Date("2026-05-20T12:00:00.000Z"),
    });

    expect(status.byDate[window.endDate]?.intervalCount).toBe(95);
    expect(status.byDate[window.endDate]?.requiredSlots).toBe(96);
    expect(status.byDate[window.endDate]?.isComplete).toBe(false);
    expect(status.incompleteDateKeys).toContain(window.endDate);
    expect(status.ready).toBe(false);
  });

  it("drops stale ledger pending keys when slots are already complete", async () => {
    const dateKey = "2026-05-17";
    findManyMock.mockResolvedValue(
      rowsForLocalDateSlots(dateKey, enumerateExpectedLocalSlotsForDate(dateKey, SMT_HOME)) as never
    );
    loadSmtDayLedgerSnapshotMock.mockResolvedValue({
      canonicalEndDate: dateKey,
      byDate: { [dateKey]: SMT_DAY_LEDGER_STATUS.PENDING_SMT },
      pendingDateKeys: [dateKey],
      incompleteMeterDateKeys: [],
    });

    const status = await loadSmtWindowDayStatus({
      esiid: "10400511114390001",
      dateKeys: [dateKey],
      now: new Date("2026-05-20T12:00:00.000Z"),
    });

    expect(status.ready).toBe(true);
    expect(status.pendingDateKeys).toEqual([]);
    expect(status.incompleteDateKeys).toEqual([]);
  });

  it("reports ready when every requested day has required slots", async () => {
    const dateKey = "2026-05-17";
    findManyMock.mockResolvedValue(
      rowsForLocalDateSlots(dateKey, enumerateExpectedLocalSlotsForDate(dateKey, SMT_HOME)) as never
    );
    loadSmtDayLedgerSnapshotMock.mockResolvedValue({
      canonicalEndDate: dateKey,
      byDate: { [dateKey]: SMT_DAY_LEDGER_STATUS.COMPLETE },
      pendingDateKeys: [],
      incompleteMeterDateKeys: [],
    });

    const status = await loadSmtWindowDayStatus({
      esiid: "10400511114390001",
      dateKeys: [dateKey],
      now: new Date("2026-05-20T12:00:00.000Z"),
    });

    expect(status.byDate[dateKey]?.intervalCount).toBe(96);
    expect(status.byDate[dateKey]?.isComplete).toBe(true);
    expect(status.ready).toBe(true);
    expect(smtWindowCompletenessRatio(status)).toBe(1);
  });

  it("lists missing slots for incomplete standard days", () => {
    const dateKey = "2026-05-17";
    expect(missingChicagoSlotsFromFilledSlots(new Set([0, 2]), dateKey).length).toBe(94);
    expect(missingChicagoSlotsFromFilledSlots(new Set([0, 2]), dateKey)).not.toContain(0);
    expect(missingChicagoSlotsFromFilledSlots(new Set([0, 2]), dateKey)).not.toContain(2);
  });
});
