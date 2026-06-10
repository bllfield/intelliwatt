import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const findFirstHouse = vi.fn();
const findFirstBuild = vi.fn();
const getActualUsageDatasetForHouse = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    houseAddress: {
      findFirst: (...args: unknown[]) => findFirstHouse(...args),
    },
    usageSimulatorBuild: {
      findFirst: (...args: unknown[]) => findFirstBuild(...args),
    },
  },
}));

vi.mock("@/lib/usage/actualDatasetForHouse", () => ({
  getActualUsageDatasetForHouse: (...args: unknown[]) => getActualUsageDatasetForHouse(...args),
}));

describe("validationDayPolicy", () => {
  const originalEnv = process.env.VALIDATION_DAY_POLICY_OVERRIDE_JSON;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.VALIDATION_DAY_POLICY_OVERRIDE_JSON;
    findFirstBuild.mockResolvedValue(null);
    findFirstHouse.mockResolvedValue({ id: "house-1", esiid: "E1" });
    getActualUsageDatasetForHouse.mockResolvedValue({
      dataset: {
        daily: Array.from({ length: 120 }, (_, index) => ({
          date: `2025-${String((index % 12) + 1).padStart(2, "0")}-${String((index % 28) + 1).padStart(2, "0")}`,
          kwh: 90,
        })),
      },
    });
  });

  afterEach(() => {
    process.env.VALIDATION_DAY_POLICY_OVERRIDE_JSON = originalEnv;
  });

  it("returns stable policy revision and hash for code defaults", async () => {
    const { getValidationDayPolicySnapshot, computeValidationDayPolicyHash, resolveActiveValidationDayPolicy } =
      await import("@/lib/usage/validationDayPolicy");
    const snapshot = getValidationDayPolicySnapshot();
    const policy = resolveActiveValidationDayPolicy({ overrideSource: "code_defaults" });
    expect(snapshot.policyRevision).toBe("unified_past_validation_stratified_14_v4");
    expect(snapshot.policyHash).toBe(computeValidationDayPolicyHash(policy));
    expect(snapshot.policyHash).toBe(getValidationDayPolicySnapshot().policyHash);
  });

  it("produces the same selected keys for the same inputs", async () => {
    const { previewGlobalValidationDaySelection } = await import("@/lib/usage/validationDayPolicy");
    const args = {
      houseId: "house-1",
      userId: "user-1",
      window: { startDate: "2025-06-08", endDate: "2026-06-07" },
    };
    const first = await previewGlobalValidationDaySelection(args);
    const second = await previewGlobalValidationDaySelection(args);
    expect(first.selectedValidationDateKeys).toEqual(second.selectedValidationDateKeys);
    expect(first.policyHash).toBe(second.policyHash);
  });

  it("changes policy hash when effective config changes", async () => {
    const { computeValidationDayPolicyHash, resolveActiveValidationDayPolicy } = await import(
      "@/lib/usage/validationDayPolicy"
    );
    const baseline = computeValidationDayPolicyHash(
      resolveActiveValidationDayPolicy({ overrideSource: "code_defaults" })
    );
    const changed = computeValidationDayPolicyHash(
      resolveActiveValidationDayPolicy({
        overrideSource: "request_preview",
        validationDayCount: 9,
        validationSelectionMode: "customer_style_seasonal_mix",
      })
    );
    expect(changed).not.toBe(baseline);
  });

  it("preview uses shared selectValidationDayKeys and never marks local GapFill selector", async () => {
    const { previewGlobalValidationDaySelection } = await import("@/lib/usage/validationDayPolicy");
    const out = await previewGlobalValidationDaySelection({
      houseId: "house-1",
      userId: "user-1",
      window: { startDate: "2025-06-08", endDate: "2026-06-07" },
    });
    expect(out.selectedValidationDateKeys.length).toBeGreaterThan(0);
    expect(out.diagnostics.localGapFillSelectorUsed).toBe(false);
    expect(out.diagnostics.sharedPolicySelectorOwner).toBe("selectValidationDayKeys");
    expect(out.selectionMode).toBe("stratified_weather_balanced");
  });
});
