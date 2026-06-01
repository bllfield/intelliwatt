import { beforeEach, describe, expect, it, vi } from "vitest";

const greenButtonUploadDeleteMany = vi.fn();
const greenButtonIntervalDeleteMany = vi.fn();
const houseHasActiveGreenButtonUploadLock = vi.fn();
const isSmtHealScopeReady = vi.fn();
const loadSmtWindowDayStatus = vi.fn();
const resolveSmtPersistedCoverageSpan = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    houseAddress: {
      findUnique: vi.fn().mockResolvedValue({ userId: "user-1" }),
    },
    greenButtonUpload: {
      deleteMany: (...args: unknown[]) => greenButtonUploadDeleteMany(...args),
    },
    manualUsageUpload: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  },
}));

vi.mock("@/lib/db/usageClient", () => ({
  usagePrisma: {
    greenButtonInterval: {
      deleteMany: (...args: unknown[]) => greenButtonIntervalDeleteMany(...args),
    },
    rawGreenButton: {
      deleteMany: vi.fn(() => Promise.resolve({ count: 0 })),
    },
    homeMonthlyUsageBucket: {
      deleteMany: vi.fn(() => Promise.resolve({ count: 0 })),
    },
    homeDailyUsageBucket: {
      deleteMany: vi.fn(() => Promise.resolve({ count: 0 })),
    },
  },
}));

vi.mock("@/lib/usage/houseCommittedUsageSource", () => ({
  houseHasActiveGreenButtonUploadLock: (...args: unknown[]) => houseHasActiveGreenButtonUploadLock(...args),
}));

vi.mock("@/lib/usage/smtWindowStatus", () => ({
  loadSmtWindowDayStatus: (...args: unknown[]) => loadSmtWindowDayStatus(...args),
  resolveSmtPersistedCoverageSpan: (...args: unknown[]) => resolveSmtPersistedCoverageSpan(...args),
}));

vi.mock("@/lib/usage/smtTailCoverage", () => ({
  isSmtHealScopeReady: (...args: unknown[]) => isSmtHealScopeReady(...args),
}));

vi.mock("@/modules/usageSimulator/labTestHome", () => ({
  getOnePathLabTestHomeLink: vi.fn().mockResolvedValue(null),
}));

describe("clearGreenButtonSupersededBySmtForHouse", () => {
  beforeEach(() => {
    vi.resetModules();
    greenButtonUploadDeleteMany.mockClear();
    greenButtonIntervalDeleteMany.mockClear();
    greenButtonIntervalDeleteMany.mockResolvedValue({ count: 0 });
    houseHasActiveGreenButtonUploadLock.mockReset();
    isSmtHealScopeReady.mockReset();
    loadSmtWindowDayStatus.mockResolvedValue({ window: { endDate: "2026-05-18" } });
    resolveSmtPersistedCoverageSpan.mockResolvedValue(null);
    houseHasActiveGreenButtonUploadLock.mockResolvedValue(false);
    isSmtHealScopeReady.mockReturnValue(false);
    process.env.USAGE_DATABASE_URL = "postgres://usage";
  });

  it("does not delete GreenButtonUpload rows when superseding interval data", async () => {
    isSmtHealScopeReady.mockReturnValue(true);
    const { clearGreenButtonSupersededBySmtForHouse } = await import("@/lib/usage/greenButtonHouseCleanup");
    const cleared = await clearGreenButtonSupersededBySmtForHouse({
      houseId: "house-1",
      esiid: "esiid-1",
    });
    expect(cleared).toBe(true);
    expect(greenButtonIntervalDeleteMany).toHaveBeenCalled();
    expect(greenButtonUploadDeleteMany).not.toHaveBeenCalled();
  });

  it("skips supersede when the home has an active Green Button upload lock", async () => {
    houseHasActiveGreenButtonUploadLock.mockResolvedValue(true);
    isSmtHealScopeReady.mockReturnValue(true);
    const { clearGreenButtonSupersededBySmtForHouse } = await import("@/lib/usage/greenButtonHouseCleanup");
    const cleared = await clearGreenButtonSupersededBySmtForHouse({
      houseId: "house-1",
      esiid: "esiid-1",
    });
    expect(cleared).toBe(false);
    expect(greenButtonIntervalDeleteMany).not.toHaveBeenCalled();
    expect(greenButtonUploadDeleteMany).not.toHaveBeenCalled();
  });

  it("does not supersede when SMT heal scope is not ready", async () => {
    isSmtHealScopeReady.mockReturnValue(false);
    const { clearGreenButtonSupersededBySmtForHouse } = await import("@/lib/usage/greenButtonHouseCleanup");
    const cleared = await clearGreenButtonSupersededBySmtForHouse({
      houseId: "house-1",
      esiid: "esiid-1",
    });
    expect(cleared).toBe(false);
    expect(greenButtonIntervalDeleteMany).not.toHaveBeenCalled();
  });
});
