import { beforeEach, describe, expect, it, vi } from "vitest";

const greenButtonUploadDeleteMany = vi.fn();
const greenButtonIntervalDeleteMany = vi.fn();

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

vi.mock("@/modules/usageSimulator/labTestHome", () => ({
  getOnePathLabTestHomeLink: vi.fn().mockResolvedValue(null),
}));

describe("clearGreenButtonUsageForHouse", () => {
  beforeEach(() => {
    vi.resetModules();
    greenButtonUploadDeleteMany.mockClear();
    greenButtonIntervalDeleteMany.mockClear();
    greenButtonIntervalDeleteMany.mockResolvedValue({ count: 0 });
    greenButtonUploadDeleteMany.mockResolvedValue({ count: 0 });
    process.env.USAGE_DATABASE_URL = "postgres://usage";
  });

  it("removes upload rows when clearing full Green Button usage", async () => {
    const { clearGreenButtonUsageForHouse } = await import("@/lib/usage/greenButtonHouseCleanup");
    await clearGreenButtonUsageForHouse("house-1");
    expect(greenButtonIntervalDeleteMany).toHaveBeenCalled();
    expect(greenButtonUploadDeleteMany).toHaveBeenCalled();
  });
});
