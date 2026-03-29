/**
 * Gap-Fill Lab admin UI helpers (plan §8, §23).
 * Display-only: no modeled-day or compare math.
 * Fingerprint/build freshness is serialized by the API (`fingerprintBuildFreshness`); do not re-derive here.
 */

export type GapfillFailureFields = {
  failureCode?: string;
  failureMessage?: string;
  error?: string;
  message?: string;
};

/** Map API / attachFailureContract bodies to display fields. */
export function gapfillFailureFieldsFromJson(json: Record<string, unknown> | null | undefined): GapfillFailureFields {
  if (!json || typeof json !== "object") {
    return {};
  }
  const failureCode = typeof json.failureCode === "string" ? json.failureCode : undefined;
  const failureMessage = typeof json.failureMessage === "string" ? json.failureMessage : undefined;
  const error = typeof json.error === "string" ? json.error : undefined;
  const message = typeof json.message === "string" ? json.message : undefined;
  return { failureCode, failureMessage, error, message };
}

export function gapfillPrimaryErrorLine(f: GapfillFailureFields): string {
  return (
    f.failureMessage?.trim() ||
    f.message?.trim() ||
    f.error?.trim() ||
    "Request failed."
  );
}
