import { prisma } from "@/lib/db";
import {
  enumerateDateKeysInclusive,
  loadSmtDateCoverage,
  SMT_TAIL_REQUIRED_INTERVALS_PER_DAY,
  smtCoverageDateKey,
  waitForSmtDateCoverage,
} from "@/lib/usage/smtTailCoverage";
import {
  requestUsageRefreshForUserHouse,
  type UsageRefreshResult,
} from "@/lib/usage/userUsageRefresh";
import { resolveCanonicalUsage365CoverageWindow } from "@/modules/usageSimulator/metadataWindow";

export const SMT_DAY_LEDGER_STATUS = {
  COMPLETE: "COMPLETE",
  PENDING_SMT: "PENDING_SMT",
  INCOMPLETE_METER: "INCOMPLETE_METER",
} as const;

export type SmtDayLedgerStatus = (typeof SMT_DAY_LEDGER_STATUS)[keyof typeof SMT_DAY_LEDGER_STATUS];

export const ACTUAL_SMT_SOURCE_DETAIL = {
  /** @deprecated Prefer SIMULATED_SMT_SOURCE_DETAIL for pending tail days. */
  INTERVALS_NOT_AVAILABLE_YET: "ACTUAL_INTERVALS_NOT_AVAILABLE_YET",
  INCOMPLETE_METER: "ACTUAL_INCOMPLETE_METER",
} as const;

export const SIMULATED_SMT_SOURCE_DETAIL = {
  INTERVALS_NOT_AVAILABLE_YET: "SIMULATED_INTERVALS_NOT_AVAILABLE_YET",
} as const;

export type ActualSmtDailySourceDetail =
  (typeof ACTUAL_SMT_SOURCE_DETAIL)[keyof typeof ACTUAL_SMT_SOURCE_DETAIL];

export type SimulatedSmtDailySourceDetail =
  (typeof SIMULATED_SMT_SOURCE_DETAIL)[keyof typeof SIMULATED_SMT_SOURCE_DETAIL];

export type SmtDayLedgerSnapshot = {
  canonicalEndDate: string;
  byDate: Record<string, SmtDayLedgerStatus>;
  pendingDateKeys: string[];
  incompleteMeterDateKeys: string[];
};

export type SmtDayLedgerReconcileResult = SmtDayLedgerSnapshot & {
  updatedDateKeys: string[];
};

export type SmtDeferredPendingRepairResult = {
  attempted: boolean;
  eligibleDateKeys: string[];
  pullDateKey: string;
  refreshResult?: UsageRefreshResult;
  waitTimedOut?: boolean;
  reconcile?: SmtDayLedgerReconcileResult;
};

function normalizeEsiid(value: unknown): string {
  return String(value ?? "").trim();
}

export function chicagoPullDateKey(now = new Date()): string {
  return smtCoverageDateKey(now) ?? now.toISOString().slice(0, 10);
}

export function isSmtDayLedgerSettledForTail(status: string | null | undefined): boolean {
  const normalized = String(status ?? "").trim().toUpperCase();
  return (
    normalized === SMT_DAY_LEDGER_STATUS.PENDING_SMT ||
    normalized === SMT_DAY_LEDGER_STATUS.INCOMPLETE_METER
  );
}

export function sourceDetailForSmtLedgerStatus(
  status: SmtDayLedgerStatus | null | undefined
): ActualSmtDailySourceDetail | SimulatedSmtDailySourceDetail | undefined {
  if (status === SMT_DAY_LEDGER_STATUS.PENDING_SMT) {
    return SIMULATED_SMT_SOURCE_DETAIL.INTERVALS_NOT_AVAILABLE_YET;
  }
  if (status === SMT_DAY_LEDGER_STATUS.INCOMPLETE_METER) {
    return ACTUAL_SMT_SOURCE_DETAIL.INCOMPLETE_METER;
  }
  return undefined;
}

export function displayLabelForSmtSourceDetail(sourceDetail: string | null | undefined): string | null {
  if (
    sourceDetail === SIMULATED_SMT_SOURCE_DETAIL.INTERVALS_NOT_AVAILABLE_YET ||
    sourceDetail === ACTUAL_SMT_SOURCE_DETAIL.INTERVALS_NOT_AVAILABLE_YET
  ) {
    return "Intervals not available yet";
  }
  if (sourceDetail === ACTUAL_SMT_SOURCE_DETAIL.INCOMPLETE_METER) {
    return "Incomplete meter";
  }
  return null;
}

/** @deprecated Use displayLabelForSmtSourceDetail */
export function displayLabelForActualSmtSourceDetail(sourceDetail: string | null | undefined): string | null {
  return displayLabelForSmtSourceDetail(sourceDetail);
}

async function loadLedgerRowsForWindow(args: { esiid: string; startDate: string; endDate: string }) {
  return prisma.smtIntervalDayLedger
    .findMany({
      where: {
        esiid: args.esiid,
        dateKey: { gte: args.startDate, lte: args.endDate },
      },
    })
    .catch(() => []);
}

async function upsertLedgerRow(args: {
  esiid: string;
  dateKey: string;
  status: SmtDayLedgerStatus;
  intervalCount: number;
  firstSeenAsCanonicalWindowEnd?: boolean;
  repairAttemptedAt?: Date | null;
  repairAttemptedOnPullDate?: string | null;
}) {
  const existing = await prisma.smtIntervalDayLedger
    .findUnique({
      where: { esiid_dateKey: { esiid: args.esiid, dateKey: args.dateKey } },
    })
    .catch(() => null);

  const data = {
    status: args.status,
    intervalCountAtLastCheck: args.intervalCount,
    ...(args.repairAttemptedAt !== undefined ? { repairAttemptedAt: args.repairAttemptedAt } : {}),
    ...(args.repairAttemptedOnPullDate !== undefined
      ? { repairAttemptedOnPullDate: args.repairAttemptedOnPullDate }
      : {}),
  };

  if (existing) {
    await prisma.smtIntervalDayLedger.update({
      where: { id: existing.id },
      data,
    });
    return;
  }

  await prisma.smtIntervalDayLedger.create({
    data: {
      esiid: args.esiid,
      dateKey: args.dateKey,
      status: args.status,
      intervalCountAtLastCheck: args.intervalCount,
      firstSeenAsCanonicalWindowEnd: args.firstSeenAsCanonicalWindowEnd ?? false,
      repairAttemptedAt: args.repairAttemptedAt ?? null,
      repairAttemptedOnPullDate: args.repairAttemptedOnPullDate ?? null,
    },
  });
}

export async function loadSmtDayLedgerStatusForDate(args: {
  esiid: string;
  dateKey: string;
}): Promise<SmtDayLedgerStatus | null> {
  const esiid = normalizeEsiid(args.esiid);
  if (!esiid) return null;
  const row = await prisma.smtIntervalDayLedger
    .findUnique({
      where: { esiid_dateKey: { esiid, dateKey: args.dateKey } },
      select: { status: true },
    })
    .catch(() => null);
  const status = String(row?.status ?? "").trim().toUpperCase();
  if (status === SMT_DAY_LEDGER_STATUS.COMPLETE) return SMT_DAY_LEDGER_STATUS.COMPLETE;
  if (status === SMT_DAY_LEDGER_STATUS.PENDING_SMT) return SMT_DAY_LEDGER_STATUS.PENDING_SMT;
  if (status === SMT_DAY_LEDGER_STATUS.INCOMPLETE_METER) return SMT_DAY_LEDGER_STATUS.INCOMPLETE_METER;
  return null;
}

function snapshotFromRows(args: {
  canonicalEndDate: string;
  rows: Array<{ dateKey: string; status: string }>;
}): SmtDayLedgerSnapshot {
  const byDate: Record<string, SmtDayLedgerStatus> = {};
  const pendingDateKeys: string[] = [];
  const incompleteMeterDateKeys: string[] = [];
  for (const row of args.rows) {
    const status = String(row.status ?? "").trim().toUpperCase() as SmtDayLedgerStatus;
    if (
      status !== SMT_DAY_LEDGER_STATUS.COMPLETE &&
      status !== SMT_DAY_LEDGER_STATUS.PENDING_SMT &&
      status !== SMT_DAY_LEDGER_STATUS.INCOMPLETE_METER
    ) {
      continue;
    }
    byDate[row.dateKey] = status;
    if (status === SMT_DAY_LEDGER_STATUS.PENDING_SMT) pendingDateKeys.push(row.dateKey);
    if (status === SMT_DAY_LEDGER_STATUS.INCOMPLETE_METER) incompleteMeterDateKeys.push(row.dateKey);
  }
  pendingDateKeys.sort();
  incompleteMeterDateKeys.sort();
  return {
    canonicalEndDate: args.canonicalEndDate,
    byDate,
    pendingDateKeys,
    incompleteMeterDateKeys,
  };
}

/**
 * Reconcile persisted interval counts with the SMT day ledger for the canonical 365 window.
 * Partial days at the canonical end become PENDING_SMT; other partial days become INCOMPLETE_METER immediately.
 */
export async function reconcileSmtIntervalDayLedger(args: {
  esiid: string;
  canonicalEndDate?: string;
  canonicalStartDate?: string;
}): Promise<SmtDayLedgerReconcileResult> {
  const esiid = normalizeEsiid(args.esiid);
  const canonical = resolveCanonicalUsage365CoverageWindow();
  const canonicalEndDate = args.canonicalEndDate ?? canonical.endDate;
  const canonicalStartDate = args.canonicalStartDate ?? canonical.startDate;
  const dateKeys = enumerateDateKeysInclusive(canonicalStartDate, canonicalEndDate);
  const updatedDateKeys: string[] = [];

  if (!esiid || dateKeys.length === 0) {
    return {
      canonicalEndDate,
      byDate: {},
      pendingDateKeys: [],
      incompleteMeterDateKeys: [],
      updatedDateKeys,
    };
  }

  const coverage = await loadSmtDateCoverage({ esiid, dateKeys });
  const existingRows = await loadLedgerRowsForWindow({
    esiid,
    startDate: canonicalStartDate,
    endDate: canonicalEndDate,
  });
  const existingByDate = new Map(existingRows.map((row) => [row.dateKey, row]));

  for (const dateKey of dateKeys) {
    const intervalCount = coverage.countsByDate[dateKey] ?? 0;
    const existing = existingByDate.get(dateKey);
    const existingStatus = String(existing?.status ?? "").trim().toUpperCase() as SmtDayLedgerStatus;

    let nextStatus: SmtDayLedgerStatus;
    let firstSeenAsCanonicalWindowEnd = existing?.firstSeenAsCanonicalWindowEnd ?? false;

    if (intervalCount >= SMT_TAIL_REQUIRED_INTERVALS_PER_DAY) {
      nextStatus = SMT_DAY_LEDGER_STATUS.COMPLETE;
    } else if (dateKey === canonicalEndDate) {
      // Canonical tail: pending until one deferred repair is recorded, even if previously incomplete.
      nextStatus =
        existing?.repairAttemptedAt != null
          ? SMT_DAY_LEDGER_STATUS.INCOMPLETE_METER
          : SMT_DAY_LEDGER_STATUS.PENDING_SMT;
      firstSeenAsCanonicalWindowEnd = true;
    } else if (existingStatus === SMT_DAY_LEDGER_STATUS.PENDING_SMT) {
      nextStatus =
        existing?.repairAttemptedAt != null
          ? SMT_DAY_LEDGER_STATUS.INCOMPLETE_METER
          : SMT_DAY_LEDGER_STATUS.PENDING_SMT;
    } else if (existingStatus === SMT_DAY_LEDGER_STATUS.INCOMPLETE_METER) {
      nextStatus = SMT_DAY_LEDGER_STATUS.INCOMPLETE_METER;
    } else {
      nextStatus = SMT_DAY_LEDGER_STATUS.INCOMPLETE_METER;
    }

    const statusChanged = existingStatus !== nextStatus;
    const countChanged = (existing?.intervalCountAtLastCheck ?? -1) !== intervalCount;
    if (!existing || statusChanged || countChanged) {
      await upsertLedgerRow({
        esiid,
        dateKey,
        status: nextStatus,
        intervalCount,
        firstSeenAsCanonicalWindowEnd,
        repairAttemptedAt: existing?.repairAttemptedAt ?? null,
        repairAttemptedOnPullDate: existing?.repairAttemptedOnPullDate ?? null,
      });
      updatedDateKeys.push(dateKey);
    }
  }

  const rows = await loadLedgerRowsForWindow({
    esiid,
    startDate: canonicalStartDate,
    endDate: canonicalEndDate,
  });
  return {
    ...snapshotFromRows({ canonicalEndDate, rows }),
    updatedDateKeys,
  };
}

export async function resolveSmtLedgerDateKeysForPastSim(args: {
  esiid: string;
  coverageStartDate: string;
  coverageEndDate: string;
  reconcile?: boolean;
}): Promise<{
  ledger: SmtDayLedgerSnapshot;
  pendingDateKeys: Set<string>;
  incompleteMeterDateKeys: Set<string>;
}> {
  const ledger = args.reconcile
    ? await reconcileSmtIntervalDayLedger({
        esiid: args.esiid,
        canonicalStartDate: args.coverageStartDate,
        canonicalEndDate: args.coverageEndDate,
      })
    : await loadSmtDayLedgerSnapshot({
        esiid: args.esiid,
        canonicalStartDate: args.coverageStartDate,
        canonicalEndDate: args.coverageEndDate,
      });
  const pendingDateKeys = new Set(ledger.pendingDateKeys);
  const incompleteMeterDateKeys = new Set(
    ledger.incompleteMeterDateKeys.filter((dateKey) => !pendingDateKeys.has(dateKey))
  );
  return { ledger, pendingDateKeys, incompleteMeterDateKeys };
}

export function smtPendingIntervalDateKeysFromMeta(meta: Record<string, unknown> | null | undefined): Set<string> {
  const pending = new Set<string>();
  const keys = Array.isArray(meta?.smtPendingIntervalDateKeys) ? meta.smtPendingIntervalDateKeys : [];
  for (const value of keys) {
    const dateKey = String(value ?? "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) pending.add(dateKey);
  }
  const byDate =
    meta?.smtDayLedgerStatusByDate &&
    typeof meta.smtDayLedgerStatusByDate === "object" &&
    !Array.isArray(meta.smtDayLedgerStatusByDate)
      ? (meta.smtDayLedgerStatusByDate as Record<string, unknown>)
      : null;
  if (byDate) {
    for (const [dateKey, status] of Object.entries(byDate)) {
      if (String(status ?? "").trim().toUpperCase() === SMT_DAY_LEDGER_STATUS.PENDING_SMT) {
        pending.add(dateKey.slice(0, 10));
      }
    }
  }
  return pending;
}

export async function loadSmtDayLedgerSnapshot(args: {
  esiid: string;
  canonicalEndDate?: string;
  canonicalStartDate?: string;
}): Promise<SmtDayLedgerSnapshot> {
  const esiid = normalizeEsiid(args.esiid);
  const canonical = resolveCanonicalUsage365CoverageWindow();
  const canonicalEndDate = args.canonicalEndDate ?? canonical.endDate;
  const canonicalStartDate = args.canonicalStartDate ?? canonical.startDate;
  if (!esiid) {
    return {
      canonicalEndDate,
      byDate: {},
      pendingDateKeys: [],
      incompleteMeterDateKeys: [],
    };
  }
  const rows = await loadLedgerRowsForWindow({
    esiid,
    startDate: canonicalStartDate,
    endDate: canonicalEndDate,
  });
  return snapshotFromRows({ canonicalEndDate, rows });
}

async function listEligiblePendingRepairDateKeys(args: {
  esiid: string;
  pullDateKey: string;
}): Promise<string[]> {
  const esiid = normalizeEsiid(args.esiid);
  if (!esiid) return [];
  const rows = await prisma.smtIntervalDayLedger
    .findMany({
      where: {
        esiid,
        status: SMT_DAY_LEDGER_STATUS.PENDING_SMT,
        repairAttemptedAt: null,
      },
      select: { dateKey: true },
    })
    .catch(() => []);
  return rows
    .map((row) => row.dateKey)
    .filter((dateKey) => args.pullDateKey > dateKey)
    .sort();
}

/** After an SMT pull on a later calendar day, mark repair attempted and settle pending days. */
export async function finalizeDeferredPendingRepairsAfterPull(args: {
  esiid: string;
  pullDateKey?: string;
  waitTimeoutMs?: number;
}): Promise<SmtDeferredPendingRepairResult> {
  const esiid = normalizeEsiid(args.esiid);
  const pullDateKey = args.pullDateKey ?? chicagoPullDateKey();
  const canonical = resolveCanonicalUsage365CoverageWindow();

  const snapshot = await reconcileSmtIntervalDayLedger({
    esiid,
    canonicalEndDate: canonical.endDate,
    canonicalStartDate: canonical.startDate,
  });

  const eligibleDateKeys = await listEligiblePendingRepairDateKeys({ esiid, pullDateKey });
  if (!esiid || eligibleDateKeys.length === 0) {
    return { attempted: false, eligibleDateKeys: [], pullDateKey, reconcile: snapshot };
  }

  const repairAttemptedAt = new Date();
  for (const dateKey of eligibleDateKeys) {
    await prisma.smtIntervalDayLedger
      .updateMany({
        where: { esiid, dateKey, repairAttemptedAt: null },
        data: {
          repairAttemptedAt,
          repairAttemptedOnPullDate: pullDateKey,
        },
      })
      .catch(() => null);
  }

  const waitTimeoutMs = args.waitTimeoutMs ?? 12_000;
  const wait =
    waitTimeoutMs > 0
      ? await waitForSmtDateCoverage({
          esiid,
          dateKeys: eligibleDateKeys,
          timeoutMs: waitTimeoutMs,
        })
      : null;

  const finalReconcile = await reconcileSmtIntervalDayLedger({
    esiid,
    canonicalEndDate: canonical.endDate,
    canonicalStartDate: canonical.startDate,
  });

  return {
    attempted: true,
    eligibleDateKeys,
    pullDateKey,
    waitTimedOut: wait?.timedOut,
    reconcile: finalReconcile,
  };
}

/** Request a fresh SMT pull, then settle eligible pending days (used by tail ensure / admin). */
export async function runDeferredPendingSmtDayRepairs(args: {
  esiid: string;
  userId: string;
  houseId: string;
  pullDateKey?: string;
  waitTimeoutMs?: number;
}): Promise<SmtDeferredPendingRepairResult> {
  const esiid = normalizeEsiid(args.esiid);
  const pullDateKey = args.pullDateKey ?? chicagoPullDateKey();
  const eligibleDateKeys = await listEligiblePendingRepairDateKeys({ esiid, pullDateKey });
  if (!esiid || eligibleDateKeys.length === 0) {
    const reconcile = await reconcileSmtIntervalDayLedger({ esiid });
    return { attempted: false, eligibleDateKeys: [], pullDateKey, reconcile };
  }

  const refreshResult = await requestUsageRefreshForUserHouse({
    userId: args.userId,
    houseId: args.houseId,
  });

  const finalized = await finalizeDeferredPendingRepairsAfterPull({
    esiid,
    pullDateKey,
    waitTimeoutMs: args.waitTimeoutMs,
  });

  return {
    ...finalized,
    refreshResult,
  };
}

export type AnnotatedActualDailyRow = {
  date: string;
  kwh: number;
  source?: "ACTUAL" | "SIMULATED";
  sourceDetail?: ActualSmtDailySourceDetail | SimulatedSmtDailySourceDetail;
};

export function annotateActualDailyWithSmtLedger(
  daily: Array<{ date: string; kwh: number }>,
  ledger: SmtDayLedgerSnapshot
): AnnotatedActualDailyRow[] {
  return daily.map((row) => {
    const date = String(row.date).slice(0, 10);
    const status = ledger.byDate[date];
    const sourceDetail = sourceDetailForSmtLedgerStatus(status);
    if (!sourceDetail) return { ...row };
    if (status === SMT_DAY_LEDGER_STATUS.PENDING_SMT) {
      return {
        date,
        kwh: Number(row.kwh) || 0,
        source: "SIMULATED" as const,
        sourceDetail: SIMULATED_SMT_SOURCE_DETAIL.INTERVALS_NOT_AVAILABLE_YET,
      };
    }
    return {
      date,
      kwh: Number(row.kwh) || 0,
      source: "ACTUAL" as const,
      sourceDetail: sourceDetail as ActualSmtDailySourceDetail,
    };
  });
}

export function smtLedgerFieldsFromDatasetMeta(dataset: unknown): {
  pendingDateKeys: string[];
  incompleteMeterDateKeys: string[];
} {
  const meta =
    dataset && typeof dataset === "object" && !Array.isArray(dataset)
      ? ((dataset as Record<string, unknown>).meta as Record<string, unknown> | undefined)
      : undefined;
  const pending = Array.isArray(meta?.smtPendingIntervalDateKeys) ? meta.smtPendingIntervalDateKeys : [];
  const incomplete = Array.isArray(meta?.smtIncompleteMeterDateKeys) ? meta.smtIncompleteMeterDateKeys : [];
  return {
    pendingDateKeys: pending.map((v) => String(v).slice(0, 10)).filter((v) => /^\d{4}-\d{2}-\d{2}$/.test(v)),
    incompleteMeterDateKeys: incomplete.map((v) => String(v).slice(0, 10)).filter((v) => /^\d{4}-\d{2}-\d{2}$/.test(v)),
  };
}

export function buildSmtDayLedgerMeta(ledger: SmtDayLedgerSnapshot): Record<string, unknown> {
  return {
    smtDayLedgerStatusByDate: ledger.byDate,
    smtPendingIntervalDateKeys: ledger.pendingDateKeys,
    smtIncompleteMeterDateKeys: ledger.incompleteMeterDateKeys,
    smtCanonicalEndDate: ledger.canonicalEndDate,
  };
}

export async function applySmtLedgerToActualDataset(args: {
  dataset: { daily?: Array<{ date: string; kwh: number }>; meta?: Record<string, unknown> | null } | null;
  esiid: string | null;
  reconcile?: boolean;
}): Promise<void> {
  const esiid = normalizeEsiid(args.esiid);
  if (!esiid || !args.dataset || !Array.isArray(args.dataset.daily)) return;

  const ledger = args.reconcile
    ? await reconcileSmtIntervalDayLedger({ esiid })
    : await loadSmtDayLedgerSnapshot({ esiid });

  args.dataset.daily = annotateActualDailyWithSmtLedger(args.dataset.daily, ledger);
  args.dataset.meta = {
    ...(args.dataset.meta ?? {}),
    ...buildSmtDayLedgerMeta(ledger),
  };
}

export async function reconcileSmtLedgerAfterPersist(args: { esiids: string[] }): Promise<void> {
  const unique = Array.from(new Set(args.esiids.map(normalizeEsiid).filter(Boolean)));
  await Promise.all(unique.map((esiid) => reconcileSmtIntervalDayLedger({ esiid }).catch(() => null)));
}
