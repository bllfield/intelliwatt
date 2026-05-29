import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const smtAuthorizationFindMany = vi.fn();
const getLatestUsableRawGreenButtonIdForHouse = vi.fn();
const hasSmtIntervalsInCanonicalWindow = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    houseAddress: {
      findFirst: vi.fn().mockResolvedValue({ esiid: "esiid-1" }),
    },
    smtAuthorization: {
      findMany: (...args: unknown[]) => smtAuthorizationFindMany(...args),
    },
  },
}));

vi.mock("@/modules/realUsageAdapter/greenButton", () => ({
  getLatestUsableRawGreenButtonIdForHouse: (...args: unknown[]) =>
    getLatestUsableRawGreenButtonIdForHouse(...args),
}));

vi.mock("@/lib/usage/smtCanonicalAvailability", () => ({
  hasSmtIntervalsInCanonicalWindow: (...args: unknown[]) => hasSmtIntervalsInCanonicalWindow(...args),
}));

describe("resolveHouseCommittedUsageSource", () => {
  beforeEach(() => {
    vi.resetModules();
    smtAuthorizationFindMany.mockReset();
    getLatestUsableRawGreenButtonIdForHouse.mockReset();
    hasSmtIntervalsInCanonicalWindow.mockReset();
    getLatestUsableRawGreenButtonIdForHouse.mockResolvedValue("raw-gb-1");
    hasSmtIntervalsInCanonicalWindow.mockResolvedValue(false);
  });

  it("uses Green Button when SMT authorization is active but canonical SMT intervals are not ready", async () => {
    smtAuthorizationFindMany.mockResolvedValue([
      { smtStatus: "ACTIVE", authorizationEndDate: null },
    ]);

    const { resolveHouseCommittedUsageSource } = await import("@/lib/usage/houseCommittedUsageSource");
    const source = await resolveHouseCommittedUsageSource({
      houseId: "house-1",
      userId: "user-1",
      esiid: "esiid-1",
    });

    expect(source).toBe("GREEN_BUTTON");
  });

  it("keeps SMT when authorization is active and canonical intervals exist", async () => {
    smtAuthorizationFindMany.mockResolvedValue([
      { smtStatus: "ACTIVE", authorizationEndDate: null },
    ]);
    hasSmtIntervalsInCanonicalWindow.mockResolvedValue(true);

    const { resolveHouseCommittedUsageSource } = await import("@/lib/usage/houseCommittedUsageSource");
    const source = await resolveHouseCommittedUsageSource({
      houseId: "house-1",
      userId: "user-1",
      esiid: "esiid-1",
    });

    expect(source).toBe("SMT");
  });
});
