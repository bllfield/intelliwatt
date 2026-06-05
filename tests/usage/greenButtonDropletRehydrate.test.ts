import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveGreenButtonDropletConfig } from "@/lib/usage/greenButtonDropletRehydrate";

describe("green button droplet rehydrate config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("derives /rehydrate from GREEN_BUTTON_UPLOAD_URL", () => {
    vi.stubEnv("GREEN_BUTTON_UPLOAD_URL", "https://uploads.intelliwatt.com/upload");
    vi.stubEnv("GREEN_BUTTON_UPLOAD_SECRET", "test-secret");
    expect(resolveGreenButtonDropletConfig()).toEqual({
      rehydrateUrl: "https://uploads.intelliwatt.com/rehydrate",
      secret: "test-secret",
    });
  });

  it("returns null when droplet env is missing", () => {
    vi.stubEnv("GREEN_BUTTON_UPLOAD_URL", "");
    vi.stubEnv("GREEN_BUTTON_UPLOAD_SECRET", "");
    expect(resolveGreenButtonDropletConfig()).toBeNull();
  });
});
