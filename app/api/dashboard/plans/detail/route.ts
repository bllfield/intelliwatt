import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/utils/email";
import { wattbuy } from "@/lib/wattbuy";
import { normalizeOffers } from "@/lib/wattbuy/normalize";
import { usagePrisma } from "@/lib/db/usageClient";
import { CORE_MONTHLY_BUCKETS } from "@/lib/plan-engine/usageBuckets";
import { getTdspDeliveryRates } from "@/lib/plan-engine/getTdspDeliveryRates";
import {
  calculatePlanCostForUsage,
  extractFixedRepEnergyCentsPerKwh,
  extractRepFixedMonthlyChargeDollars,
} from "@/lib/plan-engine/calculatePlanCostForUsage";
import { extractDeterministicTouSchedule } from "@/lib/plan-engine/touPeriods";
import { extractDeterministicTierSchedule, computeRepEnergyCostForMonthlyKwhTiered } from "@/lib/plan-engine/tieredPricing";
import { extractDeterministicBillCredits, applyBillCreditsToMonth } from "@/lib/plan-engine/billCredits";
import { extractDeterministicMinimumRules, applyMinimumRulesToMonth } from "@/lib/plan-engine/minimumRules";
import { canComputePlanFromBuckets, derivePlanCalcRequirementsFromTemplate } from "@/lib/plan-engine/planComputability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function roundCents(n: number): number {
  return Math.round(n);
}

function clampNonNegative(n: number): number {
  return n < 0 ? 0 : n;
}

function monthKwh(m: Record<string, number> | null | undefined, key: string): number | null {
  if (!m) return null;
  const v = (m as any)[key];
  if (v == null) return null;
  if (typeof v === "string" && v.trim() === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function decimalToNumber(v: any): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v && typeof v === "object" && typeof v.toString === "function") {
    const n = Number(v.toString());
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseBool(v: string | null, fallback: boolean): boolean {
  if (v == null) return fallback;
  const s = v.trim().toLowerCase();
  if (!s) return fallback;
  if (["1", "true", "yes", "y", "on"].includes(s)) return true;
  if (["0", "false", "no", "n", "off"].includes(s)) return false;
  return fallback;
}

function numOrNull(n: any): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function chicagoYearMonthParts(now: Date): { year: number; month: number } | null {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      year: "numeric",
      month: "2-digit",
    });
    const parts = fmt.formatToParts(now);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    const y = Number(get("year"));
    const m = Number(get("month"));
    if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return null;
    return { year: y, month: m };
  } catch {
    return null;
  }
}

function chicagoParts(ts: Date): {
  yearMonth: string;
  month: number;
  weekdayIndex: number; // 0=Sun..6=Sat
  minutesOfDay: number;
  isWeekend: boolean;
} | null {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      year: "numeric",
      month: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(ts);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    const y = Number(get("year"));
    const m = Number(get("month"));
    const hh = Number(get("hour"));
    const mm = Number(get("minute"));
    const wd = get("weekday");
    if (![y, m, hh, mm].every((n) => Number.isFinite(n))) return null;
    const weekdayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd);
    if (weekdayIndex < 0) return null;
    const minutesOfDay = hh * 60 + mm;
    const isWeekend = weekdayIndex === 0 || weekdayIndex === 6;
    return {
      yearMonth: `${String(y)}-${String(m).padStart(2, "0")}`,
      month: m,
      weekdayIndex,
      minutesOfDay,
      isWeekend,
    };
  } catch {
    return null;
  }
}

function hhmmToMinutes(hhmm: string): number | null {
  const s = String(hhmm ?? "").trim();
  if (!/^\d{4}$/.test(s)) return null;
  const hh = Number(s.slice(0, 2));
  const mm = Number(s.slice(2, 4));
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh === 24 && mm === 0) return 1440;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function evalRule(rule: any, interval: { month: number; weekdayIndex: number; isWeekend: boolean; minutesOfDay: number }): boolean {
  if (!rule || rule.v !== 1 || rule.tz !== "America/Chicago") return false;

  // Month filter (ACTUAL month; we do not shift month for START_DAY dayType attribution)
  if (Array.isArray(rule.months) && rule.months.length) {
    if (!rule.months.includes(interval.month)) return false;
  }

  const startMin = hhmmToMinutes(rule?.window?.startHHMM);
  const endMin = hhmmToMinutes(rule?.window?.endHHMM);
  if (startMin == null || endMin == null) return false;
  const isOvernight = endMin < startMin;

  // Day attribution (START_DAY only affects day filters in overnight buckets for post-midnight hours)
  let weekdayIndex = interval.weekdayIndex;
  let isWeekend = interval.isWeekend;
  if (isOvernight && rule.overnightAttribution === "START_DAY" && interval.minutesOfDay < endMin) {
    weekdayIndex = (weekdayIndex + 6) % 7;
    isWeekend = weekdayIndex === 0 || weekdayIndex === 6;
  }

  if (Array.isArray(rule.daysOfWeek) && rule.daysOfWeek.length) {
    if (!rule.daysOfWeek.includes(weekdayIndex)) return false;
  } else if (rule.dayType === "WEEKDAY") {
    if (isWeekend) return false;
  } else if (rule.dayType === "WEEKEND") {
    if (!isWeekend) return false;
  }

  // Window
  const t = interval.minutesOfDay;
  if (endMin === startMin) return false;
  if (!isOvernight) return t >= startMin && t < endMin;
  return t >= startMin || t < endMin;
}

function usageDefToRule(def: any): any | null {
  // Prefer stored ruleJson when present and compatible.
  const rj = def?.ruleJson ?? null;
  if (rj && typeof rj === "object" && (rj as any).v === 1 && (rj as any).tz === "America/Chicago") return rj;

  const dayType = typeof def?.dayType === "string" ? def.dayType : null;
  const tz = typeof def?.tz === "string" ? def.tz : null;
  const startHHMM = typeof def?.startHHMM === "string" ? def.startHHMM : null;
  const endHHMM = typeof def?.endHHMM === "string" ? def.endHHMM : null;
  if (!dayType || !tz || !startHHMM || !endHHMM) return null;

  return {
    v: 1,
    tz,
    dayType: dayType === "ALL" || dayType === "WEEKDAY" || dayType === "WEEKEND" ? dayType : undefined,
    window: { startHHMM: startHHMM, endHHMM: endHHMM },
    ...(def?.overnightAttribution ? { overnightAttribution: def.overnightAttribution } : {}),
  };
}

async function fetchSmtUsageWindow(esiid: string): Promise<{ latest: Date; cutoff: Date } | null> {
  const latest = await prisma.smtInterval.findFirst({
    where: { esiid },
    orderBy: { ts: "desc" },
    select: { ts: true },
  });
  if (!latest?.ts) return null;
  const cutoff = new Date(latest.ts.getTime() - 365 * DAY_MS);
  return { latest: latest.ts, cutoff };
}

async function fetchGreenButtonUsageWindow(houseId: string): Promise<{ latest: Date; cutoff: Date; rawId: string } | null> {
  const usageClient = usagePrisma as any;
  const latestRaw = await usageClient.rawGreenButton.findFirst({
    where: { homeId: houseId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!latestRaw?.id) return null;

  const latest = await usageClient.greenButtonInterval.findFirst({
    where: { homeId: houseId, rawId: latestRaw.id },
    orderBy: { timestamp: "desc" },
    select: { timestamp: true },
  });
  if (!latest?.timestamp) return null;
  const cutoff = new Date(latest.timestamp.getTime() - 365 * DAY_MS);
  return { latest: latest.timestamp, cutoff, rawId: latestRaw.id };
}

function isRateStructurePresent(v: any): boolean {
  if (v == null) return false;
  if (typeof v === "object" && (v as any)?.toJSON?.() === null) return false;
  if (typeof v !== "object") return false;
  try {
    return Object.keys(v).length > 0;
  } catch {
    return false;
  }
}

function isComputableOverride(planCalcStatus: string | null | undefined, planCalcReasonCode: string | null | undefined) {
  return (
    String(planCalcStatus ?? "").trim() === "COMPUTABLE" &&
    String(planCalcReasonCode ?? "").trim() === "ADMIN_OVERRIDE_COMPUTABLE"
  );
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const offerId = String(url.searchParams.get("offerId") ?? "").trim();
    const isRenter = parseBool(url.searchParams.get("isRenter"), false);
    const bucketsMode = String(url.searchParams.get("buckets") ?? "core").trim().toLowerCase();
    const includeAllBuckets = bucketsMode === "all";
    if (!offerId) {
      return NextResponse.json({ ok: false, error: "missing_offerId" }, { status: 400 });
    }

    const cookieStore = cookies();
    const sessionEmail = cookieStore.get("intelliwatt_user")?.value ?? null;
    if (!sessionEmail) {
      return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });
    }

    const userEmail = normalizeEmail(sessionEmail);
    const user = await prisma.user.findUnique({
      where: { email: userEmail },
      select: { id: true, email: true },
    });
    if (!user) {
      return NextResponse.json({ ok: false, error: "user_not_found" }, { status: 404 });
    }

    let house = await prisma.houseAddress.findFirst({
      where: { userId: user.id, archivedAt: null, isPrimary: true } as any,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        addressLine1: true,
        addressCity: true,
        addressState: true,
        addressZip5: true,
        esiid: true,
        tdspSlug: true,
        utilityName: true,
      },
    });
    if (!house) {
      house = await prisma.houseAddress.findFirst({
        where: { userId: user.id, archivedAt: null } as any,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          addressLine1: true,
          addressCity: true,
          addressState: true,
          addressZip5: true,
          esiid: true,
          tdspSlug: true,
          utilityName: true,
        },
      });
    }
    if (!house) {
      return NextResponse.json({ ok: false, error: "no_home" }, { status: 400 });
    }

    // Align usage snapshot & calculations to the SAME logic as /api/user/usage:
    // strict last 365 days ending at the latest interval timestamp, choosing SMT vs Green Button by latest timestamp.
    const smtWindow = house.esiid ? await fetchSmtUsageWindow(house.esiid).catch(() => null) : null;
    const gbWindow = await fetchGreenButtonUsageWindow(house.id).catch(() => null);
    const smtLatestMs = smtWindow?.latest ? smtWindow.latest.getTime() : 0;
    const gbLatestMs = gbWindow?.latest ? gbWindow.latest.getTime() : 0;
    const usageSource: "SMT" | "GREEN_BUTTON" | null =
      smtLatestMs === 0 && gbLatestMs === 0 ? null : smtLatestMs >= gbLatestMs ? "SMT" : "GREEN_BUTTON";

    const window = usageSource === "SMT" ? smtWindow : usageSource === "GREEN_BUTTON" ? gbWindow : null;
    if (!usageSource || !window) {
      return NextResponse.json({ ok: false, error: "no_usage_window" }, { status: 400 });
    }

    let annualKwh: number | null = null;
    let intervalsCount = 0;
    let windowStart: Date | null = null;
    let windowEnd: Date | null = null;
    let intervalRows: Array<{ ts: Date; kwh: number }> = [];

    if (usageSource === "SMT") {
      const esiid = house.esiid!;
      const aggregates = await prisma.smtInterval.aggregate({
        where: { esiid, ts: { gte: window.cutoff } },
        _count: { _all: true },
        _sum: { kwh: true },
        _min: { ts: true },
        _max: { ts: true },
      });
      intervalsCount = aggregates._count?._all ?? 0;
      annualKwh = decimalToNumber(aggregates._sum?.kwh ?? 0);
      windowStart = aggregates._min?.ts ?? null;
      windowEnd = aggregates._max?.ts ?? null;

      // Fetch intervals for bucket attribution table (last 365 days).
      const rows = await prisma.smtInterval.findMany({
        where: { esiid, ts: { gte: window.cutoff } },
        orderBy: { ts: "asc" },
        select: { ts: true, kwh: true },
      });
      intervalRows = rows
        .map((r) => ({ ts: r.ts, kwh: decimalToNumber((r as any).kwh) ?? 0 }))
        .filter((r) => Number.isFinite(r.kwh) && r.kwh > 0);
    } else {
      const usageClient = usagePrisma as any;
      const rawId = (window as any).rawId;
      const aggregates = await usageClient.greenButtonInterval.aggregate({
        where: { homeId: house.id, rawId, timestamp: { gte: window.cutoff } },
        _count: { _all: true },
        _sum: { consumptionKwh: true },
        _min: { timestamp: true },
        _max: { timestamp: true },
      });
      intervalsCount = aggregates._count?._all ?? 0;
      annualKwh = decimalToNumber(aggregates._sum?.consumptionKwh ?? 0);
      windowStart = aggregates._min?.timestamp ?? null;
      windowEnd = aggregates._max?.timestamp ?? null;

      const rows = await usageClient.greenButtonInterval.findMany({
        where: { homeId: house.id, rawId, timestamp: { gte: window.cutoff } },
        orderBy: { timestamp: "asc" },
        select: { timestamp: true, consumptionKwh: true },
      });
      intervalRows = rows
        .map((r: any) => ({ ts: r.timestamp as Date, kwh: decimalToNumber(r.consumptionKwh) ?? 0 }))
        .filter((r: any) => Number.isFinite(r.kwh) && r.kwh > 0);
    }

    // Choose which bucket definitions to render:
    // - core: lightweight, predictable 9 buckets
    // - all: every UsageBucketDefinition row in the usage DB (can be wider)
    const allBucketDefsRaw = includeAllBuckets
      ? await (usagePrisma as any).usageBucketDefinition
          .findMany({
            select: {
              key: true,
              label: true,
              dayType: true,
              season: true,
              startHHMM: true,
              endHHMM: true,
              tz: true,
              overnightAttribution: true,
              ruleJson: true,
            },
            orderBy: { key: "asc" },
            take: 200,
          })
          .catch(() => [])
      : [];

    const bucketDefs: Array<{ key: string; label: string; rule: any }> = includeAllBuckets
      ? (allBucketDefsRaw ?? [])
          .map((d: any) => {
            const key = typeof d?.key === "string" ? d.key : null;
            const label = typeof d?.label === "string" ? d.label : key;
            const rule = usageDefToRule(d);
            if (!key || !label || !rule) return null;
            return { key, label, rule };
          })
          .filter(Boolean)
      : CORE_MONTHLY_BUCKETS.map((b) => ({ key: b.key, label: b.label, rule: b.rule }));

    const bucketDefsForResponse = bucketDefs.map((b) => ({ key: b.key, label: b.label }));
    const byYmKey = new Map<string, number>();
    const yearMonthSet = new Set<string>();
    for (const row of intervalRows) {
      const parts = chicagoParts(row.ts);
      if (!parts) continue;
      yearMonthSet.add(parts.yearMonth);
      for (const b of bucketDefs) {
        if (!evalRule(b.rule, parts)) continue;
        const key = `${parts.yearMonth}||${b.key}`;
        byYmKey.set(key, (byYmKey.get(key) ?? 0) + row.kwh);
      }
    }
    const yearMonths = Array.from(yearMonthSet).sort((a, b) => (a < b ? -1 : 1));
    const bucketTable = yearMonths.map((ym) => {
      const r: any = { yearMonth: ym };
      for (const b of bucketDefs) {
        r[b.key] = byYmKey.get(`${ym}||${b.key}`) ?? null;
      }
      return r;
    });

    const avgMonthlyKwh = typeof annualKwh === "number" && Number.isFinite(annualKwh) ? annualKwh / 12 : null;

    // Fetch live offers and pick the one.
    const raw = await wattbuy.offers({
      address: house.addressLine1,
      city: house.addressCity,
      state: house.addressState,
      zip: house.addressZip5,
      isRenter,
    });
    const normalized = normalizeOffers(raw ?? {});
    const offers = Array.isArray((normalized as any)?.offers) ? (normalized as any).offers : [];
    const offer = offers.find((o: any) => String(o?.offer_id ?? "") === offerId) ?? null;
    if (!offer) {
      return NextResponse.json({ ok: false, error: "offer_not_found", offerId }, { status: 404 });
    }

    // Mapping offerId -> RatePlan template
    const map = await (prisma as any).offerIdRatePlanMap.findUnique({
      where: { offerId },
      select: { offerId: true, ratePlanId: true },
    });
    const ratePlanId = map?.ratePlanId ? String(map.ratePlanId) : null;

    const ratePlanRow = ratePlanId
      ? await (prisma as any).ratePlan.findUnique({
          where: { id: ratePlanId },
          select: {
            id: true,
            planName: true,
            supplier: true,
            termMonths: true,
            repPuctCertificate: true,
            eflVersionCode: true,
            eflUrl: true,
            rateStructure: true,
            planCalcStatus: true,
            planCalcReasonCode: true,
            requiredBucketKeys: true,
            planCalcDerivedAt: true,
          },
        })
      : null;

    const rateStructure = ratePlanRow?.rateStructure ?? null;
    const rsPresent = isRateStructurePresent(rateStructure);

    // TDSP rates
    const tdspSlug = String(offer?.tdsp ?? house.tdspSlug ?? "").trim().toLowerCase();
    const tdspRates = tdspSlug ? await getTdspDeliveryRates({ tdspSlug, asOf: new Date() }).catch(() => null) : null;

    // Plan calc requirements + computability
    const derivedReq = derivePlanCalcRequirementsFromTemplate({ rateStructure: rsPresent ? rateStructure : null });
    const planCalcStatus =
      typeof ratePlanRow?.planCalcStatus === "string" ? String(ratePlanRow.planCalcStatus) : derivedReq.planCalcStatus;
    const planCalcReasonCode =
      typeof ratePlanRow?.planCalcReasonCode === "string"
        ? String(ratePlanRow.planCalcReasonCode)
        : derivedReq.planCalcReasonCode;
    const requiredBucketKeys = Array.isArray(ratePlanRow?.requiredBucketKeys) && ratePlanRow.requiredBucketKeys.length
      ? (ratePlanRow.requiredBucketKeys as any[]).map(String)
      : derivedReq.requiredBucketKeys;

    const planComputability = canComputePlanFromBuckets({
      offerId,
      ratePlanId,
      templateAvailable: Boolean(ratePlanId && rsPresent),
      template: ratePlanId && rsPresent ? { rateStructure } : null,
    });

    // Build usageBucketsByMonth for the calculator from our bucket table.
    // The calculator fails-closed when required keys are missing.
    const usageBucketsByMonthForCalc: Record<string, Record<string, number>> = {};
    for (const r of bucketTable) {
      const ym = typeof (r as any)?.yearMonth === "string" ? String((r as any).yearMonth) : null;
      if (!ym) continue;
      const month: Record<string, number> = {};
      for (const b of bucketDefsForResponse) {
        const key = String((b as any)?.key ?? "").trim();
        if (!key) continue;
        const v = (r as any)[key];
        const n = typeof v === "number" ? v : Number(v);
        if (Number.isFinite(n)) month[key] = n;
      }
      usageBucketsByMonthForCalc[ym] = month;
    }

    // Calc inputs / variables
    const repEnergyCentsPerKwh = rsPresent ? extractFixedRepEnergyCentsPerKwh(rateStructure) : null;
    const repFixedMonthlyChargeDollars = rsPresent ? extractRepFixedMonthlyChargeDollars(rateStructure) : null;
    const tdspApplied = tdspRates
      ? {
          perKwhDeliveryChargeCents: Number(tdspRates?.perKwhDeliveryChargeCents ?? 0) || 0,
          monthlyCustomerChargeDollars: Number(tdspRates?.monthlyCustomerChargeDollars ?? 0) || 0,
          effectiveDate: tdspRates?.effectiveDate ?? null,
        }
      : null;

    // True-cost estimate (if computable + inputs present)
    const overriddenComputable = isComputableOverride(planCalcStatus, planCalcReasonCode);
    const trueCostEstimate =
      annualKwh && rsPresent && (overriddenComputable || planComputability?.status !== "NOT_COMPUTABLE")
        ? calculatePlanCostForUsage({
            annualKwh, // strict last-365-days total (matches /api/user/usage)
            monthsCount: 12,
            tdsp: {
              perKwhDeliveryChargeCents: tdspApplied?.perKwhDeliveryChargeCents ?? 0,
              monthlyCustomerChargeDollars: tdspApplied?.monthlyCustomerChargeDollars ?? 0,
              effectiveDate: tdspApplied?.effectiveDate ?? undefined,
            },
            rateStructure,
            usageBucketsByMonth: usageBucketsByMonthForCalc,
          })
        : { status: "NOT_IMPLEMENTED", reason: "Missing inputs or plan not computable" };

    const effectiveCentsPerKwh =
      (trueCostEstimate as any)?.status === "OK" &&
      typeof (trueCostEstimate as any)?.annualCostDollars === "number" &&
      annualKwh &&
      annualKwh > 0
        ? (((trueCostEstimate as any).annualCostDollars as number) / annualKwh) * 100
        : null;

    const math = {
      status: String((trueCostEstimate as any)?.status ?? ""),
      reason: (trueCostEstimate as any)?.reason ?? null,
      requiredBucketKeys,
      componentsV2: (trueCostEstimate as any)?.componentsV2 ?? null,
      components: (trueCostEstimate as any)?.components ?? null,
    };

    // Monthly breakdown table (for Plan Details UI).
    // This is a transparent rendering of the same engine math, but expanded by month so totals sum to annual.
    const monthlyBreakdown = (() => {
      if (!rsPresent || !tdspApplied) return null;
      if (String((trueCostEstimate as any)?.status ?? "") !== "OK") return null;
      const byMonth = usageBucketsByMonthForCalc ?? {};
      const monthsAll = Object.keys(byMonth).sort();
      if (monthsAll.length === 0) return null;
      const months = monthsAll.slice(-12);

      const tdspPerKwhCents = Number(tdspApplied.perKwhDeliveryChargeCents ?? 0) || 0;
      const tdspMonthly = Number(tdspApplied.monthlyCustomerChargeDollars ?? 0) || 0;
      const repFixedMonthly = extractRepFixedMonthlyChargeDollars(rateStructure) ?? 0;

      const creditsMaybe = extractDeterministicBillCredits(rateStructure);
      const minimumMaybe = extractDeterministicMinimumRules({ rateStructure });
      const tieredMaybe = extractDeterministicTierSchedule(rateStructure);
      const touMaybe = extractDeterministicTouSchedule(rateStructure);
      const repFixedEnergyCents = extractFixedRepEnergyCentsPerKwh(rateStructure);

      // Determine REP bucket columns (for TOU schedule, we show each period; otherwise just total).
      const repBuckets: Array<{ bucketKey: string; label: string }> = (() => {
        if (touMaybe?.schedule?.periods?.length) {
          const uniq = new Map<string, { bucketKey: string; label: string }>();
          for (const p of touMaybe.schedule.periods) {
            const dayType = String((p as any)?.dayType ?? "").trim();
            const startHHMM = String((p as any)?.startHHMM ?? "").trim();
            const endHHMM = String((p as any)?.endHHMM ?? "").trim();
            if (!dayType || !startHHMM || !endHHMM) continue;
            const bucketKey =
              startHHMM === "0000" && endHHMM === "2400"
                ? `kwh.m.${dayType}.total`
                : `kwh.m.${dayType}.${startHHMM}-${endHHMM}`;
            const labelRaw = (p as any)?.label ?? null;
            const label =
              typeof labelRaw === "string" && labelRaw.trim()
                ? labelRaw.trim()
                : `${dayType.toUpperCase()} ${startHHMM}-${endHHMM}`;
            if (!uniq.has(bucketKey)) uniq.set(bucketKey, { bucketKey, label });
          }
          return Array.from(uniq.values());
        }
        return [{ bucketKey: "kwh.m.all.total", label: "ALL 00:00-24:00" }];
      })();

      const rows = months.map((ym) => {
        const m = byMonth[ym] ?? null;
        const totalKwh = monthKwh(m, "kwh.m.all.total");
        const repFixedCents = repFixedMonthly * 100;
        const tdspFixedCents = tdspMonthly * 100;
        const tdspDeliveryCents = totalKwh != null ? totalKwh * tdspPerKwhCents : null;

        // REP energy by bucket
        const repBucketLines = repBuckets.map((b) => {
          const kwh = monthKwh(m, b.bucketKey);
          let repCentsPerKwh: number | null = null;
          let repCostCents: number | null = null;
          let repCostDollars: number | null = null;
          let notes: string[] = [];

          if (kwh != null) {
            if (touMaybe?.schedule?.periods?.length) {
              const p = touMaybe.schedule.periods.find((pp: any) => {
                const dayType = String(pp?.dayType ?? "").trim();
                const startHHMM = String(pp?.startHHMM ?? "").trim();
                const endHHMM = String(pp?.endHHMM ?? "").trim();
                const key =
                  startHHMM === "0000" && endHHMM === "2400"
                    ? `kwh.m.${dayType}.total`
                    : `kwh.m.${dayType}.${startHHMM}-${endHHMM}`;
                return key === b.bucketKey;
              });
              repCentsPerKwh =
                p && typeof (p as any)?.repEnergyCentsPerKwh === "number" ? (p as any).repEnergyCentsPerKwh : null;
              if (repCentsPerKwh != null) {
                repCostCents = kwh * repCentsPerKwh;
              }
            } else if (tieredMaybe?.ok && totalKwh != null) {
              // Tiered: no single cents/kWh. We show an effective cents/kWh for the month.
              const tiered = computeRepEnergyCostForMonthlyKwhTiered({
                monthlyKwh: totalKwh,
                schedule: tieredMaybe.schedule,
              });
              repCostCents = tiered.repEnergyCentsTotal;
              repCentsPerKwh = totalKwh > 0 ? repCostCents / totalKwh : null;
              notes = ["tiered"];
            } else if (typeof repFixedEnergyCents === "number") {
              repCentsPerKwh = repFixedEnergyCents;
              repCostCents = kwh * repFixedEnergyCents;
            }
          }

          if (repCostCents != null) repCostDollars = round2(repCostCents / 100);

          return {
            bucketKey: b.bucketKey,
            label: b.label,
            kwh,
            repCentsPerKwh,
            repCostDollars,
            notes: notes.length ? notes : null,
          };
        });

        const repEnergyCents = repBucketLines.reduce((acc, x: any) => acc + (typeof x?.repCostDollars === "number" ? x.repCostDollars * 100 : 0), 0);

        // Credits (negative cents)
        const creditsApplied =
          creditsMaybe?.ok && totalKwh != null ? applyBillCreditsToMonth({ monthlyKwh: totalKwh, credits: creditsMaybe.credits }) : null;
        const creditsCents = creditsApplied ? creditsApplied.creditCentsTotal : 0;

        const subtotalCentsRaw =
          (repEnergyCents || 0) +
          repFixedCents +
          tdspFixedCents +
          (tdspDeliveryCents ?? 0) +
          creditsCents;

        let minUsageFeeCents = 0;
        let minBillTopUpCents = 0;
        let finalCents = clampNonNegative(roundCents(subtotalCentsRaw));
        if (minimumMaybe?.ok && totalKwh != null) {
          const appliedMin = applyMinimumRulesToMonth({
            monthlyKwh: totalKwh,
            minimum: minimumMaybe.minimum,
            subtotalCents: roundCents(subtotalCentsRaw),
          });
          minUsageFeeCents = appliedMin.minUsageFeeCents;
          minBillTopUpCents = appliedMin.minimumBillTopUpCents;
          finalCents = appliedMin.totalCentsAfter;
        }

        return {
          yearMonth: ym,
          bucketTotalKwh: totalKwh,
          repBuckets: repBucketLines,
          tdsp: {
            perKwhDeliveryChargeCents: tdspPerKwhCents,
            deliveryDollars: tdspDeliveryCents != null ? round2(tdspDeliveryCents / 100) : null,
            monthlyCustomerChargeDollars: round2(tdspMonthly),
          },
          repFixedMonthlyChargeDollars: round2(repFixedMonthly),
          creditsDollars: creditsApplied ? round2(creditsCents / 100) : null,
          minimumUsageFeeDollars: minimumMaybe?.ok ? round2(minUsageFeeCents / 100) : null,
          minimumBillTopUpDollars: minimumMaybe?.ok ? round2(minBillTopUpCents / 100) : null,
          totalDollars: round2(finalCents / 100),
        };
      });

      const totals = (() => {
        const annualCents = rows.reduce((acc: number, r: any) => acc + (typeof r?.totalDollars === "number" ? roundCents(r.totalDollars * 100) : 0), 0);
        const annualFromRows = round2(annualCents / 100);
        const expectedAnnual = typeof (trueCostEstimate as any)?.annualCostDollars === "number" ? (trueCostEstimate as any).annualCostDollars : null;
        const expectedAnnualCents =
          typeof expectedAnnual === "number" && Number.isFinite(expectedAnnual) ? roundCents(expectedAnnual * 100) : null;
        const deltaCents =
          expectedAnnualCents != null ? (annualCents - expectedAnnualCents) : null;
        return { annualFromRows, expectedAnnual, deltaCents };
      })();

      return {
        monthsCount: rows.length,
        repBuckets,
        rows,
        totals,
      };
    })();

    return NextResponse.json(
      {
        ok: true,
        offerId,
        isRenter,
        plan: {
          supplierName: offer?.supplier_name ?? null,
          planName: offer?.plan_name ?? null,
          termMonths: typeof offer?.term_months === "number" ? offer.term_months : null,
          rateType: offer?.rate_type ?? null,
          renewablePercent: numOrNull(offer?.green_percentage),
          eflUrl: offer?.docs?.efl ?? null,
          utilityName: offer?.distributor_name ?? house.utilityName ?? null,
          tdspSlug: tdspSlug || null,
        },
        template: ratePlanRow
          ? {
              ratePlanId: ratePlanRow.id,
              repPuctCertificate: ratePlanRow.repPuctCertificate ?? null,
              eflVersionCode: ratePlanRow.eflVersionCode ?? null,
              planCalcStatus,
              planCalcReasonCode,
              requiredBucketKeys,
            }
          : null,
        usage: {
          source: usageSource,
          intervalsCount,
          windowStart: windowStart ? windowStart.toISOString() : null,
          windowEnd: windowEnd ? windowEnd.toISOString() : null,
          cutoff: window.cutoff.toISOString(),
          bucketsMode: includeAllBuckets ? "all" : "core",
          yearMonths,
          avgMonthlyKwh,
          annualKwh, // strict last-365-days total
          bucketDefs: bucketDefsForResponse,
          bucketTable,
        },
        variables: {
          tdsp: tdspApplied,
          rep: {
            energyCentsPerKwh: repEnergyCentsPerKwh,
            fixedMonthlyChargeDollars: repFixedMonthlyChargeDollars,
          },
        },
        monthlyBreakdown,
        math,
        outputs: {
          trueCostEstimate,
          effectiveCentsPerKwh,
        },
        notes: [
          "Usage window matches /api/user/usage: strict last 365 days ending at your latest interval timestamp.",
          "Bucket totals are computed from those same intervals in America/Chicago local time.",
          includeAllBuckets
            ? "All UsageBucketDefinition buckets shown (usage DB)."
            : "CORE_MONTHLY_BUCKETS shown (9). More buckets will appear as plan engine v2 expands.",
        ],
      },
      { status: 200 },
    );
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}


