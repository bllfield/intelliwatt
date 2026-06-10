export const MANUAL_GAPFILL_DEFAULT_SOURCE_HOUSE_ID = "4da5d9d3-f139-4d3a-a602-3250d933c71c";
export const MANUAL_GAPFILL_DEFAULT_LAB_HOUSE_ID = "29a3d820-2593-4673-9dd6-cd161bbd7f6f";
export const MANUAL_GAPFILL_DEFAULT_MODE = "MONTHLY_FROM_SOURCE_INTERVALS" as const;

export type ManualGapfillSeedMode =
  | "MONTHLY_FROM_SOURCE_INTERVALS"
  | "ANNUAL_FROM_SOURCE_INTERVALS";

export type ManualGapfillIdentity = {
  userId: string;
  sourceHouseId: string;
  labHouseId: string;
  mode: ManualGapfillSeedMode;
};

export function buildManualGapfillIdentityKey(identity: ManualGapfillIdentity): string {
  return `${identity.userId}|${identity.sourceHouseId}|${identity.labHouseId}|${identity.mode}`;
}

export function sameHouseBlocked(sourceHouseId: string, labHouseId: string): boolean {
  return sourceHouseId.trim() !== "" && sourceHouseId.trim() === labHouseId.trim();
}

export type ManualGapfillFetchResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status: number; raw?: unknown };

async function postJson<T>(url: string, body: Record<string, unknown>): Promise<ManualGapfillFetchResult<T>> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const message =
      (typeof json.message === "string" && json.message) ||
      (typeof json.error === "string" && json.error) ||
      `Request failed (${res.status})`;
    return { ok: false, error: message, status: res.status, raw: json };
  }
  return { ok: true, data: json as T };
}

async function getJson<T>(url: string): Promise<ManualGapfillFetchResult<T>> {
  const res = await fetch(url, { method: "GET", credentials: "include" });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const message =
      (typeof json.message === "string" && json.message) ||
      (typeof json.error === "string" && json.error) ||
      `Request failed (${res.status})`;
    return { ok: false, error: message, status: res.status, raw: json };
  }
  return { ok: true, data: json as T };
}

export async function fetchManualGapfillSourceContext(args: {
  userId: string;
  sourceHouseId: string;
  esiid?: string;
  includeDiagnostics?: boolean;
}) {
  return postJson<{ ok: boolean; context: Record<string, unknown> }>(
    "/api/admin/tools/manual-gapfill/source-context",
    {
      userId: args.userId,
      sourceHouseId: args.sourceHouseId,
      ...(args.esiid ? { esiid: args.esiid } : {}),
      includeDiagnostics: args.includeDiagnostics === true,
    }
  );
}

export async function fetchValidationDayPolicySnapshot() {
  return getJson<Record<string, unknown>>("/api/admin/tools/validation-day-policy?surface=admin_lab");
}

export async function fetchValidationDayPolicyPreview(args: {
  userId: string;
  sourceHouseId: string;
  esiid?: string;
}) {
  return postJson<Record<string, unknown>>("/api/admin/tools/validation-day-policy", {
    userId: args.userId,
    houseId: args.sourceHouseId,
    sourceHouseId: args.sourceHouseId,
    ...(args.esiid ? { esiid: args.esiid } : {}),
    surface: "admin_lab",
  });
}

export async function fetchManualGapfillPrepareSeed(args: {
  userId: string;
  sourceHouseId: string;
  labHouseId: string;
  mode: ManualGapfillSeedMode;
  persistToLabHome: boolean;
  esiid?: string;
  anchorEndDate?: string;
  includeDiagnostics?: boolean;
}) {
  return postJson<{ ok: boolean; result: Record<string, unknown> }>(
    "/api/admin/tools/manual-gapfill/prepare-seed",
    {
      userId: args.userId,
      sourceHouseId: args.sourceHouseId,
      labHouseId: args.labHouseId,
      mode: args.mode,
      persistToLabHome: args.persistToLabHome,
      includeDiagnostics: args.includeDiagnostics === true,
      ...(args.esiid ? { esiid: args.esiid } : {}),
      ...(args.anchorEndDate ? { anchorEndDate: args.anchorEndDate } : {}),
    }
  );
}

export async function fetchManualGapfillRunReadback(args: {
  userId: string;
  sourceHouseId: string;
  labHouseId: string;
  mode: ManualGapfillSeedMode;
  esiid?: string;
  expectedSeedHash?: string;
  expectedSourceFingerprint?: string;
  expectedValidationDayPolicyHash?: string;
  persistRequested?: boolean;
}) {
  return postJson<{ ok: boolean; result: Record<string, unknown> }>(
    "/api/admin/tools/manual-gapfill/run-readback",
    {
      userId: args.userId,
      sourceHouseId: args.sourceHouseId,
      labHouseId: args.labHouseId,
      mode: args.mode,
      persistRequested: args.persistRequested !== false,
      ...(args.esiid ? { esiid: args.esiid } : {}),
      ...(args.expectedSeedHash ? { expectedSeedHash: args.expectedSeedHash } : {}),
      ...(args.expectedSourceFingerprint ? { expectedSourceFingerprint: args.expectedSourceFingerprint } : {}),
      ...(args.expectedValidationDayPolicyHash
        ? { expectedValidationDayPolicyHash: args.expectedValidationDayPolicyHash }
        : {}),
    }
  );
}

export async function fetchManualGapfillCompare(args: {
  userId: string;
  sourceHouseId: string;
  labHouseId: string;
  mode: ManualGapfillSeedMode;
  includeDailyRows: boolean;
  esiid?: string;
  expectedSeedHash?: string;
  expectedSourceFingerprint?: string;
  expectedValidationDayPolicyHash?: string;
  expectedArtifactInputHash?: string;
}) {
  return postJson<{ ok: boolean; result: Record<string, unknown> }>(
    "/api/admin/tools/manual-gapfill/compare",
    {
      userId: args.userId,
      sourceHouseId: args.sourceHouseId,
      labHouseId: args.labHouseId,
      mode: args.mode,
      includeDailyRows: args.includeDailyRows,
      ...(args.esiid ? { esiid: args.esiid } : {}),
      ...(args.expectedSeedHash ? { expectedSeedHash: args.expectedSeedHash } : {}),
      ...(args.expectedSourceFingerprint ? { expectedSourceFingerprint: args.expectedSourceFingerprint } : {}),
      ...(args.expectedValidationDayPolicyHash
        ? { expectedValidationDayPolicyHash: args.expectedValidationDayPolicyHash }
        : {}),
      ...(args.expectedArtifactInputHash ? { expectedArtifactInputHash: args.expectedArtifactInputHash } : {}),
    }
  );
}

export function extractSourceIntervalFingerprint(context: Record<string, unknown> | null): string | null {
  const fingerprints = context?.fingerprints as Record<string, unknown> | undefined;
  return typeof fingerprints?.intervalFingerprint === "string" ? fingerprints.intervalFingerprint : null;
}

export function extractValidationPolicyHashFromContext(context: Record<string, unknown> | null): string | null {
  const validation = context?.validation as Record<string, unknown> | undefined;
  return typeof validation?.activeValidationDayPolicyHash === "string"
    ? validation.activeValidationDayPolicyHash
    : null;
}

export function extractSeedHashFromPrepareResult(result: Record<string, unknown> | null): string | null {
  const seed = result?.seed as Record<string, unknown> | undefined;
  if (typeof seed?.normalizedPayloadHash === "string") return seed.normalizedPayloadHash;
  const diagnostics = result?.diagnostics as Record<string, unknown> | undefined;
  return typeof diagnostics?.seedPayloadHash === "string" ? diagnostics.seedPayloadHash : null;
}

export function extractArtifactInputHashFromRunResult(result: Record<string, unknown> | null): string | null {
  const run = result?.run as Record<string, unknown> | undefined;
  return typeof run?.artifactInputHash === "string" ? run.artifactInputHash : null;
}

export type ManualGapfillPipelineStep = "sourceContext" | "validationPolicy" | "prepareSeed" | "runReadback" | "compare";

export type ManualGapfillPipelineRunOutcome = {
  stoppedAt: ManualGapfillPipelineStep | "complete";
  error?: string;
};
