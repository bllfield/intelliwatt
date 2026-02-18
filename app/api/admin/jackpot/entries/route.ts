import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { db } from "@/lib/db";
import { normalizeEmailSafe } from "@/lib/utils/email";

export const dynamic = "force-dynamic";

// Keep consistent with `app/admin/magic/route.ts` + `app/api/send-admin-magic-link/route.ts`
const ADMIN_EMAILS = ["brian@intelliwatt.com", "brian@intellipath-solutions.com"];

function hasAdminSessionCookie(request: NextRequest): boolean {
  const raw = request.cookies.get("intelliwatt_admin")?.value ?? "";
  const email = normalizeEmailSafe(raw);
  if (!email) return false;
  return ADMIN_EMAILS.includes(email);
}

function clampInt(n: number, lo: number, hi: number): number {
  const x = Number.isFinite(n) ? Math.trunc(n) : lo;
  return Math.max(lo, Math.min(hi, x));
}

function normStatus(v: unknown): string {
  return String(v ?? "").trim().toLowerCase();
}

function isEarnedCommissionStatus(v: unknown): boolean {
  const s = normStatus(v);
  return s === "paid" || s === "approved";
}

type EntryStatus = "ACTIVE" | "EXPIRING_SOON" | "EXPIRED";

function bestEntryStatus(statuses: EntryStatus[]): EntryStatus | null {
  if (statuses.includes("ACTIVE")) return "ACTIVE";
  if (statuses.includes("EXPIRING_SOON")) return "EXPIRING_SOON";
  if (statuses.includes("EXPIRED")) return "EXPIRED";
  return null;
}

type SortKey = "entriesEligible" | "email" | "joined";

function parseSort(v: string | null): SortKey {
  const s = (v ?? "").trim();
  if (s === "email") return "email";
  if (s === "joined") return "joined";
  return "entriesEligible";
}

function parseDir(v: string | null): "asc" | "desc" {
  const s = (v ?? "").trim().toLowerCase();
  return s === "asc" ? "asc" : "desc";
}

export async function GET(request: NextRequest) {
  try {
    if (!hasAdminSessionCookie(request)) {
      const gate = requireAdmin(request);
      if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });
    }

    const url = new URL(request.url);
    const q = (url.searchParams.get("q") ?? "").trim();
    const sort = parseSort(url.searchParams.get("sort"));
    const dir = parseDir(url.searchParams.get("dir"));
    const page = clampInt(Number(url.searchParams.get("page") ?? "1"), 1, 10_000);
    const pageSize = clampInt(Number(url.searchParams.get("pageSize") ?? "50"), 1, 200);

    // We compute totals from Entry.status; this endpoint is for inspection of the current pool.
    const users = await db.user.findMany({
      where: q ? { email: { contains: q, mode: "insensitive" } } : undefined,
      select: { id: true, email: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });

    const userIds = users.map((u) => u.id);

    const [eligibleSums, expiredSums, entryRows, referralRows, commissionRows, profileRows] =
      await Promise.all([
        userIds.length
          ? db.entry.groupBy({
              by: ["userId"],
              where: { userId: { in: userIds }, status: { in: ["ACTIVE", "EXPIRING_SOON"] } as any },
              _sum: { amount: true },
            })
          : Promise.resolve([]),
        userIds.length
          ? db.entry.groupBy({
              by: ["userId"],
              where: { userId: { in: userIds }, status: "EXPIRED" as any },
              _sum: { amount: true },
            })
          : Promise.resolve([]),
        userIds.length
          ? db.entry.findMany({
              where: { userId: { in: userIds } },
              select: { userId: true, type: true, status: true, amount: true },
            })
          : Promise.resolve([]),
        userIds.length
          ? db.referral.findMany({
              where: { referredById: { in: userIds } },
              select: { referredById: true, status: true },
            })
          : Promise.resolve([]),
        userIds.length
          ? db.commissionRecord.findMany({
              where: { userId: { in: userIds } },
              select: { userId: true, amount: true, status: true },
            })
          : Promise.resolve([]),
        userIds.length
          ? (db as any).userProfile.findMany({
              where: { userId: { in: userIds } },
              select: { userId: true, _count: { select: { appliances: true } } },
            })
          : Promise.resolve([]),
      ]);

    const eligibleByUser = new Map<string, number>();
    for (const row of eligibleSums as any[]) {
      const uid = String(row.userId);
      const n = Number(row?._sum?.amount ?? 0);
      eligibleByUser.set(uid, Number.isFinite(n) ? n : 0);
    }

    const expiredByUser = new Map<string, number>();
    for (const row of expiredSums as any[]) {
      const uid = String(row.userId);
      const n = Number(row?._sum?.amount ?? 0);
      expiredByUser.set(uid, Number.isFinite(n) ? n : 0);
    }

    const statusesByUserType = new Map<string, Map<string, EntryStatus[]>>();
    for (const e of entryRows as any[]) {
      const uid = String(e.userId);
      const type = String(e.type ?? "").trim();
      const st = String(e.status ?? "").trim().toUpperCase() as EntryStatus;
      if (!uid || !type) continue;
      if (!(st === "ACTIVE" || st === "EXPIRING_SOON" || st === "EXPIRED")) continue;
      const m = statusesByUserType.get(uid) ?? new Map<string, EntryStatus[]>();
      const arr = m.get(type) ?? [];
      arr.push(st);
      m.set(type, arr);
      statusesByUserType.set(uid, m);
    }

    const referralAgg = new Map<string, { total: number; pending: number; qualified: number }>();
    for (const r of referralRows as any[]) {
      const uid = String(r.referredById);
      const st = String(r.status ?? "").trim().toUpperCase();
      const cur = referralAgg.get(uid) ?? { total: 0, pending: 0, qualified: 0 };
      cur.total += 1;
      if (st === "PENDING") cur.pending += 1;
      if (st === "QUALIFIED") cur.qualified += 1;
      referralAgg.set(uid, cur);
    }

    const commissionAgg = new Map<string, { earned: number; pending: number }>();
    for (const c of commissionRows as any[]) {
      const uid = String(c.userId);
      const amt = typeof c.amount === "number" && Number.isFinite(c.amount) ? Number(c.amount) : 0;
      const cur = commissionAgg.get(uid) ?? { earned: 0, pending: 0 };
      if (isEarnedCommissionStatus(c.status)) cur.earned += amt;
      else cur.pending += amt;
      commissionAgg.set(uid, cur);
    }

    const applianceCountByUser = new Map<string, number>();
    for (const p of profileRows as any[]) {
      const uid = String(p.userId);
      const n = Number(p?._count?.appliances ?? 0);
      applianceCountByUser.set(uid, Number.isFinite(n) ? n : 0);
    }

    const rowsAll = users.map((u) => {
      const uid = u.id;
      const m = statusesByUserType.get(uid) ?? new Map<string, EntryStatus[]>();
      const ref = referralAgg.get(uid) ?? { total: 0, pending: 0, qualified: 0 };
      const comm = commissionAgg.get(uid) ?? { earned: 0, pending: 0 };
      return {
        userId: uid,
        email: u.email,
        joinedAt: u.createdAt.toISOString(),
        entriesEligibleTotal: Math.max(0, Math.trunc(eligibleByUser.get(uid) ?? 0)),
        entriesExpiredTotal: Math.max(0, Math.trunc(expiredByUser.get(uid) ?? 0)),
        referralsTotal: ref.total,
        referralsPending: ref.pending,
        referralsQualified: ref.qualified,
        applianceCount: applianceCountByUser.get(uid) ?? 0,
        smartMeterEntryStatus: bestEntryStatus(m.get("smart_meter_connect") ?? []),
        currentPlanEntryStatus: bestEntryStatus(m.get("current_plan_details") ?? []),
        homeDetailsEntryStatus: bestEntryStatus(m.get("home_details_complete") ?? []),
        applianceDetailsEntryStatus: bestEntryStatus(m.get("appliance_details_complete") ?? []),
        testimonialEntryStatus: bestEntryStatus(m.get("testimonial") ?? []),
        referralEntryStatus: bestEntryStatus(m.get("referral") ?? []),
        commissionLifetimeEarnedDollars: comm.earned,
        commissionPendingDollars: comm.pending,
      };
    });

    const num = (v: any): number => (typeof v === "number" && Number.isFinite(v) ? v : Number.NEGATIVE_INFINITY);
    rowsAll.sort((a, b) => {
      const mul = dir === "asc" ? 1 : -1;
      if (sort === "email") return mul * String(a.email ?? "").localeCompare(String(b.email ?? ""));
      if (sort === "joined") return mul * (new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime());
      return mul * (num(a.entriesEligibleTotal) - num(b.entriesEligibleTotal));
    });

    const total = rowsAll.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.max(1, Math.min(page, totalPages));
    const start = (safePage - 1) * pageSize;
    const out = rowsAll.slice(start, start + pageSize);

    return NextResponse.json({
      ok: true,
      q: q || null,
      sort,
      dir,
      page: safePage,
      pageSize,
      total,
      totalPages,
      rows: out,
    });
  } catch (error) {
    console.error("[admin_jackpot_entries] error", error);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

