import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdmin = vi.fn();
const groupNormalize = vi.fn();
const persistNormalizedSmtPoints = vi.fn();

vi.mock("@/lib/auth/admin", () => ({
  requireAdmin: (...args: any[]) => requireAdmin(...args),
}));

vi.mock("@/lib/analysis/normalizeSmt", () => ({
  normalizeSmtTo15Min: vi.fn(),
  fillMissing15Min: vi.fn((p) => p),
  groupNormalize: (...args: any[]) => groupNormalize(...args),
  buildDailyCompleteness: vi.fn(() => ({ dates: {} })),
}));

vi.mock("@/lib/time/tz", () => ({
  TZ_BUILD_ID: "test-build",
}));

vi.mock("@/lib/usage/normalizeSmtIntervals", () => ({
  persistNormalizedSmtPoints: (...args: any[]) => persistNormalizedSmtPoints(...args),
}));

import { POST } from "@/app/api/admin/analysis/normalize-smt/route";

describe("admin analysis normalize-smt route", () => {
  beforeEach(() => {
    requireAdmin.mockReset();
    groupNormalize.mockReset();
    persistNormalizedSmtPoints.mockReset();

    requireAdmin.mockReturnValue({ ok: true, status: 200, body: {} });
  });

  it("save path persists via shared module", async () => {
    groupNormalize.mockReturnValue({
      totalCount: 1,
      groups: {
        "104|M1": {
          points: [{ ts: "2026-03-10T06:00:00.000Z", kwh: 1.5, filled: false }],
        },
      },
    });
    persistNormalizedSmtPoints.mockResolvedValue({
      persisted: 1,
      skippedNoIdentifiers: 0,
      skippedSaveFilled: 0,
      skippedRealProtected: 0,
    });

    const res = await POST({
      json: async () => ({
        rows: [{ esiid: "104", meter: "M1", timestamp: "2026-03-10T06:15:00.000Z", kwh: 1.5 }],
        groupBy: "esiid_meter",
        save: true,
      }),
    } as any);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(persistNormalizedSmtPoints).toHaveBeenCalledTimes(1);
    expect(body.save.persisted).toBe(1);
  });
});
