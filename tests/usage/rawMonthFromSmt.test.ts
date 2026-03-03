import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaQueryRaw = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => prismaQueryRaw(...args),
  },
}));

import { getRawMonthKwhFromSmt } from "@/lib/usage/rawMonthFromSmt";

describe("getRawMonthKwhFromSmt", () => {
  beforeEach(() => {
    prismaQueryRaw.mockReset();
  });

  it("returns null for invalid yearMonth", async () => {
    expect(await getRawMonthKwhFromSmt({ esiid: "123", yearMonth: "" })).toBeNull();
    expect(await getRawMonthKwhFromSmt({ esiid: "123", yearMonth: "2026" })).toBeNull();
    expect(await getRawMonthKwhFromSmt({ esiid: "123", yearMonth: "2026-13" })).toBeNull();
    expect(await getRawMonthKwhFromSmt({ esiid: "", yearMonth: "2026-02" })).toBeNull();
    expect(prismaQueryRaw).not.toHaveBeenCalled();
  });

  it("returns null when no rows for month", async () => {
    prismaQueryRaw.mockResolvedValue([]);
    expect(await getRawMonthKwhFromSmt({ esiid: "10443720001101972", yearMonth: "2026-02" })).toBeNull();
    expect(prismaQueryRaw).toHaveBeenCalledTimes(1);
  });

  it("returns ground-truth shape when DB has one month", async () => {
    prismaQueryRaw.mockResolvedValue([
      {
        month: "2026-02",
        importkwh: 1721.2,
        exportkwh: 0,
        netkwh: 1721.2,
        cnt: "2688",
      },
    ]);
    const result = await getRawMonthKwhFromSmt({ esiid: "10443720001101972", yearMonth: "2026-02" });
    expect(result).not.toBeNull();
    expect(result).toEqual({
      yearMonth: "2026-02",
      importKwh: 1721.2,
      exportKwh: 0,
      netKwh: 1721.2,
      intervalCount: 2688,
    });
    expect(prismaQueryRaw).toHaveBeenCalledTimes(1);
  });

  it("calls DB once for valid esiid and yearMonth", async () => {
    prismaQueryRaw.mockResolvedValue([{ month: "2026-02", importkwh: 100, exportkwh: 0, netkwh: 100, cnt: "96" }]);
    await getRawMonthKwhFromSmt({ esiid: "esiid", yearMonth: "2026-02" });
    expect(prismaQueryRaw).toHaveBeenCalledTimes(1);
  });
});
