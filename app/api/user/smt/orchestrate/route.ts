import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/utils/email";
import { pickBestSmtAuthorization } from "@/lib/smt/authorizationSelection";
import { getRollingBackfillRange, refreshSmtAuthorizationStatus, requestSmtBackfillForAuthorization } from "@/lib/smt/agreements";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const DAY_MS = 24 * 60 * 60 * 1000;
const SMT_PULL_COOLDOWN_MS = 30 * DAY_MS;
const SMT_READY_COMPLETENESS = 0.99; // stop chasing tiny tails; treat ~99% as sufficient for "ready"
const SMT_GAP_SLOP_DAYS = 1; // tolerate up to 1 day tail/head mismatch for messaging/eligibility
const SMT_TZ = "America/Chicago";

const chicagoDateFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: SMT_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function chicagoDateKey(d: Date): string {
  try {
    return chicagoDateFmt.format(d); // YYYY-MM-DD
  } catch {
    // Fallback: UTC date (still stable)
    return d.toISOString().slice(0, 10);
  }
}

/**
 * Convert a YYYY-MM-DD date key into a monotonic day index.
 *
 * IMPORTANT:
 * - The input may represent an America/Chicago *calendar day label*.
 * - We intentionally do NOT treat it as a timezone-aware midnight instant.
 * - `Date.UTC(y,m,d)` is used only to compute an ordinal day number for date math.
 */
function dayIndexFromDateKey(key: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key ?? "").trim());
  if (!m) return Number.NaN;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const ms = Date.UTC(y, mo - 1, d);
  return Number.isFinite(ms) ? Math.floor(ms / DAY_MS) : Number.NaN;
}

function daysBetweenDateKeysInclusive(startKey: string, endKey: string): number {
  const a = dayIndexFromDateKey(startKey);
  const b = dayIndexFromDateKey(endKey);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 0;
  return Math.floor(b - a) + 1;
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
  return v === "ACTIVE" || v === "ALREADY_ACTIVE" || v === "ACT";
}

type UsageCoverage = {
  intervalCount: number;
  intervalExpectedBySpan: number;
  intervalCompletenessBySpan: number; // 0..1
  rawCount: number;
  coverageStart: Date | null;
  coverageEnd: Date | null;
  coverageStartDate: string | null; // America/Chicago date key
  coverageEndDate: string | null;   // America/Chicago date key
  coverageDays: number;
  headGapDays: number;
  tailGapDays: number;
  missingGaps: boolean;
  pullEligibleNow: boolean;
  pullEligibleAt: string | null;
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

  const coverageStartDate = coverageStart ? chicagoDateKey(coverageStart) : null;
  const coverageEndDate = coverageEnd ? chicagoDateKey(coverageEnd) : null;
  const coverageDays =
    coverageStartDate && coverageEndDate ? daysBetweenDateKeysInclusive(coverageStartDate, coverageEndDate) : 0;

  // Completeness check (contiguous-series, per meter):
  // SMT delivers 15-minute reads as a contiguous series (zeros still appear as rows).
  //
  // A single ESIID can have multiple meters over time (e.g., meter replacement). Those meters can
  // have different coverage windows, so we compute expected intervals per meter span and sum them.
  const FIFTEEN_MIN_MS = 15 * 60 * 1000;

  let intervalExpectedBySpan = 0;
  let minMeterCompleteness = 1;
  let meterGroupsSeen = 0;

  try {
    const meterAgg = await prisma.smtInterval.groupBy({
      by: ["meter"],
      where: { esiid },
      _count: { _all: true },
      _min: { ts: true },
      _max: { ts: true },
    });

    for (const m of meterAgg) {
      const minTs = (m as any)?._min?.ts as Date | null | undefined;
      const maxTs = (m as any)?._max?.ts as Date | null | undefined;
      const count = Number((m as any)?._count?._all ?? 0);
      if (!minTs || !maxTs || count <= 0) continue;

      const diff = maxTs.getTime() - minTs.getTime();
      if (!Number.isFinite(diff) || diff < 0) continue;

      // Use rounding to tolerate any occasional ms drift; timestamps should be 15-min aligned.
      const expected = Math.max(1, Math.round(diff / FIFTEEN_MIN_MS) + 1);
      intervalExpectedBySpan += expected;

      const completeness = expected > 0 ? count / expected : 0;
      minMeterCompleteness = Math.min(minMeterCompleteness, completeness);
      meterGroupsSeen += 1;
    }
  } catch {
    // Fall back to naive expectation from global span if groupBy fails.
    if (coverageStart && coverageEnd) {
      const diff = coverageEnd.getTime() - coverageStart.getTime();
      if (Number.isFinite(diff) && diff >= 0) {
        intervalExpectedBySpan = Math.max(1, Math.round(diff / FIFTEEN_MIN_MS) + 1);
        minMeterCompleteness =
          intervalExpectedBySpan > 0 ? intervalCount / intervalExpectedBySpan : 0;
        meterGroupsSeen = 1;
      }
    }
  }

  const intervalCompletenessBySpan =
    intervalExpectedBySpan > 0 ? intervalCount / intervalExpectedBySpan : 0;

  // Compute head/tail gaps against the target 12-month calendar window (for messaging + eligibility).
  // getRollingBackfillRange() returns UTC day-marker Dates (YYYY-MM-DD keys). Treat as date keys directly.
  const targetStartKey = target.startDate.toISOString().slice(0, 10);
  const targetEndKey = target.endDate.toISOString().slice(0, 10);

  const headGapDays =
    coverageStartDate && coverageStartDate > targetStartKey
      ? Math.max(0, daysBetweenDateKeysInclusive(targetStartKey, coverageStartDate) - 1)
      : 0;
  const tailGapDays =
    coverageEndDate && coverageEndDate < targetEndKey
      ? Math.max(0, daysBetweenDateKeysInclusive(coverageEndDate, targetEndKey) - 1)
      : 0;

  const completenessOk =
    intervalExpectedBySpan > 0 && meterGroupsSeen > 0 && minMeterCompleteness >= SMT_READY_COMPLETENESS;
  const headGapOk = headGapDays <= SMT_GAP_SLOP_DAYS;
  const tailGapOk = tailGapDays <= SMT_GAP_SLOP_DAYS;
  const gapsOk = headGapOk && tailGapOk;
  const dataAgeMs = coverageEnd ? Date.now() - coverageEnd.getTime() : Number.POSITIVE_INFINITY;
  const dataOlderThan30d = !coverageEnd ? true : dataAgeMs >= SMT_PULL_COOLDOWN_MS;

  // Full window = 365+ days, OR shorter span with tail at target (100% of what SMT has delivered, up to 365 days).
  const hasFullWindow =
    coverageDays >= 365 || (coverageDays > 0 && coverageDays < 365 && tailGapOk);

  // Inside 30 days: 100% if we have full span from last pull (ignore tail). After 30 days: 100% when tail reaches target (yesterday).
  const gapsOkForReady = dataOlderThan30d ? gapsOk : headGapOk;
  const missingGapsForPull = dataOlderThan30d
    ? !(completenessOk && hasFullWindow && gapsOk)
    : !(completenessOk && hasFullWindow && headGapOk);

  const missingGaps = missingGapsForPull;

  const rawCount = await prisma.rawSmtFile.count({
    where: {
      OR: [{ filename: { contains: esiid } }, { storage_path: { contains: esiid } }],
    },
  });

  // Don't declare 100% while SMT might still be delivering: require no unprocessed raw files and no gaps.
  // Keep pulling while rawCount > 0 or missingGaps so we pick up any older dates SMT delivers later.
  const deliveryComplete = rawCount === 0;
  const historyReady = Boolean(completenessOk && hasFullWindow && gapsOkForReady && deliveryComplete);
  const missingGapsOrPendingDelivery = missingGaps || !deliveryComplete;

  const missingGapsForEligibility = missingGapsOrPendingDelivery;

  const ready = historyReady;
  const phase: UsageCoverage["phase"] =
    ready ? "ready" : intervalCount > 0 || rawCount > 0 ? "processing" : "pending";

  const pullEligibleNow = intervalCount === 0 || dataOlderThan30d || missingGapsForEligibility;
  const pullEligibleAt = coverageEnd
    ? new Date(coverageEnd.getTime() + SMT_PULL_COOLDOWN_MS).toISOString()
    : new Date().toISOString();

  const rangeText =
    coverageStartDate && coverageEndDate
      ? `Usage data only available ${coverageStartDate} to ${coverageEndDate}.`
      : "";

  const message = (() => {
    if (ready) {
      const base = coverageDays < 365 && rangeText ? `${rangeText} We have 100%.` : "SMT history is ingested.";
      if (pullEligibleNow)
        return coverageDays < 365 && rangeText
          ? `${rangeText} We have 100%. Refresh is available (data is older than 30 days).`
          : "SMT history is ingested. Refresh is available (data is older than 30 days).";
      const next = coverageEnd ? chicagoDateKey(new Date(coverageEnd.getTime() + SMT_PULL_COOLDOWN_MS)) : null;
      return next
        ? (rangeText ? `${rangeText} We have 100%. ` : "") +
            `Too early to pull more data. Next refresh available after ${next}.`.trim()
        : base;
    }
    if (phase === "pending") return "Waiting for SMT interval data delivery.";
    if (phase === "processing") {
      if (intervalCount > 0 && coverageStart && coverageEnd) {
        const pct = intervalCompletenessBySpan > 0 ? Math.round(intervalCompletenessBySpan * 100) : 0;
        const gapsNote =
          headGapDays > 0 || tailGapDays > 0
            ? ` Missing ~${headGapDays} day(s) at start and ~${tailGapDays} day(s) at end of the 12‑month window (to yesterday).`
            : "";
        const shortRangeLead = coverageDays < 365 && rangeText ? `${rangeText} ` : "";
        if (rawCount === 0) {
          return `${shortRangeLead}SMT intervals ingested (${coverageDays} day(s)). Coverage completeness ~${pct}%.${gapsNote}`.trim();
        }
        return `${shortRangeLead}SMT intervals ingested (${coverageDays} day(s)). Coverage completeness ~${pct}%.${gapsNote} Processing newly received SMT files; we will keep checking for more older dates from SMT.`.trim();
      }
      if (rawCount > 0)
        return "SMT files received; processing intervals. We will keep checking for more older dates from SMT.";
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
    coverageStartDate,
    coverageEndDate,
    coverageDays,
    headGapDays,
    tailGapDays,
    missingGaps,
    pullEligibleNow,
    pullEligibleAt,
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

  const authorizationCandidates = await prisma.smtAuthorization.findMany({
    where: {
      userId: user.id,
      archivedAt: null,
      OR: [{ houseAddressId: house.id }, { houseId: house.id }],
    },
    orderBy: { createdAt: "desc" },
    take: 25,
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
  const allAuthorizationRows = await prisma.smtAuthorization.findMany({
    where: {
      userId: user.id,
      OR: [{ houseAddressId: house.id }, { houseId: house.id }],
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true },
  });
  const authorization = pickBestSmtAuthorization(authorizationCandidates as any[]);

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

  // Throttle only automatic polling: avoid running backfill + pull on every poll (e.g. every 5–30s).
  // Without this, the dashboard would trigger dozens of backfill/pull requests per minute and hammer SMT/droplet.
  // User-initiated refresh bypasses this (force=true) and the "Refresh SMT Data" button also calls /api/user/usage/refresh so backfill + pull always run on click.
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

  const backfillEnvRaw = (process.env.SMT_INTERVAL_BACKFILL_ENABLED ?? "").toString().trim().toLowerCase();
  const backfillEnvEnabled = backfillEnvRaw === "true" || backfillEnvRaw === "1" || backfillEnvRaw === "yes";

  const actions: Record<string, any> = {
    forced: force,
    statusRefreshed: false,
    statusThrottled: false,
    backfillRequested: false,
    pullTriggered: false,
    orchestratorThrottled: recentlySynced,
    pullEligibleNow: usage.pullEligibleNow,
    pullEligibleAt: usage.pullEligibleAt,
    backfillEnabled: backfillEnvEnabled,
    ...(esiidMismatch
      ? { esiidMismatch: { houseEsiid, authorizationEsiid: authEsiid } }
      : {}),
  };

  let effectiveStatus = normStatus(authorization.smtStatus);
  let effectiveMessage = authorization.smtStatusMessage ?? null;
  let effectiveAuthorizationId = authorization.id;
  let effectiveMeterNumber = authorization.meterNumber;
  let effectiveBackfillRequestedAt = authorization.smtBackfillRequestedAt;
  const refreshCandidateIds = Array.from(
    new Set([
      authorization.id,
      ...authorizationCandidates.map((a: any) => String(a.id)),
      ...allAuthorizationRows.map((a: any) => String(a.id)),
    ]),
  );

  // 1) Status refresh until ACTIVE (hard cooldown inside refreshSmtAuthorizationStatus).
  if (!isExpired && (!recentlySynced || force) && !isActiveStatus(effectiveStatus)) {
    for (const candidateId of refreshCandidateIds) {
      const refresh = await refreshSmtAuthorizationStatus(candidateId, { force: Boolean(force) });
      actions.statusRefreshed = Boolean(refresh?.ok);
      actions.statusThrottled = Boolean(refresh?.throttled);
      const updated = refresh?.authorization ?? null;
      if (updated) {
        effectiveAuthorizationId = String(updated.id ?? effectiveAuthorizationId);
        effectiveMeterNumber = updated.meterNumber ?? effectiveMeterNumber;
        effectiveBackfillRequestedAt =
          (updated as any)?.smtBackfillRequestedAt ?? effectiveBackfillRequestedAt;
        effectiveStatus = normStatus(updated.smtStatus);
        effectiveMessage = updated.smtStatusMessage ?? effectiveMessage;
      }
      if (isActiveStatus(effectiveStatus)) break;
    }
  }

  // 2) Once ACTIVE: request interval backfill (rate-limited by smtBackfillRequestedAt and coverage).
  const active = isActiveStatus(effectiveStatus);
  const shouldWork =
    !isExpired &&
    active &&
    (!usage.ready || (force && usage.pullEligibleNow));

  if (shouldWork && (!recentlySynced || force)) {
    const backfillRange = getRollingBackfillRange(12);
    const requestedAt = effectiveBackfillRequestedAt
      ? new Date(effectiveBackfillRequestedAt)
      : null;

    const retryAfterMs =
      usage.rawCount === 0 && usage.coverageDays < 30 ? 60 * 60 * 1000 : 6 * 60 * 60 * 1000;
    const isStale = requestedAt ? Date.now() - requestedAt.getTime() >= retryAfterMs : false;
    const allowRetry = Boolean(requestedAt && !usage.ready && isStale);

    // Accept "true", "1", "True", "TRUE", "yes" so Vercel/env casing doesn't break it.
    const rawBackfill = (process.env.SMT_INTERVAL_BACKFILL_ENABLED ?? "").toString().trim().toLowerCase();
    const enableBackfill =
      rawBackfill === "true" || rawBackfill === "1" || rawBackfill === "yes";

    // If the user forces a refresh but they are not eligible (data <30d old and no gaps),
    // do NOT spam SMT backfill requests.
    const allowForceBackfill = !force || usage.pullEligibleNow;

    if (enableBackfill && allowForceBackfill && (force || !requestedAt || allowRetry)) {
      const res = await requestSmtBackfillForAuthorization({
        authorizationId: effectiveAuthorizationId,
        esiid: effectiveEsiid,
        meterNumber: effectiveMeterNumber,
        startDate: backfillRange.startDate,
        endDate: backfillRange.endDate,
      });
      actions.backfillRequested = Boolean(res.ok);

      // Record attempt timestamp (even if SMT returns non-ok) to avoid spamming.
      await prisma.smtAuthorization
        .update({
          where: { id: effectiveAuthorizationId },
          data: {
            smtBackfillRequestedAt: new Date(),
            smtLastSyncAt: new Date(),
          },
        })
        .catch(() => null);
    }

    // 3) Trigger droplet pull so we fetch anything delivered via SFTP.
    if (force && !usage.pullEligibleNow) {
      actions.pullTriggered = false;
      actions.pullBlockedReason = "cooldown";
    }
    const adminToken = (process.env.ADMIN_TOKEN ?? "").trim();
    if (adminToken && (!force || usage.pullEligibleNow)) {
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
        // Use America/Chicago calendar dates for user-facing display and gating.
        start: usage.coverageStartDate,
        end: usage.coverageEndDate,
        days: usage.coverageDays,
        // Align with readiness logic: use per-meter span expected intervals so completenessPct matches server ready/processing decision.
        expectedIntervals: Math.max(1, usage.intervalExpectedBySpan),
        completenessPct:
          usage.intervalExpectedBySpan > 0
            ? Math.round((usage.intervalCount / usage.intervalExpectedBySpan) * 1000) / 10
            : 0,
      },
      message: usage.message,
    },
    actions,
  });
}