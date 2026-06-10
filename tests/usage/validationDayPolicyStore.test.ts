import { beforeEach, describe, expect, it, vi } from "vitest";

const getFlag = vi.fn();
const setFlag = vi.fn();

vi.mock("@/lib/flags", () => ({
  getFlag: (...args: unknown[]) => getFlag(...args),
  setFlag: (...args: unknown[]) => setFlag(...args),
}));

describe("validationDayPolicyStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads and saves stored policy", async () => {
    const { readStoredValidationDayPolicyOverride, saveStoredValidationDayPolicy, VALIDATION_DAY_POLICY_FLAG_KEY } =
      await import("@/lib/usage/validationDayPolicyStore");
    getFlag.mockResolvedValue("");
    expect(await readStoredValidationDayPolicyOverride()).toBeNull();

    await saveStoredValidationDayPolicy({
      selectionMode: "stratified_weather_balanced",
      validationDayCount: 14,
      surface: "admin_lab",
      updatedBy: "admin@example.com",
    });
    expect(setFlag).toHaveBeenCalledWith(
      VALIDATION_DAY_POLICY_FLAG_KEY,
      expect.stringContaining('"selectionMode":"stratified_weather_balanced"')
    );
  });
});
