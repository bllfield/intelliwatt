export const MANUAL_GAPFILL_DEFAULT_USER_EMAIL = "brian@intellipath-solutions.com";
export const MANUAL_GAPFILL_DEFAULT_SOURCE_HOUSE_ID = "8a6fe8b9-601e-4f9d-aa3e-7ef0b4bddde8";
export const MANUAL_GAPFILL_DEFAULT_LAB_HOUSE_ID = "29a3d820-2593-4673-9dd6-cd161bbd7f6f";
export const MANUAL_GAPFILL_DEFAULT_MODE = "MONTHLY_FROM_SOURCE_INTERVALS" as const;

export type AdminHouseLookupHouse = {
  id: string;
  esiid: string | null;
  isPrimary?: boolean;
  label?: string;
};

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

export async function fetchAdminUserByEmail(email: string) {
  const trimmed = email.trim();
  if (!trimmed) {
    return { ok: false as const, error: "User email is required.", status: 400 };
  }
  return getJson<{
    ok: boolean;
    email: string;
    userId: string;
    houses: AdminHouseLookupHouse[];
  }>(`/api/admin/houses/by-email?email=${encodeURIComponent(trimmed)}`);
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

export const MANUAL_GAPFILL_PIPELINE_STOP_AFTER_DRY_RUN_MESSAGE =
  "Dry-run seed created. Persist seed to lab home before running Past Sim." as const;

export type ManualGapfillSeedStatementRangeRow = {
  startDate: string;
  endDate: string;
  month?: string | null;
  kwhTotal: number | null;
  statusOrWarning: string | null;
};

export type ManualGapfillSeedPreview = {
  manualUsageMode: string | null;
  anchorEndDate: string | null;
  totalKwh: number | null;
  billPeriodCount: number | null;
  annualTotalKwh: number | null;
  normalizedPayloadHash: string | null;
  billPeriodHash: string | null;
  validationResultHash: string | null;
  statementRanges: ManualGapfillSeedStatementRangeRow[];
  monthlyTotalsKwhByMonth: Record<string, number> | null;
};

export type ManualGapfillReadbackSummary = {
  billMatchStatus: string | null;
  eligiblePeriodCount: number | null;
  reconciledPeriodCount: number | null;
  intervalShape: string | null;
  baseload15MinKwh: number | null;
  totalKwh: number | null;
  coverageStart: string | null;
  coverageEnd: string | null;
};

export type ManualGapfillMonthlyCompareRow = {
  periodId: string;
  startDate: string;
  endDate: string;
  actualKwh: number | null;
  simulatedKwh: number | null;
  deltaKwh: number | null;
  percentDelta: number | null;
  status: string;
  actualSource: string | null;
  simulatedSource: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function isPrepareSeedPersisted(result: Record<string, unknown> | null | undefined): boolean {
  if (!result) return false;
  if (result.status === "persisted") return true;
  const labContext = asRecord(result.labContext);
  return labContext?.wroteManualPayload === true;
}

export function extractSeedPreviewFromPrepareResult(
  result: Record<string, unknown> | null | undefined
): ManualGapfillSeedPreview | null {
  const seed = asRecord(result?.seed);
  if (!seed) return null;

  const statementRangesRaw = Array.isArray(seed.statementRanges) ? seed.statementRanges : [];
  const monthlyTotalsRaw = asRecord(seed.monthlyTotalsKwhByMonth);
  const monthlyTotalsKwhByMonth = monthlyTotalsRaw
    ? Object.fromEntries(
        Object.entries(monthlyTotalsRaw).map(([month, kwh]) => [month, Number(kwh) || 0])
      )
    : null;

  const statementRanges: ManualGapfillSeedStatementRangeRow[] = statementRangesRaw.map((row) => {
    const rec = asRecord(row);
    const month = asString(rec?.month);
    const kwhFromMonthly =
      month && monthlyTotalsKwhByMonth ? (monthlyTotalsKwhByMonth[month.slice(0, 7)] ?? null) : null;
    return {
      startDate: asString(rec?.startDate) ?? "—",
      endDate: asString(rec?.endDate) ?? "—",
      month,
      kwhTotal: kwhFromMonthly,
      statusOrWarning: null,
    };
  });

  return {
    manualUsageMode: asString(seed.manualUsageMode),
    anchorEndDate: asString(seed.anchorEndDate),
    totalKwh: asNumber(seed.totalKwh),
    billPeriodCount: asNumber(seed.billPeriodCount),
    annualTotalKwh: asNumber(seed.annualTotalKwh),
    normalizedPayloadHash: asString(seed.normalizedPayloadHash),
    billPeriodHash: asString(seed.billPeriodHash),
    validationResultHash: asString(seed.validationResultHash),
    statementRanges,
    monthlyTotalsKwhByMonth,
  };
}

export function extractReadbackSummaryFromRunResult(
  result: Record<string, unknown> | null | undefined
): ManualGapfillReadbackSummary | null {
  const readback = asRecord(result?.readback);
  if (!readback) return null;
  return {
    billMatchStatus: asString(readback.billMatchStatus),
    eligiblePeriodCount: asNumber(readback.eligiblePeriodCount),
    reconciledPeriodCount: asNumber(readback.reconciledPeriodCount),
    intervalShape: asString(readback.intervalShape),
    baseload15MinKwh: asNumber(readback.baseload15MinKwh),
    totalKwh: asNumber(readback.totalKwh),
    coverageStart: asString(readback.coverageStart),
    coverageEnd: asString(readback.coverageEnd),
  };
}

export function extractMonthlyCompareRowsFromCompareResult(
  result: Record<string, unknown> | null | undefined
): ManualGapfillMonthlyCompareRow[] {
  const compare = asRecord(result?.compare);
  const monthly = asRecord(compare?.monthly);
  const rows = Array.isArray(monthly?.rows) ? monthly.rows : [];
  return rows.map((row) => {
    const rec = asRecord(row);
    return {
      periodId: asString(rec?.periodId) ?? "—",
      startDate: asString(rec?.startDate) ?? "—",
      endDate: asString(rec?.endDate) ?? "—",
      actualKwh: asNumber(rec?.actualKwh),
      simulatedKwh: asNumber(rec?.simulatedKwh),
      deltaKwh: asNumber(rec?.deltaKwh),
      percentDelta: asNumber(rec?.percentDelta),
      status: asString(rec?.status) ?? "—",
      actualSource: asString(rec?.actualSource),
      simulatedSource: asString(rec?.simulatedSource),
    };
  });
}

export function canContinuePipelineAfterPrepareSeed(args: {
  persistedSeedInSession: boolean;
  prepareResult: Record<string, unknown> | null | undefined;
}): boolean {
  return args.persistedSeedInSession || isPrepareSeedPersisted(args.prepareResult);
}
