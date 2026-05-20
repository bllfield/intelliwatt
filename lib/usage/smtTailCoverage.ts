import { prisma } from "@/lib/db";
import {
  requestUsageRefreshForUserHouse,
  type UsageRefreshResult,
} from "@/lib/usage/userUsageRefresh";
import {
  isSmtDayLedgerSettledForTail,
  loadSmtDayLedgerStatusForDate,
  runDeferredPendingSmtDayRepairs,
} from "@/lib/usage/smtDayCoverageLedger";
import { resolveCanonicalUsage365CoverageWindow } from "@/modules/usageSimulator/metadataWindow";

export const SMT_TAIL_LOOKBACK_DAYS = 14;
export const SMT_TAIL_REQUIRED_INTERVALS_PER_DAY = 96;
export const SMT_TAIL_WAIT_TIMEOUT_MS = 60_000;
export const SMT_TAIL_WAIT_INTERVAL_MS = 2_000;
/** User-facing usage route budget: leave headroom when multiple homes are loaded. */
export const USER_USAGE_SMT_TAIL_WAIT_TIMEOUT_MS = 8_000;
/** One Path admin run: short poll; exit early when SMT counts stop changing. */
export const ONE_PATH_ADMIN_SMT_TAIL_WAIT_TIMEOUT_MS = 20_000;
/** After targeted incomplete-meter backfill: allow FTP delivery + ingest before giving up. */
export const ONE_PATH_ADMIN_SMT_INCOMPLETE_METER_WAIT_TIMEOUT_MS = 90_000;
/** Pause after a post-backfill pull so ingestion can finish before polling counts. */
export const SMT_POST_BACKFILL_SETTLE_DELAY_MS = 3_000;
/** Only block incomplete-meter backfill waits on days near the canonical window end. */
export const SMT_INCOMPLETE_METER_BACKFILL_LOOKBACK_DAYS = 3;

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
  targetEndDayLedgerStatus: string | null;
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
  refreshResult?: UsageRefreshResult;
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function latestUsageCoverageDateKeyFromDataset(dataset: unknown): string | null {
  const summary = asRecord(asRecord(dataset).summary);
  const latest = String(summary.latest ?? summary.end ?? "").trim();
  if (!latest) return null;
  if (latest.includes("T")) {
    const parsed = new Date(latest);
    return Number.isFinite(parsed.getTime()) ? smtCoverageDateKey(parsed) : latest.slice(0, 10);
  }
  return latest.slice(0, 10);
}

/** True when the resolved usage dataset already includes the canonical tail day. */
export function isResolvedDatasetTailDisplayReady(dataset: unknown, targetEndDate: string): boolean {
  const latestKey = latestUsageCoverageDateKeyFromDataset(dataset);
  return Boolean(latestKey && latestKey >= targetEndDate);
}

export type UsageIngestionStatusLike = {
  tailReady: boolean;
  targetEndDate: string;
  tailRefreshAttempted: boolean;
  tailRefreshReason: "coverage_tail_current" | "refresh_requested" | "refresh_disabled";
  tailTimedOut: boolean;
  incompleteTailDateKeys: string[];
  coverageEndDate: string | null;
};

export function reconcileUsageIngestionWithDataset(args: {
  ingestion: UsageIngestionStatusLike | null;
  dataset: unknown;
  targetEndDate: string;
}): UsageIngestionStatusLike | null {
  const latestKey = latestUsageCoverageDateKeyFromDataset(args.dataset);
  if (!isResolvedDatasetTailDisplayReady(args.dataset, args.targetEndDate)) {
    return args.ingestion;
  }
  if (!args.ingestion) {
    return {
      tailReady: true,
      targetEndDate: args.targetEndDate,
      tailRefreshAttempted: false,
      tailRefreshReason: "coverage_tail_current",
      tailTimedOut: false,
      incompleteTailDateKeys: [],
      coverageEndDate: latestKey,
    };
  }
  return {
    ...args.ingestion,
    tailReady: true,
    tailTimedOut: false,
    incompleteTailDateKeys: [],
    coverageEndDate: args.ingestion.coverageEndDate ?? latestKey,
  };
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

export function smtTargetEndDayIntervalCount(
  coverage: Pick<SmtTailCoverageSnapshot, "targetEndDate" | "tailCountsByDate">
): number {
  return coverage.tailCountsByDate?.[coverage.targetEndDate] ?? 0;
}

/** True when the canonical window end day itself is below the trusted interval threshold. */
export function smtCanonicalEndDayIncomplete(
  coverage: Pick<SmtTailCoverageSnapshot, "targetEndDate" | "tailCountsByDate">
): boolean {
  return smtTargetEndDayIntervalCount(coverage) < SMT_TAIL_REQUIRED_INTERVALS_PER_DAY;
}

/**
 * Refresh/wait only when persisted coverage has not reached the canonical end date,
 * or the canonical end day is still incomplete. Mid-window partial days (e.g. 40/96)
 * are handled by Past Sim INCOMPLETE_METER modeling and must not block the run.
 */
export function smtTailRefreshNeeded(
  coverage: Pick<
    SmtTailCoverageSnapshot,
    "coverageEndDate" | "targetEndDate" | "tailCountsByDate" | "targetEndDayLedgerStatus"
  >
): boolean {
  if (!coverage.coverageEndDate || coverage.coverageEndDate < coverage.targetEndDate) {
    return true;
  }
  if (isSmtDayLedgerSettledForTail(coverage.targetEndDayLedgerStatus)) {
    return false;
  }
  return smtCanonicalEndDayIncomplete(coverage);
}

export function filterDateKeysNearTargetEnd(
  dateKeys: string[],
  targetEndDate: string,
  lookbackDays = SMT_INCOMPLETE_METER_BACKFILL_LOOKBACK_DAYS
): string[] {
  const minKey = addDateKeyDays(targetEndDate, -(lookbackDays - 1));
  return normalizeDateKeys(dateKeys).filter((dateKey) => dateKey >= minKey && dateKey <= targetEndDate);
}

function coverageProgressFingerprint(
  snapshot: Pick<SmtTailCoverageSnapshot, "tailReady" | "incompleteTailDateKeys" | "tailCountsByDate">
): string {
  return JSON.stringify({
    tailReady: snapshot.tailReady,
    incompleteTailDateKeys: snapshot.incompleteTailDateKeys,
    tailCountsByDate: snapshot.tailCountsByDate,
  });
}

function dateCoverageProgressFingerprint(
  snapshot: Pick<SmtDateCoverageSnapshot, "ready" | "incompleteDateKeys" | "countsByDate">
): string {
  return JSON.stringify({
    ready: snapshot.ready,
    incompleteDateKeys: snapshot.incompleteDateKeys,
    countsByDate: snapshot.countsByDate,
  });
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
    const dateKey = smtCoverageDateKey(ts);
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
  const targetEndDayLedgerStatus = await loadSmtDayLedgerStatusForDate({
    esiid: args.esiid,
    dateKey: targetEndDate,
  });
  const endDaySettled = isSmtDayLedgerSettledForTail(targetEndDayLedgerStatus);
  const tailReady = Boolean(
    coverageEndDate &&
      coverageEndDate >= targetEndDate &&
      (endDaySettled || !smtCanonicalEndDayIncomplete({ targetEndDate, tailCountsByDate }))
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
    targetEndDayLedgerStatus,
    tailReady,
  };
}

export async function waitForSmtTailCoverage(args: {
  esiid: string;
  targetEndDate?: string;
  timeoutMs?: number;
  intervalMs?: number;
  /** When false, keep polling until timeout even if counts stop changing. */
  exitEarlyWhenStalled?: boolean;
}): Promise<SmtTailWaitResult> {
  const targetEndDate = args.targetEndDate ?? resolveCanonicalUsage365CoverageWindow().endDate;
  const timeoutMs = args.timeoutMs ?? SMT_TAIL_WAIT_TIMEOUT_MS;
  const intervalMs = args.intervalMs ?? SMT_TAIL_WAIT_INTERVAL_MS;
  const exitEarlyWhenStalled = args.exitEarlyWhenStalled !== false;
  const startedAt = Date.now();
  let attempts = 0;
  let latest = await loadSmtTailCoverage({ esiid: args.esiid, targetEndDate });
  let lastProgressFingerprint = coverageProgressFingerprint(latest);
  while (!latest.tailReady && Date.now() - startedAt < timeoutMs) {
    attempts += 1;
    await wait(intervalMs);
    const next = await loadSmtTailCoverage({ esiid: args.esiid, targetEndDate });
    const nextFingerprint = coverageProgressFingerprint(next);
    if (exitEarlyWhenStalled && attempts >= 2 && nextFingerprint === lastProgressFingerprint) {
      latest = next;
      break;
    }
    lastProgressFingerprint = nextFingerprint;
    latest = next;
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
  initialDelayMs?: number;
  /** When false, keep polling until timeout even if counts stop changing. */
  exitEarlyWhenStalled?: boolean;
  /** Optional pull halfway through the wait (e.g. after targeted backfill). */
  midWaitRefresh?: () => Promise<void>;
}): Promise<SmtDateCoverageWaitResult> {
  const timeoutMs = args.timeoutMs ?? SMT_TAIL_WAIT_TIMEOUT_MS;
  const intervalMs = args.intervalMs ?? SMT_TAIL_WAIT_INTERVAL_MS;
  const exitEarlyWhenStalled = args.exitEarlyWhenStalled !== false;
  if (args.initialDelayMs && args.initialDelayMs > 0) {
    await wait(args.initialDelayMs);
  }
  const startedAt = Date.now();
  let attempts = 0;
  let midWaitRefreshDone = false;
  let latest = await loadSmtDateCoverage({ esiid: args.esiid, dateKeys: args.dateKeys });
  let lastProgressFingerprint = dateCoverageProgressFingerprint(latest);
  while (!latest.ready && Date.now() - startedAt < timeoutMs) {
    const elapsedMs = Date.now() - startedAt;
    if (!midWaitRefreshDone && args.midWaitRefresh && elapsedMs >= timeoutMs / 2 && !latest.ready) {
      midWaitRefreshDone = true;
      await args.midWaitRefresh().catch(() => null);
      latest = await loadSmtDateCoverage({ esiid: args.esiid, dateKeys: args.dateKeys });
      lastProgressFingerprint = dateCoverageProgressFingerprint(latest);
      if (latest.ready) break;
    }
    attempts += 1;
    await wait(intervalMs);
    const next = await loadSmtDateCoverage({ esiid: args.esiid, dateKeys: args.dateKeys });
    const nextFingerprint = dateCoverageProgressFingerprint(next);
    if (exitEarlyWhenStalled && attempts >= 2 && nextFingerprint === lastProgressFingerprint) {
      latest = next;
      break;
    }
    lastProgressFingerprint = nextFingerprint;
    latest = next;
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
  if (args.requestRefreshIfNeeded !== false) {
    await runDeferredPendingSmtDayRepairs({
      esiid: args.esiid,
      userId: args.userId,
      houseId: args.houseId,
      waitTimeoutMs: Math.min(args.waitTimeoutMs ?? USER_USAGE_SMT_TAIL_WAIT_TIMEOUT_MS, 12_000),
    }).catch(() => null);
  }
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
  let refreshResult: UsageRefreshResult;
  try {
    refreshResult = await requestUsageRefreshForUserHouse({
      userId: args.userId,
      houseId: args.houseId,
    });
  } catch (error) {
    refreshResult = {
      ok: false,
      error: "admin_token_missing",
      message: `refresh_failed:${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const waitTimeoutMs = args.waitTimeoutMs ?? SMT_TAIL_WAIT_TIMEOUT_MS;
  const wait =
    waitTimeoutMs > 0
      ? await waitForSmtTailCoverage({
          esiid: args.esiid,
          targetEndDate,
          timeoutMs: waitTimeoutMs,
        })
      : null;
  coverage = await loadSmtTailCoverage({ esiid: args.esiid, targetEndDate });
  return {
    attempted: true,
    reason: "refresh_requested",
    coverage,
    wait,
    refreshResult,
  };
}

export function buildUsageIngestionStatusFromTailEnsure(
  result: SmtTailEnsureResult,
  ledger?: { pendingDateKeys?: string[]; incompleteMeterDateKeys?: string[] } | null
) {
  return {
    tailReady: result.coverage.tailReady,
    targetEndDate: result.coverage.targetEndDate,
    tailRefreshAttempted: result.attempted,
    tailRefreshReason: result.reason,
    tailTimedOut: result.wait?.timedOut ?? false,
    incompleteTailDateKeys: result.coverage.incompleteTailDateKeys,
    coverageEndDate: result.coverage.coverageEndDate,
    smtPendingIntervalDateKeys: ledger?.pendingDateKeys ?? [],
    smtIncompleteMeterDateKeys: ledger?.incompleteMeterDateKeys ?? [],
  } as const;
}
