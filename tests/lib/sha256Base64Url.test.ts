import { createHash } from "crypto";
import { describe, expect, it } from "vitest";

import { sha256DigestBase64Url } from "@/lib/crypto/sha256Base64Url";

describe("sha256DigestBase64Url", () => {
  it("matches native base64url digest when supported", () => {
    const input = "manual-monthly-past-copy";
    const expected = createHash("sha256").update(input, "utf8").digest("base64url").slice(0, 22);
    expect(sha256DigestBase64Url(input, 22)).toBe(expected);
  });

  it("uses manual base64url alphabet without padding", () => {
    const full = sha256DigestBase64Url("browser-safe-copy");
    expect(full).not.toContain("+");
    expect(full).not.toContain("/");
    expect(full).not.toContain("=");
    expect(full.length).toBeGreaterThan(20);
  });
});
