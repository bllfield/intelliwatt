import { beforeEach, describe, expect, it, vi } from "vitest";

import { IntervalSeriesKind } from "@/modules/usageSimulator/kinds";

type SeriesRow = {
  id: string;
  userId: string;
  houseId: string;
  kind: IntervalSeriesKind;
  scenarioId: string | null;
  anchorStartUtc: Date;
  anchorEndUtc: Date;
  derivationVersion: string;
  buildInputsHash: string;
  updatedAt: Date;
};

type PointRow = { seriesId: string; tsUtc: Date; kwh: string };

const mockState = vi.hoisted(() => {
  let seriesRows: SeriesRow[] = [];
  let pointRows: PointRow[] = [];
  let seriesCounter = 0;

  function matchSeries(where: any, row: SeriesRow): boolean {
    if (where?.id != null && String(where.id) !== row.id) return false;
    if (where?.userId != null && String(where.userId) !== row.userId) return false;
    if (where?.houseId != null && String(where.houseId) !== row.houseId) return false;
    if (where?.kind != null && String(where.kind) !== row.kind) return false;
    if (Object.prototype.hasOwnProperty.call(where ?? {}, "scenarioId")) {
      const want = where.scenarioId == null ? null : String(where.scenarioId);
      if ((row.scenarioId == null ? null : String(row.scenarioId)) !== want) return false;
    }
    return true;
  }

  const txMock = {
    intervalSeries: {
      findFirst: vi.fn(async ({ where, select }: any) => {
        const row = seriesRows.find((r) => matchSeries(where, r)) ?? null;
        if (!row) return null;
        if (select?.id) return { id: row.id };
        return row;
      }),
      create: vi.fn(async ({ data, select }: any) => {
        seriesCounter += 1;
        const row: SeriesRow = {
          id: `series-${seriesCounter}`,
          userId: String(data.userId),
          houseId: String(data.houseId),
          kind: data.kind,
          scenarioId: data.scenarioId == null ? null : String(data.scenarioId),
          anchorStartUtc: new Date(data.anchorStartUtc),
          anchorEndUtc: new Date(data.anchorEndUtc),
          derivationVersion: String(data.derivationVersion),
          buildInputsHash: String(data.buildInputsHash),
          updatedAt: new Date(),
        };
        seriesRows.push(row);
        if (select?.id) return { id: row.id };
        return row;
      }),
      update: vi.fn(async ({ where, data, select }: any) => {
        const idx = seriesRows.findIndex((r) => r.id === String(where.id));
        if (idx < 0) throw new Error("series not found");
        seriesRows[idx] = {
          ...seriesRows[idx],
          userId: String(data.userId),
          houseId: String(data.houseId),
          kind: data.kind,
          scenarioId: data.scenarioId == null ? null : String(data.scenarioId),
          anchorStartUtc: new Date(data.anchorStartUtc),
          anchorEndUtc: new Date(data.anchorEndUtc),
          derivationVersion: String(data.derivationVersion),
          buildInputsHash: String(data.buildInputsHash),
          updatedAt: new Date(),
        };
        if (select?.id) return { id: seriesRows[idx].id };
        return seriesRows[idx];
      }),
    },
    intervalPoint15m: {
      deleteMany: vi.fn(async ({ where }: any) => {
        const before = pointRows.length;
        pointRows = pointRows.filter((r) => r.seriesId !== String(where.seriesId));
        return { count: before - pointRows.length };
      }),
      createMany: vi.fn(async ({ data }: any) => {
        for (const row of data ?? []) {
          pointRows.push({
            seriesId: String(row.seriesId),
            tsUtc: new Date(row.tsUtc),
            kwh: String(row.kwh),
          });
        }
        return { count: Array.isArray(data) ? data.length : 0 };
      }),
    },
  };

  const prismaMock = {
    $transaction: vi.fn(async (fn: any) => fn(txMock)),
    intervalSeries: {
      findFirst: vi.fn(async ({ where }: any) => {
        const row = seriesRows.find((r) => matchSeries(where, r)) ?? null;
        if (!row) return null;
        const points = pointRows
          .filter((p) => p.seriesId === row.id)
          .sort((a, b) => a.tsUtc.getTime() - b.tsUtc.getTime())
          .map((p) => ({ tsUtc: p.tsUtc, kwh: p.kwh }));
        return {
          id: row.id,
          userId: row.userId,
          houseId: row.houseId,
          kind: row.kind,
          scenarioId: row.scenarioId,
          anchorStartUtc: row.anchorStartUtc,
          anchorEndUtc: row.anchorEndUtc,
          derivationVersion: row.derivationVersion,
          buildInputsHash: row.buildInputsHash,
          updatedAt: row.updatedAt,
          points,
        };
      }),
    },
  };

  return {
    prismaMock,
    reset() {
      seriesRows = [];
      pointRows = [];
      seriesCounter = 0;
    },
    state() {
      return { seriesRows, pointRows };
    },
  };
});

vi.mock("@/lib/db", () => ({ prisma: mockState.prismaMock }));

import { getIntervalSeries15m, saveIntervalSeries15m } from "@/modules/usageSimulator/intervalSeriesRepo";

function makeIntervals(startIso: string, count: number, kwh = 0.25) {
  const out: Array<{ tsUtc: string; kwh: number }> = [];
  const start = new Date(startIso);
  for (let i = 0; i < count; i++) {
    out.push({
      tsUtc: new Date(start.getTime() + i * 15 * 60 * 1000).toISOString(),
      kwh,
    });
  }
  return out;
}

describe("intervalSeriesRepo", () => {
  beforeEach(() => {
    mockState.reset();
  });

  it("saves and reads back an ordered 15-minute roundtrip", async () => {
    const userId = "user-1";
    const houseId = "house-1";
    const intervals = makeIntervals("2026-01-01T00:00:00.000Z", 192, 0.5);

    const saved = await saveIntervalSeries15m({
      userId,
      houseId,
      kind: IntervalSeriesKind.PAST_SIM_BASELINE,
      scenarioId: null,
      anchorStartUtc: new Date(intervals[0].tsUtc),
      anchorEndUtc: new Date(intervals[intervals.length - 1].tsUtc),
      derivationVersion: "v1",
      buildInputsHash: "hash-a",
      intervals15: intervals,
    });

    expect(saved.seriesId).toBe("series-1");

    const read = await getIntervalSeries15m({
      userId,
      houseId,
      kind: IntervalSeriesKind.PAST_SIM_BASELINE,
      scenarioId: null,
    });
    expect(read).not.toBeNull();
    expect(read?.points.length).toBe(192);
    expect(read?.points[0].tsUtc.toISOString()).toBe(intervals[0].tsUtc);
    expect(read?.points[191].tsUtc.toISOString()).toBe(intervals[191].tsUtc);
    expect(read?.points[0].kwh).toBe("0.500000");
  });

  it("replaces points on repeated save for the same key", async () => {
    const userId = "user-1";
    const houseId = "house-1";
    const intervalsA = makeIntervals("2026-01-01T00:00:00.000Z", 192, 0.1);
    const intervalsB = makeIntervals("2026-01-01T00:00:00.000Z", 192, 0.9);

    await saveIntervalSeries15m({
      userId,
      houseId,
      kind: IntervalSeriesKind.PAST_SIM_BASELINE,
      scenarioId: null,
      anchorStartUtc: new Date(intervalsA[0].tsUtc),
      anchorEndUtc: new Date(intervalsA[intervalsA.length - 1].tsUtc),
      derivationVersion: "v1",
      buildInputsHash: "hash-a",
      intervals15: intervalsA,
    });

    await saveIntervalSeries15m({
      userId,
      houseId,
      kind: IntervalSeriesKind.PAST_SIM_BASELINE,
      scenarioId: null,
      anchorStartUtc: new Date(intervalsB[0].tsUtc),
      anchorEndUtc: new Date(intervalsB[intervalsB.length - 1].tsUtc),
      derivationVersion: "v1",
      buildInputsHash: "hash-b",
      intervals15: intervalsB,
    });

    expect(mockState.state().seriesRows.length).toBe(1);
    const read = await getIntervalSeries15m({
      userId,
      houseId,
      kind: IntervalSeriesKind.PAST_SIM_BASELINE,
      scenarioId: null,
    });
    expect(read?.points.length).toBe(192);
    expect(read?.points[0].kwh).toBe("0.900000");
  });

  it("rejects off-grid timestamps", async () => {
    const userId = "user-1";
    const houseId = "house-1";
    const intervals = makeIntervals("2026-01-01T00:00:00.000Z", 191, 0.2);
    intervals.push({ tsUtc: "2026-01-02T23:07:00.000Z", kwh: 0.2 });

    await expect(
      saveIntervalSeries15m({
        userId,
        houseId,
        kind: IntervalSeriesKind.PAST_SIM_BASELINE,
        scenarioId: null,
        anchorStartUtc: new Date(intervals[0].tsUtc),
        anchorEndUtc: new Date(intervals[intervals.length - 1].tsUtc),
        derivationVersion: "v1",
        buildInputsHash: "hash-off-grid",
        intervals15: intervals,
      })
    ).rejects.toThrow("off-grid");
  });
});
