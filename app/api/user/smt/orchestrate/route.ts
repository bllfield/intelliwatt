import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/utils/email";
import { getRollingBackfillRange, refreshSmtAuthorizationStatus, requestSmtBackfillForAuthorization } from "@/lib/smt/agreements";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function daysBetweenInclusive(start: Date, end: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  const a = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const b = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  return Math.max(0, Math.floor((b.getTime() - a.getTime()) / msPerDay) + 1);
}

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

function normStatus(s: string | null | undefined): string {
  return String(s ?? "").trim().toUpperCase();
}

function isActiveStatus(s: string | null | undefined): boolean {
  const v = normStatus(s);
  return v === "ACTIVE" || v === "ALREADY_ACTIVE";
}

type UsageCoverage = {
  intervalCount: number;
  intervalExpectedBySpan: number;
  intervalCompletenessBySpan: number; // 0..1
  rawCount: number;
  coverageStart: Date | null;
  coverageEnd: Date | null;
  coverageDays: number;
  ready: boolean;
  phase: "ready" | "processing" | "pending";
  message: string | null;
};

async function computeUsageCoverageForEsiid(esiid: string): Promise<UsageCoverage> {
  // This "target" window is used for messaging/backoff (e.g. "tail gap" to the most recent day),
  // not for readiness. Readiness is computed from contiguous completeness across the observed span.
  const target = getRollingBackfillRange(12);

  const intervalAggAll = await prisma.smtInterval.aggregate({
    where: { esiid },
    _count: { _all: true },
    _min: { ts: true },
    _max: { ts: true },
  });

  const intervalCount = Number(intervalAggAll._count?._all ?? 0);
  const coverageStart = intervalAggAll._min?.ts ?? null;
  const coverageEnd = intervalAggAll._max?.ts ?? null;
  const coverageDays =
    coverageStart && coverageEnd ? daysBetweenInclusive(coverageStart, coverageEnd) : 0;

  // Completeness check (contiguous-series, global span):
  // SMT delivers 15-minute reads as a contiguous series (zeros still appear as rows).
  // Determine how many 15-min intervals *should* exist between the oldest and newest timestamps
  // we currently have, and keep pulling until we have (nearly) all of them.
  const FIFTEEN_MIN_MS = 15 * 60 * 1000;
  const intervalExpectedBySpan = (() => {
    if (!coverageStart || !coverageEnd) return 0;
    const diff = coverageEnd.getTime() - coverageStart.getTime();
    if (!Number.isFinite(diff) || diff < 0) return 0;
    return Math.max(1, Math.round(diff / FIFTEEN_MIN_MS) + 1);
  })();

  const intervalCompletenessBySpan =
    intervalExpectedBySpan > 0 ? intervalCount / intervalExpectedBySpan : 0;

  // Allow a tiny amount of slop for rare edge cases (e.g., duplicate cleanup races).
  // If we have fewer than ~99.5% of expected intervals across the observed span, keep pulling.
  const historyReady = intervalExpectedBySpan > 0 && intervalCompletenessBySpan >= 0.995;

  const rawCount = await prisma.rawSmtFile.count({
    where: {
      OR: [{ filename: { contains: esiid } }, { storage_path: { contains: esiid } }],
    },
  });

  const ready = historyReady;
  const phase: UsageCoverage["phase"] =
    ready ? "ready" : intervalCount > 0 || rawCount > 0 ? "processing" : "pending";

  const tailGapDays =
    coverageEnd && coverageEnd.getTime() < target.endDate.getTime()
      ? Math.max(0, daysBetweenInclusive(coverageEnd, target.endDate) - 1)
      : 0;

  const message = (() => {
    if (ready) return "Full SMT history has been ingested.";
    if (phase === "pending") return "Waiting for SMT interval data delivery.";
    if (phase === "processing") {
      if (intervalCount > 0 && coverageStart && coverageEnd) {
        const pct = intervalCompletenessBySpan > 0 ? Math.floor(intervalCompletenessBySpan * 100) : 0;
        if (rawCount === 0) {
          if (tailGapDays > 0) {
            return `SMT intervals ingested (${coverageDays} day(s)). Coverage completeness ~${pct}%. Still fetching the most recent ${tailGapDays} day(s) to complete the 12‑month window.`;
          }
          return `SMT intervals ingested (${coverageDays} day(s)). Coverage completeness ~${pct}%. Finishing processing.`;
        }
        if (tailGapDays > 0) {
          return `Partial SMT history ingested (${coverageDays} day(s)). Coverage completeness ~${pct}%. Still fetching the most recent ${tailGapDays} day(s) to complete the 12‑month window.`;
        }
        return `Partial SMT history ingested (${coverageDays} day(s)). Coverage completeness ~${pct}%. Still importing historical usage.`;
      }
      if (rawCount > 0) return "SMT files received; processing intervals.";
      return "Processing SMT usage.";
    }
    return null;
  })();

  return {
    intervalCount,
    intervalExpectedBySpan,
    intervalCompletenessBySpan,
    rawCount,
    coverageStart,
    coverageEnd,
    coverageDays,
    ready,
    phase,
    message,
  };
}

/**
 * POST /api/user/smt/orchestrate
 *
 * Orchestrates:
 * - SMT status refresh (rate-limited via refreshSmtAuthorizationStatus cooldown)
 * - Once ACTIVE: requests interval backfill (rate-limited via smtBackfillRequestedAt)
 * - Once ACTIVE: triggers SMT pull on droplet periodically (rate-limited via smtLastSyncAt)
 *
 * Body: { homeId?: string }
 */
export async function POST(req: NextRequest) {
  const cookieStore = cookies();
  const sessionEmail = cookieStore.get("intelliwatt_user")?.value ?? null;

  if (!sessionEmail) {
    return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });
  }

  const normalizedEmail = normalizeEmail(sessionEmail);
  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true },
  });

  if (!user) {
    return NextResponse.json({ ok: false, error: "user_not_found" }, { status: 404 });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const force =
    body?.force === true ||
    body?.forceRefresh === true ||
    body?.forceRepost === true ||
    body?.refresh === true;

  const requestedHomeId =
    typeof body?.homeId === "string" && body.homeId.trim().length > 0 ? body.homeId.trim() : null;

  // Resolve home: primary first, else most recent.
  let house = requestedHomeId
    ? await prisma.houseAddress.findFirst({
        where: { id: requestedHomeId, userId: user.id, archivedAt: null },
        select: { id: true, esiid: true },
      })
    : await prisma.houseAddress.findFirst({
        where: { userId: user.id, archivedAt: null, isPrimary: true } as any,
        orderBy: { createdAt: "desc" },
        select: { id: true, esiid: true },
      });

  if (!house && !requestedHomeId) {
    house = await prisma.houseAddress.findFirst({
      where: { userId: user.id, archivedAt: null } as any,
      orderBy: { createdAt: "desc" },
      select: { id: true, esiid: true },
    });
  }

  if (!house) {
    return NextResponse.json(
      { ok: false, error: "home_not_found", message: "No home found for this user." },
      { status: 404 },
    );
  }

  const authorization = await prisma.smtAuthorization.findFirst({
    where: {
      userId: user.id,
      archivedAt: null,
      OR: [{ houseAddressId: house.id }, { houseId: house.id }],
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      esiid: true,
      meterNumber: true,
      smtStatus: true,
      smtStatusMessage: true,
      smtBackfillRequestedAt: true,
      smtBackfillCompletedAt: true,
      smtLastSyncAt: true,
      authorizationStartDate: true,
      authorizationEndDate: true,
    },
  });

  if (!authorization) {
    return NextResponse.json(
      {
        ok: true,
        phase: "no_authorization",
        done: false,
        homeId: house.id,
        message: "No SMT authorization found for this home.",
      },
      { status: 200 },
    );
  }

  const now = new Date();
  const isExpired = authorization.authorizationEndDate
    ? now.getTime() > authorization.authorizationEndDate.getTime()
    : false;

  const authEsiid = String(authorization.esiid ?? "").trim();
  const houseEsiid = String(house.esiid ?? "").trim();
  const effectiveEsiid = authEsiid || houseEsiid;
  const esiidMismatch =
    Boolean(authEsiid) && Boolean(houseEsiid) && authEsiid !== houseEsiid;

  // If the house doesn't have an ESIID yet but the authorization does, hydrate it so the
  // dashboard session house record becomes the source of truth going forward.
  if (!houseEsiid && authEsiid) {
    try {
      await prisma.houseAddress.update({
        where: { id: house.id },
        data: { esiid: authEsiid },
      });
    } catch {
      // non-fatal; we'll still use the authorization ESIID for this request
    }
  }

  if (!effectiveEsiid) {
    return NextResponse.json(
      {
        ok: true,
        phase: "no_esiid",
        done: false,
        homeId: house.id,
        message: "No ESIID is linked to this home/authorization yet.",
      },
      { status: 200 },
    );
  }

  // Always compute current usage coverage for visibility (cheap DB-only).
  const usage = await computeUsageCoverageForEsiid(effectiveEsiid);

  // Remote actions throttling: use smtLastSyncAt as a coarse "last orchestration action" timestamp.
  const ORCHESTRATOR_COOLDOWN_MS = (() => {
    const raw = (process.env.SMT_ORCHESTRATOR_COOLDOWN_MS ?? "").trim();
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 60_000;
  })();

  const recentlySynced =
    !force &&
    ORCHESTRATOR_COOLDOWN_MS > 0 &&
    authorization.smtLastSyncAt &&
    Date.now() - authorization.smtLastSyncAt.getTime() < ORCHESTRATOR_COOLDOWN_MS;

  const remainingCooldownMs =
    recentlySynced && authorization.smtLastSyncAt
      ? Math.max(
          0,
          ORCHESTRATOR_COOLDOWN_MS -
            (Date.now() - authorization.smtLastSyncAt.getTime()),
        )
      : 0;

  const actions: Record<string, any> = {
    forced: force,
    statusRefreshed: false,
    statusThrottled: false,
    backfillRequested: false,
    pullTriggered: false,
    orchestratorThrottled: recentlySynced,
    ...(esiidMismatch
      ? { esiidMismatch: { houseEsiid, authorizationEsiid: authEsiid } }
      : {}),
  };

  let effectiveStatus = normStatus(authorization.smtStatus);
  let effectiveMessage = authorization.smtStatusMessage ?? null;

  // 1) Status refresh until ACTIVE (hard cooldown inside refreshSmtAuthorizationStatus).
  if (!isExpired && (!recentlySynced || force) && !isActiveStatus(effectiveStatus)) {
    const refresh = await refreshSmtAuthorizationStatus(authorization.id);
    actions.statusRefreshed = Boolean((refresh as any)?.ok);
    actions.statusThrottled = Boolean((refresh as any)?.throttled);
    const updated = (refresh as any)?.authorization ?? null;
    if (updated) {
      effectiveStatus = normStatus(updated.smtStatus);
      effectiveMessage = updated.smtStatusMessage ?? effectiveMessage;
    }
  }

  // 2) Once ACTIVE: request interval backfill (rate-limited by smtBackfillRequestedAt and coverage).
  const active = isActiveStatus(effectiveStatus);
  const shouldWork = !isExpired && active && (!usage.ready || force);

  if (shouldWork && (!recentlySynced || force)) {
    const backfillRange = getRollingBackfillRange(12);
    const requestedAt = authorization.smtBackfillRequestedAt
      ? new Date(authorization.smtBackfillRequestedAt)
      : null;

    const retryAfterMs =
      usage.rawCount === 0 && usage.coverageDays < 30 ? 60 * 60 * 1000 : 6 * 60 * 60 * 1000;
    const isStale = requestedAt ? Date.now() - requestedAt.getTime() >= retryAfterMs : false;
    const allowRetry = Boolean(requestedAt && !usage.ready && isStale);

    const enableBackfill =
      process.env.SMT_INTERVAL_BACKFILL_ENABLED === "true" ||
      process.env.SMT_INTERVAL_BACKFILL_ENABLED === "1";

    if (enableBackfill && (force || !requestedAt || allowRetry)) {
      const res = await requestSmtBackfillForAuthorization({
        authorizationId: authorization.id,
        esiid: effectiveEsiid,
        meterNumber: authorization.meterNumber,
        startDate: backfillRange.startDate,
        endDate: backfillRange.endDate,
      });
      actions.backfillRequested = Boolean(res.ok);

      // Record attempt timestamp (even if SMT returns non-ok) to avoid spamming.
      await prisma.smtAuthorization
        .update({
          where: { id: authorization.id },
          data: {
            smtBackfillRequestedAt: new Date(),
            smtLastSyncAt: new Date(),
          },
        })
        .catch(() => null);
    }

    // 3) Trigger droplet pull so we fetch anything delivered via SFTP.
    const adminToken = (process.env.ADMIN_TOKEN ?? "").trim();
    if (adminToken) {
      try {
        const baseUrl = resolveBaseUrl();
        const pullUrl = new URL("/api/admin/smt/pull", baseUrl);
        const pullRes = await fetch(pullUrl, {
          method: "POST",
          headers: {
            "x-admin-token": adminToken,
            "content-type": "application/json",
          },
          cache: "no-store",
          body: JSON.stringify({
            homeId: house.id,
            esiid: effectiveEsiid,
            reason: force ? "user_refresh" : "user_orchestrate",
            forceRepost: force,
          }),
        });
        actions.pullTriggered = pullRes.ok;
        await prisma.smtAuthorization
          .update({
            where: { id: authorization.id },
            data: { smtLastSyncAt: new Date() },
          })
          .catch(() => null);
      } catch {
        // swallow; user should still see coverage and can retry later
      }
    }
  }

  const done = Boolean(isExpired || usage.ready);
  const phase =
    isExpired
      ? "expired"
      : active
        ? usage.ready
          ? "ready"
          : "active_waiting_usage"
        : "waiting_authorization";

  const nextPollMs =
    done
      ? null
      : remainingCooldownMs > 0
        ? Math.min(Math.max(remainingCooldownMs, 5_000), 60_000)
        : phase === "waiting_authorization"
          ? 15_000
          : phase === "active_waiting_usage"
            ? 30_000
            : 30_000;

  return NextResponse.json({
    ok: true,
    phase,
    done,
    nextPollMs,
    homeId: house.id,
    authorization: {
      id: authorization.id,
      esiid: effectiveEsiid,
      meterNumber: authorization.meterNumber,
      status: effectiveStatus || null,
      message: effectiveMessage,
      authorizationStartDate: authorization.authorizationStartDate?.toISOString?.() ?? null,
      authorizationEndDate: authorization.authorizationEndDate?.toISOString?.() ?? null,
    },
    usage: {
      ready: usage.ready,
      status: usage.phase,
      intervals: usage.intervalCount,
      rawFiles: usage.rawCount,
      coverage: {
        start: usage.coverageStart ? usage.coverageStart.toISOString() : null,
        end: usage.coverageEnd ? usage.coverageEnd.toISOString() : null,
        days: usage.coverageDays,
        completenessPct:
          usage.intervalExpectedBySpan > 0
            ? Math.round((usage.intervalCount / usage.intervalExpectedBySpan) * 1000) / 10
            : 0,
        expectedIntervals: usage.intervalExpectedBySpan,
      },
      message: usage.message,
    },
    actions,
  });
}
