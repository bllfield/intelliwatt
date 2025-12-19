import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/utils/email";
import { usagePrisma } from "@/lib/db/usageClient";
import { getTdspDeliveryRates } from "@/lib/plan-engine/getTdspDeliveryRates";
import { calculatePlanCostForUsage } from "@/lib/plan-engine/calculatePlanCostForUsage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Bucket-key aliasing (loader boundary only).
// - Canonical all-day bucket key is `.total`.
// - Legacy/alternate storage may use explicit `0000-2400`.
const WEEKDAY_ALLDAY_KEYS = ["kwh.m.weekday.total", "kwh.m.weekday.0000-2400"] as const;
const WEEKEND_ALLDAY_KEYS = ["kwh.m.weekend.total", "kwh.m.weekend.0000-2400"] as const;

function isObject(v: unknown): v is Record<string, any> {
  return typeof v === "object" && v !== null;
}

function numOrNull(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function decimalishToNumber(v: any): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof v === "object" && typeof v.toString === "function") {
    const n = Number(v.toString());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function daysAgo(d: Date, days: number): Date {
  return new Date(d.getTime() - days * 24 * 60 * 60 * 1000);
}

function detectFreeWeekends(rateStructure: any): boolean {
  if (!rateStructure || !isObject(rateStructure)) return false;
  const rs: any = rateStructure;
  const periods: any[] = Array.isArray(rs?.timeOfUsePeriods)
    ? rs.timeOfUsePeriods
    : Array.isArray(rs?.planRules?.timeOfUsePeriods)
      ? rs.planRules.timeOfUsePeriods
      : [];
  if (!Array.isArray(periods) || periods.length === 0) return false;

  const hasWeekdayAllDay = periods.some((p) => {
    const startHour = numOrNull(p?.startHour);
    const endHour = numOrNull(p?.endHour);
    const days = Array.isArray(p?.daysOfWeek) ? (p.daysOfWeek as number[]) : null;
    return (
      startHour === 0 &&
      endHour === 24 &&
      Array.isArray(days) &&
      days.length === 5 &&
      days.every((d) => d === 1 || d === 2 || d === 3 || d === 4 || d === 5)
    );
  });
  const hasWeekendAllDay = periods.some((p) => {
    const startHour = numOrNull(p?.startHour);
    const endHour = numOrNull(p?.endHour);
    const days = Array.isArray(p?.daysOfWeek) ? (p.daysOfWeek as number[]) : null;
    return startHour === 0 && endHour === 24 && Array.isArray(days) && days.length === 2 && days.includes(0) && days.includes(6);
  });

  return hasWeekdayAllDay && hasWeekendAllDay;
}

function detectDayNightTou(rateStructure: any): boolean {
  if (!rateStructure || !isObject(rateStructure)) return false;
  const rs: any = rateStructure;
  const periods: any[] = Array.isArray(rs?.timeOfUsePeriods)
    ? rs.timeOfUsePeriods
    : Array.isArray(rs?.planRules?.timeOfUsePeriods)
      ? rs.planRules.timeOfUsePeriods
      : [];
  if (!Array.isArray(periods) || periods.length === 0) return false;

  const hasNight = periods.some((p) => numOrNull(p?.startHour) === 20 && numOrNull(p?.endHour) === 7);
  const hasDay = periods.some((p) => numOrNull(p?.startHour) === 7 && numOrNull(p?.endHour) === 20);
  return hasNight && hasDay;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function resolveAliasedMonthlyBucket(args: {
  monthBuckets: Record<string, number>;
  preferKey: string;
  aliasKeys: readonly string[];
}): { dbKeyUsed: string; kwh: number } | null {
  const month = args.monthBuckets ?? {};
  const present = args.aliasKeys.filter((k) => isFiniteNumber(month[k]));
  if (present.length <= 0) return null;

  // If both exist, we prefer preferKey but fail-closed on mismatched values.
  if (present.length > 1) {
    const v0 = month[present[0]]!;
    for (const k of present.slice(1)) {
      const v = month[k]!;
      if (Math.abs(v - v0) > 1e-6) return null;
    }
  }

  const preferred = isFiniteNumber(month[args.preferKey]) ? args.preferKey : present[0]!;
  return { dbKeyUsed: preferred, kwh: month[preferred]! };
}

export async function GET(req: NextRequest) {
  try {
    const cookieStore = cookies();
    const sessionEmail = cookieStore.get("intelliwatt_user")?.value ?? null;
    if (!sessionEmail) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const offerId = String(url.searchParams.get("offerId") ?? "").trim();
    if (!offerId) {
      return NextResponse.json({ ok: false, error: "missing_offerId" }, { status: 400 });
    }

    const monthsCount = (() => {
      const raw = url.searchParams.get("monthsCount");
      const n = raw ? Number(raw) : 12;
      const m = Number.isFinite(n) ? Math.floor(n) : 12;
      return Math.max(1, Math.min(24, m));
    })();

    const user = await prisma.user.findUnique({
      where: { email: normalizeEmail(sessionEmail) },
      select: { id: true },
    });
    if (!user) {
      return NextResponse.json({ ok: false, error: "user_not_found" }, { status: 404 });
    }

    // Select the same "primary else latest" house strategy used elsewhere.
    let house = await prisma.houseAddress.findFirst({
      where: { userId: user.id, archivedAt: null, isPrimary: true } as any,
      orderBy: { createdAt: "desc" },
      select: { id: true, esiid: true, tdspSlug: true },
    });
    if (!house) {
      house = await prisma.houseAddress.findFirst({
        where: { userId: user.id } as any,
        orderBy: { createdAt: "desc" },
        select: { id: true, esiid: true, tdspSlug: true },
      });
    }
    if (!house) {
      return NextResponse.json({ ok: false, error: "home_not_found" }, { status: 404 });
    }

    // Resolve template mapping (offerId -> RatePlan)
    const map = await (prisma as any).offerIdRatePlanMap.findUnique({
      where: { offerId },
      select: { offerId: true, ratePlanId: true },
    });
    const ratePlanId = map?.ratePlanId ? String(map.ratePlanId) : null;
    if (!ratePlanId) {
      return NextResponse.json(
        { ok: false, error: "template_unavailable", offerId },
        { status: 404 },
      );
    }

    const ratePlan = await (prisma as any).ratePlan.findUnique({
      where: { id: ratePlanId },
      select: {
        id: true,
        planName: true,
        supplier: true,
        rateStructure: true,
      },
    });
    const rateStructure = ratePlan?.rateStructure ?? null;
    if (!rateStructure || typeof rateStructure !== "object") {
      return NextResponse.json(
        { ok: false, error: "missing_rate_structure", offerId, ratePlanId },
        { status: 404 },
      );
    }

    // TDSP (best-effort)
    const tdspSlug = String(house.tdspSlug ?? "").trim().toLowerCase();
    const tdspRates = tdspSlug
      ? await getTdspDeliveryRates({ tdspSlug, asOf: new Date() }).catch(() => null)
      : null;

    const tdspApplied = {
      perKwhDeliveryChargeCents: numOrNull(tdspRates?.perKwhDeliveryChargeCents) ?? 0,
      monthlyCustomerChargeDollars: numOrNull(tdspRates?.monthlyCustomerChargeDollars) ?? 0,
      effectiveDate: tdspRates?.effectiveDate ?? undefined,
    };

    // Annual kWh (strict last 365 days, relative to latest interval timestamp; no bucket recompute here)
    let annualKwh: number | null = null;
    const esiid = house.esiid ? String(house.esiid) : null;
    if (esiid) {
      const latest = await prisma.smtInterval.findFirst({
        where: { esiid },
        orderBy: { ts: "desc" },
        select: { ts: true },
      });
      if (latest?.ts instanceof Date && !Number.isNaN(latest.ts.getTime())) {
        const windowEnd = latest.ts;
        const windowStart = daysAgo(windowEnd, 365);
        const agg = await prisma.smtInterval.aggregate({
          where: { esiid, ts: { gt: windowStart, lte: windowEnd } },
          _sum: { kwh: true },
        });
        annualKwh = decimalishToNumber((agg as any)?._sum?.kwh);
      }
    }

    if (annualKwh == null || !Number.isFinite(annualKwh) || annualKwh <= 0) {
      return NextResponse.json(
        { ok: false, error: "missing_usage_totals", offerId, ratePlanId },
        { status: 409 },
      );
    }

    // Attempt to load per-month bucket totals from usage DB (no on-demand aggregation here).
    const wantsFreeWeekends = detectFreeWeekends(rateStructure);
    const wantsDayNight = !wantsFreeWeekends && detectDayNightTou(rateStructure);

    const canonicalRequiredKeys = wantsFreeWeekends
      ? (["kwh.m.all.total", "kwh.m.weekday.total", "kwh.m.weekend.total"] as const)
      : wantsDayNight
        ? (["kwh.m.all.total", "kwh.m.all.2000-0700", "kwh.m.all.0700-2000"] as const)
        : (["kwh.m.all.total", "kwh.m.all.2000-0700", "kwh.m.all.0700-2000"] as const);

    const dbQueryKeys: string[] = wantsFreeWeekends
      ? Array.from(new Set<string>(["kwh.m.all.total", ...WEEKDAY_ALLDAY_KEYS, ...WEEKEND_ALLDAY_KEYS]))
      : [...canonicalRequiredKeys];

    const rows = await (usagePrisma as any).homeMonthlyUsageBucket.findMany({
      where: { homeId: house.id, bucketKey: { in: dbQueryKeys as any } },
      select: { yearMonth: true, bucketKey: true, kwhTotal: true },
      orderBy: { yearMonth: "desc" },
    });

    const byMonth: Record<string, Record<string, number>> = {};
    const monthsWithTotal: string[] = [];
    const seenMonths = new Set<string>();

    for (const r of rows ?? []) {
      const ym = String(r?.yearMonth ?? "").trim();
      const key = String(r?.bucketKey ?? "").trim();
      const kwh = decimalishToNumber(r?.kwhTotal);
      if (!ym || !key || kwh == null) continue;
      if (!byMonth[ym]) byMonth[ym] = {};
      byMonth[ym][key] = kwh;
      if (key === "kwh.m.all.total" && !seenMonths.has(ym)) {
        seenMonths.add(ym);
        monthsWithTotal.push(ym);
      }
    }

    // Pick the latest N months for which we have totals.
    const months = monthsWithTotal.slice(0, monthsCount).reverse();

    const usageBucketsByMonth = (() => {
      if (months.length !== monthsCount) return null;
      const out: Record<string, Record<string, number>> = {};
      let weekdayDbKeyUsed: string | null = null;
      let weekendDbKeyUsed: string | null = null;
      for (const ym of months) {
        const m = byMonth[ym] ?? {};
        // Only pass when complete; otherwise omit entirely (fixed-rate still works, TOU fails closed).
        if (wantsFreeWeekends) {
          const allKwh = m["kwh.m.all.total"];
          if (!isFiniteNumber(allKwh)) return null;

          const wk = resolveAliasedMonthlyBucket({
            monthBuckets: m,
            preferKey: "kwh.m.weekday.total",
            aliasKeys: WEEKDAY_ALLDAY_KEYS,
          });
          if (!wk) return null;

          const we = resolveAliasedMonthlyBucket({
            monthBuckets: m,
            preferKey: "kwh.m.weekend.total",
            aliasKeys: WEEKEND_ALLDAY_KEYS,
          });
          if (!we) return null;

          // Require month-to-month consistency of the underlying DB key shape.
          weekdayDbKeyUsed = weekdayDbKeyUsed ?? wk.dbKeyUsed;
          weekendDbKeyUsed = weekendDbKeyUsed ?? we.dbKeyUsed;
          if (weekdayDbKeyUsed !== wk.dbKeyUsed) return null;
          if (weekendDbKeyUsed !== we.dbKeyUsed) return null;

          // Emit canonical keys expected by calculator.
          out[ym] = {
            "kwh.m.all.total": allKwh,
            "kwh.m.weekday.total": wk.kwh,
            "kwh.m.weekend.total": we.kwh,
          };
        } else {
          for (const k of canonicalRequiredKeys) {
            if (!isFiniteNumber(m[k])) return null;
          }
          out[ym] = Object.fromEntries(canonicalRequiredKeys.map((k) => [k, m[k]]));
        }
      }
      return out;
    })();

    const estimate = calculatePlanCostForUsage({
      annualKwh,
      monthsCount,
      tdsp: tdspApplied,
      rateStructure,
      ...(usageBucketsByMonth ? { usageBucketsByMonth } : {}),
    });

    return NextResponse.json({
      ok: true,
      offerId,
      ratePlan: {
        id: ratePlanId,
        supplier: ratePlan?.supplier ?? null,
        planName: ratePlan?.planName ?? null,
      },
      tdspSlug: tdspSlug || null,
      monthsCount,
      annualKwh,
      usageBucketsByMonthIncluded: Boolean(usageBucketsByMonth),
      detected: {
        freeWeekends: wantsFreeWeekends,
        dayNightTou: wantsDayNight,
      },
      monthsIncluded: months,
      estimate,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "internal_error", message: e?.message ?? String(e) }, { status: 500 });
  }
}


