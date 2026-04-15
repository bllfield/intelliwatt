import { prisma } from "@/lib/db";
import { pickBestSmtAuthorization } from "@/lib/smt/authorizationSelection";
import {
  refreshSmtAuthorizationStatus,
  getRollingBackfillRange,
  requestSmtBackfillForAuthorization,
} from "@/lib/smt/agreements";

const DAY_MS = 24 * 60 * 60 * 1000;

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
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`${label}:timeout_after_${timeoutMs}ms`)), timeoutMs)
      ),
    ]);
  } finally {
    clearTimeout(id);
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

export interface HomeRefreshResult {
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

export type UsageRefreshResult =
  | {
      ok: true;
      homes: HomeRefreshResult[];
      backfill: Array<{ homeId: string; ok: boolean; message?: string }>;
    }
  | {
      ok: false;
      error: "home_not_found" | "admin_token_missing";
      message?: string;
    };

export async function requestUsageRefreshForUserHouse(args: {
  userId: string;
  houseId: string;
}): Promise<UsageRefreshResult> {
  const targetHouse = await prisma.houseAddress.findFirst({
    where: { id: args.houseId, userId: args.userId, archivedAt: null },
    select: { id: true, esiid: true },
  });

  if (!targetHouse) {
    return { ok: false, error: "home_not_found" };
  }

  const adminToken = process.env.ADMIN_TOKEN ?? "";
  if (!adminToken) {
    return {
      ok: false,
      error: "admin_token_missing",
      message: "ADMIN_TOKEN must be configured to trigger SMT pull/normalize.",
    };
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

    const authCandidates = await prisma.smtAuthorization.findMany({
      where: { houseAddressId: house.id, archivedAt: null },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: { id: true },
    });
    const latestAuth = pickBestSmtAuthorization(authCandidates as any[]);

    if (latestAuth) {
      try {
        await withTimeout(
          refreshSmtAuthorizationStatus(latestAuth.id),
          2500,
          "refreshSmtAuthorizationStatus"
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

    if (adminToken && house.esiid) {
      try {
        const baseUrl = resolveBaseUrl();
        const pullUrl = new URL("/api/admin/smt/pull", baseUrl);
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

    let backfillOutcome: { homeId: string; ok: boolean; message?: string } | null = null;
    try {
      const authCandidates = await prisma.smtAuthorization.findMany({
        where: { houseAddressId: house.id, archivedAt: null },
        orderBy: { createdAt: "desc" },
        take: 25,
        select: {
          id: true,
          esiid: true,
          meterNumber: true,
          smtStatus: true,
          smtBackfillRequestedAt: true,
        },
      });
      const auth = pickBestSmtAuthorization(authCandidates as any[]);

      const statusNorm = String((auth as any)?.smtStatus ?? "").trim().toLowerCase();
      const isActive = statusNorm === "active" || statusNorm === "already_active";

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
        const targetStartMs = backfillRange.startDate.getTime() + slopDays * DAY_MS;
        const targetEndMs = backfillRange.endDate.getTime() - slopDays * DAY_MS;
        historyReady = Boolean(
          coverageStart &&
            coverageEnd &&
            coverageStart.getTime() <= targetStartMs &&
            coverageEnd.getTime() >= targetEndMs
        );
      }

      const rawCount = auth?.esiid
        ? await prisma.rawSmtFile
            .count({
              where: {
                OR: [
                  { filename: { contains: auth.esiid } },
                  { storage_path: { contains: auth.esiid } },
                ],
              },
            })
            .catch(() => 0)
        : 0;

      const retryAfterMs = rawCount === 0 && coverageDays < 30 ? 60 * 60 * 1000 : 6 * 60 * 60 * 1000;
      const requestedAt = (auth as any)?.smtBackfillRequestedAt
        ? new Date((auth as any).smtBackfillRequestedAt)
        : null;
      const isStale = requestedAt ? Date.now() - requestedAt.getTime() >= retryAfterMs : false;
      const allowRetry = Boolean(requestedAt && !historyReady && isStale);

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
          "requestSmtBackfillForAuthorization"
        );

        await prisma.smtAuthorization
          .update({
            where: { id: auth.id },
            data: { smtBackfillRequestedAt: new Date() },
          })
          .catch(() => null);

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

  return {
    ok: true,
    homes: refreshed,
    backfill: backfillResults,
  };
}
