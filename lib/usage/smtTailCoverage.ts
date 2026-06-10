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
import { smtCoverageDateKey } from "@/lib/time/chicago";
import { SMT_TAIL_REQUIRED_INTERVALS_PER_DAY } from "@/lib/usage/smtCoverageConstants";
import {
  loadSmtWindowDayStatus,
  missingChicagoSlotsFromFilledSlots,
  resolveSmtCanonicalWindow,
  smtCompletenessIntervalThreshold,
  smtRequiredSlotsForDateKey,
  type SmtPersistedCoverageSpan,
  type SmtWindowStatusSnapshot,
} from "@/lib/usage/smtWindowStatus";

export { chicagoSlot96FromTs, smtCoverageDateKey } from "@/lib/time/chicago";
export { missingChicagoSlotsFromFilledSlots } from "@/lib/usage/smtWindowStatus";

export const SMT_TAIL_LOOKBACK_DAYS = 14;
export { SMT_TAIL_REQUIRED_INTERVALS_PER_DAY };
export const SMT_TAIL_WAIT_TIMEOUT_MS = 60_000;
export const SMT_TAIL_WAIT_INTERVAL_MS = 2_000;
/** User-facing usage route budget: leave headroom when multiple homes are loaded. */
export const USER_USAGE_SMT_TAIL_WAIT_TIMEOUT_MS = 8_000;
/** Tail-gap heal waits for pull + normalize after targeted backfill (not a full wide refresh). */
export const USER_USAGE_TAIL_GAP_WAIT_TIMEOUT_MS = 45_000;
/** Cap internal /api/admin/smt/pull wait from user refresh (Vercel user routes are ~30–60s). */
export const USER_USAGE_PULL_FETCH_TIMEOUT_MS = 18_000;
/** After a pull from user refresh, bounded deferred PENDING_SMT repair wait. */
export const USER_USAGE_DEFERRED_REPAIR_WAIT_MS = 6_000;
/**
 * One Path admin pre/post sim heal: poll after pull/backfill until tail slot counts settle.
 * Use 90s so FTP delivery can extend persisted span through canonical end (20s was too short).
 */
export const ONE_PATH_ADMIN_SMT_TAIL_WAIT_TIMEOUT_MS = 90_000;
/** After targeted incomplete-meter backfill: allow FTP delivery + ingest before giving up. */
export const ONE_PATH_ADMIN_SMT_INCOMPLETE_METER_WAIT_TIMEOUT_MS = 90_000;
/** Second pass when a day is one or two intervals short after the first wait times out. */
export const ONE_PATH_ADMIN_SMT_INCOMPLETE_METER_SECOND_PASS_WAIT_TIMEOUT_MS = 60_000;
/** Days at or above this count get a padded second targeted backfill + wait. */
/** Two slots short of the DST-aware required count for that local day. */
export function smtNearCompleteIntervalThreshold(dateKey: string): number {
  return Math.max(1, smtRequiredSlotsForDateKey(dateKey) - 2);
}

/** @deprecated Use smtNearCompleteIntervalThreshold(dateKey) for DST-aware days. */
export const SMT_NEAR_COMPLETE_INTERVAL_THRESHOLD = 94;
/** Pause after a post-backfill pull so ingestion can finish before polling counts. */
export const SMT_POST_BACKFILL_SETTLE_DELAY_MS = 3_000;
/**
 * Legacy near-end clip for tail-only helpers. Canonical-window heal uses
 * `filterDateKeysWithinCanonicalWindow` (see ensureSmtCoverage).
 */
export const SMT_INCOMPLETE_METER_BACKFILL_LOOKBACK_DAYS = 3;

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
  missingSlotsByDate: Record<string, number[]>;
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
  // Use only persisted meter progress — summary.end is canonical framing, not latest SMT data.
  const latest = String(summary.latest ?? "").trim();
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
  const required = smtCompletenessIntervalThreshold(
    smtRequiredSlotsForDateKey(coverage.targetEndDate),
  );
  return smtTargetEndDayIntervalCount(coverage) < required;
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

/** Bounds heal/backfill date keys to the shared canonical coverage window (full 365-day span). */
export function filterDateKeysWithinCanonicalWindow(
  dateKeys: string[],
  window: { startDate: string; endDate: string }
): string[] {
  return normalizeDateKeys(dateKeys).filter(
    (dateKey) => dateKey >= window.startDate && dateKey <= window.endDate
  );
}

/** Bounds heal targets to days between first and last persisted SMT interval (inclusive). */
export function filterDateKeysWithinPersistedSpan(
  dateKeys: string[],
  span: SmtPersistedCoverageSpan
): string[] {
  return normalizeDateKeys(dateKeys).filter(
    (dateKey) => dateKey >= span.startDate && dateKey <= span.endDate
  );
}

/** Incomplete days to heal: inside canonical window and within persisted SMT span only. */
export function resolveSmtHealBackfillDateKeys(args: {
  dayStatus: SmtWindowStatusSnapshot;
  persistedSpan: SmtPersistedCoverageSpan | null;
  extraDateKeys?: string[];
}): string[] {
  if (!args.persistedSpan) return [];
  return filterDateKeysWithinCanonicalWindow(
    filterDateKeysWithinPersistedSpan(
      normalizeDateKeys([
        ...args.dayStatus.incompleteDateKeys,
        ...args.dayStatus.incompleteMeterDateKeys,
        ...args.dayStatus.pendingDateKeys,
        ...(args.extraDateKeys ?? []),
      ]),
      args.persistedSpan
    ),
    args.dayStatus.window
  );
}

/**
 * Canonical tail days after the last persisted interval (span end < window end).
 * Targeted backfill can request these from SMT even before rows land in `SmtInterval`.
 */
export function resolveSmtTailExtensionHealDateKeys(args: {
  dayStatus: SmtWindowStatusSnapshot;
  persistedSpan: SmtPersistedCoverageSpan;
}): string[] {
  if (args.persistedSpan.endDate >= args.dayStatus.window.endDate) return [];
  return filterDateKeysWithinCanonicalWindow(
    normalizeDateKeys([
      ...args.dayStatus.incompleteDateKeys,
      ...args.dayStatus.incompleteMeterDateKeys,
      ...args.dayStatus.pendingDateKeys,
    ]).filter((dateKey) => dateKey > args.persistedSpan.endDate),
    args.dayStatus.window
  );
}

/** In-span incomplete days plus tail-extension days after persisted coverage end. */
export function resolveSmtHealBackfillDateKeysWithTailExtension(args: {
  dayStatus: SmtWindowStatusSnapshot;
  persistedSpan: SmtPersistedCoverageSpan | null;
  extraDateKeys?: string[];
}): string[] {
  const inSpan = resolveSmtHealBackfillDateKeys(args);
  if (!args.persistedSpan) return inSpan;
  return normalizeDateKeys([
    ...inSpan,
    ...resolveSmtTailExtensionHealDateKeys({
      dayStatus: args.dayStatus,
      persistedSpan: args.persistedSpan,
    }),
  ]);
}

export function shouldUseTargetedTailGapHealOnly(args: {
  profile: "user_session" | "user_refresh" | "sim_run" | "admin_sim";
  tailGapOnly?: boolean;
  tailOnlyUserHeal: boolean;
  backfillDateKeys: string[];
  spanBehindCanonicalEnd: boolean;
}): boolean {
  const userFacing = args.profile === "user_session" || args.profile === "user_refresh";
  if (!userFacing) return false;
  if (args.profile === "user_refresh" && args.tailGapOnly !== true) return false;
  if (args.tailOnlyUserHeal) return true;
  if (args.backfillDateKeys.length > 0) return true;
  return args.spanBehindCanonicalEnd;
}

/** True when heal only needs calendar days after persisted span end (typical 1–2 day SMT lag). */
export function isTailOnlySmtHealRequest(args: {
  dayStatus: SmtWindowStatusSnapshot;
  persistedSpan: SmtPersistedCoverageSpan | null;
  backfillDateKeys: string[];
}): boolean {
  if (!args.persistedSpan || args.backfillDateKeys.length === 0) return false;
  const inSpanKeys = resolveSmtHealBackfillDateKeys({
    dayStatus: args.dayStatus,
    persistedSpan: args.persistedSpan,
  });
  if (inSpanKeys.length > 0) return false;
  return args.backfillDateKeys.every((dateKey) => dateKey > args.persistedSpan!.endDate);
}

/** True when persisted SMT data has reached and completed the canonical window end day. */
export function isSmtHealScopeReady(
  dayStatus: SmtWindowStatusSnapshot,
  persistedSpan: SmtPersistedCoverageSpan | null
): boolean {
  if (!persistedSpan) return false;
  if (persistedSpan.endDate < dayStatus.window.endDate) return false;
  if (!dayStatus.canonicalEndDayComplete) return false;
  return resolveSmtHealBackfillDateKeysWithTailExtension({ dayStatus, persistedSpan }).length === 0;
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
  const windowStatus = await loadSmtWindowDayStatus({ esiid: args.esiid, dateKeys: args.dateKeys });
  const countsByDate = Object.fromEntries(
    windowStatus.dateKeys.map((dateKey) => [dateKey, windowStatus.byDate[dateKey]?.intervalCount ?? 0])
  );
  const missingSlotsByDate = Object.fromEntries(
    windowStatus.dateKeys.map((dateKey) => [dateKey, windowStatus.byDate[dateKey]?.missingSlots ?? []])
  );
  return {
    dateKeys: windowStatus.dateKeys,
    countsByDate,
    missingSlotsByDate,
    incompleteDateKeys: windowStatus.incompleteDateKeys,
    ready: windowStatus.ready,
  };
}

export async function loadSmtTailCoverage(args: {
  esiid: string;
  targetEndDate?: string;
}): Promise<SmtTailCoverageSnapshot> {
  const targetEndDate = args.targetEndDate ?? resolveSmtCanonicalWindow().endDate;
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
  const tailWindowStatus = await loadSmtWindowDayStatus({ esiid: args.esiid, dateKeys: tailDateKeys });
  const tailCountsByDate = Object.fromEntries(
    tailDateKeys.map((dateKey) => [dateKey, tailWindowStatus.byDate[dateKey]?.intervalCount ?? 0])
  );
  const incompleteTailDateKeys = tailWindowStatus.incompleteDateKeys;
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
  const targetEndDate = args.targetEndDate ?? resolveSmtCanonicalWindow().endDate;
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

/** @deprecated Prefer ensureSmtCoverageForHouse; retained as legacy wrapper for internal callers. */
export async function ensureSmtTailCoverageForUserHouse(args: {
  userId: string;
  houseId: string;
  esiid: string;
  targetEndDate?: string;
  waitTimeoutMs?: number;
  requestRefreshIfNeeded?: boolean;
}): Promise<SmtTailEnsureResult> {
  const targetEndDate = args.targetEndDate ?? resolveSmtCanonicalWindow().endDate;
  if (args.requestRefreshIfNeeded === false) {
    const coverage = await loadSmtTailCoverage({ esiid: args.esiid, targetEndDate });
    return {
      attempted: false,
      reason: "refresh_disabled",
      coverage,
      wait: null,
    };
  }

  const { ensureSmtCoverageForHouse } = await import("@/lib/usage/ensureSmtCoverage");
  const ensure = await ensureSmtCoverageForHouse({
    userId: args.userId,
    houseId: args.houseId,
    profile: "user_session",
    sessionKey: `legacy_tail:${args.houseId}:${targetEndDate}`,
  });
  const coverage = await loadSmtTailCoverage({ esiid: args.esiid, targetEndDate });
  if (!ensure.healed) {
    return {
      attempted: false,
      reason: "coverage_tail_current",
      coverage,
      wait: null,
      refreshResult: ensure.refreshResult,
    };
  }
  return {
    attempted: true,
    reason: "refresh_requested",
    coverage,
    wait: {
      ...coverage,
      timedOut: Boolean(ensure.tailWaitTimedOut || ensure.incompleteMeterWaitTimedOut),
      attempts: 0,
      durationMs: 0,
    },
    refreshResult: ensure.refreshResult,
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

export function buildUsageIngestionStatusFromEnsure(
  ensure: import("@/lib/usage/ensureSmtCoverage").EnsureSmtCoverageResult,
  ledger?: { pendingDateKeys?: string[]; incompleteMeterDateKeys?: string[] } | null
): UsageIngestionStatusLike & {
  smtPendingIntervalDateKeys: string[];
  smtIncompleteMeterDateKeys: string[];
} {
  const dayStatus = ensure.dayStatus;
  const tailRefreshReason: UsageIngestionStatusLike["tailRefreshReason"] = ensure.healed
    ? "refresh_requested"
    : "coverage_tail_current";
  return {
    tailReady: dayStatus.ready && dayStatus.canonicalEndDayComplete,
    targetEndDate: ensure.window.endDate,
    tailRefreshAttempted: ensure.healed,
    tailRefreshReason,
    tailTimedOut: Boolean(ensure.tailWaitTimedOut || ensure.incompleteMeterWaitTimedOut),
    incompleteTailDateKeys: dayStatus.incompleteDateKeys,
    coverageEndDate: ensure.window.endDate,
    smtPendingIntervalDateKeys: dayStatus.pendingDateKeys.length
      ? dayStatus.pendingDateKeys
      : (ledger?.pendingDateKeys ?? []),
    smtIncompleteMeterDateKeys: dayStatus.incompleteMeterDateKeys.length
      ? dayStatus.incompleteMeterDateKeys
      : (ledger?.incompleteMeterDateKeys ?? []),
  };
}
