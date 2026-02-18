import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/utils/email";
import { anchorEndDateUtc } from "@/modules/manualUsage/anchor";

type TravelRange = { startDate: string; endDate: string };

type MonthlyPayload = {
  mode: "MONTHLY";
  anchorEndMonth: string; // YYYY-MM
  billEndDay: number;
  monthlyKwh: Array<{ month: string; kwh: number | "" }>;
  travelRanges: TravelRange[];
};

type AnnualPayload = {
  mode: "ANNUAL";
  endDate: string; // YYYY-MM-DD
  annualKwh: number | "";
  travelRanges: TravelRange[];
};

type ManualUsagePayload = MonthlyPayload | AnnualPayload;

function clampInt(n: unknown, lo: number, hi: number): number {
  const x = typeof n === "number" && Number.isFinite(n) ? Math.trunc(n) : Number(n);
  const y = Number.isFinite(x) ? x : lo;
  return Math.max(lo, Math.min(hi, y));
}

function isIsoDate(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.trim());
}

function isYearMonth(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}$/.test(s.trim());
}

function normalizeRanges(ranges: any): TravelRange[] {
  if (!Array.isArray(ranges)) return [];
  return ranges
    .map((r) => ({ startDate: String(r?.startDate ?? "").slice(0, 10), endDate: String(r?.endDate ?? "").slice(0, 10) }))
    .filter((r) => isIsoDate(r.startDate) && isIsoDate(r.endDate));
}

async function requireUser() {
  const cookieStore = cookies();
  const userEmailRaw = cookieStore.get("intelliwatt_user")?.value ?? null;
  if (!userEmailRaw) return { ok: false as const, status: 401, body: { ok: false, error: "Not authenticated" } };

  const userEmail = normalizeEmail(userEmailRaw);
  const user = await prisma.user.findUnique({ where: { email: userEmail }, select: { id: true } });
  if (!user) return { ok: false as const, status: 404, body: { ok: false, error: "User not found" } };

  return { ok: true as const, user };
}

async function requireHouse(userId: string, houseId: string) {
  const h = await prisma.houseAddress.findFirst({
    where: { id: houseId, userId, archivedAt: null },
    select: { id: true },
  });
  return Boolean(h);
}

export async function GET(request: NextRequest) {
  try {
    const u = await requireUser();
    if (!u.ok) return NextResponse.json(u.body, { status: u.status });

    const url = new URL(request.url);
    const houseId = (url.searchParams.get("houseId") ?? "").trim();
    if (!houseId) {
      return NextResponse.json({ ok: false, error: "houseId_required" }, { status: 400 });
    }

    const owns = await requireHouse(u.user.id, houseId);
    if (!owns) return NextResponse.json({ ok: false, error: "House not found for user" }, { status: 403 });

    const rec = await (prisma as any).manualUsageInput.findUnique({
      where: { userId_houseId: { userId: u.user.id, houseId } },
      select: { payload: true, updatedAt: true },
    });

    return NextResponse.json({
      ok: true,
      houseId,
      payload: rec?.payload ?? null,
      updatedAt: rec?.updatedAt ? new Date(rec.updatedAt).toISOString() : null,
    });
  } catch (error) {
    console.error("[user/manual-usage] GET error", error);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const u = await requireUser();
    if (!u.ok) return NextResponse.json(u.body, { status: u.status });

    const body = await request.json().catch(() => ({}));
    const houseId = typeof body?.houseId === "string" ? body.houseId.trim() : "";
    if (!houseId) return NextResponse.json({ ok: false, error: "houseId_required" }, { status: 400 });

    const owns = await requireHouse(u.user.id, houseId);
    if (!owns) return NextResponse.json({ ok: false, error: "House not found for user" }, { status: 403 });

    const payload = body?.payload as ManualUsagePayload | null;
    if (!payload || (payload as any).mode !== "MONTHLY" && (payload as any).mode !== "ANNUAL") {
      return NextResponse.json({ ok: false, error: "payload_required" }, { status: 400 });
    }

    const now = new Date();

    const mode = payload.mode;
    let anchorEndMonth: string | null = null;
    let anchorEndDate: Date | null = null;
    let annualEndDate: Date | null = null;

    if (mode === "MONTHLY") {
      if (!isYearMonth(payload.anchorEndMonth)) {
        return NextResponse.json({ ok: false, error: "anchorEndMonth_invalid" }, { status: 400 });
      }
      anchorEndMonth = payload.anchorEndMonth.trim();
      const billEndDay = clampInt(payload.billEndDay, 1, 31);
      anchorEndDate = anchorEndDateUtc(anchorEndMonth, billEndDay);
      if (!anchorEndDate) {
        return NextResponse.json({ ok: false, error: "anchorEndMonth_invalid" }, { status: 400 });
      }
      const monthly = Array.isArray(payload.monthlyKwh) ? payload.monthlyKwh.slice(0, 12) : [];
      const cleaned = monthly.map((r) => ({
        month: String((r as any)?.month ?? "").trim(),
        kwh:
          (r as any)?.kwh === "" ? "" : (typeof (r as any)?.kwh === "number" && Number.isFinite((r as any).kwh) ? (r as any).kwh : ""),
      }));
      const travelRanges = normalizeRanges(payload.travelRanges);

      const stored: MonthlyPayload = {
        mode: "MONTHLY",
        anchorEndMonth,
        billEndDay,
        monthlyKwh: cleaned,
        travelRanges,
      };

      const rec = await (prisma as any).manualUsageInput.upsert({
        where: { userId_houseId: { userId: u.user.id, houseId } },
        create: {
          userId: u.user.id,
          houseId,
          mode: "MONTHLY",
          payload: stored,
          anchorEndMonth,
          anchorEndDate,
          annualEndDate: null,
        },
        update: {
          mode: "MONTHLY",
          payload: stored,
          anchorEndMonth,
          anchorEndDate,
          annualEndDate: null,
          updatedAt: now,
        },
        select: { updatedAt: true },
      });

      return NextResponse.json({ ok: true, houseId, updatedAt: new Date(rec.updatedAt).toISOString() });
    }

    // ANNUAL
    if (!isIsoDate(payload.endDate)) {
      return NextResponse.json({ ok: false, error: "endDate_invalid" }, { status: 400 });
    }
    annualEndDate = new Date(`${payload.endDate}T00:00:00.000Z`);
    if (!Number.isFinite(annualEndDate.getTime())) {
      return NextResponse.json({ ok: false, error: "endDate_invalid" }, { status: 400 });
    }
    const annualKwh =
      typeof payload.annualKwh === "number" && Number.isFinite(payload.annualKwh) ? payload.annualKwh : null;
    if (annualKwh == null) {
      return NextResponse.json({ ok: false, error: "annualKwh_required" }, { status: 400 });
    }
    const travelRanges = normalizeRanges(payload.travelRanges);

    const stored: AnnualPayload = {
      mode: "ANNUAL",
      endDate: payload.endDate.trim(),
      annualKwh,
      travelRanges,
    };

    const rec = await (prisma as any).manualUsageInput.upsert({
      where: { userId_houseId: { userId: u.user.id, houseId } },
      create: {
        userId: u.user.id,
        houseId,
        mode: "ANNUAL",
        payload: stored,
        anchorEndMonth: null,
        anchorEndDate: null,
        annualEndDate,
      },
      update: {
        mode: "ANNUAL",
        payload: stored,
        anchorEndMonth: null,
        anchorEndDate: null,
        annualEndDate,
        updatedAt: now,
      },
      select: { updatedAt: true },
    });

    return NextResponse.json({ ok: true, houseId, updatedAt: new Date(rec.updatedAt).toISOString() });
  } catch (error) {
    console.error("[user/manual-usage] POST error", error);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

