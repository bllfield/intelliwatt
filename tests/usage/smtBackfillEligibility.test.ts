import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const isHouseCommittedToGreenButton = vi.fn();
const readHouseCommittedUsageSource = vi.fn();
const resolveHouseCommittedUsageSource = vi.fn();

vi.mock("@/lib/usage/houseCommittedUsageSource", () => ({
  isHouseCommittedToGreenButton: (...args: unknown[]) => isHouseCommittedToGreenButton(...args),
  resolveHouseCommittedUsageSource: (...args: unknown[]) => resolveHouseCommittedUsageSource(...args),
}));

vi.mock("@/lib/usage/commitHouseUsageSource", () => ({
  readHouseCommittedUsageSource: (...args: unknown[]) => readHouseCommittedUsageSource(...args),
}));

describe("smtBackfillEligibility", () => {
  beforeEach(() => {
    isHouseCommittedToGreenButton.mockReset();
    readHouseCommittedUsageSource.mockReset();
    resolveHouseCommittedUsageSource.mockReset();
    isHouseCommittedToGreenButton.mockResolvedValue(false);
    readHouseCommittedUsageSource.mockResolvedValue(null);
    resolveHouseCommittedUsageSource.mockResolvedValue(null);
  });

  it("blocks SMT backfill when the home is Green Button committed", async () => {
    isHouseCommittedToGreenButton.mockResolvedValue(true);
    const { isSmtBackfillBlockedForGreenButtonHome } = await import("@/lib/usage/smtBackfillEligibility");
    await expect(
      isSmtBackfillBlockedForGreenButtonHome({
        houseId: "house-1",
        userId: "user-1",
        esiid: null,
      }),
    ).resolves.toBe(true);
  });

  it("allows SMT backfill when the home is not Green Button committed", async () => {
    isHouseCommittedToGreenButton.mockResolvedValue(false);
    const { isSmtBackfillBlockedForGreenButtonHome } = await import("@/lib/usage/smtBackfillEligibility");
    await expect(
      isSmtBackfillBlockedForGreenButtonHome({
        houseId: "house-1",
        userId: "user-1",
        esiid: "esiid-1",
      }),
    ).resolves.toBe(false);
  });

  it("allows user-facing SMT backfill when stored commit is SMT", async () => {
    readHouseCommittedUsageSource.mockResolvedValue("SMT");
    const { isUserFacingSmtBackfillAllowed } = await import("@/lib/usage/smtBackfillEligibility");
    await expect(
      isUserFacingSmtBackfillAllowed({
        houseId: "house-1",
        userId: "user-1",
        esiid: "esiid-1",
      }),
    ).resolves.toBe(true);
    expect(resolveHouseCommittedUsageSource).not.toHaveBeenCalled();
  });

  it("allows user-facing SMT backfill for legacy null commit when SMT is inferred", async () => {
    resolveHouseCommittedUsageSource.mockResolvedValue("SMT");
    const { isUserFacingSmtBackfillAllowed } = await import("@/lib/usage/smtBackfillEligibility");
    await expect(
      isUserFacingSmtBackfillAllowed({
        houseId: "house-1",
        userId: "user-1",
        esiid: "esiid-1",
      }),
    ).resolves.toBe(true);
  });

  it("blocks user-facing SMT backfill for Green Button homes", async () => {
    isHouseCommittedToGreenButton.mockResolvedValue(true);
    const { isUserFacingSmtBackfillAllowed } = await import("@/lib/usage/smtBackfillEligibility");
    await expect(
      isUserFacingSmtBackfillAllowed({
        houseId: "house-1",
        userId: "user-1",
        esiid: null,
      }),
    ).resolves.toBe(false);
  });

  it("blocks user-facing SMT backfill for manual or uncommitted homes", async () => {
    readHouseCommittedUsageSource.mockResolvedValue("MANUAL_TOTALS");
    const { isUserFacingSmtBackfillAllowed } = await import("@/lib/usage/smtBackfillEligibility");
    await expect(
      isUserFacingSmtBackfillAllowed({
        houseId: "house-1",
        userId: "user-1",
        esiid: null,
      }),
    ).resolves.toBe(false);

    readHouseCommittedUsageSource.mockResolvedValue(null);
    resolveHouseCommittedUsageSource.mockResolvedValue(null);
    await expect(
      isUserFacingSmtBackfillAllowed({
        houseId: "house-1",
        userId: "user-1",
        esiid: null,
      }),
    ).resolves.toBe(false);
  });
});
