import { beforeEach, describe, expect, it, vi } from "vitest";

const smtFindUnique = vi.fn();
const smtCreate = vi.fn();
const smtUpdate = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    smtInterval: {
      findUnique: (...args: any[]) => smtFindUnique(...args),
      create: (...args: any[]) => smtCreate(...args),
      update: (...args: any[]) => smtUpdate(...args),
    },
  },
}));

const normalizeSmtTo15Min = vi.fn();
vi.mock("@/lib/analysis/normalizeSmt", () => ({
  normalizeSmtTo15Min: (...args: any[]) => normalizeSmtTo15Min(...args),
}));

import { normalizeAndPersistSmtIntervals, persistNormalizedSmtPoints } from "@/lib/usage/normalizeSmtIntervals";

describe("normalizeSmtIntervals shared module", () => {
  beforeEach(() => {
    smtFindUnique.mockReset();
    smtCreate.mockReset();
    smtUpdate.mockReset();
    normalizeSmtTo15Min.mockReset();
  });

  it("protects existing real rows from filled overwrite", async () => {
    smtFindUnique.mockResolvedValueOnce({ filled: false, source: "smt" });

    const out = await persistNormalizedSmtPoints({
      points: [
        {
          esiid: "104",
          meter: "M1",
          ts: "2026-03-10T06:00:00.000Z",
          kwh: 0,
          filled: true,
          source: "smt",
        },
      ],
    });

    expect(out.persisted).toBe(0);
    expect(out.skippedRealProtected).toBe(1);
    expect(smtUpdate).not.toHaveBeenCalled();
    expect(smtCreate).not.toHaveBeenCalled();
  });

  it("normalizes then persists with local-date filter", async () => {
    normalizeSmtTo15Min.mockReturnValue([
      { ts: "2026-03-10T04:45:00.000Z", kwh: 1, filled: false }, // 2026-03-09 in Chicago
      { ts: "2026-03-10T06:15:00.000Z", kwh: 2, filled: false }, // 2026-03-10 in Chicago
    ]);
    smtFindUnique.mockResolvedValue(null);
    smtCreate.mockResolvedValue({});

    const out = await normalizeAndPersistSmtIntervals({
      rows: [{ esiid: "104", meter: "M1", timestamp: "2026-03-10T06:30:00.000Z", kwh: 2 }],
      esiid: "104",
      meter: "M1",
      filterLocalDate: { date: "2026-03-10", timezone: "America/Chicago" },
      source: "smt",
    });

    expect(out.normalizedPoints).toBe(2);
    expect(out.consideredPoints).toBe(1);
    expect(out.persisted).toBe(1);
    expect(smtCreate).toHaveBeenCalledTimes(1);
  });
});
