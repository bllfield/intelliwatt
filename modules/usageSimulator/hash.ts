import { createHash } from "crypto";

export function computeBuildInputsHash(normalizedInputs: unknown): string {
  // V1: stable hash over a normalized JSON object.
  // Callers must ensure stable key ordering by constructing the object deterministically.
  const s = JSON.stringify(normalizedInputs);
  return createHash("sha256").update(s).digest("hex");
}

