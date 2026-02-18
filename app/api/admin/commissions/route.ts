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

const EARNED_STATUSES = ["paid", "approved"];

function isEarnedStatus(v: unknown): boolean {
  const s = normStatus(v);
  return EARNED_STATUSES.includes(s);
}

type StatusFilter = "any" | "pending" | "earned";

function parseStatusFilter(v: string | null): StatusFilter {
  const s = (v ?? "").trim().toLowerCase();
  if (s === "pending") return "pending";
  if (s === "earned" || s === "paid") return "earned";
  return "any";
}

export async function GET(request: NextRequest) {
  try {
    if (!hasAdminSessionCookie(request)) {
      const gate = requireAdmin(request);
      if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });
    }

    const url = new URL(request.url);
    const q = (url.searchParams.get("q") ?? "").trim();
    const statusFilter = parseStatusFilter(url.searchParams.get("status"));
    const page = clampInt(Number(url.searchParams.get("page") ?? "1"), 1, 10_000);
    const pageSize = clampInt(Number(url.searchParams.get("pageSize") ?? "50"), 1, 200);

    const where: any = {};
    if (q) {
      where.OR = [
        { userId: { equals: q } },
        { user: { email: { contains: q, mode: "insensitive" } } },
      ];
    }

    // Best-effort status filtering (status is stored as a string, case varies).
    if (statusFilter === "earned") {
      where.status = { in: ["paid", "PAID", "approved", "APPROVED"] };
    } else if (statusFilter === "pending") {
      where.NOT = [{ status: { in: ["paid", "PAID", "approved", "APPROVED"] } }];
    }

    const [total, rowsRaw] = await Promise.all([
      db.commissionRecord.count({ where }),
      db.commissionRecord.findMany({
        where,
        include: {
          user: { select: { id: true, email: true, createdAt: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    let totalEarnedDollars = 0;
    let totalPendingDollars = 0;
    for (const r of rowsRaw as any[]) {
      const amt = typeof r.amount === "number" && Number.isFinite(r.amount) ? Number(r.amount) : 0;
      if (isEarnedStatus(r.status)) totalEarnedDollars += amt;
      else totalPendingDollars += amt;
    }

    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.max(1, Math.min(page, totalPages));

    return NextResponse.json({
      ok: true,
      q: q || null,
      status: statusFilter,
      page: safePage,
      pageSize,
      total,
      totalPages,
      totals: {
        earnedDollarsInPage: totalEarnedDollars,
        pendingDollarsInPage: totalPendingDollars,
      },
      rows: rowsRaw.map((r: any) => ({
        id: String(r.id),
        userId: String(r.userId),
        userEmail: r.user?.email ?? null,
        type: r.type ?? null,
        amount: typeof r.amount === "number" && Number.isFinite(r.amount) ? r.amount : null,
        status: r.status ?? null,
        earnedAt: r.earnedAt ? new Date(r.earnedAt).toISOString() : null,
        createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
      })),
    });
  } catch (error) {
    console.error("[admin_commissions] error", error);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}