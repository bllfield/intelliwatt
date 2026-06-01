import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const smtAuthorizationFindMany = vi.fn();
const getLatestUsableRawGreenButtonIdForHouse = vi.fn();
const loadSmtWindowDayStatus = vi.fn();
const resolveSmtPersistedCoverageSpan = vi.fn();
const isSmtHealScopeReady = vi.fn();

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

vi.mock("@/lib/usage/smtWindowStatus", () => ({
  loadSmtWindowDayStatus: (...args: unknown[]) => loadSmtWindowDayStatus(...args),
  resolveSmtPersistedCoverageSpan: (...args: unknown[]) => resolveSmtPersistedCoverageSpan(...args),
}));

vi.mock("@/lib/usage/smtTailCoverage", () => ({
  isSmtHealScopeReady: (...args: unknown[]) => isSmtHealScopeReady(...args),
}));

describe("resolveHouseCommittedUsageSource", () => {
  beforeEach(() => {
    vi.resetModules();
    smtAuthorizationFindMany.mockReset();
    getLatestUsableRawGreenButtonIdForHouse.mockReset();
    loadSmtWindowDayStatus.mockReset();
    resolveSmtPersistedCoverageSpan.mockReset();
    isSmtHealScopeReady.mockReset();
    getLatestUsableRawGreenButtonIdForHouse.mockResolvedValue("raw-gb-1");
    loadSmtWindowDayStatus.mockResolvedValue({ window: { endDate: "2026-05-18" } });
    resolveSmtPersistedCoverageSpan.mockResolvedValue(null);
    isSmtHealScopeReady.mockReturnValue(false);
  });

  it("uses Green Button when SMT authorization is active but heal scope is not ready", async () => {
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

  it("keeps SMT when authorization is active and heal scope is ready", async () => {
    smtAuthorizationFindMany.mockResolvedValue([
      { smtStatus: "ACTIVE", authorizationEndDate: null },
    ]);
    isSmtHealScopeReady.mockReturnValue(true);

    const { resolveHouseCommittedUsageSource } = await import("@/lib/usage/houseCommittedUsageSource");
    const source = await resolveHouseCommittedUsageSource({
      houseId: "house-1",
      userId: "user-1",
      esiid: "esiid-1",
    });

    expect(source).toBe("SMT");
  });

  it("uses Green Button when SMT authorization is active, GB exists, and the home has no ESIID", async () => {
    smtAuthorizationFindMany.mockResolvedValue([
      { smtStatus: "ACTIVE", authorizationEndDate: null },
    ]);

    const { resolveHouseCommittedUsageSource } = await import("@/lib/usage/houseCommittedUsageSource");
    const source = await resolveHouseCommittedUsageSource({
      houseId: "house-1",
      userId: "user-1",
      esiid: null,
    });

    expect(source).toBe("GREEN_BUTTON");
  });
});
