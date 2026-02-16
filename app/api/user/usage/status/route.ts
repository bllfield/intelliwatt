import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/utils/email";
import { getRollingBackfillRange } from "@/lib/smt/agreements";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DAY_MS = 24 * 60 * 60 * 1000;
const SMT_PULL_COOLDOWN_MS = 30 * DAY_MS;
const SMT_READY_COMPLETENESS = 0.99;
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
    return d.toISOString().slice(0, 10);
  }
}

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

  const requestedHomeId =
    typeof body?.homeId === "string" && body.homeId.trim().length > 0
      ? body.homeId.trim()
      : null;

  if (!requestedHomeId) {
    return NextResponse.json(
      { ok: false, error: "home_id_required", message: "homeId is required." },
      { status: 400 },
    );
  }

  const house = await prisma.houseAddress.findFirst({
    where: { id: requestedHomeId, userId: user.id, archivedAt: null },
    select: { id: true, esiid: true },
  });

  if (!house) {
    return NextResponse.json(
      { ok: false, error: "home_not_found", message: "Home not found for this user." },
      { status: 404 },
    );
  }

  if (!house.esiid) {
    return NextResponse.json(
      {
        ok: true,
        status: "no_esiid",
        ready: false, // ready == full-history ready
        message: "No ESIID is linked to this home yet.",
      },
      { status: 200 },
    );
  }

  const target = getRollingBackfillRange(12);

  // Check whether any SMT intervals exist for this ESIID + compute coverage.
  const intervalAgg = await prisma.smtInterval.aggregate({
    where: { esiid: house.esiid },
    _count: { _all: true },
    _min: { ts: true },
    _max: { ts: true },
  });

  const intervalCount = Number(intervalAgg._count?._all ?? 0);
  const coverageStart = intervalAgg._min?.ts ?? null;
  const coverageEnd = intervalAgg._max?.ts ?? null;

  const coverageStartDate = coverageStart ? chicagoDateKey(coverageStart) : null;
  const coverageEndDate = coverageEnd ? chicagoDateKey(coverageEnd) : null;
  const coverageDays =
    coverageStartDate && coverageEndDate
      ? daysBetweenDateKeysInclusive(coverageStartDate, coverageEndDate)
      : 0;

  // "Ready" means: full-year span and near-complete series (stop chasing a 1-day tail).
  const expectedIntervals = Math.max(1, coverageDays * 96);
  const completenessByDaySpan = expectedIntervals > 0 ? intervalCount / expectedIntervals : 0;
  const historyReady = Boolean(coverageDays >= 365 && completenessByDaySpan >= SMT_READY_COMPLETENESS);

  // Also report whether any raw SMT files have landed for visibility.
  const rawCount = await prisma.rawSmtFile.count({
    where: {
      OR: [
        { filename: { contains: house.esiid } },
        { storage_path: { contains: house.esiid } },
      ],
    },
  });

  const ready = historyReady;
  const phase = ready ? "ready" : intervalCount > 0 || rawCount > 0 ? "processing" : "pending";

  const tailGapDays =
    coverageEndDate
      ? (() => {
          const targetEndKey = target.endDate.toISOString().slice(0, 10);
          return coverageEndDate < targetEndKey
            ? Math.max(0, daysBetweenDateKeysInclusive(coverageEndDate, targetEndKey) - 1)
            : 0;
        })()
      : 0;

  const pullEligibleNow = !coverageEnd ? true : Date.now() - coverageEnd.getTime() >= SMT_PULL_COOLDOWN_MS;
  const pullEligibleAt = coverageEnd
    ? new Date(coverageEnd.getTime() + SMT_PULL_COOLDOWN_MS).toISOString()
    : new Date().toISOString();

  const message = (() => {
    if (ready) return "Full SMT history has been ingested.";
    if (phase === "pending") return "Waiting for SMT data delivery.";
    if (phase === "processing") {
      if (intervalCount > 0 && coverageStart && coverageEnd) {
        if (rawCount === 0) {
          if (tailGapDays > 0) {
            return `SMT intervals ingested (${coverageDays} day(s)). Coverage is nearly complete. Refresh is limited to once every 30 days unless gaps are detected.`;
          }
          return `SMT intervals ingested (${coverageDays} day(s)). Finishing processing.`;
        }
        if (tailGapDays > 0) {
          return `SMT intervals ingested (${coverageDays} day(s)). Processing newly received SMT files. Refresh is limited to once every 30 days unless gaps are detected.`;
        }
        return `SMT intervals ingested (${coverageDays} day(s)). Processing newly received SMT files.`;
      }
      if (rawCount > 0) return "SMT files received; processing intervals.";
      return "Processing SMT usage.";
    }
    return null;
  })();

  return NextResponse.json({
    ok: true,
    status: phase,
    ready,
    intervals: intervalCount,
    rawFiles: rawCount,
    coverage: {
      start: coverageStartDate,
      end: coverageEndDate,
      days: coverageDays,
    },
    target: {
      start: target.startDate.toISOString(),
      end: target.endDate.toISOString(),
    },
    message,
    pull: {
      eligibleNow: pullEligibleNow,
      eligibleAt: pullEligibleAt,
    },
  });
}


