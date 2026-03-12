import { beforeEach, describe, expect, it, vi } from "vitest";

const requireSharedSecret = vi.fn();
const loadSmtRawRows = vi.fn();
const normalizeAndPersistSmtIntervals = vi.fn();

vi.mock("@/lib/auth/shared", () => ({
  requireSharedSecret: (...args: any[]) => requireSharedSecret(...args),
}));

vi.mock("@/lib/usage/normalizeSmtIntervals", () => ({
  RAW_MODEL_CANDIDATES: ["rawSmtRow"],
  loadSmtRawRows: (...args: any[]) => loadSmtRawRows(...args),
  normalizeAndPersistSmtIntervals: (...args: any[]) => normalizeAndPersistSmtIntervals(...args),
}));

import { POST } from "@/app/api/internal/smt/ingest-normalize/route";

describe("internal SMT ingest-normalize route", () => {
  beforeEach(() => {
    requireSharedSecret.mockReset();
    loadSmtRawRows.mockReset();
    normalizeAndPersistSmtIntervals.mockReset();
    requireSharedSecret.mockReturnValue(null);
  });

  it("uses shared normalize/persist module", async () => {
    loadSmtRawRows.mockResolvedValue({
      modelName: "dynamic_raw_model",
      rows: [{ esiid: "104", meter: "M1", timestamp: "2026-03-10T06:15:00.000Z", kwh: 1.2 }],
    });
    normalizeAndPersistSmtIntervals.mockResolvedValue({
      processedRows: 1,
      normalizedPoints: 1,
      consideredPoints: 1,
      persisted: 1,
      skippedNoIdentifiers: 0,
      skippedSaveFilled: 0,
      skippedRealProtected: 0,
      sample: [{ ts: "2026-03-10T06:00:00.000Z", kwh: 1.2, filled: false, esiid: "104", meter: "M1", source: "smt" }],
    });

    const res = await POST({
      json: async () => ({ esiid: "104", meter: "M1", debug: true }),
    } as any);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(loadSmtRawRows).toHaveBeenCalledTimes(1);
    expect(normalizeAndPersistSmtIntervals).toHaveBeenCalledTimes(1);
    expect(body.ok).toBe(true);
    expect(body.persisted).toBe(1);
  });
});
