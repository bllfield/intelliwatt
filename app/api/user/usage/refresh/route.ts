import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/utils/email";
import { refreshSmtAuthorizationStatus, getRollingBackfillRange, requestSmtBackfillForAuthorization } from "@/lib/smt/agreements";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // ensure Node runtime for longer executions
// IMPORTANT: This endpoint is user-clicked from the browser, and Vercel may enforce
// strict request timeouts. Keep it fast: trigger work, don't block on long ingest/normalize.
export const maxDuration = 30;

function daysBetweenInclusive(start: Date, end: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  const a = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const b = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  return Math.max(0, Math.floor((b.getTime() - a.getTime()) / msPerDay) + 1);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(`${label}:timeout`), timeoutMs);
  try {
    // If the underlying promise doesn't support AbortController, this still enforces
    // a timeout for our handler by racing.
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`${label}:timeout_after_${timeoutMs}ms`)), timeoutMs),
      ),
    ]);
  } finally {
    clearTimeout(id);
    // ctrl is intentionally unused by default; kept for future fetch wiring.
    void ctrl;
  }
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
      // fall through to default below
    }
  }

  return new URL("https://intelliwatt.com");
}

interface HomeRefreshResult {
  homeId: string;
  authorizationRefreshed: boolean;
  authorizationMessage?: string;
  pull: {
    attempted: boolean;
    ok: boolean;
    status?: number;
    message?: string;
    webhookResponse?: any;
  };
}

export async function POST(req: NextRequest) {
  const cookieStore = cookies();
  const sessionEmail = cookieStore.get("intelliwatt_user")?.value ?? null;

  if (!sessionEmail) {
    return NextResponse.json(
      { ok: false, error: "not_authenticated" },
      { status: 401 },
    );
  }

  const normalizedEmail = normalizeEmail(sessionEmail);
  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true },
  });

  if (!user) {
    return NextResponse.json(
      { ok: false, error: "user_not_found" },
      { status: 404 },
    );
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const requestedHomeId =
    typeof body?.homeId === "string" && body.homeId.trim().length > 0
      ? body.homeId.trim()
      : null;

  if (!requestedHomeId) {
    return NextResponse.json(
      { ok: false, error: "home_id_required", message: "homeId is required to refresh usage." },
      { status: 400 },
    );
  }

  const targetHouse = await prisma.houseAddress.findFirst({
    where: { id: requestedHomeId, userId: user.id, archivedAt: null },
    select: { id: true, esiid: true },
  });

  if (!targetHouse) {
    return NextResponse.json(
      { ok: false, error: "home_not_found" },
      { status: 404 },
    );
  }

  const adminToken = process.env.ADMIN_TOKEN ?? "";
  if (!adminToken) {
    return NextResponse.json(
      {
        ok: false,
        error: "admin_token_missing",
        message: "ADMIN_TOKEN must be configured to trigger SMT pull/normalize.",
      },
      { status: 500 },
    );
  }

  const refreshed: HomeRefreshResult[] = [];
  const backfillRange = getRollingBackfillRange(12);

  const houseTasks = [targetHouse].map(async (house) => {
    const result: HomeRefreshResult = {
      homeId: house.id,
      authorizationRefreshed: false,
      pull: {
        attempted: Boolean(adminToken),
        ok: false,
      },
    };

    // Refresh authorization status (if exists)
    const latestAuth = await prisma.smtAuthorization.findFirst({
      where: { houseAddressId: house.id, archivedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    if (latestAuth) {
      try {
        await withTimeout(
          refreshSmtAuthorizationStatus(latestAuth.id),
          2500,
          "refreshSmtAuthorizationStatus",
        );
        result.authorizationRefreshed = true;
      } catch (error) {
        result.authorizationMessage =
          error instanceof Error
            ? error.message
            : "Failed to refresh SMT authorization status.";
      }
    } else {
      result.authorizationMessage = "No SMT authorization found for this home.";
    }

    // Trigger SMT pull (admin) if possible
    if (adminToken && house.esiid) {
      try {
        const baseUrl = resolveBaseUrl();
        const pullUrl = new URL("/api/admin/smt/pull", baseUrl);
        // NOTE: /api/admin/smt/pull will call the droplet webhook. The droplet now starts
        // ingest in the background and returns quickly, so this should not block long.
        const pullResponse = await fetch(pullUrl, {
          method: "POST",
          headers: {
            "x-admin-token": adminToken,
            "content-type": "application/json",
          },
          cache: "no-store",
          body: JSON.stringify({ esiid: house.esiid, houseId: house.id }),
        });

        result.pull.status = pullResponse.status;
        let pullPayload: any = null;
        try {
          pullPayload = await pullResponse.json();
        } catch {
          pullPayload = null;
        }

        if (pullResponse.ok && pullPayload?.ok !== false) {
          result.pull.ok = true;
          result.pull.message = pullPayload?.message ?? "SMT pull triggered.";
          result.pull.webhookResponse = pullPayload?.webhookResponse ?? null;
        } else {
          result.pull.ok = false;
          result.pull.message =
            pullPayload?.error ?? pullPayload?.details ?? "SMT pull request failed.";
          result.pull.webhookResponse = pullPayload?.webhookResponse ?? null;
        }
      } catch (error) {
        result.pull.ok = false;
        result.pull.message =
          error instanceof Error
            ? error.message
            : "Failed to invoke SMT pull webhook.";
      }
    } else if (!adminToken) {
      result.pull.message = "ADMIN_TOKEN not configured; SMT pull not attempted.";
    } else {
      result.pull.message = "House is missing an ESIID; SMT pull not attempted.";
    }

    // Request 12-month backfill to ensure full coverage.
    // IMPORTANT: only do this once SMT confirms the authorization is ACTIVE.
    // Also keep this best-effort (timeboxed) to avoid user-facing timeouts.
    let backfillOutcome: { homeId: string; ok: boolean; message?: string } | null = null;
    try {
      const auth = await prisma.smtAuthorization.findFirst({
        where: { houseAddressId: house.id, archivedAt: null },
        select: {
          id: true,
          esiid: true,
          meterNumber: true,
          smtStatus: true,
          smtBackfillRequestedAt: true,
        },
      });

      const statusNorm = String((auth as any)?.smtStatus ?? "")
        .trim()
        .toLowerCase();
      const isActive = statusNorm === "active" || statusNorm === "already_active";

      // Compute coverage so we can safely decide whether "already requested" is still acceptable.
      // If coverage is still partial and the previous request is stale, we allow a retry.
      let coverageStart: Date | null = null;
      let coverageEnd: Date | null = null;
      let coverageDays = 0;
      let historyReady = false;
      if (auth?.esiid) {
        const agg = await prisma.smtInterval.aggregate({
          where: { esiid: auth.esiid },
          _min: { ts: true },
          _max: { ts: true },
        });
        coverageStart = agg._min.ts ?? null;
        coverageEnd = agg._max.ts ?? null;
        coverageDays = coverageStart && coverageEnd ? daysBetweenInclusive(coverageStart, coverageEnd) : 0;

        const slopDays = 2;
        const targetStartMs = backfillRange.startDate.getTime() + slopDays * 24 * 60 * 60 * 1000;
        const targetEndMs = backfillRange.endDate.getTime() - slopDays * 24 * 60 * 60 * 1000;
        historyReady = Boolean(
          coverageStart &&
            coverageEnd &&
            coverageStart.getTime() <= targetStartMs &&
            coverageEnd.getTime() >= targetEndMs,
        );
      }

      // If we previously recorded a backfill request, only retry if:
      // - coverage is still not full-history, AND
      // - the request timestamp is "stale" (so we don't spam SMT)
      // If we have *no* raw files arriving, it’s likely the pipeline is stalled. Allow a quicker retry.
      const rawCount = auth?.esiid
        ? await prisma.rawSmtFile.count({
            where: {
              OR: [
                { filename: { contains: auth.esiid } },
                { storage_path: { contains: auth.esiid } },
              ],
            },
          }).catch(() => 0)
        : 0;

      const retryAfterMs = rawCount === 0 ? 60 * 60 * 1000 : 6 * 60 * 60 * 1000; // 1h (stalled) else 6h
      const requestedAt = (auth as any)?.smtBackfillRequestedAt ? new Date((auth as any).smtBackfillRequestedAt) : null;
      const isStale = requestedAt ? Date.now() - requestedAt.getTime() >= retryAfterMs : false;
      const allowRetry = Boolean(requestedAt && !historyReady && isStale);

      // Only trigger backfill once ACTIVE (customer approved SMT email).
      // Also avoid duplicate requests if we've already recorded a request time,
      // unless we are clearly still missing coverage and the prior request is stale.
      if (auth?.id && auth.esiid && isActive && (!requestedAt || allowRetry)) {
        const res = await withTimeout(
          requestSmtBackfillForAuthorization({
            authorizationId: auth.id,
            esiid: auth.esiid,
            meterNumber: auth.meterNumber,
            startDate: backfillRange.startDate,
            endDate: backfillRange.endDate,
          }),
          2500,
          "requestSmtBackfillForAuthorization",
        );

        // Treat this as an attempt timestamp (used for rate-limiting retries).
        await prisma.smtAuthorization.update({
          where: { id: auth.id },
          data: { smtBackfillRequestedAt: new Date() },
        }).catch(() => null);

        backfillOutcome = {
          homeId: house.id,
          ok: res.ok,
          message:
            (allowRetry ? `backfill_retry:stale_request(rawFiles=${rawCount});` : "") +
            (res.message ?? ""),
        };
      } else if (auth?.id && auth.esiid && !isActive) {
        backfillOutcome = {
          homeId: house.id,
          ok: false,
          message: "backfill_skipped:not_active",
        };
      } else if (auth?.id && auth.esiid && (auth as any)?.smtBackfillRequestedAt) {
        backfillOutcome = {
          homeId: house.id,
          ok: true,
          message: historyReady
            ? "backfill_skipped:history_ready"
            : isStale
              ? `backfill_skipped:already_requested_stale_not_retried(coverage_days=${coverageDays})`
              : `backfill_skipped:already_requested_recent(coverage_days=${coverageDays},rawFiles=${rawCount})`,
        };
      }
    } catch (backfillError) {
      backfillOutcome = {
        homeId: house.id,
        ok: false,
        message: backfillError instanceof Error ? backfillError.message : String(backfillError),
      };
    }

    return { result, backfillOutcome };
  });

  const houseResults = await Promise.all(houseTasks);
  const backfillResults = houseResults
    .map((hr) => hr.backfillOutcome)
    .filter((x): x is { homeId: string; ok: boolean; message?: string } => Boolean(x));
  refreshed.push(...houseResults.map((hr) => hr.result));

  return NextResponse.json({
    ok: true,
    homes: refreshed,
    // Normalization is handled by the SMT ingest pipeline (droplet upload/inline normalize).
    // Keeping refresh fast avoids Vercel invocation timeouts.
    backfill: backfillResults,
  });
}

