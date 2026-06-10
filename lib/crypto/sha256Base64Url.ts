import { createHash } from "crypto";

/**
 * SHA-256 digest as base64url. Avoids Node/browser `digest("base64url")`, which throws
 * "Unknown encoding: base64url" in some client runtimes (One Path AI copy runs in the browser).
 */
export function sha256DigestBase64Url(input: string, slice?: number): string {
  const encoded = createHash("sha256")
    .update(input, "utf8")
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return typeof slice === "number" ? encoded.slice(0, slice) : encoded;
}
