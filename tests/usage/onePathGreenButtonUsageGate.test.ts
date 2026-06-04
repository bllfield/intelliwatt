import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getLatestUsableRawGreenButtonIdForHouse = vi.fn();

vi.mock("@/modules/realUsageAdapter/greenButton", () => ({
  getLatestUsableRawGreenButtonIdForHouse: (...args: unknown[]) =>
    getLatestUsableRawGreenButtonIdForHouse(...args),
}));

describe("onePathGreenButtonUsageGate", () => {
  beforeEach(() => {
    vi.resetModules();
    getLatestUsableRawGreenButtonIdForHouse.mockReset();
  });

  it("assertOnePathGreenButtonPersistedUsage fails closed when no raw upload", async () => {
    getLatestUsableRawGreenButtonIdForHouse.mockResolvedValue(null);
    const mod = await import("@/lib/usage/onePathGreenButtonUsageGate");
    const out = await mod.assertOnePathGreenButtonPersistedUsage({ houseId: "house-test" });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toBe("green_button_usage_missing");
  });

  it("assertOnePathGreenButtonPersistedUsage passes when raw upload exists", async () => {
    getLatestUsableRawGreenButtonIdForHouse.mockResolvedValue("raw-1");
    const mod = await import("@/lib/usage/onePathGreenButtonUsageGate");
    const out = await mod.assertOnePathGreenButtonPersistedUsage({ houseId: "house-test" });
    expect(out).toEqual({ ok: true });
  });
});
