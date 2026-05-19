import { prisma } from "@/lib/db";
import { requestUsageRefreshForUserHouse } from "@/lib/usage/userUsageRefresh";
import { resolveCanonicalUsage365CoverageWindow } from "@/modules/usageSimulator/metadataWindow";

export const SMT_TAIL_LOOKBACK_DAYS = 14;
export const SMT_TAIL_REQUIRED_INTERVALS_PER_DAY = 96;
export const SMT_TAIL_WAIT_TIMEOUT_MS = 60_000;
export const SMT_TAIL_WAIT_INTERVAL_MS = 2_000;
/** User-facing usage route budget: leave headroom when multiple homes are loaded. */
export const USER_USAGE_SMT_TAIL_WAIT_TIMEOUT_MS = 45_000;

const smtCoverageDateFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Chicago",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export type SmtTailCoverageSnapshot = {
  intervalCount: number;
  coverageStartDate: string | null;
  coverageEndDate: string | null;
  coverageStartUtcDate: string | null;
  coverageEndUtcDate: string | null;
  targetEndDate: string;
  tailStartDate: string;
  tailCountsByDate: Record<string, number>;
  incompleteTailDateKeys: string[];
  tailReady: boolean;
};

export type SmtDateCoverageSnapshot = {
  dateKeys: string[];
  countsByDate: Record<string, number>;
  incompleteDateKeys: string[];
  ready: boolean;
};

export type SmtTailWaitResult = SmtTailCoverageSnapshot & {
  durationMs: number;
  attempts: number;
  timedOut: boolean;
};

export type SmtDateCoverageWaitResult = SmtDateCoverageSnapshot & {
  durationMs: number;
  attempts: number;
  timedOut: boolean;
};

export type SmtTailEnsureResult = {
  attempted: boolean;
  reason: "coverage_tail_current" | "refresh_requested" | "refresh_disabled";
  coverage: SmtTailCoverageSnapshot;
  wait: SmtTailWaitResult | null;
  refreshResult?: Awaited<ReturnType<typeof requestUsageRefreshForUserHouse>>;
};

export function smtCoverageDateKey(date: Date | null | undefined): string | null {
  if (!date) return null;
  try {
    return smtCoverageDateFmt.format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

export function smtUtcDateKey(date: Date | null | undefined): string | null {
  if (!date) return null;
  try {
    return date.toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

export function addDateKeyDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function enumerateDateKeysInclusive(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  for (let cursor = startDate; cursor <= endDate; cursor = addDateKeyDays(cursor, 1)) {
    out.push(cursor);
  }
  return out;
}

export function normalizeDateKeys(values: unknown[]): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => String(value ?? "").slice(0, 10))
        .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
    )
  ).sort();
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isGreenButtonPrimaryDataset(dataset: unknown): boolean {
  const record = dataset && typeof dataset === "object" && !Array.isArray(dataset) ? (dataset as Record<string, unknown>) : {};
  const summary =
    record.summary && typeof record.summary === "object" && !Array.isArray(record.summary)
      ? (record.summary as Record<string, unknown>)
      : {};
  const meta =
    record.meta && typeof record.meta === "object" && !Array.isArray(record.meta) ? (record.meta as Record<string, unknown>) : {};
  const summarySource = String(summary.source ?? "").trim().toUpperCase();
  const metaSource = String(meta.actualSource ?? "").trim().toUpperCase();
  return summarySource === "GREEN_BUTTON" || metaSource === "GREEN_BUTTON";
}

export function smtTailRefreshNeeded(coverage: Pick<SmtTailCoverageSnapshot, "coverageEndDate" | "incompleteTailDateKeys" | "targetEndDate">): boolean {
  return (
    !coverage.coverageEndDate ||
    coverage.coverageEndDate < coverage.targetEndDate ||
    coverage.incompleteTailDateKeys.length > 0
  );
}

export async function loadSmtDateCoverage(args: { esiid: string; dateKeys: string[] }): Promise<SmtDateCoverageSnapshot> {
  const dateKeys = normalizeDateKeys(args.dateKeys);
  if (dateKeys.length === 0) {
    return {
      dateKeys,
      countsByDate: {},
      incompleteDateKeys: [],
      ready: true,
    };
  }
  const startDate = addDateKeyDays(dateKeys[0]!, -1);
  const endDate = addDateKeyDays(dateKeys[dateKeys.length - 1]!, 1);
  const rows = await prisma.smtInterval
    .findMany({
      where: {
        esiid: args.esiid,
        ts: {
          gte: new Date(`${startDate}T00:00:00.000Z`),
          lte: new Date(`${endDate}T23:59:59.999Z`),
        },
      },
      select: { ts: true },
      orderBy: { ts: "asc" },
    })
    .catch(() => []);
  const requestedDateSet = new Set(dateKeys);
  const uniqueTsByDate = new Map<string, Set<string>>();
  for (const row of rows) {
    const ts = row?.ts instanceof Date ? row.ts : row?.ts ? new Date(row.ts) : null;
    const dateKey = smtCoverageDateKey(ts);
    if (!dateKey || !requestedDateSet.has(dateKey) || !ts) continue;
    const bucket = uniqueTsByDate.get(dateKey) ?? new Set<string>();
    bucket.add(ts.toISOString());
    uniqueTsByDate.set(dateKey, bucket);
  }
  const countsByDate = Object.fromEntries(dateKeys.map((dateKey) => [dateKey, uniqueTsByDate.get(dateKey)?.size ?? 0]));
  const incompleteDateKeys = dateKeys.filter(
    (dateKey) => (countsByDate[dateKey] ?? 0) < SMT_TAIL_REQUIRED_INTERVALS_PER_DAY
  );
  return {
    dateKeys,
    countsByDate,
    incompleteDateKeys,
    ready: incompleteDateKeys.length === 0,
  };
}

export async function loadSmtTailCoverage(args: {
  esiid: string;
  targetEndDate?: string;
}): Promise<SmtTailCoverageSnapshot> {
  const targetEndDate = args.targetEndDate ?? resolveCanonicalUsage365CoverageWindow().endDate;
  const coverage = await prisma.smtInterval
    .aggregate({
      where: { esiid: args.esiid },
      _count: { _all: true },
      _min: { ts: true },
      _max: { ts: true },
    })
    .catch(() => null);
  const coverageEndDate = smtCoverageDateKey(coverage?._max?.ts ?? null);
  const coverageStartDate = smtCoverageDateKey(coverage?._min?.ts ?? null);
  const coverageEndUtcDate = smtUtcDateKey(coverage?._max?.ts ?? null);
  const coverageStartUtcDate = smtUtcDateKey(coverage?._min?.ts ?? null);
  const intervalCount = Number(coverage?._count?._all ?? 0) || 0;
  const tailStartDate = addDateKeyDays(targetEndDate, -(SMT_TAIL_LOOKBACK_DAYS - 1));
  const tailDateKeys = enumerateDateKeysInclusive(tailStartDate, targetEndDate);
  const tailDateSet = new Set(tailDateKeys);
  const tailStart = new Date(`${tailStartDate}T00:00:00.000Z`);
  const tailEnd = new Date(`${targetEndDate}T23:59:59.999Z`);
  const tailRows = await prisma.smtInterval
    .findMany({
      where: {
        esiid: args.esiid,
        ts: {
          gte: tailStart,
          lte: tailEnd,
        },
      },
      select: { ts: true },
      orderBy: { ts: "asc" },
    })
    .catch(() => []);
  const uniqueTsByDate = new Map<string, Set<string>>();
  for (const row of tailRows) {
    const ts = row?.ts instanceof Date ? row.ts : row?.ts ? new Date(row.ts) : null;
    const dateKey = smtUtcDateKey(ts);
    if (!dateKey || !tailDateSet.has(dateKey) || !ts) continue;
    const bucket = uniqueTsByDate.get(dateKey) ?? new Set<string>();
    bucket.add(ts.toISOString());
    uniqueTsByDate.set(dateKey, bucket);
  }
  const tailCountsByDate = Object.fromEntries(
    tailDateKeys.map((dateKey) => [dateKey, uniqueTsByDate.get(dateKey)?.size ?? 0])
  );
  const incompleteTailDateKeys = tailDateKeys.filter(
    (dateKey) => (tailCountsByDate[dateKey] ?? 0) < SMT_TAIL_REQUIRED_INTERVALS_PER_DAY
  );
  const tailReady = Boolean(
    coverageEndDate && coverageEndDate >= targetEndDate && incompleteTailDateKeys.length === 0
  );
  return {
    intervalCount,
    coverageStartDate,
    coverageEndDate,
    coverageStartUtcDate,
    coverageEndUtcDate,
    targetEndDate,
    tailStartDate,
    tailCountsByDate,
    incompleteTailDateKeys,
    tailReady,
  };
}

export async function waitForSmtTailCoverage(args: {
  esiid: string;
  targetEndDate?: string;
  timeoutMs?: number;
  intervalMs?: number;
}): Promise<SmtTailWaitResult> {
  const targetEndDate = args.targetEndDate ?? resolveCanonicalUsage365CoverageWindow().endDate;
  const timeoutMs = args.timeoutMs ?? SMT_TAIL_WAIT_TIMEOUT_MS;
  const intervalMs = args.intervalMs ?? SMT_TAIL_WAIT_INTERVAL_MS;
  const startedAt = Date.now();
  let attempts = 0;
  let latest = await loadSmtTailCoverage({ esiid: args.esiid, targetEndDate });
  while (!latest.tailReady && Date.now() - startedAt < timeoutMs) {
    attempts += 1;
    await wait(intervalMs);
    latest = await loadSmtTailCoverage({ esiid: args.esiid, targetEndDate });
  }
  return {
    ...latest,
    durationMs: Date.now() - startedAt,
    attempts,
    timedOut: !latest.tailReady,
  };
}

export async function waitForSmtDateCoverage(args: {
  esiid: string;
  dateKeys: string[];
  timeoutMs?: number;
  intervalMs?: number;
}): Promise<SmtDateCoverageWaitResult> {
  const timeoutMs = args.timeoutMs ?? SMT_TAIL_WAIT_TIMEOUT_MS;
  const intervalMs = args.intervalMs ?? SMT_TAIL_WAIT_INTERVAL_MS;
  const startedAt = Date.now();
  let attempts = 0;
  let latest = await loadSmtDateCoverage({ esiid: args.esiid, dateKeys: args.dateKeys });
  while (!latest.ready && Date.now() - startedAt < timeoutMs) {
    attempts += 1;
    await wait(intervalMs);
    latest = await loadSmtDateCoverage({ esiid: args.esiid, dateKeys: args.dateKeys });
  }
  return {
    ...latest,
    durationMs: Date.now() - startedAt,
    attempts,
    timedOut: !latest.ready,
  };
}

export async function ensureSmtTailCoverageForUserHouse(args: {
  userId: string;
  houseId: string;
  esiid: string;
  targetEndDate?: string;
  waitTimeoutMs?: number;
  requestRefreshIfNeeded?: boolean;
}): Promise<SmtTailEnsureResult> {
  const targetEndDate = args.targetEndDate ?? resolveCanonicalUsage365CoverageWindow().endDate;
  let coverage = await loadSmtTailCoverage({ esiid: args.esiid, targetEndDate });
  if (!smtTailRefreshNeeded(coverage)) {
    return {
      attempted: false,
      reason: "coverage_tail_current",
      coverage,
      wait: null,
    };
  }
  if (args.requestRefreshIfNeeded === false) {
    return {
      attempted: false,
      reason: "refresh_disabled",
      coverage,
      wait: null,
    };
  }
  const refreshResult = await requestUsageRefreshForUserHouse({
    userId: args.userId,
    houseId: args.houseId,
  }).catch((error) => ({
    ok: false as const,
    error: "refresh_failed" as const,
    message: error instanceof Error ? error.message : String(error),
  }));
  const wait = await waitForSmtTailCoverage({
    esiid: args.esiid,
    targetEndDate,
    timeoutMs: args.waitTimeoutMs ?? SMT_TAIL_WAIT_TIMEOUT_MS,
  });
  coverage = await loadSmtTailCoverage({ esiid: args.esiid, targetEndDate });
  return {
    attempted: true,
    reason: "refresh_requested",
    coverage,
    wait,
    refreshResult,
  };
}

export function buildUsageIngestionStatusFromTailEnsure(result: SmtTailEnsureResult) {
  return {
    tailReady: result.coverage.tailReady,
    targetEndDate: result.coverage.targetEndDate,
    tailRefreshAttempted: result.attempted,
    tailRefreshReason: result.reason,
    tailTimedOut: result.wait?.timedOut ?? false,
    incompleteTailDateKeys: result.coverage.incompleteTailDateKeys,
    coverageEndDate: result.coverage.coverageEndDate,
  } as const;
}
