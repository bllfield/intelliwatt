import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { requireAdmin } from "@/lib/auth/admin";
import { db } from "@/lib/db";
import { refreshAllUsersAndBuildExpiryDigest } from "@/lib/hitthejackwatt/entryLifecycle";
import { normalizeEmailSafe } from "@/lib/utils/email";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Keep consistent with `app/admin/magic/route.ts` + `app/api/send-admin-magic-link/route.ts`
const ADMIN_EMAILS = ["brian@intelliwatt.com", "brian@intellipath-solutions.com"];

function hasAdminSessionCookie(request: NextRequest): boolean {
  const raw = request.cookies.get("intelliwatt_admin")?.value ?? "";
  const email = normalizeEmailSafe(raw);
  if (!email) return false;
  return ADMIN_EMAILS.includes(email);
}

function monthKeyChicago(d: Date): string {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit" });
  const parts = fmt.formatToParts(d);
  const yy = parts.find((p) => p.type === "year")?.value ?? "0000";
  const mm = parts.find((p) => p.type === "month")?.value ?? "00";
  return `${yy}-${mm}`;
}

function isEarnedCommissionStatus(v: unknown): boolean {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "paid" || s === "approved";
}

export async function POST(request: NextRequest) {
  try {
    if (!hasAdminSessionCookie(request)) {
      const gate = requireAdmin(request);
      if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });
    }

    const now = new Date();
    const thisMonthKey = monthKeyChicago(now);

    // Prevent double-run within the same Chicago month unless explicitly forced.
    const body = (await request.json().catch(() => null)) as any;
    const force = body?.force === true;

    const latest = await db.jackpotPayout.findFirst({
      orderBy: { drawingDate: "desc" },
      select: { id: true, drawingDate: true },
    });
    if (!force && latest?.drawingDate && monthKeyChicago(new Date(latest.drawingDate)) === thisMonthKey) {
      return NextResponse.json(
        { ok: false, error: `Already ran drawing for ${thisMonthKey} (use force=true to override).` },
        { status: 409 },
      );
    }

    // Refresh entry statuses so the pool reflects SMT/manual usage expiry.
    const digest = await refreshAllUsersAndBuildExpiryDigest();

    const eligible = await db.entry.findMany({
      where: { status: { in: ["ACTIVE", "EXPIRING_SOON"] } as any },
      select: { userId: true, amount: true },
    });

    const ticketsByUser = new Map<string, number>();
    let totalTickets = 0;
    for (const e of eligible as any[]) {
      const uid = String(e.userId);
      const amt = typeof e.amount === "number" && Number.isFinite(e.amount) ? Math.trunc(e.amount) : 0;
      if (!uid || amt <= 0) continue;
      const cur = ticketsByUser.get(uid) ?? 0;
      const next = cur + amt;
      ticketsByUser.set(uid, next);
      totalTickets += amt;
    }

    if (totalTickets <= 0 || ticketsByUser.size === 0) {
      return NextResponse.json(
        { ok: false, error: "No eligible entries to draw from.", totalTickets: 0, eligibleUsers: 0, flaggedDigestCount: digest.length },
        { status: 400 },
      );
    }

    const draw = crypto.randomInt(totalTickets); // 0..totalTickets-1
    let cursor = 0;
    let winnerUserId: string | null = null;
    const ticketRows = Array.from(ticketsByUser.entries());
    for (let i = 0; i < ticketRows.length; i++) {
      const [uid, count] = ticketRows[i];
      cursor += count;
      if (draw < cursor) {
        winnerUserId = uid;
        break;
      }
    }

    if (!winnerUserId) {
      return NextResponse.json({ ok: false, error: "Failed to pick a winner.", totalTickets, eligibleUsers: ticketsByUser.size }, { status: 500 });
    }

    // Best-effort jackpot amount estimate: $5 per unique earned/paid commission user in this Chicago month.
    const recentCommissions = await db.commissionRecord.findMany({
      where: { createdAt: { gt: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000) } },
      select: { userId: true, status: true, createdAt: true },
    });
    const commissionableUsers = new Set<string>();
    for (const c of recentCommissions as any[]) {
      if (!isEarnedCommissionStatus(c.status)) continue;
      const createdAt = c.createdAt ? new Date(c.createdAt) : null;
      if (!createdAt) continue;
      if (monthKeyChicago(createdAt) !== thisMonthKey) continue;
      commissionableUsers.add(String(c.userId));
    }
    const jackpotAmount = commissionableUsers.size * 5;

    const payout = await db.jackpotPayout.create({
      data: {
        userId: winnerUserId,
        amount: jackpotAmount,
        drawingDate: now,
      },
      include: { user: { select: { id: true, email: true } } },
    });

    return NextResponse.json({
      ok: true,
      monthKey: thisMonthKey,
      flaggedDigestCount: digest.length,
      pool: { eligibleUsers: ticketsByUser.size, totalTickets },
      winner: { userId: winnerUserId, email: payout.user?.email ?? null },
      payout: {
        id: payout.id,
        userId: payout.userId,
        amount: payout.amount,
        drawingDate: payout.drawingDate.toISOString(),
        paid: payout.paid,
      },
    });
  } catch (error) {
    console.error("[admin_jackpot_draw] error", error);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

