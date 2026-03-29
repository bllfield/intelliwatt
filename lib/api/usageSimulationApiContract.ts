import type { SimulatorRecalcErr } from "@/modules/usageSimulator/service";

/**
 * Plan §7 / Slice 4: stable API failure fields for user/admin simulation surfaces.
 * Additive: callers keep existing `error` / `code` / `message` where present.
 */

function errorKeyToFailureCode(errorKey: string): string {
  return errorKey
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/-/g, "_")
    .toUpperCase();
}

export function failureContractFromErrorKey(
  errorKey: string,
  message?: string
): { failureCode: string; failureMessage: string } {
  const failureCode = errorKeyToFailureCode(errorKey);
  const failureMessage =
    message ??
    errorKey
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  return { failureCode, failureMessage };
}

/** Attach §7 fields to any `{ ok: false, ... }` body that includes an `error` string key. */
export function attachFailureContract<T extends Record<string, unknown> & { ok: false }>(
  body: T
): T & { failureCode: string; failureMessage: string } {
  const errorKey = String(body.error ?? "unknown_error");
  const msg = typeof body.message === "string" ? body.message : undefined;
  const { failureCode, failureMessage } = failureContractFromErrorKey(errorKey, msg);
  return { ...body, failureCode, failureMessage };
}

export function failureContractFromRecalcErr(err: SimulatorRecalcErr): {
  failureCode: string;
  failureMessage: string;
} {
  const raw = String(err.error ?? "unknown_error");
  const failureCode =
    raw === "Internal error"
      ? "INTERNAL_ERROR"
      : raw
          .trim()
          .replace(/\s+/g, "_")
          .replace(/-/g, "_")
          .toUpperCase();
  const failureMessage =
    err.missingItems && err.missingItems.length > 0
      ? err.missingItems.join("; ")
      : raw;
  return { failureCode, failureMessage };
}

export function correlationHeaders(correlationId: string): Headers {
  const h = new Headers();
  h.set("X-Correlation-Id", correlationId);
  return h;
}
