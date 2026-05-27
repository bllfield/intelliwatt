import { prisma } from "@/lib/db";
import { getRollingBackfillRange, requestSmtBackfillForAuthorization } from "@/lib/smt/agreements";
import { resolveSmtPersistedCoverageSpan } from "@/lib/usage/smtWindowStatus";

function resolveBaseUrl(): URL {
  const explicit =
    process.env.ADMIN_INTERNAL_BASE_URL ??
    process.env.NEXT_PUBLIC_BASE_URL ??
    process.env.PROD_BASE_URL ??
    process.env.VERCEL_PROJECT_PRODUCTION_URL ??
    "";

  if (explicit) {
    try {
      return new URL(explicit.startsWith("http") ? explicit : `https://${explicit}`);
    } catch {
      // fall through
    }
  }
  return new URL("https://intelliwatt.com");
}

export type SmtUserDeliveryKickResult = {
  kicked: boolean;
  reason:
    | "ready"
    | "not_active"
    | "missing_auth"
    | "backfill_requested"
    | "pull_dispatched"
    | "nothing_to_do";
  backfillRequested?: boolean;
  pullDispatched?: boolean;
  message?: string;
};

/**
 * Lightweight dashboard/orchestrate kick: request SMT backfill when needed and dispatch
 * pull fire-and-forget. Never blocks on droplet ingest or coverage waits.
 */
export async function kickSmtUserDelivery(args: {
  userId: string;
  houseId: string;
  authorizationId: string;
  esiid: string;
  authorizationStatus: string;
  usageReady: boolean;
  intervalCount: number;
  smtBackfillRequestedAt: Date | null;
  meterNumber?: string | null;
}): Promise<SmtUserDeliveryKickResult> {
  if (args.usageReady) {
    return { kicked: false, reason: "ready" };
  }

  const statusNorm = String(args.authorizationStatus ?? "").trim().toLowerCase();
  const isActive = statusNorm === "active" || statusNorm === "already_active" || statusNorm === "act";
  if (!isActive) {
    return { kicked: false, reason: "not_active" };
  }

  const auth = await prisma.smtAuthorization
    .findFirst({
      where: { id: args.authorizationId, userId: args.userId, archivedAt: null },
      select: { id: true, esiid: true, meterNumber: true },
    })
    .catch(() => null);
  if (!auth?.esiid) {
    return { kicked: false, reason: "missing_auth" };
  }

  let backfillRequested = false;
  let pullDispatched = false;

  if (!args.smtBackfillRequestedAt) {
    const backfillRange = getRollingBackfillRange(12);
    let wideBackfillStart = backfillRange.startDate;
    const persistedSpan = await resolveSmtPersistedCoverageSpan(auth.esiid).catch(() => null);
    if (persistedSpan?.startDate) {
      const persistedStart = new Date(`${persistedSpan.startDate}T00:00:00.000Z`);
      if (persistedStart.getTime() > wideBackfillStart.getTime()) {
        wideBackfillStart = persistedStart;
      }
    }
    const res = await requestSmtBackfillForAuthorization({
      authorizationId: auth.id,
      esiid: auth.esiid,
      meterNumber: auth.meterNumber ?? args.meterNumber ?? null,
      startDate: wideBackfillStart,
      endDate: backfillRange.endDate,
    }).catch((error) => ({
      ok: false as const,
      message: error instanceof Error ? error.message : String(error),
    }));

    if (res.ok) {
      await prisma.smtAuthorization
        .update({
          where: { id: auth.id },
          data: { smtBackfillRequestedAt: new Date() },
        })
        .catch(() => null);
      backfillRequested = true;
    }
  }

  const adminToken = String(process.env.ADMIN_TOKEN ?? "").trim();
  if (adminToken && args.intervalCount === 0) {
    const pullUrl = new URL("/api/admin/smt/pull", resolveBaseUrl());
    void fetch(pullUrl, {
      method: "POST",
      headers: {
        "x-admin-token": adminToken,
        "content-type": "application/json",
      },
      cache: "no-store",
      body: JSON.stringify({ esiid: args.esiid, houseId: args.houseId }),
    }).catch(() => null);
    pullDispatched = true;
  }

  if (backfillRequested) {
    return {
      kicked: true,
      reason: "backfill_requested",
      backfillRequested: true,
      pullDispatched,
      message: "SMT interval backfill requested.",
    };
  }
  if (pullDispatched) {
    return {
      kicked: true,
      reason: "pull_dispatched",
      pullDispatched: true,
      message: "SMT pull dispatched.",
    };
  }

  return {
    kicked: false,
    reason: args.intervalCount > 0 ? "nothing_to_do" : "nothing_to_do",
    message:
      args.intervalCount > 0
        ? "SMT backfill already requested; waiting on delivery/ingest."
        : "Waiting on SMT backfill delivery.",
  };
}
