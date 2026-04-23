import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const rawGreenButtonFindFirst = vi.fn();
const usageQueryRaw = vi.fn();

vi.mock("@/lib/db/usageClient", () => ({
  usagePrisma: {
    rawGreenButton: {
      findFirst: (...args: any[]) => rawGreenButtonFindFirst(...args),
    },
    $queryRaw: (...args: any[]) => usageQueryRaw(...args),
  },
}));

describe("green button full-day anchor", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("USAGE_DATABASE_URL", "postgres://example.test/db");
    rawGreenButtonFindFirst.mockReset();
    usageQueryRaw.mockReset();
    rawGreenButtonFindFirst.mockResolvedValue({ id: "raw-1" });
  });

  it("uses the latest complete Chicago day instead of an incomplete latest upload day", async () => {
    usageQueryRaw.mockResolvedValue([
      { bucket: new Date("2026-04-21T05:00:00.000Z"), intervalscount: 40 },
      { bucket: new Date("2026-04-20T05:00:00.000Z"), intervalscount: 96 },
    ]);

    const mod = await import("@/modules/realUsageAdapter/greenButton");
    const out = await mod.getLatestGreenButtonFullDayDateKey({ houseId: "house-1" });

    expect(out).toBe("2026-04-20");
  });

  it("accepts DST-short days when the interval count matches the expected local-day coverage", async () => {
    usageQueryRaw.mockResolvedValue([{ bucket: new Date("2026-03-08T06:00:00.000Z"), intervalscount: 92 }]);

    const mod = await import("@/modules/realUsageAdapter/greenButton");
    const out = await mod.getLatestGreenButtonFullDayDateKey({ houseId: "house-1" });

    expect(out).toBe("2026-03-08");
  });
});
