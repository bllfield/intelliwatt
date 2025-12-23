export type UniversalAvailabilityStatus = "AVAILABLE" | "QUEUED";

export function isOkOrApprox(est: any): boolean {
  const st = String(est?.status ?? "").trim().toUpperCase();
  return st === "OK" || st === "APPROXIMATE";
}

export function deriveUniversalAvailability(est: any): {
  status: UniversalAvailabilityStatus;
  reason: string | null;
  engineStatus: string | null;
  engineReason: string | null;
} {
  const engineStatus = String(est?.status ?? "").trim() || null;
  const engineReason = String(est?.reason ?? "").trim() || null;

  if (isOkOrApprox(est)) {
    return { status: "AVAILABLE", reason: null, engineStatus, engineReason };
  }

  // Single outward truth: anything not OK/APPROX is QUEUED, with a stable reason for ops/debug.
  const reason =
    engineReason ||
    (engineStatus ? `ENGINE_${engineStatus}` : null) ||
    "UNKNOWN";
  return { status: "QUEUED", reason, engineStatus, engineReason };
}


