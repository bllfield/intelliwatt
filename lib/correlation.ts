import { randomUUID } from "crypto";

export function getCorrelationId(headers?: Headers) {
  if (!headers) return randomUUID();
  return (
    headers.get("x-corr-id") ||
    headers.get("x-request-id") ||
    randomUUID()
  );
}
