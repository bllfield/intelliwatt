import { prisma } from "@/lib/db";
import { pickBestSmtAuthorization } from "@/lib/smt/authorizationSelection";
import { getRollingBackfillRange, requestSmtBackfillForAuthorization } from "@/lib/smt/agreements";
import {
  reconcileSmtIntervalDayLedger,
  type SmtDayLedgerReconcileResult,
} from "@/lib/usage/smtDayCoverageLedger";
import {
  enumerateDateKeysInclusive,
  SMT_TAIL_WAIT_INTERVAL_MS,
  waitForSmtDateCoverage,
  type SmtDateCoverageWaitResult,
} from "@/lib/usage/smtTailCoverage";
import {
  loadSmtWindowDayStatus,
  resolveSmtCanonicalWindow,
  smtWindowCompletenessRatio,
  type SmtWindowStatusSnapshot,
} from "@/lib/usage/smtWindowStatus";
import { requestUsageRefreshForUserHouse, type UsageRefreshResult } from "@/lib/usage/userUsageRefresh";

/** Matches admin one-path route maxDuration with headroom for auth + reconcile. */
export const FULL_WINDOW_SMT_REINGEST_WAIT_TIMEOUT_MS = 240_000;
export const FULL_WINDOW_SMT_REINGEST_INITIAL_DELAY_MS = 8_000;

const SMT_INTERVAL_BACKFILL_ENABLED =
  process.env.SMT_INTERVAL_BACKFILL_ENABLED === "true" ||
  process.env.SMT_INTERVAL_BACKFILL_ENABLED === "1";

export type FullWindowSmtReingestResult = {
  ok: boolean;
  error?: string;
  message?: string;
  houseId: string;
  esiid: string | null;
  window: { startDate: string; endDate: string };
  backfillReset: boolean;
  backfillRequest: { ok: boolean; message?: string };
  pullRefresh?: UsageRefreshResult;
  wait: {
    ready: boolean;
    timedOut: boolean;
    completenessRatio: number;
    completeDayCount: number;
    totalDayCount: number;
    incompleteDateKeys: string[];
    pendingDateKeys: string[];
    incompleteMeterDateKeys: string[];
    durationMs: number;
    attempts: number;
  };
  reconcile?: SmtDayLedgerReconcileResult;
  finalDayStatus?: SmtWindowStatusSnapshot;
};

async function resolveActiveSmtAuthorization(houseId: string) {
  const candidates = await prisma.smtAuthorization
    .findMany({
      where: { houseAddressId: houseId, archivedAt: null },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: {
        id: true,
        esiid: true,
        meterNumber: true,
        smtStatus: true,
      },
    })
    .catch(() => []);
  return pickBestSmtAuthorization(candidates as any[]);
}

/**
 * Operator path: request full canonical-window SMT interval backfill (same range as user onboarding),
 * trigger pull, wait for 96/96 Chicago slots across the window, then reconcile the day ledger.
 * This is not Usage refresh/heal (ensureSmtCoverage) and not the 3-day targeted backfill clip.
 */
export async function runFullWindowSmtReingestForHouse(args: {
  userId: string;
  houseId: string;
  waitTimeoutMs?: number;
}): Promise<FullWindowSmtReingestResult> {
  const window = resolveSmtCanonicalWindow();
  const dateKeys = enumerateDateKeysInclusive(window.startDate, window.endDate);
  const house = await prisma.houseAddress
    .findFirst({
      where: { id: args.houseId, userId: args.userId, archivedAt: null },
      select: { id: true, esiid: true },
    })
    .catch(() => null);

  const emptyWait = {
    ready: false,
    timedOut: true,
    completenessRatio: 0,
    completeDayCount: 0,
    totalDayCount: dateKeys.length,
    incompleteDateKeys: dateKeys,
    pendingDateKeys: [],
    incompleteMeterDateKeys: [],
    durationMs: 0,
    attempts: 0,
  };

  if (!house) {
    return {
      ok: false,
      error: "house_not_found",
      message: "House not found for this user.",
      houseId: args.houseId,
      esiid: null,
      window,
      backfillReset: false,
      backfillRequest: { ok: false, message: "house_not_found" },
      wait: emptyWait,
    };
  }

  const esiid = house.esiid ? String(house.esiid).trim() : "";
  if (!esiid) {
    return {
      ok: false,
      error: "no_esiid",
      message: "House has no ESIID; SMT full-window re-ingest cannot run.",
      houseId: house.id,
      esiid: null,
      window,
      backfillReset: false,
      backfillRequest: { ok: false, message: "no_esiid" },
      wait: emptyWait,
    };
  }

  if (!SMT_INTERVAL_BACKFILL_ENABLED) {
    return {
      ok: false,
      error: "interval_backfill_disabled",
      message: "SMT_INTERVAL_BACKFILL_ENABLED must be true for full-window interval backfill.",
      houseId: house.id,
      esiid,
      window,
      backfillReset: false,
      backfillRequest: { ok: false, message: "interval_backfill_disabled" },
      wait: emptyWait,
    };
  }

  const auth = await resolveActiveSmtAuthorization(house.id);
  if (!auth?.id || !auth.esiid) {
    return {
      ok: false,
      error: "authorization_missing",
      message: "No SMT authorization found for this home.",
      houseId: house.id,
      esiid,
      window,
      backfillReset: false,
      backfillRequest: { ok: false, message: "authorization_missing" },
      wait: emptyWait,
    };
  }

  const statusNorm = String((auth as any)?.smtStatus ?? "").trim().toLowerCase();
  const isActive = statusNorm === "active" || statusNorm === "already_active";
  if (!isActive) {
    return {
      ok: false,
      error: "authorization_not_active",
      message: `SMT authorization is not active (${String((auth as any)?.smtStatus ?? "unknown")}).`,
      houseId: house.id,
      esiid,
      window,
      backfillReset: false,
      backfillRequest: { ok: false, message: "authorization_not_active" },
      wait: emptyWait,
    };
  }

  await prisma.smtAuthorization
    .update({
      where: { id: auth.id },
      data: {
        smtBackfillRequestedAt: null,
        smtBackfillCompletedAt: null,
      },
    })
    .catch(() => null);

  const range = getRollingBackfillRange(12);
  const backfillRequest = await requestSmtBackfillForAuthorization({
    authorizationId: auth.id,
    esiid: auth.esiid,
    meterNumber: (auth as any).meterNumber ?? null,
    startDate: range.startDate,
    endDate: range.endDate,
  });

  if (backfillRequest.ok) {
    await prisma.smtAuthorization
      .update({
        where: { id: auth.id },
        data: { smtBackfillRequestedAt: new Date() },
      })
      .catch(() => null);
  }

  const pullRefresh: UsageRefreshResult = await requestUsageRefreshForUserHouse({
    userId: args.userId,
    houseId: house.id,
    skipGapFill: true,
    sessionKey: `admin-full-window-reingest:${house.id}`,
  }).catch(
    (): UsageRefreshResult => ({
      ok: false,
      error: "admin_token_missing",
      message: "Usage refresh request failed during full-window re-ingest.",
    })
  );

  let coverageWait: SmtDateCoverageWaitResult = {
    dateKeys,
    countsByDate: {},
    missingSlotsByDate: {},
    incompleteDateKeys: dateKeys,
    ready: false,
    durationMs: 0,
    attempts: 0,
    timedOut: true,
  };

  if (backfillRequest.ok) {
    coverageWait = await waitForSmtDateCoverage({
      esiid,
      dateKeys,
      timeoutMs: args.waitTimeoutMs ?? FULL_WINDOW_SMT_REINGEST_WAIT_TIMEOUT_MS,
      intervalMs: SMT_TAIL_WAIT_INTERVAL_MS,
      initialDelayMs: FULL_WINDOW_SMT_REINGEST_INITIAL_DELAY_MS,
      exitEarlyWhenStalled: false,
      midWaitRefresh: async () => {
        await requestUsageRefreshForUserHouse({
          userId: args.userId,
          houseId: house.id,
          skipGapFill: true,
          sessionKey: `admin-full-window-reingest-mid:${house.id}`,
        }).catch(() => null);
      },
    });
  }

  const reconcile = await reconcileSmtIntervalDayLedger({
    esiid,
    canonicalStartDate: window.startDate,
    canonicalEndDate: window.endDate,
  }).catch(() => undefined);

  const finalDayStatus = await loadSmtWindowDayStatus({ esiid });
  const completenessRatio = smtWindowCompletenessRatio(finalDayStatus);
  const ok = backfillRequest.ok && finalDayStatus.ready;

  return {
    ok,
    error: ok ? undefined : backfillRequest.ok ? "window_incomplete" : "backfill_request_failed",
    message: ok
      ? `Full-window SMT re-ingest complete (${finalDayStatus.completeDateKeys.length}/${finalDayStatus.dateKeys.length} days at 96/96).`
      : backfillRequest.ok
        ? `Backfill requested but window still has ${finalDayStatus.incompleteDateKeys.length} incomplete day(s) after wait.`
        : backfillRequest.message ?? "Full-window backfill request failed.",
    houseId: house.id,
    esiid,
    window,
    backfillReset: true,
    backfillRequest,
    pullRefresh,
    wait: {
      ready: finalDayStatus.ready,
      timedOut: coverageWait.timedOut,
      completenessRatio,
      completeDayCount: finalDayStatus.completeDateKeys.length,
      totalDayCount: finalDayStatus.dateKeys.length,
      incompleteDateKeys: finalDayStatus.incompleteDateKeys,
      pendingDateKeys: finalDayStatus.pendingDateKeys,
      incompleteMeterDateKeys: finalDayStatus.incompleteMeterDateKeys,
      durationMs: coverageWait.durationMs,
      attempts: coverageWait.attempts,
    },
    reconcile,
    finalDayStatus,
  };
}
