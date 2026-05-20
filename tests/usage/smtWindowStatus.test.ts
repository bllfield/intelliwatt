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
import { chicagoSlot96FromTs, smtCoverageDateKey } from "@/lib/time/chicago";
import {
  loadSmtWindowDayStatus,
  missingChicagoSlotsFromFilledSlots,
  resolveSmtCanonicalWindow,
  SMT_REQUIRED_SLOTS_PER_DAY,
  smtWindowCompletenessRatio,
} from "@/lib/usage/smtWindowStatus";

const findManyMock = vi.mocked(prisma.smtInterval.findMany);

function rowsForChicagoDateSlots(dateKey: string, slots: number[]): Array<{ ts: Date }> {
  const startMs = new Date(`${dateKey}T00:00:00.000Z`).getTime();
  const out: Array<{ ts: Date }> = [];
  for (let t = startMs; t < startMs + 48 * 60 * 60 * 1000; t += 60_000) {
    const ts = new Date(t);
    if (smtCoverageDateKey(ts) !== dateKey) continue;
    const slot = chicagoSlot96FromTs(ts);
    if (slot == null || !slots.includes(slot)) continue;
    if (out.some((row) => chicagoSlot96FromTs(row.ts) === slot)) continue;
    out.push({ ts });
    if (out.length >= slots.length) break;
  }
  return out;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("smtWindowStatus", () => {
  it("exports strict 96 slots per day", () => {
    expect(SMT_REQUIRED_SLOTS_PER_DAY).toBe(96);
  });

  it("resolves canonical window from lib config + chicago calendar lag", () => {
    const win = resolveSmtCanonicalWindow(new Date("2026-03-12T12:00:00.000Z"));
    expect(win.endDate).toBe("2026-03-10");
    expect(win.startDate).toBe("2025-03-11");
  });

  it("marks isComplete only when slotCount === 96", async () => {
    const window = resolveSmtCanonicalWindow(new Date("2026-05-20T12:00:00.000Z"));
    const dateKeys = [window.endDate];
    findManyMock.mockResolvedValue(rowsForChicagoDateSlots(window.endDate, Array.from({ length: 95 }, (_, i) => i)) as never);
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

    expect(status.byDate[window.endDate]?.slotCount).toBe(95);
    expect(status.byDate[window.endDate]?.isComplete).toBe(false);
    expect(status.byDate[window.endDate]?.ledgerStatus).toBe(SMT_DAY_LEDGER_STATUS.INCOMPLETE_METER);
    expect(status.incompleteDateKeys).toContain(window.endDate);
    expect(status.ready).toBe(false);
  });

  it("drops stale ledger pending keys when slots are already 96/96", async () => {
    const dateKey = "2026-05-17";
    findManyMock.mockResolvedValue(
      rowsForChicagoDateSlots(dateKey, Array.from({ length: 96 }, (_, i) => i)) as never
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

  it("reports ready when every requested day has 96 slots", async () => {
    const dateKey = "2026-05-17";
    findManyMock.mockResolvedValue(
      rowsForChicagoDateSlots(dateKey, Array.from({ length: 96 }, (_, i) => i)) as never
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

    expect(status.byDate[dateKey]?.slotCount).toBe(96);
    expect(status.byDate[dateKey]?.isComplete).toBe(true);
    expect(status.ready).toBe(true);
    expect(smtWindowCompletenessRatio(status)).toBe(1);
  });

  it("lists missing slots for incomplete days", () => {
    expect(missingChicagoSlotsFromFilledSlots(new Set([0, 2]))).toEqual(
      Array.from({ length: 96 }, (_, slot) => slot).filter((slot) => slot !== 0 && slot !== 2)
    );
  });
});
