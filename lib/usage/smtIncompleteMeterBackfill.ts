import { prisma } from "@/lib/db";
import { pickBestSmtAuthorization } from "@/lib/smt/authorizationSelection";
import { requestSmtBackfillForAuthorization } from "@/lib/smt/agreements";
import { normalizeDateKeys } from "@/lib/usage/smtTailCoverage";

export type TargetedSmtIntervalBackfillResult = {
  ok: boolean;
  skipped?: string;
  message?: string;
  dateKeys?: string[];
  startDateKey?: string;
  endDateKey?: string;
};

function dateKeyToUtcStart(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

function dateKeyToUtcEnd(dateKey: string): Date {
  return new Date(`${dateKey}T23:59:59.999Z`);
}

const SMT_INTERVAL_BACKFILL_ENABLED =
  process.env.SMT_INTERVAL_BACKFILL_ENABLED === "true" ||
  process.env.SMT_INTERVAL_BACKFILL_ENABLED === "1";

/**
 * Request SMT interval backfill for a narrow calendar window.
 * Used when rolling refresh skips backfill (history_ready) but specific days remain partial.
 */
export async function requestTargetedSmtIntervalBackfillForHouse(args: {
  houseId: string;
  dateKeys: string[];
}): Promise<TargetedSmtIntervalBackfillResult> {
  const dateKeys = normalizeDateKeys(args.dateKeys);
  if (dateKeys.length === 0) {
    return { ok: true, skipped: "no_date_keys" };
  }
  if (!SMT_INTERVAL_BACKFILL_ENABLED) {
    return { ok: false, skipped: "interval_backfill_disabled" };
  }

  const house = await prisma.houseAddress
    .findFirst({
      where: { id: args.houseId, archivedAt: null },
      select: { id: true, esiid: true },
    })
    .catch(() => null);
  if (!house?.esiid) {
    return { ok: false, skipped: "house_or_esiid_missing" };
  }

  const authCandidates = await prisma.smtAuthorization
    .findMany({
      where: { houseAddressId: house.id, archivedAt: null },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: { id: true, esiid: true, meterNumber: true, smtStatus: true },
    })
    .catch(() => []);
  const auth = pickBestSmtAuthorization(authCandidates as any[]);
  if (!auth?.id || !auth.esiid) {
    return { ok: false, skipped: "authorization_missing" };
  }

  const statusNorm = String((auth as any)?.smtStatus ?? "").trim().toLowerCase();
  const isActive = statusNorm === "active" || statusNorm === "already_active";
  if (!isActive) {
    return { ok: false, skipped: "authorization_not_active", message: String((auth as any)?.smtStatus ?? "") };
  }

  const startDateKey = dateKeys[0]!;
  const endDateKey = dateKeys[dateKeys.length - 1]!;
  const res = await requestSmtBackfillForAuthorization({
    authorizationId: auth.id,
    esiid: auth.esiid,
    meterNumber: auth.meterNumber ?? null,
    startDate: dateKeyToUtcStart(startDateKey),
    endDate: dateKeyToUtcEnd(endDateKey),
  });

  if (res.ok) {
    await prisma.smtAuthorization
      .update({
        where: { id: auth.id },
        data: { smtBackfillRequestedAt: new Date() },
      })
      .catch(() => null);
  }

  return {
    ok: res.ok,
    message: res.message,
    dateKeys,
    startDateKey,
    endDateKey,
  };
}
