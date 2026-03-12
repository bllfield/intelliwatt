import { beforeEach, describe, expect, it, vi } from "vitest";

const requireVercelCron = vi.fn();
const computeDailySummaries = vi.fn();
const loadSmtRawRows = vi.fn();
const normalizeAndPersistSmtIntervals = vi.fn();

vi.mock("@/lib/auth/cron", () => ({
  requireVercelCron: (...args: any[]) => requireVercelCron(...args),
}));

vi.mock("@/lib/analysis/dailySummary", () => ({
  computeDailySummaries: (...args: any[]) => computeDailySummaries(...args),
}));

vi.mock("@/lib/usage/normalizeSmtIntervals", () => ({
  RAW_MODEL_CANDIDATES: ["rawSmtRow"],
  loadSmtRawRows: (...args: any[]) => loadSmtRawRows(...args),
  normalizeAndPersistSmtIntervals: (...args: any[]) => normalizeAndPersistSmtIntervals(...args),
}));

import { POST } from "@/app/api/admin/cron/normalize-smt-catch/route";

describe("admin cron normalize-smt-catch route", () => {
  beforeEach(() => {
    requireVercelCron.mockReset();
    computeDailySummaries.mockReset();
    loadSmtRawRows.mockReset();
    normalizeAndPersistSmtIntervals.mockReset();

    requireVercelCron.mockReturnValue(null);
  });

  it("uses shared normalize/persist flow for missing days", async () => {
    computeDailySummaries.mockResolvedValue([
      { date: "2026-03-10", esiid: "104", meter: "M1", has_missing: true },
    ]);
    loadSmtRawRows.mockResolvedValue({
      modelName: "dynamic_raw_model",
      rows: [{ esiid: "104", meter: "M1", timestamp: "2026-03-10T12:00:00.000Z", kwh: 1 }],
    });
    normalizeAndPersistSmtIntervals.mockResolvedValue({
      processedRows: 1,
      normalizedPoints: 1,
      consideredPoints: 1,
      persisted: 1,
      skippedNoIdentifiers: 0,
      skippedSaveFilled: 0,
      skippedRealProtected: 0,
      sample: [],
    });

    const res = await POST({} as any);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(loadSmtRawRows).toHaveBeenCalledTimes(1);
    expect(normalizeAndPersistSmtIntervals).toHaveBeenCalledTimes(1);
    expect(body.ok).toBe(true);
    expect(body.processed).toBe(1);
  });
});
