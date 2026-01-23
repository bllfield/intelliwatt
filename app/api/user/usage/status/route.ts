import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/utils/email";
import { getRollingBackfillRange } from "@/lib/smt/agreements";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function daysBetweenInclusive(start: Date, end: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  const a = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const b = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  return Math.max(0, Math.floor((b.getTime() - a.getTime()) / msPerDay) + 1);
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

  const coverageDays =
    coverageStart && coverageEnd ? daysBetweenInclusive(coverageStart, coverageEnd) : 0;

  // "Ready" means we have essentially the full 365-day window (allow a little slop).
  const slopDays = 2;
  const targetStartMs = target.startDate.getTime() + slopDays * 24 * 60 * 60 * 1000;
  const targetEndMs = target.endDate.getTime() - slopDays * 24 * 60 * 60 * 1000;

  const historyReady = Boolean(
    coverageStart &&
      coverageEnd &&
      coverageStart.getTime() <= targetStartMs &&
      coverageEnd.getTime() >= targetEndMs,
  );

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

  const message = (() => {
    if (ready) return "Full SMT history has been ingested.";
    if (phase === "pending") return "Waiting for SMT data delivery.";
    if (phase === "processing") {
      if (intervalCount > 0 && coverageStart && coverageEnd) {
        if (rawCount === 0 && coverageDays <= 14) {
          return `Partial SMT snapshot ingested (${coverageDays} day(s)). Waiting for historical SMT files to arrive.`;
        }
        return `Partial SMT history ingested (${coverageDays} day(s)). Still importing historical usage.`;
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
      start: coverageStart ? coverageStart.toISOString() : null,
      end: coverageEnd ? coverageEnd.toISOString() : null,
      days: coverageDays,
    },
    target: {
      start: target.startDate.toISOString(),
      end: target.endDate.toISOString(),
    },
    message,
  });
}


