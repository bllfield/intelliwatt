import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GREEN_BUTTON_REHYDRATE_RAW_MAX_BYTES_ON_VERCEL,
  greenButtonRehydrateUserMessage,
  isGreenButtonRehydrateBlockedOnVercel,
} from "@/lib/usage/rehydrateGreenButtonIntervalsFromRaw";

describe("green button rehydrate vercel guard", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("blocks large raw files on Vercel", () => {
    vi.stubEnv("VERCEL", "1");
    expect(isGreenButtonRehydrateBlockedOnVercel(GREEN_BUTTON_REHYDRATE_RAW_MAX_BYTES_ON_VERCEL)).toBe(
      false
    );
    expect(isGreenButtonRehydrateBlockedOnVercel(GREEN_BUTTON_REHYDRATE_RAW_MAX_BYTES_ON_VERCEL + 1)).toBe(
      true
    );
  });

  it("does not block large raw files off Vercel", () => {
    vi.stubEnv("VERCEL", "");
    expect(isGreenButtonRehydrateBlockedOnVercel(10 * 1024 * 1024)).toBe(false);
  });

  it("maps vercel size error to droplet configuration guidance", () => {
    expect(greenButtonRehydrateUserMessage("raw_too_large_for_vercel_rehydrate")).toContain("droplet");
  });
});
