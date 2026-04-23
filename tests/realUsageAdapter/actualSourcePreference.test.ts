import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const smtFindFirst = vi.fn();
const getLatestGreenButtonFullDayDateKey = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    smtInterval: {
      findFirst: (...args: any[]) => smtFindFirst(...args),
    },
  },
}));

vi.mock("@/modules/realUsageAdapter/greenButton", async () => {
  const actual = await vi.importActual("@/modules/realUsageAdapter/greenButton");
  return {
    ...actual,
    getLatestGreenButtonFullDayDateKey: (...args: any[]) => getLatestGreenButtonFullDayDateKey(...args),
  };
});

describe("actual usage source preference", () => {
  beforeEach(() => {
    vi.resetModules();
    smtFindFirst.mockReset();
    getLatestGreenButtonFullDayDateKey.mockReset();
  });

  it("prefers Green Button when requested even if SMT is newer", async () => {
    smtFindFirst.mockResolvedValue({ ts: new Date("2026-04-22T12:00:00.000Z") });
    getLatestGreenButtonFullDayDateKey.mockResolvedValue("2026-04-20");

    const mod = await import("@/modules/realUsageAdapter/actual");
    const out = await mod.chooseActualSource({
      houseId: "house-1",
      esiid: "esiid-1",
      preferredSource: "GREEN_BUTTON",
    });

    expect(out).toBe("GREEN_BUTTON");
  });

  it("falls back to the normal freshest-source chooser when the preferred source is unavailable", async () => {
    smtFindFirst.mockResolvedValue({ ts: new Date("2026-04-22T12:00:00.000Z") });
    getLatestGreenButtonFullDayDateKey.mockResolvedValue(null);

    const mod = await import("@/modules/realUsageAdapter/actual");
    const out = await mod.chooseActualSource({
      houseId: "house-1",
      esiid: "esiid-1",
      preferredSource: "GREEN_BUTTON",
    });

    expect(out).toBe("SMT");
  });
});
