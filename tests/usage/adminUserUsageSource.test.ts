import { describe, expect, it } from "vitest";
import {
  parseAdminUserUsageSourceFilter,
  resolveAdminUserUsageSource,
} from "@/lib/usage/adminUserUsageSource";

describe("resolveAdminUserUsageSource", () => {
  it("maps simulator modes and manual payload modes", () => {
    expect(
      resolveAdminUserUsageSource({
        simulatorMode: "NEW_BUILD_ESTIMATE",
      })
    ).toBe("NEW_BUILD");

    expect(
      resolveAdminUserUsageSource({
        simulatorMode: "MANUAL_TOTALS",
        manualUsageMode: "MONTHLY",
      })
    ).toBe("MANUAL_MONTHLY");

    expect(
      resolveAdminUserUsageSource({
        simulatorMode: "MANUAL_TOTALS",
        manualUsageMode: "ANNUAL",
      })
    ).toBe("MANUAL_ANNUAL");
  });

  it("uses committed interval source for SMT baseline builds", () => {
    expect(
      resolveAdminUserUsageSource({
        simulatorMode: "SMT_BASELINE",
        committedUsageSource: "GREEN_BUTTON",
      })
    ).toBe("GB");

    expect(
      resolveAdminUserUsageSource({
        simulatorMode: "SMT_BASELINE",
        committedUsageSource: "SMT",
      })
    ).toBe("SMT");
  });

  it("falls back to manual input and legacy committed inference when no build exists", () => {
    expect(
      resolveAdminUserUsageSource({
        manualUsageMode: "ANNUAL",
      })
    ).toBe("MANUAL_ANNUAL");

    expect(
      resolveAdminUserUsageSource({
        inferredCommittedUsageSource: "GREEN_BUTTON",
      })
    ).toBe("GB");
  });
});

describe("parseAdminUserUsageSourceFilter", () => {
  it("accepts admin filter aliases", () => {
    expect(parseAdminUserUsageSourceFilter("any")).toBe("any");
    expect(parseAdminUserUsageSourceFilter("MANUAL MONTHLY")).toBe("MANUAL_MONTHLY");
    expect(parseAdminUserUsageSourceFilter("green_button")).toBe("GB");
  });
});
