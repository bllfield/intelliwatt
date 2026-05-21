import { prisma } from "@/lib/db";
import {
  reconcileSmtIntervalDayLedger,
  runDeferredPendingSmtDayRepairs,
  type SmtDayLedgerReconcileResult,
  type SmtDeferredPendingRepairResult,
} from "@/lib/usage/smtDayCoverageLedger";
import {
  requestTargetedSmtIntervalBackfillForHouse,
  type TargetedSmtIntervalBackfillResult,
} from "@/lib/usage/smtIncompleteMeterBackfill";
import {
  loadSmtWindowDayStatus,
  resolveSmtCanonicalWindow,
  resolveSmtPersistedCoverageSpan,
  type SmtCanonicalWindow,
  type SmtWindowStatusSnapshot,
} from "@/lib/usage/smtWindowStatus";
import {
  isSmtHealScopeReady,
  ONE_PATH_ADMIN_SMT_INCOMPLETE_METER_WAIT_TIMEOUT_MS,
  resolveSmtHealBackfillDateKeys,
  ONE_PATH_ADMIN_SMT_TAIL_WAIT_TIMEOUT_MS,
  SMT_POST_BACKFILL_SETTLE_DELAY_MS,
  SMT_TAIL_WAIT_INTERVAL_MS,
  USER_USAGE_DEFERRED_REPAIR_WAIT_MS,
  USER_USAGE_SMT_TAIL_WAIT_TIMEOUT_MS,
  waitForSmtDateCoverage,
  waitForSmtTailCoverage,
} from "@/lib/usage/smtTailCoverage";
import {
  requestUsageRefreshForUserHouse,
  type UsageRefreshResult,
} from "@/lib/usage/userUsageRefresh";

export type EnsureSmtCoverageProfile = "user_session" | "sim_run" | "admin_sim";

export type EnsureSmtCoverageSkippedReason = "session_throttle" | "no_esiid" | "window_ready";

export type EnsureSmtCoverageResult = {
  healed: boolean;
  skippedReason?: EnsureSmtCoverageSkippedReason;
  dayStatus: SmtWindowStatusSnapshot;
  window: SmtCanonicalWindow;
  refreshResult?: UsageRefreshResult;
  targetedBackfill?: TargetedSmtIntervalBackfillResult;
  postTargetedBackfillRefreshResult?: UsageRefreshResult;
  deferredRepair?: SmtDeferredPendingRepairResult;
  reconcile?: SmtDayLedgerReconcileResult;
  backfillDateKeys?: string[];
  tailWaitTimedOut?: boolean;
  incompleteMeterWaitTimedOut?: boolean;
};

const healedSessionKeys = new Set<string>();

export function clearEnsureSmtCoverageSessionThrottleForTests(): void {
  healedSessionKeys.clear();
}

function sessionThrottleKey(userId: string, houseId: string, sessionKey: string): string {
  return `${userId}|${houseId}|${sessionKey}`;
}

function waitBudgetForProfile(profile: EnsureSmtCoverageProfile): {
  tailWaitMs: number;
  incompleteMeterWaitMs: number;
  deferredWaitMs: number;
  tailExitEarlyWhenStalled: boolean;
} {
  if (profile === "user_session") {
    return {
      tailWaitMs: USER_USAGE_SMT_TAIL_WAIT_TIMEOUT_MS,
      incompleteMeterWaitMs: USER_USAGE_SMT_TAIL_WAIT_TIMEOUT_MS,
      deferredWaitMs: USER_USAGE_DEFERRED_REPAIR_WAIT_MS,
      tailExitEarlyWhenStalled: true,
    };
  }
  return {
    tailWaitMs: ONE_PATH_ADMIN_SMT_TAIL_WAIT_TIMEOUT_MS,
    incompleteMeterWaitMs: ONE_PATH_ADMIN_SMT_INCOMPLETE_METER_WAIT_TIMEOUT_MS,
    deferredWaitMs: ONE_PATH_ADMIN_SMT_TAIL_WAIT_TIMEOUT_MS,
    tailExitEarlyWhenStalled: false,
  };
}

async function resolveEsiidForHouse(houseId: string): Promise<string | null> {
  const house = await prisma.houseAddress
    .findFirst({
      where: { id: houseId, archivedAt: null },
      select: { esiid: true },
    })
    .catch(() => null);
  const esiid = house?.esiid ? String(house.esiid).trim() : "";
  return esiid || null;
}

async function tryUsageRefreshForHouse(args: {
  userId: string;
  houseId: string;
  skipGapFill?: boolean;
  sessionKey?: string;
}): Promise<UsageRefreshResult | undefined> {
  try {
    return await requestUsageRefreshForUserHouse(args);
  } catch {
    return undefined;
  }
}

function emptyWindowStatus(window: SmtCanonicalWindow): SmtWindowStatusSnapshot {
  return {
    window,
    dateKeys: [],
    byDate: {},
    completeDateKeys: [],
    incompleteDateKeys: [],
    pendingDateKeys: [],
    incompleteMeterDateKeys: [],
    canonicalEndDayComplete: false,
    ready: true,
  };
}

export async function ensureSmtCoverageForHouse(args: {
  userId: string;
  houseId: string;
  profile: EnsureSmtCoverageProfile;
  force?: boolean;
  sessionKey?: string;
  /** Optional sim/UI incomplete-day hints merged before near-end filtering. */
  extraBackfillDateKeys?: string[];
  /** When true, skip pull/authorization refresh (caller already ran requestUsageRefreshForUserHouse). */
  skipUsageRefresh?: boolean;
}): Promise<EnsureSmtCoverageResult> {
  const window = resolveSmtCanonicalWindow();
  const esiid = await resolveEsiidForHouse(args.houseId);
  if (!esiid) {
    return {
      healed: false,
      skippedReason: "no_esiid",
      dayStatus: emptyWindowStatus(window),
      window,
    };
  }

  let dayStatus = await loadSmtWindowDayStatus({ esiid });
  const persistedSpan = await resolveSmtPersistedCoverageSpan(esiid);
  const sessionKey = String(args.sessionKey ?? args.profile).trim() || args.profile;
  const throttleKey = sessionThrottleKey(args.userId, args.houseId, sessionKey);
  const healScopeReady = isSmtHealScopeReady(dayStatus, persistedSpan);

  if (!args.force) {
    if (healedSessionKeys.has(throttleKey)) {
      return {
        healed: false,
        skippedReason: "session_throttle",
        dayStatus,
        window,
      };
    }
    if (healScopeReady) {
      healedSessionKeys.add(throttleKey);
      return {
        healed: false,
        skippedReason: "window_ready",
        dayStatus,
        window,
      };
    }
  }

  const waits = waitBudgetForProfile(args.profile);
  const backfillDateKeys = resolveSmtHealBackfillDateKeys({
    dayStatus,
    persistedSpan,
    extraDateKeys: args.extraBackfillDateKeys,
  });

  let refreshResult: UsageRefreshResult | undefined;
  let targetedBackfill: TargetedSmtIntervalBackfillResult | undefined;
  let postTargetedBackfillRefreshResult: UsageRefreshResult | undefined;
  let deferredRepair: SmtDeferredPendingRepairResult | undefined;
  let reconcile: SmtDayLedgerReconcileResult | undefined;
  let tailWaitTimedOut = false;
  let incompleteMeterWaitTimedOut = false;

  if (!args.skipUsageRefresh) {
    refreshResult = await tryUsageRefreshForHouse({
      userId: args.userId,
      houseId: args.houseId,
      sessionKey,
      skipGapFill: true,
    });
  }

  if (backfillDateKeys.length > 0) {
    targetedBackfill = await requestTargetedSmtIntervalBackfillForHouse({
      houseId: args.houseId,
      dateKeys: backfillDateKeys,
    }).catch((error) => ({
      ok: false as const,
      skipped: "targeted_backfill_failed",
      message: error instanceof Error ? error.message : String(error),
    }));

    postTargetedBackfillRefreshResult = await tryUsageRefreshForHouse({
      userId: args.userId,
      houseId: args.houseId,
      skipGapFill: true,
      sessionKey,
    });
    if (postTargetedBackfillRefreshResult && postTargetedBackfillRefreshResult.ok !== false) {
      refreshResult = postTargetedBackfillRefreshResult;
    }

    const incompleteWait = await waitForSmtDateCoverage({
      esiid,
      dateKeys: backfillDateKeys,
      timeoutMs: waits.incompleteMeterWaitMs,
      intervalMs: SMT_TAIL_WAIT_INTERVAL_MS,
      initialDelayMs: SMT_POST_BACKFILL_SETTLE_DELAY_MS,
      exitEarlyWhenStalled: false,
    });
    incompleteMeterWaitTimedOut = incompleteWait.timedOut;
  }

  deferredRepair = await runDeferredPendingSmtDayRepairs({
    esiid,
    userId: args.userId,
    houseId: args.houseId,
    waitTimeoutMs: waits.deferredWaitMs,
  }).catch(() => ({
    attempted: false,
    eligibleDateKeys: [],
    pullDateKey: "",
  }));

  reconcile =
    deferredRepair.reconcile ??
    (await reconcileSmtIntervalDayLedger({
      esiid,
      canonicalStartDate: window.startDate,
      canonicalEndDate: window.endDate,
    }).catch(() => null)) ??
    undefined;

  const tailWait = await waitForSmtTailCoverage({
    esiid,
    targetEndDate: window.endDate,
    timeoutMs: waits.tailWaitMs,
    intervalMs: SMT_TAIL_WAIT_INTERVAL_MS,
    exitEarlyWhenStalled: waits.tailExitEarlyWhenStalled,
  });
  tailWaitTimedOut = tailWait.timedOut;

  dayStatus = await loadSmtWindowDayStatus({ esiid });
  healedSessionKeys.add(throttleKey);

  return {
    healed: true,
    dayStatus,
    window,
    refreshResult,
    targetedBackfill,
    postTargetedBackfillRefreshResult,
    deferredRepair,
    reconcile,
    backfillDateKeys,
    tailWaitTimedOut,
    incompleteMeterWaitTimedOut,
  };
}
